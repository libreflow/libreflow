# Test Coverage Expansion Design

**Goal:** Extend LibreFlow's zero-dependency test suite from 131 to ~207 assertions by adding `search.test.cjs` (search/filter/sort logic) and `tags.test.cjs` (genre inference), plus a `run-all.cjs` runner.

**Architecture:** Three new files under `frontend/tests/`. Each test file is self-contained (own `assert/section/_pass/_fail` harness, no shared dependencies). `run-all.cjs` orchestrates all three via `child_process.execSync`, parses each `Total :` line, and prints a combined result. `search.test.cjs` uses inline reimplementations of `search.js` pure functions (because `search.js` imports `store.js` which cannot be `require()`-d in CJS). `tags.test.cjs` uses `require('../src/tags.js')` directly (the file has no ESM imports, same pattern as `require('../src/cfg.js')` already used in `core.test.cjs`).

**Tech Stack:** Node.js 18+, zero external dependencies, CJS (`require`), `child_process.execSync` for the runner.

---

## File Structure

```
frontend/tests/
  core.test.cjs       ← unchanged (131 assertions)
  search.test.cjs     ← NEW ~52 assertions
  tags.test.cjs       ← NEW ~24 assertions
  run-all.cjs         ← NEW runner (~20 lines)
```

Each test file can be run standalone: `node frontend/tests/search.test.cjs`
Combined run: `node frontend/tests/run-all.cjs`

---

## File 1: `run-all.cjs`

Runs all three test files sequentially via `execSync`, captures stdout, parses the `Total :` summary line from each, aggregates pass/fail counts, and exits with code 1 if any file has failures.

```js
// Structure
const files = ['core.test.cjs', 'search.test.cjs', 'tags.test.cjs'];
// for each: execSync, parse "Total : N   OK: N   KO: N", accumulate
// print: "=== TOTAL: N   OK: N   KO: N ==="
// process.exit(1) if totalKO > 0
```

---

## File 2: `search.test.cjs`

### Why inline reimplementation

`search.js` imports `{ normTag }` from `utils.js` and `{ get }` from `store.js`. These ESM imports prevent direct `require()` in CJS. The established pattern in `core.test.cjs` (see nowplaying formatters section) is to inline-reimplement the pure logic under test.

### Test groups

#### Group 1 — `_normalizeGenre` (~12 assertions)

Inline reimplementation of the alias lookup + lowercase trim:
```js
function _normalizeGenre(raw) {
  const GENRE_ALIASES = { 'hip-hop':'rap', 'hip hop':'rap', 'r&b':'rnb',
    'électronique':'electronic', 'lo-fi':'lofi', 'lo fi':'lofi',
    'chanson française':'chanson', 'musique classique':'classical', ... };
  if (!raw) return '–';
  const n = raw.toLowerCase().trim();
  return GENRE_ALIASES[n] ?? n;
}
```

Cases:
- `'hip-hop'` → `'rap'`
- `'Hip-Hop'` (mixed case) → `'rap'`
- `'r&b'` → `'rnb'`
- `'électronique'` → `'electronic'`
- `'lo-fi'` → `'lofi'`
- `'chanson française'` → `'chanson'`
- `'musique classique'` → `'classical'`
- `'jazz'` (unknown, passthrough) → `'jazz'`
- `'  Jazz  '` (whitespace) → `'jazz'`
- `''` (empty) → `'–'`
- `null` → `'–'`
- `'Rap Français'` → `'rap'`

#### Group 2 — `rebuildTrackIdxMap` + `trackIdx` (~8 assertions)

Inline reimplementation using a plain Map:
```js
function makeIdxMap(tracks) {
  return new Map(tracks.map((t, i) => [t.id, i]));
}
function trackIdx(map, tracks, t) {
  const cached = map.get(t?.id);
  return cached !== undefined ? cached : tracks.indexOf(t);
}
```

Cases:
- Empty tracks → map size 0
- 3 tracks → map size 3
- `trackIdx` on known track → correct index (0, 1, 2)
- `trackIdx` on unknown track → -1
- After "mutation" (new map) → updated index
- `trackIdx(null)` → -1
- O(1) path: cached result equals indexOf result
- Fallback path: track in array but not in map → indexOf result

#### Group 3 — `fuzzyScore` (~8 assertions)

Inline reimplementation of the scoring function:
```js
function fuzzyScore(s, q) {
  if (!s) return 0;
  if (s === q) return 100;
  if (s.startsWith(q)) return 80;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => s.includes(w))) return 60;
  if (s.includes(q)) return 40;
  let qi = 0, si = 0, gaps = 0;
  while (qi < q.length && si < s.length) {
    if (s[si] === q[qi]) { qi++; gaps = 0; } else gaps++;
    si++;
  }
  if (qi === q.length) return Math.max(1, 20 - gaps);
  return 0;
}
```

Cases:
- Exact match → 100
- Prefix match → 80
- All words present (multi-word query) → 60
- Substring match → 40
- Scattered chars (fuzzy) → > 0 and < 40
- No match at all → 0
- Empty string `s` → 0
- Query longer than s (no match) → 0

#### Group 4 — `getFiltered` sort modes (~10 assertions)

Inline reimplementation of sort logic using `Intl.Collator`:
```js
const _coll = new Intl.Collator('fr', { sensitivity: 'base' });
function sortTracks(tracks, sort) {
  const copy = [...tracks];
  if      (sort === 'az')     copy.sort((a,b) => _coll.compare(a.name, b.name));
  else if (sort === 'za')     copy.sort((a,b) => _coll.compare(b.name, a.name));
  else if (sort === 'artist') copy.sort((a,b) => _coll.compare(a.artist||'', b.artist||''));
  else if (sort === 'album')  copy.sort((a,b) => _coll.compare(a.album||'', b.album||''));
  return copy;
}
```

Cases:
- `az`: "Zorro" after "Abba"
- `za`: "Zorro" before "Abba"
- `artist`: sorted by artist field
- `album`: sorted by album field
- Sort does not mutate original array (CRITICAL invariant)
- Empty array → empty result
- Single track → unchanged
- Accented chars: "Été" sorts correctly with French collator
- Tracks with missing `artist` field → treated as `''`
- Tracks with missing `album` field → treated as `''`

#### Group 5 — `getFiltered` view filters (~8 assertions)

Inline filter logic:
```js
function filterByView(tracks, view, likedIds) {
  if (view === 'all')    return tracks;
  if (view === 'liked')  return tracks.filter(t => likedIds.has(t.id));
  return tracks;
}
function dedupeByField(tracks, field) {
  const seen = new Set();
  return tracks.filter(t => { const v = t[field]; if (seen.has(v)) return false; seen.add(v); return true; });
}
```

Cases:
- `view='all'` → all tracks returned
- `view='liked'` with 2 liked → only 2 returned
- `view='liked'` with empty likedIds → empty result
- Albums dedup: 5 tracks from 2 albums → 2 results
- Artists dedup: 5 tracks from 3 artists → 3 results
- Dedup preserves first occurrence (not last)
- Empty tracks → empty result for all views
- `view='all'` does not copy the array unnecessarily

#### Group 6 — query search (~6 assertions)

Cases:
- Query `'radiohead'` matches artist field
- Query `'creep'` matches name field
- Query `'ok computer'` matches album field
- Query `'xyz999'` → empty result
- Empty query → no filtering applied
- Cache: same query+tracks → same array reference returned

---

## File 3: `tags.test.cjs`

Uses `require('../src/tags.js')` directly — the file has no ESM imports (self-contained), same pattern as `require('../src/cfg.js')` in `core.test.cjs`.

Destructures: `const { guessGenre, GENRE_ARTISTS, GENRE_KEYWORDS } = require('../src/tags.js');`

### Group 1 — `guessGenre` exact artist match (~5 assertions)

```js
guessGenre({ artist: 'Eminem' })                → 'Hip-Hop'
guessGenre({ artist: 'Daft Punk' })             → 'Electronic'
guessGenre({ artist: 'Booba' })                 → 'Rap Français'
guessGenre({ artist: 'Radiohead' })             → 'Rock'
guessGenre({ artist: 'Marvin Gaye' })           → 'Soul'
```

### Group 2 — `guessGenre` partial artist match (~3 assertions)

```js
guessGenre({ artist: 'Drake feat. Lil Wayne' }) → 'Hip-Hop'
guessGenre({ artist: 'Daft Punk vs Skrillex' }) → 'Electronic'
guessGenre({ artist: 'x' })                     → null  // too short, no match
```

### Group 3 — `guessGenre` keyword inference (~6 assertions)

```js
guessGenre({ name: 'Trap Queen Remix', artist: 'Unknown' })            → 'Hip-Hop'
guessGenre({ name: 'Blue Danube Symphony No.1', artist: 'Unknown' })   → 'Classique'
guessGenre({ name: 'Reggae Night', album: 'Dancehall Kings' })         → 'Reggae'
guessGenre({ name: 'Jazz Bebop Session', artist: 'Unknown' })          → 'Jazz'
guessGenre({ name: 'Electronic Techno Mix', artist: 'Unknown' })       → 'Electronic'
guessGenre({ name: 'Rock Anthem', album: 'Metal Hearts' })             → 'Rock'
```

### Group 4 — `guessGenre` fallback null (~3 assertions)

```js
guessGenre({ artist: '', name: '', album: '' })  → null
guessGenre({})                                   → null
guessGenre({ artist: 'Xyz123', name: 'Abc' })    → null
```

### Group 5 — `GENRE_ARTISTS` integrity (~4 assertions)

```js
GENRE_ARTISTS instanceof Map                    → true
GENRE_ARTISTS.size > 100                        → true
GENRE_ARTISTS.get('eminem')                     === 'Hip-Hop'
GENRE_ARTISTS.get('pnl')                        === 'Rap Français'
```

### Group 6 — `GENRE_KEYWORDS` integrity (~3 assertions)

```js
Array.isArray(GENRE_KEYWORDS)                   → true
GENRE_KEYWORDS.length > 10                      → true
GENRE_KEYWORDS.every(([re,g,w]) => re instanceof RegExp && typeof g === 'string' && typeof w === 'number') → true
```

---

## Test Execution

### Standalone (development)
```powershell
node frontend/tests/search.test.cjs   # only search tests
node frontend/tests/tags.test.cjs     # only tags tests
node frontend/tests/core.test.cjs     # only core tests (unchanged)
```

### Combined (CI / pre-commit)
```powershell
node frontend/tests/run-all.cjs
```

Expected output:
```
[core.test.cjs]   Total: 131   OK: 131   KO: 0
[search.test.cjs] Total:  52   OK:  52   KO: 0
[tags.test.cjs]   Total:  24   OK:  24   KO: 0
=== GRAND TOTAL: 207   OK: 207   KO: 0 ===
```

---

## Out of Scope

- `player.js` — DOM-dependent at module level (`audio = document.getElementById('audio')`), not testable without jsdom
- `renderer.js` — same constraint
- Coverage percentage measurement — no `c8` or coverage tooling added (chosen approach A)
- Modifying `core.test.cjs` — file stays unchanged
