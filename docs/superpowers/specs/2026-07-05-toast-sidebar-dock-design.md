# Toast Sidebar Dock — Design Spec

**Date:** 2026-07-05
**Branch:** feat/cinema-overhaul
**Status:** Approved

---

## Problem

`<lf-toast-stack>` currently docks to the top-right corner, below the
titlebar (`docs/superpowers/specs/2026-07-04-toast-position-design.md`,
`frontend/src/components/lf-toast-stack.js:36-47`). The sidebar's nav list
(`.sb-nav`, `style.css:934-939`) is a scrollable flex container that often
has visible empty space at the bottom when a user has few playlists — a
past rework (`style.css:1036`) deliberately removed the old sidebar footer
content and relocated it to the titlebar dropdown (`#sb-more-pop`), but the
resulting empty space at the bottom of the column reads as wasted room.

---

## Goal

Dock the toast stack to the bottom of the sidebar column when the sidebar
is present as a normal full-height vertical column (the common desktop
case), so it fills that space instead of floating in the top-right corner —
while falling back to the existing top-right corner behavior whenever the
sidebar isn't in that shape.

---

## Non-Goals

- No JS/logic change. This is pure CSS: the docking condition reuses DOM
  state that's already set by other code (`#app.np-full` class set by
  `nowplaying.js`, `html[data-platform="mobile"]` attribute, and the
  existing `@media (max-width: 719px)` compact breakpoint) — no new
  attribute, class, or JS wiring is introduced.
- No DOM re-parenting. `<lf-toast-stack>` stays appended to `document.body`
  exactly as today (`ui.js:33-40`, `_getStack()`) — docking is achieved by
  `position: fixed` coordinates that match the sidebar's on-screen rectangle,
  not by moving the element inside `#sb`.
- No change to `lf-toast-stack.logic.js`, `ui.js`, the stack cap (`MAX_TOASTS
  = 5`), the ring/background/radius/icon/progress-bar visual treatment
  (`docs/superpowers/specs/2026-07-05-toast-visual-style-design.md`), or the
  entrance/exit animation direction.
- No reduced-cap-when-docked mechanism. A stack of up to 5 toasts docked at
  the bottom of the sidebar could temporarily cover part of the playlist
  list. Accepted as a known tradeoff for this iteration — not addressed
  here, revisit only if it turns out to be a real problem in practice.
- No change to the corner fallback's own values — the three fallback
  conditions re-declare exactly what's already shipped
  (`top: calc(var(--tb, 32px) + 12px); right: var(--sp-4, 16px); align-items:
  flex-end`, plus the existing 260px/568px width range), so nothing regresses
  for mobile/fullscreen/narrow-window users.
- No animated transition between docked and corner state. If the mode
  changes while a toast is visible (e.g. the user enters now-playing
  fullscreen mid-toast, or resizes across the 719px breakpoint), the toast
  jumps to its new position instantly rather than sliding — individual
  toast entrance/exit animations are unaffected.

---

## Design

### Docking condition

Default rule (applies whenever none of the fallback selectors below match):
sidebar-docked. The three fallback conditions, in the order they appear in
`frontend/src/components/lf-toast-stack.js`'s `static styles`:

1. `:host-context(#app.np-full)` — now-playing fullscreen. Confirmed via
   `style.css:6883-6889`: `.np-full { --sb: 0px; } .np-full #sb { overflow:
   hidden; pointer-events: none; }` — the sidebar column collapses to zero
   width and stops being interactive, so a docked toast would be invisible
   there if left in the default state.
2. `:host-context(html[data-platform="mobile"])` — confirmed via
   `style.css:6614-6619`: `.sb-nav` flips to `flex-direction: row` (a 56px
   horizontal icon bar), no room for a card.
3. `@media (max-width: 719px)` — the existing compact breakpoint. Confirmed
   via `style.css:6507-6523`: `:root { --sb: var(--sb-sm); }` (54px,
   `design-system.css:487`) and `.pl-list-nav { display: none; }` — sidebar
   becomes icon-only with no playlist list, no room for readable toast text.

All three are selectors already available to `:host-context()` /
`@media` — no new global state needs to be introduced.

### Docked position & sizing

The sidebar's own vertical span is established by the app grid
(`style.css:762-769`: `grid-template-areas: "tb tb" "sb main" "pl pl"` — the
sidebar shares its row with `#main` only, never with the player-bar row) and
already has a proven CSS pattern in `#queue-panel`/`#eq-panel`
(`style.css:3871-3872`: `top: var(--tb); height: calc(100% - var(--tb) -
var(--pb))`). The toast stack reuses the same span, anchored to the bottom
of it:

```css
:host {
  position: fixed;
  bottom: calc(var(--pb) + var(--sp-2));
  left: var(--sp-2);
  width: calc(var(--sb) - var(--sp-4));
  display: flex;
  flex-direction: column-reverse;
  align-items: stretch;
  gap: 8px;
  z-index: 9999;
  pointer-events: none;
  font-family: var(--lf-font-ui, var(--font-body));
}
```

`width: calc(var(--sb) - var(--sp-4))` rides on the same `--sb` custom
property the sidebar's own grid column uses, so it tracks the sidebar live
as the user drags `#sb-resize` (200–420px range) and as the compact
breakpoint swaps in `--sb-sm`. `align-items: stretch` replaces the corner
mode's `flex-end` since the card now spans the column width instead of
hugging a right edge. `flex-direction: column-reverse` is unchanged — the
newest toast still lands nearest the anchored edge (now the bottom of the
sidebar column), older ones pushed upward, same convention already
established for both the original bottom-center and current top-right
anchors.

`.t-item`'s own `min-width`/`max-width` (260px/568px, sized for the corner
card) do not apply meaningfully once the host's `width` is constrained to
the sidebar column — the item naturally fills the host via the flex
container; no change needed to `.t-item` itself.

### Corner fallback (unchanged values, new conditional wrapper)

```css
:host-context(#app.np-full),
:host-context(html[data-platform="mobile"]) {
  bottom: auto;
  left: auto;
  width: auto;
  top: calc(var(--tb, 32px) + 12px);
  right: var(--sp-4, 16px);
  align-items: flex-end;
}
@media (max-width: 719px) {
  :host {
    bottom: auto;
    left: auto;
    width: auto;
    top: calc(var(--tb, 32px) + 12px);
    right: var(--sp-4, 16px);
    align-items: flex-end;
  }
}
```

These re-declare exactly the values already shipped in the current
`:host` rule (`lf-toast-stack.js:36-47`) — a straight copy, not a new
design.

### Everything else

Ring, background (dark + light-mode override), border-radius, icon
rendering, the bottom progress bar, entrance/exit animation direction, the
stack cap (5), and all logic/JS are untouched by this change.

---

## Files

| File | Change |
|---|---|
| `frontend/src/components/lf-toast-stack.js` | `:host` rule (docked-by-default position/sizing); two new conditional blocks (`:host-context` for np-full/mobile, `@media` for compact) restoring the current corner values as fallback |

No other file changes. `lf-toast-stack.logic.js` and `ui.js` are untouched.

---

## Accessibility

- `role`/`aria-live` behavior is unaffected — position doesn't change
  screen-reader announcement.
- The docked card still meets the same non-text contrast and focus-ring
  requirements as the corner card — no color/sizing change, only container
  position and width.
- Docking at the bottom of the sidebar does not overlap any existing
  focusable sidebar control: the sidebar's own bottom edge has no persistent
  footer content since the prior rework (`style.css:1036`), and the toast
  sits above the player-bar row entirely (`bottom: calc(var(--pb) +
  var(--sp-2))`), never over transport controls.
- A toast docked at the sidebar's bottom can visually cover part of the
  scrollable `.sb-nav`/`#pl-list-nav` content underneath it while visible
  (accepted tradeoff, see Non-Goals) — this does not trap focus or block
  keyboard navigation of the covered items permanently, since the toast is
  ephemeral and `pointer-events: none` on `:host` already lets clicks pass
  through the host's own empty space (only `.t-item` itself, `pointer-events:
  auto`, captures clicks).

---

## Invariants (CLAUDE.md)

- No external network calls — unaffected.
- No `console.log` added.
- No `tracks[]` mutation — unaffected.
- No CSS selector mixing id + class — `:host-context(#app.np-full)` and
  `:host-context(html[data-platform="mobile"])` are each single-class /
  single-attribute selectors inside `:host-context()`, not a mixed
  id+class compound selector; `#app.np-full` matches an existing pattern
  already used elsewhere in this codebase for the same class
  (`style.css:6883`, itself previously audited and confirmed compliant per
  the `AUDIT-2026-07-01 M1` comment there — the class alone carries the
  semantics, `#app` is only the `:host-context` anchor point, not a new
  mixed selector authored by this change).
- No new design tokens — reuses `--sb`, `--sp-2`, `--sp-4`, `--pb`, `--tb`,
  all pre-existing.

---

## Test Plan

**Automated:**

1. `npm test` — no logic touched, should remain at the current baseline
   count.
2. `frontend/tests/visual/lit-toast.spec.js` — these snapshots render the
   component in isolation at a fixed 900×600 viewport with the seeded app's
   default (non-mobile, non-np-full, non-compact) state, so the toast will
   render in its new *docked* position/width — the two existing baselines
   (`lf-toast-info`, `lf-toast-error`) are expected to change shape (docked
   width instead of corner width) and must be regenerated, following the
   same process used in the visual-style task.

**Manual smoke test** (`npm run dev`, or Playwright-measured if no
interactive window is available):

1. On a normal desktop-width window (sidebar visible as a full column, not
   now-playing fullscreen), trigger a toast → confirm it appears docked at
   the bottom of the sidebar, spanning close to the sidebar's width, above
   the player bar.
2. Drag `#sb-resize` to change the sidebar width → trigger a toast → confirm
   its width tracks the resized sidebar.
3. Enter now-playing fullscreen (`.np-full`) → trigger a toast → confirm it
   falls back to the top-right corner (current behavior), not hidden behind
   the collapsed sidebar.
4. Resize the window below 719px width → trigger a toast → confirm it falls
   back to the top-right corner, not squeezed into the 54px icon-only
   sidebar.
5. If a mobile platform build/profile is available to test, confirm the
   same top-right fallback there; if not testable in this environment,
   disclose that explicitly rather than fabricating a check.
6. Trigger 3 toasts in quick succession while docked → confirm newest lands
   nearest the bottom (sidebar/player-bar boundary), older pushed upward,
   and that the stack doesn't overflow above the titlebar even with 5
   toasts visible on a short window.
