# Toast Sidebar Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock `<lf-toast-stack>` to the bottom of the sidebar column on normal desktop layouts (filling the empty space there), falling back to the existing top-right corner position whenever the sidebar isn't a normal full-height vertical column (now-playing fullscreen, mobile platform, or the compact <719px breakpoint).

**Architecture:** Primarily a CSS change inside the Lit component's `static styles`, plus one small authorized JS exception. The base `:host` rule switches from corner values to sidebar-docked values (position/width computed from the same `--sb`/`--pb`/`--tb`/`--sp-*` custom properties the sidebar and adjacent panels already use). Two new override blocks — one `:host-context()` selector list, one `@media` block — restore the current corner values as a fallback, using DOM state that's already set by other code (`body.np-full`, `html[data-platform="mobile"]`, and the existing compact breakpoint). The now-playing-fullscreen fallback required `nowplaying.js` to also mirror `np-full` onto `<body>` (see Global Constraints and `.superpowers/sdd/task-1-report.md` for why). No DOM re-parenting.

**Tech Stack:** Lit 3.x (`static styles = css\`...\``), CSS `:host-context()`, `@media`, existing CSS custom properties (`--sb`, `--pb`, `--tb`, `--sp-2`, `--sp-4`).

## Global Constraints

- No change to `frontend/src/components/lf-toast-stack.logic.js` or the public `ui.js` façade — spec §Non-Goals.
- No DOM re-parenting — `<lf-toast-stack>` stays appended to `document.body` exactly as today (`ui.js:33-40`).
- No change to the stack cap (`MAX_TOASTS = 5`), the ring/background/radius/icon/progress-bar visual treatment, or the entrance/exit animation direction — all untouched from the two prior toast specs.
- The three fallback conditions must reuse existing DOM state where possible. This held for two of the three (mobile, compact breakpoint — `html[data-platform="mobile"]`, `@media (max-width: 719px)` per `style.css:6507-6523`), with no new class/attribute/JS wiring for those. The now-playing-fullscreen condition required a small, authorized exception once a DOM-structure assumption in the original design was found to be wrong (`#app` is not an ancestor of `<lf-toast-stack>`): `nowplaying.js` mirrors the `np-full` class onto `<body>` at its two existing `#app` toggle call sites. See `.superpowers/sdd/task-1-report.md` for the full story.
- The fallback values must be an exact copy of the current corner rule (`top: calc(var(--tb, 32px) + 12px); right: var(--sp-4, 16px); align-items: flex-end`) — nothing new invented for the fallback state.
- No CSS selector mixing id + class (CLAUDE.md §13) — not introduced by this change.
- No `console.log` added.
- No new design tokens — reuses `--sb`, `--sp-2`, `--sp-4`, `--pb`, `--tb`, all pre-existing.

---

### Task 1: Dock the toast stack to the sidebar, with corner fallback

> **Note:** This task's scope expanded mid-implementation from the CSS-only
> plan below — the now-playing-fullscreen fallback selector originally
> planned (`:host-context(#app.np-full)`) turned out not to work, since
> `<lf-toast-stack>` is a sibling of `#app`, not a descendant. The resolved
> fix also touches `frontend/src/nowplaying.js` (2 lines). See
> `.superpowers/sdd/task-1-report.md` for the full investigation, including a
> first fix attempt that didn't pan out.

**Files:**
- Modify: `frontend/src/components/lf-toast-stack.js:36-47` (`:host` rule — switch to docked values; insert two new blocks immediately after it)
- Modify: `frontend/src/nowplaying.js` (2 lines — mirrors `np-full` onto `document.body` at its two existing toggle call sites, alongside the pre-existing `#app` toggle)
- Test: `frontend/tests/visual/lit-toast.spec.js` (existing — baselines will be regenerated, not the spec file itself)
- Test: `frontend/tests/core.test.cjs` (existing, run not modified)

**Interfaces:**
- Consumes: existing CSS custom properties `--sb` (sidebar width, `design-system.css:486`), `--sb-sm` (compact sidebar width, `:487`), `--pb` (player bar height), `--tb` (titlebar height), `--sp-2`/`--sp-4` (spacing scale) — all already defined in `design-system.css` and already used elsewhere in this exact file (`--tb`, `--sp-4` in the current `:host` rule) or in `style.css` (`--sb`, `--pb` in `#queue-panel`/`#eq-panel`, `style.css:3871-3872`).
- Produces: nothing new — this task only changes the CSS position/sizing of `LfToastStack`'s `:host`. No JS API, no new exports, no new custom properties.

- [ ] **Step 1: Read the current `:host` rule to confirm line numbers before editing**

Run: `grep -n "position: fixed" -A 12 frontend/src/components/lf-toast-stack.js`

Expected output (current state, for reference):

```
    :host {
      position: fixed;
      top: calc(var(--tb, 32px) + 12px);
      right: var(--sp-4, 16px);
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, var(--font-body));
    }
```

If the grep output differs from the above, stop and re-read the full file before proceeding — later steps assume this exact content.

- [ ] **Step 2: Replace the `:host` rule with the docked-by-default version, and insert the two fallback blocks immediately after it**

In `frontend/src/components/lf-toast-stack.js`, replace:

```css
    :host {
      position: fixed;
      top: calc(var(--tb, 32px) + 12px);
      right: var(--sp-4, 16px);
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, var(--font-body));
    }
```

with:

```css
    :host {
      position: fixed;
      bottom: calc(var(--pb) + var(--sp-2));
      left: var(--sp-2);
      width: calc(var(--sb) - var(--sp-4));
      display: flex;
      flex-direction: column-reverse;
      align-items: stretch;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, var(--font-body));
    }
    /* Corner fallback — same values as the previous default :host rule,
       restored whenever the sidebar isn't a normal full-height column.
       body.np-full (not #app.np-full): <lf-toast-stack> is a SIBLING of
       #app under <body> (appended via document.body.appendChild in
       ui.js), not a descendant, so :host-context() needs a real ancestor
       to match — see Step 2b, which mirrors the np-full class onto
       <body> for exactly this reason. */
    :host-context(body.np-full),
    :host-context(html[data-platform="mobile"]) {
      bottom: auto;
      left: auto;
      width: auto;
      top: calc(var(--tb, 32px) + 12px);
      right: var(--sp-4, 16px);
      align-items: flex-end;
    }
    @media (max-width: 719px) {
      :host {
        bottom: auto;
        left: auto;
        width: auto;
        top: calc(var(--tb, 32px) + 12px);
        right: var(--sp-4, 16px);
        align-items: flex-end;
      }
    }
```

The two fallback blocks MUST be placed immediately after the base `:host` rule and before `.t-item { ... }` — the `@media` block's `:host` selector has identical specificity to the base `:host` rule, so it only wins the cascade because it comes later in source order. Placing it earlier, or after unrelated rules, does not change correctness but placing it before the base rule WOULD break the fallback (the base rule would then win the tie instead).

- [ ] **Step 2b: Mirror the `np-full` class onto `<body>` in `nowplaying.js`**

Step 2's `body.np-full` selector needs `<body>` to actually carry the `np-full` class for the now-playing-fullscreen fallback to work — `nowplaying.js` currently only toggles it on `#app`. Run:

Run: `grep -n "np-full" frontend/src/nowplaying.js`

Expected output (current state, for reference):

```
258:    document.getElementById('app')?.classList.remove('np-full');
266:  document.getElementById('app')?.classList.toggle('np-full', _fullscreen);
```

If the grep output differs from the above, stop and re-read the surrounding ~15 lines around both call sites before editing — later edits assume this exact content.

In `frontend/src/nowplaying.js`, at the first call site, replace:

```js
    document.getElementById('app')?.classList.remove('np-full');
```

with:

```js
    document.getElementById('app')?.classList.remove('np-full');
    document.body.classList.remove('np-full');
```

At the second call site, replace:

```js
  document.getElementById('app')?.classList.toggle('np-full', _fullscreen);
```

with:

```js
  document.getElementById('app')?.classList.toggle('np-full', _fullscreen);
  document.body.classList.toggle('np-full', _fullscreen);
```

Do NOT remove or change the existing `#app` calls — `style.css`'s `.np-full { --sb: 0px; }` and `.np-full #sb { overflow: hidden; pointer-events: none; }` still depend on `#app.np-full` and must keep working exactly as before. This step only ADDS a parallel call targeting `document.body` at each site, so `<body>` genuinely carries the class whenever `#app` does.

- [ ] **Step 3: Run the JS unit test suite to confirm no regression**

Run: `npm test`
Expected: same pass count as the current baseline (1429/1429 as of the last recorded run) — Step 2b's `nowplaying.js` change is two lines mirroring an existing class toggle, not new logic, and there is no existing test coverage of the `np-full` toggle in `frontend/tests/core.test.cjs` to regress.

- [ ] **Step 4: Regenerate and verify the visual snapshot baselines**

This task changes the toast's default rendered position/width (docked to the sidebar column instead of the top-right corner), so the existing snapshots in `frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/` (`lf-toast-info-chromium-win32.png`, `lf-toast-error-chromium-win32.png`) are expected to change and must be regenerated — this is the intended visual change, not a regression to investigate. The test's 900×600 viewport and seeded app boot into the default (non-mobile, non-np-full, non-compact) state, so the toast will render docked in these snapshots.

Run: `npx playwright test -c frontend/tests/visual/playwright.config.js lit-toast.spec.js --update-snapshots=all`

(Use this direct `npx playwright test` form with the file positional before the flag — the `npm run test:visual:update -- lit-toast.spec.js` form is known to fail on this repo due to an npm/Commander CLI-parsing interaction with the optional-argument `--update-snapshots` flag, already documented in `.superpowers/sdd/task-1-report.md` from the prior visual-style task.)

Expected: exit code 0, both snapshots reported as regenerated.

Then run: `npm run test:visual -- lit-toast.spec.js`
Expected: all 3 tests PASS (`lf-toast-stack is registered as a custom element`, `renders an info toast (snapshot)`, `renders an error toast with close button (snapshot)`) against the freshly regenerated baselines.

Open both regenerated PNGs under `frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/` and visually confirm: the toast card now appears docked to the left edge of its bounding box rather than centered/right-aligned, and is noticeably wider than the prior narrow 260px corner card (Playwright's element-only screenshot crops to the component's own bounding box, so this will show as a wide, left-aligned card rather than a small one). If the image looks wrong (toast not visible, zero width, or obviously broken layout), stop and fix the CSS before proceeding — do not commit an incorrect baseline.

- [ ] **Step 5: Manual smoke test in the running app**

Run: `npm run dev`

Then in the running app (or via a throwaway Playwright script against the dev server if no interactive window is available in your environment — disclose explicitly which method you used, per the precedent set in the two prior toast tasks):

1. On a normal desktop-width window (sidebar visible as a full column, not now-playing fullscreen), trigger a toast → confirm it appears docked at the bottom of the sidebar, spanning close to the sidebar's width, sitting above the player bar.
2. Drag the sidebar resize handle (`#sb-resize`) to change the sidebar width → trigger a toast → confirm its width tracks the resized sidebar.
3. Enter now-playing fullscreen (the view/mode that adds the `np-full` class to both `#app` and `<body>`, per Step 2b — check `frontend/src/nowplaying.js` for how it's triggered if unsure) → trigger a toast → confirm it falls back to the top-right corner, not hidden behind the collapsed sidebar.
4. Resize the window below 719px width → trigger a toast → confirm it falls back to the top-right corner, not squeezed into the 54px icon-only sidebar.
5. Trigger 3 toasts in quick succession while docked → confirm the newest lands nearest the bottom (sidebar/player-bar boundary), older ones pushed upward, and the stack doesn't overflow above the titlebar even with several toasts visible on a short window.
6. If a mobile platform build/profile is available to test, confirm the same top-right fallback there; if not testable in this environment, disclose that explicitly rather than fabricating a check.

Expected: all 6 checks pass. If any fails, stop and fix before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/lf-toast-stack.js frontend/src/nowplaying.js frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/lf-toast-info-chromium-win32.png frontend/tests/visual/__snapshots__/lit-toast.spec.js-snapshots/lf-toast-error-chromium-win32.png
git commit -m "feat(ui): dock toasts to sidebar bottom, corner fallback for np-full/mobile/compact"
```

(As executed, this shipped as two separate commits — `7f9f3a3` for the CSS docking + corner-fallback blocks, and a follow-up `036518c` once the `#app.np-full` selector was found broken and Step 2b's fix was applied. A from-scratch execution of this corrected plan can do it in one commit as shown above, since Step 2 and Step 2b are now both present up front.)

---

## Self-Review Notes

- **Spec coverage:** Docking condition (§Design/Docking condition) → Step 2 fallback selectors. Docked position & sizing (§Design/Docked position & sizing) → Step 2 base `:host` rule. Corner fallback (§Design/Corner fallback) → Step 2 fallback blocks, verified as an exact copy of the shipped values. Everything else unchanged (§Design/Everything else) → not touched, correctly out of scope. Accessibility (§Accessibility) → nothing to change, confirmed no touch to roles/aria-live/focus/contrast. Test plan (§Test Plan) → Steps 3–5 cover automated + manual items 1:1, including the explicit baseline-regeneration requirement and the known npm CLI workaround from the prior task.
- **Placeholder scan:** no TBD/TODO; every step has literal code, literal commands, and expected output.
- **Type consistency:** no new functions, types, custom properties, or exports introduced — N/A.
