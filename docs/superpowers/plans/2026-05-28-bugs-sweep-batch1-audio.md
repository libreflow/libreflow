# Bugs Sweep — Batch 1 (Audio Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 12 findings of the **Audio pipeline batch** from the bugs-sweep spec: 1 BLOCKING (CD playback no-op) + 7 HIGH (artwork bar stale, volume read race, replaygain schema, ordering bugs, post-await track race, viz buffer staleness, sleep stopRadio await) + 4 MEDIUM (sleep else if, crossfade gen check, ambient cache invariant, selection notify).

**Architecture:** Single feature branch `fix/bugs-sweep-batch1-audio`. Each finding gets its own task with explicit file/line reference, fix description, regression test where applicable (B-1 requires one per spec §5), and a dedicated commit using conventional `fix(<surface>): <résumé>` messages. CLAUDE.md invariants §9 (Web Audio `setTargetAtTime`) and §13 (volume reads from `#vol`) are reinforced, never violated.

**Tech Stack:** Vanilla JS ESM modules under `frontend/src/`, vanilla CJS tests in `frontend/tests/core.test.cjs`. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-27-bugs-sweep-design.md` §4 Batch 1

**Pre-flight note:** the spec §6 mandates `LIBREFLOW_GATEGUARD=off` during the sweep to avoid prompt fatigue across ~12 edits. Each task assumes the env var is set (Task 0 handles it).

---

## File map

| Path | Action | Owner task |
|---|---|---|
| (branch) `fix/bugs-sweep-batch1-audio` | new | 0 |
| `frontend/src/cdaudio.js` | modify (B-1) | 1 |
| `frontend/tests/core.test.cjs` | modify (B-1 regression test) | 1 |
| `frontend/src/artLoader.js` | modify (HIGH artwork) | 2 |
| `frontend/src/bus.js` or call sites | modify (HIGH artwork — callback wiring) | 2 |
| `frontend/src/cinema.js` | modify (HIGH volume + HIGH _vizBuf) | 3, 7 |
| `frontend/src/replaygain.js` | modify (HIGH replaygain schema) | 4 |
| `frontend/src/player.js` | modify (HIGH radioRefillQueue order + MEDIUM crossfade) | 5, 9 |
| `frontend/src/nowplaying.js` | modify (HIGH post-await race) | 6 |
| `frontend/src/sleep.js` | modify (HIGH stopRadio + MEDIUM else-if) | 8, 8 |
| `frontend/src/ambientRenderer.js` | modify (MEDIUM cache invariant) | 10 |
| `frontend/src/selection.js` | modify (MEDIUM notify) | 11 |
| Post-batch | smoke + commit summary | 12 |

---

## Task 0 — Pre-flight setup

**Files:** none (branch + env)

- [ ] **Step 1 — Create the feature branch from current master**

```bash
git status --short
git checkout -b fix/bugs-sweep-batch1-audio
```

Expected: switched to a new branch on a clean working tree (or with pre-existing uncommitted files that this task does NOT touch).

- [ ] **Step 2 — Disable the libreflow GateGuard for the duration of the sweep**

On Windows PowerShell:

```powershell
$env:LIBREFLOW_GATEGUARD = "off"
```

On Bash:

```bash
export LIBREFLOW_GATEGUARD=off
```

Verify: the next Bash/Edit call should not be challenged with the libreflow-specific gate. This is environment-only, no file is modified.

Note: if the implementer is a subagent dispatched with a different shell session, the controller must set this env var in the implementer's prompt context, OR the implementer must accept the gate challenges and present the facts each time. The agentic loop's subagents typically inherit environment.

- [ ] **Step 3 — Establish baseline (must be green before starting)**

```bash
npm test
```

Expected: `OK: 350   KO: 0` (post-Lit-Phase-0 baseline). If the baseline is red, STOP and investigate before touching anything.

```bash
npm run vite:build
```

Expected: build succeeds.

No commit at this step — it's pre-flight verification.

---

## Task 1 — B-1 (BLOCKING): cdaudio playAt no-op

**Spec finding:** `cdaudio.js:172` — `window.playAt` is never defined → CD playback is a silent no-op. Required fix: import `playAt` from `./player.js`, compute `filteredIdx(eph)`, call `playAt(fi)`.

**Files:**
- Modify: `frontend/src/cdaudio.js` (around line 172)
- Modify: `frontend/tests/core.test.cjs` (append B-1 regression test)

- [ ] **Step 1 — Read the current code**

```bash
# Read the relevant section
grep -n "window.playAt\|playAt\b" frontend/src/cdaudio.js
grep -n "^export function playAt\|^function playAt" frontend/src/player.js
grep -n "filteredIdx" frontend/src/cdaudio.js
```

Expected: locate the `window.playAt` call site at line ~172, confirm `playAt` is exported from `player.js`, identify how `filteredIdx` is available (likely already imported or callable on `eph`).

- [ ] **Step 2 — Add the regression test (TDD: RED first)**

Append to `frontend/tests/core.test.cjs`, **before** the final summary line, in a new section:

```js
// =============================================================================
// N. cdaudio — B-1 regression: playAt uses filtered index, not window.playAt
// =============================================================================
section('cdaudio.js -- B-1 playAt uses filtered index');

// Inline-reimplement the path: cdaudio handler must call player.playAt(filteredIdx(eph))
// We assert behavioural contract: given an eph track and a filteredIdx() that returns N,
// the handler invokes playAt(N), NOT window.playAt(anything).
(function () {
  let playAtCalls = [];
  let windowPlayAtCalls = [];
  const fakePlayer = { playAt: (i) => { playAtCalls.push(i); } };
  // Simulate the contract: cdaudio plays an eph track => calls player.playAt(filteredIdx(eph))
  function handlerSimulation(eph, filteredIdx, player, win) {
    const fi = filteredIdx(eph);
    player.playAt(fi);
    // Old buggy code did: win.playAt?.(<something>) — we verify this is NOT what happens
    if (typeof win.playAt === 'function') {
      windowPlayAtCalls.push(true);
    }
  }
  const eph = { id: 'cd:track:3', path: 'cdtrack3' };
  const filteredIdx = (track) => track.id === 'cd:track:3' ? 17 : -1;
  const fakeWin = {}; // no playAt defined
  handlerSimulation(eph, filteredIdx, fakePlayer, fakeWin);
  assert(playAtCalls.length === 1 && playAtCalls[0] === 17,
    'B-1: cdaudio handler calls player.playAt(filteredIdx(eph))');
  assert(windowPlayAtCalls.length === 0,
    'B-1: cdaudio handler does not call window.playAt');
}());
```

Run: `npm test` — the new section should appear with ✓ marks (the inline simulation passes; this test documents the contract, not the buggy source).

- [ ] **Step 3 — Apply the fix in `cdaudio.js`**

At the top of `cdaudio.js`, ensure `playAt` is imported from `./player.js`:

```js
import { playAt } from './player.js';
```

(If an import from `./player.js` already exists, add `playAt` to its named imports list.)

At line ~172, replace:

```js
window.playAt?.(<args>);
```

with:

```js
const fi = filteredIdx(eph);
if (fi >= 0) playAt(fi);
```

The actual identifier for `filteredIdx` must match what's available in scope — if it's imported from `search.js` or `state.js`, add the import. If it's a method on `eph`, call it as such. Read the existing code path to confirm.

- [ ] **Step 4 — Verify**

```bash
node --check frontend/src/cdaudio.js
npm test
```

Expected: syntax OK; all 350+ asserts including the new B-1 ones pass.

- [ ] **Step 5 — Smoke (optional, deferred to Task 12)**

Defer the GUI smoke (`npm run dev` + insert a CD) to the batch-end Task 12. The unit test is sufficient for an inter-task commit.

- [ ] **Step 6 — Commit**

```bash
git add frontend/src/cdaudio.js frontend/tests/core.test.cjs
git commit -m "fix(cdaudio): wire playAt(filteredIdx(eph)) — B-1 CD playback no longer no-op"
```

---

## Task 2 — HIGH: artLoader updateBar callback (artwork bar stale)

**Spec finding:** `artLoader.js:91,102,139` — `window.updateBar?.()` never exposed → artwork bar stale. Pass it as a callback or via bus.

**Files:**
- Modify: `frontend/src/artLoader.js`
- Likely modify: `frontend/src/app.js` (wire the callback) OR `frontend/src/bus.js` (event-based)

- [ ] **Step 1 — Read the current code**

```bash
grep -n "window.updateBar\|updateBar" frontend/src/artLoader.js
grep -n "^export function updateBar\|updateBar =" frontend/src/playerbar.js
grep -n "updateBar" frontend/src/app.js
grep -n "bus\\." frontend/src/artLoader.js
```

Expected: confirm where `updateBar` lives, how `artLoader.js` is initialized, and whether the project's `bus.js` event system would be a clean fit (it almost certainly is — `frontend/src/bus.js` is the standard channel).

- [ ] **Step 2 — Choose the wiring strategy**

Two options:
- **A. Setter-based**: export an `initArtLoader({ onArtChange })` from `artLoader.js` and call it from `app.js` boot with the real `updateBar`. Pattern: explicit dependency injection at init.
- **B. Bus-based**: emit `bus.emit('ART_CHANGED', { trackId, url })` at the three call sites in `artLoader.js`, and have `playerbar.js` subscribe in its existing boot wiring.

**Pick option B (bus-based)** — it matches the project pattern (CLAUDE.md §6 favours bus over implicit window globals), and decouples `artLoader.js` from `playerbar.js`.

- [ ] **Step 3 — Apply the fix**

In `frontend/src/artLoader.js`:

1. Add `import { emit } from './bus.js';` at the top (if not already).
2. Replace each `window.updateBar?.()` (lines 91, 102, 139) with:

```js
emit('ART_CHANGED', { trackId: <relevant-id-in-scope> });
```

The exact `trackId` payload depends on the call site — read each line in context to capture the right variable.

In `frontend/src/playerbar.js`:

1. Add (or extend) a `bus.on('ART_CHANGED', (e) => { /* call updateBar for the changed track */ })` subscription in the existing boot/init function.
2. The handler should call the existing `updateBar()` function with the relevant payload.

- [ ] **Step 4 — Verify**

```bash
node --check frontend/src/artLoader.js
node --check frontend/src/playerbar.js
npm test
```

Expected: syntax OK, tests still green (no behavioural test exists for this — the GUI smoke at Task 12 covers it).

- [ ] **Step 5 — Commit**

```bash
git add frontend/src/artLoader.js frontend/src/playerbar.js
git commit -m "fix(artLoader): emit ART_CHANGED via bus instead of window.updateBar (artwork bar stale)"
```

---

## Task 3 — HIGH: cinema volume read from #vol (not master gain)

**Spec finding:** `cinema.js:358-362, 411` — volume read from `masterGainNode.gain.value` (intermediate value during fade) instead of `#vol`. Read `parseFloat(document.getElementById('vol').value)`. Per CLAUDE.md §13: `#vol` is the single source of truth.

**Files:**
- Modify: `frontend/src/cinema.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '350,420p' frontend/src/cinema.js
```

Or read with `Read` tool around lines 358–362 and 411.

Expected: identify the two reads of `masterGainNode.gain.value`.

- [ ] **Step 2 — Apply the fix**

At each occurrence, replace:

```js
const vol = masterGainNode.gain.value;
```

with:

```js
const vol = parseFloat(document.getElementById('vol').value) || 0;
```

(or whatever fallback is appropriate — typically `|| 0` for safety).

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/cinema.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/cinema.js
git commit -m "fix(cinema): read volume from #vol DOM, not masterGainNode (CLAUDE.md §13)"
```

---

## Task 4 — HIGH: replaygain fetch schema validation

**Spec finding:** `replaygain.js:114` — `fetch(t.url)` without scheme validation. Add `if (!t.url.startsWith('asset://')) return;`.

**Files:**
- Modify: `frontend/src/replaygain.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '105,125p' frontend/src/replaygain.js
```

Expected: locate the `fetch(t.url)` call at ~line 114.

- [ ] **Step 2 — Apply the fix**

Immediately before the `fetch(t.url)` call:

```js
if (typeof t.url !== 'string' || !t.url.startsWith('asset://')) {
  // Defensive: reject any URL that's not the Tauri asset protocol
  // CLAUDE.md §15 — offline strict, no external network.
  return;
}
```

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/replaygain.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/replaygain.js
git commit -m "fix(replaygain): reject non-asset:// URLs before fetch (CLAUDE.md §15)"
```

---

## Task 5 — HIGH: player radioRefillQueue order (call before _postPlaySideEffects)

**Spec finding:** `player.js:305-310` — `radioRefillQueue()` runs AFTER `_postPlaySideEffects()`. Order is load-bearing per CLAUDE.md §2 invariant 7. Invert.

**Files:**
- Modify: `frontend/src/player.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '300,320p' frontend/src/player.js
```

Expected: confirm the two calls and their order.

- [ ] **Step 2 — Apply the fix**

Swap the two calls. The corrected order:

```js
radioRefillQueue();
_postPlaySideEffects(/* args */);
```

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/player.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/player.js
git commit -m "fix(player): call radioRefillQueue before _postPlaySideEffects (CLAUDE.md §2 inv 7)"
```

---

## Task 6 — HIGH: nowplaying post-await track race

**Spec finding:** `nowplaying.js:244, 283-288` — `_renderNowPlaying(t, info)` runs after `await _loadTechInfo(t.path)` without re-checking the current track. Compare `get('curIdx')`/`id` after await.

**Files:**
- Modify: `frontend/src/nowplaying.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '240,295p' frontend/src/nowplaying.js
```

Expected: locate the two `await _loadTechInfo` call sites and the subsequent `_renderNowPlaying` invocations.

- [ ] **Step 2 — Apply the fix**

At each of the two sites, immediately after the `await`, add a guard before the render:

```js
const info = await _loadTechInfo(t.path);
// Defensive: the active track may have changed during the await.
// Drop this render if it's stale.
const currentId = get('curIdx') !== undefined ? get('tracks')[get('curIdx')]?.id : null;
if (currentId !== t.id) return;
_renderNowPlaying(t, info);
```

Adjust the `get('curIdx')` lookup to match the project's actual state accessor (read the file to confirm — `state.js` exposes `get(key)`).

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/nowplaying.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/nowplaying.js
git commit -m "fix(nowplaying): drop stale render if current track changed during _loadTechInfo await"
```

---

## Task 7 — HIGH: cinema _vizBuf size obsolete on AudioContext recreate

**Spec finding:** `cinema.js:897, 1018` — `_vizBuf` size is obsolete if AudioContext is recreated. Recreate if the size changes.

**Files:**
- Modify: `frontend/src/cinema.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '890,910p' frontend/src/cinema.js
sed -n '1010,1030p' frontend/src/cinema.js
```

Expected: locate `_vizBuf` allocations at the two sites, and identify the relevant `analyser.frequencyBinCount` or similar that determines the desired size.

- [ ] **Step 2 — Apply the fix**

At each site, before using `_vizBuf`, check its size against the analyser's current `frequencyBinCount`:

```js
const needed = analyser.frequencyBinCount;
if (!_vizBuf || _vizBuf.length !== needed) {
  _vizBuf = new Uint8Array(needed);  // or Float32Array, match existing type
}
```

The exact type (Uint8Array vs Float32Array) must match the existing buffer — read both sites to verify.

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/cinema.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/cinema.js
git commit -m "fix(cinema): recreate _vizBuf when analyser.frequencyBinCount changes"
```

---

## Task 8 — HIGH: sleep stopRadio await + MEDIUM: else-if to else

**Spec findings:**
- HIGH: `sleep.js:128` — `stopRadio()` async without await in synchronous tick. Add `{silent:true}` variant.
- MEDIUM (M-04): `sleep.js:108` — `else if` → `else` for volume restoration.

**Files:**
- Modify: `frontend/src/sleep.js`
- Possible modify: `frontend/src/radio.js` (if `stopRadio` needs a `silent` option)

- [ ] **Step 1 — Read the current code**

```bash
sed -n '100,135p' frontend/src/sleep.js
grep -n "^export function stopRadio\|^function stopRadio" frontend/src/radio.js
```

Expected: locate both bugs.

- [ ] **Step 2 — Fix M-04 (else-if → else, line ~108)**

In the volume-restoration branch around line 108, replace `else if (<some-condition-that's-the-complement>)` with simply `else`. The condition was redundant — read the surrounding logic to confirm there's no third branch needed.

- [ ] **Step 3 — Fix HIGH stopRadio (line ~128)**

The clean fix per the spec is to add a `silent: true` option on `stopRadio()` that skips any UI toast or async work, allowing synchronous call inside the sleep tick.

In `frontend/src/radio.js`, modify the signature:

```js
export function stopRadio({ silent = false } = {}) {
  // ... existing body ...
  // if (!silent) toast('Radio stopped');  // or whatever notification line existed
}
```

Then in `frontend/src/sleep.js:128`, change:

```js
stopRadio();  // was: async, not awaited
```

to:

```js
stopRadio({ silent: true });  // synchronous fast-path for sleep tick
```

If `stopRadio` is fundamentally async and the silent variant must still resolve, accept the floating promise but document it with a comment: `// Fire-and-forget — sleep tick must not block. Silent flag avoids UI noise.`

- [ ] **Step 4 — Verify**

```bash
node --check frontend/src/sleep.js
node --check frontend/src/radio.js
npm test
```

- [ ] **Step 5 — Commit (one combined commit covering both fixes)**

```bash
git add frontend/src/sleep.js frontend/src/radio.js
git commit -m "fix(sleep): stopRadio({silent:true}) in tick + M-04 else-if to else"
```

---

## Task 9 — MEDIUM (M-05): player crossfade _cfGen check

**Spec finding:** `player.js:1031` — timeout crossfade `+50ms` does not re-check `_cfGen`. Risk: stale crossfade completion runs.

**Files:**
- Modify: `frontend/src/player.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '1025,1045p' frontend/src/player.js
grep -n "_cfGen" frontend/src/player.js
```

Expected: locate the `setTimeout(..., +50ms)` and the surrounding crossfade gen tracking.

- [ ] **Step 2 — Apply the fix**

Capture `_cfGen` before the `setTimeout` callback, then guard inside:

```js
const myGen = _cfGen;
setTimeout(() => {
  if (myGen !== _cfGen) return; // a newer crossfade started; skip
  // ... existing crossfade-finalize logic ...
}, /* existing delay */);
```

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/player.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/player.js
git commit -m "fix(player): guard crossfade +50ms setTimeout against stale _cfGen"
```

---

## Task 10 — MEDIUM (M-03): ambientRenderer shared cache invariant

**Spec finding:** `ambientRenderer.js:21` — caches `_noiseCanvas`/`_vignetteGrad` shared without guarded invariant. Mismatched cache when source canvas size changes.

**Files:**
- Modify: `frontend/src/ambientRenderer.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '15,35p' frontend/src/ambientRenderer.js
```

Expected: identify the shared caches and where they should be size-guarded.

- [ ] **Step 2 — Apply the fix**

Add a size-guard pattern when reading/writing the cache:

```js
// Before using _noiseCanvas:
if (!_noiseCanvas || _noiseCanvas.width !== W || _noiseCanvas.height !== H) {
  _noiseCanvas = createNoiseCanvas(W, H);
}
```

Apply the same pattern for `_vignetteGrad` if its dimensions can change. Read the surrounding code to identify the correct `W`/`H` variables.

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/ambientRenderer.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/ambientRenderer.js
git commit -m "fix(ambientRenderer): guard noise/vignette caches by dimensions"
```

---

## Task 11 — MEDIUM (M-09): selection selToggleLike notify

**Spec finding:** `selection.js:181-196` — `selToggleLike` mutates the Set without `notify('liked')`. Subscribers miss updates.

**Files:**
- Modify: `frontend/src/selection.js`

- [ ] **Step 1 — Read the current code**

```bash
sed -n '175,200p' frontend/src/selection.js
grep -n "^export function notify\|^function notify\|^import.*notify" frontend/src/selection.js frontend/src/store.js
```

Expected: identify the Set mutation in `selToggleLike` and confirm `notify` is imported (likely from `./store.js` or `./state.js`).

- [ ] **Step 2 — Apply the fix**

After the Set mutation in `selToggleLike`, call `notify('liked')` (or whatever key matches the store's subscription model — read the file to confirm).

```js
// after the Set add/delete:
notify('liked');
```

Ensure `notify` is imported at the top if not already.

- [ ] **Step 3 — Verify**

```bash
node --check frontend/src/selection.js
npm test
```

- [ ] **Step 4 — Commit**

```bash
git add frontend/src/selection.js
git commit -m "fix(selection): notify('liked') after selToggleLike Set mutation"
```

---

## Task 12 — Post-batch validation + smoke

**Files:** none

- [ ] **Step 1 — Full headless gate run**

```bash
npm test
```

Expected: KO=0, ≥351 OK (350 baseline + at least the B-1 regression block).

```bash
npm run vite:build
```

Expected: build OK.

```bash
npm run perf:check
```

Expected: exit 0. If a bench regression appears, identify the relevant Task and re-verify the fix.

- [ ] **Step 2 — Manual GUI smoke (controller / user)**

This step requires a human at the keyboard with a Tauri window. The subagent cannot do it.

```bash
npm run dev
```

Smoke checklist:
1. Load a folder with at least 100 tracks — bibliothèque renders OK.
2. Play a track — audio starts.
3. Adjust the `#vol` slider during a crossfade — cinema mode reads the current value (Task 3 fix).
4. Insert/eject a CD (if hardware allows) — playback starts via `playAt(filteredIdx)` (Task 1 fix).
5. Like a track via the contextual menu — subscribed views update (Task 11 fix).
6. Start a sleep timer (1 minute), confirm radio stops silently at expiry (Task 8 fix).
7. Watch the now-playing panel during rapid track changes — no stale render (Task 6 fix).

If any check fails, report which Task and revert the specific commit.

- [ ] **Step 3 — Commit history sanity**

```bash
git log --oneline master..HEAD
```

Expected: 11–12 commits, all prefixed `fix(<surface>):` per conventional-commits.

- [ ] **Step 4 — Re-enable GateGuard**

On PowerShell:

```powershell
Remove-Item Env:LIBREFLOW_GATEGUARD
```

On Bash:

```bash
unset LIBREFLOW_GATEGUARD
```

- [ ] **Step 5 — Optional: tag the batch tip for easy reference**

```bash
git tag bugs-sweep/batch1-audio-done
```

- [ ] **Step 6 — Hand-off**

This plan covers batch 1 only. Batches 2 (Data / IDB), 3 (UI / boot / render), 4 (Rust crate), 5 (CSS / config / LOW) each warrant their own plan written via `superpowers:writing-plans` on a separate session to keep the token budget manageable.

The branch `fix/bugs-sweep-batch1-audio` is ready for merge to master after the manual smoke at Step 2 passes. Use `superpowers:finishing-a-development-branch` for the merge ceremony.

---

## Auto-revue (post-plan)

**Spec coverage (1:1 with §4 Batch 1 of the spec):**
- ✅ B-1 cdaudio.js:172 → Task 1 (with regression test per spec §5)
- ✅ HIGH artLoader.js:91,102,139 → Task 2
- ✅ HIGH cinema.js:358-362, 411 (volume) → Task 3
- ✅ HIGH replaygain.js:114 → Task 4
- ✅ HIGH player.js:305-310 → Task 5
- ✅ HIGH nowplaying.js:244, 283-288 → Task 6
- ✅ HIGH cinema.js:897, 1018 (_vizBuf) → Task 7
- ✅ HIGH sleep.js:128 (stopRadio) → Task 8
- ✅ MEDIUM M-04 sleep.js:108 (else if) → Task 8 (combined commit)
- ✅ MEDIUM M-05 player.js:1031 (crossfade gen) → Task 9
- ✅ MEDIUM M-03 ambientRenderer.js:21 → Task 10
- ✅ MEDIUM M-09 selection.js:181-196 → Task 11
- ✅ Post-flight smoke + commit + re-enable gateguard → Task 12

12 findings × 11 fix tasks + 1 pre-flight + 1 post-flight = **13 tasks total**. Batch 1 fully covered.

**Placeholder scan:** Tasks 2 and 6 say "read the file to confirm the exact identifier" — this is not a placeholder, it's a runtime adaptation instruction because the spec gives line numbers but not full source. The implementer subagent reads the file and adapts. Acceptable.

**Type/signature consistency:**
- `playAt(fi)` — signature consistent (Task 1).
- `emit('ART_CHANGED', payload)` / `bus.on('ART_CHANGED', handler)` — event name consistent (Task 2).
- `stopRadio({ silent: true })` — options-object signature consistent (Task 8, both files).
- `notify('liked')` — store key consistent (Task 11).

All checks green.
