# EQ trigger relocation — from playerbar to "More options" menu

**Date:** 2026-07-05
**Status:** Approved

## Problem

The equalizer trigger (`#btn-eq`, `data-action="toggle-eq"`) currently lives in the
playerbar's `.pl-r` group, alongside the queue button, speed button, and volume
control. The user wants it moved out of the playerbar and its opening integrated
elsewhere in the UI.

## Decision

Move `#btn-eq` into the titlebar's "More options" popover (`#sb-more-pop`,
triggered by `#sb-more-btn`), grouped with **Thème** and **Paramètres** — i.e.
placed right after the "Paramètres" item and before the `<hr class="sb-more-sep">`
separator that currently divides config items (Thème/Paramètres) from
mode/view toggles (Mini-player/Mode cinéma/Statistiques/Minuterie).

Rationale: the EQ panel is configuration-adjacent (the Settings panel already
hosts a per-device EQ profile section), and `#sb-more-pop` already holds the
established pattern for panel-toggle menu items (`#tbt-settings` uses
`aria-expanded` + `aria-controls`, exactly what `#btn-eq` needs).

## Scope

- **HTML** (`frontend/index.html`):
  - Remove the `#btn-eq` `<button>` from `.pl-r` in the playerbar.
  - Add an equivalent `<button class="sb-more-item" id="btn-eq" role="menuitem">`
    inside `#sb-more-pop`, after `#tbt-settings` and before the `<hr class="sb-more-sep">`.
  - Same id (`btn-eq`), same `data-action="toggle-eq"`, same EQ SVG icon
    (reused verbatim), same i18n key (`pl_eq_title`) for both the visible
    label `<span>` and `aria-label`/`data-aria-i18n`.
  - Keep `aria-expanded="false" aria-controls="eq-panel"` (no `aria-haspopup`,
    matching `#btn-queue`'s pattern rather than `#tbt-settings`'s dialog
    pattern, since `#eq-panel` is a docked slide-out panel, not a modal).

- **CSS** (`frontend/src/style.css`): none. `.sb-more-item` already provides
  icon sizing, hover, focus-visible, and active-state styling; no new rules
  needed.

- **JS**: none. `eq.js` (`toggleEQ`/`closeEQ`) and `handlers.js`
  (`'toggle-eq'` action) look up `#btn-eq` purely by id, independent of its
  DOM location. Clicking the relocated item auto-closes `#sb-more-pop`
  because the existing `toggle-sb-more` document-click listener closes the
  popover on any click outside `#sb-more-btn` itself, which already covers
  clicks on sibling menu items (same behavior as `#tbt-settings`/`#tbt-cinema`
  today).

- **Tests**: two Playwright specs click `#btn-eq` directly, assuming it's
  always visible in the playerbar. Since it now lives inside `#sb-more-pop`
  (hidden by default until `#sb-more-btn` is clicked), both need an extra
  step to open the popover first:
  - `frontend/tests/e2e/a11y.spec.js` — `'#btn-eq toggles aria-expanded and reveals the panel'`
  - `frontend/tests/visual/responsive.spec.js` — `'eq panel open'`

  No other test (static `.cjs` suites) assumes `#btn-eq`'s DOM location.

## Out of scope

- `frontend/tests/e2e/a11y.spec.js`'s `openSettingsPanel()` helper references
  stale ids (`#tbt-burger` / `#tb-burger-panel`) that no longer exist in
  `index.html` (the actual ids are `#sb-more-btn` / `#sb-more-pop`). This is a
  pre-existing, unrelated breakage — not touched by this change.
- No new i18n keys, no CSS changes, no changes to `eq.js` panel behavior.
