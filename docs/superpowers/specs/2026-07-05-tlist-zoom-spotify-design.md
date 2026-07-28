# Track List Zoom — Spotify-Quality Density — Design Spec

**Date:** 2026-07-05
**Branch:** feat/cinema-overhaul
**Status:** Approved

---

## Problem

The track-list density feature (`tlistZoom.js`, Ctrl+scroll or Settings ›
"Densité de la liste") only ever changes row height (`--tr-h`). Everything
else inside the row is static:

- Album art (`.tart`) is hard-coded to `var(--icon-36)` (36px) at every
  density — Compact rows just add dead padding around the same-size art,
  Comfortable rows have visibly empty vertical space around it.
- The three levels are named Compact / **Normal** / Confortable, which
  doesn't match the reference the user wants to match — Spotify's desktop
  density setting is **Compact / Comfortable / Spacious**, with Comfortable
  as the default, and art that visibly scales with density.
- `#zoom-hud` (`index.html:1583`) is markup with zero styling and zero JS
  wiring — a HUD element was clearly planned (it already has
  `role="status" aria-live="polite" aria-atomic="true"`) but never finished.
  Changing density today (wheel or radio buttons) gives no feedback at all.

## Goal

Make the density feature match Spotify's actual list-density UX:
art scales with row height, the three levels are named and defaulted the
way Spotify does it, and changing density (any input method) shows a brief,
accessible HUD confirming the new level.

## Non-Goals

- No change to the Ctrl+scroll gesture itself (throttle, direction) —
  `initTlistZoomWheel()` stays as-is.
- No 4th/5th density level. `CFG.VIRT_ROW_H_MICRO`/`_SPACIOUS` in `cfg.js`
  are dead (never read by `tlistZoom.js`) and are removed as part of this
  change rather than wired up — a "Micro" row (28px) would sit below the
  44px WCAG 2.5.8 floor (`.tr { min-height: 44px }`) and isn't viable.
- No change to `.tr--album-detail` layout (flex, track-number column) beyond
  what it inherits automatically by sharing the `.tart`/`.tr` classes.
- No change to group-header height (`VIRT.GRP_H`, 28px) — Spotify has no
  A–Z grouping equivalent to model this on; it already renders correctly at
  every density (inline `style="height"`, not CSS-driven) and isn't part of
  the reported problem.

---

## Design

### 1. Renamed, re-proportioned levels

| Level | `data-tlist-zoom` (stored value) | Row height (`--tr-h`) | Art (`--tart-size`) |
|---|---|---|---|
| Compact | `compact` | 44px *(WCAG 2.5.8 floor — unchanged)* | 32px |
| **Comfortable** (default) | `comfortable` | 56px | 40px |
| Spacious | `spacious` | 72px | 56px |

Font sizes are untouched at every level (Spotify keeps text constant across
densities too — only row height and art size change).

`--art-list` (the 56px grid column reserved for artwork) stays fixed at
every level — Spacious art (56px) exactly fills it, Compact/Comfortable art
sits centered inside it via the existing `justify-self: center` fix already
on `.tart`. No column-width churn between levels.

### 2. New CSS token: `--tart-size`

`.tart`'s `width`/`height` currently read `var(--icon-36)`, a *shared* token
also used by `.q-art` (queue), `.stat-card-ico`, and one more site
(`style.css:6416`) — it cannot be repointed without affecting those. A new,
`.tart`-only token is introduced instead:

```css
/* design-system.css, alongside --tr-h */
--tart-size: 40px;   /* défaut = Comfortable ; piloté par [data-tlist-zoom] */
```

```css
/* design-system.css, alongside the existing --tr-h zoom overrides */
:root[data-tlist-zoom="compact"]  { --tr-h: 44px; --tart-size: 32px; }
:root[data-tlist-zoom="spacious"] { --tr-h: 72px; --tart-size: 56px; }
```

```css
/* style.css — .tart */
width: var(--tart-size); height: var(--tart-size);
```

No clipping risk at any level: `.tr` clips (`overflow: hidden`) at its own
border-box edge, not at the padding line, and art (32–56px) always fits
inside the row's border-box height (44–72px) at every level — verified by
hand for all three combinations.

### 3. Renamed level identifiers + legacy migration

`TLIST_ZOOM_LEVELS` becomes `['compact', 'comfortable', 'spacious']`.
Persisted `cfg.tlistZoom` values from before this change (`'normal'`,
`'comfortable'`) are remapped once, centrally, inside `setTlistZoom()` so
existing saved configs keep their *relative* density instead of silently
snapping to a default or getting rejected by the `TLIST_ZOOM_LEVELS.includes()`
guard:

```js
const _LEGACY_ZOOM_MAP = { normal: 'comfortable', comfortable: 'spacious' };

export function setTlistZoom(level) {
  level = _LEGACY_ZOOM_MAP[level] || level;
  if (!TLIST_ZOOM_LEVELS.includes(level)) { … }
  …
}
```

Every fallback/default site that currently reads `|| 'normal'` changes to
`|| 'comfortable'` so a never-configured install lands on the new default
correctly — found by grep, six sites total:

- `app.js:438` — boot: `setTlistZoom((cfg && cfg.tlistZoom) || 'normal')`
- `cfgsave.js:104` — persist: `get('tlistZoom') || 'normal'`
- `settings.js:345` — `_syncTlistZoomRadios()` fallback
- `tlistZoom.js:40` — `_nextZoomLevel()`'s not-found fallback
  (`idx === -1 → return 'normal'`)
- `tlistZoom.js:80`/`:86` — `tlistZoomIn()`/`tlistZoomOut()` fallback when
  no cfg value is set yet
- `tlistZoom.js:92` — `tlistZoomReset()` explicitly calls
  `setTlistZoom('normal')`; becomes `setTlistZoom('comfortable')`

`types.js:170`'s `ZoomLevel` typedef (`'compact'|'normal'|'comfortable'`)
is updated to `'compact'|'comfortable'|'spacious'`.

Because `setTlistZoom()` runs every incoming value through
`_LEGACY_ZOOM_MAP` first, any of these fallback sites passing the *old*
`'normal'` string through would still resolve correctly even if one were
missed — the migration map is the actual safety net; updating every
fallback site is a consistency/cleanliness pass on top of it, not a
correctness requirement.

### 4. `#zoom-hud` — wired up

A small pill, centered near the top of `#tlist`, shows the new level's
translated label for ~1.2s then fades out. Triggered from inside
`setTlistZoom()` (single call site → covers wheel, radios, and any future
keyboard shortcut alike):

```js
let _hudTimer = null;
function _showZoomHud(level) {
  const hud = document.getElementById('zoom-hud');
  if (!hud) return;
  hud.textContent = i18n(`tlist_zoom_${level}`) || level;
  hud.classList.add('show');
  clearTimeout(_hudTimer);
  _hudTimer = setTimeout(() => hud.classList.remove('show'), 1200);
}
```

CSS (new, `style.css`):

```css
#zoom-hud {
  position: fixed; top: calc(var(--tb) + 12px); left: 50%;
  transform: translateX(-50%) translateY(-6px);
  background: var(--bg3); color: var(--t); border: 1px solid var(--sep);
  padding: var(--sp-1p) var(--sp-3); border-radius: var(--r-pill);
  font-size: var(--fs-xs); font-weight: 600; letter-spacing: var(--ls-caps);
  text-transform: uppercase; box-shadow: var(--shadow-lg);
  opacity: 0; pointer-events: none; z-index: var(--z-toast);
  transition: opacity var(--dur-fast) ease, transform var(--dur-fast) ease;
}
#zoom-hud.show { opacity: 1; transform: translateX(-50%) translateY(0); }
html[data-motion="reduce"] #zoom-hud { transition: opacity var(--dur-fast) ease; }
```

Reuses `role="status" aria-live="polite" aria-atomic="true"` already on the
element in `index.html` — screen readers announce the new density the same
way any other status message is announced; no extra ARIA needed.

### 5. i18n

`i18n.fr.js` / `i18n.en.js`:

- `tlist_zoom_normal` → renamed to `tlist_zoom_comfortable` (reuses the
  existing "Confortable"/"Comfortable" string — that's now the *middle*
  level's label).
- New `tlist_zoom_spacious`: FR "Spacieux", EN "Spacious" (this is the
  *old* "Comfortable" level, renamed).
- `tlist_zoom_compact` / `tlist_zoom_label` unchanged.

`index.html` settings radio group: 3rd `<label>` gets
`value="spacious"` / `data-i18n="tlist_zoom_spacious"`; 2nd gets
`value="comfortable"` (was `normal`) and `checked` moves to it (new default).

### 6. Dead-code cleanup (in scope, directly related)

`cfg.js`: remove `VIRT_ROW_H_MICRO`, `VIRT_ROW_H_COMPACT`,
`VIRT_ROW_H_COMFORTABLE`, `VIRT_ROW_H_SPACIOUS` — never read by
`tlistZoom.js` (which has always had its own local `TLIST_ZOOM_ROW_H`), and
now doubly redundant/confusing next to the real, wired-up values.

---

## Files

| File | Change |
|---|---|
| `frontend/src/design-system.css` | `--tart-size` token + default; `[data-tlist-zoom]` overrides for both `--tr-h` and `--tart-size` (compact/spacious) |
| `frontend/src/style.css` | `.tart` reads `--tart-size`; new `#zoom-hud` styles |
| `frontend/src/tlistZoom.js` | `TLIST_ZOOM_LEVELS`/`TLIST_ZOOM_ROW_H` renamed+reproportioned; `_LEGACY_ZOOM_MAP`; `_showZoomHud()` wired into `setTlistZoom()`; all internal `'normal'` fallbacks (`_nextZoomLevel`, `tlistZoomIn/Out`, `tlistZoomReset`) → `'comfortable'` |
| `frontend/src/app.js` | boot fallback `'normal'` → `'comfortable'` (line ~438) |
| `frontend/src/cfgsave.js` | persist fallback `'normal'` → `'comfortable'` (line ~104) |
| `frontend/src/settings.js` | `_syncTlistZoomRadios` fallback `'normal'` → `'comfortable'` |
| `frontend/src/types.js` | `ZoomLevel` typedef → `'compact'\|'comfortable'\|'spacious'` |
| `frontend/index.html` | radio group values/labels/`checked` updated to compact/comfortable/spacious |
| `frontend/src/i18n.fr.js`, `i18n.en.js` | `tlist_zoom_normal` → `tlist_zoom_comfortable`; new `tlist_zoom_spacious` |
| `frontend/src/cfg.js` | remove dead `VIRT_ROW_H_MICRO/_COMPACT/_COMFORTABLE/_SPACIOUS` |

---

## Accessibility

- `.tr { min-height: 44px }` (WCAG 2.5.8 floor) is respected by Compact
  (44px, exact floor) and exceeded by Comfortable/Spacious — no level can
  regress below the floor.
- `#zoom-hud` reuses existing `role="status"`/`aria-live="polite"` — no new
  ARIA surface to get wrong.
- `prefers-reduced-motion`/`data-motion="reduce"`: HUD keeps the opacity
  fade (a status message appearing/disappearing isn't decorative motion)
  but the design only ever animates `opacity`/a 6px `translateY`, well
  within what `data-motion="reduce"` already tolerates elsewhere in this
  codebase for status-type UI.
- No text ever shrinks — the AAA 7:1 text-contrast tiers (`--t`/`--t2`/`--t3`)
  are unaffected since font-size doesn't change per level.

## Invariants (CLAUDE.md)

- `CFG.VIRT_ROW_H` (base, §10) untouched — only the *_zoom-specific dead
  constants are removed, not the constant real code depends on.
- `radioRefillQueue()`/`updateBar()` ordering — untouched, unrelated code path.
- No external network calls, no `innerHTML` with untrusted content, no
  `console.log` — this is a CSS token + small JS diff, nothing touches IPC,
  tags, or file data.
- No `:root { --… }` block added to `style.css`/`style-polish.css` — new
  tokens (`--tart-size` + its zoom overrides) go in `design-system.css`
  only, next to the existing `--tr-h` overrides (same file, same pattern
  already used for `[data-theme="…"]`).

---

## Test Plan

**Automated:**

1. `npm test` — `tlistZoom.js` pure-logic tests (`_nextZoomLevel` cycling)
   updated to use the new level names; add a case for the legacy-value
   migration (`setTlistZoom('normal')` → resolves to `'comfortable'`).
2. Re-run full `npm test` — confirm the `cfg.js` constant removal doesn't
   break anything (grep already confirms zero other references).

**Manual smoke test** (`npm run dev`):

1. Fresh/never-configured install → list boots at Comfortable (56px rows,
   40px art), not the old 48px/36px.
2. Settings › Densité de la liste → switch to Compact → rows shrink to
   44px, art visibly shrinks to 32px, no clipped/cut rows, HUD pill shows
   "Compact" briefly.
3. Switch to Spacious → rows grow to 72px, art grows to 56px (fills the
   art column), HUD shows "Spacieux"/"Spacious".
4. Ctrl+scroll up/down over the track list → cycles levels, HUD confirms
   each change, radio buttons in Settings stay in sync if the panel is open.
5. Load a config saved before this change (`tlistZoom: 'comfortable'` under
   the old naming) → confirm it now resolves to the new "Spacious" level
   (the density it visually matched before), not silently reset to default.
6. Resize window to fullscreen / maximize → scroll through a large library
   at each density → confirm no row is visually cut at the viewport edge
   (the underlying `--tr-h`/`VIRT.ROW_H` sync from the previous fix still
   holds at the new pixel values).
