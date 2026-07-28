# LibreFlow — Layout Polish Design

**Date:** 2026-06-21  
**Status:** Approved  
**Branch target:** `feat/layout-polish`

---

## 1. Objective

Bring LibreFlow's global layout closer to the quality and ergonomics of reference apps (Spotify, Deezer, Apple Music) while preserving the existing architecture. No new features — structural polish only.

---

## 2. Chosen Direction: LibreFlow Refined

Keeps the current sidebar-based layout (no icon-only sidebar, no right panel). Three targeted changes:

| Zone | Current | Target |
|------|---------|--------|
| Titlebar | Settings + theme buttons on the left | Window controls only |
| Sidebar footer | Scan button only | Scan button + icon row (theme · settings · mini-player) |
| Content header | Title + sort | Title + search icon (Ctrl+F to expand inline) + sort |
| Player bar | ~40px compact, single row | 72px, explicit 3-column layout |

---

## 3. Detailed Changes

### 3.1 Titlebar (`#tb`)

**Remove** from `#tb`:
- `#tbt-mini` (mini-player toggle)
- `#mode-toggle-btn` (theme toggle)
- `#tbt-settings` (settings)
- `.tb-divider`

**Keep** in `#tb`:
- `.tb-drag-spacer` (draggable region — must remain for Tauri window drag)
- `.tb-btns.tb-right` (minimize · maximize · close)

Result: titlebar becomes a pure drag/window-control strip.

### 3.2 Sidebar footer (`.sb-foot`)

**Current:** single `.btn-scan` button.

**Target:**
```
[ Scanner un dossier ]    ← existing .btn-scan
[ 🌙 ]  [ ⚙ ]  [ ⬡ ]   ← new .sb-foot-icons row
```

The icon row reuses the three buttons removed from the titlebar (`#tbt-mini`, `#mode-toggle-btn`, `#tbt-settings`), restyled as 24×24px icon-only buttons. Same `data-action` attributes — zero logic change.

### 3.3 Content header search (loupe + Ctrl+F)

**Current:** `#srch` input lives in `#sb` sidebar, always visible.

**Target:** search triggers inline in the content view header (`.vh`).

- Move the `.srch` wrapper (containing `#srch`, `#srch-clear`, `#srch-badge`) from `#sb` into `.vh`.
- At rest: input hidden, only a loupe icon button visible.
- On loupe click or `Ctrl+F`: input expands (`width` CSS transition, 200ms), auto-focuses.
- On blur or `Escape` (when empty): input collapses.
- `#clear-filters` moves alongside the search in `.vh`.
- Only shown in library views (tracks, albums, artists). Stats / Radio / Now Playing views have no search loupe.

### 3.4 Player bar (`#pl`) — 72px, 3 columns

**Current:** single flex row, ~40px implicit height.

**Target:** 72px tall, three explicit flex children:

```
┌──────────────────────────────────────────────────────────────┐
│ [art 48px] [title+artist] [♥]  │  [⏮ ⏭ ▶ ⏭ 🔁] ──────── │  [⋮ EQ 🎬 ⚡ 💤] │── vol ──│
│         .pl-info (flex:1)      │       .pl-c (flex:1.8)      │  .pl-r (flex:1)            │
└──────────────────────────────────────────────────────────────┘
```

- **`.pl-info`** `(flex: 1)` — art 48×48, title + artist, like button
- **`.pl-c`** `(flex: 1.8)` — transport buttons + progress bar with timestamps
- **`.pl-r`** `(flex: 1; justify-content: flex-end)` — queue · EQ · cinema · speed · sleep · divider · volume

Height: `#pl { height: 72px }`. Art: 48×48px. Play button: 34×34px. Progress bar: 4px height.

---

## 4. CSS Token Impact

No new tokens required. Uses existing: `--space-1/2`, `--radius-sm`, `--target-min` (24px min touch target).

---

## 5. Accessibility Invariants (CLAUDE.md §2)

- Moved sidebar buttons keep their existing `aria-label`, `data-i18n-aria`, `aria-pressed` attributes
- Search loupe button: `aria-label="Rechercher"`, `aria-expanded` toggled on open/close, `aria-controls="srch"`
- Player bar restructure: `#pl` region label, `#pbar` slider ARIA, `#np-live` live region — all unchanged
- All new icon buttons ≥ 24×24px (WCAG SC 2.5.8, `--target-min`)
- `Escape` key on open search collapses and restores focus to loupe button

---

## 6. Files Affected

| File | Change |
|------|--------|
| `frontend/index.html` | Move buttons titlebar→sidebar; add loupe to `.vh`; restructure `#pl` divs |
| `frontend/src/style.css` | `#tb`, `.sb-foot`, `.sb-foot-icons`, `#pl`, `.pl-info/.pl-c/.pl-r` layout rules |
| `frontend/src/search.js` | Add expand/collapse logic for inline search loupe |
| `frontend/src/app.js` | No logic change (same `data-action` attributes) |
| `frontend/tests/visual/` | Playwright snapshots will need regeneration |

---

## 7. Out of Scope

- Sidebar icon-only mode
- Right "Now Playing" panel
- Any new feature beyond the above
- Mobile / responsive changes
- Animation / transition polish

---

## 8. Success Criteria

- [ ] Titlebar contains only window controls at rest
- [ ] Theme, settings, mini-player accessible from sidebar footer icon row
- [ ] Ctrl+F / loupe opens inline search in library views; Escape collapses it
- [ ] Player bar is 72px with 3 visually distinct columns
- [ ] `npm test` green, visual snapshots updated
- [ ] All WCAG 2.2 AA invariants from CLAUDE.md §2 pass
