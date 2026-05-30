# Search bar redesign — « minimal-luxe » (Variante A : Underline → surface)

**Date:** 2026-05-30
**Status:** Approved (design) — pending implementation plan
**Scope:** Purely visual restyle of the sidebar search field. No functional, markup, ARIA, or JS-logic change.

---

## 1. Problem

The sidebar search field (`.sb-search .srch`) reads as flat and generic. At rest it is a fully filled, opaque pill, and the focus state differs only by color — there is no sense of material, depth, or a refined focus moment. The goal is a premium, "minimal-luxe" finish in the spirit of Linear/Arc: the field is nearly dematerialized at rest and **materializes** on hover/focus.

This is a visual-only change. Search behaviour (`search.js`), markup, IDs, and ARIA stay exactly as they are.

## 2. Current state (reference)

Markup (`frontend/index.html`, ~l.76-87) — unchanged by this work:

```html
<div class="sb-search" role="search">
  <div class="srch">
    <svg> … magnifier … </svg>
    <input id="srch" placeholder="Rechercher…" aria-label="Rechercher dans la bibliothèque" …>
    <button id="srch-clear" class="srch-clear" …> ✕ </button>
    <span id="srch-badge" class="srch-ct" aria-live="polite"></span>
  </div>
  <button id="clear-filters" class="clear-filters-btn" …> … </button>
</div>
```

CSS cascade (the sidebar instance is the only place `.srch` is used):

- Base `.srch` (`style.css` l.1128-1133): `display:flex`, `gap:var(--sp-1d)`, `background:var(--bg2)`, `border:var(--border-w-sm) solid var(--bg4)`, `border-radius:var(--r-art)`, `padding:var(--sp-1d) var(--sp-3)`, transition on `border-color`/`background`.
- Sidebar override `.sb-search .srch` (l.888-895) — **wins** on bg/border: rest `background:var(--border-1)`, `border-color:var(--border-2)`; focus `background:var(--border-3)`.
- Focus accent + glow `.srch:focus-within` (l.1135): `border-color:var(--g)`, `box-shadow:var(--shadow-srch-dk)`.
- Icon (l.1136-1137): `fill:var(--t3)` → focus `fill:var(--t2)`.
- Light theme: `.sb-search .srch` (l.368-369) rest `--bg4`/`--bg5`, focus `--bg2`; `.srch:focus-within` light (l.441) glow `--shadow-srch-lt`.

Current effective states:

| État | Fond | Bordure | Radius | Glow | Icône |
|---|---|---|---|---|---|
| Repos | `--border-1` | `--border-2` (4 côtés) | `--r-art` | — | `--t3` |
| Focus | `--border-3` | `--g` | `--r-art` | `--shadow-srch-dk` | `--t2` |

## 3. Target design — Variante A

Principle: at rest the field is a single bottom hairline; on focus the enclosure is **built** (background + 4-side accent border + radius morph + accent glow + icon lights to accent).

| État | Fond | Bordure | Radius | Glow | Icône |
|---|---|---|---|---|---|
| **Repos** | `transparent` | `transparent` sauf **bas** = `--border-2` | `--r-sm` | — | `--t3` |
| **Hover** | `--border-1` | bas = `--bg5` | `--r-sm` | — | `--t3` |
| **Focus** | `--border-3` | `--g` (4 côtés) | `--r-art` (morph) | `--shadow-srch-dk` | `--g` |

### 3.1 Anti-layout-shift mechanic

The border stays a constant `var(--border-w-sm) solid transparent` in every state. Only `border-*-color`, `border-radius`, `background`, and `box-shadow` animate. The box model never changes → no 1px jump between states.

### 3.2 Transition

Base `.srch` transition extended to:

```
transition: background var(--dur-fast) ease,
            border-color var(--dur-fast) ease,
            border-radius var(--dur-fast) var(--smooth),
            box-shadow var(--dur-fast) ease;
```

Honour the existing global `prefers-reduced-motion` guard (no new motion rules outside it).

### 3.3 Accessibility

- **SC 1.4.11 (non-text contrast):** at rest the field stays identifiable via the bottom hairline (`--border-2`) **plus** the always-visible magnifier icon and placeholder text. The resting boundary is not the sole identifier, so the minimal underline is compliant.
- **SC 2.4.13 (focus appearance, AAA):** keyboard focus adds the project's standard dual-tone ring without affecting mouse focus:

  ```css
  .sb-search .srch:has(input:focus-visible) {
    outline: var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  ```

  Mouse focus = accent border + soft glow only (the minimal-luxe moment). Keyboard focus = the standard outline ring on top. `:has()` is supported by the Tauri system WebView (WebView2 / modern WKWebView); it is used only for this progressive enhancement and degrades cleanly (focus-within border + glow remain if `:has` were absent).
- No change to `role="search"`, `aria-label`, `aria-live` badge, or the 24×24 clear-button target.

### 3.4 Light theme (mirror)

- `html[data-mode="light"] .sb-search .srch` — rest: `background:transparent; border-color:transparent; border-bottom-color:var(--bg5);`
- hover: `background:var(--bg4); border-bottom-color:var(--bg5);`
- focus-within: `background:var(--bg2); border-color:var(--g);` (glow `--shadow-srch-lt` already applies via l.441).

## 4. Edit surface

`frontend/src/style.css` only:

1. `.srch` base (l.1128-1133) — extend `transition` to include `border-radius` + `box-shadow`; set base `border` color to `transparent` and `border-radius` to `--r-sm` for the rest state (focus restores `--r-art`).
2. `.sb-search .srch` (l.888-895) — rest: `background:transparent`, border transparent with `border-bottom-color:var(--border-2)`; **add** `:hover` rule (`background:var(--border-1)`, `border-bottom-color:var(--bg5)`); focus-within: `border-radius:var(--r-art)` (keep `background:var(--border-3)`).
3. `.srch:focus-within svg` (l.1137) — `fill:var(--g)` (was `--t2`).
4. Add `.sb-search .srch:has(input:focus-visible)` keyboard ring rule.
5. Light overrides (l.368-369) — update rest/hover/focus per §3.4.

No new CSS custom properties are introduced → `token-source.test.cjs` stays green.

## 5. Out of scope (YAGNI)

- No scope filters (title/artist/album), suggestions dropdown, or visible shortcut hints.
- No change to field size, width, height, padding rhythm, clear button, count badge, or `#clear-filters`.
- No markup, ARIA, or `search.js` change.
- No glass/backdrop-filter effect (sidebar is opaque; rejected during brainstorming).

## 6. Verification

- `npm test` — green (no JS logic touched; CSS-only).
- `node frontend/tests/a11y.test.cjs` and `theme-palette.test.cjs` — stay green; confirm no assertion depended on the old filled-pill border.
- `token-source.test.cjs` — green (no new `:root` tokens).
- Manual visual smoke (`npm run dev`): dark + light themes; rest → hover → mouse-focus → keyboard-focus (Ctrl+F / `/`) transitions; type a query and confirm clear button + count badge still render correctly over the new surface; verify no 1px layout jump between states.

## 7. Open decisions (defaults chosen, confirm at review)

- Rest radius: `--r-sm` (near-square). Alternative: `0` for a pure flat line. **Default: `--r-sm`.**
- Focus icon: accent `--g`. Alternative: keep `--t2`. **Default: `--g`.**
- Hover wash intensity: `--border-1`. **Default kept.**
