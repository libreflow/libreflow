// LibreFlow — Synthetic performance benchmark
//
// Mesure les hot paths sur une bibliothèque synthétique de N tracks (default 50000).
// Reproduit la logique critique de search.js + virt.js inline (zéro dep, comme core.test.cjs).
//
// Run :    node frontend/tests/bench.cjs           (default N=50000)
//          node frontend/tests/bench.cjs 100000    (custom size)
//
// Output : tableau avec median ms / ops/sec / mémoire delta par scénario.
// Régressions sont visibles d'un coup d'oeil : si median > seuil documenté, c'est un signal.

'use strict';

const ARGS = process.argv.slice(2);
const JSON_MODE = ARGS.includes('--json');
const N = parseInt(ARGS.find(a => /^\d+$/.test(a)), 10) || 50000;
const RUNS = 5; // chaque scénario tourné 5× pour la médiane

// ── Synthèse d'une bibliothèque déterministe ──────────────────────────────────

const ARTISTS = [
  'The Beatles', 'Pink Floyd', 'Queen', 'Led Zeppelin', 'Radiohead', 'Daft Punk',
  'David Bowie', 'Massive Attack', 'Portishead', 'Aphex Twin', 'Boards of Canada',
  'Nine Inch Nails', 'Tool', 'Mogwai', 'Sigur Rós', 'Tame Impala', 'Arctic Monkeys',
  'Beach House', 'Bon Iver', 'Caribou', 'Death Grips', 'FKA twigs', 'Flying Lotus',
];
const WORDS = [
  'shadow', 'echo', 'crystal', 'midnight', 'wave', 'memory', 'silent', 'storm',
  'mirror', 'fade', 'glow', 'pulse', 'orbit', 'drift', 'tide', 'aurora', 'frost',
  'nova', 'voyage', 'lucid', 'mirage', 'cosmos', 'flame', 'static', 'whisper',
];
const GENRES = ['Rock', 'Electronic', 'Ambient', 'Jazz', 'Classical', 'Hip-Hop', 'Folk', 'Pop'];

function rand(seed) {
  // mulberry32 — PRNG déterministe
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLibrary(n) {
  const r = rand(42);
  const tracks = new Array(n);
  for (let i = 0; i < n; i++) {
    const w1 = WORDS[Math.floor(r() * WORDS.length)];
    const w2 = WORDS[Math.floor(r() * WORDS.length)];
    const a  = ARTISTS[Math.floor(r() * ARTISTS.length)];
    const al = WORDS[Math.floor(r() * WORDS.length)] + ' ' + WORDS[Math.floor(r() * WORDS.length)];
    tracks[i] = {
      id:        'tr_' + i,
      path:      `/library/${a}/${al}/${i}.flac`,
      name:      w1 + ' ' + w2,
      artist:    a,
      artistFull:a,
      album:     al,
      duration:  120 + Math.floor(r() * 300),
      genre:     GENRES[Math.floor(r() * GENRES.length)],
      year:      1970 + Math.floor(r() * 55),
    };
  }
  return tracks;
}

// ── Reproduction inline de search.js (trigram + nlc + filter) ─────────────────

let _filterGen = 1;

function _trigrams(str) {
  const s = ' ' + str + ' ';
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
}

function _trigramScore(qSet, tSet) {
  if (qSet.size === 0 || tSet.size === 0) return 0;
  let inter = 0;
  for (const tg of qSet) if (tSet.has(tg)) inter++;
  // Jaccard
  return inter / (qSet.size + tSet.size - inter);
}

function filterExact(tracks, query) {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  const parts = q.split(/\s+/).filter(Boolean);
  return tracks.filter(t => {
    if (t._nlcGen !== _filterGen) {
      t._nlc = [t.name || '', t.artist || '', t.artistFull || '', t.album || '', t.genre || ''].join(' ').toLowerCase();
      t._trigrams = _trigrams(t._nlc);
      t._nlcGen = _filterGen;
    }
    const hay = t._nlc;
    return parts.every(p => hay.includes(p));
  });
}

function filterFuzzy(tracks, query) {
  const qTrigrams = _trigrams(query.toLowerCase().replace(/\s+/g, ' ').trim());
  const scores = new Map();
  for (const t of tracks) {
    if (t._nlcGen !== _filterGen) {
      t._nlc = [t.name || '', t.artist || '', t.artistFull || '', t.album || '', t.genre || ''].join(' ').toLowerCase();
      t._trigrams = _trigrams(t._nlc);
      t._nlcGen = _filterGen;
    }
    scores.set(t.id, _trigramScore(qTrigrams, t._trigrams));
  }
  const TH = 0.4;
  return tracks
    .filter(t => (scores.get(t.id) ?? 0) >= TH)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

// ── Reproduction inline de virt.js virtBuildRows ──────────────────────────────

const ROW_H = 36, GRP_H = 28;

function _normFirst(c) {
  return c ? (c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/, '#') || '#') : '#';
}

function virtBuildRows(fl, sort) {
  const rows = [];
  const grouped = ['az', 'za', 'artist', 'album'].includes(sort);
  const cmp = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
  if (grouped) {
    const keyFn = sort === 'artist' ? t => (t.artist || '').trim() || '?'
                : sort === 'album'  ? t => (t.album || '').trim() || '?'
                : t => _normFirst(t.name?.[0]);
    const grps = new Map();
    for (const t of fl) { const k = keyFn(t); const g = grps.get(k); if (g) g.push(t); else grps.set(k, [t]); }
    const keys = [...grps.keys()].sort((a, b) => sort === 'za' ? cmp(b, a) : cmp(a, b));
    let fi = 0;
    for (const k of keys) {
      rows.push({ type: 'grp', key: k });
      for (const t of grps.get(k)) rows.push({ type: 'tr', track: t, fi: fi++ });
    }
  } else {
    fl.forEach((t, i) => rows.push({ type: 'tr', track: t, fi: i }));
  }
  // Prefix-sum
  const offsets = new Int32Array(rows.length + 1);
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = offsets[i] + (rows[i].type === 'grp' ? GRP_H : ROW_H);
  }
  return { rows, offsets };
}

// ── Helpers de mesure ─────────────────────────────────────────────────────────

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mbDelta() {
  const m = process.memoryUsage();
  return m.heapUsed / 1024 / 1024;
}

function bench(label, fn) {
  // 1 warmup, RUNS measured runs
  fn();
  const beforeMB = mbDelta();
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    const result = fn();
    const t1 = process.hrtime.bigint();
    runs.push(Number(t1 - t0) / 1e6);
    if (i === 0) global.__lastResult = result; // garde une réf pour éviter DCE
  }
  const afterMB = mbDelta();
  const med = median(runs);
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ label, medianMs: med, deltaMB: afterMB - beforeMB }) + '\n');
  } else {
    console.log(
      label.padEnd(40),
      `median ${med.toFixed(2).padStart(8)} ms`,
      `ops/sec ${(1000 / med).toFixed(0).padStart(7)}`,
      `Δheap ${(afterMB - beforeMB).toFixed(1).padStart(6)} MB`,
    );
  }
  return med;
}

// ── Run ───────────────────────────────────────────────────────────────────────

if (!JSON_MODE) {
  console.log('\n══ LibreFlow synthetic bench ═════════════════════════════════');
  console.log(`  N = ${N} tracks   ·   RUNS = ${RUNS}   ·   node ${process.version}\n`);
}

if (!JSON_MODE) console.log('Building synthetic library...');
const t0 = process.hrtime.bigint();
const tracks = buildLibrary(N);
const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
if (!JSON_MODE) console.log(`  built in ${buildMs.toFixed(1)} ms  (${(buildMs / N * 1e6).toFixed(2)} ns/track)\n`);

// Reset _nlcGen between scenarios — sinon le 2e run réutilise le cache
function resetCache() {
  _filterGen++;
}

if (!JSON_MODE) console.log('── Filter / search ─────────────────────────────────────────');
bench('filterExact()           full pass empty', () => { resetCache(); return filterExact(tracks, ''); });
bench('filterExact()           query "shadow"',  () => { resetCache(); return filterExact(tracks, 'shadow'); });
bench('filterExact()           query "queen pulse"', () => { resetCache(); return filterExact(tracks, 'queen pulse'); });
bench('filterExact()           cache hit  "shadow"', () => filterExact(tracks, 'shadow'));
bench('filterFuzzy()           query "shdaow"',  () => { resetCache(); return filterFuzzy(tracks, 'shdaow'); });

if (!JSON_MODE) console.log('\n── Virtual scroll build ────────────────────────────────────');
bench('virtBuildRows()         sort=az (grouped)',    () => virtBuildRows(tracks, 'az'));
bench('virtBuildRows()         sort=artist (grouped)', () => virtBuildRows(tracks, 'artist'));
bench('virtBuildRows()         sort=date (flat)',     () => virtBuildRows(tracks, 'date'));

if (!JSON_MODE) console.log('\n══ Done ══════════════════════════════════════════════════════\n');
