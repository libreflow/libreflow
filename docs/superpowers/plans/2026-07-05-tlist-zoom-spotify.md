# Track List Zoom — Spotify-Quality Density — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make libreflow's track-list density feature (Ctrl+scroll / Settings › "Densité de la liste") match Spotify's actual desktop UX: album art visibly scales with density, the three levels are named/defaulted the way Spotify does it (Compact / Comfortable / Spacious, Comfortable default), and any density change shows a brief accessible HUD.

**Architecture:** Two CSS custom properties (`--tr-h`, new `--tart-size`) both driven by the same `[data-tlist-zoom="…"]` attribute already set by `tlistZoom.js`, so row height and artwork size scale together per level. `tlistZoom.js` stays the single JS source of truth (`TLIST_ZOOM_ROW_H`) and gains a legacy-value migration map, a `silent` boot option, and the HUD trigger — all funneled through the existing single `setTlistZoom()` call site.

**Tech Stack:** Vanilla CSS custom properties + attribute selectors (`design-system.css`, `style.css`), vanilla ESM JS (`tlistZoom.js`), `assert`-based Node tests (`frontend/tests/core.test.cjs`).

## Global Constraints (from the spec, `docs/superpowers/specs/2026-07-05-tlist-zoom-spotify-design.md`)

- Compact row height is fixed at 44px — the WCAG 2.5.8 floor (`.tr { min-height: 44px }`). No level may render below it.
- Font sizes do not change between density levels — only row height and artwork size.
- `--art-list` (56px, the artwork grid column) stays fixed at every level; artwork is centered inside it via the existing `.tart { justify-self: center }` rule.
- New tokens (`--tart-size` + its per-level overrides) go in `design-system.css` only, following the existing `[data-tlist-zoom="…"]`/`[data-theme="…"]` attribute-override pattern already in that file — never a new `:root{}` block in `style.css`/`style-polish.css`.
- Every `'normal'` fallback string in the codebase becomes `'comfortable'` (the new default); every raw `'comfortable'` string that meant the *old* top level becomes `'spacious'`.
- No `console.log`, no network calls, no unrelated refactors.

---

### Task 1: CSS density tokens — row height + artwork scale together

**Files:**
- Modify: `frontend/src/design-system.css:577` (base tokens)
- Modify: `frontend/src/design-system.css:1108-1122` (per-level overrides)
- Modify: `frontend/src/style.css:1246-1256` (`.tart` consumes the new token)
- Test: `frontend/tests/core.test.cjs` (new section, appended after the existing `tlistZoom.js -- _nextZoomLevel cycling` section at line 1424)

**Interfaces:**
- Produces: CSS custom property `--tart-size` (default `40px`), consumed by `.tart`. Per-level values: compact `32px` / comfortable (default, no override needed) `40px` / spacious `56px`. `--tr-h` per-level values: compact `44px` (unchanged) / comfortable (base) `56px` (was `48px`) / spacious `72px` (was `60px`, under the old `[data-tlist-zoom="comfortable"]` selector — renamed).
- Consumes: nothing new — `--art-list`, `--r`, `--icon-36` (unrelated tart siblings) stay as-is.

- [ ] **Step 1: Write the failing test**

Add this new section at the end of `frontend/tests/core.test.cjs` (after line 1424, the closing `}());` of the existing `tlistZoom.js -- _nextZoomLevel cycling` block):

```js
// =============================================================================
// tlistZoom — --tr-h / --tart-size CSS tokens (design-system.css)
// =============================================================================
section('tlistZoom.js -- --tr-h / --tart-size tokens (design-system.css)');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const css  = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

  assert(/--tr-h:\s*56px/.test(css), 'base --tr-h (comfortable/default) = 56px');
  assert(/--tart-size:\s*40px/.test(css), 'base --tart-size (comfortable/default) = 40px');
  assert(
    /:root\[data-tlist-zoom="compact"\]\s*\{\s*--tr-h:\s*44px;\s*--tart-size:\s*32px;\s*\}/.test(css),
    'compact overrides --tr-h:44px and --tart-size:32px together'
  );
  assert(
    /:root\[data-tlist-zoom="spacious"\]\s*\{\s*--tr-h:\s*72px;\s*--tart-size:\s*56px;\s*\}/.test(css),
    'spacious overrides --tr-h:72px and --tart-size:56px together'
  );
  assert(
    !/data-tlist-zoom="comfortable"/.test(css),
    'no leftover [data-tlist-zoom="comfortable"] selector (renamed to spacious/removed)'
  );
}());
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A2 "tr-h / --tart-size"`
Expected: FAIL — none of the new tokens exist yet in `design-system.css`.

- [ ] **Step 3: Update the base tokens**

In `frontend/src/design-system.css`, replace line 577:

```css
  --tr-h:          48px;   /* hauteur d'une ligne piste — pilotée par data-tlist-zoom */
```

with:

```css
  --tr-h:          56px;   /* hauteur d'une ligne piste (défaut = Comfortable) — pilotée par data-tlist-zoom */
  --tart-size:     40px;   /* taille pochette .tart (défaut = Comfortable) — pilotée par data-tlist-zoom */
```

- [ ] **Step 4: Rename + extend the per-level overrides**

Replace the block at `frontend/src/design-system.css:1121-1122`:

```css
:root[data-tlist-zoom="compact"]     { --tr-h: 44px; }
:root[data-tlist-zoom="comfortable"] { --tr-h: 60px; }
```

with:

```css
:root[data-tlist-zoom="compact"]  { --tr-h: 44px; --tart-size: 32px; }
:root[data-tlist-zoom="spacious"] { --tr-h: 72px; --tart-size: 56px; }
```

(Comment block directly above these two lines, lines 1108-1120, stays as-is — it already explains the CSS/JS sync rationale and still applies.)

- [ ] **Step 5: Make `.tart` consume `--tart-size`**

In `frontend/src/style.css`, replace lines 1246-1256:

```css
.tart {
  width: var(--icon-36); height: var(--icon-36); border-radius: var(--r);
  background: var(--bg4);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0; position: relative;
  /* .tart (36px) < colonne art de .tr (var(--art-list), 56px) : une grid-item avec
     une largeur explicite n'est PAS étirée par le "stretch" par défaut, elle se
     cale au bord de départ de la colonne — d'où la pochette collée à gauche au
     lieu d'être centrée dans sa colonne (visible surtout au survol). */
  justify-self: center;
}
```

with:

```css
.tart {
  width: var(--tart-size); height: var(--tart-size); border-radius: var(--r);
  background: var(--bg4);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0; position: relative;
  /* .tart (var(--tart-size), 32-56px selon densité) < colonne art de .tr
     (var(--art-list), 56px fixe à tout niveau) : une grid-item avec une largeur
     explicite n'est PAS étirée par le "stretch" par défaut, elle se cale au bord
     de départ de la colonne — d'où la pochette collée à gauche au lieu d'être
     centrée dans sa colonne (visible surtout au survol). */
  justify-self: center;
  /* --tart-size grandit/rétrécit avec la densité (tlistZoom.js) — transition
     douce plutôt qu'un saut brutal quand l'utilisateur change de niveau. */
  transition: width var(--dur-mid) var(--smooth), height var(--dur-mid) var(--smooth);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A2 "tr-h / --tart-size"`
Expected: PASS (all 5 assertions)

- [ ] **Step 7: Run the full suite to check nothing else broke**

Run: `npm test 2>&1 | tail -5`
Expected: `Total : 1434   OK: 1434   KO: 0` (1429 previous + 5 new — exact count may differ slightly if other sections were added since; the key signal is `KO: 0`)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/design-system.css frontend/src/style.css frontend/tests/core.test.cjs
git commit -m "feat(ui): tlist zoom — artwork scales with density (--tart-size token)"
```

---

### Task 2: `#zoom-hud` visual style

**Files:**
- Modify: `frontend/src/style.css` (insert after line 3839, the last line of the `.tlist-zoom-radio` block, before `.theme-swatches` at line 3841)
- Test: `frontend/tests/core.test.cjs` (new section, appended after Task 1's new section)

**Interfaces:**
- Produces: CSS class `#zoom-hud.show` (JS in Task 3 toggles this class); the element itself (`<div id="zoom-hud" role="status" aria-live="polite" aria-atomic="true">`, `frontend/index.html:1583`) already exists and needs no HTML change.
- Consumes: `--tb` (38px, titlebar height), `--bg3`, `--t`, `--sep`, `--sp-1p`, `--sp-3`, `--r-pill`, `--fs-xs`, `--ls-caps`, `--shadow-lg`, `--z-toast`, `--dur-fast` — all pre-existing design-system.css tokens (verified present).

- [ ] **Step 1: Write the failing test**

Add after Task 1's test section in `frontend/tests/core.test.cjs`:

```js
// =============================================================================
// tlistZoom — #zoom-hud CSS wired (style.css)
// =============================================================================
section('tlistZoom.js -- #zoom-hud CSS (style.css)');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const css  = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

  assert(/#zoom-hud\s*\{/.test(css), '#zoom-hud has a base rule');
  assert(/#zoom-hud\.show\s*\{/.test(css), '#zoom-hud.show has a rule');
  assert(/#zoom-hud\s*\{[^}]*opacity:\s*0;/.test(css), '#zoom-hud is hidden (opacity:0) by default');
  assert(/#zoom-hud\.show\s*\{[^}]*opacity:\s*1;/.test(css), '#zoom-hud.show is visible (opacity:1)');
  assert(
    /html\[data-motion="reduce"\]\s*#zoom-hud\s*\{/.test(css),
    '#zoom-hud has a data-motion="reduce" override'
  );
}());
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A5 "zoom-hud CSS"`
Expected: FAIL — no `#zoom-hud` rule exists yet.

- [ ] **Step 3: Add the CSS**

In `frontend/src/style.css`, insert this new block immediately after line 3839
(`.tlist-zoom-radio input[type="radio"]:active + span { transform: scale(.97); }`)
and before the blank line + `.theme-swatches` rule:

```css

/* ── HUD feedback zoom liste de pistes ────────────────────
   #zoom-hud (index.html) existe déjà en markup (role=status,
   aria-live=polite) — ce bloc lui donne enfin un style. Affiché
   brièvement par tlistZoom.js à chaque changement de densité. */
#zoom-hud {
  position: fixed; top: calc(var(--tb) + 12px); left: 50%;
  transform: translateX(-50%) translateY(-6px);
  background: var(--bg3); color: var(--t); border: var(--border-w-sm) solid var(--sep);
  padding: var(--sp-1p) var(--sp-3); border-radius: var(--r-pill);
  font-size: var(--fs-xs); font-weight: 600; letter-spacing: var(--ls-caps);
  text-transform: uppercase; box-shadow: var(--shadow-lg);
  opacity: 0; pointer-events: none; z-index: var(--z-toast);
  transition: opacity var(--dur-fast) ease, transform var(--dur-fast) ease;
}
#zoom-hud.show { opacity: 1; transform: translateX(-50%) translateY(0); }
html[data-motion="reduce"] #zoom-hud { transition: opacity var(--dur-fast) ease; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A5 "zoom-hud CSS"`
Expected: PASS (all 5 assertions)

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `KO: 0`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/style.css frontend/tests/core.test.cjs
git commit -m "feat(ui): style #zoom-hud (previously unstyled, unwired markup)"
```

---

### Task 3: `tlistZoom.js` — rename levels, legacy migration, silent boot, HUD wiring

**Files:**
- Modify: `frontend/src/tlistZoom.js` (whole file — shown in full below)
- Test: `frontend/tests/core.test.cjs:1406-1424` (replace the existing `tlistZoom.js -- _nextZoomLevel cycling` section; append two new sections after it)

**Interfaces:**
- Consumes: `#zoom-hud` element + `.show` class (Task 2), `i18n(key)` from `./i18n.js` (new import — verified: no circular dependency, `i18n.js` does not import `tlistZoom.js`), `VIRT` from `./virt.js` (unchanged), `set`/`get` from `./store.js` (unchanged), `emit`/`EVENTS` from `./bus.js` (unchanged), `saveCfg` from `./cfgsave.js` (unchanged).
- Produces: `TLIST_ZOOM_LEVELS = ['compact', 'comfortable', 'spacious']`; `TLIST_ZOOM_ROW_H = { compact: 44, comfortable: 56, spacious: 72 }`; `setTlistZoom(level, { silent = false } = {})` (new second parameter, default unchanged call sites still work); `tlistZoomIn()`/`tlistZoomOut()`/`tlistZoomReset()`/`_nextZoomLevel()`/`initTlistZoomWheel()` — same names/signatures as before, only internal `'normal'`/`'comfortable'` string literals change meaning.

- [ ] **Step 1: Write the failing tests**

Replace the existing section in `frontend/tests/core.test.cjs` (lines 1403-1424 — from the `// tlistZoom — logique pure de cycling` comment through the closing `}());`) with:

```js
// =============================================================================
// tlistZoom — logique pure de cycling (_nextZoomLevel)
// =============================================================================
section('tlistZoom.js -- _nextZoomLevel cycling');

(function () {
  // Reproduit la logique pure inline (pas d'import ESM)
  const TLIST_ZOOM_LEVELS = ['compact', 'comfortable', 'spacious'];
  function _nextZoomLevel(current, dir) {
    const idx = TLIST_ZOOM_LEVELS.indexOf(current);
    if (idx === -1) return 'comfortable';
    if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
    if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
    return current;
  }

  assert(_nextZoomLevel('compact',     'in')  === 'comfortable', 'zoomIn depuis compact → comfortable');
  assert(_nextZoomLevel('comfortable', 'in')  === 'spacious',    'zoomIn depuis comfortable → spacious');
  assert(_nextZoomLevel('spacious',    'in')  === 'spacious',    'zoomIn depuis spacious → reste spacious');
  assert(_nextZoomLevel('spacious',    'out') === 'comfortable', 'zoomOut depuis spacious → comfortable');
  assert(_nextZoomLevel('compact',     'out') === 'compact',     'zoomOut depuis compact → reste compact');
  assert(_nextZoomLevel('comfortable', 'out') === 'compact',     'zoomReset depuis comfortable → compact via zoomOut');
}());

// =============================================================================
// tlistZoom — migration des anciens noms de niveaux (_LEGACY_ZOOM_MAP)
// =============================================================================
section('tlistZoom.js -- legacy level name migration');

(function () {
  // Reproduit la logique pure inline (pas d'import ESM) — même map que tlistZoom.js
  const _LEGACY_ZOOM_MAP = { normal: 'comfortable', comfortable: 'spacious' };
  function migrate(level) { return _LEGACY_ZOOM_MAP[level] || level; }

  assert(migrate('normal')      === 'comfortable', "ancien 'normal' → nouveau 'comfortable'");
  assert(migrate('comfortable') === 'spacious',    "ancien 'comfortable' → nouveau 'spacious'");
  assert(migrate('compact')     === 'compact',     "'compact' inchangé (jamais renommé)");
  assert(migrate('spacious')    === 'spacious',    "'spacious' (déjà nouveau) inchangé — pas de double mapping");
}());

// =============================================================================
// tlistZoom — TLIST_ZOOM_ROW_H reste synchro avec --tr-h (design-system.css)
// =============================================================================
section('tlistZoom.js -- TLIST_ZOOM_ROW_H matches CSS --tr-h per level');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const jsSrc  = fs.readFileSync(path.join(__dirname, '../src/tlistZoom.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

  const rowHBlock = /TLIST_ZOOM_ROW_H = \{([^}]*)\}/.exec(jsSrc);
  assert(rowHBlock, 'TLIST_ZOOM_ROW_H object literal found in tlistZoom.js');
  const rowH = {};
  const kv = /(\w+):\s*(\d+)/g;
  let m;
  while ((m = kv.exec(rowHBlock[1]))) rowH[m[1]] = Number(m[2]);

  assert.strictEqual(rowH.compact,     44, 'TLIST_ZOOM_ROW_H.compact === 44');
  assert.strictEqual(rowH.comfortable, 56, 'TLIST_ZOOM_ROW_H.comfortable === 56');
  assert.strictEqual(rowH.spacious,    72, 'TLIST_ZOOM_ROW_H.spacious === 72');

  // Regression guard for the exact CSS/JS desync bug fixed earlier this session:
  // VIRT.ROW_H (this object) must always equal the real rendered --tr-h.
  const baseTrH     = Number(/--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  const compactTrH  = Number(/data-tlist-zoom="compact"\]\s*\{\s*--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  const spaciousTrH = Number(/data-tlist-zoom="spacious"\]\s*\{\s*--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  assert.strictEqual(rowH.comfortable, baseTrH,     'VIRT.ROW_H.comfortable matches CSS base --tr-h');
  assert.strictEqual(rowH.compact,     compactTrH,  'VIRT.ROW_H.compact matches CSS --tr-h override');
  assert.strictEqual(rowH.spacious,    spaciousTrH, 'VIRT.ROW_H.spacious matches CSS --tr-h override');
}());
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A6 "cycling\|legacy level\|TLIST_ZOOM_ROW_H matches"`
Expected: FAIL on all three new/changed sections — `tlistZoom.js` still has the old level names and no `TLIST_ZOOM_ROW_H` values of 44/56/72 yet.

- [ ] **Step 3: Rewrite `tlistZoom.js`**

Replace the entire file `frontend/src/tlistZoom.js` with:

```js
// @ts-check
/** @import { ZoomLevel } from './types.js' */
// LibreFlow — tlistZoom.js
// Zoom de la liste de pistes : Compact / Comfortable / Spacious (proportions Spotify).
// Source de vérité unique : cfg.tlistZoom.
//
// API publique :
//   setTlistZoom(level, opts) — applique un niveau (data-attr + VIRT.ROW_H + cfg + re-render + HUD)
//   tlistZoomIn()         — niveau suivant (plus grand) si possible
//   tlistZoomOut()        — niveau précédent (plus petit) si possible
//   tlistZoomReset()      — retour à 'comfortable'
//   _nextZoomLevel(cur, dir) — logique pure de cycling (testable sans DOM)
//   TLIST_ZOOM_LEVELS     — ['compact','comfortable','spacious']
//   TLIST_ZOOM_ROW_H      — {compact:44, comfortable:56, spacious:72} — DOIT rester
//                           synchro avec --tr-h sous [data-tlist-zoom] (design-system.css) :
//                           VIRT.ROW_H (le pas du virtual scroll) doit toujours correspondre
//                           à la hauteur RÉELLEMENT rendue par .tr, sous peine de désynchroniser
//                           le rendu de la position de scroll (lignes tronquées, cf. historique).

import { VIRT }            from './virt.js';
import { set, get }        from './store.js';
import { emit, EVENTS }    from './bus.js';
import { saveCfg }         from './cfgsave.js';
import { i18n }            from './i18n.js';

export const TLIST_ZOOM_LEVELS = ['compact', 'comfortable', 'spacious'];

// comfortable = 56 / spacious = 72 (proportions Spotify — art scale en même temps,
// voir --tart-size dans design-system.css). compact = 44 (pas moins) : plancher
// WCAG 2.5.8 partagé avec .tr { min-height: 44px }.
export const TLIST_ZOOM_ROW_H = {
  compact:     44,
  comfortable: 56,
  spacious:    72,
};

// Anciens noms de niveaux (avant le renommage Spotify) → nouveaux noms.
// Remappe une seule fois, à l'entrée de setTlistZoom() — pas de double mapping :
// 'comfortable' (déjà un nom valide aujourd'hui, = spacious) ne repasse pas dans
// la map une deuxième fois puisque le lookup n'est fait qu'une fois par appel.
const _LEGACY_ZOOM_MAP = { normal: 'comfortable', comfortable: 'spacious' };

/**
 * Logique pure de cycling (sans effet de bord — testable unitairement).
 * @param {ZoomLevel} current  niveau actuel
 * @param {'in'|'out'} dir     direction
 * @returns {ZoomLevel} niveau résultant (identique si déjà à la limite)
 */
export function _nextZoomLevel(current, dir) {
  const idx = TLIST_ZOOM_LEVELS.indexOf(current);
  if (idx === -1) return 'comfortable';
  if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
  if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
  return current;
}

// ── HUD feedback (#zoom-hud, index.html) ─────────────────────────────────────
let _hudTimer = null;

/** Affiche brièvement le nom du niveau dans #zoom-hud, puis le masque après 1.2s. */
function _showZoomHud(level) {
  const hud = document.getElementById('zoom-hud');
  if (!hud) return;
  hud.textContent = i18n(`tlist_zoom_${level}`) || level;
  hud.classList.add('show');
  clearTimeout(_hudTimer);
  _hudTimer = setTimeout(() => hud.classList.remove('show'), 1200);
}

/**
 * Applique un niveau de zoom à la liste de pistes.
 * Synchronise : attribut data-tlist-zoom → CSS, VIRT.ROW_H, store, cfg, re-render, HUD.
 * @param {ZoomLevel} level  'compact' | 'comfortable' | 'spacious' (ou un ancien nom,
 *   remappé automatiquement via _LEGACY_ZOOM_MAP)
 * @param {{ silent?: boolean }} [opts] — silent:true = pas de HUD (boot initial)
 * @returns {void}
 */
export function setTlistZoom(level, { silent = false } = {}) {
  level = _LEGACY_ZOOM_MAP[level] || level;

  if (!TLIST_ZOOM_LEVELS.includes(level)) {
    console.warn('[tlistZoom] niveau inconnu ignoré:', level);
    return;
  }

  // 1. Mettre à jour l'attribut CSS sur <html>
  document.documentElement.dataset.tlistZoom = level;

  // 2. Mettre à jour la hauteur de ligne runtime du virtual scroll
  VIRT.ROW_H = TLIST_ZOOM_ROW_H[level];

  // 3. Invalider les caches de signature du virtual scroll
  VIRT._lastListSig   = '';
  VIRT._lastWindowSig = '';

  // 4. Persister dans le store et dans IDB (debounced)
  set('tlistZoom', level);
  saveCfg();

  // 5. Feedback visuel — pas au boot (silent:true), seulement sur action utilisateur
  if (!silent) _showZoomHud(level);

  // 6. Forcer un re-render de la liste
  // R1-A FIX : ne pas émettre au boot quand tracks[] est encore vide — évite
  // l'écran "liste vide" de 300-600 ms causé par le RENDER_LIB prématuré.
  if (get('tracks')?.length) emit(EVENTS.RENDER_LIB, {});
}

/** Passe au niveau plus grand si possible (compact → comfortable → spacious). */
export function tlistZoomIn() {
  const cur = get('tlistZoom') || 'comfortable';
  setTlistZoom(_nextZoomLevel(cur, 'in'));
}

/** Passe au niveau plus petit si possible (spacious → comfortable → compact). */
export function tlistZoomOut() {
  const cur = get('tlistZoom') || 'comfortable';
  setTlistZoom(_nextZoomLevel(cur, 'out'));
}

/** Remet la densité à 'comfortable'. */
export function tlistZoomReset() {
  setTlistZoom('comfortable');
}

// ── Ctrl + Molette ──────────────────────────────────────────────────────────
// Throttle pour ne déclencher qu'un seul cran de zoom par « geste molette »
// (les trackpads/molettes envoient de nombreux événements en rafale).
const _WHEEL_THROTTLE_MS = 150;
let   _wheelLastAt       = 0;

/**
 * Câble le zoom via Ctrl/Cmd + molette sur le conteneur de la liste de pistes.
 * À appeler une seule fois au boot (idempotent : ne ré-attache pas si déjà fait).
 */
export function initTlistZoomWheel() {
  const tlist = document.getElementById('tlist');
  if (!tlist) { console.warn('[tlistZoom] #tlist introuvable — wheel zoom non câblé'); return; }
  if (tlist._tlistZoomWheelBound) return;     // idempotence
  tlist._tlistZoomWheelBound = true;

  tlist.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;    // requiert Ctrl (ou Cmd sur macOS)
    e.preventDefault();                       // bloque le zoom navigateur
    const now = Date.now();
    if (now - _wheelLastAt < _WHEEL_THROTTLE_MS) return;
    _wheelLastAt = now;
    if (e.deltaY < 0)      tlistZoomIn();     // scroll vers le haut → plus grand
    else if (e.deltaY > 0) tlistZoomOut();    // scroll vers le bas → plus petit
  }, { passive: false });
}
```

- [ ] **Step 4: Update the boot call site to pass `silent: true`**

In `frontend/src/app.js`, replace line 438:

```js
  setTlistZoom((cfg && cfg.tlistZoom) || 'normal');
```

with:

```js
  setTlistZoom((cfg && cfg.tlistZoom) || 'comfortable', { silent: true });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A6 "cycling\|legacy level\|TLIST_ZOOM_ROW_H matches"`
Expected: PASS on all three sections.

- [ ] **Step 6: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `KO: 0`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/tlistZoom.js frontend/src/app.js frontend/tests/core.test.cjs
git commit -m "feat(ui): tlist zoom -- rename levels to Compact/Comfortable/Spacious, legacy migration, HUD wiring"
```

---

### Task 4: Rename surface — i18n labels, Settings HTML, remaining fallbacks, typedef

**Files:**
- Modify: `frontend/src/i18n.fr.js:334-335`
- Modify: `frontend/src/i18n.en.js:334-335`
- Modify: `frontend/index.html:873-880`
- Modify: `frontend/src/cfgsave.js:104`
- Modify: `frontend/src/settings.js:345`
- Modify: `frontend/src/types.js:170`
- Test: manual + existing automated suite (no new assertions — these are label/typedef/fallback-string changes with no independent runtime behavior to unit-test beyond what Task 3's tests already cover; i18n key presence is exercised indirectly by existing i18n tests, see Step 4)

**Interfaces:**
- Consumes: `TLIST_ZOOM_LEVELS`/`setTlistZoom` (Task 3, unchanged signatures).
- Produces: i18n keys `tlist_zoom_comfortable` (renamed from `tlist_zoom_normal`, same French/English text) and new `tlist_zoom_spacious`; these are read by `_showZoomHud()` (Task 3) and by `index.html`'s `data-i18n` attributes.

- [ ] **Step 1: Rename/add i18n keys — French**

In `frontend/src/i18n.fr.js`, replace lines 334-335:

```js
  tlist_zoom_normal:      'Normal',
  tlist_zoom_comfortable: 'Confortable',
```

with:

```js
  tlist_zoom_comfortable: 'Confortable',
  tlist_zoom_spacious:    'Spacieux',
```

- [ ] **Step 2: Rename/add i18n keys — English**

In `frontend/src/i18n.en.js`, replace lines 334-335:

```js
  tlist_zoom_normal:      'Normal',
  tlist_zoom_comfortable: 'Comfortable',
```

with:

```js
  tlist_zoom_comfortable: 'Comfortable',
  tlist_zoom_spacious:    'Spacious',
```

- [ ] **Step 3: Update the Settings radio group**

In `frontend/index.html`, replace lines 873-880:

```html
            <label class="tlist-zoom-radio">
              <input type="radio" name="tlist-zoom" value="normal" data-action="tlist-zoom" checked>
              <span data-i18n="tlist_zoom_normal">Normal</span>
            </label>
            <label class="tlist-zoom-radio">
              <input type="radio" name="tlist-zoom" value="comfortable" data-action="tlist-zoom">
              <span data-i18n="tlist_zoom_comfortable">Confortable</span>
            </label>
```

with:

```html
            <label class="tlist-zoom-radio">
              <input type="radio" name="tlist-zoom" value="comfortable" data-action="tlist-zoom" checked>
              <span data-i18n="tlist_zoom_comfortable">Confortable</span>
            </label>
            <label class="tlist-zoom-radio">
              <input type="radio" name="tlist-zoom" value="spacious" data-action="tlist-zoom">
              <span data-i18n="tlist_zoom_spacious">Spacieux</span>
            </label>
```

(The `compact` `<label>` immediately above, lines 869-872, is unchanged — leave it as-is.)

- [ ] **Step 4: Update remaining `'normal'` fallback strings**

In `frontend/src/cfgsave.js`, replace line 104:

```js
    const tlistZoom      = get('tlistZoom') || 'normal';            // zoom liste pistes
```

with:

```js
    const tlistZoom      = get('tlistZoom') || 'comfortable';       // zoom liste pistes
```

In `frontend/src/settings.js`, replace line 345:

```js
  const cur = get('tlistZoom') || 'normal';
```

with:

```js
  const cur = get('tlistZoom') || 'comfortable';
```

- [ ] **Step 5: Update the `ZoomLevel` typedef**

In `frontend/src/types.js`, replace line 170:

```js
 * @typedef {'compact'|'normal'|'comfortable'} ZoomLevel
```

with:

```js
 * @typedef {'compact'|'comfortable'|'spacious'} ZoomLevel
```

- [ ] **Step 6: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `KO: 0` — no test asserts on the old `tlist_zoom_normal` key or `'normal'` fallback strings (verified by reading `core.test.cjs`'s i18n-related sections before this change), so nothing should break.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/i18n.fr.js frontend/src/i18n.en.js frontend/index.html frontend/src/cfgsave.js frontend/src/settings.js frontend/src/types.js
git commit -m "feat(ui): tlist zoom -- rename Normal/Comfortable to Comfortable/Spacious across UI, i18n, fallbacks"
```

---

### Task 5: Dead-code cleanup — unused `CFG.VIRT_ROW_H_*` constants

**Files:**
- Modify: `frontend/src/cfg.js:19-22`

**Interfaces:**
- Consumes: none.
- Produces: none — pure removal. `TLIST_ZOOM_ROW_H` in `tlistZoom.js` (Task 3) is the actual, wired-up source of truth and is untouched by this task.

- [ ] **Step 1: Confirm nothing references these constants**

Run: `grep -rn "VIRT_ROW_H_MICRO\|VIRT_ROW_H_COMPACT\|VIRT_ROW_H_COMFORTABLE\|VIRT_ROW_H_SPACIOUS" frontend/src frontend/tests`
Expected: only the 4 definition lines in `cfg.js` itself (no other file references them).

- [ ] **Step 2: Remove the dead constants**

In `frontend/src/cfg.js`, delete lines 19-22:

```js
  VIRT_ROW_H_MICRO:         28,   // px — ligne piste en zoom "micro" (tlistZoom)
  VIRT_ROW_H_COMPACT:       36,   // px — ligne piste en zoom "compact" (tlistZoom)
  VIRT_ROW_H_COMFORTABLE:   60,   // px — ligne piste en zoom "comfortable" (tlistZoom)
  VIRT_ROW_H_SPACIOUS:      76,   // px — ligne piste en zoom "spacious" (tlistZoom)
```

`CFG.VIRT_ROW_H` (line 18, the base 48px constant used elsewhere for bench/tests) stays untouched.

- [ ] **Step 3: Run the full suite**

Run: `npm test 2>&1 | tail -5`
Expected: `KO: 0` — `core.test.cjs` only asserts on `CFG.VIRT_ROW_H` (confirmed by the earlier grep in this plan's research), not the removed `_MICRO`/`_COMPACT`/`_COMFORTABLE`/`_SPACIOUS` variants.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/cfg.js
git commit -m "refactor(cfg): remove unused VIRT_ROW_H_MICRO/_COMPACT/_COMFORTABLE/_SPACIOUS constants"
```

---

### Task 6: Full verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npm test 2>&1 | tail -5`
Expected: `KO: 0`

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`

1. Fresh/never-configured install (or clear `cfg` in IndexedDB via devtools if testing on an existing profile) → list boots at Comfortable density: 56px rows, 40px art — visibly bigger than the old 48px/36px default, no HUD shown at boot.
2. Settings › Densité de la liste → click Compact → rows shrink to 44px, art visibly shrinks to 32px, no row is cut/clipped at the top or bottom of the viewport, HUD pill appears briefly reading "Compact" then fades out.
3. Click Spacious → rows grow to 72px, art grows to 56px (fills the artwork column edge-to-edge), HUD shows "Spacieux" (or "Spacious" in EN).
4. Focus the track list and Ctrl+scroll up/down → density cycles through all 3 levels, HUD confirms each change; if the Settings panel is open at the same time, its radio buttons stay in sync.
5. Maximize/fullscreen the window and scroll through a large library at each of the 3 densities → confirm no row is visually cut at the viewport edge at any density (this is the regression case from the original bug report).
6. If a config saved before this change exists (`tlistZoom: 'comfortable'` under the old naming, i.e. what used to render as the old top/biggest level) → confirm it now resolves to **Spacious** (the density it visually matched before), not silently reset to Comfortable.

- [ ] **Step 3: Report results**

If any manual check fails, stop and fix before considering this plan complete — do not commit further changes without addressing a failed smoke-test step.
