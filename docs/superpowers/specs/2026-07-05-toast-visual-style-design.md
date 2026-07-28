# Toast Visual Style — Design Spec

**Date:** 2026-07-05
**Branch:** feat/cinema-overhaul
**Status:** Approved

---

## Problem

`<lf-toast-stack>` was recently moved from bottom-center to top-right
(`docs/superpowers/specs/2026-07-04-toast-position-design.md`). Visually it
still carries its original Material Snackbar look — a wide, uniform dark
slab, `min-width: 288px`, differentiated only by icon color and a thin
bottom progress bar (`frontend/src/components/lf-toast-stack.js:34-153`,
comment at line 35: "Google Material Snackbar look — single dark slab, accent
via icon + thin progress bar only").

That shape was designed for a bottom-center bar. Anchored in a corner, next
to the app's other corner-anchored floating card — `#mp-ov`, the mini-player
overlay (`style.css:6107-6127`) — the toast reads as a wide bar left over
from its old position rather than a card that belongs in that corner.
`#mp-ov` uses a tinted 1px ring (`box-shadow: var(--mini-glow)` = `0 0 0 1px
rgba(var(--g-rgb),.20)`, `style.css:1097`) instead of a solid border, plus
the same `--radius-md`-derived corner radius the toast already uses
(`--r-card: var(--radius-md)`, `design-system.css:818`).

---

## Goal

Bring the toast's shape and depth cues in line with `#mp-ov`'s corner-card
language — a tinted ring instead of a plain drop shadow, and a narrower
footprint — while keeping every other visual and behavioral property
(background, radius, icon, progress bar, per-type semantics, all JS/logic)
exactly as-is.

---

## Non-Goals

- No background tint/wash per type (rejected explicitly — the current dark
  background in dark mode and light override in light mode stay untouched).
- No change to `--glass-toast`, the light-mode background override, or any
  color token definitions.
- No new CSS custom properties or `-rgb` token variants (e.g. no
  `--state-success-rgb`/`--state-error-rgb`) — the ring reuses the
  already-existing `--lf-toast-accent` custom property that each `.t-info` /
  `.t-success` / `.t-error` / `.t-warning` / `.t-loading` rule already sets
  (`lf-toast-stack.js:76-80`), via `color-mix()`, matching the pattern
  already used elsewhere in the codebase for tinted rings (e.g.
  `--shadow-art-col2`, `design-system.css:971`).
- No change to `lf-toast-stack.logic.js`, `ui.js`, radius, icon, progress
  bar, entrance/exit animation, or stack anchor position (all from the prior
  spec, untouched here).

---

## Design

### Ring (tinted shadow layer)

Add a second `box-shadow` layer to `.t-item` (`lf-toast-stack.js:57`) and its
hover state (`:72`), keyed to the already-computed `--lf-toast-accent`:

```css
.t-item {
  /* ...unchanged... */
  box-shadow: var(--shadow-lg), 0 0 0 1px color-mix(in srgb, var(--lf-toast-accent) 35%, transparent);
}
.t-item:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-xl, var(--shadow-lg)), 0 0 0 1px color-mix(in srgb, var(--lf-toast-accent) 55%, transparent);
}
```

Because `--lf-toast-accent` is already set per type
(`--accent` for info, `--state-success` for success, `--state-error` for
error, `--amber` for warning, `--accent` for loading —
`lf-toast-stack.js:76-80`), the ring automatically picks up the right color
per toast with zero new per-type CSS: an error toast gets a red-tinted ring,
success a green one, matching the icon and the bottom progress bar it
already shows.

### Sizing

```css
.t-item {
  min-width: 260px; /* was: 288px */
  max-width: 568px; /* unchanged */
}
```

260px sits close to `#mp-ov`'s own `--shelf-w: 280px`
(`design-system.css:613`), reading as a corner card rather than a
carried-over wide bar. `max-width` stays at 568px so long messages still
have room to breathe.

### Everything else

Border-radius (`--radius-md`), icon rendering, the bottom progress bar
(`.t-bar`), the entrance/exit slide animation, and the top-right anchor
position are all untouched by this change. Background (`--lf-toast-bg` /
`--glass-toast` in dark) is also untouched.

Note: the light-mode `:host-context(html[data-mode="light"])` override
defines its own complete `box-shadow` (higher specificity than
`.t-item`/`.t-item:hover`), so it required its own ring addition to match
dark mode — see the Ring section above.

---

## Files

| File | Change |
|---|---|
| `frontend/src/components/lf-toast-stack.js` | `.t-item` and `.t-item:hover` `box-shadow` rules (add ring layer); `.t-item` `min-width` (288px → 260px) |

No other file changes. `lf-toast-stack.logic.js` and `ui.js` are untouched.

---

## Accessibility

- Non-text contrast: the ring is an *additional* visual cue layered on top
  of the existing icon-color + progress-bar signal, not a replacement for
  either — screen reader behavior (`role`/`aria-live`) is unaffected, and no
  color-only information is introduced (the ring doesn't carry new meaning
  beyond what the icon and bar already convey).
- The dual-tone focus ring on the close/action buttons inside a toast is
  untouched — this task only adds a shadow to the outer `.t-item` container,
  not to any focusable child element.
- `min-width` reduction (288px → 260px) does not affect any focusable
  target's size — the touch targets inside (`.t-close`, `.t-action`) keep
  their own padding/sizing untouched.

---

## Invariants (CLAUDE.md)

- No external network calls — unaffected.
- No `console.log` added.
- No `tracks[]` mutation — unaffected.
- No CSS selector mixing id + class — the changed rules are all on existing
  class selectors (`.t-item`, `.t-item:hover`), no new selector introduced.
- No new design tokens added, per Non-Goals — reuses `--lf-toast-accent`
  (already defined) and the `color-mix()` idiom already used elsewhere in
  `design-system.css`.

---

## Test Plan

**Automated:**

1. `npm test` — `lf-toast-stack.logic.js` reducer tests are untouched and
   should still pass (no logic changed).
2. `frontend/tests/visual/lit-toast.spec.js` — snapshots `<lf-toast-stack>`
   with an info toast and an error toast. This IS a visual/shape change
   (new shadow layer, narrower min-width), so both baselines are expected
   to change and must be regenerated (`npm run test:visual:update --
   lit-toast.spec.js`) as part of this task, then re-run
   (`npm run test:visual -- lit-toast.spec.js`) to confirm the new
   baselines pass and to eyeball the diff images before committing them.

**Manual smoke test** (`npm run dev`, or Playwright-measured if no
interactive window is available, per the precedent set in the position
task):

1. Trigger an info toast → confirm a subtle blue-tinted ring is visible
   around the card, in addition to the existing drop shadow.
2. Trigger an error toast (persistent, closable) → confirm the ring is
   red-tinted, matching the error icon and progress bar color.
3. Trigger a success and a warning toast → confirm green and amber rings
   respectively.
4. Hover over any toast → confirm the ring visibly intensifies (35% → 55%
   mix) alongside the existing lift/shadow-xl hover effect.
5. Compare visually against `#mp-ov` (open the mini-player overlay) → both
   should read as the same "floating corner card" family (ring instead of
   solid border, similar radius).
6. Confirm long messages still wrap/fit within `max-width: 568px` without
   layout breakage at the new `min-width: 260px`.
