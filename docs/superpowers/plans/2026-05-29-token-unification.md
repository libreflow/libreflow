# Token Unification (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `frontend/src/design-system.css` the literal single source of truth for **all** design tokens — eliminating the parallel `:root` token layer in `style.css` and the dead duplicate declarations — **without changing any rendered pixel** (except one deliberate, reviewed a11y fix).

**Architecture:** Three moves, each gated by a zero-diff visual check. (1) Dedup the declarations that `design-system.css` already makes twice. (2) Relocate the entire `style.css` `:root` token block + `[data-theme]` accent block verbatim into `design-system.css`, then resolve the cross-file conflicts to their **currently-winning** value (so computed values are unchanged). (3) Add a guard test + fix the one a11y conflict the move exposes. Strategy chosen by the user: **consolidate, keep the names** — the 1,133 `--sp-/--r-/--fs-/--dur-` usages are NOT rewritten.

**Tech Stack:** Vanilla CSS (custom properties), Vite 8, Node 20 CJS test runner, Chromium screenshot driver (`scripts/_style-audit-shots.mjs`), git as the visual-diff baseline.

---

## Pre-flight context for the executing engineer

Read first:
1. `docs/superpowers/audits/2026-05-29-style-audit.md` — the audit this plan remediates (findings S1, S2, S3). **This plan does S3 + the S1 "single source" goal. S2 (splitting the 7.6k-line `style.css`) is a SEPARATE later plan — do not attempt it here.**
2. `CLAUDE.md §17` ("Single source of truth for tokens: `design-system.css`… No `:root { --… }` block elsewhere") — currently **violated** by `style.css:94`. §13, §2#9 (a11y), §15 (offline).
3. `frontend/src/design-system.css` (444 lines) and `frontend/src/style.css:93-732` (the `:root` token block + `[data-theme]` accent block).

**How CSS custom properties resolve here:** `index.html:8-9` loads `design-system.css` then `style.css`. A custom property's value = the **last** declaration in source order across both files (specificity equal on `:root`). `var()` references resolve lazily at use-time, so forward references on the same `:root` are fine. **Therefore:** appending the `style.css` block to the *end* of `design-system.css` preserves "later wins" ordering, and the runtime is unchanged.

**The visual-diff gate (used after every phase):** the 25 baseline screenshots in `docs/superpowers/audits/screens/` are committed (`b8a8409`). To verify "no pixel changed":

```bash
# Vite must be running on :1420 (npm run vite). Then:
node scripts/_style-audit-shots.mjs
git status --short docs/superpowers/audits/screens/
```
Expected: **no modified PNGs** (same Chromium, same seed, `reducedMotion:'reduce'` → byte-stable). Any modified PNG = an unintended computed-value change → investigate before continuing. After review, `git checkout docs/superpowers/audits/screens/` to reset for the next phase.

**Branch:** stay on `theme-overhaul`. Conventional Commits enforced. `npm test` must stay green (363 tests).

**No-network rule (§15):** unchanged — CSS only, the screenshot driver hits `localhost:1420` only.

---

## ⚠️ Decision baked into this plan (Task 4)

The relocation exposes that `style.css:412-414` overrides `--border-subtle/default/strong` to `var(--border-1/2/3)` = `rgba(255,255,255,.06/.08/.10)`, **defeating the A11Y-03 AA fix** in `design-system.css:151-153` (`.45/.55/.65`, ≥3:1). The runtime borders are currently `.06` (fail AA); `a11y.test.cjs` passes only because it reads `design-system.css`, not the merged value.

**This plan treats that as a bug to fix, not a value to preserve** (Task 4): drop the `style.css` override so the AA values win, and harden the a11y test to assert the *winning* value. This is the **one** intended visual change (borders become more visible). If the user prefers to keep `.06` and instead relax the a11y intent, change Task 4 accordingly — but the default here restores AA.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `frontend/src/design-system.css` | **The** token source: existing canonical sections (deduped) **+** the relocated operational/alias/shadow/dimension tokens **+** the `[data-theme]` accent map. |
| `frontend/src/style.css` | Rules + theme-mode overrides only. **No `:root{}` token-definition block.** |
| `frontend/tests/token-source.test.cjs` | **NEW** guard: asserts `style.css` declares no top-level `:root{ --… }` token block, and that the canonical scales live in `design-system.css`. |
| `frontend/tests/core.test.cjs` | Wire the new guard suite. |
| `frontend/tests/a11y.test.cjs` | Harden border check to reject a sub-AA override in `style.css` (Task 4). |
| `CLAUDE.md` | §17 note: single-source now literally enforced + guarded. |

No JS/Rust/IPC/IDB changes. No `tracks[]` mutation. No new dependency.

---

# Task 1: Establish the visual-diff baseline harness

**Files:**
- Modify: `scripts/_style-audit-shots.mjs` (already exists from the audit)
- No new test.

- [ ] **Step 1: Confirm Vite is serving**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:1420` (or open it). If not 200, start it: `npm run vite` (background).
Expected: `200`.

- [ ] **Step 2: Regenerate the baseline and confirm it is byte-stable**

Run twice in a row (no code change between):
```bash
node scripts/_style-audit-shots.mjs
git status --short docs/superpowers/audits/screens/
```
Expected: **clean** (zero modified PNGs) on the second run — proving the harness is deterministic and usable as the gate. If PNGs differ run-to-run, increase the settle `waitForTimeout` values in `_style-audit-shots.mjs` until stable, then commit that change.

- [ ] **Step 3: Commit (only if the script changed)**

```bash
git add scripts/_style-audit-shots.mjs
git commit -m "test(tokens): make style-audit screenshot driver deterministic as visual-diff gate"
```
If nothing changed, skip the commit.

---

# Task 2: Dedup the in-file duplicate scales in `design-system.css` (S3)

These are declarations `design-system.css` makes **twice**; the cascade already keeps the later one, so deleting the dead earlier one changes nothing.

**Files:**
- Modify: `frontend/src/design-system.css`

- [ ] **Step 1: Remove the dead `--space-*` block in §2bis**

In `design-system.css` §2bis (around L106-113), the `--space-0…--space-7` declarations are fully overridden by §4 (L206-217). Delete **only** the §2bis spacing lines (`--space-0` through `--space-7`), leaving §4 as the sole definition. Leave radius/text/elev/motion lines in §2bis for now (handled below).

- [ ] **Step 2: Remove the dead `--radius-*` in §2bis**

§2bis defines `--radius-xs/sm/md/lg/pill`; §6 (L264-270) redefines `sm/md/lg/xl/full`. Keep `--radius-xs` (only defined in §2bis) and `--radius-pill` **only if used** — verify:
```bash
grep -rn -- "--radius-pill" frontend/src | grep -v "design-system.css"
```
- If `--radius-pill` has consumers (it is referenced by `--r-pill/--r-round/--r-full` in `style.css`), keep its definition; move it next to §6 with a comment.
- Delete the §2bis `--radius-sm/md/lg` lines (dead — §6 wins).

- [ ] **Step 3: Remove the dead pixel `--text-*` block in §2bis**

§2bis defines pixel `--text-xs…--text-2xl`; §3 (L177-183) redefines `xs/sm/base/md/lg/xl` as `clamp()` and wins. Keep `--text-2xl` (only in §2bis). Delete the §2bis `--text-xs/sm/base/md/lg/xl` pixel lines; relocate `--text-2xl: 26px` next to §3 with a comment `/* 2xl: only fixed step, no clamp peer */`.

- [ ] **Step 4: Verify no computed change**

```bash
node scripts/_style-audit-shots.mjs
git status --short docs/superpowers/audits/screens/
```
Expected: **no modified PNGs**. Then `npm test` → **363 OK**.
If any PNG changed, you deleted a still-winning declaration — `git checkout` design-system.css and re-check which `§` actually wins.

- [ ] **Step 5: Reset screenshots + commit**

```bash
git checkout docs/superpowers/audits/screens/
git add frontend/src/design-system.css
git commit -m "fix(tokens): remove dead duplicate --space/--radius/--text scales in design-system.css (S3)"
```

---

# Task 3: Relocate the `style.css` `:root` token block into `design-system.css`

The block is `style.css:94-722` (the `:root{…}` token layer) plus `style.css:724-732` (the `[data-theme]` accent map). Move both verbatim, then resolve cross-file conflicts to the **currently-winning** value.

**Files:**
- Modify: `frontend/src/design-system.css` (append)
- Modify: `frontend/src/style.css` (delete the block)

- [ ] **Step 1: Append a new section to `design-system.css`**

At the **end** of `design-system.css` (after §12 light theme, before the `@media (prefers-reduced-motion)` block — keep that block last), paste a new banner + the **entire** `style.css` `:root { … }` body from line 94 to 722 (the `:root {` open through its closing `}`), and the `[data-theme="…"]` rules from 724-732. Use this banner:

```css
/* ============================================================================
 * 13. OPERATIONAL & LEGACY-ALIAS TOKENS (relocated from style.css — single source)
 * Per CLAUDE.md §17 these live HERE now, not in style.css. Names preserved
 * (1,133 consumers unchanged). Aliases forward to the canonical scales above;
 * literal-valued tokens (hairlines, display sizes, component dimensions,
 * shadow composites) are the real definition and stay.
 * ============================================================================ */
```

Keep the two `transition:` lines (`style.css:96`, `:721`) and the `@property`-driven `--art-color` exactly as they were — they are part of this `:root`.

- [ ] **Step 2: Delete the block from `style.css`**

Remove `style.css` lines 93-732 inclusive (the `/* ── Variables ── */` comment, the `:root{…}` block, and the `[data-theme]` rules). The first surviving line of `style.css` after this is the `/* ── Zoom liste de pistes ── */` section (formerly ~L734). Leave everything else untouched.

- [ ] **Step 3: Resolve the cross-file conflicts (preserve current winner)**

The moved block redeclares tokens that earlier `design-system.css` sections also declare. Because the moved block is now **last**, it already wins — which **matches the pre-move runtime** (style.css was last before). So computed values are preserved automatically. Confirm each known conflict resolves to the value listed (these are the current winners):

| Token | Pre-move winner (style.css) | Action |
|---|---|---|
| `--text-display` | `32px` | keep moved `32px` (overrides §3 clamp — unchanged from today) |
| `--accent` | `var(--g)` | keep moved `var(--g)` |
| `--accent-subtle` | `var(--gd)` | keep moved `var(--gd)` |
| `--font-display` | `'Syne', -apple-system, sans-serif` | keep moved value |
| `--border-subtle/default/strong` | `var(--border-1/2/3)` (.06/.08/.10) | **leave for Task 4** (do NOT "fix" here) |

Do **not** delete the earlier `design-system.css` declarations of these in this task — leave the duplication; Task 4 / a follow-up resolves naming. The point of Task 3 is the move, value-preserving.

- [ ] **Step 4: Verify zero pixel change**

```bash
node scripts/_style-audit-shots.mjs
git status --short docs/superpowers/audits/screens/
```
Expected: **no modified PNGs** (the move is value-preserving). `npm test` → **363 OK**.
If a PNG changed: a `var()` reference in the moved block now resolves differently — most likely a token it depends on is defined *only* in the part of `style.css` you removed but in the wrong scope. Re-check that every `var(--x)` used in the moved block is still defined on `:root` somewhere in `design-system.css`.

- [ ] **Step 5: Reset screenshots + commit**

```bash
git checkout docs/superpowers/audits/screens/
git add frontend/src/design-system.css frontend/src/style.css
git commit -m "refactor(tokens): relocate style.css :root token layer into design-system.css — single source (§17)"
```

---

# Task 4: Fix the exposed `--border-*` a11y conflict + add the guard test

**Files:**
- Modify: `frontend/src/design-system.css` (resolve `--border-*`)
- Create: `frontend/tests/token-source.test.cjs`
- Modify: `frontend/tests/core.test.cjs`, `frontend/tests/a11y.test.cjs`

- [ ] **Step 1: Resolve `--border-subtle/default/strong` to the AA values**

In `design-system.css`, delete the **relocated** override lines (formerly `style.css:412-414`):
```css
--border-subtle:  var(--border-1);
--border-default: var(--border-2);
--border-strong:  var(--border-3);
```
so the §2ter AA definitions win:
```css
--border-subtle  : rgba(255, 255, 255, 0.45);   /* 3.1:1 vs #030303 */
--border-default : rgba(255, 255, 255, 0.55);   /* 4.0:1 */
--border-strong  : rgba(255, 255, 255, 0.65);   /* 5.2:1 */
```
Keep `--border-1/2/3` (they have other consumers via `--glass`/inset reflections — verify with `grep -n -- "--border-1" frontend/src/`). This is the **one intended visual change**: hairline borders become AA-visible.

- [ ] **Step 2: Write the guard test**

Create `frontend/tests/token-source.test.cjs`:
```javascript
// Guards CLAUDE.md §17: design-system.css is the ONLY token-definition file.
'use strict';
const assert = require('assert');
const { readRepoFile } = require('./_a11y.cjs');

async function run() {
  let pass = 0, fail = 0;
  const t = async (n, fn) => { try { await fn(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`); } };
  console.log('\n── token source of truth (§17) ──');

  const SS = readRepoFile('frontend/src/style.css');
  const DS = readRepoFile('frontend/src/design-system.css');

  await t('style.css declares no top-level :root token block', () => {
    // A token block = a :root{...} containing custom-property definitions.
    const rootBlocks = SS.match(/:root\s*\{[^}]*\}/g) || [];
    const withTokens = rootBlocks.filter(b => /--[\w-]+\s*:/.test(b));
    assert.strictEqual(withTokens.length, 0,
      `style.css still defines tokens in :root (${withTokens.length} block(s)) — move them to design-system.css`);
  });

  await t('design-system.css defines the canonical scales', () => {
    for (const tok of ['--space-4', '--radius-md', '--text-md', '--accent', '--border-subtle']) {
      assert.ok(new RegExp(`${tok}\\s*:`).test(DS), `missing ${tok} in design-system.css`);
    }
  });

  if (fail) { console.log(`\nTOKEN-SOURCE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTOKEN-SOURCE OK: ${pass}/${pass}`);
}
module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 3: Harden the a11y border check against a sub-AA override**

In `frontend/tests/a11y.test.cjs`, the `border-subtle/default >=3:1` tests call `extractBorderAlpha(DS, …)`. Add a regression guard. Immediately after the existing `extractBorderAlpha` definition inside `run()`, add:
```javascript
// Regression guard: style.css must not override --border-* below the AA value
// (this previously silently defeated A11Y-03 via var(--border-1/2/3)).
await t('style.css does not override --border-subtle/default/strong', () => {
  const reOverride = /--border-(subtle|default|strong)\s*:\s*var\(\s*--border-[123]\s*\)/;
  assert.ok(!reOverride.test(SS),
    'style.css re-overrides --border-* to a sub-AA alias — remove it (design-system.css owns these)');
});
```
(`SS` is already read at the top of `a11y.test.cjs` as `readRepoFile('frontend/src/style.css')`.)

- [ ] **Step 4: Wire the new suite into `core.test.cjs`**

In `frontend/tests/core.test.cjs`, find `await require('./a11y.test.cjs').run();` and append immediately after:
```javascript
// Token single-source guard (§17)
await require('./token-source.test.cjs').run();
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: **365 OK** (363 + 2 token-source checks; the new a11y guard counts within the a11y suite). All green.

- [ ] **Step 6: Capture the intended visual change**

```bash
node scripts/_style-audit-shots.mjs
git status --short docs/superpowers/audits/screens/
```
Expected: **several PNGs modified** — borders are now AA-visible. Eyeball 2-3 (`dark-pc-settings.png`, `dark-pc-albums.png`) to confirm the only change is crisper hairlines. Re-commit the updated baseline.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design-system.css frontend/tests/token-source.test.cjs frontend/tests/core.test.cjs frontend/tests/a11y.test.cjs docs/superpowers/audits/screens/
git commit -m "fix(a11y): restore --border-* AA values defeated by style.css override + guard token source (§17, A11Y-03)"
```

---

# Task 5: Document the invariant + close out

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Reinforce §17**

In `CLAUDE.md §17` under "Styling", append to the single-source bullet:
```markdown
  - **Enforced:** `frontend/tests/token-source.test.cjs` fails the build if any
    `:root { --… }` token block reappears in `style.css`. All tokens — canonical
    scales, operational aliases, literal dimensions, shadows, and the
    `[data-theme]` accent map — live in `design-system.css` only.
```

- [ ] **Step 2: Full regression**

Run: `npm test` → 365 OK. Run: `npm run bench` → no regression > 5%.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(tokens): document enforced single token source in CLAUDE.md §17"
```

- [ ] **Step 4: Note follow-ups (do not implement here)**

Leave a one-line note in the audit doc's §8 that S2 (split the monolith) and the canonical-name migration (audit S1 full form) remain as separate future plans. The `--text-display 32px` vs §3 clamp and `--accent`/`--g` near-circular alias are now visible in one file and can be rationalized in that later pass.

---

# Self-Review

1. **Spec coverage:** Audit S3 → Task 2. Audit S1 "single source" goal → Tasks 3-5. Border a11y bug discovered during planning → Task 4. S2 (monolith split) and full canonical rename explicitly deferred (stated in Goal + Task 5.4). No gap for this plan's stated scope.
2. **Placeholder scan:** No TBD/TODO; every code step has full content (harness commands, the complete `token-source.test.cjs`, the exact a11y guard, the conflict table with concrete values).
3. **Type/name consistency:** `readRepoFile`/`_a11y.cjs` reused as in `a11y.test.cjs`; `SS`/`DS` variable names match that suite's convention; new suite wired the same way the a11y suite was (append after its `require`).
4. **Risk control:** every value-preserving phase (Tasks 2-3) is gated by the `git diff` screenshot check that must show **zero** modified PNGs; the only phase that intentionally changes pixels (Task 4) is explicitly flagged and eyeballed. Reversible: each task is one commit.
5. **Invariants:** CSS-only; no network, no IPC, no `tracks[]` mutation, no `audio.volume` literal. The a11y border fix strengthens §2#9.
