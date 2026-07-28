# Toast Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `<lf-toast-stack>` from bottom-center (above the player bar) to top-right (below the titlebar), so toasts no longer compete visually with playback controls or the bottom-center `#sel-bar` multi-select bar.

**Architecture:** Single-file CSS change inside the Lit component's `static styles`. Anchor moves from `bottom/left+translateX(-50%)` to `top/right`, item alignment moves from centered to right-aligned, and the slide-in/out animation axis moves from vertical (`translateY`) to horizontal (`translateX`) to match a corner-anchored notification convention. No change to the reducer, durations, types, or the public `ui.js` façade.

**Tech Stack:** Lit 3.x (`static styles = css\`...\``), vanilla CSS custom properties from `design-system.css` (`--tb`, `--sp-4`).

## Global Constraints

- No change to `frontend/src/components/lf-toast-stack.logic.js` (reducer, `TOAST_DUR`, `normalizeType`, `resolveDuration`) — spec §Non-Goals.
- No change to the public `ui.js` façade (`toast()`, `toastWithAction()`) — callers unaffected.
- No dynamic collision-avoidance with `#queue-panel`/`#eq-panel` — out of scope per spec.
- No CSS selector mixing id + class (CLAUDE.md §13) — not introduced by this change.
- No `console.log` added (CLAUDE.md §14).
- Anchor offset must use `--tb` (titlebar height var, 32px default / 28px narrow breakpoint — `style.css:3946,3952`) the same way the current rule rides on `--pb`, so it scales correctly at every window size.

---

### Task 1: Move toast anchor to top-right and flip slide axis

**Files:**
- Modify: `frontend/src/components/lf-toast-stack.js:36-48` (`:host` rule) and `:132-133` (`@keyframes t-in`/`t-out`)
- Test: `frontend/tests/visual/lit-toast.spec.js` (existing, run not modified)
- Test: `frontend/tests/core.test.cjs` (existing, run not modified)

**Interfaces:**
- Consumes: nothing new — `--tb` and `--sp-4` are existing CSS custom properties already defined in `design-system.css` and used elsewhere (`style.css:3946` for `--tb`, `#mp-ov` in `style.css:6112` for `--sp-4`).
- Produces: nothing new — this task only changes the CSS anchor/animation of `LfToastStack`. No JS API, no new exports.

- [ ] **Step 1: Read the current `:host` rule and keyframes to confirm line numbers before editing**

Run: `grep -n "position: fixed" -A 12 frontend/src/components/lf-toast-stack.js`

Expected output (current state, for reference — confirms nothing has drifted since this plan was written):

```
    :host {
      position: fixed;
      bottom: calc(var(--pb, 96px) + 16px);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column-reverse;
      align-items: center;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, var(--font-body));
    }
```

If the grep output differs from the above, stop and re-read the full file before proceeding — the line numbers in later steps assume this exact content.

- [ ] **Step 2: Edit the `:host` rule — anchor top-right instead of bottom-center**

In `frontend/src/components/lf-toast-stack.js`, replace:

```css
    :host {
      position: fixed;
      bottom: calc(var(--pb, 96px) + 16px);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column-reverse;
      align-items: center;
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

(`bottom`/`left`/`transform: translateX(-50%)` removed; `top`/`right` added; `align-items: center` → `align-items: flex-end`. `flex-direction: column-reverse` and `gap: 8px` unchanged — see spec's "Stack growth direction" section: this keeps the newest toast nearest the anchored edge, which is now the top instead of the bottom.)

- [ ] **Step 3: Edit the slide keyframes — horizontal instead of vertical**

In the same file, replace:

```css
    @keyframes t-in  { from { transform: translateY(20px); opacity: 0; } }
    @keyframes t-out { to   { transform: translateY(20px); opacity: 0; } }
```

with:

```css
    @keyframes t-in  { from { transform: translateX(24px); opacity: 0; } }
    @keyframes t-out { to   { transform: translateX(24px); opacity: 0; } }
```

- [ ] **Step 4: Run the JS unit test suite to confirm no regression**

Run: `npm test`
Expected: all `components/lf-toast-stack.logic.js` sections still PASS (this task touched no logic file, so this is a pure regression check — the suite should show the same pass count as before the edit).

- [ ] **Step 5: Run the visual snapshot suite for the toast component**

Run: `npm run test:visual -- lit-toast.spec.js`
Expected: both snapshot tests (`renders an info toast`, `renders an error toast with close button`) PASS. These snapshots capture only the `<lf-toast-stack>` element's own bounding box (see `frontend/tests/visual/lit-toast.spec.js:88-91`), not its page position, so the existing baselines should still match.

If either snapshot fails because the bounding-box *content* actually changed shape (it shouldn't from this diff — only host position/anchor/animation changed, not internal item layout), inspect the diff image under `frontend/tests/visual/__snapshots__/` before deciding whether to regenerate with `npm run test:visual:update -- lit-toast.spec.js`. Do not blindly regenerate.

- [ ] **Step 6: Manual smoke test in the running app**

Run: `npm run dev`

Then in the running app://
1. Trigger any toast (e.g. rename a playlist, or run in the devtools console after the app loads: `(await import('/src/ui.js')).toast('test', 'info')`) → confirm it appears top-right, below the titlebar, clear of the minimize/maximize/close buttons.
2. Trigger 3 toasts in quick succession → confirm the newest appears nearest the top edge and older ones are pushed downward, all still fully readable.
3. Enter multi-select mode (select a track via checkbox/long-press so `#sel-bar` appears at bottom-center) and trigger a toast → confirm no visual overlap between the toast and `#sel-bar`.
4. Open the queue panel (right-side slide-out) and trigger a toast → confirm the toast still renders above the panel and stays readable.
5. Trigger an error toast (e.g. an invalid action) → confirm the close (`×`) button is present, clickable, and keyboard-reachable in the new position.
6. Resize the window down to the narrow breakpoint (below the width where `style.css:3946` `:root { --pb: 76px; --tb: 32px; }` / `style.css:3952` `:root { --pb: 64px; --tb: 28px; }` apply) → confirm the toast still clears the titlebar buttons at `--tb: 28px`.

Expected: all 6 checks pass visually. If any fails, stop and fix before committing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/lf-toast-stack.js
git commit -m "fix(ui): reposition toasts to top-right, clear of player bar and sel-bar"
```

---

## Self-Review Notes

- **Spec coverage:** Anchor change (§Design/Anchor) → Step 2. Stack growth direction (§Design/Stack growth direction) → Step 2 comment + Step 6.2 manual check. Animation axis (§Design/Entrance-exit animation) → Step 3. Hover/active transforms (§Design, unchanged) → not touched, correctly out of scope. Accessibility (§Accessibility) → nothing to change, confirmed no touch to roles/aria-live/focus rings. Test plan (§Test Plan) → Steps 4–6 cover automated + manual items 1:1.
- **Placeholder scan:** no TBD/TODO; every step has literal code or literal commands with expected output.
- **Type consistency:** no new functions, types, or exports introduced — N/A.
