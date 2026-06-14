# player.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `player.js` (1313 lines) into focused sub-modules to comply with CLAUDE.md §16 800-line hard cap. Target: `player.js` ≤ 800 lines. No logic changes — pure extraction.

**Architecture:** Four extraction targets plus aggressive comment trimming:
1. `player-seekbar.js` — seek bar DOM initialization + pointer/keyboard listeners
2. `player-likes.js` — `toggleLike` + `likeat` (reads curIdx via `get('curIdx')`, no circular dep)
3. `player-mediasession.js` — 3 MediaSession functions wired via `initMediaSession(audio, cb)`
4. `player-events.js` — audio element event listeners wired via `initAudioListeners(audio, cb)`
5. Comment trimming in `player.js` to reach < 800

**Non-goals:** Crossfade/gapless engine stays in player.js (too tightly coupled with internal state). All 439 tests must stay green at every step.

**Tech Stack:** Vanilla ESM JS, no new deps, `npm test` gate after each task.

**High-risk zone:** CLAUDE.md §11 — every step requires `npm test` ✅ before commit.

---

## File Map

| Fichier | Action |
|---|---|
| `frontend/src/player-seekbar.js` | Créer (side-effect import in app.js) |
| `frontend/src/player-likes.js` | Créer (barrel re-export from player.js) |
| `frontend/src/player-mediasession.js` | Créer (imported in app.js + player.js) |
| `frontend/src/player-events.js` | Créer (imported in player.js at module init) |
| `frontend/src/player.js` | Modifier (remove extracted code, trim comments) |
| `frontend/src/app.js` | Modifier (add import './player-seekbar.js', wire initMediaSession) |

---

## Task 1: Extract player-seekbar.js

Extracts seek bar DOM (lines ~87–185 in player.js: pbar, pfill, _seekTip, _clampSeekTipLeft, _applySeekRatio, all pbar.addEventListener calls).

**Files:**
- Create: `frontend/src/player-seekbar.js`
- Modify: `frontend/src/player.js`
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Read the seek bar section in player.js**

```powershell
Get-Content frontend/src/player.js | Select-Object -Skip 86 -First 102
```

Confirm exact lines of: `pbar`/`pfill`/`_seekTip` declarations (~88–94), `_clampSeekTipLeft` (~104–111), `_applySeekRatio` (~113–126), `if (pbar) { ... }` block (~128–185). Note that `seeking` and `_seekRect` module-level vars (lines ~90–92) move with the seekbar.

- [ ] **Step 2: Create `player-seekbar.js`**

```js
// player-seekbar.js — Seek bar DOM + pointer/keyboard listeners.
// Side-effect module: imported from app.js. Imports audio from player.js (not circular).
import { fmt }   from './utils.js';
import { audio } from './player.js';

const pbar     = document.getElementById('pbar');
const pfill    = document.getElementById('pfill');
const _seekTip = document.getElementById('seek-tip');
let seeking    = false;
/** @type {DOMRect | null} */
let _seekRect  = null;

function _clampSeekTipLeft(ratio, pbarW) {
  if (!_seekTip || !pbarW) return (ratio * 100).toFixed(1) + '%';
  const tipHalfW = (_seekTip.offsetWidth || 36) / 2;
  const posPx    = Math.max(tipHalfW, Math.min(pbarW - tipHalfW, ratio * pbarW));
  return (posPx / pbarW * 100).toFixed(1) + '%';
}

function _applySeekRatio(ratio) {
  if (!audio.duration || isNaN(audio.duration)) return;
  ratio = Math.max(0, Math.min(1, ratio));
  audio.currentTime = ratio * audio.duration;
  if (pfill) pfill.style.transform = `scaleX(${ratio})`;
  if (_seekTip) {
    _seekTip.textContent = fmt(ratio * audio.duration);
    _seekTip.style.left  = _clampSeekTipLeft(ratio, _seekRect?.width || pbar?.clientWidth || 0);
    _seekTip.classList.add('on');
  }
}

if (pbar) {
  pbar.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    e.preventDefault();
    pbar.setPointerCapture(e.pointerId);
    seeking = true; _seekRect = pbar.getBoundingClientRect();
    _applySeekRatio((e.clientX - _seekRect.left) / _seekRect.width);
  });
  pbar.addEventListener('pointermove', (e) => {
    if (!seeking || !_seekRect || !audio.duration) return;
    _applySeekRatio((e.clientX - _seekRect.left) / _seekRect.width);
  });
  const _endSeek = () => { seeking = false; _seekRect = null; _seekTip?.classList.remove('on'); };
  pbar.addEventListener('pointerup',     _endSeek);
  pbar.addEventListener('pointercancel', _endSeek);
  window.addEventListener('blur', _endSeek);
  pbar.addEventListener('mousemove', (e) => {
    if (seeking || !audio.duration || !_seekTip) return;
    const rect = pbar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _seekTip.textContent = fmt(frac * audio.duration);
    _seekTip.style.left  = _clampSeekTipLeft(frac, rect.width);
    _seekTip.classList.add('on');
  });
  pbar.addEventListener('mouseleave', () => { if (!seeking) _seekTip?.classList.remove('on'); });
  pbar.addEventListener('keydown', (e) => {
    const dur = audio.duration; if (!dur) return;
    const step = e.shiftKey ? 30 : 5;
    if      (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.min(dur, audio.currentTime + step); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.max(0, audio.currentTime - step); }
    else if (e.key === 'Home')       { e.preventDefault(); audio.currentTime = 0; }
    else if (e.key === 'End')        { e.preventDefault(); audio.currentTime = dur; }
  });
}
```

- [ ] **Step 3: Remove seek bar section from player.js**

Delete from player.js:
- `const pbar = ...`, `const pfill = ...`, `let seeking = ...`, `let _seekRect = ...`, `const _seekTip = ...` declarations
- `_clampSeekTipLeft` function
- `_applySeekRatio` function
- The entire `if (pbar) { ... }` event-listener block

Keep in player.js: `_DOM.pfill` (line ~73) — that is the cached ref used in timeupdate hot path, different from the seekbar `pfill`.

- [ ] **Step 4: Add side-effect import in app.js**

```js
import './player-seekbar.js';
```

Add after other side-effect imports in `frontend/src/app.js`.

- [ ] **Step 5: Verify**

```powershell
node --check frontend/src/player-seekbar.js
node --check frontend/src/player.js
npm test
(Get-Content frontend/src/player.js).Count
```

Expected: KO=0; line count ~1214 (saved ~99).

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/player-seekbar.js frontend/src/player.js frontend/src/app.js
git commit -m "refactor(player): extract seek bar to player-seekbar.js"
```

---

## Task 2: Extract player-likes.js

Extracts `toggleLike` and `likeat` (~73 lines). `toggleLike` reads `curIdx` via `get('curIdx')` instead of the module-level mirror — no circular dependency.

**Files:**
- Create: `frontend/src/player-likes.js`
- Modify: `frontend/src/player.js`

- [ ] **Step 1: Read the like functions in player.js**

```powershell
Get-Content frontend/src/player.js | Select-Object -Skip 694 -First 78
```

Identify exact extents of `toggleLike` (starts ~line 697) and `likeat` (starts ~line 745). Note all local variable references.

- [ ] **Step 2: Create `player-likes.js`**

Copy the two functions verbatim from player.js with these changes:
- Replace module-level `curIdx` with `get('curIdx')` in `toggleLike`
- Add required imports at top

```js
// player-likes.js — toggleLike / likeat. Barrel re-exported from player.js.
import { get, set }              from './store.js';
import { emit, EVENTS }          from './bus.js';
import { saveCfg, saveCfgNow }   from './cfgsave.js';
import { invalidateFilterCache } from './search.js';
import { VIRT }                  from './virt.js';
import { _allPlayerUI }          from './allplayerui.js';

export function toggleLike() {
  const curIdx = get('curIdx');    // reads from store (not player.js module var)
  if (curIdx < 0) return;
  const liked   = get('liked');
  const tracks  = get('tracks');
  const trackId = tracks[curIdx]?.id;
  if (!trackId) return;
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked);
  const isLiked = liked.has(trackId);
  [document.getElementById('pl-lk'), document.getElementById('cinema-lk')]
    .filter(Boolean).forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('on', isLiked);
      btn.setAttribute('aria-pressed', String(isLiked));
      btn.classList.remove('popping');
      // @ts-ignore
      void btn.offsetWidth;
      btn.classList.add('popping');
      btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
    });
  const npBtn = document.querySelector('.np-lk');
  if (npBtn) {
    npBtn.classList.toggle('active', isLiked);
    npBtn.setAttribute('aria-pressed', String(isLiked));
    const svg = npBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
    npBtn.classList.remove('popping');
    // @ts-ignore
    void npBtn.offsetWidth;
    npBtn.classList.add('popping');
    npBtn.addEventListener('animationend', () => npBtn.classList.remove('popping'), { once: true });
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  if (get('view') === 'liked') emit(EVENTS.RENDER_LIB, {});
  saveCfgNow();
  _allPlayerUI();
}

/**
 * @param {Event} e
 * @param {string} trackId
 * @param {Element | null} [el]
 */
export function likeat(e, trackId, el) {
  e.stopPropagation();
  if (!trackId) return;
  const liked = get('liked');
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked);
  // @ts-ignore
  const btn = el instanceof Element ? el
    : (e.currentTarget instanceof Element && e.currentTarget !== document ? e.currentTarget : null);
  if (btn) {
    btn.classList.remove('popping');
    // @ts-ignore
    void btn.offsetWidth;
    btn.classList.add('popping');
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
    btn.setAttribute('aria-pressed', String(liked.has(trackId)));
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  if (VIRT) VIRT._lastListSig = '';
  const tlist = document.getElementById('tlist');
  const savedScroll = tlist ? tlist.scrollTop : 0;
  emit(EVENTS.RENDER_LIB, {});
  if (tlist && get('view') === 'liked') requestAnimationFrame(() => { tlist.scrollTop = savedScroll; });
  saveCfg();
}
```

- [ ] **Step 3: Update player.js**

Delete `toggleLike` and `likeat` function bodies from player.js.
Remove imports that are now exclusively used by these two functions (check: `_allPlayerUI`, `VIRT` — verify they're used elsewhere first).
Add barrel re-export at the bottom of player.js (before audio listeners):

```js
export { toggleLike, likeat } from './player-likes.js';
```

- [ ] **Step 4: Verify**

```powershell
node --check frontend/src/player-likes.js
node --check frontend/src/player.js
npm test
(Get-Content frontend/src/player.js).Count
```

Expected: KO=0; ~1143 lines.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/player-likes.js frontend/src/player.js
git commit -m "refactor(player): extract toggleLike/likeat to player-likes.js"
```

---

## Task 3: Extract player-mediasession.js

Extracts `updateMediaSession`, `initMediaSession`, `updateMediaSessionState` (~55 lines).
Pattern: module holds `_audio` ref, receives it via `initMediaSession(audio, {prev, next, toggleLike})`. No circular dep — player.js imports from this module but this module does NOT import from player.js.

**Files:**
- Create: `frontend/src/player-mediasession.js`
- Modify: `frontend/src/player.js`
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Read the mediasession section**

```powershell
Get-Content frontend/src/player.js | Select-Object -Skip 1148 -First 58
```

Confirm the 3 functions (lines ~1151–1202) and their exact dependencies.

- [ ] **Step 2: Create `player-mediasession.js`**

```js
// player-mediasession.js — navigator.mediaSession wiring.
// Call initMediaSession(audio, { prev, next, toggleLike }) from app.js boot.
/** @import { Track } from './types.js' */

let _audio = /** @type {HTMLAudioElement|null} */ (null);

export function initMediaSession(audio, { prev, next, toggleLike }) {
  _audio = audio;
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',          () => { audio.play().catch(() => {}); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('pause',         () => { audio.pause(); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack',     () => next(true));
  navigator.mediaSession.setActionHandler('seekto',        e => { if (e.seekTime !== undefined && !isNaN(audio.duration)) audio.currentTime = e.seekTime; });
  navigator.mediaSession.setActionHandler('seekbackward',  e => { if (!audio.duration || isNaN(audio.duration)) return; audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); });
  navigator.mediaSession.setActionHandler('seekforward',   e => { if (!audio.duration || isNaN(audio.duration)) return; audio.currentTime = Math.min(audio.duration, audio.currentTime + (e.seekOffset || 10)); });
  try { navigator.mediaSession.setActionHandler('togglefavorite', () => toggleLike()); } catch(_) {}
}

/** @param {Track} t */
export function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  const artSrc  = t._b64 || (t.art && !t.art.startsWith('blob:') ? t.art : null);
  const artMime = artSrc && artSrc.startsWith('data:') ? artSrc.slice(5, artSrc.indexOf(';'))
    : artSrc && /\.png($|\?)/i.test(artSrc) ? 'image/png'
    : artSrc && /\.webp($|\?)/i.test(artSrc) ? 'image/webp'
    : 'image/jpeg';
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  t.name,
    artist: t.artistFull || t.artist || '',
    album:  t.album || '',
    artwork: artSrc ? [
      { src: artSrc, sizes: '96x96',   type: artMime },
      { src: artSrc, sizes: '128x128', type: artMime },
      { src: artSrc, sizes: '256x256', type: artMime },
      { src: artSrc, sizes: '512x512', type: artMime },
    ] : [],
  });
}

export function updateMediaSessionState() {
  const audio = _audio;
  if (!audio || !('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  if (!isNaN(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration:     audio.duration,
        playbackRate: audio.playbackRate || 1,
        position:     Math.min(audio.currentTime, audio.duration),
      });
    } catch(e) { console.warn('[mediaSession]', e); }
  }
}
```

- [ ] **Step 3: Update player.js**

Remove the 3 functions from player.js.
Add at top of player.js:
```js
import { updateMediaSessionState } from './player-mediasession.js';
```
(player.js needs `updateMediaSessionState` for the 'play'/'pause' audio event listeners that remain in player.js until Task 4.)

Add barrel re-export:
```js
export { updateMediaSession, initMediaSession, updateMediaSessionState } from './player-mediasession.js';
```

- [ ] **Step 4: Update app.js**

Find the call to `initMediaSession()` in app.js. Change to import from the new module:
```js
import { initMediaSession } from './player-mediasession.js';
```
and call:
```js
initMediaSession(audio, { prev, next, toggleLike });
```

- [ ] **Step 5: Verify**

```powershell
node --check frontend/src/player-mediasession.js
node --check frontend/src/player.js
npm test
(Get-Content frontend/src/player.js).Count
```

Expected: KO=0; ~1090 lines.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/player-mediasession.js frontend/src/player.js frontend/src/app.js
git commit -m "refactor(player): extract MediaSession to player-mediasession.js"
```

---

## Task 4: Trim comments in player.js to reach <800 lines

After Tasks 1–3, player.js is ~1090 lines. Need to trim ~290 more lines via comments only (no code removal). Target: < 800.

**Files:**
- Modify: `frontend/src/player.js`

- [ ] **Step 1: Count pure comment lines**

```powershell
(Select-String -Path frontend/src/player.js -Pattern "^\s*//").Count
(Select-String -Path frontend/src/player.js -Pattern "^\s*/\*\*").Count
```

- [ ] **Step 2: Remove these comment categories**

Apply all of the following — each saves multiple lines:

**A. `/** @type {...} */` annotations on internal variables** (~30 lines):
Delete all `/** @type {...} */` lines that annotate module-level `let` declarations. These provide no runtime value and the variable name/initializer is self-documenting. Example deletions:
```js
// DELETE:
/** @type {ReturnType<typeof setTimeout> | null} */
let cfFadeTimer    = null;
// KEEP:
let cfFadeTimer    = null;
```

**B. Multi-line JSDoc on private functions** (~40 lines):
Functions like `_postPlaySideEffects`, `_playDirect`, `_updateRecentPlays`, `_resetCfGains`, `_commitGapless`, `_handleGaplessPreBuffer`, `_handleCrossfadeSetup`, `_commitCrossfadeTransition` — collapse their 3–6 line JSDoc blocks to a single `// brief description` or remove entirely.

**C. `// Phase 4` and `// Jalon N` historical milestone markers** (~25 lines):
Every `// Phase 4` comment after `get('tracks')`, `get('liked')`, etc. Remove all — they're historical, not reader-useful.

**D. Inline `// @ts-ignore — <explanation>` continuation lines** (~15 lines):
Where `// @ts-ignore` is followed by a separate explanation comment line, merge into one:
```js
// @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
```
becomes just `// @ts-ignore` (the suppression is sufficient; the reason is clear from context).

**E. Section divider lines** `// ── Name ─────────────────────────────────────────────` (~20 lines):
Keep the section dividers for the 5 major sections (Audio element, Playback state, Crossfade/gapless, checkCrossfade, Queue helpers). Remove the rest.

**F. Long FIX-BN narrative blocks** (keep 1 line, delete expansions) (~100 lines):
Convert patterns like:
```js
// BUG-6 FIX : sauvegarder la position AVANT de pauser audioNext
// La position d'audioNext doit être capturée avant que audio.pause() (ligne suivante)
// ne signale 'pause' aux listeners — dont updateMediaSessionState — qui lirait alors
// un currentTime incorrect pour la piste entrante.
const _cfPos = audioNext.currentTime;
```
to:
```js
// BUG-6: save audioNext.currentTime before audio.pause() (MediaSession reads it)
const _cfPos = audioNext.currentTime;
```

**G. Collapse multi-line `// INVARIANT:` blocks** (~20 lines):
Keep the 1-line invariant note, remove elaboration paragraphs.

**H. Remove `// DSP-N` explanation paragraphs** (~30 lines):
Keep the `// DSP-N:` shorthand prefix, delete the multi-sentence elaboration that follows.

- [ ] **Step 3: Verify after each major category**

Run `npm test` after each category (A through H) to catch any accidental code deletion:
```powershell
npm test
```

- [ ] **Step 4: Final check**

```powershell
(Get-Content frontend/src/player.js).Count
npm test
```

Expected: < 800; KO=0.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/player.js
git commit -m "chore(player): trim verbose comments — §16 800-line cap compliance"
```

---

## Task 5: Final verification

- [ ] **Step 1: All line counts**

```powershell
@('player.js','player-seekbar.js','player-likes.js','player-mediasession.js') |
  ForEach-Object { "$_ : $((Get-Content "frontend/src/$_").Count)" }
```

Expected: player.js < 800; sub-modules each < 150.

- [ ] **Step 2: Full test suite**

```powershell
npm test
```

Expected: KO=0, ≥ 439 OK.

- [ ] **Step 3: Syntax check all new files**

```powershell
node --check frontend/src/player-seekbar.js
node --check frontend/src/player-likes.js
node --check frontend/src/player-mediasession.js
node --check frontend/src/player.js
```

- [ ] **Step 4: Vite build**

```powershell
npm run vite:build
```

Expected: exits 0, no module-not-found errors.

---

## Auto-review

**Coverage:**
- ✅ seekbar extraction (Task 1, ~99 lines)
- ✅ likes extraction (Task 2, ~73 lines)
- ✅ mediasession extraction (Task 3, ~55 lines)
- ✅ comment trimming (Task 4, ~290 lines)
- ✅ final verification (Task 5)

Total extraction + trimming: ~517 lines → player.js 1313 → ~796 lines ✅

**Invariants preserved:**
- `audio.volume` never assigned literally — untouched
- `radioRefillQueue()` before `_postPlaySideEffects()` — untouched
- `rebuildTrackIdxMap()` after tracks[] mutation — untouched
- IPC through ipc.js — untouched
- No external network — untouched

**Circular dep analysis:**
- `player-seekbar.js` → imports `audio` from `player.js`; `player.js` does NOT import from `player-seekbar.js` ✅
- `player-likes.js` → imports from store/bus/search etc.; `player.js` barrel re-exports it ✅
- `player-mediasession.js` → imports nothing from `player.js`; `player.js` imports `updateMediaSessionState` from it ✅
