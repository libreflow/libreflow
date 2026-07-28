# Toast Position — Design Spec

**Date:** 2026-07-04
**Branch:** feat/cinema-overhaul
**Status:** Approved

---

## Problem

`<lf-toast-stack>` (`frontend/src/components/lf-toast-stack.js`) is anchored
bottom-center, just above the player bar:

```css
:host {
  position: fixed;
  bottom: calc(var(--pb, 96px) + 16px);
  left: 50%;
  transform: translateX(-50%);
}
```

This puts every toast directly over the zone the user is actively looking at
while listening — near the transport controls and directly above `#sel-bar`
(the multi-select action bar), which occupies the exact same bottom-center
slot (`style.css:5737`, `bottom: calc(var(--pb) + var(--sp-2h))`). A toast
firing during multi-select or during active playback distracts from what the
user is doing right now.

---

## Goal

Move the toast stack to the top-right corner — below the custom titlebar
(`#tb`), clear of the window controls (`.tb-btns.tb-right`: minimize /
maximize / close, `index.html:88-98`) — so notifications no longer compete
with playback controls or the bottom-center selection bar.

---

## Non-Goals

- No change to `lf-toast-stack.logic.js` (reducer, `TOAST_DUR`, types,
  `resolveDuration`) — this is a pure presentation change.
- No change to the public `ui.js` façade (`toast()`, `toastWithAction()`) —
  callers are unaffected.
- No dynamic collision-avoidance with `#queue-panel` / `#eq-panel` (right-side
  slide-out panels). Toasts already render above everything else
  (`z-index: 9999` vs. panel `z-index: 50`); when a panel is open a toast may
  visually sit above its edge, same tradeoff that already exists today for
  other overlays. Not addressed here — toasts are transient and this is
  acceptable.
- No RTL handling — libreflow is fr/en only.

---

## Design

### Anchor

```css
:host {
  position: fixed;
  top: calc(var(--tb) + 12px);
  right: var(--sp-4);
  /* left / transform: translateX(-50%) removed */
  align-items: flex-end; /* was: center */
}
```

`--tb` already scales per breakpoint (32px default, 28px narrow — see
`style.css:3946,3952`), so the offset stays correct at every window size, the
same way the current rule rides on `--pb`.

### Stack growth direction

The stack keeps the same entrance semantics it has today — the newest toast
appears nearest the anchored edge, older toasts get pushed away from it. Today
that edge is the bottom (near the player bar); after this change it's the top
(near the titlebar). This falls out of the existing `column-reverse` +
append-to-end-of-array logic; no reducer change needed, only re-verifying the
visual order once the anchor edge flips (manual check in the test plan).

### Entrance / exit animation

Slide direction changes from vertical to horizontal, matching a corner-anchored
notification (Windows/macOS notifications slide in from the screen edge
they're pinned to, not from the opposite edge):

```css
@keyframes t-in  { from { transform: translateX(24px); opacity: 0; } }
@keyframes t-out { to   { transform: translateX(24px); opacity: 0; } }
```

(`translateY(20px)` → `translateX(24px)`, both directions, in `t-in`/`t-out`.)

### Hover / active transforms

`.t-item:hover { transform: translateY(-1px); }` stays as-is — a small lift
reads fine regardless of corner.

---

## Files

| File | Change |
|---|---|
| `frontend/src/components/lf-toast-stack.js` | `:host` anchor rule (`top`/`right` instead of `bottom`/`left`+centering), `align-items`, `t-in`/`t-out` keyframes |

No other file changes. `lf-toast-stack.logic.js` and `ui.js` are untouched.

---

## Accessibility

- `role="alert"`/`role="status"` + `aria-live` are unaffected — screen reader
  announcement doesn't depend on visual position.
- Focus is never programmatically moved to a toast (they're not
  keyboard-focus targets except the close/action buttons inside them, which
  keep their existing tab order and focus ring).
- Non-text contrast, dual-tone focus ring, and target size (`--target-min`)
  are unchanged — no color or sizing touched, only position and slide axis.
- `prefers-reduced-motion` handling (if any exists at the animation level) is
  unaffected by changing the translate axis.

---

## Invariants (CLAUDE.md)

- No external network calls — unaffected.
- No `console.log` added.
- No `tracks[]` mutation — unaffected.
- No CSS selector mixing id + class — the changed rules are all on `:host`
  and existing class selectors, no new mixed selector introduced.
- Functions/files stay well under the line caps — this is a ~10-line CSS diff.

---

## Test Plan

**Automated:**

1. `npm test` — `lf-toast-stack.logic.js` reducer tests are untouched and
   should still pass (no logic changed).
2. `frontend/tests/visual/lit-toast.spec.js` — snapshots the
   `<lf-toast-stack>` element's own bounding box, not its page position, so
   existing baselines should still match. Re-run to confirm; regenerate
   baselines only if the bounding-box content itself changed (it shouldn't).

**Manual smoke test** (`npm run dev`):

1. Trigger an info toast (e.g. rename a playlist) → appears top-right, below
   the titlebar, clear of minimize/maximize/close buttons.
2. Trigger 3 toasts in quick succession → confirm newest appears nearest the
   top edge, older ones pushed downward, still readable and not overlapping
   the titlebar.
3. Enter multi-select mode (`#sel-bar` visible, bottom-center) and trigger a
   toast → confirm no visual overlap with the selection bar.
4. Open the queue panel (right-side slide-out) and trigger a toast → confirm
   toast still renders above the panel, readable.
5. Trigger an error toast (persistent, closable) → confirm the close button
   is reachable and click/keyboard-dismissable in the new position.
6. Resize window to the narrow breakpoint (`--tb: 28px`) → confirm toast still
   clears the titlebar buttons.
