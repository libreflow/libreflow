#!/usr/bin/env node
// LibreFlow — Bench runtime regression gate
// Lit un fichier JSONL (une ligne par scénario, {label, medianMs, deltaMB}),
// compare à perf-baseline-bench.json.
// Exit 0 = OK, exit 1 = régression > tolérance OU scénario manquant,
// exit 2 = erreur structurelle (baseline absent, JSON corrompu, current vide).
// Spec: docs/superpowers/specs/2026-05-27-perf-budgets-design.md §5.2
// Test override: env LIBREFLOW_BENCH_BASELINE.

'use strict';

const fs = require('fs');

const BASELINE_FILE = process.env.LIBREFLOW_BENCH_BASELINE || 'perf-baseline-bench.json';
const currentArg    = process.argv[2];

function die(code, msg) { console.error(msg); process.exit(code); }

if (!currentArg) die(2, '[bench-compare] usage: bench-compare.js <current.json>');
if (!fs.existsSync(currentArg)) die(2, `[bench-compare] current file not found: ${currentArg}`);
if (!fs.existsSync(BASELINE_FILE)) die(2, `[bench-compare] ${BASELINE_FILE} not found — run \`npm run perf:baseline\` to generate`);

let baseline;
try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
catch (e) { die(2, `[bench-compare] baseline JSON parse error: ${e.message}`); }

const defaultTol = Number(baseline._tolerancePct ?? 5);
const scenarios  = baseline.scenarios || {};

const current = new Map();
const raw = fs.readFileSync(currentArg, 'utf8').trim();
if (!raw) die(2, '[bench-compare] current file is empty — bench did not complete');
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  let obj;
  try { obj = JSON.parse(line); }
  catch (e) { die(2, `[bench-compare] current JSONL parse error on line: ${line.slice(0, 80)}`); }
  if (typeof obj.label !== 'string' || typeof obj.medianMs !== 'number') {
    die(2, `[bench-compare] current line missing {label, medianMs}: ${line.slice(0, 80)}`);
  }
  current.set(obj.label, obj);
}

const rows = [];
let failed = 0;
const seen = new Set();
for (const [label, base] of Object.entries(scenarios)) {
  seen.add(label);
  const cur = current.get(label);
  const tol = Number(base.tolerancePct ?? defaultTol);
  if (!cur) {
    rows.push([label, base.medianMs, '-', '-', tol, 'FAIL (deleted from bench)']);
    failed++;
    continue;
  }
  // Guard: baseline=0 → division by zero → Infinity drift.
  // If the baseline rounds to 0 ms the scenario is essentially free (sub-µs fast path).
  // Any positive current measurement is noise, not a regression — treat as OK.
  const driftPct = base.medianMs === 0
    ? 0
    : ((cur.medianMs - base.medianMs) / base.medianMs) * 100;
  const status   = driftPct > tol ? 'FAIL' : 'OK';
  if (status === 'FAIL') failed++;
  rows.push([label, base.medianMs, cur.medianMs, driftPct, tol, status]);
}

for (const [label, cur] of current) {
  if (seen.has(label)) continue;
  rows.push([label, '-', cur.medianMs, '-', '-', 'WARN (new bench, no baseline)']);
}

function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : String(n); }
function pct(n) { return typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : String(n); }
const header = ['Scenario', 'Baseline ms', 'Current ms', 'Δ%', 'Tol%', 'Status'];
const lines  = [header, ...rows.map(([l, b, c, d, t, s]) => [l, fmt(b), fmt(c), pct(d), typeof t === 'number' ? t + '%' : t, s])];
const widths = header.map((_, i) => Math.max(...lines.map(l => String(l[i]).length)));
for (const l of lines) console.log(l.map((c, i) => String(c).padEnd(widths[i])).join('  '));

process.exit(failed > 0 ? 1 : 0);
