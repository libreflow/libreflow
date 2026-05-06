# Test Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend LibreFlow's zero-dependency test suite from 131 to ~207 assertions by creating `search.test.cjs` (52 assertions), `tags.test.cjs` (24 assertions), and `run-all.cjs` (orchestrator).

**Architecture:** Three new files in `frontend/tests/`. `search.test.cjs` uses inline reimplementations of `search.js` pure functions (search.js imports store.js/utils.js via ESM and cannot be `require()`-d; same inline-reimplementation pattern as `nowplaying.js` formatters in `core.test.cjs` §10). `tags.test.cjs` uses `require('../src/tags.js')` directly — tags.js has no top-level imports and is synchronous (same pattern as `cfg.js` already used in `core.test.cjs`). `run-all.cjs` orchestrates all three files via `child_process.execSync`, parses each `Total :` summary line, and exits with code 1 if any failures.

**Tech Stack:** Node.js 22.12+ (required for `require()` of synchronous ES modules — confirmed working in this repo via `core.test.cjs`'s existing `require('../src/cfg.js')`), zero external dependencies, CJS (`'use strict'`).

---

## File Structure

```
frontend/tests/
  core.test.cjs       ← unchanged (131 assertions)
  search.test.cjs     ← NEW (~52 assertions, 6 groups)
  tags.test.cjs       ← NEW (~24 assertions, 6 groups)
  run-all.cjs         ← NEW runner
```

Each file is standalone: `node frontend/tests/search.test.cjs`
Combined: `node frontend/tests/run-all.cjs`

---

## Task 1: `search.test.cjs` — Groups 1–3 (normalizeGenre, trackIdxMap, fuzzyScore)

**Files:**
- Create: `frontend/tests/search.test.cjs`

- [ ] **Step 1: Create the file with harness + Groups 1–3**

Create `frontend/tests/search.test.cjs` with this exact content:

```js
/**
 * search.test.cjs -- Tests unitaires search.js (filtrage, tri, recherche)
 * Execution : node frontend/tests/search.test.cjs
 * Zero dependance externe. Node.js >= 18.
 *
 * Note : search.js est ESM et importe store.js/utils.js — on reimplemente
 * inline les fonctions pures testées, même pattern que core.test.cjs §10.
 */
'use strict';

let _pass = 0, _fail = 0;
function assert(cond, label) {
  if (cond) { _pass++; process.stdout.write('  [OK]  ' + label + '\n'); }
  else       { _fail++; process.stdout.write('  [KO]  ' + label + '\n'); }
}
function section(name) {
  console.log('\n-- ' + name + ' ' + '-'.repeat(Math.max(0, 50 - name.length)));
}

// =============================================================================
// 1. _normalizeGenre (~12 assertions)
// =============================================================================
section('search.js -- _normalizeGenre');

// Inline reimplementation fidèle à search.js (GENRE_ALIASES complet, voir search.js:25-92)
const GENRE_ALIASES = {
  'rap français':'rap',    'rap francais':'rap',    'french rap':'rap',      'rap fr':'rap',
  'rap us':'rap',          'hip hop':'rap',          'hip-hop':'rap',         'hiphop':'rap',
  'hip hop français':'rap','hip hop francais':'rap', 'french hip hop':'rap',  'hip-hop music':'rap',
  'hip hop music':'rap',   'boom bap':'rap',         'gangsta rap':'rap',     'conscious rap':'rap',
  'cloud rap':'rap',       'pop rap':'rap',           'rap game':'rap',        'underground rap':'rap',
  'trap':'trap',           'trap music':'trap',       'trap français':'trap',  'trap francais':'trap',
  'dark phonk':'phonk',    'drift phonk':'phonk',    'hard phonk':'phonk',    'slowed phonk':'phonk',
  'memphis phonk':'phonk',
  'uk drill':'drill',      'ny drill':'drill',       'french drill':'drill',  'drill music':'drill',
  'brooklyn drill':'drill',
  'afrobeats':'afro',      'afrobeat':'afro',        'afro trap':'afro',      'afro pop':'afro',
  'afropop':'afro',        'afro':'afro',
  'électronique':'electronic','electronique':'electronic','electronica':'electronic','edm':'electronic',
  'electronic music':'electronic','musique électronique':'electronic','musique electronique':'electronic',
  'r&b':'rnb',             'r & b':'rnb',            "r'n'b":'rnb',           "r\\'n\\'b":'rnb',
  'rhythm and blues':'rnb','rhythm & blues':'rnb',   'rythm and blues':'rnb', 'contemporary r&b':'rnb',
  'neo r&b':'rnb',
  'neo soul':'soul',       'soul music':'soul',
  'pop music':'pop',       'french pop':'pop',       'pop française':'pop',   'pop francaise':'pop',
  'chanson':'chanson',     'chanson française':'chanson','chanson francaise':'chanson','french chanson':'chanson',
  'variété':'variete',     'variete':'variete',       'variété française':'variete','variete francaise':'variete',
  'french variety':'variete',
  'classique':'classical', 'musique classique':'classical','classical music':'classical',
  'classic rock':'rock',   'rock music':'rock',
  'world music':'world',   'musique du monde':'world',
  'lo-fi':'lofi',          'lo fi':'lofi',            'lo-fi hip hop':'lofi',  'lofi hip hop':'lofi',
  'lofi beats':'lofi',     'chillhop':'lofi',
  'ambient music':'ambient','chillout':'ambient',     'chill':'ambient',
  'dancehall':'reggae',    'reggaeton':'reggae',
  'latin pop':'latin',     'salsa':'latin',            'bachata':'latin',       'cumbia':'latin',
};

function _normalizeGenre(raw) {
  if (!raw) return '–';
  const n = raw.toLowerCase().trim();
  return GENRE_ALIASES[n] ?? n;
}

(function () {
  assert(_normalizeGenre('hip-hop')           === 'rap',        "hip-hop → 'rap'");
  assert(_normalizeGenre('Hip-Hop')           === 'rap',        "Hip-Hop (casse mixte) → 'rap'");
  assert(_normalizeGenre('r&b')               === 'rnb',        "r&b → 'rnb'");
  assert(_normalizeGenre('électronique')      === 'electronic', "électronique → 'electronic'");
  assert(_normalizeGenre('lo-fi')             === 'lofi',       "lo-fi → 'lofi'");
  assert(_normalizeGenre('chanson française') === 'chanson',    "chanson française → 'chanson'");
  assert(_normalizeGenre('musique classique') === 'classical',  "musique classique → 'classical'");
  assert(_normalizeGenre('jazz')              === 'jazz',       "jazz (passthrough) → 'jazz'");
  assert(_normalizeGenre('  Jazz  ')          === 'jazz',       "whitespace trimmé → 'jazz'");
  assert(_normalizeGenre('')                  === '–',          "vide → '–'");
  assert(_normalizeGenre(null)                === '–',          "null → '–'");
  assert(_normalizeGenre('Rap Français')      === 'rap',        "Rap Français → 'rap'");
}());

// =============================================================================
// 2. rebuildTrackIdxMap + trackIdx (~8 assertions)
// =============================================================================
section('search.js -- rebuildTrackIdxMap + trackIdx');

function makeIdxMap(tracks) {
  return new Map(tracks.map((t, i) => [t.id, i]));
}

function trackIdx(map, tracks, t) {
  if (!map || !t) return -1;
  const cached = map.get(t.id);
  return cached !== undefined ? cached : tracks.indexOf(t);
}

(function () {
  const empty = makeIdxMap([]);
  assert(empty.size === 0, 'empty tracks → map size 0');

  const t1 = { id: 'a' }, t2 = { id: 'b' }, t3 = { id: 'c' };
  const tracks = [t1, t2, t3];
  const map = makeIdxMap(tracks);
  assert(map.size === 3,                        '3 tracks → map size 3');
  assert(trackIdx(map, tracks, t1) === 0,       'trackIdx connu → 0');
  assert(trackIdx(map, tracks, t2) === 1,       'trackIdx connu → 1');
  assert(trackIdx(map, tracks, t3) === 2,       'trackIdx connu → 2');

  const unknown = { id: 'z' };
  assert(trackIdx(map, tracks, unknown) === -1, 'trackIdx inconnu → -1 (fallback indexOf)');

  assert(trackIdx(map, tracks, null) === -1,    'trackIdx(null) → -1');

  const t4 = { id: 'd' };
  tracks.push(t4);
  const map2 = makeIdxMap(tracks);
  assert(trackIdx(map2, tracks, t4) === 3,      'après rebuild: nouvel id → index 3');
}());

// =============================================================================
// 3. fuzzyScore (~8 assertions)
// =============================================================================
section('search.js -- fuzzyScore');

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

(function () {
  assert(fuzzyScore('radiohead', 'radiohead')   === 100, 'exact match → 100');
  assert(fuzzyScore('radiohead', 'radio')       === 80,  'prefix → 80');
  // multi-word query, not a prefix → 60
  assert(fuzzyScore('play ok computer', 'ok computer') === 60, 'all words present → 60');
  // single-word query, substring but not prefix → 40
  assert(fuzzyScore('radiohead creep', 'creep') === 40,  'substring (non-prefix) → 40');
  // scattered chars → score between 0 and 40
  const sc = fuzzyScore('radiohead', 'rdh');
  assert(sc > 0 && sc < 40,                            'chars épars → > 0 et < 40');
  assert(fuzzyScore('radiohead', 'xyz')         === 0,  'aucun match → 0');
  assert(fuzzyScore('', 'test')                 === 0,  's vide → 0');
  assert(fuzzyScore('ab', 'abcde')              === 0,  'query plus longue que s → 0');
}());
```

- [ ] **Step 2: Run the file and verify it passes**

```powershell
node frontend/tests/search.test.cjs
```

Expected output (28 assertions):
```
-- search.js -- _normalizeGenre --------------------------------
  [OK]  hip-hop → 'rap'
  ...
-- search.js -- rebuildTrackIdxMap + trackIdx ------------------
  [OK]  empty tracks → map size 0
  ...
-- search.js -- fuzzyScore ------------------------------------
  [OK]  exact match → 100
  ...
```

All lines must show `[OK]`. No `[KO]`. The file does not yet print a `Total :` line (will be added in Task 2).

- [ ] **Step 3: Commit**

```powershell
git add frontend/tests/search.test.cjs
git commit -m "test: add search.test.cjs groups 1-3 (normalizeGenre, trackIdxMap, fuzzyScore)"
```

---

## Task 2: `search.test.cjs` — Groups 4–6 (sort modes, view filters, query search) + Total line

**Files:**
- Modify: `frontend/tests/search.test.cjs` (append groups 4–6 + result footer)

- [ ] **Step 1: Append Groups 4–6 and the result footer**

Open `frontend/tests/search.test.cjs` and append the following block **after** the existing Group 3 IIFE, replacing nothing:

```js
// =============================================================================
// 4. sortTracks — modes az / za / artist / album (~10 assertions)
// =============================================================================
section('search.js -- sortTracks (az/za/artist/album)');

const _coll = new Intl.Collator('fr', { sensitivity: 'base' });

function sortTracks(tracks, sort) {
  const copy = [...tracks];
  if      (sort === 'az')     copy.sort((a, b) => _coll.compare(a.name,         b.name));
  else if (sort === 'za')     copy.sort((a, b) => _coll.compare(b.name,         a.name));
  else if (sort === 'artist') copy.sort((a, b) => _coll.compare(a.artist || '', b.artist || ''));
  else if (sort === 'album')  copy.sort((a, b) => _coll.compare(a.album  || '', b.album  || ''));
  return copy;
}

(function () {
  const T = [
    { id: '1', name: 'Zorro', artist: 'Charlie', album: 'Zoo'  },
    { id: '2', name: 'Abba',  artist: 'Alice',   album: 'Art'  },
    { id: '3', name: 'Été',   artist: 'Bob',     album: 'Mer'  },
    { id: '4', name: 'Moon',  artist: undefined, album: undefined },
  ];

  const az = sortTracks(T, 'az');
  assert(az[0].name === 'Abba',  'az: Abba premier');
  assert(az[3].name === 'Zorro', 'az: Zorro dernier');
  assert(az[1].name === 'Été',   'az: Été deuxième (collator FR, é≈e, avant M)');

  const za = sortTracks(T, 'za');
  assert(za[0].name === 'Zorro', 'za: Zorro premier');
  assert(za[3].name === 'Abba',  'za: Abba dernier');

  const byArtist = sortTracks(T, 'artist');
  assert(byArtist[0].id === '4',         'artist: undefined→"" vient en premier');
  assert(byArtist[3].artist === 'Charlie','artist: Charlie en dernier');

  const byAlbum = sortTracks(T, 'album');
  assert(byAlbum[0].id === '4',          'album: undefined→"" vient en premier');
  assert(byAlbum[3].album === 'Zoo',     'album: Zoo en dernier');

  assert(T[0].name === 'Zorro',          'sort ne mute pas le tableau original');
  assert(sortTracks([], 'az').length === 0, 'empty → []');
}());

// =============================================================================
// 5. filterByView + dedupeByField (~8 assertions)
// =============================================================================
section('search.js -- filterByView + dedupeByField');

function filterByView(tracks, view, likedIds) {
  if (view === 'all')   return tracks;
  if (view === 'liked') return tracks.filter(t => likedIds.has(t.id));
  return tracks;
}

function dedupeByField(tracks, field) {
  const seen = new Set();
  return tracks.filter(t => {
    const v = t[field];
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

(function () {
  // 5 tracks: 2 albums (X×3, Y×2), 3 artists (Radiohead×2, Daft Punk×2, Miles Davis×1)
  const T = [
    { id: '1', artist: 'Radiohead',  album: 'X' },
    { id: '2', artist: 'Radiohead',  album: 'X' },
    { id: '3', artist: 'Daft Punk',  album: 'X' },
    { id: '4', artist: 'Daft Punk',  album: 'Y' },
    { id: '5', artist: 'Miles Davis',album: 'Y' },
  ];

  const all = filterByView(T, 'all', new Set());
  assert(all.length === 5, "view='all' → 5 tracks retournées");
  assert(all === T,        "view='all' → même référence (pas de copie)");

  const liked = filterByView(T, 'liked', new Set(['1', '3']));
  assert(liked.length === 2, "view='liked' avec 2 liked → 2 retournées");

  const likedEmpty = filterByView(T, 'liked', new Set());
  assert(likedEmpty.length === 0, "view='liked' vide → 0");

  const byAlbum = dedupeByField(T, 'album');
  assert(byAlbum.length === 2,    'dedup album: 5 tracks, 2 albums → 2 résultats');
  assert(byAlbum[0].id === '1',   'dedup album: garde la première occurrence');

  const byArtist = dedupeByField(T, 'artist');
  assert(byArtist.length === 3,   'dedup artist: 5 tracks, 3 artistes → 3 résultats');

  assert(filterByView([], 'liked', new Set(['x'])).length === 0, 'empty tracks → 0');
}());

// =============================================================================
// 6. filterByQuery + cache (~6 assertions)
// =============================================================================
section('search.js -- filterByQuery + cache');

const _QC = { sig: null, result: null };

function filterByQuery(tracks, q) {
  const sig = (q || '') + '|' + tracks.length;
  if (sig === _QC.sig) return _QC.result;
  if (!q) { _QC.sig = sig; _QC.result = tracks; return tracks; }
  const ql = q.toLowerCase();
  _QC.result = tracks.filter(t => Math.max(
    fuzzyScore((t.name   || '').toLowerCase(), ql),
    fuzzyScore((t.artist || '').toLowerCase(), ql),
    fuzzyScore((t.album  || '').toLowerCase(), ql),
  ) > 0);
  _QC.sig = sig;
  return _QC.result;
}

(function () {
  const T = [
    { id: '1', name: 'Creep',         artist: 'Radiohead', album: 'Pablo Honey' },
    { id: '2', name: 'Karma Police',  artist: 'Radiohead', album: 'OK Computer' },
    { id: '3', name: 'One More Time', artist: 'Daft Punk', album: 'Discovery'   },
  ];

  assert(filterByQuery(T, 'radiohead').length === 2, "query 'radiohead' → match sur artiste");
  assert(filterByQuery(T, 'creep').length     === 1, "query 'creep' → match sur nom");
  assert(filterByQuery(T, 'ok computer').length === 1,"query 'ok computer' → match sur album");
  assert(filterByQuery(T, 'xyz999').length    === 0, "query 'xyz999' → 0 résultats");
  assert(filterByQuery(T, '').length          === 3, "query vide → pas de filtrage");

  const r1 = filterByQuery(T, 'radiohead');
  const r2 = filterByQuery(T, 'radiohead');
  assert(r1 === r2, 'cache: même query+tracks → même référence array');
}());

// -- Résultat -----------------------------------------------------------------
console.log('\n' + '-'.repeat(54));
console.log('  Total : ' + (_pass + _fail) + '   OK: ' + _pass + '   KO: ' + _fail);
if (_fail > 0) { process.exit(1); }
```

- [ ] **Step 2: Run the full search test file and verify it passes**

```powershell
node frontend/tests/search.test.cjs
```

Expected final line:
```
  Total : 52   OK: 52   KO: 0
```

All 52 assertions must show `[OK]`.

- [ ] **Step 3: Commit**

```powershell
git add frontend/tests/search.test.cjs
git commit -m "test: complete search.test.cjs with groups 4-6 (sort, filters, query) — 52 assertions"
```

---

## Task 3: `tags.test.cjs` — All 6 groups

**Files:**
- Create: `frontend/tests/tags.test.cjs`

> **Note:** `tags.js` has no top-level `import` statements and is fully synchronous — it can be loaded via `require()` in Node 22.12+ (same mechanism as `require('../src/cfg.js')` in `core.test.cjs`). The file exports `readTags`, `extractColor`, `GENRE_ARTISTS`, `GENRE_KEYWORDS`, `guessGenre`.

- [ ] **Step 1: Create the file**

Create `frontend/tests/tags.test.cjs` with this exact content:

```js
/**
 * tags.test.cjs -- Tests unitaires tags.js (guessGenre, GENRE_ARTISTS, GENRE_KEYWORDS)
 * Execution : node frontend/tests/tags.test.cjs
 * Zero dependance externe. Node.js >= 22.12 (require() de modules ES synchrones).
 */
'use strict';

let _pass = 0, _fail = 0;
function assert(cond, label) {
  if (cond) { _pass++; process.stdout.write('  [OK]  ' + label + '\n'); }
  else       { _fail++; process.stdout.write('  [KO]  ' + label + '\n'); }
}
function section(name) {
  console.log('\n-- ' + name + ' ' + '-'.repeat(Math.max(0, 50 - name.length)));
}

// Chargement direct (tags.js n'a aucun import, synchrone — même pattern que cfg.js)
const { guessGenre, GENRE_ARTISTS, GENRE_KEYWORDS } = require('../src/tags.js');

// =============================================================================
// 1. guessGenre — correspondance exacte artiste (~5 assertions)
// =============================================================================
section('tags.js -- guessGenre exact artist match');

(function () {
  assert(guessGenre({ artist: 'Eminem' })      === 'Hip-Hop',      "Eminem → 'Hip-Hop'");
  assert(guessGenre({ artist: 'Daft Punk' })   === 'Electronic',   "Daft Punk → 'Electronic'");
  assert(guessGenre({ artist: 'Booba' })       === 'Rap Français', "Booba → 'Rap Français'");
  assert(guessGenre({ artist: 'Radiohead' })   === 'Rock',         "Radiohead → 'Rock'");
  assert(guessGenre({ artist: 'Marvin Gaye' }) === 'Soul',         "Marvin Gaye → 'Soul'");
}());

// =============================================================================
// 2. guessGenre — correspondance partielle artiste (~3 assertions)
// =============================================================================
section('tags.js -- guessGenre partial artist match');

(function () {
  // "Drake feat. Lil Wayne" → 'drake' est dans GENRE_ARTISTS
  assert(guessGenre({ artist: 'Drake feat. Lil Wayne' }) === 'Hip-Hop',    "Drake feat. Lil Wayne → 'Hip-Hop'");
  // "Daft Punk vs Skrillex" → 'skrillex' ou 'daft punk' détecté → Electronic
  assert(guessGenre({ artist: 'Daft Punk vs Skrillex' }) === 'Electronic', "Daft Punk vs Skrillex → 'Electronic'");
  // 'x' — trop court (length ≤ 3), aucun match artiste ni keyword → null
  assert(guessGenre({ artist: 'x' }) === null,                             "artiste 'x' trop court → null");
}());

// =============================================================================
// 3. guessGenre — inférence par mots-clés titre/album (~6 assertions)
// =============================================================================
section('tags.js -- guessGenre keyword inference');

(function () {
  assert(
    guessGenre({ name: 'Trap Queen Remix', artist: 'Unknown' }) === 'Hip-Hop',
    "name:'Trap Queen Remix' → 'Hip-Hop' (mot-clé trap, poids 2)"
  );
  assert(
    guessGenre({ name: 'Blue Danube Symphony No.1', artist: 'Unknown' }) === 'Classique',
    "name:'...Symphony...' → 'Classique'"
  );
  assert(
    guessGenre({ name: 'Reggae Night', album: 'Dancehall Kings' }) === 'Reggae',
    "name:'Reggae Night' → 'Reggae'"
  );
  assert(
    guessGenre({ name: 'Jazz Bebop Session', artist: 'Unknown' }) === 'Jazz',
    "name:'Jazz Bebop Session' → 'Jazz'"
  );
  assert(
    guessGenre({ name: 'Electronic Techno Mix', artist: 'Unknown' }) === 'Electronic',
    "name:'Electronic Techno Mix' → 'Electronic'"
  );
  assert(
    guessGenre({ name: 'Rock Anthem', album: 'Metal Hearts' }) === 'Rock',
    "name:'Rock Anthem' album:'Metal Hearts' → 'Rock'"
  );
}());

// =============================================================================
// 4. guessGenre — fallback null (~3 assertions)
// =============================================================================
section('tags.js -- guessGenre fallback null');

(function () {
  assert(guessGenre({ artist: '', name: '', album: '' }) === null, "champs vides → null");
  assert(guessGenre({})                                  === null, "objet vide → null");
  assert(guessGenre({ artist: 'Xyz123', name: 'Abc' })   === null, "artiste/titre inconnus → null");
}());

// =============================================================================
// 5. GENRE_ARTISTS integrity (~4 assertions)
// =============================================================================
section('tags.js -- GENRE_ARTISTS integrity');

(function () {
  assert(GENRE_ARTISTS instanceof Map,          'GENRE_ARTISTS est une Map');
  assert(GENRE_ARTISTS.size > 100,              'GENRE_ARTISTS.size > 100');
  assert(GENRE_ARTISTS.get('eminem') === 'Hip-Hop',      "get('eminem') === 'Hip-Hop'");
  assert(GENRE_ARTISTS.get('pnl')    === 'Rap Français', "get('pnl') === 'Rap Français'");
}());

// =============================================================================
// 6. GENRE_KEYWORDS integrity (~3 assertions)
// =============================================================================
section('tags.js -- GENRE_KEYWORDS integrity');

(function () {
  assert(Array.isArray(GENRE_KEYWORDS), 'GENRE_KEYWORDS est un Array');
  assert(GENRE_KEYWORDS.length > 10,   'GENRE_KEYWORDS.length > 10');
  assert(
    GENRE_KEYWORDS.every(([re, g, w]) => re instanceof RegExp && typeof g === 'string' && typeof w === 'number'),
    'chaque entrée est [RegExp, string, number]'
  );
}());

// -- Résultat -----------------------------------------------------------------
console.log('\n' + '-'.repeat(54));
console.log('  Total : ' + (_pass + _fail) + '   OK: ' + _pass + '   KO: ' + _fail);
if (_fail > 0) { process.exit(1); }
```

- [ ] **Step 2: Run the file and verify it passes**

```powershell
node frontend/tests/tags.test.cjs
```

Expected final line:
```
  Total : 24   OK: 24   KO: 0
```

All 24 assertions must show `[OK]`.

- [ ] **Step 3: Commit**

```powershell
git add frontend/tests/tags.test.cjs
git commit -m "test: add tags.test.cjs — 24 assertions (guessGenre, GENRE_ARTISTS, GENRE_KEYWORDS)"
```

---

## Task 4: `run-all.cjs` + update npm test script

**Files:**
- Create: `frontend/tests/run-all.cjs`
- Modify: `package.json` (test script)

- [ ] **Step 1: Create `run-all.cjs`**

Create `frontend/tests/run-all.cjs` with this exact content:

```js
/**
 * run-all.cjs -- Orchestrateur de tests LibreFlow
 * Execution : node frontend/tests/run-all.cjs
 * Lance chaque fichier de test via execSync, parse les lignes "Total :",
 * affiche un récap et sort avec code 1 si des KO sont présents.
 */
'use strict';

const { execSync } = require('child_process');
const path         = require('path');

const files = ['core.test.cjs', 'search.test.cjs', 'tags.test.cjs'];

let grandTotal = 0, grandOK = 0, grandKO = 0;

for (const file of files) {
  const filePath = path.join(__dirname, file);
  let output = '';
  try {
    output = execSync('node ' + filePath, { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    // execSync throws when exit code !== 0; stdout still carries test output
    output = (e.stdout || '') + (e.stderr || '');
  }

  // Parse "  Total : N   OK: N   KO: N"
  const m = output.match(/Total\s*:\s*(\d+)\s+OK:\s*(\d+)\s+KO:\s*(\d+)/);
  if (m) {
    const t = parseInt(m[1], 10), ok = parseInt(m[2], 10), ko = parseInt(m[3], 10);
    grandTotal += t; grandOK += ok; grandKO += ko;
    const pad = ' '.repeat(Math.max(0, 20 - file.length));
    console.log('[' + file + ']' + pad + 'Total: ' + t + '   OK: ' + ok + '   KO: ' + ko);
  } else {
    console.log('[' + file + ']  ERROR: output inattendu — Total : ligne introuvable');
    grandKO++;
  }
}

console.log('\n=== GRAND TOTAL: ' + grandTotal + '   OK: ' + grandOK + '   KO: ' + grandKO + ' ===');
if (grandKO > 0) process.exit(1);
```

- [ ] **Step 2: Update `package.json` test script**

In `package.json`, change the `"test"` script from:

```json
"test": "node frontend/tests/core.test.cjs"
```

to:

```json
"test": "node frontend/tests/run-all.cjs"
```

- [ ] **Step 3: Run the full suite and verify**

```powershell
node frontend/tests/run-all.cjs
```

Expected output:
```
[core.test.cjs]     Total: 131   OK: 131   KO: 0
[search.test.cjs]   Total: 52    OK: 52    KO: 0
[tags.test.cjs]     Total: 24    OK: 24    KO: 0

=== GRAND TOTAL: 207   OK: 207   KO: 0 ===
```

Also verify the npm script works:

```powershell
npm test
```

Expected: same output as above, exit code 0.

- [ ] **Step 4: Commit**

```powershell
git add frontend/tests/run-all.cjs package.json
git commit -m "test: add run-all.cjs orchestrator + update npm test script to 207 assertions"
```

---

## Assertion count summary

| File | Groups | Assertions |
|---|---|---|
| `core.test.cjs` | unchanged | 131 |
| `search.test.cjs` | 6 (normalizeGenre, trackIdxMap, fuzzyScore, sort, filters, query) | 52 |
| `tags.test.cjs` | 6 (exact artist, partial artist, keywords, null fallback, GENRE_ARTISTS, GENRE_KEYWORDS) | 24 |
| **Grand total** | | **207** |
