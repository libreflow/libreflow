# GSAP Animation Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all CSS-based narrative animations with GSAP presets defined in `motion.js`, delivering cinematic view transitions and precise micro-interactions at 60fps.

**Architecture:** Ten named preset functions added to `motion.js` — `viewEnter`, `viewExit`, `panelOpen`, `panelClose`, `modalOpen`, `modalClose`, `trackSwap`, `playPausePress`, `staggerIn`, `staggerOut`. Each consumer imports its preset; no numeric values at call sites. CSS transitions replaced by GSAP are removed from `style.css`.

**Tech Stack:** GSAP 3.15.0 (already installed), `motion.js` facade (existing at `frontend/src/motion.js`), Vanilla ESM JS.

---

## File Map

| File | Change |
|---|---|
| `frontend/src/motion.js` | Add 10 preset exports |
| `frontend/src/views.js` | Replace CSS animation classes with `viewEnter`/`viewExit` |
| `frontend/src/queue.js` | Add `panelOpen`/`panelClose` calls |
| `frontend/src/eq.js` | Add `panelOpen`/`panelClose` calls |
| `frontend/src/settings.js` | Replace `.closing` animationend pattern with `panelOpen`/`panelClose` |
| `frontend/src/ui.js` | Add `openModalEl`/`closeModalEl` helpers; call `modalOpen`/`modalClose` |
| `frontend/src/playerbar.js` | Replace `animateArtChange()` with `trackSwap` |
| `frontend/src/player.js` | Add `playPausePress` on `pointerdown` of `.pcplay` |
| `frontend/src/style.css` | Remove CSS rules replaced by GSAP |

---

## Task 1 — Expand `motion.js` with all preset exports

**Files:**
- Modify: `frontend/src/motion.js` (append after the `_meta` export at line 153)

- [ ] **Step 1: Verify baseline**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Add view presets**

Append to the end of `frontend/src/motion.js`:

```js
// ── View presets ─────────────────────────────────────────────────────────────

/**
 * Animate a view element entering the screen.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewEnter(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, y: 18, duration: 0.38, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * Animate a view element leaving the screen. Returns a thenable tween.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewExit(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, y: -8, duration: 0.18, ease: 'power2.in' });
}
```

- [ ] **Step 3: Add panel and modal presets**

Continue appending to `frontend/src/motion.js`:

```js
// ── Panel presets ─────────────────────────────────────────────────────────────

/**
 * @param {Element} el — panel inner element (not the backdrop)
 * @returns {gsap.core.Tween}
 */
export function panelOpen(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, y: 12, scale: 0.97, duration: 0.26, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function panelClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, y: 8, scale: 0.97, duration: 0.16, ease: 'power2.in' });
}

/**
 * @param {Element} el — dialog element inside the backdrop
 * @returns {gsap.core.Tween}
 */
export function modalOpen(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, scale: 0.94, duration: 0.28, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function modalClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.16, ease: 'power2.in' });
}
```

- [ ] **Step 4: Add player presets**

Continue appending:

```js
// ── Player presets ────────────────────────────────────────────────────────────

/** Active timeline ref — allows rapid track changes to kill the previous sequence. */
let _trackSwapTl = null;

/**
 * Animate art + title + artist on track change.
 * Call AFTER DOM content (src, text) has already been updated.
 * @param {Element} artEl    — `.pl-art` container
 * @param {Element} titleEl  — `#pl-n`
 * @param {Element} artistEl — `#pl-a`
 */
export function trackSwap(artEl, titleEl, artistEl) {
  if (_trackSwapTl) { _trackSwapTl.kill(); _trackSwapTl = null; }
  if (prefersReducedMotion()) {
    gsap.from([artEl, titleEl, artistEl], { opacity: 0, duration: 0 });
    return;
  }
  _trackSwapTl = gsap.timeline({ onComplete() { _trackSwapTl = null; } })
    .from(artEl,    { opacity: 0, scale: 1.08, filter: 'blur(4px)', duration: 0.26, ease: eases.PREMIUM, clearProps: 'filter,transform' }, 0)
    .from(titleEl,  { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform' }, 0)
    .from(artistEl, { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform' }, 0.04);
}

/**
 * Tactile spring bounce for the play/pause button on press.
 * @param {Element} btn — `.pcplay`
 */
export function playPausePress(btn) {
  if (prefersReducedMotion()) return;
  kill(btn);
  gsap.fromTo(btn, { scale: 0.91 }, { scale: 1, duration: 0.20, ease: eases.OVERSHOOT });
}
```

- [ ] **Step 5: Add list presets**

Continue appending:

```js
// ── List presets ──────────────────────────────────────────────────────────────

const STAGGER_CAP = 12;

/**
 * Stagger-in a NodeList/Array of elements (first render of a view list).
 * @param {NodeList|Element[]} items
 */
export function staggerIn(items) {
  const els  = Array.from(items).slice(0, STAGGER_CAP);
  const rest = Array.from(items).slice(STAGGER_CAP);
  kill(els);
  if (rest.length) gsap.set(rest, { opacity: 1 });
  if (prefersReducedMotion()) { gsap.set(els, { opacity: 1 }); return; }
  gsap.from(els, { opacity: 0, x: -8, duration: 0.24, ease: eases.PREMIUM, stagger: 0.018, clearProps: 'transform' });
}

/**
 * Stagger-out before a list is replaced.
 * @param {NodeList|Element[]} items
 * @returns {gsap.core.Tween}
 */
export function staggerOut(items) {
  const els = Array.from(items).slice(0, STAGGER_CAP);
  kill(els);
  if (prefersReducedMotion()) { gsap.set(els, { opacity: 0 }); return gsap.set(els, {}); }
  return gsap.to(els, { opacity: 0, x: -4, duration: 0.14, ease: 'power2.in', stagger: 0.010 });
}
```

- [ ] **Step 6: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/motion.js
git commit -m "feat(motion): add viewEnter/viewExit, panelOpen/Close, modalOpen/Close, trackSwap, playPausePress, staggerIn/Out presets"
```

---

## Task 2 — Wire `views.js`

**Files:**
- Modify: `frontend/src/views.js`

- [ ] **Step 1: Add import**

At the top of `frontend/src/views.js`, add:

```js
import { viewEnter, viewExit } from './motion.js';
```

- [ ] **Step 2: Replace `_showViewRaw` animation logic**

Find this function body in `frontend/src/views.js`:

```js
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;

  // BUGFIX : retirer .on AVANT .view-leave → .view.on a spécificité > .view-leave
  // → animationend ne fire jamais si .on reste présent (vue précédente figée).
  const prev = document.querySelector('.view.on');
  if (prev && prev !== next) {
    prev.classList.remove('on');
    prev.style.display = 'flex';
    prev.classList.add('view-leave');
    prev.addEventListener('animationend', () => {
      prev.style.display = '';
      prev.classList.remove('view-leave');
    }, { once: true });
  }

  next.classList.add('on');
  // Animation d'entrée en fallback non-VT (VT API gère le cross-fade quand disponible)
  if (prev && prev !== next && typeof document.startViewTransition !== 'function') {
    next.classList.add('view-enter');
    next.addEventListener('animationend', () => next.classList.remove('view-enter'), { once: true });
  }
}
```

Replace with:

```js
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;

  const prev = document.querySelector('.view.on');
  if (prev && prev !== next) {
    prev.classList.remove('on');
    // CLS fix: position:absolute removes exiting view from block flow so the
    // entering view does not shift down during the exit animation.
    prev.style.position = 'absolute';
    viewExit(prev).then(() => {
      prev.style.position = '';
      prev.style.opacity  = '';
    });
  }

  next.classList.add('on');
  viewEnter(next);
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views.js
git commit -m "feat(views): replace CSS view-leave/view-enter with GSAP viewEnter/viewExit"
```

---

## Task 3 — Wire `queue.js` and `eq.js`

**Files:**
- Modify: `frontend/src/queue.js`
- Modify: `frontend/src/eq.js`

- [ ] **Step 1: Add import to `queue.js`**

```js
import { panelOpen, panelClose } from './motion.js';
```

- [ ] **Step 2: Call `panelOpen` when queue opens**

In `toggleQueue()`, inside the `if (queueOpen)` branch, after `_setupQueueFocusTrap(panel)`:

```js
  if (queueOpen) {
    renderQueue(); initQueueDrag();
    const panel = document.getElementById('queue-panel');
    if (panel) _setupQueueFocusTrap(panel);
    panelOpen(panel);   // ← add
  }
```

- [ ] **Step 3: Defer `.open` removal until `panelClose` completes in `closeQueue`**

In `closeQueue()`, replace:

```js
  queueOpen = false;
  document.getElementById('queue-panel').classList.remove('open');
  const btn = document.getElementById('btn-queue');
  btn?.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
  document.getElementById('app')?.classList.remove('panel-queue-open');
```

With:

```js
  queueOpen = false;
  const btn = document.getElementById('btn-queue');
  btn?.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
  document.getElementById('app')?.classList.remove('panel-queue-open');
  const qp = document.getElementById('queue-panel');
  panelClose(qp).then(() => qp?.classList.remove('open'));
```

- [ ] **Step 4: Add import to `eq.js`**

```js
import { panelOpen, panelClose } from './motion.js';
```

- [ ] **Step 5: Call `panelOpen` when EQ opens**

In `toggleEQ()`, at the end of the `if (eqOpen)` branch (after `_setupEQFocusTrap`):

```js
  panelOpen(document.getElementById('eq-panel'));
```

- [ ] **Step 6: Defer `.open` removal in `closeEQ`**

In `closeEQ()`, replace:

```js
  eqOpen = false;
  document.getElementById('eq-panel').classList.remove('open');
  const btn = document.getElementById('btn-eq');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.classList.remove('active');
  document.getElementById('app')?.classList.remove('panel-eq-open');
```

With:

```js
  eqOpen = false;
  const btn = document.getElementById('btn-eq');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.classList.remove('active');
  document.getElementById('app')?.classList.remove('panel-eq-open');
  const ep = document.getElementById('eq-panel');
  panelClose(ep).then(() => ep?.classList.remove('open'));
```

- [ ] **Step 7: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/queue.js frontend/src/eq.js
git commit -m "feat(panels): animate queue and EQ open/close with GSAP panelOpen/panelClose"
```

---

## Task 4 — Wire `settings.js`

**Files:**
- Modify: `frontend/src/settings.js`

- [ ] **Step 1: Add import**

```js
import { panelOpen, panelClose } from './motion.js';
```

- [ ] **Step 2: Add open animation in `openSettings`**

After `panel.classList.add('on');`, add:

```js
  panel.classList.add('on');
  panelOpen(document.getElementById('settings-box'));
```

- [ ] **Step 3: Replace `closeSettings` with GSAP pattern**

Replace the entire `closeSettings` function body with:

```js
export function closeSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  const box = document.getElementById('settings-box');
  if (_settingsFocusTrap && box) {
    box.removeEventListener('keydown', _settingsFocusTrap);
    _settingsFocusTrap = null;
  }
  const trigger = document.getElementById('tbt-settings');
  trigger?.classList.remove('active');
  trigger?.setAttribute('aria-expanded', 'false');
  panelClose(box).then(() => {
    panel.classList.remove('on');
    if (_settingsTrigger) { _settingsTrigger.focus(); _settingsTrigger = null; }
  });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/settings.js
git commit -m "feat(settings): replace animationend close pattern with GSAP panelOpen/panelClose"
```

---

## Task 5 — Wire `ui.js` — modal helpers

**Files:**
- Modify: `frontend/src/ui.js`
- Modify: any file that directly toggles a `*-modal-bg` element's `.on` class

- [ ] **Step 1: Add import to `ui.js`**

```js
import { modalOpen, modalClose } from './motion.js';
```

- [ ] **Step 2: Add `openModalEl` / `closeModalEl` helpers in `ui.js`**

Add after the imports in `frontend/src/ui.js`:

```js
/**
 * Show a modal backdrop and animate the inner dialog in.
 * @param {HTMLElement} bgEl — the backdrop element (e.g. #modal-bg)
 */
export function openModalEl(bgEl) {
  bgEl.classList.add('on');
  const dialog = bgEl.querySelector('[role="dialog"]');
  if (dialog) modalOpen(dialog);
}

/**
 * Animate the inner dialog out, then hide the backdrop.
 * @param {HTMLElement} bgEl
 * @returns {Promise<void>}
 */
export function closeModalEl(bgEl) {
  const dialog = bgEl.querySelector('[role="dialog"]');
  if (!dialog) { bgEl.classList.remove('on'); return Promise.resolve(); }
  return modalClose(dialog).then(() => bgEl.classList.remove('on'));
}
```

- [ ] **Step 3: Update `confirmAction` in `ui.js`**

Replace `document.getElementById('confirm-modal-bg').classList.add('on')` with:

```js
openModalEl(document.getElementById('confirm-modal-bg'));
```

Replace the `classList.remove('on')` on `#confirm-modal-bg` (in the resolution handler) with:

```js
closeModalEl(document.getElementById('confirm-modal-bg'));
```

- [ ] **Step 4: Update `promptAction` in `ui.js`**

Replace `bg.classList.add('on')` with `openModalEl(bg)`.

Replace `bg.classList.remove('on')` / `bg.remove()` with `closeModalEl(bg).then(() => bg.remove())`.

- [ ] **Step 5: Update all remaining modal callers**

Run this to find all raw `.on` toggles on modal backgrounds:

```bash
grep -rn "modal-bg" frontend/src/ --include="*.js" | grep "classList"
```

Expected files: `handlers.js`, `playlists.js`, `tagedit.js`, `cdaudio.js`, `orphans.js`. For each:

1. Add `import { openModalEl, closeModalEl } from './ui.js';` at the top (if not already present)
2. Replace every `document.getElementById('X-modal-bg').classList.add('on')` with `openModalEl(document.getElementById('X-modal-bg'))`
3. Replace every `document.getElementById('X-modal-bg').classList.remove('on')` with `closeModalEl(document.getElementById('X-modal-bg'))`. If code runs after the remove, chain it: `closeModalEl(bg).then(() => { /* follow-up */ })`

- [ ] **Step 6: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui.js frontend/src/handlers.js
git commit -m "feat(modals): animate all modal open/close with GSAP via openModalEl/closeModalEl helpers"
```

---

## Task 6 — Wire `playerbar.js` and `player.js`

**Files:**
- Modify: `frontend/src/playerbar.js`
- Modify: `frontend/src/player.js`

- [ ] **Step 1: Add import to `playerbar.js`**

```js
import { trackSwap } from './motion.js';
```

- [ ] **Step 2: Call `trackSwap` in `updateBar` after content is set**

In `updateBar()`, find the `if (t.art) { ... animateArtChange(); }` block. Remove the `animateArtChange()` call and add `trackSwap` after the if/else:

```js
  if (t.art) {
    img.src = t.art; img.alt = t.album || t.name || '';
    img.style.display = 'block'; em.style.display = 'none';
  } else {
    img.alt = ''; img.style.display = 'none';
    em.style.display = ''; em.innerHTML = extEmoji(t.ext);
  }

  // GSAP track swap — animate art container + title + artist after content update
  const artEl    = document.getElementById('pl-art');
  const titleEl  = document.getElementById('pl-n');
  const artistEl = document.getElementById('pl-a');
  if (artEl && titleEl && artistEl) trackSwap(artEl, titleEl, artistEl);
```

- [ ] **Step 3: Delete the `animateArtChange` function from `playerbar.js`**

Find and delete:

```js
function animateArtChange() {
  const img = document.getElementById('pl-img');
  if (!img) return;
  img.classList.remove('art-change');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      img.classList.add('art-change');
      img.addEventListener('animationend', () => img.classList.remove('art-change'), { once: true });
    });
  });
}
```

- [ ] **Step 4: Add import to `player.js`**

```js
import { playPausePress } from './motion.js';
```

- [ ] **Step 5: Attach `playPausePress` on pointerdown (once)**

Add at module scope in `frontend/src/player.js`:

```js
let _pressListenerAttached = false;

function _attachPressListener() {
  if (_pressListenerAttached) return;
  const btn = document.querySelector('.pcplay');
  if (!btn) return;
  btn.addEventListener('pointerdown', () => playPausePress(btn));
  _pressListenerAttached = true;
}
```

At the end of `setIcon()`, call `_attachPressListener()`:

```js
export function setIcon(playing) {
  invoke('taskbar_set_playing', { playing }).catch((e) => console.warn('[taskbar_set_playing]', e));
  const ci = document.getElementById('cinema-ico-play');
  const cp = document.getElementById('cinema-ico-pause');
  if (ci) ci.style.display = playing ? 'none'  : 'block';
  if (cp) cp.style.display = playing ? 'block' : 'none';
  document.querySelector('.pcplay')?.classList.toggle('playing', playing);
  document.querySelector('.pcplay')?.setAttribute('aria-pressed', String(playing));
  document.querySelector('.sb-dot')?.classList.toggle('playing', playing);
  _attachPressListener();
}
```

- [ ] **Step 6: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/playerbar.js frontend/src/player.js
git commit -m "feat(player): replace animateArtChange with trackSwap, add playPausePress on pointerdown"
```

---

## Task 7 — Wire `staggerIn` on list views

**Files:**
- Modify: `frontend/src/views.js`

The stagger only applies to grid views (albums, artists, genres) and playlist list views — not the virtual-scroll track list (`#tlist`), which renders via `virt.js` and is out of scope.

- [ ] **Step 1: Add import to `views.js`**

```js
import { viewEnter, viewExit, staggerIn } from './motion.js';
```

- [ ] **Step 2: Call `staggerIn` after grid/list content is rendered**

In `views.js`, find the function(s) that set the view to `albums`, `artists`, `genres`, or playlist grid and trigger a re-render (look for `renderAlbums`, `renderArtists`, `renderGenres`, `renderPlaylistView` calls). After the render call, add:

```js
// Stagger the first 12 cards in the grid
const cards = document.querySelectorAll('#content-area .card');
if (cards.length) staggerIn(cards);
```

Place this after each render call that populates a `.card` grid. If a shared `_afterRender()` hook exists, add it there instead to avoid duplication.

- [ ] **Step 3: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views.js
git commit -m "feat(views): staggerIn on album/artist/genre/playlist grid first render"
```

---

## Task 8 — CSS cleanup in `style.css`

Remove CSS transitions and animations now owned by GSAP. Verify with Grep before each deletion.

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Remove view CSS animations**

Search: `grep -n "view-enter\|view-leave\|viewIn\|viewOut" frontend/src/style.css`

Remove:
- `@keyframes viewIn { ... }`
- `@keyframes viewOut { ... }`
- `.view-enter { animation: viewIn ... }`
- `.view-leave { ... }` (entire block including `position: absolute` — GSAP now does this via inline style)

- [ ] **Step 2: Remove `opacity` transition from queue/EQ panels**

Search: `grep -n "queue-panel\|eq-panel" frontend/src/style.css | grep opacity`

In the `#queue-panel, #eq-panel` rules, remove:
- `opacity: 0;` from the base rule
- `opacity: var(--dur-flash) ease;` from the `transition` list
- `opacity: 1;` from the `.open` rule

Keep all other transition properties (transform, box-shadow, width).

- [ ] **Step 3: Remove settings CSS animations**

Search: `grep -n "settingsSlide\|overlayIn\|overlayOut\|closing" frontend/src/style.css`

Remove:
- `@keyframes settingsSlideIn { ... }`
- `@keyframes settingsSlideOut { ... }`
- `#settings-panel.on  #settings-box  { animation: settingsSlideIn ... }`
- `#settings-panel.closing #settings-box  { animation: settingsSlideOut ... }`
- `#settings-panel.on  #settings-overlay { animation: overlayIn ... }`
- `#settings-panel.closing #settings-overlay { animation: overlayOut ... }`

Then check `@keyframes overlayIn` / `@keyframes overlayOut` — if they appear only in the settings rules above, delete them too.

- [ ] **Step 4: Remove modal CSS animations**

Search: `grep -n "modalBoxIn\|overlayIn" frontend/src/style.css`

Remove the `animation: modalBoxIn` lines from:
- `#modal-bg.on #modal`
- `#pl-modal-bg.on #pl-modal`
- `#confirm-modal-bg.on #confirm-modal`
- `#batch-tag-modal-bg.on #batch-tag-modal`
- `.prompt-bg.on .modal`

Then check: `grep -c "modalBoxIn" frontend/src/style.css` — if count is 0, also remove `@keyframes modalBoxIn`.

- [ ] **Step 5: Remove `.art-change` animation**

Search: `grep -n "art-change\|artIn" frontend/src/style.css`

Remove:
- `.pl-art img.art-change { animation: artIn ... }`
- `@keyframes artIn { ... }` (if only used by `.art-change`)

- [ ] **Step 6: Remove `.pcplay:active` scale rule**

Find and remove:
```css
.pcplay:active { transform: scale(.91); transition-duration: var(--dur-fast); }
```

GSAP `playPausePress` owns this interaction.

- [ ] **Step 7: Verify tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/style.css
git commit -m "chore(css): remove view/panel/modal/art CSS animations replaced by GSAP"
```

---

## Task 9 — Smoke test

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

- [ ] **Step 2: Launch app and verify all surfaces**

```bash
npm run dev
```

Verify each:
1. Navigate all views — smooth fade+y entrance, no CLS, no stuck opacity
2. Queue panel open/close — scale+y in, scale+y out
3. EQ panel open/close — same
4. Settings panel open/close — slide in, no `.closing` class needed
5. Three different modals — scale+opacity enter/exit
6. Change track — art + title + artist animate in together after content update
7. Tap play/pause rapidly 10× — spring bounce, no scale drift
8. Enable OS reduced motion (`Windows Settings → Ease of Access → Display → Show animations in Windows = Off`), repeat items 1–7 — all instant, opacity only

- [ ] **Step 3: Commit any adjustments**

```bash
git add -p
git commit -m "fix(gsap): smoke test adjustments"
```
