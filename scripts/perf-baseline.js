#!/usr/bin/env node
// LibreFlow — Regenerate perf baselines from current HEAD.
// Lance vite:build + bench.cjs --json, écrit perf-budgets.json + perf-baseline-bench.json.
// Outil opérateur — manuel uniquement. Spec: §5.3
// Refuse de tourner si baselines existantes ont un diff git non commité.
// Préserve tolérances déjà personnalisées (merge non destructif).

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const BUDGETS_FILE  = 'perf-budgets.json';
const BASELINE_FILE = 'perf-baseline-bench.json';
const DIST_DIR      = 'dist';

function die(code, msg) { console.error(msg); process.exit(code); }
function log(msg)       { console.log('[perf-baseline] ' + msg); }

function gitDirty(file) {
  if (!fs.existsSync(file)) return false;
  try {
    const out = execSync(`git status --porcelain -- ${file}`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch { return false; }
}
for (const f of [BUDGETS_FILE, BASELINE_FILE]) {
  if (gitDirty(f)) die(2, `[perf-baseline] ${f} has uncommitted changes — commit or stash first`);
}

log('Running vite:build…');
// On Windows, .cmd batch files require shell:true (spawnSync with 'npm.cmd' gives EINVAL otherwise).
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const b = spawnSync(npmCmd, ['run', 'vite:build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (b.status !== 0) die(b.status || 1, '[perf-baseline] vite:build failed');

log('Measuring bundle…');
// Vite 8 content hashes are base58-like (alphanumeric, may include - and _).
const RE_HASHED = /^(.+)-[a-zA-Z0-9_-]{8,}\.(js|css)$/;
const RE_PLAIN  = /^(.+)\.(js|css)$/;
const assetsDir = path.join(DIST_DIR, 'assets');
const totals = new Map();
for (const f of fs.readdirSync(assetsDir)) {
  let m = RE_HASHED.exec(f) || RE_PLAIN.exec(f);
  if (!m) continue;
  const name = m[2] === 'css' ? '_css' : m[1];
  const buf  = fs.readFileSync(path.join(assetsDir, f));
  totals.set(name, (totals.get(name) ?? 0) + buf.length);
}

const prevBudgets = fs.existsSync(BUDGETS_FILE) ? JSON.parse(fs.readFileSync(BUDGETS_FILE, 'utf8')) : {};
const nextBudgets = {
  _tolerancePct: prevBudgets._tolerancePct ?? 10,
  _unknownBucketPolicy: prevBudgets._unknownBucketPolicy ?? 'warn',
  _note: 'Edited by `npm run perf:baseline`. Manual overrides preserved.',
  buckets: {},
};
for (const [name, rawBytes] of totals) {
  const prev = prevBudgets.buckets?.[name] ?? {};
  nextBudgets.buckets[name] = { ...prev, rawBytes };
}
fs.writeFileSync(BUDGETS_FILE, JSON.stringify(nextBudgets, null, 2) + '\n');
log(`Wrote ${BUDGETS_FILE} (${Object.keys(nextBudgets.buckets).length} buckets)`);

log('Running bench.cjs --json…');
const benchOut = spawnSync(process.execPath, ['frontend/tests/bench.cjs', '--json'], {
  encoding: 'utf8', timeout: 120000,
});
if (benchOut.status !== 0) die(benchOut.status || 1, '[perf-baseline] bench.cjs --json failed:\n' + benchOut.stderr);

const prevBaseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
const nextBaseline = {
  _tolerancePct: prevBaseline._tolerancePct ?? 5,
  _note: 'Edited by `npm run perf:baseline`. Per-scenario tolerance overrides preserved.',
  scenarios: {},
};
for (const line of benchOut.stdout.trim().split('\n')) {
  if (!line.trim()) continue;
  const obj = JSON.parse(line);
  const prev = prevBaseline.scenarios?.[obj.label] ?? {};
  const entry = { ...prev, medianMs: Number(obj.medianMs.toFixed(2)) };
  // Sub-millisecond scenarios are noisy → default to 10% tolerance unless overridden.
  if (entry.tolerancePct == null && obj.medianMs < 1) entry.tolerancePct = 10;
  nextBaseline.scenarios[obj.label] = entry;
}
fs.writeFileSync(BASELINE_FILE, JSON.stringify(nextBaseline, null, 2) + '\n');
log(`Wrote ${BASELINE_FILE} (${Object.keys(nextBaseline.scenarios).length} scenarios)`);

log('Done. Review with: git diff ' + BUDGETS_FILE + ' ' + BASELINE_FILE);
