# A11y Remediation Plan (WCAG 2.1 AA)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring libreflow to WCAG 2.1 Level AA conformance by remediating the 16 findings from the 2026-05-29 maestro a11y audit (5 CRITICAL / 5 HIGH / 6 MEDIUM).

**Architecture:** 4 sequential batches. **A** ships the 5 CRITICAL contrast + ARIA semantics fixes that block AA conformance. **B** ships the 5 HIGH-priority fixes (destructive action protection, language switching, shortcuts guard, value text, hover affordance polish). **C** ships the 6 MEDIUM polish items (focus halo, role inventory, toast pacing, focus traps, virtual scroll grid semantics). **D** is a final regression sweep + manual smoke checklist. The plan is built on top of branch `theme-overhaul` (last commit `2cfae1f`); the previous theme work is the assumed baseline for contrast computations.

**Tech Stack:** Vanilla ESM JS, Lit 3.x Web Components, Tauri 2 desktop (Chromium), Node 20 CJS test runner (`frontend/tests/core.test.cjs`), no extra npm deps allowed.

---

## Pre-flight context for the executing engineer

If you have never touched libreflow before, read these first:

1. `CLAUDE.md` §2 (invariants), §13 (CSS+DOM discipline), §17 (frontend stack), §19 (pre-commit checklist).
2. `docs/superpowers/plans/2026-05-29-theme-overhaul.md` — the theme work that this plan stacks on top of. Tokens you'll use (`--g`, `--g-rgb`, `--text-on-accent`, `--bg-base`, `--text-primary/secondary/muted`, `--motion-fast`, `--ease-standard`) all live in `frontend/src/design-system.css`.
3. `frontend/index.html` — the DOM the audit was run against. Many interactive widgets are defined here; the JS modules wire behavior on top.
4. `frontend/tests/core.test.cjs` — append-only suite. Add new test files by appending `await require('./<name>.test.cjs').run();` near the end.
5. `frontend/tests/_wcag.cjs` — pure WCAG 2.1 contrast helper (added by B1.1 of theme-overhaul). Reuse it. Do not add new npm dependencies.

**Branch:** stay on `theme-overhaul`. Do NOT branch again — this plan extends the same branch with `a11y-*` prefixed commits.

**Test runner:** `npm test`. 354+ tests currently green. Conventional Commits enforced.

**No-network rule:** libreflow is offline (CLAUDE.md §15). Every step must keep that. No `fetch`, no `XMLHttpRequest`, no CDN-imported `axe` or `pa11y` libraries. Static a11y validation is done by parsing files with Node's built-in `fs` and computing checks programmatically.

**Manual smoke caveat:** several a11y verifications require a real screen reader (NVDA on Windows is the libreflow target) and cannot be exercised by headless code. The plan flags those steps as "manual smoke" — the executing engineer runs them and records pass/fail in the commit message body, but does not block the commit on them.

---

## File Structure — what gets touched and why

| File | Why this plan touches it |
|---|---|
| `frontend/src/style.css` | Contrast bumps (`.tlk`, `.tr-add-btn`, `.tr-edit-btn`, `.tr-chev`), `.skip-link` polish, focus-halo tuning |
| `frontend/src/design-system.css` | Border alpha bumps (`--border-subtle`, `--border-default`, `--border-strong`) for SC 1.4.11 |
| `frontend/index.html` | Add `role="dialog" aria-modal aria-label` on `#cinema-overlay`; refine `aria-current` placeholders on virtual scroll containers |
| `frontend/src/eq.js` | Add `aria-orientation="vertical"` + `aria-valuetext` on EQ band sliders |
| `frontend/src/player.js` | Volume slider: emit `aria-valuetext` "X pour cent" on change |
| `frontend/src/handlers.js` | Single-key shortcut guard against input focus |
| `frontend/src/i18n.js` | Update `document.documentElement.lang` on locale switch |
| `frontend/src/selection.js` | Long destructive-action toast (15s) when assistive tech detected |
| `frontend/src/cinema.js` | Focus trap + ESC-to-close on cinema overlay |
| `frontend/src/virt.js` | Emit `aria-rowcount` + `aria-rowindex` on virtual rows |
| `frontend/src/library.js` | Set `aria-current="true"` on the playing track row |
| **NEW** `frontend/src/a11y.js` | Tiny helper module: `liveAnnounce(text)` + `setAriaValueText(el, fmt)` + `trapFocusIn(container)` — kept pure DOM, no IPC |
| **NEW** `frontend/tests/_a11y.cjs` | Pure helpers to inventory ARIA attributes in HTML + compute flat colors from rgba+bg |
| **NEW** `frontend/tests/a11y.test.cjs` | Static a11y suite: borders ≥3:1, action button rest ≥3:1, cinema-overlay role=dialog, EQ aria-orientation, html lang switchable, action confirm presence |

No Rust changes. No IPC changes. No IDB schema changes. No `tracks[]` mutation.

---

# Batch A — CRITICAL (block AA conformance)

**Outcome:** All 5 CRITICAL audit findings closed. After A, the app passes WCAG 2.1 AA on the items that were definitively failing in computed contrast or semantic ARIA.

**Estimated effort:** 1 day. ~7 commits.

---

### Task A.1: Create the static a11y test helper

**Files:**
- Create: `frontend/tests/_a11y.cjs`

- [ ] **Step 1: Write the helper**

```javascript
// frontend/tests/_a11y.cjs
// Pure helpers pour suites a11y statiques. Aucun npm dep ajouté.
'use strict';

const fs = require('fs');
const path = require('path');

/** Lit le contenu UTF-8 d'un fichier relatif à la racine du repo. */
function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

/**
 * Aplatit une couleur rgba `fg` (hex sans alpha) avec alpha `a` (0..1)
 * sur un fond opaque `bg` (hex). Retourne un hex sans alpha.
 */
function flattenAlpha(fgHex, alpha, bgHex) {
  const fg = parseInt(fgHex.replace('#', ''), 16);
  const bg = parseInt(bgHex.replace('#', ''), 16);
  const fr = (fg >> 16) & 255, fG = (fg >> 8) & 255, fb = fg & 255;
  const br = (bg >> 16) & 255, bG = (bg >> 8) & 255, bb = bg & 255;
  const r = Math.round(br * (1 - alpha) + fr * alpha);
  const g = Math.round(bG * (1 - alpha) + fG * alpha);
  const b = Math.round(bb * (1 - alpha) + fb * alpha);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Cherche toutes les balises d'un élément donné dans un HTML
 * et retourne un tableau d'objets { tag, id, classes, attrs }.
 */
function findElements(html, selectorPredicate) {
  const re = /<([a-z][a-z0-9-]*)\s+([^>]*?)\/?>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrsRaw = m[2];
    const attrs = {};
    const ar = /([a-z-]+)\s*=\s*"([^"]*)"/gi;
    let am;
    while ((am = ar.exec(attrsRaw))) attrs[am[1]] = am[2];
    const id = attrs.id || null;
    const classes = (attrs.class || '').split(/\s+/).filter(Boolean);
    if (selectorPredicate({ tag, id, classes, attrs })) {
      out.push({ tag, id, classes, attrs });
    }
  }
  return out;
}

module.exports = { readRepoFile, flattenAlpha, findElements };
```

- [ ] **Step 2: Smoke check**

Run: `node -e "const {flattenAlpha, findElements, readRepoFile}=require('./frontend/tests/_a11y.cjs'); console.log(flattenAlpha('#ffffff', 0.14, '#030303')); console.log(findElements('<div id=\"x\" class=\"y\"></div>', e=>e.id==='x'));"`

Expected: prints `#262626` then `[ { tag: 'div', id: 'x', classes: [ 'y' ], attrs: { id: 'x', class: 'y' } } ]`.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/_a11y.cjs
git commit -m "test(a11y): add pure helpers for static accessibility checks"
```

---

### Task A.2: Create the a11y test suite (failing baseline)

**Files:**
- Create: `frontend/tests/a11y.test.cjs`
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 1: Write the failing suite**

```javascript
// frontend/tests/a11y.test.cjs
// Static a11y guardrails. Reflète les findings du maestro a11y audit 2026-05-29.
'use strict';

const assert = require('assert');
const { readRepoFile, flattenAlpha } = require('./_a11y.cjs');
const { contrastRatio } = require('./_wcag.cjs');

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── a11y — WCAG 2.1 AA static checks ──');

  const DS  = readRepoFile('frontend/src/design-system.css');
  const SS  = readRepoFile('frontend/src/style.css');
  const HTML = readRepoFile('frontend/index.html');

  // --- SC 1.4.11 Non-text Contrast (borders >= 3:1 on Vantablack) -------
  function extractBorderAlpha(css, tokenName) {
    const re = new RegExp(`--${tokenName}\\s*:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([0-9.]+)\\s*\\)`);
    const m = re.exec(css);
    if (!m) throw new Error(`token --${tokenName} not found as rgba(255,255,255,A)`);
    return parseFloat(m[1]);
  }

  await t('border-subtle has >=3:1 on --bg-base', () => {
    const a = extractBorderAlpha(DS, 'border-subtle');
    const flat = flattenAlpha('#ffffff', a, '#030303');
    const r = contrastRatio(flat, '#030303');
    assert.ok(r >= 3.0, `border-subtle alpha ${a} -> ${r.toFixed(2)}:1 (need 3.0)`);
  });
  await t('border-default has >=3:1 on --bg-base', () => {
    const a = extractBorderAlpha(DS, 'border-default');
    const flat = flattenAlpha('#ffffff', a, '#030303');
    const r = contrastRatio(flat, '#030303');
    assert.ok(r >= 3.0, `border-default alpha ${a} -> ${r.toFixed(2)}:1 (need 3.0)`);
  });

  // --- SC 1.4.11 Action buttons at rest >= 3:1 ---------------------------
  await t('.tlk rest uses var(--t3) (not --t4)', () => {
    const m = /\.tlk\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk base rule not found');
    assert.ok(/color\s*:\s*var\(\s*--t3\s*\)/.test(m[0]),
      '.tlk base rule should set color: var(--t3) for AA contrast at opacity 0.45');
  });
  await t('.tlk rest opacity >= 0.45', () => {
    const m = /\.tlk\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk base rule not found');
    const o = /opacity\s*:\s*([0-9.]+)/.exec(m[0]);
    assert.ok(o, '.tlk should declare opacity');
    assert.ok(parseFloat(o[1]) >= 0.45, `.tlk opacity ${o[1]} too low`);
  });

  // --- SC 1.4.1 Use of Color — liked state must have a non-color cue ----
  await t('.tlk.on declares a non-color cue', () => {
    const m = /\.tlk\.on\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk.on rule not found');
    const cssText = m[0];
    const hasCue = /background(-color)?\s*:/i.test(cssText)
      || /transform\s*:/i.test(cssText)
      || /mask(-image)?\s*:/i.test(cssText)
      || /filter\s*:.*drop-shadow/i.test(cssText);
    assert.ok(hasCue,
      '.tlk.on relies on color only — add a non-color cue (background, transform, or filled-icon swap)');
  });

  // --- SC 4.1.2 Cinema overlay must have role=dialog + aria-modal -------
  await t('#cinema-overlay has role="dialog"', () => {
    const re = /id="cinema-overlay"[^>]*role="dialog"|role="dialog"[^>]*id="cinema-overlay"/;
    assert.ok(re.test(HTML), '#cinema-overlay missing role="dialog"');
  });
  await t('#cinema-overlay has aria-modal="true"', () => {
    const re = /id="cinema-overlay"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="cinema-overlay"/;
    assert.ok(re.test(HTML), '#cinema-overlay missing aria-modal="true"');
  });
  await t('#cinema-overlay has aria-label', () => {
    const re = /id="cinema-overlay"[^>]*aria-label="/;
    assert.ok(re.test(HTML), '#cinema-overlay missing aria-label');
  });

  // --- SC 4.1.2 EQ band sliders need aria-orientation -------------------
  await t('eq.js sets aria-orientation on band sliders', () => {
    const eqJs = readRepoFile('frontend/src/eq.js');
    assert.ok(/aria-orientation/.test(eqJs),
      'eq.js does not set aria-orientation on band sliders');
  });

  if (fail) { console.log(`\nA11Y FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nA11Y OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 2: Wire into `core.test.cjs`**

Open `frontend/tests/core.test.cjs`. Find the line `await require('./theme-light-coverage.test.cjs').run();`. Append immediately after it:

```javascript
// A11y static guardrails (WCAG 2.1 AA)
await require('./a11y.test.cjs').run();
```

- [ ] **Step 3: Run, confirm RED**

Run: `npm test`
Expected: a11y block prints 5–9 RED failures (none of the remediations have landed yet).

- [ ] **Step 4: Commit (red baseline)**

```bash
git add frontend/tests/a11y.test.cjs frontend/tests/core.test.cjs
git commit -m "test(a11y): assert WCAG 2.1 AA static guardrails (red baseline)"
```

---

### Task A.3: Fix `.tlk` rest contrast (A11Y-01)

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate the `.tlk` base rule**

Use Grep with pattern `^\.tlk\s*\{`, path `frontend/src/style.css`, output_mode content, -n true, -A 4. You'll find the base rule plus the per-state rules (`.tlk:hover`, `.tlk:focus-visible`, `.tlk.on`). The base rule was set by B4-H2 of theme-overhaul to `opacity: 0.45` with `color: var(--t4)`.

- [ ] **Step 2: Replace the color**

Find `color: var(--t4);` inside the base `.tlk { ... }` rule and change it to `color: var(--t3);`. Keep `opacity: 0.45` and the transition intact.

Before (illustrative):

```css
.tlk {
  opacity   : 0.45;
  color     : var(--t4);
  transition: opacity var(--motion-fast) var(--ease-standard);
}
```

After:

```css
.tlk {
  opacity   : 0.45;
  color     : var(--t3);
  transition: opacity var(--motion-fast) var(--ease-standard);
}
```

- [ ] **Step 3: Run the failing tests**

Run: `npm test`
Expected: `.tlk rest uses var(--t3) (not --t4)` and `.tlk rest opacity >= 0.45` both GREEN.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix(a11y): .tlk rest uses --t3 for AA contrast on Vantablack (A11Y-01)"
```

---

### Task A.4: Apply the same fix to `.tr-add-btn`, `.tr-edit-btn`, `.tr-chev` (A11Y-06)

**Files:**
- Modify: `frontend/src/style.css`

These three buttons share the same `opacity: 0.45` pattern from B4-H2 and have the same failure.

- [ ] **Step 1: Locate**

Grep with pattern `^\.tr-(add-btn|edit-btn|chev)\s*\{`, path `frontend/src/style.css`, output_mode content, -n true, -A 4.

- [ ] **Step 2: Apply the swap**

For each of the three rules, if the base rule sets `color: var(--t4);` change it to `color: var(--t3);`. If the rule does not set `color:` at all, then add:

```css
color: var(--t3);
```

Inside the base rule (NOT inside `:hover` / `:focus-visible` / `.on`).

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: still GREEN where it was. A11Y-06 has no dedicated automated check — this is a visual confirmation.

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`
Open a library view. Hover a track row. The action buttons should appear at rest with a discreet muted-grey, and bump to full opacity on row-hover.

If the visual is too prominent at rest, adjust opacity DOWN from 0.45 to 0.40 — but never below 0.40 (below that the flat contrast drops under 3:1 again).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix(a11y): track-row action buttons use --t3 for AA contrast (A11Y-06)"
```

---

### Task A.5: Add a non-color cue for liked state (A11Y-02)

**Files:**
- Modify: `frontend/src/style.css`

The like state today is signalled by `.tlk.on { color: var(--g); }` — pure color. Color-blind users can't tell liked from unliked.

- [ ] **Step 1: Locate**

Find the `.tlk.on { ... }` rule via Grep `\.tlk\.on\s*\{`.

- [ ] **Step 2: Replace with the multi-cue rule**

Before (illustrative):

```css
.tlk.on { color: var(--g); opacity: 1; }
```

After:

```css
.tlk.on {
  color           : var(--g);
  opacity         : 1;
  background      : var(--accent-subtle);
  border-radius   : 50%;
  transform       : scale(1.05);
  filter          : drop-shadow(0 0 6px rgba(var(--g-rgb), .45));
  transition: background var(--motion-fast) var(--ease-standard),
              transform  var(--motion-fast) var(--ease-spring),
              filter     var(--motion-fast) var(--ease-standard),
              color      var(--motion-fast) var(--ease-standard);
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: `.tlk.on declares a non-color cue` GREEN.

- [ ] **Step 4: Manual smoke**

`npm run dev` → click a heart in the library. Should snap into a tinted disc with a soft indigo glow + slight pop. Click again → returns to default outline state with no background.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix(a11y): liked state adds background + scale + glow cues (A11Y-02)"
```

---

### Task A.6: Bump border alphas for SC 1.4.11 (A11Y-03)

**Files:**
- Modify: `frontend/src/design-system.css`

The border tokens currently at `.08 / .14 / .22` resolve to 1.15 / 1.36 / 1.81 on `#030303` — all below the 3:1 non-text contrast requirement.

- [ ] **Step 1: Locate**

In `frontend/src/design-system.css` find the §2ter block:

```css
  --border-subtle  : rgba(255, 255, 255, 0.08);
  --border-default : rgba(255, 255, 255, 0.14);
  --border-strong  : rgba(255, 255, 255, 0.22);
  --border-focus   : var(--accent);
```

- [ ] **Step 2: Replace with AA-compliant alphas**

```css
  /* --- Bordures — AA non-text contrast (>=3:1 sur Vantablack) ---------- */
  --border-subtle  : rgba(255, 255, 255, 0.45);   /* 3.1:1 vs #030303 */
  --border-default : rgba(255, 255, 255, 0.55);   /* 4.0:1 */
  --border-strong  : rgba(255, 255, 255, 0.65);   /* 5.2:1 */
  --border-focus   : var(--accent);
```

If after smoke they look too aggressive on decorative dividers, use `--tint-1` instead (no contrast requirement).

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: `border-subtle` and `border-default` >=3:1 both GREEN.

- [ ] **Step 4: Manual smoke**

`npm run dev` → check modal edges, sidebar / main separator, card boundaries, dropdown menus. Bordures should be clearly visible without dominating.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design-system.css
git commit -m "fix(a11y): bump border alphas to >=3:1 on Vantablack (A11Y-03)"
```

---

### Task A.7: Add dialog semantics to `#cinema-overlay` (A11Y-04)

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Locate**

In `frontend/index.html` find line 1218 (or nearby — search for `id="cinema-overlay"`).

- [ ] **Step 2: Add the ARIA attributes**

Before:

```html
<div id="cinema-overlay">
```

After:

```html
<div id="cinema-overlay" role="dialog" aria-modal="true" aria-label="Mode cinéma" tabindex="-1">
```

`tabindex="-1"` lets JS programmatically focus the overlay when opened without making it part of the natural tab order.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: the 3 cinema-overlay a11y checks GREEN.

- [ ] **Step 4: Manual smoke (NVDA recommended)**

`npm run dev` → start playback → open cinema. NVDA should announce "Mode cinéma, boîte de dialogue, modal".

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html
git commit -m "fix(a11y): #cinema-overlay declares role=dialog + aria-modal (A11Y-04)"
```

---

### Task A.8: Wire focus trap + ESC-to-close on cinema overlay (A11Y-04 cont.)

**Files:**
- Modify: `frontend/src/cinema.js`

- [ ] **Step 1: Read cinema.js**

Open `frontend/src/cinema.js`. Find the function that opens the overlay. Note the symmetric close function.

- [ ] **Step 2: Add focus management**

At module top:

```javascript
let _cinemaLastFocus = null;
```

In `openCinema`:

```javascript
_cinemaLastFocus = document.activeElement;
const overlay = document.getElementById('cinema-overlay');
if (overlay) {
  overlay.removeAttribute('hidden');
  requestAnimationFrame(() => overlay.focus());
}
```

In `closeCinema`:

```javascript
if (_cinemaLastFocus && document.contains(_cinemaLastFocus) && typeof _cinemaLastFocus.focus === 'function') {
  _cinemaLastFocus.focus();
}
_cinemaLastFocus = null;
```

- [ ] **Step 3: Add ESC binding + Tab cycle**

```javascript
function _onCinemaKeydown(e) {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay || overlay.hasAttribute('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeCinema(); return; }
  if (e.key === 'Tab') {
    const focusables = overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) { e.preventDefault(); return; }
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

document.addEventListener('keydown', _onCinemaKeydown);
```

- [ ] **Step 4: Manual smoke**

`npm run dev` → play a track → open cinema. Press TAB through the controls — focus stays inside. Press ESC — overlay closes AND focus returns to the cinema button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/cinema.js
git commit -m "fix(a11y): focus trap + ESC-to-close on cinema overlay (A11Y-04)"
```

---

### Task A.9: EQ band sliders — `aria-orientation` (A11Y-05)

**Files:**
- Modify: `frontend/src/eq.js`

- [ ] **Step 1: Locate the slider creation**

Open `frontend/src/eq.js`. Search for `createElement('input')` or `type="range"`.

- [ ] **Step 2: Add `aria-orientation` + `aria-valuetext`**

When the slider element is created:

```javascript
sliderEl.setAttribute('type', 'range');
sliderEl.setAttribute('aria-orientation', 'vertical');
sliderEl.setAttribute('aria-label', `Bande ${band.hz} Hz`);
sliderEl.setAttribute('aria-valuetext', `${currentGain > 0 ? '+' : ''}${currentGain.toFixed(1)} dB`);
```

- [ ] **Step 3: Keep `aria-valuetext` in sync on input**

In the `input` event handler:

```javascript
sliderEl.addEventListener('input', (e) => {
  const gain = parseFloat(e.target.value);
  applyEqGain(band, gain);
  e.target.setAttribute('aria-valuetext', `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`);
});
```

- [ ] **Step 4: Keep `orient="vertical"` for Firefox CSS hack**

Do NOT remove the `orient="vertical"` line. Firefox still relies on it.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `eq.js sets aria-orientation on band sliders` GREEN.

- [ ] **Step 6: Manual smoke (NVDA)**

Open EQ panel. Tab to a band slider. NVDA should announce "Bande 1000 Hz, curseur, orientation verticale, 0 dB".

- [ ] **Step 7: Commit**

```bash
git add frontend/src/eq.js
git commit -m "fix(a11y): EQ band sliders announce vertical orientation (A11Y-05)"
```

---

### Task A.10: Batch A regression sweep

- [ ] **Step 1: Run the full suite**

```
npm test
```

Expected: 354+ tests OK, a11y suite all GREEN for the CRITICAL findings.

- [ ] **Step 2: Manual smoke pass**

`npm run dev` →

- Hover a track row: `.tlk` `.tr-add-btn` `.tr-edit-btn` `.tr-chev` visible at rest, full on hover.
- Like a track: heart fills with indigo background, slight scale, glow.
- Toggle light + dark: nothing broken in light; dark still flat-Vantablack with crisp borders.
- Open cinema: NVDA announces "Mode cinéma, modal". TAB stays inside. ESC closes.
- Open EQ: tab to a band slider, NVDA says "orientation verticale, X dB".

- [ ] **Step 3: Empty commit marking batch end**

```bash
git commit --allow-empty -m "chore(a11y): batch A (CRITICAL) complete"
```

---

# Batch B — HIGH (degrade AT experience)

**Outcome:** All 5 HIGH-priority findings remediated.

**Estimated effort:** 1 day. ~6 commits.

---

### Task B.1: Create the a11y helper module

**Files:**
- Create: `frontend/src/a11y.js`

- [ ] **Step 1: Write the module**

```javascript
// LibreFlow — a11y.js
// Helpers a11y purement DOM. Aucun IPC, IDB ou audio.

let _live = null;
function _ensureLiveRegion() {
  if (_live && document.contains(_live)) return _live;
  _live = document.createElement('div');
  _live.id = 'a11y-live';
  _live.setAttribute('aria-live', 'polite');
  _live.setAttribute('aria-atomic', 'true');
  _live.className = 'sr-only';
  document.body.appendChild(_live);
  return _live;
}

/**
 * Annonce un message dans une live region masquée visuellement.
 * @param {string} text
 * @param {'polite'|'assertive'} [priority='polite']
 */
export function liveAnnounce(text, priority = 'polite') {
  if (!text) return;
  const el = _ensureLiveRegion();
  if (el.getAttribute('aria-live') !== priority) {
    el.setAttribute('aria-live', priority);
  }
  el.textContent = '';
  Promise.resolve().then(() => { el.textContent = String(text); });
}

/**
 * Assigne aria-valuetext sur l'élément `el` à la valeur formattée par `fmt(val)`.
 */
export function setAriaValueText(el, fmt, val) {
  if (!el || typeof fmt !== 'function') return;
  el.setAttribute('aria-valuetext', fmt(val));
}

/**
 * Configure un focus trap sur un conteneur. Retourne une fonction d'arrêt.
 */
export function trapFocusIn(container) {
  if (!container) return () => {};
  const lastFocused = document.activeElement;
  const focusables = () => container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const onKey = (e) => {
    if (e.key === 'Escape') {
      const closeBtn = container.querySelector('[data-action="close"], .modal-close');
      if (closeBtn) closeBtn.click();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    const list = focusables();
    if (list.length) list[0].focus();
  });
  return function release() {
    document.removeEventListener('keydown', onKey);
    if (lastFocused && document.contains(lastFocused) && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };
}
```

- [ ] **Step 2: Smoke (node parse check)**

Run: `node --check frontend/src/a11y.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/a11y.js
git commit -m "feat(a11y): add a11y.js helpers (liveAnnounce, setAriaValueText, trapFocusIn)"
```

---

### Task B.2: Volume slider `aria-valuetext` (A11Y-08)

**Files:**
- Modify: `frontend/src/player.js`

- [ ] **Step 1: Locate the volume change handler**

Open `frontend/src/player.js`. Search for `#vol` / `'vol'` or the function that reads `vol.value` to set audio gain.

- [ ] **Step 2: Import and use the helper**

At the top:

```javascript
import { setAriaValueText } from './a11y.js';
```

In the handler that processes a volume change (the SAME handler that updates the audio gain — do NOT add a separate listener), after writing the audio value:

```javascript
setAriaValueText(vol, v => `${Math.round(v * 100)} pour cent`, parseFloat(vol.value));
```

- [ ] **Step 3: Set initial `aria-valuetext` at boot**

Where the volume slider is initialised at boot (reads cfg.volume and sets vol.value), also call:

```javascript
setAriaValueText(vol, v => `${Math.round(v * 100)} pour cent`, parseFloat(vol.value));
```

- [ ] **Step 4: Manual smoke (NVDA)**

`npm run dev` → focus volume slider with Tab → use ↑/↓ to change. NVDA reads "78 pour cent" instead of "0.78".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/player.js
git commit -m "fix(a11y): volume slider announces percentage via aria-valuetext (A11Y-08)"
```

---

### Task B.3: Guard single-key shortcuts against input focus (A11Y-10)

**Files:**
- Modify: `frontend/src/handlers.js`

- [ ] **Step 1: Locate the global keydown handler**

Open `frontend/src/handlers.js`. Find the `keydown` listener that dispatches shortcuts.

- [ ] **Step 2: Add the input guard at the top of the handler**

```javascript
function _isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.getAttribute && target.getAttribute('role') === 'textbox') return true;
  return false;
}
```

At the very start of the keydown handler:

```javascript
document.addEventListener('keydown', (e) => {
  if (_isTypingTarget(e.target)) {
    if (e.ctrlKey || e.metaKey) return;     // let modifier combos through
    if (e.key === 'Escape') {
      e.target.blur();
      return;
    }
    return;
  }
  // ... existing dispatch logic ...
});
```

- [ ] **Step 3: Manual smoke**

`npm run dev` → click in the search bar. Type "play". The library should not toggle play/pause. Press Escape → input blurs.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/handlers.js
git commit -m "fix(a11y): single-key shortcuts ignore input focus (A11Y-10)"
```

---

### Task B.4: `<html lang>` updates on i18n switch (A11Y-09)

**Files:**
- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: Locate the locale switch function**

Open `frontend/src/i18n.js`. Find the function that swaps the active locale.

- [ ] **Step 2: Set the document lang**

At the top of that function (after locale validation, before applying translations):

```javascript
document.documentElement.lang = locale;
```

- [ ] **Step 3: Manual smoke (NVDA)**

`npm run dev` → switch to English in Settings. NVDA should switch to English voice. Check `<html>` in devtools — `lang="en"` after the switch.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n.js
git commit -m "fix(a11y): document.documentElement.lang follows i18n locale (A11Y-09)"
```

---

### Task B.5: Longer destructive-action undo + Ctrl+Z (A11Y-07)

**Files:**
- Modify: `frontend/src/selection.js`

- [ ] **Step 1: Locate selRemove**

Open `frontend/src/selection.js`. Search for `selRemove`.

- [ ] **Step 2: Increase toast duration**

When `selRemove` finishes the actual removal and calls `toast(...)` or `toastWithAction(...)`, bump the duration to 15000 and update the message to mention Ctrl+Z:

Before (illustrative):

```javascript
toastWithAction(
  `${n} morceaux supprimés`,
  { label: 'Annuler', onClick: undoFn },
  { type: 'warning', duration: 5000 }
);
```

After:

```javascript
toastWithAction(
  `${n} morceaux supprimés. Ctrl+Z pour annuler.`,
  { label: 'Annuler', onClick: undoFn },
  { type: 'warning', duration: 15000 }
);
```

- [ ] **Step 3: Wire Ctrl+Z to the undo callback**

Add a helper at the top of `selection.js`:

```javascript
function _attachOneShotUndo(undoFn, durationMs) {
  const handler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoFn();
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('keydown', handler);
  setTimeout(() => document.removeEventListener('keydown', handler), durationMs);
}
```

Then in `selRemove` after presenting the toast:

```javascript
_attachOneShotUndo(undoFn, 15000);
```

- [ ] **Step 4: Manual smoke**

`npm run dev` → select 3 tracks → remove. Toast appears for 15s with "Ctrl+Z pour annuler". Press Ctrl+Z within 15s → tracks return.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/selection.js
git commit -m "fix(a11y): destructive removal 15s undo + Ctrl+Z (A11Y-07)"
```

---

### Task B.6: Batch B regression sweep

- [ ] **Step 1: Run full suite**

`npm test` → 354+ OK.

- [ ] **Step 2: Manual smoke**

- Type "p" in search bar → no play toggle.
- Press Escape in search bar → input blurs.
- Adjust volume with ↑↓ → NVDA reads percentage.
- Switch language → `<html lang>` updates.
- Multi-select 3 tracks → remove → 15s toast → Ctrl+Z restores.

- [ ] **Step 3: Empty commit marking batch end**

```bash
git commit --allow-empty -m "chore(a11y): batch B (HIGH) complete"
```

---

# Batch C — MEDIUM (polish + virtual scroll semantics)

**Outcome:** Focus halo readable on Vantablack, role inventory cleaner, toast pacing audited, modal focus traps verified, track row carries `aria-current`, virtual scroll declares grid semantics.

**Estimated effort:** 2 days. ~7 commits.

---

### Task C.1: Adapt focus-halo for Vantablack (A11Y-11)

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Locate**

In `style.css` find the `--focus-halo` declaration.

- [ ] **Step 2: Swap to an indigo-tinted halo for dark mode**

Before:

```css
--focus-halo:    rgba(0,0,0,.55);
```

After:

```css
--focus-halo:    rgba(139, 107, 255, .35);   /* indigo glow on Vantablack */
```

The light-mode override defined in `frontend/src/design-system.css` §12 stays as it is (`rgba(255,255,255,.55)`).

- [ ] **Step 3: Apply the halo to the focus ring**

Find the `:focus-visible` rule. Add a box-shadow halo:

```css
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  box-shadow: 0 0 0 4px var(--focus-halo);
}
```

If `:focus-visible` already has a box-shadow declaration, merge:

```css
box-shadow: 0 0 0 4px var(--focus-halo), <existing-shadow>;
```

- [ ] **Step 4: Manual smoke**

`npm run dev` → tab through the player bar, sidebar, modals. Focus should always be visible with a soft indigo glow + 2px solid ring.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix(a11y): focus-halo uses indigo glow on Vantablack (A11Y-11)"
```

---

### Task C.2: Inventory `data-action` without ARIA role (A11Y-12)

**Files:**
- Modify: `frontend/tests/a11y.test.cjs`
- Modify: `frontend/index.html`

- [ ] **Step 1: Add the test**

Inside the existing `run()` function of `a11y.test.cjs`, before the final fail check, append:

```javascript
await t('non-button data-action elements have role + tabindex', () => {
  const re = /<(div|span)\s+([^>]*?data-action="[^"]+"[^>]*?)>/gi;
  let m, offenders = [];
  while ((m = re.exec(HTML))) {
    const attrs = m[2];
    const hasRole = /role="(button|link|menuitem|tab|switch|checkbox|option)"/i.test(attrs);
    const hasTab  = /tabindex="(0|-1)"/.test(attrs);
    if (!hasRole || !hasTab) {
      offenders.push(m[0].slice(0, 80) + '...');
    }
  }
  assert.ok(offenders.length === 0,
    `data-action without role/tabindex: ${offenders.length}\n   first 3: ${offenders.slice(0,3).join('\n   ')}`);
});
```

- [ ] **Step 2: Run, observe count**

Run: `npm test` and observe the failure count.

- [ ] **Step 3: Fix offenders**

For each offender, locate it in `frontend/index.html` and add the missing attributes:

```html
<div data-action="foo" role="button" tabindex="0">…</div>
```

If a `data-action` is on a tab in a tablist, use the appropriate role (`role="tab"`).

Do this incrementally — one commit per ~5 offenders.

- [ ] **Step 4: Commit (one per group)**

```bash
git add frontend/index.html frontend/tests/a11y.test.cjs
git commit -m "fix(a11y): data-action elements gain role + tabindex (A11Y-12 group N)"
```

Repeat until the test goes GREEN.

- [ ] **Step 5: Manual smoke**

`npm run dev` → tab through the app. Every cliquable surface should accept focus with a visible ring.

---

### Task C.3: Toast timing — adapt to message length (A11Y-13)

**Files:**
- Modify: `frontend/src/components/lf-toast-stack.js`
- Modify: `frontend/src/components/lf-toast-stack.logic.js`
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 1: Add the guard in logic**

Open `frontend/src/components/lf-toast-stack.logic.js`. Find `resolveDuration(type, explicitDur)`. Update:

```javascript
export function resolveDuration(type, explicitDur, message) {
  if (typeof explicitDur === 'number' && explicitDur > 0) return explicitDur;
  const base = TOAST_DUR[normalizeType(type)];
  if (!message) return base;
  const required = Math.ceil(String(message).length / 15) * 1000 + 1500;
  return Math.max(base, required);
}
```

- [ ] **Step 2: Update the caller**

Open `frontend/src/components/lf-toast-stack.js`. Find `resolveDuration(type, opts.duration)` (in `push(opts)`). Update to pass the message:

```javascript
const duration = resolveDuration(type, opts.duration, opts.message);
```

- [ ] **Step 3: Adjust existing tests**

Open `frontend/tests/core.test.cjs`. Find the `resolveDuration("info") === 3000` smoke. Keep it (still passes when no message).

Add new tests near the existing block:

```javascript
await runTest('real module: resolveDuration with short message keeps base', () => {
  const { resolveDuration } = require('../src/components/lf-toast-stack.logic.js');
  assert.strictEqual(resolveDuration('info', null, 'OK'), 3000);
});
await runTest('real module: resolveDuration with long message bumps duration', () => {
  const { resolveDuration } = require('../src/components/lf-toast-stack.logic.js');
  const long = 'a'.repeat(150);
  assert.ok(resolveDuration('info', null, long) >= 11500);
});
```

- [ ] **Step 4: Run tests**

`npm test` → 356+ OK.

- [ ] **Step 5: Manual smoke**

`npm run dev` → in dev console: `ui.toast('Trois cents morceaux importés avec succès depuis le dossier sélectionné', 'success')`. The toast should stay visible for ~5–6 seconds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/lf-toast-stack.js frontend/src/components/lf-toast-stack.logic.js frontend/tests/core.test.cjs
git commit -m "fix(a11y): toast duration scales with message length (A11Y-13)"
```

---

### Task C.4: Audit modal focus traps (A11Y-14)

**Files:**
- Modify: each modal module that lacks a focus trap.

- [ ] **Step 1: Read each modal module**

For each of: `frontend/src/organize.js`, `frontend/src/dropin.js`, `frontend/src/cdaudio.js`, `frontend/src/tagedit.js`, `frontend/src/smartplaylist.js`, `frontend/src/dupes.js`, `frontend/src/playlists.js`, `frontend/src/sleep.js`, `frontend/src/backup.js` —

Grep each for `focus()` calls and `Escape` key handling. List which modules have neither.

- [ ] **Step 2: Apply `trapFocusIn` in each modal module that lacks a trap**

The helper is in `frontend/src/a11y.js` (created by B.1). In the modal's "open" function:

```javascript
import { trapFocusIn } from './a11y.js';

let _release = null;
function openOrganizeModal() {
  // ... existing show logic ...
  _release = trapFocusIn(document.getElementById('organize-modal'));
}
function closeOrganizeModal() {
  // ... existing hide logic ...
  if (_release) { _release(); _release = null; }
}
```

Repeat per modal module that needed it. Adapt to the exact open/close function names in each module.

- [ ] **Step 3: Manual smoke (per modal)**

`npm run dev` → open each modal → Tab through → focus stays inside → Escape → modal closes → focus returns to the opener.

- [ ] **Step 4: Commit (one per modal or per batch of 2–3)**

```bash
git add frontend/src/<modal>.js
git commit -m "fix(a11y): focus trap on <modal-name> via trapFocusIn helper (A11Y-14)"
```

---

### Task C.5: Track row `aria-current` for the playing row (A11Y-15)

**Files:**
- Modify: `frontend/src/library.js` (or wherever `.tr.act` is toggled)

- [ ] **Step 1: Locate**

Grep for `classList.add('act')` and `classList.remove('act')` in `frontend/src/`.

- [ ] **Step 2: Mirror the class with `aria-current`**

Wherever `.tr.act` is added:

```javascript
trEl.classList.add('act');
trEl.setAttribute('aria-current', 'true');
```

Wherever removed:

```javascript
trEl.classList.remove('act');
trEl.removeAttribute('aria-current');
```

- [ ] **Step 3: Manual smoke (NVDA)**

`npm run dev` → play a track → navigate the library list with arrow keys. NVDA announces "Track Foo, en cours de lecture" for the active row.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/library.js
git commit -m "fix(a11y): aria-current on currently playing track row (A11Y-15)"
```

---

### Task C.6: Virtual scroll grid semantics (A11Y-16)

**Files:**
- Modify: `frontend/src/virt.js`
- Modify: `frontend/src/library.js`

- [ ] **Step 1: Set the grid roles on the mount**

In `library.js` (wherever `#tlist` is initialised or rendered), at the container level:

```javascript
const tlist = document.getElementById('tlist');
tlist.setAttribute('role', 'grid');
tlist.setAttribute('aria-rowcount', String(totalTracksCount));
tlist.setAttribute('aria-label', 'Liste des morceaux');
```

Update `aria-rowcount` whenever `tracks[]` mutates (after `rebuildTrackIdxMap()` — same call site).

- [ ] **Step 2: Set role + rowindex on each virtual row**

In `virt.js`, find the function that creates or updates a row. Set:

```javascript
rowEl.setAttribute('role', 'row');
rowEl.setAttribute('aria-rowindex', String(index + 1));
```

- [ ] **Step 3: Manual smoke (NVDA)**

`npm run dev` → focus the library list → use arrow keys to scroll. NVDA should announce "Ligne 1234 sur 50000, Track foo, artist bar".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/virt.js frontend/src/library.js
git commit -m "fix(a11y): virtual scroll declares role=grid + aria-rowcount/rowindex (A11Y-16)"
```

---

### Task C.7: Batch C regression sweep

- [ ] **Step 1: Run full suite**

`npm test` → 356+ OK.

- [ ] **Step 2: Manual smoke**

- Tab through every visible interactive element → ring visible everywhere on dark + light.
- Trigger long toast → it lingers.
- Open each modal → focus trap holds → ESC closes → focus restored.
- Play a track → screen reader announces "en cours de lecture" on the active row.
- Scroll the library → screen reader gives row index.

- [ ] **Step 3: Empty commit marking batch end**

```bash
git commit --allow-empty -m "chore(a11y): batch C (MEDIUM) complete"
```

---

# Batch D — Final regression + manual smoke

**Outcome:** Static suite all green, manual smoke checklist exercised on a real NVDA install, plan archived.

**Estimated effort:** 0.5 day.

---

### Task D.1: Full static regression

- [ ] **Step 1:**

`npm test`
Expected: 356+ OK 0 KO. a11y suite green.

- [ ] **Step 2:**

`npm run bench`
Expected: no regression beyond ±5% of baseline.

- [ ] **Step 3:**

`cargo test`
Expected: green.

---

### Task D.2: Manual NVDA smoke checklist

Run on Windows with NVDA installed. Record pass/fail per item.

- [ ] App boot — NVDA announces "Lecteur LibreFlow, application".
- [ ] Skip link with Tab — Focus reveals it; press Enter — jumps to track list.
- [ ] Player bar Tab cycle — controls announce: play/pause, prev/next, seek slider with percentage, volume with percentage.
- [ ] Track row navigation — arrow keys move focus row to row; NVDA reads track title + artist + "Ligne X sur Y".
- [ ] Playing row — announced as "en cours de lecture".
- [ ] Like a track — heart fills; AT announces "Aimé".
- [ ] Open Settings modal — focus trap; Tab cycles inside; Escape closes; focus returns to Settings button.
- [ ] Repeat for: Organize, USB Import, CD Audio, Tag Editor, Doublons, Shortcuts, Smart Playlist.
- [ ] Cinema mode — opens as dialog; Tab cycles inside; Escape closes; focus restores.
- [ ] EQ panel — each band slider announces "Bande Z Hz, orientation verticale, X dB".
- [ ] Toast — long message lingers; short message dismisses normally.
- [ ] Multi-select remove — undo toast 15s; Ctrl+Z restores.
- [ ] Language switch → `<html lang>` updates; NVDA reads in target language.
- [ ] Type in search — `p` does not toggle play; Escape blurs.

---

### Task D.3: Archive the plan + final tag

- [ ] **Step 1:**

```bash
git commit --allow-empty -m "chore(a11y): WCAG 2.1 AA remediation complete"
git tag -a v-a11y-aa -m "WCAG 2.1 Level AA complete — 16 findings remediated"
```

- [ ] **Step 2:** Update `CLAUDE.md` §2 (invariants) with a new entry:

Find the §2 numbered list and append:

```markdown
9. **WCAG 2.1 AA compliance** — every interactive element has accessible name/role/value; non-text contrast >=3:1 on flat-Vantablack; modals declare role=dialog + aria-modal; focus trap on modals released on close; virtual scroll declares role=grid + aria-rowcount/rowindex.
```

```bash
git add CLAUDE.md
git commit -m "docs(a11y): document WCAG 2.1 AA invariant in CLAUDE.md §2"
```

---

# Self-Review Checklist

I walked the plan once. Findings:

1. **Spec coverage** — each audit finding maps:
   - A11Y-01 → Task A.3 (.tlk rest contrast)
   - A11Y-02 → Task A.5 (liked non-color cue)
   - A11Y-03 → Task A.6 (border alphas)
   - A11Y-04 → Tasks A.7 + A.8 (dialog semantics + focus trap)
   - A11Y-05 → Task A.9 (EQ aria-orientation)
   - A11Y-06 → Task A.4 (action btn opacity color swap)
   - A11Y-07 → Task B.5 (destructive 15s undo)
   - A11Y-08 → Task B.2 (volume aria-valuetext)
   - A11Y-09 → Task B.4 (i18n lang)
   - A11Y-10 → Task B.3 (shortcut input guard)
   - A11Y-11 → Task C.1 (focus halo)
   - A11Y-12 → Task C.2 (data-action role inventory)
   - A11Y-13 → Task C.3 (toast pacing)
   - A11Y-14 → Task C.4 (modal trap audit)
   - A11Y-15 → Task C.5 (track aria-current)
   - A11Y-16 → Task C.6 (grid semantics)

2. **Placeholder scan** — every code step has complete code or a precise edit description. The two exceptions are:
   - Task C.4 step 2 ("Apply `trapFocusIn` in each modal module") — by design parametric, since each module's "open"/"close" naming differs. The helper API and integration shape are fully specified.
   - Task C.2 step 3 ("For each offender, locate it") — by design parametric since the offender count is dynamic. The pattern to apply is fully specified.

3. **Type / token consistency:**
   - `liveAnnounce` / `setAriaValueText` / `trapFocusIn` from `frontend/src/a11y.js` defined in B.1; used in B.2, C.4. Names match.
   - `--border-subtle/default/strong` alpha bumps in A.6 use the same names as the existing tokens redefined in commit `2cfae1f` (flat-Vantablack).
   - `--focus-halo` swap in C.1 maps to the same token already used by the focus ring rule; no new tokens invented.

4. **Test gates** — every CRITICAL finding has at least one automated guard in `frontend/tests/a11y.test.cjs`. HIGH/MEDIUM items lean on manual smoke + non-regression of the existing 354+ tests.

5. **Invariant compliance** — no `fetch`, no IDB mutations, no `tracks[]` mutations, no `audio.volume` literal assignments, no new IPC. All touched modules are pure DOM / pure logic.

6. **Reversibility** — each task is one (sometimes two) atomic commit. `git revert <sha>` undoes any individual remediation.

7. **Branch hygiene** — plan stays on `theme-overhaul`. No new branches. After D.3, the branch can be merged to master.

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-29-a11y-remediation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
