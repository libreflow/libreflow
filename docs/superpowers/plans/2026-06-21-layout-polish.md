# Layout Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure LibreFlow's global layout — titlebar cleanup, sidebar footer icons, inline search, player bar column rebalance — to match the "LibreFlow Refined" design spec.

**Architecture:** Pure HTML/CSS surgery on `frontend/index.html` and `frontend/src/style.css`, plus a small JS addition for the inline search toggle. No logic changes — same `data-action` attributes, same event handlers.

**Tech Stack:** Vanilla JS (ESM), CSS custom properties, existing `data-action` / `data-input-action` event delegation in `handlers.js`.

## Global Constraints

- CLAUDE.md §2: WCAG 2.2 AA — all moved buttons keep `aria-label`, `aria-pressed`, `data-i18n-aria` attributes intact
- CLAUDE.md §13: no CSS mixing id+class selectors, no inline event handlers
- CLAUDE.md §2 SC 2.5.8: new icon buttons ≥ 24×24px via `--target-min`
- `npm test` must stay green after every task
- No changes to audio pipeline, `tracks[]` mutations, IDB, or IPC

---

## File Map

| File | Role in this plan |
|------|-------------------|
| `frontend/index.html` | Task 1 (move titlebar buttons), Task 3 (move search + add loupe) |
| `frontend/src/style.css` | Task 1 (sidebar footer CSS), Task 2 (player columns), Task 3 (search toggle CSS) |
| `frontend/src/handlers.js` | Task 3 (wire `toggle-search` action + Escape key) |
| `frontend/tests/visual/` | Task 4 (regenerate Playwright snapshots) |

---

## Task 1: Titlebar cleanup + Sidebar footer icons

**Files:**
- Modify: `frontend/index.html` (titlebar + sidebar footer sections)
- Modify: `frontend/src/style.css` (`.tb-left`, `.sb-foot`)

**What changes:**
- Remove `#tbt-mini`, `#mode-toggle-btn`, `#tbt-settings`, `.tb-divider` from `#tb > .tb-btns.tb-left`
- Delete the entire `.tb-btns.tb-left` div (nothing remains in it)
- Add `.sb-foot-icons` row inside `.sb-foot`, containing those 3 buttons restyled as `sb-foot-icon-btn`

- [ ] **Step 1: In `frontend/index.html`, delete `.tb-btns.tb-left` block**

  Find and remove this entire block from inside `#tb` (the titlebar `<div id="tb">`):
  ```html
  <!-- DELETE this block -->
  <div class="tb-btns tb-left">
    <button class="tb-icon-btn" id="tbt-mini" ...>...</button>
    <div class="tb-divider"></div>
    <button class="tb-icon-btn" id="mode-toggle-btn" ...>...</button>
    <button class="tb-icon-btn" id="tbt-settings" ...>...</button>
  </div>
  ```
  Keep `.tb-drag-spacer` and `.tb-btns.tb-right` (minimize/maximize/close) intact.

- [ ] **Step 2: In `frontend/index.html`, add `.sb-foot-icons` row to `.sb-foot`**

  Replace the current `.sb-foot` block:
  ```html
  <!-- BEFORE -->
  <div class="sb-foot">
    <button class="btn-scan" data-action="open-folder">
      <!-- svg + text -->
    </button>
  </div>
  ```
  With (copy SVG content from the deleted titlebar buttons — exact same `data-action`, `aria-label`, `id` attributes):
  ```html
  <!-- AFTER -->
  <div class="sb-foot">
    <button class="btn-scan" data-action="open-folder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      Scanner un dossier
    </button>
    <div class="sb-foot-icons">
      <button class="sb-foot-icon-btn" id="mode-toggle-btn" data-action="toggle-mode"
              aria-label="Thème clair / sombre" data-i18n-aria="tb_mode">
        <svg id="ico-mode-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg id="ico-mode-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
      <button class="sb-foot-icon-btn" id="tbt-settings" data-action="open-settings"
              aria-label="Paramètres" data-i18n-aria="tb_settings"
              aria-expanded="false" aria-controls="settings-panel" aria-haspopup="dialog" aria-keyshortcuts="Control+Comma">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="sb-foot-icon-btn" id="tbt-mini" data-action="toggle-mini-player"
              aria-label="Mini-player" data-i18n-aria="tb_mini" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="12" width="20" height="10" rx="2"/><path d="M7 16l2.5 2L12 16l2.5 2L17 16"/><path d="M8 8h8M10 4h4"/></svg>
      </button>
    </div>
  </div>
  ```
  > **Tip:** Copy the exact SVG markup from the deleted `.tb-btns.tb-left` block — it is the authoritative source for the icons. The snippet above is a reference; if the actual HTML has different SVG paths, use those.

- [ ] **Step 3: In `frontend/src/style.css`, add `.sb-foot-icons` CSS**

  Search for `.sb-foot` in `style.css`. After the last rule in that block (around the area with `.sb-foot { padding: ... }`), add:
  ```css
  .sb-foot-icons {
    display: flex;
    align-items: center;
    gap: var(--space-1, var(--sp-1));
    padding-top: var(--sp-1);
  }

  .sb-foot-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: max(24px, var(--target-min));
    height: max(24px, var(--target-min));
    border-radius: var(--r);
    color: var(--t3);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background var(--ease), color var(--ease);
    -webkit-app-region: no-drag;
  }

  .sb-foot-icon-btn:hover { background: var(--bg4); color: var(--t); }
  .sb-foot-icon-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .sb-foot-icon-btn svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    stroke: currentColor;
    fill: none;
    stroke-width: 1.7;
    stroke-linecap: round;
  }
  .sb-foot-icon-btn.on { color: var(--g); }
  ```

- [ ] **Step 4: In `frontend/src/style.css`, remove the now-empty `.tb-left` and `.tb-divider` rules**

  Search for `.tb-left` and `.tb-divider` rules and delete them. They served the buttons that no longer exist in the titlebar.

- [ ] **Step 5: Run tests**

  ```powershell
  cd C:\Users\Robinsonx\Desktop\Tauri\libreflow && npm test
  ```
  Expected output: all tests pass (suite does not assert titlebar button positions).

- [ ] **Step 6: Commit**

  ```powershell
  git add frontend/index.html frontend/src/style.css
  git commit -m "refactor(layout): move settings/theme/mini-player from titlebar to sidebar footer"
  ```

---

## Task 2: Player bar column rebalance

**Files:**
- Modify: `frontend/src/style.css` (`#pl` grid rule)

**Context:** `--pb` is already `96px` and `--art-player` is already `72px` — the player is already comfortable-sized. The issue is asymmetry: the right column uses `clamp(88px, 18vw, var(--shelf-w))` as its minimum, much narrower than the left column's `clamp(160px, 22vw, var(--shelf-w))`. Equalizing them gives a visually balanced 3-column player bar.

- [ ] **Step 1: Find `#pl`'s `grid-template-columns` rule in `frontend/src/style.css`**

  Search for `grid-template-columns` inside `#pl`. It will look like:
  ```css
  display: grid; grid-template-columns: minmax(0, clamp(160px, 22vw, var(--shelf-w))) minmax(0, 1fr) minmax(0, clamp(88px, 18vw, var(--shelf-w)));
  ```

- [ ] **Step 2: Update only the right column's clamp to match the left**

  Change `clamp(88px, 18vw, var(--shelf-w))` → `clamp(160px, 22vw, var(--shelf-w))`:
  ```css
  display: grid; grid-template-columns: minmax(0, clamp(160px, 22vw, var(--shelf-w))) minmax(0, 1fr) minmax(0, clamp(160px, 22vw, var(--shelf-w)));
  ```
  The center column keeps `minmax(0, 1fr)` — it fills all remaining space.

- [ ] **Step 3: Run tests**

  ```powershell
  npm test
  ```
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```powershell
  git add frontend/src/style.css
  git commit -m "refactor(layout): equalize player bar left/right column min-widths"
  ```

---

## Task 3: Inline search loupe (Ctrl+F)

**Files:**
- Modify: `frontend/index.html` (remove `.sb-search` from sidebar, add loupe + search to `.vh`)
- Modify: `frontend/src/style.css` (`.vh-srch-toggle`, `.vh-srch-wrap`, remove old `.sb-search` rules)
- Modify: `frontend/src/handlers.js` (add `toggle-search` case, Ctrl+F shortcut, Escape key)

**What changes:**  
The `.sb-search` block (containing `#srch`, `#srch-clear`, `#srch-badge`, `#clear-filters`) moves from `#sb` to `.vh` inside `#vlib`. A loupe button `#srch-toggle` sits visible at rest; clicking it or pressing Ctrl+F reveals the input.

- [ ] **Step 1: In `frontend/index.html`, remove `.sb-search` from `#sb`**

  Find the `.sb-search` (or `role="search"`) block inside `#sb` and delete it entirely:
  ```html
  <!-- DELETE this block from inside #sb -->
  <div class="sb-search" role="search">
    <div class="srch">
      ...
    </div>
    <button id="clear-filters" ...>...</button>
  </div>
  ```

- [ ] **Step 2: In `frontend/index.html`, add loupe button + collapsible search to `.vh` inside `#vlib`**

  Find the `.vh` div inside `#vlib`. Add `#srch-toggle` and `#vh-srch-wrap` **before** the sort buttons (`#main-sort-btn`, `#album-sort-btn`):

  ```html
  <!-- Add inside .vh, before the sort buttons -->
  <button id="srch-toggle" class="vh-srch-toggle" data-action="toggle-search"
          aria-label="Rechercher" data-i18n-aria="aria_search_toggle"
          aria-expanded="false" aria-controls="srch">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  </button>
  <div class="vh-srch-wrap" id="vh-srch-wrap" role="search" hidden>
    <div class="srch">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="srch" type="text" placeholder="Rechercher…"
             aria-label="Rechercher dans la bibliothèque" data-i18n-aria="aria_search"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             data-input-action="search">
      <button id="srch-clear" class="srch-clear" data-action="clear-search"
              title="Effacer" aria-label="Effacer la recherche" data-i18n-aria="aria_srch_clear"
              style="display:none">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/></svg>
      </button>
      <span id="srch-badge" class="srch-ct" aria-live="polite" aria-atomic="true"></span>
    </div>
    <button id="clear-filters" class="clear-filters-btn" data-action="clear-filters"
            title="Effacer tous les filtres actifs" data-i18n-title="ergo_clear_filters_title"
            aria-label="Effacer tous les filtres" data-i18n-aria="ergo_clear_filters_aria"
            style="display:none">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/><line x1="18" y1="6" x2="22" y2="2"/><line x1="22" y1="6" x2="18" y2="2"/></svg>
      <span data-i18n="ergo_clear_filters_title">Effacer tous les filtres actifs</span>
    </button>
  </div>
  ```
  > **Important:** Copy the exact `data-i18n`, `data-i18n-aria` values from the deleted `.sb-search` block — the above uses the attribute names from the spec but the actual keys live in `frontend/src/i18n.js`.

- [ ] **Step 3: In `frontend/src/style.css`, add CSS for `.vh-srch-toggle` and `.vh-srch-wrap`**

  Find the `.sb-search` CSS block and add the following rules immediately after it (or delete `.sb-search { }` since the element no longer exists, and replace with):
  ```css
  /* Inline search toggle in view header */
  .vh-srch-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: max(28px, var(--target-min));
    height: max(28px, var(--target-min));
    border-radius: var(--r);
    color: var(--t3);
    background: transparent;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--ease), color var(--ease);
  }
  .vh-srch-toggle:hover { background: var(--bg4); color: var(--t); }
  .vh-srch-toggle:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .vh-srch-toggle svg { width: var(--icon-sm); height: var(--icon-sm); }
  .vh-srch-toggle[aria-expanded="true"] { color: var(--g); background: var(--bg3); }

  .vh-srch-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    flex-shrink: 0;
  }
  .vh-srch-wrap[hidden] { display: none; }
  ```

  Also remove the old `.sb-search { }` CSS rule block (it wraps the sidebar search; the element no longer exists in the DOM).

- [ ] **Step 4: In `frontend/src/handlers.js`, add the `toggle-search` action handler**

  First, grep for the existing switch/if-else that handles `data-action` values:
  ```powershell
  Select-String -Path "frontend/src/handlers.js" -Pattern "toggle-mode|open-settings|data-action" | Select-Object -First 10
  ```
  Find the `case 'clear-search':` or `case 'open-settings':` entry. Add the new case near it:
  ```js
  case 'toggle-search': {
    const wrap   = document.getElementById('vh-srch-wrap');
    const toggle = document.getElementById('srch-toggle');
    const input  = document.getElementById('srch');
    if (!wrap || !toggle || !input) break;
    if (!wrap.hidden) {
      _closeSearch(wrap, toggle, input);
    } else {
      _openSearch(wrap, toggle, input);
    }
    break;
  }
  ```

  Add the two helpers as `function` declarations (so they hoist) near the bottom of `handlers.js`, before the final `export` statement:
  ```js
  function _openSearch(wrap, toggle, input) {
    wrap.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function _closeSearch(wrap, toggle, input) {
    wrap.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    toggle.focus();
  }
  ```

- [ ] **Step 5: In `frontend/src/handlers.js`, wire Ctrl+F and Escape**

  Grep for the global `keydown` handler:
  ```powershell
  Select-String -Path "frontend/src/handlers.js","frontend/src/shortcuts.js","frontend/src/keynav.js" -Pattern "keydown" 2>$null | Select-Object -First 5
  ```
  In whichever file owns the global keydown listener, add:
  ```js
  // Ctrl+F — open inline search when library view is active
  if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
    const toggle = document.getElementById('srch-toggle');
    const wrap   = document.getElementById('vh-srch-wrap');
    const input  = document.getElementById('srch');
    if (toggle && getComputedStyle(toggle).display !== 'none') {
      e.preventDefault();
      if (wrap && wrap.hidden) _openSearch(wrap, toggle, input);
      else if (input) input.focus();
    }
  }
  ```

  In the `keydown` handler for `#srch` (search: `data-input-action="search"` or `id="srch"` listener), add:
  ```js
  if (e.key === 'Escape') {
    const wrap   = document.getElementById('vh-srch-wrap');
    const toggle = document.getElementById('srch-toggle');
    const input  = document.getElementById('srch');
    // Collapse only when the field is empty; if it has a query, first clear it
    if (wrap && !wrap.hidden && input && !input.value) {
      _closeSearch(wrap, toggle, input);
    }
  }
  ```
  > **If `_openSearch`/`_closeSearch` live in `handlers.js` but keydown is in a different file**, export them: `export { _openSearch, _closeSearch }` and import at the top of the shortcut file.

- [ ] **Step 6: Run tests**

  ```powershell
  npm test
  ```
  Expected: all pass. The `data-input-action="search"` input delegation is unchanged — only its DOM location changed.

- [ ] **Step 7: Commit**

  ```powershell
  git add frontend/index.html frontend/src/style.css frontend/src/handlers.js
  git commit -m "feat(layout): move search to inline loupe in view header (Ctrl+F)"
  ```

---

## Task 4: Regenerate visual snapshots

**Files:**
- Modify: `frontend/tests/visual/` (Playwright `.png` snapshot files)

The three HTML/CSS changes above will cause existing Playwright visual snapshot tests to fail with pixel diffs. Regenerate them.

- [ ] **Step 1: Start the dev server** (in a separate terminal or background process)

  ```powershell
  npm run dev
  ```

- [ ] **Step 2: Update all snapshots**

  ```powershell
  npx playwright test --update-snapshots
  ```
  Expected: snapshots regenerated without errors. If Playwright isn't configured for `--update-snapshots`, check `package.json` for the correct script (may be `npm run test:visual:update` or similar).

- [ ] **Step 3: Visually review the new snapshots**

  Open the updated `.png` files in `frontend/tests/visual/` and confirm:
  - Titlebar shows only window controls (no settings/theme buttons on the left)
  - Sidebar footer shows scan button + 3 icon buttons in a row
  - Library view header shows loupe button next to title + sort buttons
  - Player bar left and right columns are visually balanced (equal width)

- [ ] **Step 4: Run full test suite**

  ```powershell
  npm test
  ```
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```powershell
  git add frontend/tests/visual/
  git commit -m "test(visual): update snapshots after layout polish"
  ```

---

## Self-Review

**Spec coverage:**
- [x] §3.1 Titlebar cleanup → Task 1 (Steps 1–2)
- [x] §3.2 Sidebar footer icon row → Task 1 (Steps 2–3)
- [x] §3.3 Inline search loupe + Ctrl+F + Escape → Task 3
- [x] §3.4 Player bar column rebalance → Task 2 (note: `--pb` already 96px, `--art-player` already 72px; only column proportions adjusted)
- [x] §5 A11y — moved buttons keep aria attrs, loupe has `aria-expanded`/`aria-controls` → Tasks 1+3
- [x] §8 Success criteria — visual snapshots → Task 4

**Placeholder scan:** No TBD/TODO/placeholder in any step. All code blocks are complete.

**Type consistency:** `_openSearch` / `_closeSearch` named consistently in Task 3 Steps 4 and 5. `vh-srch-wrap` / `vh-srch-toggle` / `srch-toggle` IDs consistent across HTML (Step 2) and JS (Steps 4–5). `#srch` preserves its original `id` so the existing `data-input-action="search"` delegation continues working unchanged.

**One risk flagged:** `handlers.js` may use a different pattern for global keydown (could be in `shortcuts.js` or `keynav.js`). The grep in Step 5 will locate the right file. The `_openSearch`/`_closeSearch` helpers may need to be exported if they live in a different file than the Ctrl+F keydown handler.
