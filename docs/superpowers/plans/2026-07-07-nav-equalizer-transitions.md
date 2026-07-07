# Navigation Equalizer Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give libreflow's main-navigation transitions (sidebar, library tabs, Stats, Radio, Now Playing) a consistent, on-brand "equalizer wave" accent and a gliding sidebar active-indicator, replacing today's generic/inconsistent cross-fades.

**Architecture:** A fixed 7-bar CSS-only overlay (`#nav-eq-wipe`, anchored to `#main`) pulses in the direction of travel on every main-nav transition. Direction detection already exists for library sub-views (`setView()`'s `_NAV_ORDER`) and is extended with a second, independent "coarse" layer inside `_showViewRaw()` covering welcome/library/stats/radio/now-playing — so every nav path fires exactly one of the two layers, never both. The sidebar's `.ni.on::before` pseudo-element indicator is replaced by a single real `#ni-indicator` element repositioned via `transform`/`height` in `_svMarkNav()`, so it glides between items via CSS transition instead of popping.

**Tech Stack:** Vanilla JS (ESM), CSS custom properties + keyframe animations, existing `motion.js`/`view-transition.js`/`views.js` modules. No new dependencies.

## Global Constraints

- No `tracks[]`/`_trackIdxMap`/`virt.js` mutation — this work never touches track-list rendering (CLAUDE.md §2, §7, §10).
- No per-row/per-track animation — the equalizer overlay is a fixed 7-node element, size-independent of the library (CLAUDE.md §10, §16, `docs/superpowers/specs/2026-07-07-nav-equalizer-transitions-design.md` Non-Goals).
- No new animation duration tokens — reuse `--motion-base`/`--ease-standard`/`--ease-spring`/`--dur-nav` from `design-system.css` (spec Non-Goals).
- No GSAP for the equalizer bars — pure CSS keyframes + one class toggle (spec Non-Goals).
- `aria-hidden="true"` + `pointer-events:none` on all new decorative elements — no a11y tree/tab-order change (CLAUDE.md §2 WCAG invariant).
- Respect the 3-state reduced-motion gate (`html[data-motion="reduce"]`, already blanket-covers `animation`/`transition` at `style.css:726-730`) — plus an explicit JS-side short-circuit in the new trigger function for clarity/consistency with `motion.js` conventions.
- Functions <50 lines, files <800 lines (CLAUDE.md §16).
- No `console.log`, no external network calls (CLAUDE.md §14, §15).
- Follow existing test conventions exactly: `frontend/tests/core.test.cjs` uses `fs.readFileSync` + regex structural assertions for GSAP/DOM-coupled modules (dynamic `import()` of `views.js` is avoided — it pulls `motion.js` → `gsap`); `frontend/tests/a11y.test.cjs` uses `readRepoFile`/`findElements` from `frontend/tests/_a11y.cjs`.

---

### Task 1: Equalizer wipe overlay — markup, CSS, trigger function

**Files:**
- Modify: `frontend/index.html:170` (insert after `<div id="main" role="main">`)
- Modify: `frontend/src/style.css:1480` (insert after the `.eq-bars` reduced-motion override, before the "Bouton like" comment)
- Modify: `frontend/src/style.css:5972` (insert after the existing `navSlideIn/Out` keyframes, before the closing of that block's comment section)
- Modify: `frontend/src/view-transition.js` (add `triggerNavWipe()`)
- Test: `frontend/tests/a11y.test.cjs`
- Test: `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: `export function triggerNavWipe()` in `frontend/src/view-transition.js` — no params, no return value. Later tasks (Task 2) call this alongside `data-nav-dir` attribute changes.
- Produces: DOM contract — `#nav-eq-wipe` (7 `.wbar` children) exists in `frontend/index.html` as a direct child of `#main`, before the first `.view` div. Toggling `.wiping` on `#nav-eq-wipe` plays the wave; it self-removes after 320ms.

- [ ] **Step 1: Write the failing a11y test for the overlay markup**

`frontend/tests/a11y.test.cjs` currently imports only `readRepoFile`/`flattenAlpha` from
`./_a11y.cjs` (line 6) — `findElements` is exported by that helper module but not yet
used in this file. Change line 6 from:

```js
const { readRepoFile, flattenAlpha } = require('./_a11y.cjs');
```

to:

```js
const { readRepoFile, flattenAlpha, findElements } = require('./_a11y.cjs');
```

Then add, after the existing `.tlk.on declares a non-color cue` test block (keep it
inside the same `run()` function, same `t()` harness already in scope):

```js
  // --- Nav equalizer wipe overlay — decorative only, never in the a11y tree ---
  await t('#nav-eq-wipe is aria-hidden and has 7 .wbar children', () => {
    const els = findElements(HTML, e => e.id === 'nav-eq-wipe');
    assert.ok(els.length === 1, '#nav-eq-wipe not found in index.html');
    assert.strictEqual(els[0].attrs['aria-hidden'], 'true', '#nav-eq-wipe must be aria-hidden="true"');
    const wipeBlock = /<div id="nav-eq-wipe"[^>]*>([\s\S]*?)<\/div>/.exec(HTML);
    assert.ok(wipeBlock, '#nav-eq-wipe block not found');
    const barCount = (wipeBlock[1].match(/class="wbar"/g) || []).length;
    assert.strictEqual(barCount, 7, `#nav-eq-wipe should contain 7 .wbar spans, found ${barCount}`);
  });
  await t('#nav-eq-wipe is pointer-events:none in CSS', () => {
    const m = /#nav-eq-wipe\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '#nav-eq-wipe base rule not found in style.css');
    assert.ok(/pointer-events\s*:\s*none/.test(m[0]), '#nav-eq-wipe must set pointer-events:none');
  });
```

- [ ] **Step 2: Run the test suite to confirm it fails**

Run: `npm test`
Expected: FAIL — `#nav-eq-wipe not found in index.html` (and the CSS test fails too, rule doesn't exist yet).

- [ ] **Step 3: Add the overlay markup to index.html**

In `frontend/index.html`, immediately after line 170 (`<div id="main" role="main">`), insert:

```html
  <!-- Nav equalizer wipe — decorative accent on main-nav transitions (aria-hidden, no click) -->
  <div id="nav-eq-wipe" aria-hidden="true">
    <span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span>
  </div>
```

- [ ] **Step 4: Add the overlay + bar CSS to style.css**

In `frontend/src/style.css`, immediately after line 1480 (`html[data-motion="reduce"] .eq-bars span { animation: none; height: 8px; }`), insert:

```css

/* ── Nav equalizer wipe — reuses the .eq-bars visual language (bar width/color/
   radius) for the main-nav transition accent. One-shot pulse (eq-wipe), unlike
   .eq-bars' infinite eq-dance loop. Purely decorative — see .eq-bars above for
   the "now playing" indicator this deliberately echoes. ────────────────────── */
#nav-eq-wipe {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: flex-end; justify-content: center; gap: var(--sp-1);
  height: 20px; pointer-events: none; z-index: var(--z-sticky);
  opacity: 0;
}
#nav-eq-wipe.wiping { opacity: 1; }
.wbar {
  width: 3px; height: 4px; background: var(--g); border-radius: 1px;
  transform-origin: bottom;
}
#nav-eq-wipe.wiping .wbar { animation: eq-wipe var(--motion-base) var(--ease-standard) both; }
#nav-eq-wipe.wiping .wbar:nth-child(1) { animation-delay: 0ms;  }
#nav-eq-wipe.wiping .wbar:nth-child(2) { animation-delay: 14ms; }
#nav-eq-wipe.wiping .wbar:nth-child(3) { animation-delay: 28ms; }
#nav-eq-wipe.wiping .wbar:nth-child(4) { animation-delay: 42ms; }
#nav-eq-wipe.wiping .wbar:nth-child(5) { animation-delay: 56ms; }
#nav-eq-wipe.wiping .wbar:nth-child(6) { animation-delay: 70ms; }
#nav-eq-wipe.wiping .wbar:nth-child(7) { animation-delay: 84ms; }

@keyframes eq-wipe {
  0%   { height: 4px;  opacity: .35; }
  45%  { height: 20px; opacity: 1;   }
  100% { height: 4px;  opacity: 0;   }
}
```

Note: no explicit reduced-motion override needed here — the blanket rule at `style.css:726-730` (`html[data-motion="reduce"] *, *::before, *::after { animation-duration: .01ms !important; ... }`) already collapses `eq-wipe` to imperceptible under reduced motion. `triggerNavWipe()` (Step 6) also short-circuits in JS for defense-in-depth, matching the `motion.js` convention of an explicit JS-side gate.

- [ ] **Step 5: Add the direction-reversal rule near the existing directional slide CSS**

In `frontend/src/style.css`, find this exact block (the four keyframes that end the
directional-slide section — originally around line 5969-5972, but Step 4 above
shifted line numbers down; match on content, not line number):

```css
@keyframes navSlideOutLeft  { to   { opacity: 0; transform: translateX(calc(-1 * var(--sp-4h))); } }
@keyframes navSlideInRight  { from { opacity: 0; transform: translateX(var(--sp-4h));  } }
@keyframes navSlideOutRight { to   { opacity: 0; transform: translateX(var(--sp-4h));  } }
@keyframes navSlideInLeft   { from { opacity: 0; transform: translateX(calc(-1 * var(--sp-4h))); } }
```

Insert immediately after it:

```css

/* Nav equalizer wipe sweeps opposite direction on back-navigation — same
   data-nav-dir attribute the directional slide above already uses. */
html[data-nav-dir="back"] #nav-eq-wipe { flex-direction: row-reverse; }
```

- [ ] **Step 6: Add triggerNavWipe() to view-transition.js**

Open `frontend/src/view-transition.js` and add the following export after `runViewTransition()`:

```js
const WIPE_ID = 'nav-eq-wipe';
const WIPE_CLASS = 'wiping';
// 7 bars, max animation-delay 84ms (nth-child(7)) + eq-wipe duration (--motion-base,
// 200ms) = 284ms until the last bar finishes; 320ms leaves a safety margin so cleanup
// never truncates the animation.
const WIPE_DUR_MS = 320;

/**
 * Trigger the equalizer-wave accent on a main-nav transition. No-op under
 * reduced motion (CSS also collapses the animation, but skip the class churn).
 * Idempotent : rapid repeated calls restart the wave from a clean state.
 */
export function triggerNavWipe() {
  if (document.documentElement.dataset.motion === 'reduce') return;
  const el = document.getElementById(WIPE_ID);
  if (!el) return;
  el.classList.remove(WIPE_CLASS);
  void el.offsetWidth; // force reflow, mirrors runViewTransition()'s pattern above
  el.classList.add(WIPE_CLASS);
  setTimeout(() => el.classList.remove(WIPE_CLASS), WIPE_DUR_MS);
}
```

- [ ] **Step 7: Write the structural test for triggerNavWipe()**

Add a new section near the end of `frontend/tests/core.test.cjs`, immediately before the `// -- Résultat --` footer block:

```js
  // ===========================================================================
  // N+2. view-transition.js -- triggerNavWipe() structural checks
  // ===========================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..');
    const VT = fs.readFileSync(path.join(root, 'src/view-transition.js'), 'utf8');

    section('view-transition.js -- triggerNavWipe()');

    assert(/export function triggerNavWipe\s*\(\s*\)/.test(VT),
      'triggerNavWipe() is exported');
    assert(/dataset\.motion === 'reduce'\)\s*return;/.test(VT),
      'triggerNavWipe() short-circuits under data-motion="reduce"');
    assert(/getElementById\(WIPE_ID\)/.test(VT) || /getElementById\('nav-eq-wipe'\)/.test(VT),
      'triggerNavWipe() targets #nav-eq-wipe');
    assert(/classList\.add\(WIPE_CLASS\)/.test(VT) || /classList\.add\('wiping'\)/.test(VT),
      'triggerNavWipe() adds the wiping class');
  } catch (e) {
    console.error('  KO  view-transition.js triggerNavWipe scan crashed:', e.message);
    _ko++;
  }
```

- [ ] **Step 8: Run the full test suite to confirm everything passes**

Run: `npm test`
Expected: PASS — all new assertions green, no regressions in existing tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/view-transition.js frontend/tests/a11y.test.cjs frontend/tests/core.test.cjs
git commit -m "feat(nav): add equalizer-wave wipe overlay (unwired)"
```

---

### Task 2: Wire the wipe into fine + coarse directional detection

**Files:**
- Modify: `frontend/src/views.js:31` (import `triggerNavWipe`)
- Modify: `frontend/src/views.js:350-357` (fine layer — existing `setView()` direction block)
- Modify: `frontend/src/views.js:113-138` (coarse layer — `_showViewRaw()`)
- Test: `frontend/tests/core.test.cjs`

**Interfaces:**
- Consumes: `triggerNavWipe()` from `frontend/src/view-transition.js` (Task 1).
- Produces: `_COARSE_NAV_ORDER` (array) and `_lastCoarseView` (module-level, initially `null`) in `views.js`, used only internally — no other module needs them.

- [ ] **Step 1: Write the failing structural test for both layers**

Add to the same new test section area in `frontend/tests/core.test.cjs` (extend the block from Task 1, Step 7, or add immediately after it):

```js
  // ===========================================================================
  // N+3. views.js -- fine + coarse nav-direction wiring (structural)
  // ===========================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..');
    const VJS = fs.readFileSync(path.join(root, 'src/views.js'), 'utf8');

    section('views.js -- nav-direction + wipe wiring');

    assert(/import\s*\{\s*runViewTransition,\s*triggerNavWipe\s*\}\s*from\s*'\.\/view-transition\.js'/.test(VJS),
      'views.js imports triggerNavWipe from view-transition.js');

    // Fine layer: setView()'s existing data-nav-dir block also fires the wipe.
    const setViewBlock = /export function setView[\s\S]*?_withVT\(\(\) => \{/.exec(VJS);
    assert(setViewBlock, 'setView() body located');
    assert(/setAttribute\('data-nav-dir'/.test(setViewBlock[0]),
      'setView() still sets data-nav-dir (fine layer untouched)');
    assert(/triggerNavWipe\(\)/.test(setViewBlock[0]),
      'setView() calls triggerNavWipe() in the fine-grained direction block');

    // Coarse layer: _showViewRaw() gets its own order + tracking + detection.
    assert(/_COARSE_NAV_ORDER\s*=\s*\[\s*'welcome',\s*'lib',\s*'stats',\s*'radio',\s*'now-playing'\s*\]/.test(VJS),
      '_COARSE_NAV_ORDER defines the 5 coarse view keys in the expected order');
    assert(/let _lastCoarseView/.test(VJS), '_lastCoarseView module-level tracking var declared');
    const rawBlock = /export function _showViewRaw[\s\S]*?\n\}/.exec(VJS);
    assert(rawBlock, '_showViewRaw() body located');
    assert(/triggerNavWipe\(\)/.test(rawBlock[0]),
      '_showViewRaw() calls triggerNavWipe() in the coarse direction block');
  } catch (e) {
    console.error('  KO  views.js nav-direction wiring scan crashed:', e.message);
    _ko++;
  }
```

- [ ] **Step 2: Run the test suite to confirm it fails**

Run: `npm test`
Expected: FAIL — `_COARSE_NAV_ORDER` not found, `triggerNavWipe()` not called anywhere in `views.js` yet.

- [ ] **Step 3: Import triggerNavWipe in views.js**

In `frontend/src/views.js:31`, change:

```js
import { runViewTransition }                                         from './view-transition.js';
```

to:

```js
import { runViewTransition, triggerNavWipe }                         from './view-transition.js';
```

- [ ] **Step 4: Add triggerNavWipe() to the fine-grained direction block in setView()**

In `frontend/src/views.js`, the existing block (currently at lines 350-357) reads:

```js
  // Direction slide — active les animations directionnelles CSS (navSlideOut/In)
  const _fi = _NAV_ORDER.indexOf(get('view') || 'all');
  const _ti = _NAV_ORDER.indexOf(v);
  if (_fi >= 0 && _ti >= 0 && _fi !== _ti) {
    clearTimeout(_navDirTimer);
    document.documentElement.setAttribute('data-nav-dir', _ti > _fi ? 'forward' : 'back');
    _navDirTimer = setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
  }
```

Replace it with (adds one line, `triggerNavWipe()`):

```js
  // Direction slide — active les animations directionnelles CSS (navSlideOut/In)
  // + le wipe équaliseur (triggerNavWipe) — même attribut, même granularité fine.
  const _fi = _NAV_ORDER.indexOf(get('view') || 'all');
  const _ti = _NAV_ORDER.indexOf(v);
  if (_fi >= 0 && _ti >= 0 && _fi !== _ti) {
    clearTimeout(_navDirTimer);
    document.documentElement.setAttribute('data-nav-dir', _ti > _fi ? 'forward' : 'back');
    _navDirTimer = setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
    triggerNavWipe();
  }
```

- [ ] **Step 5: Add the coarse layer to _showViewRaw()**

In `frontend/src/views.js`, the existing `_showViewRaw()` (currently lines 113-138) reads:

```js
/** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;
  if (v === 'welcome' || v === 'wlc') {
    document.querySelectorAll('.sb-nav .ni').forEach(b => {
      b.classList.remove('on');
      b.removeAttribute('aria-current');
    });
  }

  const prev = document.querySelector('.view.on');

  if (typeof document.startViewTransition === 'function') {
    // VT API path : simple swap, browser handles visual transition
    if (prev && prev !== next) prev.classList.remove('on');
    next.classList.add('on');
  } else {
    // Fallback path : GSAP "exit on top" cross-fade
    transitionViews(prev !== next ? prev : null, next);
  }

  // Welcome ambient particle hooks — no-ops until registerWelcomeHooks() is called.
  if (next.id === 'vw') _welcomeOnShow?.();
  else if (prev && prev.id === 'vw') _welcomeOnHide?.();
}
```

Replace it with (adds the coarse order/tracking constants above the function, and the detection block inside it, right after `next` is resolved):

```js
const _COARSE_NAV_ORDER = ['welcome', 'lib', 'stats', 'radio', 'now-playing'];
let _lastCoarseView = null;

/** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;

  // Coarse direction layer — covers welcome/lib/stats/radio/now-playing switches
  // that the fine _NAV_ORDER layer in setView() never sees (that layer only
  // compares two fine sub-view keys, e.g. 'albums' vs 'artists', both of which
  // resolve to the SAME coarse container here — so this stays silent for those,
  // and the fine layer stays silent whenever the destination isn't one of its 8
  // sub-view keys — each transition is handled by exactly one of the two layers.
  const _CONTAINER_TO_COARSE = { vw: 'welcome', vlib: 'lib', vstats: 'stats', vradio: 'radio', vnp: 'now-playing' };
  const _coarseTo = _CONTAINER_TO_COARSE[next.id];
  if (_coarseTo) {
    const _cfi = _COARSE_NAV_ORDER.indexOf(_lastCoarseView);
    const _cti = _COARSE_NAV_ORDER.indexOf(_coarseTo);
    if (_cfi >= 0 && _cti >= 0 && _cfi !== _cti) {
      document.documentElement.setAttribute('data-nav-dir', _cti > _cfi ? 'forward' : 'back');
      setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
      triggerNavWipe();
    }
    _lastCoarseView = _coarseTo;
  }

  if (v === 'welcome' || v === 'wlc') {
    document.querySelectorAll('.sb-nav .ni').forEach(b => {
      b.classList.remove('on');
      b.removeAttribute('aria-current');
    });
  }

  const prev = document.querySelector('.view.on');

  if (typeof document.startViewTransition === 'function') {
    // VT API path : simple swap, browser handles visual transition
    if (prev && prev !== next) prev.classList.remove('on');
    next.classList.add('on');
  } else {
    // Fallback path : GSAP "exit on top" cross-fade
    transitionViews(prev !== next ? prev : null, next);
  }

  // Welcome ambient particle hooks — no-ops until registerWelcomeHooks() is called.
  if (next.id === 'vw') _welcomeOnShow?.();
  else if (prev && prev.id === 'vw') _welcomeOnHide?.();
}
```

Note: `'vscan'` (scanning) is deliberately absent from `_CONTAINER_TO_COARSE` — it falls through as `_coarseTo === undefined`, so the `if (_coarseTo)` guard skips direction detection entirely for scan transitions (unchanged from today's plain fade) while still leaving `_lastCoarseView` at its previous value, so the transition *out* of scanning (scan → lib) is compared against whatever coarse view was active *before* scanning started.

- [ ] **Step 6: Run the full test suite to confirm everything passes**

Run: `npm test`
Expected: PASS — all Task 1 and Task 2 assertions green.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`

1. Click through sidebar/lib-tabs (Tous → Artistes → Albums → Radio) both directions — confirm the equalizer wave plays alongside the existing slide, direction matching travel.
2. Open the "more options" menu → Statistiques — confirm the wave now plays (previously plain fade). Navigate back to Tous — confirm reverse-direction wave.
3. Expand Now Playing (player bar → expand) then close it — confirm the wave plays both ways.
4. Rapid-click through several nav items — no visual glitch, no stuck `data-nav-dir` attribute (inspect via DevTools after settling).
5. Toggle reduced motion in Réglages → confirm the wave no longer appears (instant transitions).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views.js frontend/tests/core.test.cjs
git commit -m "feat(nav): unify directional transitions across all main-nav switches"
```

---

### Task 3: Sidebar indicator glide

**Files:**
- Modify: `frontend/index.html:111` (insert `#ni-indicator` as first child of `.sb-nav`)
- Modify: `frontend/src/style.css:934-939` (`.sb-nav` gains `position: relative`)
- Modify: `frontend/src/style.css:956-966` (remove `.ni.on::before`, add `#ni-indicator` rules)
- Modify: `frontend/src/views.js:421-442` (`_svMarkNav()` — add indicator positioning)
- Test: `frontend/tests/a11y.test.cjs`
- Test: `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: `_positionNiIndicator(el)` — private helper in `views.js`, called from `_svMarkNav()`. `el` is an `Element|null` (the currently active `.ni`, or `null` if none). No return value.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/a11y.test.cjs`, after the `#nav-eq-wipe` tests added in Task 1:

```js
  await t('#ni-indicator is aria-hidden and not tab-reachable', () => {
    const els = findElements(HTML, e => e.id === 'ni-indicator');
    assert.ok(els.length === 1, '#ni-indicator not found in index.html');
    assert.strictEqual(els[0].attrs['aria-hidden'], 'true', '#ni-indicator must be aria-hidden="true"');
    assert.ok(!('tabindex' in els[0].attrs), '#ni-indicator must not declare tabindex');
  });
  await t('.ni.on::before pseudo-element indicator removed (replaced by #ni-indicator)', () => {
    assert.ok(!/\.ni\.on::before/.test(SS), '.ni.on::before should no longer exist in style.css');
  });
```

Add to `frontend/tests/core.test.cjs`, as its own standalone section using the file's plain `assert()` harness (near the other pure-logic sections at the top of the file, e.g. after the `normTag` section):

```js
// =============================================================================
// N. views.js -- _positionNiIndicator() position math (reproduced inline —
// pas d'import ES module, cf. en-tête de ce fichier)
// =============================================================================
section('views.js -- _positionNiIndicator() position math');

function computeIndicatorStyle(el) {
  if (!el) return { opacity: '0' };
  return { opacity: '1', transform: `translateY(${el.offsetTop}px)`, height: `${el.offsetHeight}px` };
}

(function () {
  const fakeActive = { offsetTop: 48, offsetHeight: 36 };
  const r1 = computeIndicatorStyle(fakeActive);
  assert(r1.opacity === '1', '_positionNiIndicator: active item -> opacity 1');
  assert(r1.transform === 'translateY(48px)', '_positionNiIndicator: translateY matches offsetTop');
  assert(r1.height === '36px', '_positionNiIndicator: height matches offsetHeight');

  const r2 = computeIndicatorStyle(null);
  assert(r2.opacity === '0', '_positionNiIndicator: no active item -> opacity 0');
  assert(r2.transform === undefined, '_positionNiIndicator: no active item -> no transform written');
}());
```

- [ ] **Step 2: Run the test suite to confirm it fails**

Run: `npm test`
Expected: FAIL — `#ni-indicator` not found in `index.html`; `.ni.on::before` still present in `style.css`.

- [ ] **Step 3: Add the indicator markup**

In `frontend/index.html`, immediately after line 111 (`<nav class="sb-nav" data-i18n-aria="aria_nav_main" aria-label="Navigation principale">`), insert:

```html

    <div id="ni-indicator" aria-hidden="true"></div>
```

- [ ] **Step 4: Update style.css — .sb-nav position + replace .ni.on::before**

In `frontend/src/style.css:934-939`, change:

```css
.sb-nav {
  flex: 1; padding: var(--sp-3) var(--sp-2);
  display: flex; flex-direction: column; gap: var(--sp-1h);
  overflow-y: auto;
  scrollbar-gutter: stable; /* CLS fix : réserve la place de la scrollbar (comme #tlist) */
}
```

to:

```css
.sb-nav {
  flex: 1; padding: var(--sp-3) var(--sp-2);
  display: flex; flex-direction: column; gap: var(--sp-1h);
  overflow-y: auto;
  position: relative; /* offsetParent for #ni-indicator */
  scrollbar-gutter: stable; /* CLS fix : réserve la place de la scrollbar (comme #tlist) */
}
```

Then in `frontend/src/style.css:956-966`, change:

```css
.ni.on     {
  background: rgba(var(--g-rgb), .12); color: var(--t);
  position: relative;
}
.ni.on::before {
  content: '';
  position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  width: var(--sp-micro); height: var(--icon-xl);
  background: var(--g); border-radius: 0 var(--r-xs) var(--r-xs) 0;
}
```

to:

```css
.ni.on     {
  background: rgba(var(--g-rgb), .12); color: var(--t);
  position: relative;
}
/* Active-item bar is now #ni-indicator (a shared sibling in .sb-nav, positioned
   from views.js _positionNiIndicator()) so it can glide between items instead
   of popping — a per-item ::before has no shared identity to animate between. */
#ni-indicator {
  position: absolute; left: 0; top: 0; width: var(--sp-micro);
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
  background: var(--g);
  opacity: 0;
  transition: transform var(--motion-fast) var(--ease-spring), height var(--motion-fast) var(--ease-spring);
}
```

- [ ] **Step 5: Add _positionNiIndicator() and wire it into _svMarkNav()**

In `frontend/src/views.js`, the existing `_svMarkNav()` (currently lines 422-442) ends with:

```js
  // Sync lib-tab underline indicators
  document.querySelectorAll('.lib-tab').forEach(t => { t.classList.remove('on'); t.setAttribute('aria-selected', 'false'); });
  if (_LIB_VIEWS.includes(v)) {
    const _tab = document.querySelector(`.lib-tab[data-view="${v}"]`);
    if (_tab) { _tab.classList.add('on'); _tab.setAttribute('aria-selected', 'true'); }
  }
}
```

Replace the closing `}` with a call to a new helper, and add the helper right after `_svMarkNav()`:

```js
  // Sync lib-tab underline indicators
  document.querySelectorAll('.lib-tab').forEach(t => { t.classList.remove('on'); t.setAttribute('aria-selected', 'false'); });
  if (_LIB_VIEWS.includes(v)) {
    const _tab = document.querySelector(`.lib-tab[data-view="${v}"]`);
    if (_tab) { _tab.classList.add('on'); _tab.setAttribute('aria-selected', 'true'); }
  }

  _positionNiIndicator(document.querySelector('.ni.on'));
}

/** Glide #ni-indicator to the currently active sidebar item (or hide it). */
function _positionNiIndicator(el) {
  const ind = document.getElementById('ni-indicator');
  if (!ind) return;
  if (!el) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.transform = `translateY(${el.offsetTop}px)`;
  ind.style.height = `${el.offsetHeight}px`;
}
```

- [ ] **Step 6: Run the full test suite to confirm everything passes**

Run: `npm test`
Expected: PASS — all Task 3 assertions green, no regressions.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`

1. Click Tous / Favoris / Récents in the sidebar — confirm the accent bar glides smoothly between items instead of popping.
2. Navigate to Playlists grid or an album/artist detail (no sidebar item should be active) — confirm the bar fades out (no leftover bar stuck on a stale item).
3. Toggle reduced motion — confirm the bar still repositions correctly but without a visible glide (instant jump).
4. Resize the sidebar (drag `#sb-resize`) then switch nav items — confirm the bar still aligns correctly (position is recomputed on every `setView()` call, not cached).

- [ ] **Step 8: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/views.js frontend/tests/a11y.test.cjs frontend/tests/core.test.cjs
git commit -m "feat(nav): gliding sidebar active-indicator (replaces .ni.on::before pop)"
```

---

### Task 4: Full regression pass

**Files:**
- None modified — verification only.

**Interfaces:**
- None — this task consumes the completed Tasks 1-3 and verifies the whole feature end-to-end.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`
Expected: PASS — 0 failures across all sections (existing + the ones added in Tasks 1-3).

- [ ] **Step 2: Run the perf benchmark to confirm no regression**

Run: `npm run bench`
Expected: No regression vs. the last recorded baseline — the equalizer overlay is a fixed 7-node element and the indicator repositioning is a single layout read + style write per nav change, both independent of library size.

- [ ] **Step 3: Full manual smoke pass (combines Task 2 Step 7 + Task 3 Step 7 into one pass)**

Run: `npm run dev`, then walk through:

1. Sidebar Tous → Favoris → Récents → Tous — wave + gliding indicator, both directions.
2. Tous → Artistes → Albums → Radio (lib-tabs) — wave + directional slide, both directions.
3. Sidebar → Statistiques → Radio → Now Playing → back to Tous — wave now plays on every hop (previously plain fade on some).
4. Open a playlist detail / album detail — sidebar indicator fades out cleanly (no stale bar).
5. Rapid-click through 5+ nav changes in a row — no visual glitch, no stuck `data-nav-dir` attribute, no console errors (`F12` → Console).
6. Enable reduced motion (Réglages) — every transition above becomes instant, no wave, no glide, no console errors.
7. `cargo check` (sanity — this branch also has pending cinema-mode changes; confirm nothing here breaks the Rust build, even though this feature is JS/CSS-only).

- [ ] **Step 4: Update CLAUDE.md if a new invariant emerged**

Read through CLAUDE.md §11 (High-risk zones) — this feature does not touch `virt.js`, `player.js`/`eq.js`/`replaygain.js`, `app.js` boot order, or `ipc.js`, so no new row is needed in that table. No CLAUDE.md changes required.

- [ ] **Step 5: Final commit (only if Steps 1-3 surfaced fix-up changes)**

If any of the above steps required a fix, commit it separately with a `fix(nav): ...` message before considering the feature complete. If everything passed clean on the first pass, there is nothing to commit in this task.
