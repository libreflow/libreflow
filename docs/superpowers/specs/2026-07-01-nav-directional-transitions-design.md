# Nav Directional Transitions — Design Spec

**Date:** 2026-07-01
**Branch:** fix/a11y-audit
**Status:** Approved

---

## Problem

The view transition system in libreflow has two layers:

1. **VT API path** (`document.startViewTransition`) — the browser handles the visual transition using `::view-transition-*` CSS rules.
2. **GSAP fallback** (`transitionViews`) — opacity + y-lift cross-fade for browsers without VT API support.

`style.css` already contains directional slide `@keyframes` and selectors for `#content-area` (`view-transition-name: main-content`):

```css
html[data-nav-dir="forward"] ::view-transition-old(main-content) → navSlideOutLeft
html[data-nav-dir="forward"] ::view-transition-new(main-content) → navSlideInRight
html[data-nav-dir="back"]    ::view-transition-old(main-content) → navSlideOutRight
html[data-nav-dir="back"]    ::view-transition-new(main-content) → navSlideInLeft
```

**These CSS rules are complete and correct, but no JS code ever sets `data-nav-dir`.** All intra-lib navigation (all→albums, artists→playlists, etc.) falls through to the undirected `vtOut/vtIn` cross-fade instead of the intentionally-designed directional slide.

---

## Goal

Activate the existing directional slide animations by detecting navigation direction in `setView()` and setting `data-nav-dir` on `<html>` before the `_withVT` call.

---

## Non-Goals

- No CSS changes (CSS is complete)
- No new animation tokens
- No changes to `showView()` or top-level view switches (lib↔stats↔radio) — those use `vtOut/vtIn` on `root`, which is correct and intentional
- No GSAP fallback changes — fallback path (`transitionViews`) remains opacity+y cross-fade
- No sidebar nav indicator animation (separate concern)

---

## Architecture

### View Order

A module-level constant defines the conceptual left-to-right view order:

```js
const _NAV_ORDER = ['all', 'liked', 'recent', 'artists', 'albums', 'genres', 'playlists', 'radio'];
```

This maps to the visual sidebar order (top→bottom) followed by lib-tabs (left→right). Views not in this array (playlist, album-detail, artist-detail, genre-detail) are drill-down contexts — they receive no directional attribute and fall back to the default cross-fade.

### Direction Detection

In `setView()`, immediately before the `_withVT(() => { ... })` call:

```js
let _navDirTimer = null;  // module-level — cancels on rapid navigation

// inside setView, before _withVT:
const _fromView = get('view') || 'all';
const _fi = _NAV_ORDER.indexOf(_fromView);
const _ti = _NAV_ORDER.indexOf(v);
if (_fi >= 0 && _ti >= 0 && _fi !== _ti) {
  clearTimeout(_navDirTimer);
  document.documentElement.setAttribute('data-nav-dir', _ti > _fi ? 'forward' : 'back');
  _navDirTimer = setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
}
```

The 400ms timeout safely outlasts the longest nav animation (`--dur-nav` = 200ms + render jitter). The `clearTimeout` + module-level timer variable prevents stale cleanup from a prior call from racing a new one on rapid navigation.

### When `data-nav-dir` Is Present

The `::view-transition-old/new(main-content)` selectors in `style.css` override the default `vtOut/vtIn` with a horizontal translate:

| Direction | Old content exits | New content enters |
|---|---|---|
| `forward` | slides left (`navSlideOutLeft`) | comes from right (`navSlideInRight`) |
| `back` | slides right (`navSlideOutRight`) | comes from left (`navSlideInLeft`) |

Slide distance: `--sp-4h` (= `--space-4` = 16px) — subtle, not jarring.

---

## Files

| File | Change |
|---|---|
| `frontend/src/views.js` | +1 module-level `let _navDirTimer`; +8 lines before `_withVT` block in `setView()` |

---

## Accessibility

`prefers-reduced-motion: reduce` is handled transparently by the browser's VT API implementation — when reduced motion is on, `startViewTransition` still fires but the browser skips the visual animation. The directional attribute has no effect in that context.

The `html.vt-running` + `animation: none !important` guard in `style.css` continues to suppress competing `.view.on` animations during any transition.

---

## Invariants (CLAUDE.md)

- No external network calls — ✅ (no `fetch`, XHR, WebSocket)
- No `console.log` in committed code — the change adds no logging
- No `tracks[]` mutation — unaffected
- Functions <50 lines — the `setView` function stays well within limits; the 8 added lines are minimal

---

## Test Plan

**Manual smoke test** (no automated test needed — this is a pure visual/timing change):

1. Open the app with at least one track loaded.
2. Click **Albums** in the lib-tabs → content should slide left (forward direction).
3. Click **Tous** → content should slide right (back direction).
4. Click **Artistes** from **Albums** → forward slide.
5. Click **Playlists** from nav sidebar → forward slide (playlists is later in order).
6. Verify that switching between top-level views (lib → stats, stats → radio) still cross-fades without slide (showView path, no `data-nav-dir`).
7. Rapid-click several nav items → no visual glitch (timer cleared on each new call).
8. Enable OS reduced motion → transitions should be instant.
