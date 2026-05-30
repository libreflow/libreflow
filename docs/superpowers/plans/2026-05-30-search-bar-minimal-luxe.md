# Search Bar Redesign (minimal-luxe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the sidebar search field so it is dematerialized at rest (single bottom hairline) and materializes into a rounded, accent-bordered, softly glowing surface on hover/focus — a premium "minimal-luxe" finish.

**Architecture:** Pure CSS change in `frontend/src/style.css`. No markup, ARIA, IDs, or `search.js` logic change. Only color / radius / box-shadow / transition properties animate; the border box-model stays a constant `var(--border-w-sm) solid transparent` so there is never a 1px layout jump. No new design tokens are introduced (so `token-source.test.cjs` stays green).

**Tech Stack:** Vanilla CSS + existing libreflow design-system tokens. Vite 8 dev server for visual smoke. Node CJS guardrail tests.

**Spec:** `docs/superpowers/specs/2026-05-30-search-bar-minimal-luxe-design.md`

**Verification commands (exact — confirmed against package.json):**
- `npm test` runs ONLY `frontend/tests/core.test.cjs` (it has a `pretest` that regenerates `cdaudio_pure.cjs`).
- The CSS guardrails are SEPARATE files, run directly:
  - `node frontend/tests/a11y.test.cjs`
  - `node frontend/tests/theme-palette.test.cjs`
  - `node frontend/tests/theme-light-coverage.test.cjs`
  - `node frontend/tests/theme-tokens.test.cjs`
  - `node frontend/tests/token-source.test.cjs`
- A handy one-liner for the full CSS-relevant gate after each task:
  `node frontend/tests/token-source.test.cjs && node frontend/tests/a11y.test.cjs && node frontend/tests/theme-palette.test.cjs && node frontend/tests/theme-light-coverage.test.cjs && node frontend/tests/theme-tokens.test.cjs`

---

## File Structure

- Modify: `frontend/src/style.css` — four edit points:
  1. `.srch` base block (l.1128-1133): rest radius -> `--r-sm`, extend `transition`.
  2. `.srch:focus-within svg` (l.1137): icon `fill` -> `--g`.
  3. `.sb-search .srch` block (l.888-895): rest underline-only + new `:hover` + focus radius morph + accent border + keyboard ring.
  4. Light theme overrides (l.367-369): mirror rest/hover/focus.

All edit points are in one file. There is no test file to create (a CSS visual change has no unit-testable surface); the existing guardrail suites plus a manual visual smoke are the verification.

> Line numbers are from the current `master`. If they have drifted, locate each rule by its selector text (quoted verbatim in every task's "Find" block), not by line number.

---

## Task 1: Rest state + transition (base `.srch`)

**Files:** Modify `frontend/src/style.css` (base `.srch` rule, ~l.1128-1133)

- [ ] **Step 1: Find the exact current block** (appears once)

```css
.srch {
  display: flex; align-items: center; gap: var(--sp-1d);
  background: var(--bg2); border-radius: var(--r-art);
  padding: var(--sp-1d) var(--sp-3);
  border: var(--border-w-sm) solid var(--bg4);
  transition: border-color var(--dur-fast) ease, background var(--dur-fast) ease;
}
```

- [ ] **Step 2: Replace it with**

```css
.srch {
  display: flex; align-items: center; gap: var(--sp-1d);
  background: var(--bg2); border-radius: var(--r-sm);
  padding: var(--sp-1d) var(--sp-3);
  border: var(--border-w-sm) solid var(--bg4);
  transition: border-color var(--dur-fast) ease, background var(--dur-fast) ease, border-radius var(--dur-fast) var(--smooth), box-shadow var(--dur-fast) ease;
}
```

Changed: `border-radius: var(--r-art)` -> `var(--r-sm)` (rest near-square reads as a line, not a pill); `transition` now also animates `border-radius` and `box-shadow` for a smooth focus morph.

- [ ] **Step 3: Verify token source unchanged**

Run: `node frontend/tests/token-source.test.cjs`
Expected: PASS. If it fails you introduced a `:root` token — revert; use only existing tokens.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "style(search): rest radius to --r-sm + animate radius/shadow"
```

---

## Task 2: Focus icon accent (`.srch:focus-within svg`)

**Files:** Modify `frontend/src/style.css` (~l.1137)

- [ ] **Step 1: Find the exact current line**

```css
.srch:focus-within svg { fill: var(--t2); }
```

- [ ] **Step 2: Replace it with**

```css
.srch:focus-within svg { fill: var(--g); }
```

The magnifier lights to the accent color on focus (was neutral grey `--t2`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "style(search): focus icon lights to accent"
```

---

## Task 3: Underline rest + hover + focus morph + keyboard ring (`.sb-search .srch`)

Core of the redesign. The sidebar-scoped rules win over base `.srch` on background/border, so they own the resting/hover/focus look.

**Files:** Modify `frontend/src/style.css` (`.sb-search .srch` block, ~l.888-895)

- [ ] **Step 1: Find the exact current block**

```css
.sb-search .srch {
  width: 100%;
  background: var(--border-1);
  border-color: var(--border-2);
}
.sb-search .srch:focus-within {
  background: var(--border-3);
}
```

- [ ] **Step 2: Replace it with**

```css
.sb-search .srch {
  width: 100%;
  background: transparent;
  border-color: transparent;
  border-bottom-color: var(--border-2);
}
.sb-search .srch:hover {
  background: var(--border-1);
  border-bottom-color: var(--bg5);
}
.sb-search .srch:focus-within {
  background: var(--border-3);
  border-color: var(--g);
  border-radius: var(--r-art);
}
.sb-search .srch:has(input:focus-visible) {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
```

Notes:
- Rest: transparent fill + only a bottom hairline (`--border-2`). Border WIDTH unchanged (base `.srch` sets `var(--border-w-sm)`); we only recolor sides to `transparent` and bottom to `--border-2`. No box-model change.
- Hover: faint wash (`--border-1`, the old rest fill) fades in; underline brightens to `--bg5`.
- Focus: full surface (`--border-3`); all four sides accent (`--g`); radius morphs `--r-sm` -> `--r-art`. Glow `box-shadow: var(--shadow-srch-dk)` is INHERITED from base `.srch:focus-within` — do NOT re-declare it here.
- Keyboard ring: `:has(input:focus-visible)` adds the standard outline ring for keyboard users only (SC 2.4.13); mouse focus gets the glow only. `:has()` is supported by the Tauri WebView; degrades cleanly.
- Source order matters: `:focus-within` MUST come after `:hover` (equal specificity) so a focused field shows focus, not hover. Keep the order above.

- [ ] **Step 3: Verify a11y guardrails**

Run: `node frontend/tests/a11y.test.cjs`
Expected: PASS. If it fails, read the assertion. Do NOT weaken an a11y assertion to make it pass — if it encodes a real requirement (contrast/affordance), fix the CSS to satisfy it. If it only pinned old cosmetic values, update the assertion to the new values and note it in the commit body.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "style(search): underline rest, hover wash, focus surface morph + kbd ring"
```

---

## Task 4: Light theme mirror

**Files:** Modify `frontend/src/style.css` (~l.367-369)

- [ ] **Step 1: Find the exact current lines**

```css
html[data-mode="light"] .sb-search    { border-bottom-color:var(--bg5); }
html[data-mode="light"] .sb-search .srch { background:var(--bg4); border-color:var(--bg5); }
html[data-mode="light"] .sb-search .srch:focus-within { background:var(--bg2); }
```

- [ ] **Step 2: Replace them with**

```css
html[data-mode="light"] .sb-search    { border-bottom-color:var(--bg5); }
html[data-mode="light"] .sb-search .srch { background:transparent; border-color:transparent; border-bottom-color:var(--bg5); }
html[data-mode="light"] .sb-search .srch:hover { background:var(--bg4); border-bottom-color:var(--bg5); }
html[data-mode="light"] .sb-search .srch:focus-within { background:var(--bg2); border-color:var(--g); }
```

Changed: light rest now transparent with a `--bg5` underline (was filled `--bg4`); new `:hover` brings back the `--bg4` wash; focus adds the accent border (`--g`). Light focus glow `--shadow-srch-lt` (l.441) and radius morph `--r-art` (from Task 3) are inherited — do not re-declare.

- [ ] **Step 3: Verify theme guardrails**

Run: `node frontend/tests/theme-palette.test.cjs && node frontend/tests/theme-light-coverage.test.cjs && node frontend/tests/theme-tokens.test.cjs`
Expected: PASS. Same rule as Task 3 Step 3 if any assertion pinned old values.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "style(search): light theme mirror of minimal-luxe states"
```

---

## Task 5: Manual visual smoke + final verification

No code change — gates "done".

- [ ] **Step 1: Full guardrail run**

Run: `npm test && node frontend/tests/token-source.test.cjs && node frontend/tests/a11y.test.cjs && node frontend/tests/theme-palette.test.cjs && node frontend/tests/theme-light-coverage.test.cjs && node frontend/tests/theme-tokens.test.cjs`
Expected: all PASS.

- [ ] **Step 2: Launch the app**

Run: `npm run dev` — wait for the Tauri window.

- [ ] **Step 3: Dark theme states** — observe the sidebar search field:
- Rest: no filled box — thin bottom line + magnifier + "Rechercher…" placeholder.
- Hover (mouse over): faint background wash fades in, underline brightens.
- Mouse focus (click): box materializes — rounded corners, accent border all around, soft accent glow, magnifier turns accent. NO 1px jump in size/position during the transition.
- Keyboard focus (`Ctrl+F` or `/`): same surface PLUS the standard dual-tone outline ring.
- Type a query: count badge (`#srch-badge`) and clear (`✕`) render clearly over the new surface; clearing works.

- [ ] **Step 4: Light theme states** — toggle to light theme; repeat Step 3: rest underline visible against the light sidebar, hover wash, focus accent border + glow, keyboard ring, no jump.

- [ ] **Step 5: Reduced motion** — if your OS has "reduce motion" on, confirm the focus transition does not animate distractingly (global reduced-motion guard neutralizes it). Observational; no code change expected.

- [ ] **Step 6: Final commit** — only if Task 3/4 required a test-assertion update; ensure it is committed. Otherwise the four feature commits cover everything.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §3 rest/hover/focus table -> Tasks 1+3+4; §3.1 anti-shift -> Task 3 Step 2 notes (constant border width); §3.2 transition -> Task 1; §3.3 SC 1.4.11 underline -> Task 3 rest (`--border-2`) + Task 4; §3.3 SC 2.4.13 keyboard ring -> Task 3 `:has()`; §3.4 light -> Task 4; §4 edit surface (the spec's 5-point list collapses to 4 here because spec points 2 and 4 both live in the `.sb-search .srch` block = Task 3) -> Tasks 1-4; §6 verification -> Tasks 1-5; §7 defaults (rest `--r-sm`, focus icon `--g`, hover `--border-1`) -> baked into Tasks 1/2/3. No gaps.
- **Placeholder scan:** none — every CSS step shows full before/after.
- **Type/token consistency:** tokens used (`--r-sm`, `--r-art`, `--smooth`, `--dur-fast`, `--border-1/2/3`, `--bg4`, `--bg5`, `--g`, `--shadow-srch-dk`, `--shadow-srch-lt`, `--focus-ring`, `--focus-offset`) all already exist and are used consistently. Glow is inherited, never re-declared (noted in Tasks 3 and 4).
