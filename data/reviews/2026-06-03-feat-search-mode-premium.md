# Code Review — feat/search-mode-premium
**Date:** 2026-06-03  
**Branch:** feat/search-mode-premium → master  
**Reviewer:** @reviewer  
**Verdict:** ⚠️ WARN — 2 HIGH issues, fix before merge

---

## Test Results

| Suite | Result |
|-------|--------|
| `npm test` (378 assertions) | GREEN |
| `cargo test --lib` | GREEN |

---

## Invariant Checklist (CLAUDE.md §19)

- [x] `rebuildTrackIdxMap()` called after every `tracks[]` mutation
- [x] `audio.volume` never assigned literally
- [x] No `fetch`, `XMLHttpRequest`, `WebSocket` added
- [x] IDB writes debounced
- [x] Audio params use `setTargetAtTime`
- [x] IPC calls through `ipc.js` with timeout
- [x] Virtual scroll constants from `CFG`
- [x] `radioRefillQueue()` before `updateBar()`
- [x] No `console.log` committed
- [x] No external network calls

---

## Display Bug Findings

### HIGH — BUG-D1: View exit `position:absolute` without positioned ancestor

**File:** `frontend/src/views.js:116-130`

When `_showViewRaw` switches views, the exiting view receives:

```js
prev.style.position      = 'absolute';
prev.style.inset         = '0';
prev.style.zIndex        = '1';
```

Neither `#main` (flex container) nor `#app` (grid container) has `position: relative`. The nearest positioned ancestor is the viewport (`<html>`). The exiting `.view` spans the entire viewport for 140 ms on every view switch, covering `#sb` (sidebar has no explicit z-index).

- `#tb` is safe: z-index: var(--z-sticky) = 100 > 1
- `#sb` has no explicit z-index in normal context → covered by the z-index:1 view
- Sidebar content briefly obscured by fading-out view content for 140 ms

**Fix:** Add `position: relative` to `#main` in `style.css`:

```css
#main { position: relative; /* containment for view transitions */ ... }
```

---

### HIGH — BUG-D2: Dark mode search input loses keyboard focus ring

**File:** `frontend/src/style.css:956-969`

The dual-tone focus ring was removed:

```css
/* REMOVED from this branch */
.sb-search .srch:has(input:focus-visible) {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  box-shadow: 0 0 0 var(--border-w-lg) var(--focus-ring-contrast);
}
```

Replaced by a background-only change (`background: var(--border-3); border-bottom-color: var(--border-2); outline: none`). Light mode is fine — it inherits `border-color: var(--g)` from the light-mode override. Dark mode has no visible accent.

WCAG SC 2.4.13 Focus Appearance (AAA) regression; borderline SC 2.4.7 Focus Visible (AA).

**Fix:**

```css
.sb-search .srch:has(input:focus-visible) {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  box-shadow: 0 0 0 var(--border-w-lg) var(--focus-ring-contrast);
}
```

---

### MEDIUM — BUG-D3: Cinema title max font size 34 px → 56 px

**File:** `frontend/src/design-system.css`

```
old: --fs-vw-cin-title: clamp(16px, 3.2vw, 34px)
new: --fs-vw-cin-title: clamp(18px, 3.8vw, 56px)
```

At 1480 px+ (common desktop), `3.8 vw ≈ 56 px`. The cinema title is 65 % larger at max. Long titles will hit the marquee threshold sooner (handled by `_recheckTitleScroll`), but at 2560 px the text may feel oversized relative to the artwork. Validate on large displays before ship.

---

### MEDIUM — BUG-D4: Cinema title `_recheckTitleScroll` fires before element is visible

**File:** `frontend/src/cinema.js:131`

```js
requestAnimationFrame(() => { if (elT.isConnected) _recheckTitleScroll(); });
```

If `updateCinema()` is called while `#cinema-info` is still `autoAlpha: 0` (mid open-animation), `scrollWidth` returns 0, removing `.is-scrolling` even for long titles. The `_recheckTitleScroll()` in `_openTl.onComplete` re-adds it — brief (~300 ms) non-scrolling flash before marquee starts.

The `onComplete` recovery handles this, so it is low-risk in practice. Severity: MEDIUM cosmetic.

---

## Intentional Design Changes (Not Bugs)

| Change | Verdict |
|--------|---------|
| `#settings-overlay` stays at opacity 0 | Intentional — settings box is full-viewport opaque |
| `wasFuzzySearch` "≈" badge removed | Intentional — Spotify-like plain results |
| `srch-badge` → `sr-only` (visual count hidden) | Intentional — count announced via aria-live |
| EQ slider track: 2 px → `var(--track-h)` (3 px) | Intentional — token unification |
| Search `hlText()` no longer highlights matches | Intentional — "premium plain results" |
| `.sb-section-lbl` uses `--t3` in light mode | Safe — `--text-muted` light = #373C4C (10.3:1) |
| Modal CSS animations → GSAP `modalOpen/Close` | Correct migration (ui.js + modal.js) |
| Settings slide CSS → GSAP `panelOpen/Close` | Correct migration (settings.js) |
| Queue close → GSAP `panelClose` | Correct migration (queue.js) |
| `trackSwap` replaces `animateArtChange` | `.pl-art` has `overflow:hidden + position:relative` — safe |

---

## Architecture Observations

Positive:
- `motion.js` view/panel/modal/player presets cleanly separated from feature modules
- `FOCUSABLE_SEL` exported from `modal.js` and shared with `queue.js` — good DRY
- `_statsAbortCtrl` AbortController pattern prevents listener accumulation on re-render
- `relevanceScore` + `_relevanceSort` gives proper prefix/word-start/field-weight ranking
- `sampleArtColors5` k-means gives richer 5-sample ambient gradient

Concern:
- `#tb-burger-panel role="menu"` + children `role="menuitem" tabindex="-1"` requires Arrow-key roving tabindex. Confirm JS handler (`toggle-burger-menu` action) implements `ArrowLeft/Right/Home/End` within the panel per the ARIA menu pattern.

---

## Verdict: WARN

| ID | Severity | Action |
|----|----------|--------|
| BUG-D1 | HIGH | Fix: add `position: relative` to `#main` in style.css |
| BUG-D2 | HIGH | Fix: restore dark-mode focus ring on `.sb-search .srch` |
| BUG-D3 | MEDIUM | Validate at 2560 px before ship |
| BUG-D4 | MEDIUM | Monitor — onComplete recovery already in place |
