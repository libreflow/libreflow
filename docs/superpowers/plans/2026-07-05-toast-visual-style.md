# Toast Visual Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `<lf-toast-stack>` a tinted ring (matching each toast's existing per-type accent color) and a narrower footprint, so it reads as a corner card consistent with `#mp-ov` (the mini-player overlay) instead of a leftover wide Material Snackbar bar.

**Architecture:** Two small CSS edits inside the Lit component's `static styles`: (1) add a second `box-shadow` layer using `color-mix()` keyed to the already-existing `--lf-toast-accent` custom property, on both the resting and `:hover` states of `.t-item`; (2) reduce `.t-item`'s `min-width` from 288px to 260px. No JS/logic change. The visual snapshot baselines for this component are expected to change and must be regenerated as part of this task.

**Tech Stack:** Lit 3.x (`static styles = css\`...\``), CSS `color-mix()`, existing CSS custom properties from `design-system.css` (`--shadow-lg`, `--shadow-xl`) and the component's own `--lf-toast-accent`.

## Global Constraints

- No change to `frontend/src/components/lf-toast-stack.logic.js` (reducer, `TOAST_DUR`, `normalizeType`, `resolveDuration`) — spec §Non-Goals.
- No change to the public `ui.js` façade (`toast()`, `toastWithAction()`).
- No background/color-wash change — the dark `--glass-toast` background and the light-mode `:host-context(html[data-mode="light"]) .t-item` override stay exactly as they are (explicitly rejected by the user during brainstorming).
- No new CSS custom properties or `-rgb` token variants — reuse the existing `--lf-toast-accent` property (already set per type at `lf-toast-stack.js:76-80`) via `color-mix()`, matching the pattern already used in `design-system.css` (e.g. `--shadow-art-col2`).
- No CSS selector mixing id + class (CLAUDE.md §13) — not introduced by this change.
- No `console.log` added (CLAUDE.md §14).
- `max-width: 568px` stays unchanged — only `min-width` moves (288px → 260px).

---

### Task 1: Add tinted ring and narrow the toast card

**Files:**
- Modify: `frontend/src/components/lf-toast-stack.js:57` (`.t-item` `box-shadow`), `:61` (`.t-item` `min-width`), `:72` (`.t-item:hover` `box-shadow`)
- Test: `frontend/tests/visual/lit-toast.spec.js` (existing — baselines will be regenerated, not the spec file itself)
- Test: `frontend/tests/core.test.cjs` (existing, run not modified)

**Interfaces:**
- Consumes: the existing `--lf-toast-accent` custom property, already set per toast type at `frontend/src/components/lf-toast-stack.js:76-80` (`.t-info`/`.t-success`/`.t-error`/`.t-warning`/`.t-loading` rules — unchanged by this task). Also consumes the existing `--shadow-lg`/`--shadow-xl` tokens from `design-system.css`, already in use at these exact lines.
- Produces: nothing new — this task only changes the CSS shadow/sizing of `LfToastStack`. No JS API, no new exports, no new custom properties.

- [ ] **Step 1: Read the current `.t-item` and `.t-item:hover` rules to confirm line numbers before editing**

Run: `grep -n "box-shadow: var(--shadow-lg)\|min-width: 288px\|box-shadow: var(--shadow-xl" frontend/src/components/lf-toast-stack.js`

Expected output (current state, for reference):

```
57:      box-shadow: var(--shadow-lg);
61:      min-width: 288px;
72:    .t-item:hover  { transform: translateY(-1px); box-shadow: var(--shadow-xl, var(--shadow-lg)); }
```

If the grep output differs from the above, stop and re-read the full file before proceeding — later steps assume this exact content.

- [ ] **Step 2: Edit the `.t-item` rule — add the tinted ring, narrow the min-width**

In `frontend/src/components/lf-toast-stack.js`, in the `.t-item` rule (starts at line 48), replace this line:

```css
      box-shadow: var(--shadow-lg);
```

with:

```css
      box-shadow: var(--shadow-lg), 0 0 0 1px color-mix(in srgb, var(--lf-toast-accent) 35%, transparent);
```

And in the same rule, replace this line:

```css
      min-width: 288px;
```

with:

```css
      min-width: 260px;
```

- [ ] **Step 3: Edit the `.t-item:hover` rule — intensify the ring on hover**

In the same file, replace:

```css
    .t-item:hover  { transform: translateY(-1px); box-shadow: var(--shadow-xl, var(--shadow-lg)); }
```

with:

```css
    .t-item:hover  { transform: translateY(-1px); box-shadow: var(--shadow-xl, var(--shadow-lg)), 0 0 0 1px color-mix(in srgb, var(--lf-toast-accent) 55%, transparent); }
```

- [ ] **Step 4: Run the JS unit test suite to confirm no regression**

Run: `npm test`
Expected: all `components/lf-toast-stack.logic.js` sections still PASS (this task touched no logic file — same pass count as before the edit, 1429/1429 as of the last recorded run).

- [ ] **Step 5: Regenerate and verify the visual snapshot baselines**

This task changes the toast's rendered appearance (new shadow layer, narrower card), so the existing snapshots in `frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/` (`lf-toast-info-chromium-win32.png`, `lf-toast-error-chromium-win32.png`) are expected to no longer match and must be regenerated as part of this task — this is not a regression to investigate, it's the intended visual change.

Run: `npm run test:visual:update -- lit-toast.spec.js`
Expected: exit code 0, both snapshots regenerated (Playwright reports them as updated, not failed).

Then run: `npm run test:visual -- lit-toast.spec.js`
Expected: all 3 tests PASS (`lf-toast-stack is registered as a custom element`, `renders an info toast (snapshot)`, `renders an error toast with close button (snapshot)`) against the freshly regenerated baselines.

Open both regenerated PNGs under `frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/` and visually confirm: the info toast shows a subtle blue-tinted ring around its edge (in addition to the existing drop shadow), and the error toast shows a red-tinted ring, both narrower than before. If either image looks wrong (no visible ring, wrong color, or unrelated layout shift), stop and fix the CSS before proceeding — do not commit an incorrect baseline.

- [ ] **Step 6: Manual smoke test in the running app**

Run: `npm run dev`

Then in the running app (or via a throwaway Playwright script against the dev server if no interactive window is available in your environment — disclose explicitly which method you used, per the precedent set in the toast-position task):

1. Trigger an info toast → confirm a subtle blue-tinted ring is visible around the card, in addition to the existing drop shadow.
2. Trigger an error toast (persistent, closable) → confirm the ring is red-tinted, matching the error icon and progress bar color.
3. Trigger a success toast and a warning toast → confirm green and amber rings respectively.
4. Hover over any visible toast → confirm the ring visibly intensifies (35% → 55% mix) alongside the existing lift/shadow-xl hover effect.
5. Open the mini-player overlay (`#mp-ov`) alongside a visible toast → both should read as the same "floating corner card" family (ring instead of solid border, similar corner radius).
6. Trigger a toast with a long message (e.g. a rename with a long name) → confirm it still wraps/fits within `max-width: 568px` without layout breakage at the new `min-width: 260px`.

Expected: all 6 checks pass visually. If any fails, stop and fix before committing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/lf-toast-stack.js frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/lf-toast-info-chromium-win32.png frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/lf-toast-error-chromium-win32.png
git commit -m "style(ui): tinted ring + narrower toast card, matching mp-ov corner style"
```

---

## Self-Review Notes

- **Spec coverage:** Ring (§Design/Ring) → Steps 2–3. Sizing (§Design/Sizing) → Step 2. "Everything else unchanged" (§Design) → not touched, correctly out of scope; verified no other lines in the diff. Accessibility (§Accessibility) → nothing to change, confirmed no touch to roles/aria-live/focus rings/touch targets. Test plan (§Test Plan) → Steps 4–6 cover automated + manual items 1:1, including the explicit baseline-regeneration requirement the spec calls out.
- **Placeholder scan:** no TBD/TODO; every step has literal code, literal commands, and expected output.
- **Type consistency:** no new functions, types, custom properties, or exports introduced — N/A.
