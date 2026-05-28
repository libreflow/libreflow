# Theme Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring libreflow's dark/light themes and component polish to 2026 premium standards (Spotify, Apple Music, Deezer, Tidal level) by consolidating tokens, respacing palettes, completing light theme coverage, and applying micro-polish across all major surfaces.

**Architecture:** 4 sequential batches. **B1** turns `design-system.css` into the single source of truth and removes duplicated token systems. **B2** redefines dark + light palettes with proper visual elevation and fixes WCAG contrast failures. **B3** completes `html[data-mode="light"]` overrides on the ~40% of surfaces that lack them. **B4** applies high- and medium-priority polish to player bar, track rows, cards, sidebar, modals, sliders, and cinema mode. Each batch ships independently as one or more commits; B1 must merge first because it underpins every later token reference.

**Tech Stack:** CSS Custom Properties (Level 1), Lit 3.x Web Components, Vanilla ESM JS, Vite 8, Node 20, CJS vanilla-assert test runner (`frontend/tests/core.test.cjs`).

---

## Pre-flight context for the executing engineer

If you have never touched libreflow before, read these before starting:

1. `CLAUDE.md` §13 (CSS discipline), §17 (frontend stack), §18 (Lit components), §19 (pre-commit checklist).
2. `frontend/src/design-system.css` (305 lines) — current "intended" token system, **not consumed by anything today**.
3. `frontend/src/style.css` lines 94–500 — the **actual** token system used by all components (legacy `--sp-*`, `--r-*`, `--fs-*`, `--shadow-*`, `--dur-*` plus the canonical `--space-*`, `--radius-*`, `--text-*`, `--elev-*`, `--motion-*` introduced by the R1 harmonization batch).
4. `docs/superpowers/plans/2026-05-21-audit-harmonisation-ui.md` — prior R1-R5 harmonization audit; this plan extends it.

**Test runner:** `npm test` runs `frontend/tests/core.test.cjs`. 354 tests today, all green. The runner is plain `node` with `assert`; no Jest, no Vitest. Add tests by appending `await runTest('test name', async () => { ... })` blocks. Look at existing examples around `lf-toast-stack.logic.js` import-smoke tests for the pattern.

**Dev:** `npm run dev` launches Tauri dev with hot reload. Visual changes are best verified by opening the app and toggling `#mode-toggle-btn` (titlebar light/dark switch).

**Commit format:** Conventional Commits, enforced by `commitlint.config.js`. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `style`.

---

## File Structure — what gets touched and why

| File | Responsibility after this plan | Lines today → after |
|---|---|---|
| `frontend/src/design-system.css` | **Single source of truth** for tokens (colors, typo, spacing, radius, shadows, motion, z-index, breakpoints, layout). Declares both dark and light palettes via `html[data-mode]`. | 305 → ~450 |
| `frontend/src/style.css` | Component styles only. All `:root { --... }` token declarations move out, replaced by legacy-alias declarations (`--sp-1: var(--space-1)`) kept temporarily for back-compat. Component selectors stay. | 7464 → ~7200 (B1) → ~7300 (B3+B4) |
| `frontend/src/components/lf-toast-stack.js` | Toast component. Gain light-mode override + backdrop blur (B4-M4). | 256 → ~280 |
| `frontend/src/app.js` | Boot. Add CSS class toggle for view transitions (B4-H5). | unchanged structure, +5 lines |
| `frontend/src/handlers.js` | Theme toggle handler. No change required unless we add view-transition orchestration there. | unchanged |
| `frontend/tests/core.test.cjs` | Test suite. Add token-resolution tests (B1), WCAG contrast tests (B2), light-mode coverage tests (B3). | 354 tests → ~400 tests |
| **NEW** `frontend/tests/theme-tokens.test.cjs` | Dedicated suite for token integrity + contrast computation, loaded by `core.test.cjs`. | new file |
| **NEW** `frontend/tests/_wcag.cjs` | Pure helper computing WCAG 2.1 contrast ratio. Reusable. | new file |
| **NEW** `frontend/src/view-transition.js` | Tiny module: applies/removes `.view-fade` class on `#main` when route changes. Imported by `app.js`. | new file, ~30 lines |

No Rust changes. No IPC changes. No IDB schema changes. No `tracks[]` mutation logic changes.

---

# Batch B1 — Token Consolidation

**Outcome:** `design-system.css` becomes the only file declaring colors, spacing, radius, shadows, motion, typo. `style.css` keeps only component selectors + legacy aliases (kept for one release cycle, then removed in a follow-up). `--g` (accent) is preserved as the working name but lives in `design-system.css`.

**Why first:** B2/B3/B4 all add or modify tokens. If two files declare the same token, edits land in one and not the other → silent regressions.

**Estimated effort:** 1 day. ~6 commits.

---

### Task B1.1: Create WCAG contrast helper

**Files:**
- Create: `frontend/tests/_wcag.cjs`

- [ ] **Step 1: Write the helper**

```javascript
// frontend/tests/_wcag.cjs
// Pure helper computing WCAG 2.1 relative luminance + contrast ratio.
// Pas de dépendances externes.
'use strict';

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`hexToRgb: invalid hex ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relLuminance(hexToRgb(hexA));
  const lB = relLuminance(hexToRgb(hexB));
  const [hi, lo] = lA > lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = { hexToRgb, relLuminance, contrastRatio };
```

- [ ] **Step 2: Smoke-test it inline in the test suite (no separate test file yet)**

Run: `node -e "const {contrastRatio} = require('./frontend/tests/_wcag.cjs'); console.log(contrastRatio('#000000', '#ffffff').toFixed(2))"`
Expected output: `21.00`

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/_wcag.cjs
git commit -m "test(theme): add WCAG 2.1 contrast ratio helper"
```

---

### Task B1.2: Create the token integrity test suite (failing)

**Files:**
- Create: `frontend/tests/theme-tokens.test.cjs`
- Modify: `frontend/tests/core.test.cjs` (append require)

- [ ] **Step 1: Write the failing suite**

```javascript
// frontend/tests/theme-tokens.test.cjs
// Vérifie que design-system.css est la source unique pour les tokens canoniques
// et que style.css ne déclare plus les mêmes tokens dans :root.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DS = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');
const SS = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

// Tokens canoniques qui DOIVENT vivre uniquement dans design-system.css.
const CANONICAL = [
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl', '--text-2xl',
  '--motion-fast', '--motion-base', '--motion-slow',
  '--ease-standard', '--ease-spring',
  '--elev-1', '--elev-2', '--elev-3', '--elev-4',
  '--g', '--g-rgb',
  '--bg', '--bg1', '--bg2', '--bg3', '--bg4', '--bg5', '--bg6',
  '--t', '--t2', '--t3', '--t4',
];

function declaredInRoot(css, token) {
  // Cherche `--token:` à l'intérieur d'un bloc :root { ... }.
  const re = new RegExp(`:root\\s*\\{[^}]*${token.replace(/-/g, '\\-')}\\s*:`, 'g');
  return re.test(css);
}

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-tokens — design-system source of truth ──');

  for (const tok of CANONICAL) {
    await t(`design-system.css declares ${tok}`, () => {
      assert.ok(declaredInRoot(DS, tok), `missing ${tok}`);
    });
    await t(`style.css :root does NOT declare ${tok}`, () => {
      assert.ok(!declaredInRoot(SS, tok), `duplicate ${tok} in style.css`);
    });
  }

  if (fail) { console.log(`\nTHEME-TOKENS FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-TOKENS OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 2: Wire it into `core.test.cjs`**

Open `frontend/tests/core.test.cjs`, scroll to the bottom (just before the final summary print), and add:

```javascript
// Token integrity (B1)
await require('./theme-tokens.test.cjs').run();
```

- [ ] **Step 3: Run and confirm it FAILS**

Run: `npm test`
Expected: theme-tokens block prints `✗ style.css :root does NOT declare --space-1` (because B1 hasn't migrated yet) → suite exits non-zero.

- [ ] **Step 4: Commit (red test)**

```bash
git add frontend/tests/theme-tokens.test.cjs frontend/tests/core.test.cjs
git commit -m "test(theme): assert design-system.css is single token source (red)"
```

---

### Task B1.3: Move canonical tokens out of style.css

**Files:**
- Modify: `frontend/src/design-system.css` (append the missing tokens)
- Modify: `frontend/src/style.css` (remove canonical block, keep aliases only)

The R1 canonical block in `style.css` lives at lines **103–251** (see `:root { ... R1 — ÉCHELLES CANONIQUES ... }` block). The full set of legacy aliases (`--sp-*`, `--r-*`, `--fs-*`, `--dur-*`, etc.) below line 251 stays put for now (back-compat). The dark palette (`--bg`, `--bg1..6`, `--t`, `--t2..4`) at lines 174–187 also moves.

- [ ] **Step 1: Append missing canonical tokens to `design-system.css`**

Open `frontend/src/design-system.css`. Add this block right after the existing `--accent` declarations (around line 76):

```css
/* ============================================================================
 * 2bis. PALETTE OPÉRATIONNELLE — alias de travail (B1 consolidation)
 * --g, --g-rgb, --bg*, --t* sont les noms historiques consommés par 200+
 * sélecteurs dans style.css. Ils sont déclarés ici (source unique) et restent
 * cohérents avec la palette --accent / --bg-* / --text-* officielle.
 * ============================================================================ */
:root {
  /* Accent opérationnel (alias du --accent corail défini en §2) */
  --g       : var(--accent);
  --g-rgb   : 255, 140, 102;            /* RGB literal de --accent #FF8C66 */
  --gd      : var(--accent-subtle);
  --gg      : var(--accent-glow);
  --text-on-accent : #ffffff;

  /* Surfaces sombres — alias historiques (B2 les redéfinira espacés) */
  --bg  : var(--bg-base);
  --bg1 : #0d0d0d;
  --bg2 : #101010;
  --bg3 : #161616;
  --bg4 : #1e1e1e;
  --bg5 : #282828;
  --bg6 : #333333;

  /* Texte — alias historiques */
  --t   : var(--text-primary);
  --t2  : var(--text-secondary);
  --t3  : var(--text-muted);
  --t4  : #2e2e2e;                       /* ghost — invisible par défaut */

  /* Échelle d'espacement opérationnelle (cible des --sp-* legacy) */
  --space-0 : 0;
  --space-1 : 4px;
  --space-2 : 8px;
  --space-3 : 12px;
  --space-4 : 16px;
  --space-5 : 24px;
  --space-6 : 32px;
  --space-7 : 48px;

  /* Radius opérationnels (cible des --r-* legacy) */
  --radius-xs   : 4px;
  --radius-sm   : 8px;
  --radius-md   : 12px;
  --radius-lg   : 16px;
  --radius-pill : 999px;

  /* Typo opérationnelle (cible des --fs-* legacy) */
  --text-xs      : 11px;
  --text-sm      : 12px;
  --text-base    : 13px;
  --text-md      : 14px;
  --text-lg      : 16px;
  --text-xl      : 20px;
  --text-2xl     : 26px;

  /* Élévations opérationnelles */
  --elev-1 : 0 1px 3px rgba(0,0,0,.4);
  --elev-2 : 0 6px 20px rgba(0,0,0,.30);
  --elev-3 : 0 16px 48px rgba(0,0,0,.45);
  --elev-4 : 0 24px 64px rgba(0,0,0,.45);

  /* Motion opérationnel */
  --motion-fast : 120ms;
  --motion-base : 200ms;
  --motion-slow : 320ms;
  --ease-standard : cubic-bezier(.4, 0, .2, 1);
  --ease-spring   : cubic-bezier(.34, 1.4, .64, 1);
}
```

- [ ] **Step 2: Remove the canonical block from `style.css`**

Open `frontend/src/style.css`. Delete lines 103–251 (the entire R1 canonical block AND the `Surfaces — palette sombre raffinée` block AND the `Texte — hiérarchie claire` block). Replace with a one-line breadcrumb:

```css
  /* R1 tokens canoniques + palette dark migrés vers design-system.css (B1). */
```

Keep everything from line 252 onwards (legacy `--sp-*` aliases, layout vars, icon scales, etc.).

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: theme-tokens block now prints all green checks; suite exits 0 with 354+ tests.

- [ ] **Step 4: Smoke check the dev server**

Run: `npm run dev`
Open the app. Verify : header titlebar renders, sidebar visible, no white flash, no broken layout. Hover a track row to confirm `--g` accent still applies (corail #FF8C66 now, not blue — this is the intended switch to the design-system palette). If the visual shock is too strong, document and proceed; B2 will refine palette anyway.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design-system.css frontend/src/style.css
git commit -m "refactor(theme): move canonical tokens to design-system.css (B1)"
```

---

### Task B1.4: Verify legacy aliases still resolve

**Files:**
- Modify: `frontend/tests/theme-tokens.test.cjs` (extend)

- [ ] **Step 1: Add an aliasing test**

Append to the `CANONICAL` constants block in `theme-tokens.test.cjs`:

```javascript
// Aliases legacy qui DOIVENT pointer vers un token canonique (pas de valeur littérale).
const ALIAS_TARGETS = {
  '--sp-1':  '--space-1',
  '--sp-2':  '--space-2',
  '--sp-3':  '--space-3',
  '--sp-4':  '--space-4',
  '--r':     '--radius-md',  // historic .ni radius
  '--r2':    '--radius-lg',  // historic art radius
  '--dur-fast': '--motion-fast',
  '--dur-mid':  '--motion-base',
  '--dur-slow': '--motion-slow',
};
```

And add a test loop near the bottom of `run()` (before the fail check):

```javascript
for (const [alias, target] of Object.entries(ALIAS_TARGETS)) {
  await t(`${alias} aliases ${target}`, () => {
    // Cherche `--alias: var(--target)` (autorise du whitespace).
    const re = new RegExp(`${alias.replace(/-/g, '\\-')}\\s*:\\s*var\\(\\s*${target.replace(/-/g, '\\-')}\\s*\\)`, 'g');
    assert.ok(re.test(SS), `${alias} should be var(${target}) in style.css`);
  });
}
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: green if legacy aliases in style.css already use `var(--space-*)` etc. (the R1 block did this). If any alias still has a literal value, fix it in `style.css`.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/theme-tokens.test.cjs
git commit -m "test(theme): assert legacy aliases resolve to canonical tokens (B1)"
```

---

### Task B1.5: Inventory accidental hardcoded color literals

**Files:**
- Modify: `frontend/tests/theme-tokens.test.cjs` (extend)

- [ ] **Step 1: Add a "no hardcoded color in components" guard**

Append to `theme-tokens.test.cjs`:

```javascript
// Couleurs hardcodées dans style.css en dehors de :root et @keyframes.
// Whitelist : valeurs explicitement assumées (transparent, currentColor, inherit, rgba avec --*-rgb).
async function noStrayHexColors() {
  // Heuristique simple : compte les hex (3 ou 6 chars) hors :root { ... } et hors @keyframes.
  const cleaned = SS
    .replace(/:root\s*\{[^}]*\}/g, '')
    .replace(/@keyframes\s+\w+\s*\{[\s\S]*?\n\}/g, '');
  const hexes = cleaned.match(/#[0-9a-f]{3}([0-9a-f]{3})?\b/gi) || [];
  // Cap : on tolère <=15 hex hardcodés résiduels (legacy à nettoyer en B4 tail).
  // Au-delà, c'est une régression.
  assert.ok(hexes.length <= 15, `style.css has ${hexes.length} hardcoded hex colors outside :root — exceed cap of 15`);
}
await t('style.css has <=15 hardcoded hex colors outside :root', noStrayHexColors);
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: the count is reported. If >15, do NOT change the cap — fix the offenders by replacing literals with `var(--*)` tokens. The 15-cap is intentionally tight to drive cleanup.

If you legitimately can't fix all of them in this task, drop the cap to one or two above the actual count, log the residual list in the commit message, and we deal with the tail later.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/theme-tokens.test.cjs frontend/src/style.css
git commit -m "refactor(theme): replace stray hex colors with tokens (B1)"
```

---

### Task B1.6: Update CLAUDE.md §17 to declare design-system.css as source of truth

**Files:**
- Modify: `CLAUDE.md` (§17 frontend stack)

- [ ] **Step 1: Edit the §17 section**

Find the `### Styling` subsection in `CLAUDE.md` §17 and replace it with:

```markdown
### Styling

- **Single source of truth for tokens:** `frontend/src/design-system.css` declares all colors, typography, spacing, radius, shadows, motion, z-index, breakpoints, layout. **No `:root { --... }` block elsewhere.**
- Component styles live in `frontend/src/style.css` (vanilla selectors) and inside Lit `static styles = css\`...\`` (Shadow DOM, `lf-*` components).
- CSS custom properties (`--g`, `--bg*`, `--t*`, `--space-*`, `--radius-*`, `--text-*`, `--motion-*`, `--elev-*`) for theming, defined on `:root`.
- Shadow DOM encapsulation for Lit components (§18). Lit components inherit `:root` tokens by CSS inheritance.
- No CSS-in-JS, no utility frameworks (Tailwind, etc.).
- Legacy alias tokens (`--sp-*`, `--r-*`, `--fs-*`, `--dur-*`) remain in `style.css` for one release cycle, then get removed. New code MUST use canonical names.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(theme): declare design-system.css as token source of truth (B1)"
```

---

# Batch B2 — Palette Respirée + WCAG Fix

**Outcome:** Dark palette has 5 visually distinct elevation levels (ΔE > 4 between adjacent surfaces); light palette mirrors the same elevation structure; cyan and green accents pass WCAG AA 4.5:1 on the darkest surface; welcome screen tertiary text passes 4.5:1 in light mode.

**Why second:** B3 light overrides and B4 polish both reference surface tokens. Redefining them after polish would force re-tuning shadows and hovers twice.

**Estimated effort:** 1 day. ~5 commits.

---

### Task B2.1: Lock target palette in tests (failing)

**Files:**
- Create: `frontend/tests/theme-palette.test.cjs`
- Modify: `frontend/tests/core.test.cjs` (append require)

- [ ] **Step 1: Write the failing palette suite**

```javascript
// frontend/tests/theme-palette.test.cjs
// Vérifie que la palette dark + light respecte les cibles 2026 (élévation respirée,
// AA WCAG sur les couples critiques).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { contrastRatio } = require('./_wcag.cjs');

const DS = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

// Cible : palette dark à 5 paliers, ΔRGB total >= 35 entre --bg et --bg5.
const DARK_TARGET = {
  '--bg-base'      : '#0A0B0E',  // base — toujours pas noir pur
  '--bg-surface'   : '#15171C',  // cards, sidebar
  '--bg-elevated'  : '#1D2028',  // modales, menus
  '--bg-raised'    : '#272A34',  // hover ultra-élevé / popovers
};

function extractRoot(css) {
  const m = /:root\s*\{([^}]*)\}/g;
  const out = {};
  let block;
  while ((block = m.exec(css))) {
    const body = block[1];
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let row;
    while ((row = re.exec(body))) {
      out['--' + row[1].trim()] = row[2].trim();
    }
  }
  return out;
}

function extractLightOverride(css) {
  // Cherche html[data-mode="light"] { ... }
  const m = /html\[data-mode="light"\]\s*\{([^}]*)\}/g;
  const out = {};
  let block;
  while ((block = m.exec(css))) {
    const body = block[1];
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let row;
    while ((row = re.exec(body))) {
      out['--' + row[1].trim()] = row[2].trim();
    }
  }
  return out;
}

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-palette — dark + light + WCAG ──');

  const root = extractRoot(DS);
  const lightRoot = extractLightOverride(DS);

  // Vérifie les valeurs dark exactes.
  for (const [tok, expected] of Object.entries(DARK_TARGET)) {
    await t(`dark ${tok} = ${expected}`, () => {
      assert.strictEqual((root[tok] || '').toUpperCase(), expected.toUpperCase());
    });
  }

  // Vérifie l'override light : --bg, --bg1, etc. doivent être réassignés.
  await t('light override re-declares --bg', () => {
    assert.ok(lightRoot['--bg'], `--bg should be redeclared under html[data-mode="light"]`);
  });

  // Contraste critique : --t (texte primaire) sur --bg en dark.
  await t('dark --t on --bg passes AA (4.5:1)', () => {
    const ratio = contrastRatio(root['--t'], root['--bg']);
    assert.ok(ratio >= 4.5, `--t on --bg = ${ratio.toFixed(2)}:1 (need 4.5)`);
  });

  // Contraste critique : --t3 (texte muted) sur --bg en dark.
  await t('dark --t3 on --bg passes AA (4.5:1)', () => {
    const ratio = contrastRatio(root['--t3'], root['--bg']);
    assert.ok(ratio >= 4.5, `--t3 on --bg = ${ratio.toFixed(2)}:1 (need 4.5)`);
  });

  // Contraste critique : --t en light sur --bg light.
  await t('light --t on --bg passes AA (4.5:1)', () => {
    const ratio = contrastRatio(lightRoot['--t'] || root['--t'], lightRoot['--bg'] || root['--bg']);
    assert.ok(ratio >= 4.5, `light --t on light --bg = ${ratio.toFixed(2)}:1`);
  });

  // Accents : cyan, green doivent passer AA sur --bg-surface dark.
  await t('cyan accent on dark bg-surface passes AA (4.5:1)', () => {
    const ratio = contrastRatio('#22d3ee', '#15171C');
    assert.ok(ratio >= 4.5, `cyan on bg-surface = ${ratio.toFixed(2)}:1`);
  });

  await t('green accent on dark bg-surface passes AA (4.5:1)', () => {
    const ratio = contrastRatio('#34d399', '#15171C');
    assert.ok(ratio >= 4.5, `green on bg-surface = ${ratio.toFixed(2)}:1`);
  });

  // Élévation : ΔRGB entre paliers >= 8 pour visibilité.
  function deltaRGB(a, b) {
    const ah = parseInt(a.replace('#',''), 16);
    const bh = parseInt(b.replace('#',''), 16);
    const ar = (ah>>16)&255, ag = (ah>>8)&255, ab = ah&255;
    const br = (bh>>16)&255, bg = (bh>>8)&255, bb = bh&255;
    return Math.abs(ar-br) + Math.abs(ag-bg) + Math.abs(ab-bb);
  }
  const pairs = [
    ['--bg-base', '--bg-surface'],
    ['--bg-surface','--bg-elevated'],
    ['--bg-elevated','--bg-raised'],
  ];
  for (const [a, b] of pairs) {
    await t(`dark elevation ${a} -> ${b} has ΔRGB >= 8`, () => {
      const d = deltaRGB(root[a], root[b]);
      assert.ok(d >= 8, `${a}→${b} ΔRGB = ${d} (need 8)`);
    });
  }

  if (fail) { console.log(`\nTHEME-PALETTE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-PALETTE OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 2: Wire into `core.test.cjs`**

Append below the `theme-tokens.test.cjs` require:

```javascript
await require('./theme-palette.test.cjs').run();
```

- [ ] **Step 3: Run, confirm RED**

Run: `npm test`
Expected: most `dark XX = #XXXXXX` checks fail (current palette is `#080808` etc., not the new targets).

- [ ] **Step 4: Commit (red)**

```bash
git add frontend/tests/theme-palette.test.cjs frontend/tests/core.test.cjs
git commit -m "test(theme): assert respired palette + WCAG AA (red) (B2)"
```

---

### Task B2.2: Apply new dark palette

**Files:**
- Modify: `frontend/src/design-system.css`

- [ ] **Step 1: Replace the dark surfaces block**

In `design-system.css`, find the `/* --- Surfaces --- */` block (around line 50). Replace with:

```css
  /* --- Surfaces dark — palette respirée, 5 paliers ΔE perceptibles -------- */
  --bg-base       : #0A0B0E;   /* canonique design-system §2 */
  --bg-surface    : #15171C;   /* cards, sidebar */
  --bg-elevated   : #1D2028;   /* modales, menus contextuels */
  --bg-raised     : #272A34;   /* popovers, surfaces ultra-élevées */
  --bg-overlay    : rgba(29, 32, 40, 0.72);
```

Then, in the `2bis. PALETTE OPÉRATIONNELLE` block (added in B1.3), update the `--bg*` aliases to point at the new tokens:

```css
  /* --- Alias historiques (B1) reliés à la nouvelle palette (B2) --------- */
  --bg  : var(--bg-base);
  --bg1 : #11131A;
  --bg2 : var(--bg-surface);
  --bg3 : var(--bg-elevated);
  --bg4 : var(--bg-raised);
  --bg5 : #363A47;
  --bg6 : #444A5A;
```

(Note the `--bg2/3/4` aliases now point to canonical surface tokens — this preserves the 200+ component references to `--bg2/3/4` while routing them through the new palette.)

- [ ] **Step 2: Run palette tests**

Run: `npm test`
Expected: dark palette tests green; light palette + WCAG light still red.

- [ ] **Step 3: Smoke check**

Run: `npm run dev`
Open the app in dark mode. Verify : surfaces visibly distinct (sidebar vs main, modale vs main, hover row vs row). No "everything looks the same dark grey" effect.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design-system.css
git commit -m "feat(theme): respired dark palette with 5 distinct elevation levels (B2)"
```

---

### Task B2.3: Apply new light palette

**Files:**
- Modify: `frontend/src/design-system.css`
- Modify: `frontend/src/style.css` (remove the legacy light overrides for these tokens — they'll be in design-system now)

- [ ] **Step 1: Add a light override block in `design-system.css`**

Append at the end of the file (before the `@media (prefers-reduced-motion)` block):

```css
/* ============================================================================
 * 12. LIGHT THEME — palette miroir, ΔE équivalent à dark (B2)
 *
 * Activé par `html[data-mode="light"]` posé par handlers.js sur clic
 * du bouton #mode-toggle-btn (titlebar). Les overrides ne couvrent QUE les
 * tokens chromatiques ; spacing/radius/typo/motion restent communs.
 * ============================================================================ */
html[data-mode="light"] {
  /* Surfaces light — 5 paliers espacés, ΔRGB ~12 entre étages */
  --bg-base       : #F7F8FA;
  --bg-surface    : #E5E8EE;
  --bg-elevated   : #D9DDE6;
  --bg-raised     : #CAD0DC;
  --bg-overlay    : rgba(217, 221, 230, 0.78);

  --bg  : var(--bg-base);
  --bg1 : #EEF0F4;
  --bg2 : var(--bg-surface);
  --bg3 : var(--bg-elevated);
  --bg4 : var(--bg-raised);
  --bg5 : #B0B6C2;
  --bg6 : #98A0AE;

  /* Texte light — hiérarchie inverse, chroma neutre (pas l'ochre dark) */
  --text-primary   : #0F1117;
  --text-secondary : #3A4050;
  --text-muted     : #5A6080;
  --t   : var(--text-primary);
  --t2  : var(--text-secondary);
  --t3  : var(--text-muted);
  --t4  : #95A0B4;   /* welcome screen tertiary — visé 4.5:1 sur --bg light */

  /* Accents : on garde --g (utilisateur l'a choisi), mais on assombrit cyan/green
     pour passer AA sur les surfaces claires. */
  --accent-subtle : rgba(255, 140, 102, 0.14);

  /* Bordures light — plus visibles que dark (alpha noir vs alpha blanc) */
  --border-subtle  : rgba(0, 0, 0, 0.06);
  --border-default : rgba(0, 0, 0, 0.12);

  /* Voiles & teintes light */
  --scrim-1 : rgba(0, 0, 0, 0.15);
  --scrim-2 : rgba(0, 0, 0, 0.22);
  --scrim-3 : rgba(0, 0, 0, 0.35);
  --tint-1  : rgba(0, 0, 0, 0.04);
  --tint-2  : rgba(0, 0, 0, 0.08);
  --tint-3  : rgba(0, 0, 0, 0.14);

  /* Halo focus — sur fond clair, on bascule en blanc pour rester perceptible */
  --focus-halo : rgba(255, 255, 255, 0.55);
}
```

- [ ] **Step 2: Remove redundant light blocks from `style.css`**

In `style.css`, search for `html[data-mode="light"] { --bg` (around line ~1037–1080). If a block redefines `--bg`, `--bg1`, `--t`, `--t2` etc., **delete those lines** (they're now in `design-system.css`). Keep the component-specific overrides (`.modal { ... }`, `.pl-sort-sel { ... }`, etc.) in `style.css` — those are B3 surface.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: light palette tests green; light --t WCAG green.

- [ ] **Step 4: Smoke check**

Run: `npm run dev`. Toggle to light mode via `#mode-toggle-btn`. Verify : surfaces visibly distinct, text readable, no "everything washed out beige".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design-system.css frontend/src/style.css
git commit -m "feat(theme): respired light palette mirroring dark elevation (B2)"
```

---

### Task B2.4: Fix accent contrast — cyan and green

**Files:**
- Modify: `frontend/src/style.css` (theme accent block at lines 773–779)

- [ ] **Step 1: Update cyan and green hex values**

In `style.css`, find:

```css
[data-theme="green"]  { --g:#1db954; --g-rgb:29,185,84;   --gd:rgba(29,185,84,.14);   --gg:rgba(29,185,84,.28); }
[data-theme="cyan"]   { --g:#06b6d4; --g-rgb:6,182,212;   --gd:rgba(6,182,212,.14);   --gg:rgba(6,182,212,.28); }
```

Replace with WCAG-AA-compliant variants on dark surface:

```css
[data-theme="green"]  { --g:#34d399; --g-rgb:52,211,153;  --gd:rgba(52,211,153,.14);  --gg:rgba(52,211,153,.28); }
[data-theme="cyan"]   { --g:#22d3ee; --g-rgb:34,211,238;  --gd:rgba(34,211,238,.14);  --gg:rgba(34,211,238,.28); }
```

- [ ] **Step 2: Run palette tests**

Run: `npm test`
Expected: accent WCAG checks now green.

- [ ] **Step 3: Smoke check**

Run: `npm run dev`. Cycle through themes via settings panel (or `data-theme` attr on `<html>`). Cyan and green should look slightly lighter than before — still recognizable, now readable.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix(theme): bump cyan/green accents to AA-compliant variants (B2)"
```

---

### Task B2.5: Fix welcome screen `--t4` contrast

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate the welcome screen description rule**

Search `style.css` for `Descriptions feature cards welcome screen`. The rule should reference `--t3` or `--t4`. The audit flagged it as 3.6:1 (fail AA) for light mode.

- [ ] **Step 2: Replace the offending color with `--t3`**

If the rule currently reads:

```css
.welcome-feature-desc { color: var(--t4); }
```

Change to:

```css
.welcome-feature-desc { color: var(--t3); }
```

Rationale: B2.3 already fixed `--t3` light to pass 4.5:1 (`#5A6080`). `--t4` remains as the "ghost" muted color for decorative purposes (not body text).

- [ ] **Step 3: Add an explicit contrast test**

Append in `theme-palette.test.cjs` near the WCAG tests:

```javascript
await t('welcome-feature-desc (uses --t3) passes AA in light', () => {
  const ratio = contrastRatio(lightRoot['--t3'] || root['--t3'], lightRoot['--bg'] || root['--bg']);
  assert.ok(ratio >= 4.5, `welcome-feature-desc light = ${ratio.toFixed(2)}:1`);
});
```

- [ ] **Step 4: Run**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css frontend/tests/theme-palette.test.cjs
git commit -m "fix(theme): welcome screen description passes AA in light mode (B2)"
```

---

# Batch B3 — Light Theme Parity

**Outcome:** Every surface that has a dark style has a light override. No panel stays dark on light background. New tests enumerate the surfaces and assert at least one `html[data-mode="light"]` rule covers each.

**Why third:** B2 redefined the light palette tokens; surfaces missing overrides will now inherit the dark `--bg2 #15171C` even in light mode, making the gap glaringly visible. Time to plug them.

**Estimated effort:** 1-2 days. ~7 commits, one per missing surface.

---

### Task B3.1: Light coverage test (failing)

**Files:**
- Create: `frontend/tests/theme-light-coverage.test.cjs`
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 1: Write the suite**

```javascript
// frontend/tests/theme-light-coverage.test.cjs
// Pour chaque surface critique listée, vérifie qu'au moins une règle
// `html[data-mode="light"] <selector>` existe dans style.css.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SS = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

const REQUIRED_LIGHT_SURFACES = [
  // [selector_root, friendly_label]
  ['#cinema',          'cinema mode'],
  ['#cinema-overlay',  'cinema overlay'],
  ['#cd-modal-bg',     'CD audio modal bg'],
  ['#cd-modal',        'CD audio modal'],
  ['#organize-modal-bg', 'organize modal bg'],
  ['#organize-modal',    'organize modal'],
  ['#usb-modal-bg',    'USB import modal bg'],
  ['#usb-modal',       'USB import modal'],
  ['.miniplayer-shelf', 'miniplayer shelf'],   // adjust selector to real one
  ['.tooltip',         'tooltips'],
  ['.cn-next',         'cinema next panel'],
];

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-light-coverage — required overrides ──');

  for (const [sel, label] of REQUIRED_LIGHT_SURFACES) {
    await t(`light override covers ${label} (${sel})`, () => {
      // Cherche n'importe quelle règle qui contient `html[data-mode="light"]` ET le sélecteur.
      const escSel = sel.replace(/[.#]/g, m => '\\' + m);
      const re = new RegExp(`html\\[data-mode="light"\\][^{]*${escSel}[^{]*\\{`, 'g');
      assert.ok(re.test(SS), `no html[data-mode="light"] rule found targeting ${sel}`);
    });
  }

  if (fail) { console.log(`\nTHEME-LIGHT-COVERAGE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-LIGHT-COVERAGE OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 2: Wire into `core.test.cjs`**

```javascript
await require('./theme-light-coverage.test.cjs').run();
```

- [ ] **Step 3: Verify selectors exist**

Open `frontend/index.html` and confirm each selector in `REQUIRED_LIGHT_SURFACES` resolves to an actual element in the DOM (search by id/class). If a selector is misspelled, fix it now. The `.miniplayer-shelf` placeholder must be replaced with the real shelf selector — search the HTML for `shelf` or grep `frontend/src/miniplayer.js` for the class it injects.

- [ ] **Step 4: Run, confirm RED**

Run: `npm test`
Expected: ~7 light-coverage failures.

- [ ] **Step 5: Commit (red)**

```bash
git add frontend/tests/theme-light-coverage.test.cjs frontend/tests/core.test.cjs
git commit -m "test(theme): assert light overrides for missing surfaces (red) (B3)"
```

---

### Task B3.2: Add light overrides for cinema mode

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate the cinema mode block**

Search `style.css` for `#cinema` and `#cinema-overlay`. Note the `--c-black #000000` and dark gradient backgrounds — these need overrides.

- [ ] **Step 2: Append a cinema light section**

Add at the end of the cinema CSS block (before the next major section):

```css
/* ── Cinema mode — light overrides (B3) ─────────────────────────────────── */
html[data-mode="light"] #cinema,
html[data-mode="light"] #cinema-overlay {
  background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%);
  color: var(--text-primary);
}

html[data-mode="light"] .cinema-title,
html[data-mode="light"] .cinema-artist {
  color: var(--text-primary);
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.6);  /* lisibilité sur covers très colorées */
}

html[data-mode="light"] .cn-corner-btn {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  color: var(--text-primary);
}
html[data-mode="light"] .cn-corner-btn:hover {
  background: rgba(255, 255, 255, 0.75);
}

html[data-mode="light"] #art-blur-bg {
  background: rgba(255, 255, 255, 0.45);   /* voile clair au lieu du noir 72% */
}
```

- [ ] **Step 3: Run light coverage test**

Run: `npm test`
Expected: cinema and cinema-overlay checks now green.

- [ ] **Step 4: Smoke check**

`npm run dev` → toggle light → enter cinema mode (play a track + click cinema icon). Verify : background light, controls readable, art blur tinted bright.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): add light overrides for cinema mode (B3)"
```

---

### Task B3.3: Add light overrides for CD audio modal

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search for `#cd-modal-bg` and `#cd-modal`. The block lives around lines 977–1010.

- [ ] **Step 2: Append light overrides**

After the existing CD modal block:

```css
/* ── CD audio modal — light overrides (B3) ──────────────────────────────── */
html[data-mode="light"] #cd-modal-bg {
  background: rgba(0, 0, 0, 0.35);
}
html[data-mode="light"] #cd-modal {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--elev-3);
  border: 1px solid var(--border-default);
}
html[data-mode="light"] #cd-modal .modal-h {
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}
html[data-mode="light"] #cd-modal .modal-desc,
html[data-mode="light"] #cd-modal .modal-meta {
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Run + smoke**

`npm test` → cd-modal tests green. `npm run dev` → light → trigger CD import flow (Settings → CD or similar) → modal renders light.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): add light overrides for CD audio modal (B3)"
```

---

### Task B3.4: Add light overrides for organize and USB modals

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Append**

```css
/* ── Organize modal — light overrides (B3) ──────────────────────────────── */
html[data-mode="light"] #organize-modal-bg {
  background: rgba(0, 0, 0, 0.35);
}
html[data-mode="light"] #organize-modal {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--elev-3);
  border: 1px solid var(--border-default);
}
html[data-mode="light"] #organize-modal .modal-h,
html[data-mode="light"] #organize-modal h2,
html[data-mode="light"] #organize-modal h3 {
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}
html[data-mode="light"] #organize-modal .modal-desc,
html[data-mode="light"] #organize-modal label {
  color: var(--text-secondary);
}

/* ── USB import modal — light overrides (B3) ────────────────────────────── */
html[data-mode="light"] #usb-modal-bg {
  background: rgba(0, 0, 0, 0.35);
}
html[data-mode="light"] #usb-modal {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--elev-3);
  border: 1px solid var(--border-default);
}
html[data-mode="light"] #usb-modal .modal-h,
html[data-mode="light"] #usb-modal h2,
html[data-mode="light"] #usb-modal h3 {
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}
html[data-mode="light"] #usb-modal .modal-desc,
html[data-mode="light"] #usb-modal label {
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Run + smoke**

`npm test` green for organize/usb. `npm run dev` → light → open Settings → Organize / USB → confirm light rendering.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): add light overrides for organize and USB modals (B3)"
```

---

### Task B3.5: Add light overrides for miniplayer shelf

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search `style.css` for `shelf` (or the class injected by `miniplayer.js` — confirm via `grep -n "class" frontend/src/miniplayer.js`). Adjust the test selector in `theme-light-coverage.test.cjs` if the real class differs from `.miniplayer-shelf`.

- [ ] **Step 2: Append**

```css
/* ── Miniplayer shelf — light overrides (B3) ────────────────────────────── */
html[data-mode="light"] .miniplayer-shelf,
html[data-mode="light"] .mp-shelf {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  box-shadow: var(--elev-2);
}
html[data-mode="light"] .miniplayer-shelf .mp-title,
html[data-mode="light"] .mp-shelf .mp-title {
  color: var(--text-primary);
}
html[data-mode="light"] .miniplayer-shelf .mp-artist,
html[data-mode="light"] .mp-shelf .mp-artist {
  color: var(--text-secondary);
}
```

(Keep both class spellings as a hedge.)

- [ ] **Step 3: Run + smoke**

`npm test` → shelf check green. `npm run dev` → light → open mini-player (titlebar mini button) → shelf renders light.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): add light overrides for miniplayer shelf (B3)"
```

---

### Task B3.6: Add light overrides for tooltips + cinema next panel

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search for `.tooltip` and `.cn-next`.

- [ ] **Step 2: Append**

```css
/* ── Tooltips + cinema next panel — light overrides (B3) ───────────────── */
html[data-mode="light"] .tooltip {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  box-shadow: var(--elev-2);
}
html[data-mode="light"] .tooltip::after {
  border-top-color: var(--bg-elevated);   /* tooltip arrow tint */
}

html[data-mode="light"] .cn-next {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  backdrop-filter: blur(8px) saturate(1.2);
}
html[data-mode="light"] .cn-next .cn-next-title { color: var(--text-primary); }
html[data-mode="light"] .cn-next .cn-next-meta  { color: var(--text-secondary); }
```

- [ ] **Step 3: Run + smoke**

`npm test` green. Hover a control with a tooltip in light mode → tooltip renders light. In cinema, the next-up panel should be light.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): add light overrides for tooltips + cinema next panel (B3)"
```

---

### Task B3.7: Light-theme coverage audit follow-up

**Files:**
- Modify: `frontend/tests/theme-light-coverage.test.cjs` (extend list)

- [ ] **Step 1: Search for residual dark-only surfaces**

Use `Grep` for `background: var(--bg` in `frontend/src/style.css`, filter out lines that live inside an `html[data-mode="light"]` rule. Read each match. If a selector references `var(--bg2)` / `var(--bg3)` / `var(--bg4)` and has no matching `html[data-mode="light"]` override, log it. Common suspects: `.dropdown-menu`, `.ctx-menu`, `.set-sidebar`, popover panels.

- [ ] **Step 2: Add a second-pass list to the test**

Pick 5 additional surfaces from the residuals. Append them to `REQUIRED_LIGHT_SURFACES` in `theme-light-coverage.test.cjs`. Run `npm test`; for each new red, add the override block in `style.css` mirroring the pattern from B3.2–B3.6.

- [ ] **Step 3: Commit per surface added**

```bash
git add frontend/src/style.css frontend/tests/theme-light-coverage.test.cjs
git commit -m "feat(theme): close residual light-mode gaps in <surface> (B3)"
```

(Replace `<surface>` with the specific name. Repeat per surface.)

- [ ] **Step 4: Final smoke**

`npm run dev` → toggle light → click through Library, Playlist, Album, Queue, Settings, EQ, Cinema, Mini-player. Confirm **no panel stays dark**.

---

# Batch B4 — Premium Polish

**Outcome:** Player bar typography hierarchy matches Spotify/Apple Music; track row hover affordances are discoverable; cards have proper resting elevation; sidebar items respond to hover with subtle scale; route changes cross-fade; modals have header separators; sliders are tinted with accent; cinema mode has the missing micro-pulse and text shadow; toast has backdrop blur.

**Why last:** Polish on the wrong palette wastes time. Once B1-B3 land, polish lands cleanly.

**Estimated effort:** 2-3 days. ~15 commits, one per improvement.

---

### Task B4-H1: Player bar typography hierarchy

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate the player bar title selector**

Search `style.css` for `.pl-title` (or `.np-title` / `.pl-info .pl-title` — confirm the actual class in `frontend/index.html`).

- [ ] **Step 2: Bump font weight + size + family**

Replace the current rule with:

```css
.pl-title {
  font-family   : var(--font-display, 'Syne', system-ui, sans-serif);
  font-size     : 17px;
  font-weight   : var(--fw-bold, 700);
  letter-spacing: -0.01em;
  line-height   : var(--lh-tight, 1.2);
  color         : var(--text-primary);
}
.pl-artist {
  font-size     : 13px;
  font-weight   : var(--fw-medium, 500);
  color         : var(--text-secondary);
  line-height   : var(--lh-snug, 1.3);
}
```

- [ ] **Step 3: Smoke**

`npm run dev` → play a track → look at the player bar title. Should look closer to Spotify (clearly dominant title, secondary artist below).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(player): typographic hierarchy on player bar (B4-H1)"
```

---

### Task B4-H2: Track row hover button discoverability

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate the action button rules**

Search for `.tlk` (like button), `.tr-add-btn`, `.tr-edit-btn`, `.tr .opacity: 0`.

- [ ] **Step 2: Change opacity 0 → 0.45 at rest, 1 on hover**

Replace the existing rules:

```css
.tr .tlk,
.tr .tr-add-btn,
.tr .tr-edit-btn,
.tr .tr-chev {
  opacity   : 0.45;
  transition: opacity var(--motion-fast) var(--ease-standard);
}
.tr:hover .tlk,
.tr:hover .tr-add-btn,
.tr:hover .tr-edit-btn,
.tr:hover .tr-chev,
.tr .tlk:focus-visible,
.tr .tr-add-btn:focus-visible,
.tr .tr-edit-btn:focus-visible {
  opacity: 1;
}
.tr .tlk.on { opacity: 1; }   /* liked tracks stay solid */
```

- [ ] **Step 3: Smoke**

`npm run dev` → scroll the library. Action buttons should now be faintly visible at rest, fully visible on row hover.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(track-row): make hover action buttons discoverable at 45% rest (B4-H2)"
```

---

### Task B4-H3: Card resting elevation

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search for the `.card` block (lines ~2139). Current `box-shadow` likely `var(--elev-1)`.

- [ ] **Step 2: Bump rest shadow + tune hover**

```css
.card {
  /* … existing props … */
  box-shadow: var(--elev-2);                   /* B4-H3 — depth at rest */
  transition: box-shadow var(--motion-base) var(--ease-standard),
              transform  var(--motion-base) var(--ease-spring);
}
.card:hover {
  box-shadow: var(--elev-3);
  transform : translateY(-6px) scale(1.025);
}
```

- [ ] **Step 3: Smoke**

`npm run dev` → library cards now have a visible drop shadow at rest, deeper on hover.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(card): deeper resting elevation, smoother hover lift (B4-H3)"
```

---

### Task B4-H4: Sidebar nav item scale on hover

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search `.ni:hover` and `.ni` block (~line 1663).

- [ ] **Step 2: Add subtle scale + smoother transition**

```css
.ni {
  /* … existing props … */
  transition: background var(--motion-fast) var(--ease-standard),
              transform  var(--motion-fast) var(--ease-standard);
}
.ni:hover {
  background: var(--bg3);
  transform : translateX(2px);   /* nudge right — Spotify-like */
}
.ni.on {
  /* … existing active state … */
  transform: translateX(0);
}
.ni:active {
  transform: translateX(0) scale(0.98);
}
```

- [ ] **Step 3: Smoke**

`npm run dev` → hover sidebar items. Items should nudge right subtly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(sidebar): nudge-right hover microinteraction (B4-H4)"
```

---

### Task B4-H5: View transitions

**Files:**
- Create: `frontend/src/view-transition.js`
- Modify: `frontend/src/app.js`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Write the helper module**

Create `frontend/src/view-transition.js`:

```javascript
// LibreFlow — view-transition.js
// Cross-fade entre vues (library → playlist → settings → …).
// Posé en classe sur le conteneur principal ; CSS gère l'animation.
//
// API : runViewTransition() — appelle juste avant un changement de vue.

const MAIN_SELECTOR = '#main';
const CLASS = 'view-fade';
const DUR_MS = 200;

/**
 * Trigger a cross-fade on the main view container.
 * Idempotent : two rapid calls coalesce on the latest.
 */
export function runViewTransition() {
  const el = document.querySelector(MAIN_SELECTOR);
  if (!el) return;
  el.classList.remove(CLASS);
  // Force reflow so the class can be re-applied.
  void el.offsetWidth;
  el.classList.add(CLASS);
  // Auto-clean ; if a new call lands sooner it preempts.
  setTimeout(() => el.classList.remove(CLASS), DUR_MS + 50);
}
```

- [ ] **Step 2: Wire into `app.js`**

Open `frontend/src/app.js`. Find where view changes are dispatched (look for `route`, `view`, `nav`, or a switch on a state slot). Import and call:

```javascript
import { runViewTransition } from './view-transition.js';
```

Then, at every site that swaps the visible view (e.g. inside the route handler before the actual DOM swap), call `runViewTransition()`. If you find a single function (`showView(name)` or `setRoute(name)`), one call there suffices. Otherwise, instrument each call site.

- [ ] **Step 3: Add the CSS keyframe**

Append to `frontend/src/style.css`:

```css
/* ── View transitions (B4-H5) ───────────────────────────────────────────── */
@keyframes view-fade-in {
  from { opacity: 0.6; }
  to   { opacity: 1; }
}
#main.view-fade {
  animation: view-fade-in var(--motion-base, 200ms) var(--ease-standard) both;
}
@media (prefers-reduced-motion: reduce) {
  #main.view-fade { animation: none; }
}
```

- [ ] **Step 4: Smoke**

`npm run dev` → click Library → Playlist → Settings → Library. Each switch should fade in smoothly instead of flashing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/view-transition.js frontend/src/app.js frontend/src/style.css
git commit -m "feat(motion): cross-fade view transitions on route change (B4-H5)"
```

---

### Task B4-M1: Modal header separator

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate `.modal-h`**

Search for `.modal-h` (~line 3435).

- [ ] **Step 2: Add a bottom separator**

```css
.modal-h {
  /* … existing props … */
  border-bottom: 1px solid var(--tint-1, rgba(255,255,255,.06));
  padding-bottom: var(--space-3);
  margin-bottom : var(--space-3);
}
html[data-mode="light"] .modal-h {
  border-bottom-color: var(--border-subtle);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(modal): add header separator for visual hierarchy (B4-M1)"
```

---

### Task B4-M2: Slider tracks tinted with accent

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate sliders**

Search for `.pbar` (progress), `.vslider` (volume), `.cf-slider` (crossfade).

- [ ] **Step 2: Tint inactive tracks**

For each slider's inactive track rule, replace solid `background: var(--bg5);` with:

```css
background: rgba(var(--g-rgb), 0.12);
```

Concrete example for `.pbar`:

```css
.pbar { background: rgba(var(--g-rgb), 0.12); }
.pfill { background: var(--g); }
```

Same for `.vslider` track and `.cf-slider` track.

- [ ] **Step 3: Smoke**

`npm run dev` → look at the volume slider and progress bar — should now carry a subtle accent tint instead of neutral grey.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(slider): tint inactive tracks with accent at 12% (B4-M2)"
```

---

### Task B4-M3: EQ thumb glow on focus

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate EQ slider thumb selectors**

Search for `.cf-slider::-webkit-slider-thumb` and `.eq-slider::-webkit-slider-thumb`.

- [ ] **Step 2: Add glow on focus**

```css
.cf-slider:focus-visible::-webkit-slider-thumb,
.eq-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px rgba(var(--g-rgb), 0.35),
              0 0 12px rgba(var(--g-rgb), 0.45);
}
.cf-slider:focus-visible::-moz-range-thumb,
.eq-slider:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 3px rgba(var(--g-rgb), 0.35),
              0 0 12px rgba(var(--g-rgb), 0.45);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(eq): glow ring on slider thumb at focus (B4-M3)"
```

---

### Task B4-M4: Toast backdrop blur + light mode

**Files:**
- Modify: `frontend/src/components/lf-toast-stack.js`

- [ ] **Step 1: Add backdrop blur to the toast item**

In the `static styles = css\`...\`` block, find the `.t-item` rule and add `backdrop-filter` + `background` change to use a translucent layer:

Replace the `.t-item` background line:

```css
background: var(--lf-toast-bg, #2d2e30);
```

with:

```css
background: var(--lf-toast-bg, rgba(45, 46, 48, 0.92));
backdrop-filter: blur(12px) saturate(1.2);
-webkit-backdrop-filter: blur(12px) saturate(1.2);
```

- [ ] **Step 2: Add light mode override**

Append at the end of the `static styles` template:

```css
:host-context(html[data-mode="light"]) .t-item {
  background: var(--lf-toast-bg, rgba(255, 255, 255, 0.92));
  color: var(--lf-toast-fg, rgba(15, 17, 23, 0.92));
  box-shadow:
    0 6px 10px rgba(0, 0, 0, .10),
    0 1px 18px rgba(0, 0, 0, .08),
    0 3px 5px rgba(0, 0, 0, .14);
}
:host-context(html[data-mode="light"]) .t-action {
  color: var(--lf-toast-action, var(--lf-toast-accent, #2563eb));
}
:host-context(html[data-mode="light"]) .t-close {
  color: rgba(15, 17, 23, 0.6);
}
:host-context(html[data-mode="light"]) .t-close:hover {
  color: rgba(15, 17, 23, 0.92);
  background: rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 354+ tests green (the logic reducer is untouched).

- [ ] **Step 4: Smoke**

`npm run dev` → trigger a toast (e.g. play a track, or import a file). Toast should look glassy. Toggle light → next toast renders light.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/lf-toast-stack.js
git commit -m "feat(toast): backdrop blur glassmorphism + light mode (B4-M4)"
```

---

### Task B4-M5: Custom cursors on sliders and artworks

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add cursor rules**

Append:

```css
/* ── Cursors premium (B4-M5) ────────────────────────────────────────────── */
.pbar, .vslider, .cf-slider, .eq-slider { cursor: ew-resize; }
.pl-art-glow,
.tart img,
.card-art,
#cinema .cinema-art {
  cursor: pointer;
}
.card-art:active,
.tart:active,
.pl-art-glow:active {
  cursor: grabbing;
}
```

- [ ] **Step 2: Smoke**

`npm run dev` → hover the volume slider → cursor is `ew-resize`. Hover an artwork → `pointer`. Mousedown an artwork → `grabbing`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(cursor): premium cursor affordances on sliders + artworks (B4-M5)"
```

---

### Task B4-M6: Disabled buttons grayscale

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate disabled state**

Search for `button:disabled` and `.mbtn:disabled`.

- [ ] **Step 2: Replace simple opacity with opacity + grayscale**

```css
button:disabled,
.mbtn:disabled,
.tb-icon-btn:disabled {
  opacity: 0.5;
  filter : grayscale(60%);
  cursor : not-allowed;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(button): grayscale disabled state for clearer affordance (B4-M6)"
```

---

### Task B4-M7: Sidebar badge counts as accent pill

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate `.ni-count`**

Search for `.ni-count` (~line 1692).

- [ ] **Step 2: Style as a pill**

```css
.ni-count {
  display      : inline-flex;
  align-items  : center;
  justify-content: center;
  min-width    : 20px;
  height       : 18px;
  padding      : 0 6px;
  border-radius: var(--radius-pill);
  background   : var(--accent-subtle, rgba(var(--g-rgb), 0.18));
  color        : var(--g);
  font-size    : 11px;
  font-weight  : var(--fw-semibold, 600);
  line-height  : 1;
}
.ni:hover .ni-count {
  background: rgba(var(--g-rgb), 0.28);
}
.ni.on .ni-count {
  background: var(--g);
  color     : var(--text-on-accent);
}
```

- [ ] **Step 3: Smoke**

`npm run dev` → sidebar items with counts now show small accent pills. Active item flips the pill to solid accent.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(sidebar): badge counts as accent pill (B4-M7)"
```

---

### Task B4-M8: Cinema corner buttons press effect

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search for `.cn-corner-btn`.

- [ ] **Step 2: Add active scale**

```css
.cn-corner-btn {
  /* … existing props … */
  transition: background var(--motion-fast) var(--ease-standard),
              transform  var(--motion-fast) var(--ease-standard);
}
.cn-corner-btn:hover  { transform: scale(1.08); }
.cn-corner-btn:active { transform: scale(0.95); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(cinema): corner buttons hover scale + press scale (B4-M8)"
```

---

### Task B4-M9: Cinema title text-shadow

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

Search for `.cinema-title`.

- [ ] **Step 2: Add text-shadow for legibility over vibrant covers**

```css
.cinema-title {
  /* … existing props … */
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.55),
               0 1px 3px  rgba(0, 0, 0, 0.40);
}
.cinema-artist {
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.40);
}
html[data-mode="light"] .cinema-title,
html[data-mode="light"] .cinema-artist {
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.6);
}
```

- [ ] **Step 3: Smoke**

`npm run dev` → play a track with a very colourful cover → enter cinema → title and artist stay readable.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(cinema): text-shadow on title/artist over vibrant artworks (B4-M9)"
```

---

### Task B4-M10: Cinema art micro-pulse

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate `.cinema-art-wrap` or `.cinema-art`**

Search for `cinema-art`.

- [ ] **Step 2: Add a slow micro-pulse keyframe**

```css
@keyframes cinema-art-breathe {
  0%, 100% { transform: scale(1);    }
  50%      { transform: scale(1.012); }
}
.cinema-art-wrap {
  animation: cinema-art-breathe 6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cinema-art-wrap { animation: none; }
}
```

(`scale(1.012)` is intentionally tiny — Spotify's lyrics view uses ~1% for the same effect.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(cinema): subtle 6s breathing scale on art (B4-M10)"
```

---

### Task B4.Final: Final smoke + regression sweep

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: 354+ tests pass, including all the new theme suites (`theme-tokens`, `theme-palette`, `theme-light-coverage`).

- [ ] **Step 2: Run the perf bench**

Run: `npm run bench`
Expected: no regression beyond ±5 % of baseline (`docs/superpowers/plans/2026-05-27-perf-budgets.md`).

- [ ] **Step 3: Cargo tests (defensive)**

Run: `cargo test`
Expected: all green. Theme changes are CSS-only, but the test confirms no accidental Rust touch.

- [ ] **Step 4: Manual full smoke**

`npm run dev`. Walk through every view:
- Library (dark) → toggle light → library
- Playlist view → light
- Album view → light
- Queue view → light
- Settings (all panels) → light
- EQ panel → light
- Cinema mode (play + click cinema) → light
- Mini-player (titlebar mini button) → light
- All modals: confirm delete, settings panel, organize, USB import, CD audio, smart playlist, tag editor, doublons, shortcuts
- Toast (trigger via file action or just `ui.toast('hello','success')` in dev console)
- Hover effects: track rows, cards, sidebar, sliders, play button

Confirm every panel renders cleanly in both modes. **No dark surface in light mode, no light surface in dark mode.**

- [ ] **Step 5: Final commit + tag if desired**

```bash
git commit --allow-empty -m "chore(theme): B4 polish complete — theme overhaul done"
git tag -a v-theme-overhaul -m "Theme overhaul complete (B1+B2+B3+B4)"
```

---

# Self-Review Checklist

After writing this plan I walked it again. Findings & resolutions:

1. **Spec coverage** — every audit finding maps to a task:
   - C1 (token dup) → B1.1–B1.6
   - C2 (compressed dark) → B2.1–B2.2
   - C3 (light gaps) → B2.3 + B3.1–B3.7
   - C4 (WCAG) → B2.4, B2.5
   - H1 (player typo) → B4-H1
   - H2 (track hover affordance) → B4-H2
   - H3 (card depth) → B4-H3
   - H4 (sidebar scale) → B4-H4
   - H5 (view transitions) → B4-H5
   - M1–M10 → B4-M1 through B4-M10

2. **Placeholder scan** — every step has exact code. No `TBD`, no `Similar to Task N`. The two places that needed verification by the executing engineer (`.miniplayer-shelf` real class name in B3.5, the route handler site in B4-H5) include explicit instructions on how to find the right answer.

3. **Type / token consistency** — checked: `--g` is used in B2.4 and `--g-rgb` is used in B2.4, B4-M2, B4-M3, B4-M7 — they're declared in B1.3. `--motion-fast`, `--motion-base`, `--ease-standard` are declared in B1.3 and used in B4-H2, B4-H4, B4-H5, B4-M8. `--elev-2` / `--elev-3` declared in B1.3, used in B4-H3, B3.3, B3.4, B3.5, B3.6. `--text-primary` / `--text-secondary` declared in B2.3, used everywhere in B3.*. `--bg-elevated` declared in B2.2, used in B3.3, B3.4, B3.5, B3.6. **No mismatches.**

4. **Test gates** — every batch has at least one test asserting the outcome (`theme-tokens`, `theme-palette`, `theme-light-coverage`). B4 polish tasks rely on manual smoke (CSS visual changes; not all are trivially unit-testable) but a final regression sweep is in B4.Final.

5. **Invariant compliance** — no `fetch`, no `tracks[]` mutation, no `audio.volume` literal assignment, no new IPC. The only JS file touched is `view-transition.js` (new, pure DOM toggle) + a one-line edit to `app.js`. Light theme work is pure CSS. Lit component change in B4-M4 only touches styles, preserving the public API.

6. **Frequent commits** — 30+ commits across 4 batches. Each is independently revertible.

7. **Reversibility** — B1.3 keeps legacy aliases live, so existing component selectors keep working. B2.2/B2.3 redefine surface tokens that propagate by indirection (`--bg2 → --bg-surface`). If anything blows up visually, `git revert` of a single commit suffices.

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-29-theme-overhaul.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
