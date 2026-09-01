# Editorial UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give libreflow's everyday surfaces (sidebar, virtualised track list, player bar, album/artist/playlist grids, search, view header) a new editorial visual identity — brass-amber signature accent, single typeface (Hanken Grotesk), airy component language, cool-tinted neutral ramp.

**Architecture:** Value-only changes to the existing token layer in `frontend/src/design-system.css` (the enforced single source of truth) plus targeted rewrites of the matching component sections in `frontend/src/style.css`. No structural token-layer changes, no JS logic changes, no IPC/audio changes. The static test suites (`theme-palette.test.cjs`, `a11y.test.cjs`, `theme-tokens.test.cjs`, `token-source.test.cjs`) are the regression gate; where a suite hard-codes an old palette value, the test expectation is updated in the same task as the token change, TDD-style (update expectation → it fails against old CSS → change CSS → it passes).

**Tech Stack:** Vanilla CSS custom properties, vendored `.woff2` fonts under `frontend/public/fonts/`, Vite 8 multi-entry build, Node 20 CJS test runner (`npm test` → `node frontend/tests/core.test.cjs`, which chains the theme/a11y/token suites via `.run()`).

**Spec:** `docs/superpowers/specs/2026-09-01-editorial-ui-redesign-design.md` — read it alongside this plan.

## Global Constraints

Copied verbatim / distilled from the spec and CLAUDE.md. Every task's requirements implicitly include this section.

- **Single token source:** all `--*` token *definitions* live in `frontend/src/design-system.css` only. No `:root { --… }` definition layer may appear in `style.css` (small responsive `:root{}` overrides inside `@media` are tolerated). Enforced by `token-source.test.cjs` / `theme-tokens.test.cjs`.
- **`--bg-base` stays exactly `#030303`.** Do NOT tint it — `a11y.test.cjs` hard-codes `#030303` for border-contrast math. Only `--bg-surface` and `--bg-elevated`/`--bg-raised` get the cool micro-tint.
- **`--bg-raised` must equal `--bg-elevated`** (AA budget, CLAUDE.md §2.9 — test-locked).
- **ΔRGB ≥ 8** between `--bg-base`→`--bg-surface` and `--bg-surface`→`--bg-elevated` (test-locked).
- **Text tiers `--t`/`--t2`/`--t3` (= `--text-primary/secondary/muted`) must clear 7:1 on `--bg` in BOTH themes** (AAA SC 1.4.6, test-locked). `--t4` is decorative/placeholder only — never for content text.
- **`--border-subtle` / `--border-default`** must stay `rgba(255,255,255,A)` form and clear 3:1 flattened on `#030303` (`--border-subtle` ≥ 3.0, `--border-default` ≥ 3.0). Never re-alias them to `--border-1/2/3`.
- **Every `[data-theme] --g` hex must clear 4.5:1 on `--bg-surface`** and its `--g-rgb` triplet must equal its own `--g` hex exactly (test-locked, iterated over all blocks).
- **`settings.js` `_applyThemeVars()` must never `setProperty('--g-rgb', …)`** and no `THEME_RGB`-style table may exist in `settings.js` (test-locked).
- **`--target-min` ≥ 24px**; `.tlk`, `.tr-add-btn` must declare `min-width:var(--target-min)` + `min-height:var(--target-min)` and a `:focus-visible` `box-shadow` using `var(--g)`.
- **`--focus-ring` ≥ `2px solid`**; `--focus-ring-contrast` defined in both themes.
- **`.tlk` base rule:** `color: var(--t3)`, `opacity ≥ 0.45`. **`.tlk.on`** needs a non-colour cue (background / transform / mask / drop-shadow). **`.pc.on`** likewise.
- **`audio.volume` reads from `#vol` DOM only** — never assigned literally, never during crossfade (CLAUDE.md §2/§9/§13).
- **`virt.js` render loop untouched.** Row height flows from `CFG.VIRT_ROW_H`; changing the `--tr-h` CSS token is allowed, editing the render loop or hard-coding a height in render code is not.
- **No `@media (prefers-reduced-motion)` blocks** — motion is gated by `html[data-motion="reduce"]` only (test-locked). Transitions animate `transform`/`opacity` only.
- **No external network** — no CDN font/script, no `fetch`/`XMLHttpRequest`/`WebSocket` added.
- **Offline fonts:** vendored `.woff2` under `frontend/public/fonts/`, referenced `url('/fonts/…')`.
- **Commit style:** conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`). Attribution is disabled globally — do not add `Co-Authored-By`.
- **Branch:** work continues on `feat/cinema-overhaul` (current branch) unless told otherwise. Do not touch the unrelated already-modified files in the working tree (`ci.yml`, `README.md`, `replaygain.js`, `backup.rs`, `commands.rs`, `vite.config.js`).
- **Signature amber target:** `#E7A33D`, final value tuned to satisfy: ≥7:1 on `--bg-base` AND on `--bg-surface` (playing-state text), and ≥4.5:1 on `--bg-surface` (`[data-theme]` gate). `--g-rgb` for it = `231, 163, 61` if the hex is unchanged; recompute if tuned.
- **Verification per task:** `npm test` green before every commit. `npm run bench` (Phase 6) within 5% of baseline.

---

## File map

**Modified — tokens & wiring (Phase 1):**
- `frontend/src/design-system.css` — token values: §2 surfaces/text/accent, §2bis operational aliases, §2ter borders, §3 typography, §4 spacing (+`--space-8`), §7 shadows, `[data-theme]` map (new `amber` block).
- `frontend/src/style.css` l.2–10 — `@font-face` block (Syne+DM Sans → Hanken Grotesk).
- `frontend/public/fonts/` — add `hanken-grotesk-{400,500,700}.woff2`, delete `syne-*.woff2` (5) + `dm-sans-*.woff2` (4).
- `frontend/public/boot-theme.js` — `VALID` list + default `'blue'` → `'amber'`.
- `frontend/src/settings.js` — `let _theme = 'blue'` → `'amber'`.
- `frontend/src/store.js:82` — cfg default `theme: 'blue'` → `'amber'`.
- `frontend/index.html` — theme swatches block (l.866–876): add amber swatch, move `.on`/`aria-pressed="true"` from blue to amber.
- `frontend/src/i18n.fr.js` / `frontend/src/i18n.en.js` — add `aria_theme_amber`.
- `frontend/tests/theme-palette.test.cjs` — `DARK_TARGET` hexes, hard-coded `#121214` strings, `#8B6BFF` accent-on-raised assertion.
- `frontend/tests/a11y.test.cjs` — add accent-as-playing-text ≥7:1 assertion.
- `frontend/tests/theme-tokens.test.cjs` — add `--space-8` to `CANONICAL`.

**Modified — component sections of `frontend/src/style.css` (Phases 2–5):**
- Phase 2: `LAYOUT` (~l.755), `TITLEBAR` (~l.765), `SIDEBAR` (~l.850), `CONTENT AREA` / view header / `.lib-tabs`, search (`.srch`).
- Phase 3: `LISTE DE TITRES` (~l.1180) + `#tlist-col-hdr`, density (`[data-tlist-zoom]` rules ~l.955), `design-system.css` `--tr-h` / `--tart-size` values.
- Phase 4: `PLAYER BAR` (~l.2129).
- Phase 5: `GRILLES Albums/Artistes` (~l.1563), playlist cards.

**Modified — docs (Phase 6):**
- `CLAUDE.md` §12 (font wording), §17 (typo families), §2.9 note if neutral comment drifts.
- `frontend/src/design-system.css` header comments referencing Syne/Indigo/`--space-8`-was-purged.

---

## Phase 1 — Foundations

### Task 1.1: Font swap — Hanken Grotesk everywhere

**Files:**
- Add: `frontend/public/fonts/hanken-grotesk-400.woff2`, `hanken-grotesk-500.woff2`, `hanken-grotesk-700.woff2`
- Delete: `frontend/public/fonts/syne-{400,500,600,700,800}.woff2`, `frontend/public/fonts/dm-sans-{300,300i,400,500}.woff2`
- Modify: `frontend/src/style.css:1-10` (`@font-face` block)
- Modify: `frontend/src/design-system.css:163-164` (`--font-display`, `--font-body`), `:756` (`--font`)
- Test: `frontend/tests/a11y.test.cjs` (no change — no font assertion), manual visual

**Interfaces:**
- Produces: `--font-display`, `--font-body`, `--font` all resolve to `'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`. Weights available: 400, 500, 700.

- [ ] **Step 1: Obtain the font files**

Download Hanken Grotesk (OFL, by identity-type) weights 400/500/700, latin subset, as `.woff2`. Source: the official GitHub release (`https://github.com/before-95/HankenGrotesk`) or a Fontsource `.woff2` mirror — but the file must be **committed into the repo**, not referenced from a CDN or added as an npm dependency. Name them exactly `hanken-grotesk-400.woff2`, `hanken-grotesk-500.woff2`, `hanken-grotesk-700.woff2` and place in `frontend/public/fonts/`.

- [ ] **Step 2: Write the `@font-face` block**

Replace `frontend/src/style.css:1-10` with:

```css
/* ── Polices auto-hébergées — zéro dépendance réseau ────────── */
@font-face { font-family:'Hanken Grotesk'; font-weight:400; font-style:normal; font-display:swap; src:url('/fonts/hanken-grotesk-400.woff2') format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-weight:500; font-style:normal; font-display:swap; src:url('/fonts/hanken-grotesk-500.woff2') format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-weight:700; font-style:normal; font-display:swap; src:url('/fonts/hanken-grotesk-700.woff2') format('woff2'); }
```

- [ ] **Step 3: Point the font tokens at Hanken**

In `frontend/src/design-system.css`, set:

```css
  --font-display : 'Hanken Grotesk', system-ui, -apple-system, Segoe UI, sans-serif;
  --font-body    : 'Hanken Grotesk', system-ui, -apple-system, Segoe UI, sans-serif;
```

and at l.756:

```css
  --font: 'Hanken Grotesk', -apple-system, 'Segoe UI', sans-serif;
```

- [ ] **Step 4: Delete the old font files and check for stale references**

```bash
git rm frontend/public/fonts/syne-400.woff2 frontend/public/fonts/syne-500.woff2 frontend/public/fonts/syne-600.woff2 frontend/public/fonts/syne-700.woff2 frontend/public/fonts/syne-800.woff2
git rm frontend/public/fonts/dm-sans-300.woff2 frontend/public/fonts/dm-sans-300i.woff2 frontend/public/fonts/dm-sans-400.woff2 frontend/public/fonts/dm-sans-500.woff2
grep -rniE "syne|dm[- ]sans" frontend/src frontend/index.html
```

Expected: the only hits are comment lines in `design-system.css` (header l.18, §3 l.153–157) — fix those comments to say Hanken Grotesk. No `url('/fonts/syne` or `url('/fonts/dm-sans` anywhere.

- [ ] **Step 5: Build to verify the bundle resolves the fonts**

Run: `npm run vite:build`
Expected: build succeeds; `frontend/dist/fonts/` contains the 3 `hanken-grotesk-*.woff2` and none of the old files.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS (no font-specific assertions; this confirms nothing regressed).

- [ ] **Step 7: Visual check**

Use the `run` skill (or `npm run dev`) → load a folder → confirm all text renders in Hanken Grotesk (no Times/serif fallback flash), titlebar + sidebar + track list + player bar legible.

- [ ] **Step 8: Commit**

```bash
git add frontend/public/fonts frontend/src/style.css frontend/src/design-system.css
git commit -m "refactor: swap Syne+DM Sans for Hanken Grotesk (single family)"
```

---

### Task 1.2: Signature colour — brass amber accent + `[data-theme="amber"]` default

**Files:**
- Modify: `frontend/src/design-system.css` — §2 (`--accent`, `--accent-glow`, `--accent-subtle` ~l.80-82), §2bis (`--g-rgb` l.95, `--text-on-accent` l.98), §13 (`--amber`/`--amber-rgb` l.375-376), `[data-theme]` map (~l.958-966), `html[data-mode="light"]` accent-subtle
- Modify: `frontend/public/boot-theme.js:19-20`
- Modify: `frontend/src/settings.js:28`
- Modify: `frontend/src/store.js:82`
- Modify: `frontend/index.html:866-876`
- Modify: `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js` (add `aria_theme_amber`)
- Test: `frontend/tests/theme-palette.test.cjs` (update expectations), `frontend/tests/a11y.test.cjs` (add assertion)

**Interfaces:**
- Consumes: none.
- Produces: `--accent` = `#E7A33D` (or tuned); `--g` = `var(--accent)`; `--g-rgb` = `231, 163, 61` (or recomputed); `[data-theme="amber"]` block with `--g:#E7A33D; --g-rgb:231,163,61; --gd:rgba(231,163,61,.14); --gg:rgba(231,163,61,.28)`. Default active theme = `amber`.

- [ ] **Step 1: Update the failing test expectations first (theme-palette)**

In `frontend/tests/theme-palette.test.cjs`, l.191-196, replace the indigo-hardcoded assertion:

```js
  await t('dark accent (amber default #E7A33D) on --bg-raised passes AA (4.5:1)', () => {
    const bg = resolveVar(root, null, '--bg-raised');
    assert.ok(bg, `cannot resolve --bg-raised`);
    const r = contrastRatio('#E7A33D', bg);
    assert.ok(r >= 4.5, `accent on --bg-raised = ${r.toFixed(2)}:1 (need 4.5)`);
  });
```

(If the amber hex is tuned in Step 4, use the tuned value here.)

- [ ] **Step 2: Add the new a11y assertion (accent as playing-state text)**

In `frontend/tests/a11y.test.cjs`, after the focus-ring block (~l.211), add:

```js
  // --- SC 1.4.6 : l'accent sert de texte pour l'état "en lecture" — doit tenir AAA (7:1) ---
  await t('accent (amber) as playing-state text passes AAA on --bg-base and --bg-surface', () => {
    const m = /--accent\s*:\s*(#[0-9a-fA-F]{6})/.exec(DS);
    assert.ok(m, '--accent hex not found in design-system.css');
    const hex = m[1];
    for (const [bg, label] of [['#030303', '--bg-base'], ['#121214', '--bg-surface']]) {
      const r = contrastRatio(hex, bg);
      assert.ok(r >= 7.0, `accent ${hex} on ${label} = ${r.toFixed(2)}:1 (need 7.0)`);
    }
  });
```

Note: the `#121214` string here is updated in Task 1.3 to the tinted value — keep them in sync.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `theme-palette` "amber default" assertion fails (CSS still `#8B6BFF`), a11y "accent as playing-state text" fails (indigo `#8B6BFF` is ~3.6:1 on `#030303`).

- [ ] **Step 4: Change `--accent` and derived tokens in design-system.css**

§2 (~l.79-82):

```css
  /* --- Accent — Brass Amber (signature éditoriale) --------------------- */
  --accent         : #E7A33D;                 /* laiton chaud — 8.9:1 sur --bg-base, 8.2:1 sur --bg-surface */
  --accent-glow    : rgba(231, 163, 61, 0.45);
  --accent-subtle  : rgba(231, 163, 61, 0.12);
```

§2bis (l.95, l.98):

```css
  --g-rgb   : 231, 163, 61;
  --text-on-accent : #1A1205;             /* brun très sombre sur ambre brillant — >12:1 */
```

`html[data-mode="light"]` block — update `--accent-subtle` to `rgba(231, 163, 61, 0.14)`.

Verify the actual contrast of your chosen hex with a quick node check:

```bash
node -e "const {contrastRatio}=require('./frontend/tests/_wcag.cjs'); for(const b of ['#030303','#121214','#111318','#1A1B22']) console.log(b, contrastRatio('#E7A33D', b).toFixed(2))"
```

All must be ≥ 7.0 for `#030303` and the surface value, ≥ 4.5 for the elevated value. Tune the hex toward `#E9A845` (lighter) if any gate misses; keep it visibly "brass", not yellow.

- [ ] **Step 5: Add the `[data-theme="amber"]` block**

In `design-system.css`, in the `[data-theme]` map (~l.958), add as the FIRST block:

```css
[data-theme="amber"]  { --g:#E7A33D; --g-rgb:231,163,61;  --gd:rgba(231,163,61,.14); --gg:rgba(231,163,61,.28); }
```

Keep the other 7 blocks unchanged. If the amber hex was tuned in Step 4, recompute the `--g-rgb` triplet to match exactly (test-locked: `--g-rgb` must equal the hex).

- [ ] **Step 6: Reposition the warning token (`--amber`) so it does not read as the signature**

§13 (l.375-376) — shift to a duller, greener gold that still reads "caution" but is clearly not the brass signature:

```css
  --amber:     #C9A227;   /* WARNING semantic only — duller/greener than the brass signature accent */
  --amber-rgb: 201, 162, 39;
```

Verify ≥ 4.5:1 on `--bg-surface`:

```bash
node -e "const {contrastRatio}=require('./frontend/tests/_wcag.cjs'); console.log(contrastRatio('#C9A227', '#111318').toFixed(2))"
```

- [ ] **Step 7: Rewire the default theme**

`frontend/public/boot-theme.js:19-20`:

```js
    var VALID = ['amber', 'green', 'blue', 'purple', 'red', 'orange', 'pink', 'cyan'];
    if (VALID.indexOf(theme) === -1) theme = 'amber';
```

`frontend/src/settings.js:28`: `let _theme = 'amber';`

`frontend/src/store.js:82`: `theme: 'amber',`

- [ ] **Step 8: Add the amber swatch to Settings**

`frontend/index.html` l.869-870 area — insert an amber swatch as the first, marked active, and remove `.on` / set `aria-pressed="false"` on the blue one:

```html
            <button class="theme-swatch on" data-theme="amber" data-action="set-theme" data-i18n-aria="aria_theme_amber" aria-label="Ambre" aria-pressed="true"></button>
            <button class="theme-swatch"    data-theme="green"  data-action="set-theme"  data-i18n-aria="aria_theme_green"  aria-label="Vert"   aria-pressed="false"></button>
            <button class="theme-swatch"    data-theme="blue"   data-action="set-theme"   data-i18n-aria="aria_theme_blue"   aria-label="Bleu"   aria-pressed="false"></button>
```

(keep purple/red/orange/pink/cyan lines unchanged)

- [ ] **Step 9: Add the i18n keys**

`frontend/src/i18n.fr.js` (near l.273): `aria_theme_amber:        'Ambre',`
`frontend/src/i18n.en.js` (near l.273): `aria_theme_amber:        'Amber',`

- [ ] **Step 10: Run the suite**

Run: `npm test`
Expected: PASS. In particular `theme-palette` now checks the new amber block via the `[data-theme] --g ≥ 4.5:1` loop and the `--g-rgb` == hex loop.

- [ ] **Step 11: Visual check**

`run` skill → confirm: default accent is brass amber (play button, progress fill, focus ring); Settings → Appearance shows the amber swatch selected; switching to another swatch and back to amber works; no blank/white swatches.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/design-system.css frontend/public/boot-theme.js frontend/src/settings.js frontend/src/store.js frontend/index.html frontend/src/i18n.fr.js frontend/src/i18n.en.js frontend/tests/theme-palette.test.cjs frontend/tests/a11y.test.cjs
git commit -m "feat: brass-amber signature accent, replaces indigo/blue default theme"
```

---

### Task 1.3: Neutral ramp — cool slate micro-tint

**Files:**
- Modify: `frontend/src/design-system.css` — §2 `--bg-surface` l.68, `--bg-elevated` l.69, `--bg-raised` l.70; `html[data-mode="light"]` surfaces
- Test: `frontend/tests/theme-palette.test.cjs` — `DARK_TARGET` (l.16-21), hard-coded `#121214` in cyan/green assertions (l.126, l.131) and `BG_SURFACE_DARK` (l.200)
- Test: `frontend/tests/a11y.test.cjs` — the `#121214` string added in Task 1.2 Step 2

**Interfaces:**
- Consumes: none.
- Produces: `--bg-base #030303` (unchanged), `--bg-surface #111318`, `--bg-elevated #1A1B22`, `--bg-raised #1A1B22`.

- [ ] **Step 1: Verify the candidate values clear every gate**

```bash
node -e "
const {contrastRatio}=require('./frontend/tests/_wcag.cjs');
const d=(a,b)=>{a=parseInt(a.slice(1),16);b=parseInt(b.slice(1),16);return Math.abs((a>>16&255)-(b>>16&255))+Math.abs((a>>8&255)-(b>>8&255))+Math.abs((a&255)-(b&255));};
const base='#030303', surf='#111318', elev='#1A1B22';
console.log('ΔRGB base→surf', d(base,surf), '(need ≥8)');
console.log('ΔRGB surf→elev', d(surf,elev), '(need ≥8)');
for(const [name,t] of [['--t','#F5F6F8'],['--t2','#B4B7C2'],['--t3','#979CAC']])
  console.log(name,'on base', contrastRatio(t,base).toFixed(2), '| on surf', contrastRatio(t,surf).toFixed(2), '(need ≥7 on base)');
console.log('--t3 on elev', contrastRatio('#979CAC',elev).toFixed(2), '(need ≥4.5)');
console.log('amber on surf', contrastRatio('#E7A33D',surf).toFixed(2), '(need ≥7)');
console.log('cyan on surf', contrastRatio('#22d3ee',surf).toFixed(2), '| green on surf', contrastRatio('#34d399',surf).toFixed(2), '(need ≥4.5)');
"
```

Expected: all gates pass. If `--t3` drops below 7:1 on `#111318`, lighten `--bg-surface` slightly toward `#101216` or nudge `--t3` — but prefer adjusting the surface, and re-run. Record the final hexes.

- [ ] **Step 2: Update `DARK_TARGET` in theme-palette.test.cjs**

```js
const DARK_TARGET = {
  '--bg-base'      : '#030303',
  '--bg-surface'   : '#111318',
  '--bg-elevated'  : '#1A1B22',
  '--bg-raised'    : '#1A1B22',
};
```

- [ ] **Step 3: Update the hard-coded surface strings in theme-palette.test.cjs**

- l.126: `contrastRatio('#22d3ee', '#111318')`
- l.131: `contrastRatio('#34d399', '#111318')`
- l.200: `const BG_SURFACE_DARK = '#111318';`

- [ ] **Step 4: Update the `#121214` string in a11y.test.cjs**

The assertion added in Task 1.2 Step 2 — change `['#121214', '--bg-surface']` to `['#111318', '--bg-surface']`.

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `theme-palette` "dark --bg-surface = #111318" fails against the still-`#121214` CSS.

- [ ] **Step 6: Apply the tint in design-system.css**

§2 (l.68-72):

```css
  --bg-base       : #030303;   /* canonique — fenêtre, zone principale (inchangé) */
  --bg-surface    : #111318;   /* sidebar / navigation — micro-teinte ardoise froide */
  --bg-elevated   : #1A1B22;   /* cards, survols, éléments flottants */
  --bg-raised     : #1A1B22;   /* popovers empilés — même palier que --bg-elevated (§2.9) */
  --bg-sunken     : #000000;
```

`html[data-mode="light"]` — apply the same "few points cooler" treatment to its surface values (e.g. `--bg-surface #E4E7EE`, `--bg-elevated #D7DBE4`) keeping the light AAA/AA checks green (re-run the Step 1 node check with the light text tokens).

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Visual check**

`run` skill → the shell should read a hair cooler; sidebar vs main seam still legible without a border; amber accent noticeably "pops" against the cool ground.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/design-system.css frontend/tests/theme-palette.test.cjs frontend/tests/a11y.test.cjs
git commit -m "feat: cool slate micro-tint on elevated surfaces"
```

---

### Task 1.4: Typography scale, weights, kill uppercase labels

**Files:**
- Modify: `frontend/src/design-system.css` — §3 fluid scale (`--text-xs`…`--text-display`), `--ls-label` usage note, `--fw-*` (unchanged values, confirm 500/700 present)
- Modify: `frontend/src/style.css` — any core-surface selector that sets `text-transform: uppercase` + wide `letter-spacing` on a label (sidebar section headers `.sb-lib-header` / `.sb-pl-header`, `#tlist-col-hdr` columns, `.lib-tab` if uppercased)
- Test: `frontend/tests/theme-tokens.test.cjs` (`CANONICAL` list — `--text-*` already covered), manual visual

**Interfaces:**
- Consumes: none.
- Produces: retuned `--text-lg`, `--text-xl`, `--text-display` clamps; convention that core labels are sentence-case 500.

- [ ] **Step 1: Retune the fluid scale in design-system.css §3**

```css
  --text-xs      : clamp(11px, 1vw, 12px);
  --text-sm      : clamp(12px, 1.2vw, 14px);
  --text-base    : clamp(13px, 1.4vw, 15px);
  --text-md      : clamp(15px, 1.6vw, 18px);
  --text-lg      : clamp(19px, 2.1vw, 26px);
  --text-xl      : clamp(24px, 3vw, 38px);
  --text-display : clamp(34px, 5vw, 60px);
```

Leave the legacy `--fs-*` recabling untouched — those aliases keep pointing at the same 7 steps.

- [ ] **Step 2: Grep for uppercase label treatments on core surfaces**

```bash
grep -nE "text-transform\s*:\s*uppercase" frontend/src/style.css
```

For each hit inside the SIDEBAR, view-header, `.lib-tabs`, or `#tlist-col-hdr` sections: remove `text-transform: uppercase`, remove the wide `letter-spacing` (or set `letter-spacing: var(--ls-reset)`), set `font-weight: 500`, and use `font-size: var(--text-xs)` with `color: var(--text-muted)` for section headers / column headers. Leave uppercase treatments in out-of-scope sections (EQ, stats, cinema) alone.

- [ ] **Step 3: Set titling to weight 700 + tight metrics**

For `.vh-title` (view header title): `font-family: var(--font-display); font-weight: 700; font-size: var(--text-xl); line-height: var(--lh-tight); letter-spacing: var(--ls-display);`. For the welcome/drill hero title (`.wh1`, `.drill-title` if in scope): `font-size: var(--text-display)`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (`theme-tokens` confirms `--text-*` still single-source; no new failures).

- [ ] **Step 5: Visual check**

`run` skill → "Ma bibliothèque" title is large and assertive; sidebar section headers and track-list column headers are quiet sentence-case, not shouty caps; nothing clipped.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design-system.css frontend/src/style.css
git commit -m "feat: editorial type scale + drop uppercase labels on core surfaces"
```

---

### Task 1.5: Spacing (`--space-8`), softened shadows, motion note

**Files:**
- Modify: `frontend/src/design-system.css` — §4 spacing (add `--space-8`), §7 shadows (`--shadow-sm/md/lg/xl`), header comment l.118 (remove the "`--space-8` purged" claim)
- Modify: `frontend/tests/theme-tokens.test.cjs` — add `--space-8` to `CANONICAL`
- Test: `theme-tokens.test.cjs`, `token-source.test.cjs`

**Interfaces:**
- Consumes: none.
- Produces: `--space-8: 64px`; softened `--shadow-*` values.

- [ ] **Step 1: Add `--space-8` to the CANONICAL list (failing test)**

`frontend/tests/theme-tokens.test.cjs` — in `CANONICAL`, change the spacing line to include `'--space-8'`:

```js
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8',
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL — `theme-tokens` "`--space-8` must be defined in design-system.css" (or similar) fails; token not present yet.

- [ ] **Step 3: Add `--space-8` in design-system.css §4**

```css
  --space-7 : 48px;
  --space-8 : 64px;   /* respiration en tête de vue (titrage éditorial) */
```

Update the comment at l.117-119 to drop "`--space-8`" from the list of purged dead tokens (it's alive again, with a consumer coming in Phase 2).

- [ ] **Step 4: Soften the floating shadows in design-system.css §7**

```css
  --shadow-sm : 0 1px 3px rgba(0,0,0,.20);
  --shadow-md : 0 4px 16px rgba(0,0,0,.24);
  --shadow-lg : 0 8px 28px rgba(0,0,0,.30);
  --shadow-xl : 0 16px 52px rgba(0,0,0,.40);
```

Leave `--elev-1…4` (transparent, in-flow) and all `--shadow-*` aliases untouched.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design-system.css frontend/tests/theme-tokens.test.cjs
git commit -m "feat: add --space-8 (64px), soften floating shadows"
```

---

## Phase 2 — Shell (sidebar, view header, search, layout)

> All of Phase 2 is CSS-only edits to component sections of `frontend/src/style.css`. The regression gate is `npm test` (sidebar / a11y suites) + a per-task visual check via the `run` skill. Where a task changes a selector that a test asserts on, update the assertion in the same task.

### Task 2.1: Layout paddings + sidebar/main seam

**Files:**
- Modify: `frontend/src/style.css` — `LAYOUT` section (~l.755-763), `#main` padding, `#tb` (titlebar art-color tint stays)
- Test: manual visual + `npm test`

**Interfaces:**
- Consumes: `--space-8` (Task 1.5).
- Produces: `#main` content top padding = `var(--space-8)`.

- [ ] **Step 1: Increase view-top breathing room**

In the `#main` / `#content-area` rule, set `padding-top: var(--space-8)` (was ~`var(--space-6)` / a literal). Keep horizontal padding on the existing token. Do not change the `#app` grid template (`var(--tb) 1fr var(--pb)` / `var(--sb) 1fr`).

- [ ] **Step 2: Remove the sidebar right border / hard seam**

In the `#sb` rule: ensure `border-right` is `none` (or absent). The separation is `--bg-surface` vs `--bg-base`. Keep `#sb-resize` handle styling.

- [ ] **Step 3: Verify + commit**

Run: `npm test` → PASS. `run` skill → more air above the view title; sidebar/main seam still readable.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial view-top spacing, drop sidebar hard seam"
```

### Task 2.2: Sidebar nav items + active indicator

**Files:**
- Modify: `frontend/src/style.css` — `SIDEBAR` section (`.ni`, `.ni.on` / active, `#ni-indicator`, `.sb-lib-header`, `.sb-pl-header`)
- Test: `frontend/tests/sidebar.test.cjs`, `frontend/tests/a11y.test.cjs`

**Interfaces:**
- Consumes: `--accent`, `--text-primary/secondary`, `--row-hover`.
- Produces: nav active state = text `--text-primary` + `#ni-indicator` bar in `--accent`, no item background.

- [ ] **Step 1: Restyle nav item states**

- `.ni` (rest): `color: var(--text-secondary); font-weight: 500; font-size: var(--text-sm);` no background.
- `.ni:hover`: `color: var(--text-primary); background: var(--row-hover);`
- `.ni.on` (active — match whatever the active class actually is; check `views.js` `#ni-indicator` positioning code and the sidebar HTML): `color: var(--text-primary);` **no background pill**. If a background is currently set on the active item, remove it.
- `#ni-indicator`: `width: 2px; background: var(--accent); transition: transform var(--motion-base) var(--ease-standard);` (keep it `aria-hidden`, no `tabindex` — do not touch the HTML).

- [ ] **Step 2: Quiet the section headers**

`.sb-lib-header`, `.sb-pl-header`: `font-size: var(--text-xs); font-weight: 500; color: var(--text-muted); text-transform: none; letter-spacing: var(--ls-reset); margin-top: var(--space-6);`

- [ ] **Step 3: Verify + commit**

Run: `npm test` → PASS (sidebar suite: no hardcoded `245,158,11` — the smart-playlist icon now inherits the repositioned `--amber-rgb`, still token-based, still passes). `run` skill → active nav item reads by weight + amber bar, not a coloured pill.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial sidebar — weight-based active state, 2px amber indicator"
```

### Task 2.3: View header + library tabs

**Files:**
- Modify: `frontend/src/style.css` — view header (`.vh`, `.vh-title`), `.lib-tabs` / `.lib-tab`, header buttons
- Test: `frontend/tests/a11y.test.cjs` (tablist assertions — unchanged), manual visual

**Interfaces:**
- Consumes: `--text-xl`, `--font-display`, `--accent`.
- Produces: tab active state = `--text-primary` + 2px `--accent` underline, no tab background.

- [ ] **Step 1: Title block**

`.vh-title`: `font-family: var(--font-display); font-weight: 700; font-size: var(--text-xl); line-height: var(--lh-tight); letter-spacing: var(--ls-display); color: var(--text-primary);`. Add `--space-8` above / `--space-6` below the `.vh` block (via margin on `.vh` or padding on its container — match existing pattern).

- [ ] **Step 2: Tabs**

`.lib-tab`: `font-weight: 500; color: var(--text-secondary); background: none; border: none;`
`.lib-tab[aria-selected="true"]` (confirm the actual active selector): `color: var(--text-primary); box-shadow: inset 0 -2px 0 0 var(--accent);` (underline via inset shadow — no layout shift). Do NOT touch the `role="tablist"`/`role="tab"`/`aria-selected` attributes or `smartplaylist.js`/`views.js` sync code.

- [ ] **Step 3: Header icon buttons**

Sort / dupes / search-toggle buttons: ghost — `color: var(--text-secondary); background: none;` hover `color: var(--text-primary)`.

- [ ] **Step 4: Verify + commit**

Run: `npm test` → PASS. `run` skill → tab bar is text + underline; header title is large.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial view header + underline-only library tabs"
```

### Task 2.4: Search field

**Files:**
- Modify: `frontend/src/style.css` — `.srch`, `#srch`, `.srch-clear`, `#srch-badge`
- Test: `frontend/tests/a11y.test.cjs` (`role="search"` landmark — unchanged), manual visual

**Interfaces:**
- Consumes: `--bg-sunken`, `--border-default`, `--input-focus-ring`, `--radius-sm`.
- Produces: search field visual only.

- [ ] **Step 1: Restyle**

`.srch`: `background: var(--bg-sunken); border: 1px solid var(--border-default); border-radius: var(--radius-sm);` leading magnifier icon `color: var(--text-muted)`.
`.srch:focus-within`: `box-shadow: var(--input-focus-ring); border-color: var(--accent);`
`#srch-badge`: `font-size: var(--text-xs); font-weight: 500; background: var(--bg-elevated); border-radius: var(--radius-pill);`

- [ ] **Step 2: Verify + commit**

Run: `npm test` → PASS. `run` skill → search field reads as a recessed input; focus ring is amber.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial search field"
```

---

## Phase 3 — Track list

### Task 3.1: Row grid, typography, playing/hover/selected states

**Files:**
- Modify: `frontend/src/style.css` — `LISTE DE TITRES` section (`.tr`, `.tart`, `.ti`, `.ta`, `.tlk`, `.tr-add-btn`, `.eq-bars`, `#tlist-col-hdr`, drag states)
- Test: `frontend/tests/a11y.test.cjs` (`.tlk` rest `color:var(--t3)` + `opacity>=0.45` + `min-width/height:var(--target-min)` + `:focus-visible` `box-shadow var(--g)`; `.tlk.on` non-colour cue; `#content-area #tlist` `scroll-padding-top`; content text avoids `--t4`), `frontend/tests/core.test.cjs` (renderer aria-setsize/posinset — unchanged, JS not touched)

**Interfaces:**
- Consumes: `--accent`, `--row-hover`, `--sep`, `--radius-xs`, `--target-min`, `--tart-size`, `--tr-h`.
- Produces: 3-column row grid; playing title in `--accent`; selected row fill `--accent-selected`.

- [ ] **Step 1: Row container as a 3-column grid**

`.tr`: `display: grid; grid-template-columns: [main] 1fr [album] var(--tr-album-col) [end] auto; align-items: center; height: var(--tr-h); border-radius: 0; border: none;`
Column 1 holds `.tart` (art) + a flex column of `.ti` / `.ta`. Column 2 (`.ta-album` or equivalent) is hidden by the existing `@container main (max-width: 820px)` rule — keep that.
`.tart`: `width: var(--tart-size); height: var(--tart-size); border-radius: var(--radius-xs);`

- [ ] **Step 2: Typography**

`.ti` (title): `font-size: var(--text-base); font-weight: 500; color: var(--text-primary);`
`.ta` (artist): `font-size: var(--text-sm); font-weight: 400; color: var(--text-secondary);`
`#tlist-col-hdr` cells: `font-size: var(--text-xs); font-weight: 500; color: var(--text-muted); text-transform: none; letter-spacing: var(--ls-reset); border-bottom: 1px solid var(--sep);`

- [ ] **Step 3: Playing state**

`.tr.act` (confirm the class — CLAUDE.md §2.9 says `.act` mirrors `aria-current="true"`): `.tr.act .ti { color: var(--accent); }`. The row-number cell shows `.eq-bars` (animated) in `var(--accent)` when `.act`. Do not add a background-only cue that would violate "use of colour" — the animated bars ARE the non-colour cue. Keep `aria-current` handling in JS untouched.

- [ ] **Step 4: Hover state**

`.tr:hover`: `background: var(--row-hover);`
`.tr:hover .tart`: `transform: scale(1.04); transition: transform var(--motion-fast) var(--ease-standard);`
Reveal `.tr-add-btn` + `.tlk` on `.tr:hover` / `.tr:focus-within` (opacity 0 → 1). Play ▷ overlay on the art on hover.
`.tlk` base: keep `color: var(--t3); opacity: .45; min-width: var(--target-min); min-height: var(--target-min);`
`.tlk:focus-visible`: keep `box-shadow: 0 0 0 2px var(--g);`
`.tlk.on`: keep a non-colour cue (filled heart via `mask`/background, or `transform`).
`.tr-add-btn`: keep `min-width/min-height: var(--target-min)` + `:focus-visible` `box-shadow var(--g)`.

- [ ] **Step 5: Selected (multi-select) state**

`.tr.sel` (confirm class): `background: var(--accent-selected);` no border. (`--accent-selected` = `--accent-subtle` reused, or add it in design-system.css §2bis if a distinct value is wanted — 12% alpha amber.)

- [ ] **Step 6: `scroll-padding-top` stays**

Confirm `#content-area #tlist { scroll-padding-top: … }` is still present (a11y SC 2.4.11). If the value referenced a removed token, repoint it.

- [ ] **Step 7: Verify + commit**

Run: `npm test` → PASS (all `.tlk` / `#tlist` / use-of-colour assertions). `run` skill → load 1k+ folder, scroll (no jank), hover a row (art lifts, actions reveal), play a track (title goes amber + bars animate), multi-select (amber fill, no border).

```bash
git add frontend/src/style.css frontend/src/design-system.css
git commit -m "feat: editorial track-list rows — grid layout, amber playing state, no cards"
```

### Task 3.2: Density steps

**Files:**
- Modify: `frontend/src/design-system.css` — `--tr-h` / `--tart-size` defaults + `[data-tlist-zoom="compact"|"spacious"]` overrides (~l.486-487, l.955-956)
- Modify: `frontend/src/style.css` — any density-dependent padding/type if `tlistZoom.js` spec (`2026-07-05-tlist-zoom-spotify-design.md`) already wired type/padding steps; match that pattern
- Test: `frontend/tests/a11y.test.cjs` (target-min at all densities), manual

**Interfaces:**
- Consumes: none.
- Produces: `--tr-h` default 64 / compact 48 / spacious 76; `--tart-size` 40 / 32 / 56.

- [ ] **Step 1: Update the density tokens**

```css
  --tr-h      : 64px;
  --tart-size : 40px;
```
```css
[data-tlist-zoom="compact"]  { --tr-h: 48px; --tart-size: 32px; }
[data-tlist-zoom="spacious"] { --tr-h: 76px; --tart-size: 56px; }
```

- [ ] **Step 2: Confirm `virt.js` picks up the new default**

`virt.js` reads row height from `CFG.VIRT_ROW_H`. Check how `CFG.VIRT_ROW_H` is derived — if it reads the computed `--tr-h`, no code change. If it's a separate constant, update `CFG.VIRT_ROW_H` to `64` to match (this is a CFG value change, not a render-loop change — allowed). Verify the binary-search mapping still uses `CFG.VIRT_ROW_H` and no literal.

- [ ] **Step 3: Verify + commit**

Run: `npm test` → PASS. Run: `npm run bench` → record number (full comparison in Phase 6). `run` skill → cycle density (Compact/Comfortable/Spacious), rows resize, artwork scales, no overlap, targets still ≥24px.

```bash
git add frontend/src/design-system.css frontend/src/style.css frontend/src/virt.js
git commit -m "feat: editorial track-list density steps (48/64/76)"
```

---

## Phase 4 — Player bar

### Task 4.1: Three-zone layout + amber play disc

**Files:**
- Modify: `frontend/src/style.css` — `PLAYER BAR` section (`#pl`, `.pl-info`, `.pl-art`, `.pl-tr`, `.pl-c`, `.pl-btns`, `.pcplay`, `.pc`)
- Test: `frontend/tests/a11y.test.cjs` (`.pc.on` non-colour cue), manual

**Interfaces:**
- Consumes: `--accent`, `--text-on-accent`, `--control-size`, `--sep`, `--bg-surface`.
- Produces: player bar visual; `.pcplay` = amber disc 40px.

- [ ] **Step 1: Zones + ground**

`#pl`: `background: var(--bg-surface); border-top: 1px solid var(--sep);` remove the white inset `--player-shadow` if present. Keep `--player-height`. Three zones via the existing grid/flex — left `.pl-info`, centre `.pl-c`, right `.pl-r`.

- [ ] **Step 2: Play button**

`.pcplay`: `width: 40px; height: 40px; border-radius: var(--radius-pill); background: var(--accent); color: var(--text-on-accent);` icon inherits `currentColor`.
`.pcplay:hover`: `transform: scale(1.06);` `.pcplay:active`: `transform: scale(0.96);` (transform only).

- [ ] **Step 3: Transport buttons + on-states**

`.pc` (prev/next/shuffle/repeat): ghost, `color: var(--text-secondary);` hover `color: var(--text-primary)`.
`.pc.on` (shuffle/repeat active): `color: var(--text-primary);` **plus a dot beneath** — e.g. `::after` a 3px `var(--accent)` dot (this is the non-colour cue the a11y suite requires — a filled dot, not just a colour). No amber fill on the icon itself.

- [ ] **Step 4: Verify + commit**

Run: `npm test` → PASS. `run` skill → play disc is amber, transport buttons ghost, shuffle/repeat show a dot when on.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial player bar — three zones, amber play disc, dot on-states"
```

### Task 4.2: Progress bar + neutral volume

**Files:**
- Modify: `frontend/src/style.css` — `.pl-prog`, `.pbar`, `.pfill`, `#seek-tip`, `.vol`, `.vslider`, `#vol`
- Test: `frontend/tests/a11y.test.cjs` / `frontend/tests/core.test.cjs` (volume-from-DOM invariant — JS untouched), manual

**Interfaces:**
- Consumes: `--accent`, `--text-secondary`, `--sep`.
- Produces: progress fill amber, volume fill neutral.

- [ ] **Step 1: Progress**

`.pbar`: `height: 3px; background: var(--sep); border-radius: var(--radius-pill);`
`.pfill`: `background: var(--accent);`
Handle (`::after` / thumb): `opacity: 0;` → `opacity: 1` on `.pl-prog:hover` / `:focus-within`. Ensure the effective vertical hit-target (`.pbar` + any `::after` padding) is ≥ 24px — keep the existing invisible hit-area technique.

- [ ] **Step 2: Volume**

`#vol` / `.vslider` fill: `background: var(--text-secondary);` (NOT `--accent`). Rail `var(--sep)`.
Do NOT touch any JS — `audio.volume` continues to read from `#vol` (CLAUDE.md §2). Confirm no CSS change introduces a literal volume anywhere (there shouldn't be — this is style only).

- [ ] **Step 3: Verify + commit**

Run: `npm test` → PASS. `run` skill → seek works, progress fill amber, handle appears on hover; volume fill is grey; drag volume → audio follows, no jump.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial progress bar (amber) + neutral volume fill"
```

---

## Phase 5 — Grids

### Task 5.1: Album cards

**Files:**
- Modify: `frontend/src/style.css` — `GRILLES Albums/Artistes` section (`.card`, `.card-art`, `.card-info`), grid container
- Test: manual visual + `npm test`

**Interfaces:**
- Consumes: `--radius-md`, `--space-6`, `--shadow-md`, `--accent`, `--text-sm/xs`, `--text-muted`.
- Produces: album card visual.

- [ ] **Step 1: Card = artwork, no chrome**

`.card`: `background: none; border: none; padding: 0;`
`.card-art`: `border-radius: var(--radius-md); aspect-ratio: 1;`
`.card-info` title: `font-size: var(--text-sm); font-weight: 500; color: var(--text-primary);` one line + ellipsis.
`.card-info` subtitle (artist): `font-size: var(--text-xs); color: var(--text-muted);`

- [ ] **Step 2: Hover**

`.card:hover .card-art`: `transform: scale(1.03); box-shadow: var(--shadow-md); transition: transform var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard);`
Floating play ▷ disc bottom-right on hover: `background: var(--accent); color: var(--text-on-accent); border-radius: var(--radius-pill);` fade/scale in.

- [ ] **Step 3: Grid**

Container: `gap: var(--space-6); grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr));` (keep `--card-min` — check its current token name; the audit lists `--card-min-w` as purged, so it may be a literal or a different token — use whatever the section currently uses, just bump the gap).

- [ ] **Step 4: Verify + commit**

Run: `npm test` → PASS. `run` skill → Albums tab: bare artwork tiles, hover lifts + shows amber play; no card boxes.

```bash
git add frontend/src/style.css
git commit -m "feat: editorial album grid — artwork-only cards"
```

### Task 5.2: Artist + playlist cards

**Files:**
- Modify: `frontend/src/style.css` — artist circular art rules, playlist 2×2 mosaic, smart/pin badges
- Test: manual visual + `npm test`

**Interfaces:**
- Consumes: `--radius-md`, `--radius-pill`, `--glass-panel`, `--text-xs`.
- Produces: artist + playlist card visuals.

- [ ] **Step 1: Artist**

Circular art (`border-radius: var(--radius-pill)`), centred label below, `font-size: var(--text-sm); font-weight: 500;` hover: `transform: scale(1.03)`.

- [ ] **Step 2: Playlist**

2×2 mosaic `border-radius: var(--radius-md)`. Smart / pin badges: `font-size: var(--text-xs); background: var(--glass-panel); border-radius: var(--radius-sm);`

- [ ] **Step 3: Verify + commit**

Run: `npm test` → PASS. `run` skill → Artists tab (round art), Playlists (mosaic, badges legible).

```bash
git add frontend/src/style.css
git commit -m "feat: editorial artist + playlist cards"
```

---

## Phase 6 — Verification & docs

### Task 6.1: Full regression + bench

**Files:**
- No source changes expected. If a fix is needed, it belongs to the phase that introduced the regression.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — `core`, `theme-tokens`, `theme-palette`, `theme-light-coverage`, `a11y`, `token-source`, `sidebar` all green.

- [ ] **Step 2: Bench**

Run: `npm run bench`
Compare against the pre-project baseline (from `git stash` / the last known number, or `npm run perf:baseline` if a baseline file exists). Expected: within 5%. The track-list changes (grid layout, `--tr-h` 64) are the risk — if scroll FPS regressed > 5%, profile `.tr`'s `display: grid` vs the prior layout and simplify (e.g. `content-visibility: auto` on off-screen rows, or fewer grid tracks).

- [ ] **Step 3: Syntax check**

Run: `for f in frontend/src/*.js frontend/public/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: no FAIL.

- [ ] **Step 4: Production build**

Run: `npm run vite:build`
Expected: succeeds; `frontend/dist/fonts/` has only the 3 Hanken files.

- [ ] **Step 5: Manual smoke (CLAUDE.md dev-workflow §5)**

`npm run dev` → load a real 1k+ folder → seek, EQ change, crossfade, playlist switch, watch-folder add/remove a file. Listen for audio glitches (there should be none — no audio code changed). Watch for dropped frames on scroll.

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: <describe the specific regression fixed>"
```

### Task 6.2: Documentation sync

**Files:**
- Modify: `CLAUDE.md` — §12 (font wording: "self-hosted via `@fontsource`" → "self-hosted `.woff2` under `frontend/public/fonts/`"), §17 "Styling" / typography mention (Syne + DM Sans → Hanken Grotesk), §2.9 neutral-ramp note if the tint changed the phrasing
- Modify: `frontend/src/design-system.css` — §3 header comment (l.153-157: Syne/DM Sans → Hanken Grotesk, one-family rule), §2 accent comment (Electric Indigo → Brass Amber)
- Modify: `docs/superpowers/specs/2026-09-01-editorial-ui-redesign-design.md` — set `Status: Implemented`

- [ ] **Step 1: Run doc-updater**

Use the `ecc:doc-updater` agent (or edit directly) to sync the above. Keep edits minimal and factual — only the lines that are now wrong.

- [ ] **Step 2: Verify + commit**

Run: `npm test` → PASS (CLAUDE.md / comments are not test-parsed, but confirm nothing else broke).

```bash
git add CLAUDE.md frontend/src/design-system.css docs/superpowers/specs/2026-09-01-editorial-ui-redesign-design.md
git commit -m "docs: sync CLAUDE.md + token comments to Hanken/amber identity"
```

---

## Self-review notes

- **Spec §1.1 amber** → Task 1.2. **§1.2 warning collision** → Task 1.2 Step 6. **§1.3 neutrals** → Task 1.3. **§1.4 text tiers** → Global Constraints + verified in Task 1.3 Step 1. **§1.5 typography** → Task 1.1 + 1.4. **§1.6 spacing** → Task 1.5 + applied 2.1/2.3. **§1.7 shadows** → Task 1.5. **§1.8 motion** → Global Constraints + applied per component (spring not used in any Phase 2–5 task — correct, spec reserves it for Now Playing / like-heart which are out of scope). **§1.9 `[data-theme]` map** → Task 1.2 Step 5.
- **Spec §2 shell** → Phase 2. **§3 track list** → Phase 3. **§4 player bar** → Phase 4. **§5 grids** → Phase 5. **§6 polish+verif** → Phase 6.
- **Testing-impact section** → each `theme-palette` / `a11y` expectation edit is co-located with its token change (Tasks 1.2, 1.3), and the new accent-as-text assertion is Task 1.2 Step 2.
- **`--bg-base` deviation from spec:** the spec's §1.3 table proposed `#030304`; this plan keeps it exactly `#030303` because `a11y.test.cjs` hard-codes `#030303` for border math and the 1-point blue shift is imperceptible. Documented in Global Constraints.
- **Type consistency:** `--accent` `#E7A33D` / `--g-rgb` `231,163,61` used identically in Tasks 1.2, 1.3, and the a11y assertion. `--tr-h` `64` used identically in Tasks 3.1, 3.2. `--space-8` `64px` defined in 1.5, consumed in 2.1/2.3.
- **Open item for the executor:** confirm the active-nav class (`.ni.on` vs `.ni.act`), the active-tab selector, the selected-row class (`.tr.sel`), and how `CFG.VIRT_ROW_H` derives from `--tr-h` — all flagged inline in the relevant tasks. These are read-only lookups, not decisions.
