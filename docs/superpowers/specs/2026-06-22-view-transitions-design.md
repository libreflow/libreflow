# View Transitions — Design Spec

**Date:** 2026-06-22  
**Branch:** fix/a11y-audit  
**Status:** Approved

---

## 1. Problem

Switching between sidebar sections (e.g. "Tous les titres" → "Favoris") causes a visible **jump / flash** before the new view appears.

### Root cause (confirmed by code inspection)

Two compounding bugs in `_showViewRaw()` (views.js:110):

1. **Wrong containing block.** `.view-leave` applies `position: absolute; inset: 0` to the outgoing view, intending to anchor it inside `#main`. But `#main` has no `position: relative` (only `overflow: hidden`). The absolutely positioned view escapes to the viewport's initial containing block — `inset: 0` covers the **entire window** for the duration of the animation, then snaps away. That is the jump.

2. **Double animation during View Transition API.** `.view-leave` (and its `viewOut` keyframe) is added even when `document.startViewTransition` is handling the transition. Only `.view-enter` is suppressed by `html.vt-running .view-enter { animation: none }`. `.view-leave` is not. Result: two concurrent animations conflict, and the `position: absolute` still fires.

3. **`animationend` not always reliable.** If a second navigation is triggered before `animationend` fires, the listener is orphaned, the old view stays partially visible (inline `display: flex`), and the next transition starts in a broken state.

---

## 2. Solution

### 2.1 View Transition API path (primary — Tauri WebView2 / Chromium)

When `document.startViewTransition` is available, `_withVT` already wraps DOM mutations inside the native transition. The fix is to **not apply any CSS animation class** in this path: just swap `.on` between views. The VT API handles the visual cross-fade via `::view-transition-old/new(main-content)` (already defined in style.css).

### 2.2 Fallback path (no VT API) — GSAP "exit on top" cross-fade

Replace `.view-enter` / `.view-leave` with a GSAP-driven transition from `motion.js`:

**Pattern — "exit on top":**
1. New view: `classList.add('on')` immediately (enters normal flow, full size)
2. Old view: GSAP.set → `position: absolute; inset: 0; z-index: 2; pointer-events: none`  
   (overlay on top of the new view, anchored to `#main` which now has `position: relative`)
3. GSAP timeline (simultaneous):
   - Old view: `opacity 1→0` in **150ms** with `eases.SNAP` (exit: shorter, quieter)
   - New view: `opacity 0→1` + `translateY(8px→0)` in **220ms** with `eases.PREMIUM` (enter: longer, with upward lift)
4. On completion: GSAP `clearProps` cleans up `position`, `inset`, `zIndex`, `opacity`, `transform`

**Interruptibility:** `kill(prev)` + `kill(next)` before starting — GSAP cancels any in-progress tween on those targets when a new navigation fires.

**Reduced motion:** existing `prefersReducedMotion()` check in `motion.js` collapses all durations to instant `gsap.set()` — no extra code needed.

### 2.3 CSS fix (prerequisite)

Add `position: relative` to `#main` so that any future `position: absolute` child (including during fallback) anchors correctly to the main content area.

---

## 3. Animation parameters

| Role | Duration | Ease | Properties |
|------|----------|------|-----------|
| Exit (old view) | 150ms | `eases.SNAP` (`lf-snap`) | `opacity 1→0` |
| Enter (new view) | 220ms | `eases.PREMIUM` (`lf-premium`) | `opacity 0→1`, `translateY(8→0)` |

- Exit is always shorter than enter (make-interfaces-feel-better principle)
- No `blur` filter (degrades text legibility at list density)
- No `scale` (was contributing to the jump feeling)

---

## 4. Scope

### In scope

- `frontend/src/style.css` — add `position: relative` to `#main`; remove `.view-enter`, `.view-leave`, `@keyframes viewIn`, `@keyframes viewOut`
- `frontend/src/motion.js` — add `transitionViews(prev, next)` export
- `frontend/src/views.js` — rewrite `_showViewRaw` to use `transitionViews` for fallback, pure class swap for VT API path
- `frontend/tests/visual/` — regenerate Playwright snapshots

### Out of scope

- `::view-transition-old/new(main-content)` CSS rules — kept intact (VT API path unchanged)
- `navSlideOutLeft/Right` keyframes — kept (used by VT API directional navigation)
- `@keyframes wlFadeIn` — kept (welcome screen staggered entrance)
- GSAP improvements to other UI zones (separate follow-up)

---

## 5. Accessibility

- `prefers-reduced-motion`: handled by `motion.js` — `transitionViews` collapses to instant when active
- No focus change during transition (views.js does not move focus on nav)
- WCAG 2.2 invariants unaffected — no ARIA roles, labels, or keyboard paths modified

---

## 6. Success criteria

- No visible jump or flash when switching between any sidebar section
- Smooth 150/220ms cross-fade on all navigation pairs
- `npm test` passes
- Visual snapshots updated and reviewed
