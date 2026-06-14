# Welcome Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current welcome screen (#vw) — logo + 4 feature cards + 2 CTAs — with a minimal premium layout: 160px logo with CSS breathing animation, tagline, single CTA pill, drag-drop hint, and an independent particle canvas ambient animation.

**Architecture:** Four JS files touched (cinema-bg.js adds a self-contained particle system; cinema.js re-exports it; views.js gets a hook registration; app.js wires the hooks). Two frontend files restructured (index.html replaces #vw content; style.css updates layout and animations for new class names). No new modules, no new IPC commands, no new dependencies.

**Tech Stack:** Vanilla JS ESM, CSS custom properties (design-system.css tokens), Canvas 2D API, existing `prefersReducedMotion()` from motion.js.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/cinema-bg.js` | Add `startWelcomeAmbient()` + `stopWelcomeAmbient()` at bottom (before resize listener) |
| `frontend/src/cinema.js` | Import + re-export the two new functions |
| `frontend/src/views.js` | Add `registerWelcomeHooks(onShow, onHide)` + call hooks from `_showViewRaw` |
| `frontend/src/app.js` | Import `registerWelcomeHooks` from views.js + `startWelcomeAmbient`/`stopWelcomeAmbient` from cinema.js + wire them |
| `frontend/index.html` | Replace lines 166-187 (#vw content) |
| `frontend/src/style.css` | Update #vw to center, add .welcome-* classes, add logo-breathe keyframe, update .on animations, remove dead .wl/.wfeats/.wbtn-m3u CSS |

---

## Task 1: Add particle ambient system to cinema-bg.js

**Files:**
- Modify: `frontend/src/cinema-bg.js` (insert before the `// ── Resize ───` block at line 272)

- [ ] **Step 1: Insert the welcome ambient code**

Open `frontend/src/cinema-bg.js`. Find the `// ── Resize ───` comment (currently around line 272). Insert the following block immediately before it:

```js
// ── Welcome screen ambient (idle, no cinema required) ───────────────────────

let _welcomeGen = 0;
let _welcomeRaf = null;
let _welcomePts = null;

function _initWelcomePts(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 800;
  const H   = canvas.offsetHeight || 600;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  _welcomePts = Array.from({ length: 16 }, () => ({
    x:  Math.random() * W,
    y:  Math.random() * H,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r:  1.5 + Math.random() * 2,
  }));
}

function _drawWelcomeFrame(canvas, dt) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !_welcomePts) return;
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.offsetWidth  || 800;
  const H      = canvas.offsetHeight || 600;
  if (Math.round(W * dpr) !== canvas.width || Math.round(H * dpr) !== canvas.height) {
    _initWelcomePts(canvas);
    return;
  }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B6BFF';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const p of _welcomePts) {
    p.x = (p.x + p.vx * dt / 16 + W) % W;
    p.y = (p.y + p.vy * dt / 16 + H) % H;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.08;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function startWelcomeAmbient() {
  if (_welcomeRaf) return;
  const canvas = document.querySelector('#vw .welcome-canvas');
  if (!canvas) return;
  _initWelcomePts(canvas);
  if (prefersReducedMotion()) {
    _drawWelcomeFrame(canvas, 0);
    return;
  }
  const myGen = ++_welcomeGen;
  let last = performance.now();
  function loop(now) {
    if (myGen !== _welcomeGen || document.hidden) { _welcomeRaf = null; return; }
    const dt = now - last;
    last = now;
    _drawWelcomeFrame(canvas, dt);
    _welcomeRaf = requestAnimationFrame(loop);
  }
  _welcomeRaf = requestAnimationFrame(loop);
}

export function stopWelcomeAmbient() {
  _welcomeGen++;
  if (_welcomeRaf) { cancelAnimationFrame(_welcomeRaf); _welcomeRaf = null; }
  _welcomePts = null;
  const canvas = document.querySelector('#vw .welcome-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/cinema-bg.js
git commit -m "feat(welcome): startWelcomeAmbient/stopWelcomeAmbient — particules idle indépendantes du mode cinema"
```

---

## Task 2: Re-export the new functions from cinema.js

**Files:**
- Modify: `frontend/src/cinema.js` (lines 22-35)

- [ ] **Step 1: Update the cinema-bg.js import in cinema.js**

Find this block (lines 22-28):
```js
import {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  stopAmbientAnim, updateAmbientGradient, restartAmbientIfNeeded,
  initCinemaBgModule,
} from './cinema-bg.js';
```

Replace with:
```js
import {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  stopAmbientAnim, updateAmbientGradient, restartAmbientIfNeeded,
  initCinemaBgModule,
  startWelcomeAmbient, stopWelcomeAmbient,
} from './cinema-bg.js';
```

- [ ] **Step 2: Add the two functions to the re-export block**

Find this block (lines 31-35):
```js
export {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
};
```

Replace with:
```js
export {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  startWelcomeAmbient, stopWelcomeAmbient,
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/cinema.js
git commit -m "feat(welcome): re-export startWelcomeAmbient/stopWelcomeAmbient depuis cinema.js"
```

---

## Task 3: Add welcome hook registration to views.js

**Files:**
- Modify: `frontend/src/views.js`

- [ ] **Step 1: Add hook state and registration function**

After the `// ── Helpers d'état ──` comment block (around line 41, after the `_v()/_s()/_q()` helpers), insert:

```js
// ── Welcome screen hooks ──────────────────────────────────────────────────
let _onWelcomeShow = null;
let _onWelcomeHide = null;

export function registerWelcomeHooks(onShow, onHide) {
  _onWelcomeShow = onShow;
  _onWelcomeHide = onHide;
}
```

- [ ] **Step 2: Call hooks from _showViewRaw**

Find `_showViewRaw` (line 104). Locate the block that adds `.on` to `next` and calls `viewEnter`:

```js
  next.classList.add('on');
  // Only animate if actually switching to a different view element.
  if (prev && prev !== next) viewEnter(next);
```

Replace with:

```js
  if (prev?.id === 'vw' && next?.id !== 'vw') _onWelcomeHide?.();
  next.classList.add('on');
  if (next.id === 'vw') _onWelcomeShow?.();
  // Only animate if actually switching to a different view element.
  if (prev && prev !== next) viewEnter(next);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views.js
git commit -m "feat(welcome): registerWelcomeHooks — câblage show/hide du canvas ambient dans _showViewRaw"
```

---

## Task 4: Wire welcome hooks in app.js

**Files:**
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Add registerWelcomeHooks to the views.js import**

Find the import from `./views.js` (around line 81):
```js
import {
  _showViewRaw, showView, goHome, setView, onSearch, nextSort,
  nextAlbumSort, nextArtistSort, nextGenreSort,
  statsGoToGenre, statsGoToArtist, statsGoToAlbum,
  updateClearFiltersBtn, clearAllFilters,
} from './views.js';
```

Add `registerWelcomeHooks,` to the import list:
```js
import {
  _showViewRaw, showView, goHome, setView, onSearch, nextSort,
  nextAlbumSort, nextArtistSort, nextGenreSort,
  statsGoToGenre, statsGoToArtist, statsGoToAlbum,
  updateClearFiltersBtn, clearAllFilters,
  registerWelcomeHooks,
} from './views.js';
```

- [ ] **Step 2: Add startWelcomeAmbient/stopWelcomeAmbient to the cinema.js import**

Find line 20:
```js
import { cinemaOpen, cinemaBg, initCinemaBg, toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress, setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn, toggleCinemaFullscreen, CINEMA_BG_MODES, CINEMA_BG_LABELS, updateCinArtColor } from './cinema.js';
```

Add `startWelcomeAmbient, stopWelcomeAmbient,` at the end of the named imports (before the closing `}`) — result:
```js
import { cinemaOpen, cinemaBg, initCinemaBg, toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress, setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn, toggleCinemaFullscreen, CINEMA_BG_MODES, CINEMA_BG_LABELS, updateCinArtColor, startWelcomeAmbient, stopWelcomeAmbient } from './cinema.js';
```

- [ ] **Step 3: Register the hooks at boot time**

Find the `initCinemaBg(...)` call (around line 495):
```js
    if (cfg.cinemaBg) {
      const _bgMigration = { solid: 'amoled', none: 'ambient', blur: 'ambient' };
      initCinemaBg(_bgMigration[cfg.cinemaBg] || cfg.cinemaBg);
    }
```

Add the hook registration immediately after:
```js
    if (cfg.cinemaBg) {
      const _bgMigration = { solid: 'amoled', none: 'ambient', blur: 'ambient' };
      initCinemaBg(_bgMigration[cfg.cinemaBg] || cfg.cinemaBg);
    }
    registerWelcomeHooks(startWelcomeAmbient, stopWelcomeAmbient);
```

**Important:** `registerWelcomeHooks` must also be called in the boot path where `cfg` is null (first run). Find where `goHome()` / `showView('welcome')` is called after an empty library boot and ensure the hooks are registered before that call. Search for the other call to `initCinemaBg` or the "no cfg" boot path and add the same `registerWelcomeHooks(startWelcomeAmbient, stopWelcomeAmbient);` line there too.

To be safe, move the registration to just before the first call to `goHome()` at the end of the boot function (the single call covers both branches since it runs unconditionally):

Search for the single top-level `registerWelcomeHooks` line you added above, remove it, and instead add it ONCE, right before the `goHome()` call at the end of the boot sequence. If there is no `goHome()` at boot, place it immediately before `document.getElementById('boot-spinner').style.display = 'none'` or equivalent hiding of the spinner.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app.js
git commit -m "feat(welcome): câblage registerWelcomeHooks + import startWelcomeAmbient/stopWelcomeAmbient"
```

---

## Task 5: Replace #vw content in index.html

**Files:**
- Modify: `frontend/index.html` (lines 166-187)

- [ ] **Step 1: Replace the #vw block**

Find the current `#vw` block (lines 166-187):
```html
  <!-- Welcome -->
  <div class="view on" id="vw">
    <div class="wl">
      <img src="/icon-512.png" alt="LibreFlow logo" class="wl-logo">
      <h1 class="wh1">Bienvenue sur LibreFlow</h1>
    </div>
    <p class="wsub">Ton lecteur audio local. Tes musiques, sans streaming, sans pub.</p>
    <div class="wfeats">
      <div class="wf">...card 1...</div>
      <div class="wf">...card 2...</div>
      <div class="wf">...card 3...</div>
      <div class="wf">...card 4...</div>
    </div>
    <button class="wbtn wbtn-scan" data-action="open-folder">
      ...
      Choisir mon dossier Musique
    </button>
    <button class="wbtn wbtn-m3u" data-action="import-m3u">
      ...
      Importer une playlist M3U
    </button>
    <span class="whint">ou glisse-dépose des fichiers audio dans la fenêtre</span>
  </div>
```

Replace the entire block (lines 166-187 inclusive) with:

```html
  <!-- Welcome -->
  <div class="view on" id="vw">
    <canvas class="welcome-canvas" aria-hidden="true" role="presentation"></canvas>
    <div class="welcome-content">
      <img src="/icon-512.png" alt="LibreFlow" class="welcome-logo">
      <h1 class="welcome-title">LibreFlow</h1>
      <p class="welcome-tagline">Ton lecteur audio. Hors ligne.</p>
      <button class="welcome-cta" data-action="open-folder">Choisir mon dossier…</button>
      <span class="welcome-hint">ou glisse-dépose des fichiers ici</span>
    </div>
  </div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "feat(welcome): remplace #vw — supprime 4 cards + 2 CTAs, layout logo vivant"
```

---

## Task 6: Update style.css — layout, new classes, animations

**Files:**
- Modify: `frontend/src/style.css`

### 6a — Update #vw base styles

- [ ] **Step 1: Update #vw alignment**

Find the `#vw {` block (around line 1926):
```css
#vw {
  align-items: flex-start;
  justify-content: center;
  ...
```

Change `align-items: flex-start` to `align-items: center`:
```css
#vw {
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 0 clamp(var(--sp-5), 6vw, var(--sp-15));
  background:
    radial-gradient(ellipse 55% 55% at 88% 18%, rgba(var(--g-rgb),.13) 0%, transparent 65%),
    radial-gradient(ellipse 35% 45% at 12% 85%, rgba(var(--g-rgb),.07) 0%, transparent 60%),
    radial-gradient(ellipse 70% 30% at 50%  0%, rgba(var(--g-rgb),.04) 0%, transparent 55%);
}
```

### 6b — Add welcome canvas style

- [ ] **Step 2: Add .welcome-canvas after #vw block**

After the `#vw` closing brace (after the `@media (prefers-reduced-motion: reduce)` block for `#vw::before, #vw::after` at line ~1970), add:

```css
.welcome-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
```

### 6c — Add welcome-content wrapper

```css
.welcome-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0;
}
```

### 6d — Add welcome-logo with breathing animation

```css
.welcome-logo {
  width: 160px;
  height: 160px;
  border-radius: var(--radius-lg);
  display: block;
  margin-bottom: var(--space-8);
  filter: drop-shadow(0 0 24px var(--accent-glow));
  animation: logo-breathe 3.5s ease-in-out 900ms infinite;
}

@keyframes logo-breathe {
  0%, 100% {
    filter: drop-shadow(0 0 24px var(--accent-glow));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 0 36px var(--accent-glow));
    transform: scale(1.02);
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-logo { animation: none; }
}
```

### 6e — Add welcome-title, welcome-tagline, welcome-cta, welcome-hint

```css
.welcome-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
  margin: 0 0 var(--space-2) 0;
}

.welcome-tagline {
  font-family: var(--font-body);
  font-size: var(--text-md);
  font-weight: var(--weight-regular);
  color: var(--text-muted);
  margin: 0 0 var(--space-8) 0;
  line-height: var(--leading-snug);
}

.welcome-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 14px 32px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  border: none;
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-glow);
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease-standard),
              box-shadow var(--motion-fast) var(--ease-standard),
              transform var(--motion-fast) var(--ease-standard);
  margin-bottom: var(--space-4);
  min-height: 44px;
}
.welcome-cta:hover  { background: var(--accent-hover); box-shadow: 0 8px 40px var(--accent-glow), 0 2px 8px rgba(0,0,0,.40); }
.welcome-cta:active { background: var(--accent-active); transform: scale(0.97); }

.welcome-hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
  opacity: 0.6;
  transition: opacity var(--motion-base) var(--ease-standard);
}
body.dragging .welcome-hint {
  color: var(--text-secondary);
  opacity: 1;
}
```

### 6f — Update stagger animations for new class names

Find the existing `.on` animation block (around line 5615):
```css
#vw.on .wl      { animation: wlFadeIn .42s var(--decelerate) .04s both; }
#vw.on .wh1     { animation: wlFadeIn .38s var(--decelerate) .12s both; }
#vw.on .wsub    { animation: wlFadeIn .36s var(--decelerate) .18s both; }
#vw.on .wfeats  { animation: wlFadeIn .34s var(--decelerate) .24s both; }
#vw.on .wbtn    { animation: wlFadeIn .32s var(--decelerate) .30s both; }
#vw.on .whint   { animation: wlFadeIn .30s var(--decelerate) .38s both; }
```

Replace with:
```css
#vw.on .welcome-canvas  { animation: wlFadeIn .60s var(--ease-standard) 0ms   both; }
#vw.on .welcome-logo    { animation: wlFadeIn .50s var(--ease-standard) 150ms both; }
#vw.on .welcome-title   { animation: wlFadeIn .40s var(--ease-standard) 350ms both; }
#vw.on .welcome-tagline { animation: wlFadeIn .40s var(--ease-standard) 500ms both; }
#vw.on .welcome-cta     { animation: wlFadeIn .35s var(--ease-spring)   700ms both; }
#vw.on .welcome-hint    { animation: wlFadeIn .30s var(--ease-standard) 900ms both; }

@media (prefers-reduced-motion: reduce) {
  #vw.on .welcome-canvas,
  #vw.on .welcome-logo,
  #vw.on .welcome-title,
  #vw.on .welcome-tagline,
  #vw.on .welcome-cta,
  #vw.on .welcome-hint { animation: none; }
}
```

### 6g — Remove dead CSS for old welcome classes

Find and delete the following blocks (they reference classes no longer in the HTML):
- `.wl { ... }` (around line 1975)
- `.wl-logo { ... }` (around line 1980)
- `.wl .wh1 { ... }` (around line 1987)
- `.wh1 { ... }` (around line 1990)
- `.wsub { ... }` (around line 2002)
- `.wfeats { ... }` and its `@media (max-width: 700px)` block (around line 2015)
- `.wf { ... }`, `.wf-ico { ... }`, `.wf-ico svg { ... }`, `.wf-t { ... }`, `.wf-d { ... }` (around lines 2030-2068)
- `.wbtn { ... }`, `.wbtn:hover`, `.wbtn:active`, `.wbtn svg`, `.wbtn-m3u`, `.wbtn-m3u:hover` (around lines 2070-2092)
- `.whint { ... }` (around line 2092)
- Light mode overrides for `.wf`, `.wbtn`, `.wbtn-m3u`, `.wl-logo`, `#vw` in light mode (around lines 610-663)

### 6h — Update light mode for .welcome-logo

Find the `html[data-mode="light"] #vw` block (around line 656-663) and replace with:
```css
html[data-mode="light"] #vw {
  background:
    radial-gradient(ellipse 55% 55% at 88% 18%, rgba(var(--g-rgb),.08) 0%, transparent 65%),
    radial-gradient(ellipse 35% 45% at 12% 85%, rgba(var(--g-rgb),.05) 0%, transparent 60%),
    radial-gradient(ellipse 70% 30% at 50%  0%, rgba(var(--g-rgb),.03) 0%, transparent 55%);
}
html[data-mode="light"] #vw::before { background: radial-gradient(circle, rgba(var(--g-rgb),.06) 0%, transparent 68%); }
html[data-mode="light"] #vw::after  { background: radial-gradient(circle, rgba(var(--g-rgb),.04) 0%, transparent 70%); }
html[data-mode="light"] .welcome-logo { box-shadow: 0 4px 24px rgba(0,0,0,.12); }
html[data-mode="light"] .welcome-cta  { color: var(--text-on-accent); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(welcome): styles — centrage, welcome-logo breathing, stagger .on, suppression CSS obsolète"
```

---

## Task 7: Smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Clear the library so the welcome screen shows**

In the app: Settings → Vider la bibliothèque (or start with a fresh profile).

- [ ] **Step 3: Verify the welcome screen**

Check:
- [ ] Logo appears at 160px, centered, with an indigo glow
- [ ] Logo breathing animation is visible (very subtle scale 1→1.02, 3.5s loop)
- [ ] Particles are visible in the background (small, slow, 8% opacity indigo dots)
- [ ] Title "LibreFlow" in Syne Bold, centered
- [ ] Tagline "Ton lecteur audio. Hors ligne." in DM Sans, muted color, centered
- [ ] Single CTA pill button in accent indigo with glow shadow
- [ ] Hint text at the bottom, low opacity
- [ ] Stagger entry: canvas fades first, then logo, then title, then tagline, then CTA (spring), then hint
- [ ] No feature cards visible
- [ ] No "Importer une playlist M3U" button visible

- [ ] **Step 4: Verify prefers-reduced-motion**

In OS accessibility settings, enable reduced motion. Reload:
- [ ] Logo has no animation
- [ ] Canvas shows one static frame (no animation loop)
- [ ] Entry elements appear without translate/scale (opacity only or instant)

- [ ] **Step 5: Verify navigation**

Click "Tous les titres" in the sidebar (if library is populated) then come back to welcome:
- [ ] Canvas ambient stops when leaving welcome view
- [ ] Canvas ambient restarts when re-entering welcome view

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass (no new tests needed — no logic changes, pure UI).

- [ ] **Step 7: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix(welcome): ajustements post-smoke-test"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Logo 160px — Task 5 + 6d
- ✅ Titre Syne Bold --text-xl — Task 6e
- ✅ Tagline --text-muted — Task 6e
- ✅ CTA pill --accent --radius-full --shadow-glow — Task 6e
- ✅ Hint drag-drop — Task 5 + 6e
- ✅ Canvas ambient z-index: 0 behind content — Task 6b + 6c
- ✅ Logo breathing 3.5s — Task 6d
- ✅ Stagger entry with delays — Task 6f
- ✅ prefers-reduced-motion — Task 6d + 6f + cinema-bg.js
- ✅ canvas aria-hidden + role=presentation — Task 5
- ✅ Single CTA data-action="open-folder" (existing handler, no new wiring) — Task 5
- ✅ Stop/start ambient on view switch — Task 3 + 4

**Type/method consistency:**
- `startWelcomeAmbient()` / `stopWelcomeAmbient()` — same name in cinema-bg.js, cinema.js, app.js ✅
- `registerWelcomeHooks(onShow, onHide)` — defined in views.js, called in app.js ✅
- `.welcome-canvas` — same class in HTML (Task 5), CSS (Task 6b), and JS querySelector (Task 1) ✅
