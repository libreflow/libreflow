# Design Spec — Settings Library Tab: 3 Fixes

**Date:** 2026-05-14  
**Scope:** `index.html`, `watchfolder.js`, `app.js`, `handlers.js`, `i18n.js`  
**Type:** Bug fix + UX consistency  

---

## Context

The Library tab of the settings panel has three inconsistencies identified during a UI audit:

- **A** — "Dossier surveillé" uses a text button (Activer/Désactiver) while the Système tab uses a `toggle-wrap` for identical binary-state settings. No way to change the watched folder without deactivating first.
- **B** — "Vider la bibliothèque" (destructive action) sits in the same `set-section` as normal actions. The Système tab isolates "Vider les caches" in its own "Réinitialisation" section.
- **C** — The Interopérabilité row uses `<div class="set-row-text">` which has no CSS definition. All other rows use a bare `<div>`.

---

## Fix A — Watch folder: toggle switch + "Changer…" button

### HTML (`index.html`, ~line 839–846)

Replace:
```html
<button class="mbtn" style="font-size:11px;padding:6px 12px" data-action="toggle-watch-folder">
  <span id="watch-btn-label" data-i18n="set_watch_btn_on">Activer</span>
</button>
```

With a flex wrapper containing:
1. A `<button id="watch-change-btn">` — hidden by default, shown when watch is active
2. A `<label class="toggle-wrap"><input type="checkbox" id="watch-folder-chk"><span class="toggle-slider"></span></label>`

Remove `<span id="watch-btn-label">` entirely (no longer needed).

### `watchfolder.js`

**`updateWatchUI()`** — add:
- Sync `#watch-folder-chk` checked state: `chk.checked = !!watchPath`
- Show/hide `#watch-change-btn`: `btn.style.display = watchPath ? '' : 'none'`
- Remove the `btnLabel` block (element removed from HTML)

**`toggleWatchFolder()`** — add `updateWatchUI()` call on the early-return cancel path:
```js
if (!result?.folder) { updateWatchUI(); return; }
```
This ensures the checkbox reverts to unchecked if the user dismisses the folder dialog.

**Export `changeWatchFolder()`** — new function:
```js
export async function changeWatchFolder() {
  stopWatchFolder();
  await toggleWatchFolder();
}
```
Allows changing the watched folder in one action (stop + re-pick).

### `app.js`

At boot (alongside the `#auto-update-chk` listener pattern, ~line 311–316), add:
```js
const watchChk = document.getElementById('watch-folder-chk');
if (watchChk) watchChk.addEventListener('change', () => toggleWatchFolder());
```

### `handlers.js`

Add action:
```js
'change-watch-folder': () => changeWatchFolder(),
```

Import `changeWatchFolder` from `watchfolder.js`.

### `i18n.js`

Add to both `_t.fr` and `_t.en`:
```js
set_watch_change_btn: 'Changer…',   // FR
set_watch_change_btn: 'Change…',    // EN
```

---

## Fix B — "Vider la bibliothèque" in its own section

### HTML (`index.html`, ~line 862–870)

Close the current `set-section` div before the "Vider" row, then open a new `set-section` containing:
- `<div class="set-section-lbl" data-i18n="set_reset_section">Réinitialisation</div>` — reuses existing i18n key
- The "Vider la bibliothèque" row and danger button (moved, unchanged)

No JS, no CSS changes.

---

## Fix C — Remove orphaned `set-row-text` class

### HTML (`index.html`, line 849)

```html
<!-- Before -->
<div class="set-row-text">

<!-- After -->
<div>
```

No JS, no CSS changes. The class has no definition in `style.css`.

---

## Invariants Verified

- [ ] No mutation of `tracks[]` without `rebuildTrackIdxMap()` — not affected
- [ ] `audio.volume` untouched — not affected
- [ ] No external fetch — not affected
- [ ] IDB writes debounced — not affected
- [ ] Virtual scroll untouched — not affected
- [x] `watch-btn-label` element removed — only consumer is `watchfolder.js:179` (modified in Fix A)

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/index.html` | A: replace button with toggle-wrap + Changer btn; B: split set-section; C: remove class |
| `frontend/src/watchfolder.js` | A: updateWatchUI sync, cancel path fix, export changeWatchFolder |
| `frontend/src/app.js` | A: addEventListener on #watch-folder-chk |
| `frontend/src/handlers.js` | A: add change-watch-folder action + import |
| `frontend/src/i18n.js` | A: add set_watch_change_btn key FR+EN |
