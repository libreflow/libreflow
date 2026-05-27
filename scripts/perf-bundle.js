#!/usr/bin/env node
// LibreFlow — Bundle size gate
// Lit dist/assets/*.{js,css}, classe en buckets, compare à perf-budgets.json.
// Exit 0 = OK, exit 1 = au moins une bucket en dépassement, exit 2 = erreur structurelle.
// Spec: docs/superpowers/specs/2026-05-27-perf-budgets-design.md §5.1
// Si DIST_DIR ou BUDGETS_FILE changent (futur outDir Vite, etc.), modifier les 2 constantes.

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST_DIR     = 'dist';
const BUDGETS_FILE = 'perf-budgets.json';

function die(code, msg) { console.error(msg); process.exit(code); }

if (!fs.existsSync(DIST_DIR)) die(2, `[perf-bundle] ${DIST_DIR}/ not found — run \`npm run vite:build\` first`);
if (!fs.existsSync(BUDGETS_FILE)) die(2, `[perf-bundle] ${BUDGETS_FILE} not found — run \`npm run perf:baseline\` to generate`);

const budgets = JSON.parse(fs.readFileSync(BUDGETS_FILE, 'utf8'));
const tolPct  = Number(budgets._tolerancePct ?? 10);
const unknownPolicy = budgets._unknownBucketPolicy ?? 'warn';

// Classify filename → bucket. Try hashed pattern first, fallback to plain.
const RE_HASHED = /^(.+)-[a-f0-9]{8,}\.(js|css)$/;
const RE_PLAIN  = /^(.+)\.(js|css)$/;
function bucketFor(file) {
  let m = RE_HASHED.exec(file);
  if (m) return { name: m[2] === 'css' ? '_css' : m[1], ext: m[2] };
  m = RE_PLAIN.exec(file);
  if (m) return { name: m[2] === 'css' ? '_css' : m[1], ext: m[2] };
  return null;
}

const assetsDir = path.join(DIST_DIR, 'assets');
if (!fs.existsSync(assetsDir)) die(2, `[perf-bundle] ${assetsDir}/ not found — Vite output layout changed?`);

const totals = new Map(); // bucket → { raw, gzip }
for (const f of fs.readdirSync(assetsDir)) {
  const b = bucketFor(f);
  if (!b) continue;
  const buf = fs.readFileSync(path.join(assetsDir, f));
  const cur = totals.get(b.name) ?? { raw: 0, gzip: 0 };
  cur.raw  += buf.length;
  cur.gzip += zlib.gzipSync(buf, { level: 9 }).length;
  totals.set(b.name, cur);
}

const rows = [];
let failed = 0;
const declared = new Set(Object.keys(budgets.buckets || {}));

for (const [name, { raw, gzip }] of totals) {
  const budget = budgets.buckets?.[name]?.rawBytes;
  if (budget == null) {
    rows.push([name, raw, gzip, null, null, unknownPolicy === 'fail' ? 'FAIL' : 'WARN (no budget)']);
    if (unknownPolicy === 'fail') failed++;
    continue;
  }
  declared.delete(name);
  const limit = budget * (1 + tolPct / 100);
  const status = raw <= limit ? 'OK' : 'FAIL';
  if (status === 'FAIL') failed++;
  rows.push([name, raw, gzip, budget, raw - budget, status]);
}

// Buckets declared but not built (likely deletion/rename).
for (const name of declared) {
  rows.push([name, 0, 0, budgets.buckets[name].rawBytes, -budgets.buckets[name].rawBytes, 'WARN (declared, not built)']);
}

function kb(n)    { return n == null ? '-' : (n / 1024).toFixed(1); }
function delta(n) { return n == null ? '-' : (n >= 0 ? '+' : '') + (n / 1024).toFixed(1) + ' KB'; }
const header = ['Bucket', 'Raw KB', 'Gzip KB', 'Budget KB', 'Δ vs budget', 'Status'];
const lines  = [header, ...rows.map(([n, r, g, b, d, s]) => [n, kb(r), kb(g), kb(b), delta(d), s])];
const widths = header.map((_, i) => Math.max(...lines.map(l => String(l[i]).length)));
for (const l of lines) console.log(l.map((c, i) => String(c).padEnd(widths[i])).join('  '));

process.exit(failed > 0 ? 1 : 0);
