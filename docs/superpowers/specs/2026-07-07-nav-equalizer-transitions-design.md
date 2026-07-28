# Navigation Equalizer Transitions — Design Spec

**Date:** 2026-07-07
**Branch:** feat/cinema-overhaul
**Status:** Approved (pending user spec review)

---

## Problem

Navigation between the app's main views (sidebar items, library tabs, Stats, Radio,
Now Playing) currently transitions in two inconsistent ways:

1. **Library sub-views** (`all, liked, recent, artists, albums, genres, playlists, radio`)
   get a directional cross-fade + horizontal slide, driven by `data-nav-dir` on
   `<html>` (see `docs/superpowers/specs/2026-07-01-nav-directional-transitions-design.md`,
   already implemented in `views.js` `setView()`).
2. **Top-level view switches** (`showView()`/`_showViewRaw()` → welcome, scan, stats,
   radio container, now-playing) only get a plain cross-fade (VT API default or the
   `transitionViews()` GSAP fallback) — no direction, no distinguishing character.

Result: navigation feels generic (plain fade), inconsistent (some switches slide +
some don't), and occasionally abrupt (no perceptible motion at all on some paths).
None of it evokes the fact that this is an audio library app.

Separately, the sidebar's active-item indicator (`.ni.on::before`) is a per-item
pseudo-element that pops in/out with no continuity between items — it cannot glide,
since two different pseudo-elements have no shared identity to animate between.

Note: the app already has an "equalizer bars" visual motif — `.eq-bars`/`eq-dance`
in `style.css` (~L1448-1480), a 3-bar `var(--g)`-colored "now playing" indicator on
the active track row, already gated under `data-motion="reduce"`. The design below
deliberately reuses this established visual language (bar width, color, radius, and
an `eq-*`-prefixed keyframe naming convention) for the nav transition accent, rather
than inventing an unrelated new motif — reinforcing that "equalizer bars" already
means something specific in this app ("audio is active here").

---

## Goal

1. Add a small, on-brand "equalizer wave" visual accent that plays on every main-nav
   transition, reusing the existing accent color already tied to "active" state.
2. Extend directional detection (`data-nav-dir`) to cover **all** main-nav switches,
   not just the 8 library sub-views — so Stats/Radio/Now Playing get the same
   direction-aware treatment.
3. Replace the sidebar's per-item indicator pseudo-element with a single real element
   that glides between items instead of popping.

## Non-Goals

- Modals, context menus, Queue/EQ/Settings panels — untouched (separate concern).
- Cinema mode — under active separate rework on this branch.
- `lib-tab` underline (`.lib-tab::after`) — already animates via `scaleX` transition;
  no change requested.
- No per-row/per-track animation of any kind — the track list (up to 50k rows) is
  never touched by this work; the equalizer accent is a fixed-size overlay decoupled
  from list size.
- No new animation duration tokens — reuses `--dur-nav`/`--motion-base`/`--ease-standard`.
- No GSAP for the equalizer bars — pure CSS keyframes + one class toggle.

---

## Architecture

### 1. Equalizer wipe overlay

Static markup, added once (not recreated per-transition):

```html
<div id="nav-eq-wipe" aria-hidden="true">
  <span class="wbar"></span> <!-- ×7 -->
</div>
```

- Positioned `absolute` as a **direct child of `#main`** (which is already
  `position: relative` — `style.css:1056-1063`), pinned to the top edge
  (`top:0; left:0; right:0`), centered horizontally, `pointer-events:none`,
  `opacity:0` at rest. `#main` is the one container present regardless of which
  `.view` is active (`#vhtitle` only exists inside `#vlib` — Stats/Radio/Now
  Playing/Welcome don't have it, so anchoring there would only work for library
  views). `z-index: var(--z-sticky)` — above view content, below dropdowns/modals.
  Never in tab order, never intercepts clicks.
- `.wbar` styling deliberately matches `.eq-bars span` (3px width, `var(--g)`, 1px
  radius, `transform-origin: bottom`) — same bars, different context — rather than a
  new shape. Each `.wbar` gets a fixed `animation-delay` via `:nth-child` (0, 18,
  36… ms) to produce a wave. The `eq-wipe` keyframe (named after the existing
  `eq-dance` convention) rises then falls in height + opacity, timed against
  `--dur-nav`/`--motion-base` (no new duration token) — a one-shot pulse, unlike
  `eq-dance`'s `infinite alternate` loop.
- Color: `var(--g)` — same accent as `.eq-bars`/`.ni.on::before`, so the wipe reads
  as the same "audio-active" visual language already established in the track list.
- **Direction:** `html[data-nav-dir="back"] #nav-eq-wipe { flex-direction: row-reverse; }`
  — reuses the existing `data-nav-dir` attribute; no new JS direction logic needed.

Trigger function (new, small — added to `view-transition.js` or a new sibling module):

```js
export function triggerNavWipe() {
  if (document.documentElement.dataset.motion === 'reduce') return;
  const el = document.getElementById('nav-eq-wipe');
  if (!el) return;
  // 'wiping', not 'playing' — that class name already means audio playback (.playing-row)
  el.classList.remove('wiping');
  void el.offsetWidth; // force reflow, mirrors runViewTransition() pattern
  el.classList.add('wiping');
  setTimeout(() => el.classList.remove('wiping'), 260);
}
```

Called from the same call sites that set `data-nav-dir` (see §2) — one call site
covers both the VT-API path and the GSAP fallback path, since the wipe is an
independent CSS layer, not tied to `::view-transition-*` pseudo-elements.

### 2. Unify directional detection across all main-nav switches — two layers

`setView()`'s existing fine-grained `_NAV_ORDER` (`all/liked/recent/artists/albums/
genres/playlists/radio`) stays exactly as-is — it already fires correctly for
library sub-view navigation. It gains one addition: a `triggerNavWipe()` call
alongside its existing `data-nav-dir` set.

A **separate, coarse** layer is added at `_showViewRaw(v)` (`views.js:113`) — the
single physical DOM-swap function reached by every path: `showView()` (welcome/scan/
now-playing), `_svDispatchView()`'s internal calls (`_showViewRaw('lib'|'stats'|
'radio')`), and `nowplaying.js`'s direct call (`nowplaying.js:233`). This is
deliberately a second, independent order/tracking pair — reusing the fine
`_NAV_ORDER` for this would collapse all library sub-views to the same coarse
target (`'lib'`) and either miss real transitions or double-fire alongside the fine
layer:

```js
const _COARSE_NAV_ORDER = ['welcome', 'lib', 'stats', 'radio', 'now-playing'];
let _lastCoarseView = null; // module-level, seeded on first _showViewRaw() call
```

Inside `_showViewRaw(v)`, before the existing VT-branch: normalize `v` (`'wlc'` →
`'welcome'`; `'scan'` is intentionally excluded from the order — an interstitial,
not a navigable destination, so `indexOf` returns -1 and it falls through to the
existing plain fade, unchanged from today). If both the normalized previous and
current coarse keys are found in `_COARSE_NAV_ORDER` and differ, set `data-nav-dir`
(same attribute the fine layer uses) and call `triggerNavWipe()`. Always update
`_lastCoarseView` at the end, regardless of whether a direction fired.

**Why this doesn't double-fire:** the fine layer only ever compares two fine
sub-view keys (e.g. `albums` → `artists`); when the destination is `stats` or
`now-playing` (not in `_NAV_ORDER`), the fine layer's index lookup returns -1 and
it stays silent — only the coarse layer fires. Conversely, when two fine sub-views
both map to the same coarse container (e.g. `albums` → `artists`, both `'lib'`),
the coarse layer sees no change and stays silent — only the fine layer fires. Each
transition is handled by exactly one layer.

### 3. Sidebar indicator glide

Replace `.ni.on::before` (per-item pseudo-element) with a single real sibling:

```html
<div id="ni-indicator" aria-hidden="true"></div> <!-- inside .sb-nav, absolute -->
```

```css
#ni-indicator {
  position: absolute; left: 0; width: var(--sp-micro); border-radius: 0 var(--r-xs) var(--r-xs) 0;
  background: var(--g);
  transition: transform var(--motion-fast) var(--ease-spring), height var(--motion-fast) var(--ease-spring);
}
```

In `_svMarkNav(v, btn)` (`views.js`), after marking the active item: read the active
`.ni`'s `offsetTop`/`offsetHeight` and set `#ni-indicator`'s `transform: translateY(Npx)`
+ `height` accordingly. Pure layout read + one style write — no rAF loop, no
measurable perf cost. When no `.ni` is active (e.g. drill-down/playlist detail),
`#ni-indicator` collapses to `opacity:0` (mirrors current pseudo-element absence).

---

## Files

| File | Change |
|---|---|
| `frontend/index.html` | + `#nav-eq-wipe` (7 `.wbar` children) near `#content-area`; + `#ni-indicator` inside `.sb-nav` |
| `frontend/src/style.css` | + `.wbar`/`eq-wipe` keyframes + direction reversal rule; replace `.ni.on::before` rule with `#ni-indicator` positioning/transition rules |
| `frontend/src/view-transition.js` | + `triggerNavWipe()` |
| `frontend/src/views.js` | call `triggerNavWipe()` alongside existing `data-nav-dir` logic in `setView()`; add `_COARSE_NAV_ORDER`/`_lastCoarseView` + coarse direction-detection + `triggerNavWipe()` call to `_showViewRaw()`; extend `_svMarkNav()` to position `#ni-indicator` |

---

## Accessibility

- `#nav-eq-wipe` and `#ni-indicator`: `aria-hidden="true"`, `pointer-events:none` —
  purely decorative, no change to the a11y tree, no change to tab order.
- `aria-current`/`.on` semantics on `.ni`/`.lib-tab` are untouched — `#ni-indicator`
  is a cosmetic layer on top of the existing, unchanged source of truth.
- `prefers-reduced-motion`/in-app 3-state motion pref (`motion.js`): `triggerNavWipe()`
  short-circuits under `data-motion="reduce"`; `#ni-indicator`'s CSS transition
  collapses to instant under the same attribute (existing global reduced-motion CSS
  gate, extended to cover the new rule if not already blanket-covered).

---

## Invariants (CLAUDE.md)

- No `tracks[]`/`_trackIdxMap`/`virt.js`/`audio.volume`/IDB/IPC touched.
- No new dependency (pure CSS + a few lines of JS reusing existing modules).
- No per-row/list-size-dependent animation — overlay is fixed at 7 nodes regardless
  of library size; `npm run bench` unaffected.
- Functions stay well under 50 lines; `triggerNavWipe()` and the `_svMarkNav()`
  extension are a handful of lines each.
- No `console.log`, no external network calls, no `innerHTML` with untrusted content.

---

## Test Plan

- `frontend/tests/a11y.test.cjs`: assert `aria-hidden="true"` on `#nav-eq-wipe` and
  `#ni-indicator`; assert neither is reachable via Tab.
- `frontend/tests/core.test.cjs`: unit test the pure position-calculation logic used
  to place `#ni-indicator` (given an element's offsetTop/offsetHeight, expected
  transform/height output) — no dependency on real animation timing.
- Manual smoke (same pattern as the 2026-07-01 spec):
  1. Navigate sidebar items and library tabs both directions — confirm slide +
     equalizer wave play in the matching direction.
  2. Navigate to Stats, then Radio, then Now Playing, then back to library — confirm
     the same directional slide + wave now applies (previously plain fade).
  3. Confirm the sidebar indicator glides smoothly between items instead of popping.
  4. Rapid-click through several nav items — no visual glitch, no stacked timers.
  5. Enable OS/in-app reduced motion — all of the above becomes instant, no wave,
     no glide.
  6. Confirm `npm run bench` shows no regression (overlay is size-independent).
