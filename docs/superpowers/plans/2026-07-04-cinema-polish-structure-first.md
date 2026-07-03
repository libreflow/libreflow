# Cinema Polish Cycle 2 — « Structure d'abord » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructurer le cœur du rendu cinéma (boucle rAF maître unique, FFT/beat partagés, dt framerate-indépendant, extraction input, cycle d'import cassé), puis poser dessus robustesse, perf, polish visuel premium et finitions UX/a11y — cf. spec `docs/superpowers/specs/2026-07-04-cinema-polish-structure-first-design.md`.

**Architecture:** Nouveau module `cinema-loop.js` propriétaire de l'unique rAF cinéma : il calcule `dt`, remplit le snapshot FFT partagé, fait tourner le détecteur de beat unique, applique la politique de cadence (60/30 fps, sommeil en pause), puis appelle `drawBgFrame(dt, fft, beat)` et `drawVizFrame(dt, fft, beat)` — `cinema-bg.js`/`cinema-viz.js` deviennent des renderers passifs sans rAF. Nouveau module `cinema-input.js` (DI, pattern cinema-seek/queue) absorbe tout l'input de `cinema.js`. Le cycle `player.js ↔ cinema.js` est remplacé par un événement bus.

**Tech Stack:** Vanilla ESM JS, GSAP via `motion.js`, canvas 2D, tokens dans `design-system.css`, tests `node:assert` CJS (`core.test.cjs`, `a11y.test.cjs`).

## Global Constraints

- Aucun `console.log` commité — `console.warn` uniquement pour signaux documentés (CLAUDE.md §14)
- Aucun réseau (`fetch`, `XMLHttpRequest`, `WebSocket`) (§15)
- `audio.volume` JAMAIS assigné littéralement — tout passe par `setMasterGain()` + sliders DOM (§2, §9, §13)
- Aucun `.value =` direct sur AudioParam (§9)
- Écritures IDB via `saveCfg()` (debouncé) (§8)
- **Zéro allocation dans les boucles rAF** : strings/gradients/arrays cachés, reconstruits uniquement sur invalidation (§10)
- Tout nouveau token CSS déclaré dans `design-system.css` UNIQUEMENT (garde-fou `token-source.test.cjs`)
- Fichiers <800 lignes, fonctions <50 lignes (§16) ; **`cinema.js` ≤ 650 dès la Task 8** (pression structurelle, spec §6)
- Nouvelle clé i18n = ajout dans `i18n.fr.js` ET `i18n.en.js` (parité)
- Tests style maison : `node:assert`, logique pure par **import ESM réel** (pattern `buildUpcoming`), scans regex réservés aux invariants structurels ; suites `npm test` + `node frontend/tests/a11y.test.cjs` + `token-source` + `theme-palette` vertes à chaque commit
- WCAG 2.1 AA + 2.2 AA + AAA projet : cibles ≥24px, focus ring dual-tone, reduced-motion = 1 frame statique puis stop (via `prefersReducedMotion()` de motion.js — préférence 3 états)
- Nouveaux modules : préfixe `cinema-`, pattern init-callback DI, importés uniquement par le cluster cinéma ou app.js ; AUCUN nouvel import cross-feature
- Section « cinema split » de core.test.cjs mise à jour à chaque nouveau fichier (caps de lignes + surface d'exports)
- Commits conventionnels `<type>(<scope>): <description>`, pas d'attribution
- `npm run bench` non régressé >5 % aux checkpoints de fin de phase

---

## File Map

| Fichier | Changements (tâches) |
|---|---|
| `frontend/src/viz.js` | T1: suspend/resume pilotent aussi `_premiumOsc` |
| `frontend/src/cinema-loop.js` | **T2: nouveau** — boucle maître, FFT snapshot, beat unique, cadence, sommeil/réveil |
| `frontend/src/cinema-bg.js` | T3: renderer passif `drawBgFrame` ; T7: purge ; T12: post-decode + guard snapshot + rgb scalaires ; T13: cap DPR |
| `frontend/src/cinema-viz.js` | T4: renderer passif `drawVizFrame`, beat partagé ; T11: DPR dynamique ; T15: radii/LUT/vol-vis |
| `frontend/src/cinema-canvas.js` | T5: dt + beat en paramètres ; T12: foam reset ; T16-T20: polish visuel |
| `frontend/src/cinema-waves.js` | T20: docs ; T27: JSDoc |
| `frontend/src/cinema-input.js` | **T6: nouveau** — clavier/molette/dblclick/auto-hide + 4 bug-fixes input |
| `frontend/src/cinema.js` | T2-T4: câblage loop ; T6: extraction input ; T7: bus progress + purge ; T24: raccourcis ; T26: fermeture chorégraphiée |
| `frontend/src/cinema-render.js` | T7: `_readVolDom`/`_setVolSliders` exportés ; T12: callback post-decode ; T24: burst unifié |
| `frontend/src/cinema-queue.js` | T12: close au breakpoint ; T23: clavier |
| `frontend/src/cinema-seek.js` | T10: `formatSeekTime(0)` ; T23: ARIA ↑/↓ |
| `frontend/src/ambientRenderer.js` | T17: `drawNoiseOverlay` exporté ; T21: calibration + audio-réactif ; vignette |
| `frontend/src/eq.js` | T9: émission `EQ_READY` |
| `frontend/src/player.js` | T7: émission `CINEMA_PROGRESS` (import cinema.js supprimé) |
| `frontend/src/bus.js` | T7: `CINEMA_PROGRESS` ; T9: `EQ_READY` |
| `frontend/src/utils.js` | T10: `fmt()` garde `isFinite` |
| `frontend/src/app.js` | T7: purge import `updateCinemaProgress` si inutilisé |
| `frontend/index.html` | T22-T25: ordre DOM, i18n, hint raccourcis |
| `frontend/src/style.css` | T14: glow ::after ; T15: scoping .active, corners ; T21: light mode, token ; T22: cibles/contraste ; T24-T26: styles |
| `frontend/src/design-system.css` | T21/T26: tokens `--dur-cin-*` nouveaux |
| `frontend/src/i18n.fr.js` / `i18n.en.js` | T24/T25: clés nouvelles |
| `frontend/tests/core.test.cjs` | quasi toutes les tâches |
| `frontend/tests/a11y.test.cjs` | T22-T25 |
| `frontend/tests/theme-palette.test.cjs` | T22: verrou contraste timecodes |

**Séquencement :** Phase 1 = T1→T8 (structure, **gate smoke manuel T8**), Phase 2 = T9→T12, Phase 3 = T13→T15, Phase 4 = T16→T21, Phase 5 = T22→T26, Phase 6 = T27. Chaque tâche = commit(s) indépendant(s) vérifiable(s).

---

## Phase 1 — Fondations structurelles

### Task 1: suspendViz() suspend aussi l'oscilloscope premium

**Files:** Modify: `frontend/src/viz.js:213-227`, `frontend/tests/core.test.cjs`

Bug (audit perf H3) : `suspendViz()` ne pose que `_vizSuspended`, lu par `_draw()` (bars/circle) seulement. En mode oscilloscope, `_premiumOsc` (oscPremium.js, rAF autonome) continue à rendre à 60 fps sous l'overlay cinéma.

- [ ] **Step 1 (TDD):** core.test.cjs, section « cinema perf » : scan de `viz.js` — le corps de `suspendViz` référence `_premiumOsc` (stop) ET `resumeViz` le redémarre conditionnellement (`vizMode === 'oscilloscope'` + `running`). RED.
- [ ] **Step 2:** implémentation :

```js
export function suspendViz() {
  _vizSuspended = true;
  // P-H3 fix : l'oscilloscope premium a son propre rAF — le stopper aussi.
  if (_premiumOsc) _premiumOsc.stop();
}
export function resumeViz() {
  _vizSuspended = false;
  if (!running || !canvas || !eqAnalyser) return;
  if (vizMode === 'oscilloscope') { _ensurePremiumOsc()?.start(); return; }
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  _draw();
}
```

- [ ] **Step 3:** `npm test` GREEN ; commit `fix(viz): suspendViz stoppe aussi l'oscilloscope premium sous l'overlay cinema`.

### Task 2: `cinema-loop.js` — boucle maître, FFT snapshot, beat unique, cadence

**Files:** Create: `frontend/src/cinema-loop.js` (<200 lignes) ; Modify: `frontend/tests/core.test.cjs`

**Interfaces (Produces):**
- `initCinemaLoop({ getCinemaOpen, getIsPlaying, getBgMode, getAnalyser, drawBg, drawViz })` — DI une fois depuis cinema.js. `drawBg(dt, fft, beat)` / `drawViz(dt, fft, beat)` retournent un booléen `needsFrames`.
- `startCinemaLoop()` / `stopCinemaLoop()` — open/close.
- `wakeCinemaLoop()` — relance après sommeil (play, resize, changement de mode/piste, visibilitychange).
- `loopCadence(mode, hasFocus)` → `1 | 2` (diviseur de frames) — **pure, exportée pour test**.
- `computeBassEnergy(fft)` → énergie basses (moyenne des carrés des 10 % premiers bins, /end) — **pure, exportée pour test** (même formule que l'actuel `_detectBeat` de cinema-viz.js:228-233).

- [ ] **Step 1 (TDD):** core.test.cjs, nouvelle section « cinema loop » : (a) import ESM réel de `loopCadence` : `loopCadence('waves', true) === 1`, `loopCadence('ambient', true) === 2`, `loopCadence('amoled', true) === 2`, `loopCadence('waves', false) === 2`, `loopCadence('spectrum', true) === 1` ; (b) import réel de `computeBassEnergy` : silence (Uint8Array zéros) → 0 ; impulsion (255 sur les 10 premiers bins d'un buffer de 1024) → >0 ; (c) scan : `cinema-loop.js` contient exactement UN `getByteFrequencyData` ; (d) scan : `cinema-loop.js` contient UN `createBeatDetector` avec `history: 43, threshold: 1.35, cooldownMs: 650` (constantes pochette conservées comme référence — spec §6 risques). RED.
- [ ] **Step 2:** créer `cinema-loop.js` :

```js
// LibreFlow — cinema-loop.js
// Boucle rAF MAÎTRE du mode cinéma (spec 2026-07-04 §2.1). Propriétaire unique du
// rAF : cinema-bg.js et cinema-viz.js sont des renderers passifs (drawFrame).
// Par frame : dt clampé → snapshot FFT partagé → beat unique → drawBg → drawViz.
// Politique de cadence centralisée : 60fps focalisé (waves/starfield/spectrum),
// 30fps ambient/amoled ou sans focus, sommeil quand tout est statique en pause.
import { createBeatDetector } from './cinema-beat.js';
import { prefersReducedMotion } from './motion.js';

const DT_MAX_MS = 100; // clamp — absorbe les reprises d'onglet sans téléporter les phases

let _deps = null, _raf = null, _gen = 0, _last = 0, _frame = 0;
let _fftBuf = null;
let _hasFocus = (typeof document !== 'undefined') ? document.hasFocus() : true;
const _beatDet = createBeatDetector({ history: 43, threshold: 1.35, cooldownMs: 650 });

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { _hasFocus = true; });
  window.addEventListener('blur',  () => { _hasFocus = false; });
}

/** Cadence pure : 1 = 60fps, 2 = 30fps (skip 1 frame/2). */
export function loopCadence(mode, hasFocus) {
  if (!hasFocus) return 2;
  if (mode === 'ambient' || mode === 'amoled') return 2; // drift 15-30s — 30fps invisible
  return 1;
}

/** Énergie basses (10% premiers bins, moyenne des carrés) — même formule que l'ex-_detectBeat. */
export function computeBassEnergy(fft) {
  const end = Math.max(1, Math.floor(fft.length * 0.10));
  let e = 0;
  for (let i = 0; i < end; i++) e += fft[i] * fft[i];
  return e / end;
}

export function initCinemaLoop(deps) { _deps = deps; }

function _tick(now) {
  const myGen = _gen;
  if (!_deps || !_deps.getCinemaOpen() || document.hidden) { _raf = null; return; }
  if (loopCadence(_deps.getBgMode(), _hasFocus) === 2 && (_frame++ % 2 !== 0)) {
    _raf = requestAnimationFrame(_tick); return;
  }
  const dt = Math.min(DT_MAX_MS, now - _last);
  _last = now;
  // ── Snapshot FFT partagé : UNE lecture par frame pour bg+viz+vol-vis ──
  const analyser = _deps.getAnalyser();
  let fft = null, beat = false;
  if (analyser) {
    if (!_fftBuf || _fftBuf.length !== analyser.frequencyBinCount) _fftBuf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(_fftBuf);
    fft = _fftBuf;
    beat = !prefersReducedMotion() && _beatDet.sample(computeBassEnergy(fft), now);
  }
  const bgActive  = _deps.drawBg(dt, fft, beat);
  const vizActive = _deps.drawViz(dt, fft, beat);
  if (myGen !== _gen) return; // stopCinemaLoop() appelé pendant le draw
  // Sommeil : reduced-motion = 1 frame puis stop ; pause + tout convergé = stop.
  if (prefersReducedMotion()) { _raf = null; return; }
  if (!_deps.getIsPlaying() && !bgActive && !vizActive) { _raf = null; return; }
  _raf = requestAnimationFrame(_tick);
}

export function startCinemaLoop() {
  if (_raf) return;
  _gen++; _last = performance.now(); _frame = 0;
  _raf = requestAnimationFrame(_tick);
}

export function stopCinemaLoop() {
  _gen++;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}

/** Réveil après sommeil (play/resize/mode/piste/visibilitychange) — no-op si déjà actif. */
export function wakeCinemaLoop() {
  if (!_deps || !_deps.getCinemaOpen() || _raf) return;
  _last = performance.now();
  _raf = requestAnimationFrame(_tick);
}
```

- [ ] **Step 3:** `npm test` — la section « cinema loop » passe (imports purs) ; le module n'est pas encore câblé (T3/T4). GREEN sur les nouveaux tests ; commit `feat(cinema): cinema-loop.js -- boucle maitre, snapshot FFT, beat unique, cadence (non cable)`.

### Task 3: `cinema-bg.js` → renderer passif

**Files:** Modify: `frontend/src/cinema-bg.js`, `frontend/src/cinema.js`, `frontend/tests/core.test.cjs`

**Interfaces:**
- Consumes: `startCinemaLoop/stopCinemaLoop/wakeCinemaLoop/initCinemaLoop` (T2).
- Produces: `export function drawBgFrame(dt, fft, beat)` → bool `needsFrames` ; `export function isArtColorConverged()` ; `stepArtColorLerp(dtN)` prend désormais le facteur dt normalisé.

- [ ] **Step 1 (TDD):** core.test.cjs : (a) scan : **aucun `requestAnimationFrame` dans `cinema-bg.js`** ; (b) scan : `cinema-bg.js` ne contient plus `getByteFrequencyData` ni `document.hasFocus` ; (c) import ESM réel de `stepArtColorLerp` : converge vers la cible ; avec `dtN = 2` converge strictement plus vite qu'avec `dtN = 1` sur une frame (formule `k = 1 - (1-K)^dtN`) ; idempotent une fois convergé. RED.
- [ ] **Step 2: supprimer la boucle** — retirer `_startAmbientAnim`/`_ambientAnimRaf`/`_frameCount`/le check `document.hasFocus()` (cinema-bg.js:287-342). `_updateAmbientGradient` garde tout son setup canvas (dpr, dimensions, `_buildAmbientColors`, snapshots cross-fade) mais remplace chaque `_startAmbientAnim()` final par `wakeCinemaLoop()`. `_renderAmbientStatic` reste (frame unique reduced-motion, appelée par le loop via drawBg une seule fois — plus de branche dédiée ici).
- [ ] **Step 3: `drawBgFrame(dt, fft, beat)`** — nouveau corps public autour de l'ex-`_drawBgFrame` :

```js
const _EPS_BAND = 0.002; // sous ce niveau, les vagues/étoiles sont visuellement statiques

export function drawBgFrame(dt, fft, beat) {
  const canvas = _cinBgCanvas || (_cinBgCanvas = document.getElementById('cinema-bg'));
  if (!canvas) return false;
  if (!_cinBgCtx || _cinBgCtx.canvas !== canvas) { /* getContext + setTransform(dpr) — inchangé */ }
  const dtN = dt / 16.667;
  const isPlaying = _getIsPlaying();
  if (isPlaying) _ambientT += dt;                    // gel pause conservé (Task 14 cycle 1)
  // NOTE T3 : cinema-canvas garde ses signatures ACTUELLES jusqu'à T5 (tableau + lecture
  // analyser interne) — dt/fft/beat ne leur sont câblés qu'en T5. Ici on transmet l'existant.
  if (cinemaBg === 'waves')          drawWavesFrame(_cinBgCtx, _winW, _winH, _cinArtRGBCur, isPlaying);
  else if (cinemaBg === 'starfield') drawStarfieldFrame(_cinBgCtx, _winW, _winH, _cinArtRGBCur, _ambientT);
  else if (cinemaBg !== 'spectrum')  renderAmbientFrame(_ambientT, canvas, _cinBgCtx, cinemaBg, _cinArtRGB, _ambientColors, _winW, _winH);
  // cross-fade snapshot — bloc existant inchangé (globalAlpha + drawImage + libération à p>=1)
  ...
  // T3 conservateur : waves/starfield considérés toujours actifs (raffiné en T5 avec
  // l'epsilon d'énergie getMaxBandEnergy() > _EPS_BAND une fois le FFT partagé câblé).
  return !!_ambientCross || !isArtColorConverged()
      || cinemaBg === 'waves' || cinemaBg === 'starfield';
}
```

  `spectrum` : drawBg ne peint rien (canvas vidé au switch) mais laisse le cross-fade éventuel se terminer. (`_cinArtRGBCur` est encore passé par référence ici — l'encapsulation scalaire arrive en T5 avec le changement de signature côté canvas.)
- [ ] **Step 4: `stepArtColorLerp(dtN)`** — `_LERP_K` devient framerate-indépendant : `const k = 1 - Math.pow(1 - _LERP_K, dtN || 1);` puis LERP avec `k`. Ajouter `export function isArtColorConverged()` (les 3 canaux à <0.5 de la cible).
- [ ] **Step 5: câblage cinema.js** — `openCinema()` : `startCinemaLoop()` (après `applyCinemaBg()`/`startCinemaViz()`) ; `closeCinema()` : `stopCinemaLoop()` (avant `stopAmbientAnim()`). `initCinemaLoop({...})` posé à côté des `initCinemaBgModule(...)` (cinema.js:639) avec `getAnalyser: () => eqAnalyser`, `drawBg: drawBgFrame`, `drawViz: drawVizFrame` (T4). Le handler `visibilitychange` (cinema.js:772-776) devient `wakeCinemaLoop()`. `updateCinema()` appelle `wakeCinemaLoop()` (réveil au changement de piste en pause). Écouter le bus : `on(EVENTS.PLAY_STATE, () => { if (cinemaOpen) wakeCinemaLoop(); })`.
- [ ] **Step 6:** `npm test` GREEN ; smoke rapide `npm run dev` (les 3 fonds ambient/amoled/waves s'affichent) ; commit `refactor(cinema): cinema-bg devient renderer passif -- la boucle vit dans cinema-loop`.

### Task 4: `cinema-viz.js` → renderer passif, beat pochette partagé

**Files:** Modify: `frontend/src/cinema-viz.js`, `frontend/src/cinema.js`, `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: `export function drawVizFrame(dt, fft, beat)` → bool `needsFrames` (true si barres visibles avec énergie > 0, sinon false). `startCinemaViz`/`stopCinemaViz` restent : setup (contexte, buffers, opacity 1) / teardown (timers, opacity 0) — **sans rAF**.

- [ ] **Step 1 (TDD):** core.test.cjs : (a) scan : **aucun `requestAnimationFrame` dans `cinema-viz.js`** ; (b) scan : `cinema-viz.js` ne contient plus `getByteFrequencyData` ni `createBeatDetector` (le beat vient du paramètre) ; (c) scan cluster : `getByteFrequencyData` n'apparaît que dans `cinema-loop.js` parmi les `frontend/src/cinema-*.js`. RED.
- [ ] **Step 2:** transformer `_startViz` : garder la partie setup (analyser/ctx/dpr/specGrad/beat pulse state) dans le scope module ; le corps de `draw()` devient `drawVizFrame(dt, fft, beat)` : consomme `fft` (paramètre, plus de `_vizBuf`), appelle `stepArtColorLerp(dt/16.667)`, applique le pulse pochette si `beat === true` (le bloc artWrap existant de `_detectBeat`, sans la détection), `_drawVolVis(fft, lerpRGB)`, puis barres selon `cinemaBg`. Retourne `false` en modes waves/starfield/amoled (barres non dessinées ; le pulse pochette n'exige pas de frames en pause), sinon `true` si au moins une barre > 0 au dernier rendu (flag maintenu dans la boucle de barres, ex. `v > 0.004`).
- [ ] **Step 3:** `_startViz` sans analyser ne `return` plus silencieusement un état mort : il garde le setup partiel (T9 branchera la relance EQ_READY). `fft === null` dans `drawVizFrame` → clearRect + return false (pas de crash cinéma-avant-lecture).
- [ ] **Step 4:** `npm test` GREEN ; smoke : mode spectrum + beat pochette fonctionnels ; commit `refactor(cinema): cinema-viz devient renderer passif -- beat pochette consomme le beat unique`.

### Task 5: dt propagé dans cinema-canvas (vagues, écume, étoiles)

**Files:** Modify: `frontend/src/cinema-canvas.js`, `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: `drawWavesFrame(ctx, w, h, r, g, b, isPlaying, dtN, fft, beat)` et `drawStarfieldFrame(ctx, w, h, r, g, b, ambientT, dtN, fft, beat)` (signatures consommées par T3). `getMaxBandEnergy()` exporté. `_updateWaveAudio(fft, beat)`/`_updateStarAudio(fft, beat)` consomment le snapshot partagé — plus de `eqAnalyser` importé ni de détecteurs locaux.

- [ ] **Step 1 (TDD):** core.test.cjs : (a) scan : `cinema-canvas.js` n'importe plus `eqAnalyser` ni `createBeatDetector` ; (b) scan : `_wavePhases[l] +=` et `f.life -=` sont multipliés par un facteur dt (regex `\* ?dtN` sur les lignes concernées) ; (c) test pur d'invariance (import réel de `waveY` inchangé + logique dt inline) : intégrer une phase à vitesse `s` pendant 1 pas `dtN=2` ≡ 2 pas `dtN=1` (exactitude linéaire). RED.
- [ ] **Step 2:** `_updateWaveAudio(fft, beat)` : si `fft === null` → branche décroissance existante (×0.95 devient `Math.pow(0.95, dtN)` — cohérence dt) ; sinon consommer `fft` directement (supprimer `_waveBuf`/lecture analyser — `computeBandEnergies(fft, _waveBands, 0.30)`). La branche beat : `if (!prefersReducedMotion() && beat) { ... tween boost + _spawnFoam() }` — supprimer `_waveBeat` et son baseline. Idem `_updateStarAudio(fft, beat)` : consomme `fft`, étoile filante sur `beat` (supprimer `_starBeat`, `_starBassSmooth` reste pour l'EPS de sommeil).
- [ ] **Step 3:** dt : `_wavePhases[l] += (0.005 + l * 0.0018 + band * 0.020) * boostMult * dtN;` (drawWavesFrame reçoit `dtN` et le passe) ; `_drawFoam` : `f.life -= 0.035 * dtN;` (dtN passé en paramètre). Le commentaire « à 60fps » de `_drawFoam` (ligne 156) mis à jour.
- [ ] **Step 4:** signatures : remplacer `cinArtRGBCur` (tableau) par `r, g, b` scalaires dans les deux draw + adapter les DEUX sites d'appel de `drawBgFrame` (cinema-bg.js T3) : `drawWavesFrame(_cinBgCtx, _winW, _winH, _rgbR, _rgbG, _rgbB, isPlaying, dtN, fft, beat)` où `_rgbR/_rgbG/_rgbB` sont des scalaires arrondis exposés par `stepArtColorLerp` (fini le tableau par référence — spec Phase 2). Raffiner le `return` de `drawBgFrame` avec `getMaxBandEnergy() > _EPS_BAND` (remplace le « toujours actif » conservateur de T3). `getMaxBandEnergy()` : boucle simple sur `_waveBandsNorm` + `_starBassSmooth`, exportée. Supprimer le dead state `_waveBeatTw` (write-only : le handle n'est jamais lu — `motionKill(_waveBeatObj)` suffit partout).
- [ ] **Step 5:** `npm test` GREEN ; smoke : vagues à vitesse normale, écume au beat, étoile filante ; commit `refactor(cinema): canvas waves/starfield -- dt normalise, FFT/beat partages, rgb scalaires`.

### Task 6: extraction `cinema-input.js` + 4 bugs d'input

**Files:** Create: `frontend/src/cinema-input.js` (<250 lignes) ; Modify: `frontend/src/cinema.js`, `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: `initCinemaInput(deps)` avec `deps = { getCinemaOpen, closeCinema, updateCinema, toggleCinemaFullscreen, cycleCinemaBg, toggleCinemaRadio, toggleLike, next, prev, audio, setMasterGain, readVol, syncVol }` ; `attachCinemaInput(overlay)` / `detachCinemaInput(overlay)` (appelés par open/close) ; `showCinemaControls()` (ex-`_showControls`, consommé par cinema.js et T24).
- Déménagent : `_onCinKey`, `_onCinemaTrapKey`, `_onCinWheel`, `_onArtDblClick` (+ `_heartTimer`), `_onCinemaMouseMove`, `_onCinemaFocusIn`, `_showControls`/`_hideControls`/`_isKeyboardFocusInOverlay`, `cinemaHideTimer`, `CINEMA_CONTROLS_HIDE_MS`, `HEART_BURST_MS`.

- [ ] **Step 1 (TDD):** core.test.cjs : (a) `cinema-input.js` existe, <250 lignes, exporte `initCinemaInput`, `attachCinemaInput`, `detachCinemaInput`, `showCinemaControls` ; (b) scan : `case 'KeyC'` présent et appelle la fermeture (bug tooltip « Fermer [C / Échap] ») ; (c) scan : `_onCinWheel` contient un early-return `closest('#cinema-queue-panel')` ; (d) scan : le seek ArrowLeft/ArrowRight est gardé par `isFinite(audio.duration)` ; (e) scan cinema.js : les deux callbacks rAF d'ouverture contiennent `if (!cinemaOpen) return` ; (f) scan : `clearTimeout(_heartTimer)` avant réassignation dans le dblclick. Mettre à jour « cinema split » : cap `cinema-input.js` ≤ 250, **cap `cinema.js` abaissé à 650**. RED.
- [ ] **Step 2:** créer `cinema-input.js` (déménagement fidèle) en corrigeant pendant le transfert :
  - `_onCinKey` : ajout `case 'KeyC': e.preventDefault(); deps.closeCinema(); break;` ; seek : `case 'ArrowRight': e.preventDefault(); if (deps.audio && isFinite(deps.audio.duration)) deps.audio.currentTime = Math.min(deps.audio.duration, deps.audio.currentTime + 5); break;` (miroir ArrowLeft avec `isFinite` aussi — pas indispensable pour le clamp à 0 mais symétrique et lisible).
  - `_onCinWheel` : premier statement `if (e.target.closest('#cinema-queue-panel')) return;` (AVANT `preventDefault` — le scroll natif du panneau reprend ses droits).
  - `_onArtDblClick` : `if (_heartTimer) clearTimeout(_heartTimer);` avant `_heartTimer = setTimeout(...)`.
- [ ] **Step 3:** cinema.js : supprimer les fonctions déménagées ; `openCinema` appelle `attachCinemaInput(overlay)` (qui pose mousemove/click/wheel/focusin/keydown×2/dblclick — mêmes options `{ passive:false }` pour wheel) ; `closeCinema` appelle `detachCinemaInput(overlay)`. Gardes rAF d'ouverture : dans `openCinema`, `requestAnimationFrame(() => { if (!cinemaOpen) return; overlay.focus(); })` et le double-rAF `.cin-enter` reçoit la même garde. `initCinemaInput({...})` posé au même endroit que les autres init modules.
- [ ] **Step 4:** `npm test` GREEN ; `wc -l frontend/src/cinema.js` ≤ 650 ; smoke : C ferme, molette hors panneau = volume, molette sur panneau ouvert = scroll ; commit `refactor(cinema): extraction cinema-input.js + fixes touche C, molette/panneau, seek NaN, races rAF`.

### Task 7: cycle player↔cinema cassé + purge

**Files:** Modify: `frontend/src/bus.js`, `frontend/src/player.js:44,1323`, `frontend/src/cinema.js`, `frontend/src/cinema-render.js`, `frontend/src/app.js:20`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** core.test.cjs : (a) scan : `player.js` n'importe plus depuis `./cinema.js` ; (b) scan : `bus.js` contient `CINEMA_PROGRESS` ; (c) scan : cinema.js n'importe plus `rgbToHsl|hslToRgb|boostSat|regionAvg|sampleArtColors` (artcolor), ni `tween`, ni `eqCtx`, ni `set` de store.js (garder `get`) ; (d) scan : `_syncCinVol`/`_readVol` de cinema.js délèguent à `cinema-render.js` (ou ont disparu au profit des exports). RED.
- [ ] **Step 2:** bus.js : `CINEMA_PROGRESS: 'cinema:progress',  // { p, cur, dur }` dans EVENTS. player.js : supprimer l'import ligne 44 ; ligne 1323 → `emit(EVENTS.CINEMA_PROGRESS, { p, cur, dur });` (import `emit, EVENTS` déjà présents dans player.js). cinema.js : `on(EVENTS.CINEMA_PROGRESS, ({ p, cur, dur }) => updateCinemaProgress(p, cur, dur));` à côté du `on(CINEMA_RADIO_TOGGLE)` existant ; `updateCinemaProgress` peut cesser d'être exporté si app.js ne l'utilise pas (vérifier `app.js:20` — purger l'import si mort).
- [ ] **Step 3:** purge cinema.js : imports morts (ligne 20 `eqCtx, eqAnalyser` — garder `eqAnalyser` seulement si `getAnalyser` du T3 le référence ici, sinon le déplacer ; ligne 27 artcolor complète ; `tween` ligne 29 ; `set` ligne 22) + en-tête périmé (lignes 8-9). `cinema-render.js` : exporter `_readVolDom` (renommé `readCinVolDom`) et `_setVolSliders` (renommé `setCinVolSliders`) ; cinema.js les importe (`_readVol`/`_syncCinVol` supprimés, deps de T6 pointent dessus).
- [ ] **Step 4:** `npm test` GREEN ; smoke : progression pbar cinéma fluide pendant la lecture ; commit `refactor(cinema): cycle player<->cinema casse via bus CINEMA_PROGRESS + purge imports morts`.

### Task 8: GATE — smoke matrix manuel de fin de Phase 1

**Files:** aucun (vérification) — corrections éventuelles en commits `fix(cinema):` dédiés.

- [ ] **Step 1:** `npm test` + `node frontend/tests/a11y.test.cjs` + `node frontend/tests/token-source.test.cjs` + `node frontend/tests/theme-palette.test.cjs` — tous verts.
- [ ] **Step 2:** `npm run bench` — pas de régression >5 %.
- [ ] **Step 3 (manuel, utilisateur ou implémenteur avec `npm run dev`):** matrice 5 fonds × états :
  - chaque fond (B) : rendu correct, cross-fade de bascule, réaction musicale ;
  - vitesse des vagues IDENTIQUE fenêtre focalisée (60fps) vs non focalisée (30fps) — le test visuel du dt ;
  - beat : pochette ET fond pulsent sur la même horloge ;
  - pause : après ~2 s, CPU/GPU ≈ 0 (gestionnaire des tâches) ; reprise instantanée au play ; changement de piste en pause → une frame se peint (wake) ;
  - reduced-motion (réglage in-app « Réduites ») : 1 frame statique par fond, rien ne bouge ;
  - resize + changement d'écran : le fond suit ;
  - ouverture cinéma avant toute lecture : pas d'écran noir (vagues statiques), pas d'erreur console.
- [ ] **Step 4:** commit éventuel des fixes ; ne PAS passer en Phase 2 avec un item KO.

---

## Phase 2 — Robustesse

### Task 9: relance du viz à l'init de l'EQ (bug « écran mort »)

**Files:** Modify: `frontend/src/bus.js`, `frontend/src/eq.js:140-…`, `frontend/src/cinema.js`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) `bus.js` contient `EQ_READY` ; (b) `eq.js` émet `EQ_READY` dans `initEQ()` (après la construction du graphe, avant le return) ; (c) `cinema.js` contient `on(EVENTS.EQ_READY` avec relance conditionnée à `cinemaOpen`. RED.
- [ ] **Step 2:** bus.js : `EQ_READY: 'eq:ready',  // {} — graphe EQ construit (analyser disponible)`. eq.js : `emit(EVENTS.EQ_READY);` en fin d'`initEQ()` (imports bus à ajouter si absents). cinema.js : `on(EVENTS.EQ_READY, () => { if (cinemaOpen) { startCinemaViz(); wakeCinemaLoop(); } });`.
- [ ] **Step 3:** `npm test` GREEN ; smoke : ouvrir le cinéma AVANT toute lecture, lancer une piste → spectre + beat vivants sans réouverture ; commit `fix(cinema): relance viz+loop a l'init EQ -- plus d'ecran mort si cinema ouvert avant la 1re lecture`.

### Task 10: gardes duration non finie (`fmt`, `formatSeekTime(0)`)

**Files:** Modify: `frontend/src/utils.js:30-32`, `frontend/src/cinema-seek.js:53-55`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** imports ESM réels : (a) `fmt(Infinity) === '–:––'` (ou le fallback existant de fmt pour NaN — parité exacte), `fmt(NaN)` inchangé, `fmt(61) === '1:01'` ; (b) `formatSeekTime(0) === '0:00'`, `formatSeekTime(Infinity)` → fallback, `formatSeekTime(59.9) === '0:59'`. RED.
- [ ] **Step 2:** utils.js `fmt()` : remplacer le guard `isNaN(s)` par `!isFinite(s)`. cinema-seek.js `formatSeekTime` : traiter `s === 0` comme valide (`0:00`) — seul `!isFinite` ou négatif retombe sur `'–:––'` ; corriger le commentaire « parité EXACTE avec fmt() » (désormais vrai pour les valeurs finies, 0 inclus).
- [ ] **Step 3:** GREEN ; commit `fix(cinema): duration Infinity/0 -- fmt isFinite + formatSeekTime(0) affiche 0:00`.

### Task 11: DPR dynamique + spectrum dans le resize handler

**Files:** Modify: `frontend/src/cinema-viz.js`, `frontend/src/cinema.js:112-119`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) le check resize de `drawVizFrame` compare aussi `devicePixelRatio` (regex `dpr !== ` ou équivalent documenté) — idem `_drawVolVis` ; (b) la condition du resize handler de cinema.js inclut `spectrum`. RED.
- [ ] **Step 2:** cinema-viz.js : `dpr` cesse d'être un `const` de setup — dans le check : `const dprNow = window.devicePixelRatio || 1; if (w !== cw || h !== ch || dprNow !== cdpr) { ... cdpr = dprNow; }` (backing store + setTransform recalés). Pareil dans `_drawVolVis`.
- [ ] **Step 3:** cinema.js resize handler : la condition liste tous les modes → la simplifier en `applyCinemaBg()` inconditionnel (tous les modes ont désormais besoin du recalage, spectrum inclus pour le fade/clear).
- [ ] **Step 4:** GREEN ; commit `fix(cinema): DPR dynamique (multi-ecrans) + spectrum couvert par le resize handler`.

### Task 12: ambient post-décodage, snapshot fermé, foam reset, queue breakpoint

**Files:** Modify: `frontend/src/cinema-render.js:180-…`, `frontend/src/cinema.js`, `frontend/src/cinema-bg.js:178-191`, `frontend/src/cinema-canvas.js:493-504`, `frontend/src/cinema-queue.js`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) le `.then()` de `img.decode()` (cinema-render.js `decodeArtImage`) déclenche un callback qui ré-invoque `updateAmbientGradient` quand `cinemaBg` ∈ {ambient, amoled} ; (b) `applyCinemaBg`/`_snapshotModeCanvas` saute le snapshot quand `!_getCinemaOpen()` ; (c) `killCanvasTweens` remet `life = 0` sur `_foamPool` ; (d) `cinema-queue.js` écoute `resize` (ou matchMedia) et ferme le panneau si le breakpoint le masque. RED.
- [ ] **Step 2:** cinema-render.js : `decodeArtImage` accepte un callback optionnel `onDecoded` ; cinema.js (`_cinSwapIn` chemin) le fournit : `() => { if ((cinemaBg === 'ambient' || cinemaBg === 'amoled')) updateAmbientGradient(); }` — le gradient est recalculé sur la vraie image (fini le fallback mono-couleur persistant).
- [ ] **Step 3:** cinema-bg.js : première ligne de `_snapshotModeCanvas` → `if (!_getCinemaOpen() || prefersReducedMotion() || ...) return null;` (plus de canvas ~8 Mo retenu quand on change le fond depuis les réglages, cinéma fermé).
- [ ] **Step 4:** cinema-canvas.js `killCanvasTweens()` : ajouter `for (const f of _foamPool) f.life = 0;` (écume fantôme à la réouverture).
- [ ] **Step 5:** cinema-queue.js : listener `resize` debouncé (200 ms) : si `_open` et `!panel.offsetParent` (masqué par le breakpoint), appeler `_closePanel()` (focus rendu au trigger seulement s'il est visible).
- [ ] **Step 6:** GREEN ; commit `fix(cinema): ambient post-decode, snapshot cinema ferme, foam reset, queue fermee au breakpoint`.

---

## Phase 3 — Performance

### Task 13: cap DPR du fond `#cinema-bg`

**Files:** Modify: `frontend/src/cinema-bg.js:344-416`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scan : `_updateAmbientGradient` et `_renderAmbientStatic` calculent le backing store avec `Math.min(window.devicePixelRatio || 1, 1)` via une constante nommée `BG_DPR_CAP = 1` documentée. RED.
- [ ] **Step 2:** `const BG_DPR_CAP = 1; // fond basse fréquence : plein DPR = 2-4× de fill-rate GPU pour rien (spec §3 Phase 3)` ; `const dpr = Math.min(window.devicePixelRatio || 1, BG_DPR_CAP);` dans les deux fonctions (le CSS `width:100%;height:100%` upscale). **Ne pas toucher** `#cinema-viz` (barres nettes) ni le vol-vis.
- [ ] **Step 3:** GREEN ; smoke visuel HiDPI si dispo (fond sans marches visibles) ; `npm run bench` ; commit `perf(cinema): backing store du fond cape a 1x DPR -- gradients/vagues basse frequence`.

### Task 14: glow pochette compositor-only

**Files:** Modify: `frontend/src/style.css:4867-4874` (+ bloc `.cinema-art-wrap`), `frontend/src/design-system.css` (si token utile), `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scan style.css : le keyframe `cinema-art-glow` n'anime plus `box-shadow` (regex : le bloc `@keyframes cinema-art-glow` ne contient pas `box-shadow`). RED.
- [ ] **Step 2:** poser le glow « haut » statique sur un pseudo-élément et animer son opacity :

```css
.cinema-art-wrap::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: 0 0 90px 18px rgba(var(--cin-rgb), .30); /* état "hi" figé, raster unique */
  opacity: .35; pointer-events: none;
  animation: cinema-art-glow var(--dur-cin-glow) ease-in-out infinite;
  will-change: opacity;
}
@keyframes cinema-art-glow { 50% { opacity: 1; } } /* opacity-only — compositor */
```

  Reprendre les valeurs d'ombre EXACTES de l'actuel état haut du keyframe (lire les deux stops existants avant suppression) ; retirer l'animation `box-shadow` de `.cinema-art-wrap`. Vérifier l'interaction avec `.beat` (box-shadow ponctuel — conservé) et `is-paused` (`animation-play-state: paused` doit couvrir le ::after).
- [ ] **Step 3:** GREEN + smoke visuel (respiration du glow inchangée) ; commit `perf(cinema): glow pochette en ::after opacity-only -- plus de re-raster box-shadow continu`.

### Task 15: allocations résiduelles + CSS orphelines + backdrop corners + vol-vis gating

**Files:** Modify: `frontend/src/cinema-viz.js`, `frontend/src/style.css:4753-4757,5059-5061,4971`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** (a) scan cinema-viz.js : aucun littéral `[rr, rr, 0, 0]`/`[3, 3, 0, 0]`/`[0, 0, rr, rr]` dans les corps de `_drawSpectrumBars`/`_drawStandardBars` (arrays module-scope mutés, pattern viz.js:70-71) ; (b) scan : `Math.pow(2,` absent des boucles de barres (LUT `Int16Array` construite hors boucle, invalidée sur `frequencyBinCount`) ; (c) scan style.css : `cinema-art-breathe` et `cinema-ambient-breathe` scopées `#cinema-overlay.active` ; (d) scan : `.cinema-corner-btn` sans `backdrop-filter` ; (e) scan cinema-viz.js : `_drawVolVis` early-return quand l'overlay n'a pas `.ctrl-on` + ref canvas cachée module-scope (plus de `getElementById` par frame). RED.
- [ ] **Step 2:** cinema-viz.js : 3 LUT module-scope (`_binLutSpec`, `_binLutStd`, `_binLutVol` — `Int16Array(barCount)` remplies par la boucle `_monotonicBin` actuelle, clé d'invalidation `totalBins`) ; 4 arrays de radii module-scope mutés avant les boucles. `_drawVolVis` : `let _volVisCanvas = null` (cache, reset dans `_stopViz`), et premier check `if (!_ctrlOnCache()) return;` — helper qui lit `overlay.classList.contains('ctrl-on')` sur une ref overlay cachée (une lecture classList par frame est acceptable ; pas de MutationObserver).
- [ ] **Step 3:** style.css : préfixer les deux règles d'animation par `#cinema-overlay.active` ; `.cinema-corner-btn` : retirer `backdrop-filter`, passer le fond à `var(--cin-surface-hover)` (déjà token).
- [ ] **Step 4:** GREEN ; bench ; commit `perf(cinema): LUT bins + radii preallocues, animations scopees .active, corners sans backdrop-filter, vol-vis gated ctrl-on`.

---

## Phase 4 — Polish visuel premium

### Task 16: compositing additif `lighter`

**Files:** Modify: `frontend/src/cinema-canvas.js` (crêtes :245-250, écume :157-173, halos étoiles :419-426, traînées :442-458), `frontend/src/cinema-viz.js:146-159` (glow spectrum), `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scan appairé : chaque occurrence de `globalCompositeOperation = 'lighter'` dans cinema-canvas.js/cinema-viz.js est suivie (même fonction) d'une restauration `'source-over'` — compter les occurrences des deux strings et asserter l'égalité par fichier. RED (aucune occurrence).
- [ ] **Step 2:** cinema-canvas.js — pattern par section :

```js
ctx.globalCompositeOperation = 'lighter'; // la lumière s'ADDITIONNE (crêtes qui se croisent, écume sur crête)
// … dessin des crêtes (boucle stroke) / écume / halos / traînées …
ctx.globalCompositeOperation = 'source-over';
```

  Appliquer à : (a) la passe crête de `_drawWaveLayer` — ATTENTION : fill des couches reste en source-over, seule la passe stroke passe en lighter → restructurer `drawWavesFrame` pour dessiner tous les fills (boucle 1) puis toutes les crêtes en lighter (boucle 2) — les `_waveY` par couche étant recalculés, stocker les y de crête n'est PAS nécessaire si on retrace (coût acceptable) ; alternative retenue : garder l'ordre par couche mais basculer lighter/source-over autour du seul stroke (2 changements d'état par couche — negligible) ; (b) `_drawFoam` entier ; (c) le halo `bri > 0.55` des étoiles + les traînées/têtes d'étoiles filantes ; (d) cinema-viz.js : le bloc glow `v > 0.25` de `_drawSpectrumBars`.
- [ ] **Step 3:** GREEN ; smoke visuel : croisements de crêtes plus lumineux, glow spectrum émissif ; commit `feat(cinema): compositing additif lighter -- cretes, ecume, halos, trainees, glow spectrum`.

### Task 17: grain anti-banding partagé waves/starfield

**Files:** Modify: `frontend/src/ambientRenderer.js:101-123`, `frontend/src/cinema-canvas.js`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) `ambientRenderer.js` exporte `drawNoiseOverlay(ctx, W, H)` (le grain existant extrait) ; (b) `drawWavesFrame` et `drawStarfieldFrame` l'appellent en fin de frame. RED.
- [ ] **Step 2:** extraire le bloc noise existant (tile pré-générée + `drawImage` en blend) en `export function drawNoiseOverlay(ctx, W, H)` — le chemin ambient l'appelle comme avant (zéro changement de rendu ambient). cinema-canvas.js : import + appel en dernière ligne des deux draw (après écume / étoiles filantes), même alpha/blend que l'ambient (cohérence de texture entre les 5 fonds).
- [ ] **Step 3:** GREEN ; smoke : plus de bandes visibles sur le halo waves ; bench (1 drawImage/frame ajouté — attendu <1 %) ; commit `feat(cinema): grain anti-banding partage sur waves et starfield`.

### Task 18: halo dé-clippé + reflet d'horizon vivant + phases angle d'or

**Files:** Modify: `frontend/src/cinema-canvas.js:37,290,308-310`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** (a) test pur inline de la nouvelle formule d'alpha du halo `a = 0.35 + 0.45*e + 0.20*bv` : bornée ≤ 1 pour e,bv ∈ [0,1], strictement croissante en e sur [0,1] à bv fixe (le beat reste TOUJOURS visible : `a(e,1) - a(e,0) === 0.20` pour tout e) ; (b) scan : `_wavePhases` initialisées à `l * 2.399` (angle d'or) et re-seedées dans `killCanvasTweens` ; (c) scan : le fillRect du reflet d'horizon est précédé d'un `globalAlpha` dérivé de `_waveBandsNorm[0]`. RED.
- [ ] **Step 2:** halo (drawWavesFrame:290) : `ctx.globalAlpha = 0.35 + 0.45 * _waveEnergy + 0.20 * _waveBeatObj.v;` (plus de `min(1, …)` saturé — la somme max est exactement 1.0).
- [ ] **Step 3:** phases : à la déclaration `const _wavePhases = new Float32Array(_WAVE_LAYERS);` ajouter une init `for (let l = 0; l < _WAVE_LAYERS; l++) _wavePhases[l] = l * 2.399;` (fonction `_seedWavePhases()` appelée au module-load ET dans `killCanvasTweens` — chaque réouverture du mode repart déphasée, fini l'effet calques clonés).
- [ ] **Step 4:** reflet d'horizon : `ctx.globalAlpha = 0.7 + 0.3 * _waveBandsNorm[0];` autour du fillRect existant (restaurer 1 après), et passer ce fillRect en `lighter` (l'inclure dans le comptage appairé de T16).
- [ ] **Step 5:** GREEN ; commit `feat(cinema): halo waves de-clippe, reflet d'horizon module par les basses, phases a l'angle d'or`.

### Task 19: starfield premium — traînée en dégradé, double sinus, jitter stratifié, expo.out

**Files:** Modify: `frontend/src/cinema-canvas.js:87-97,401-404,442-458,467-486`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) `_launchShootingStar` crée un `createLinearGradient` (traînée — hors hot path, au launch) stocké sur le slot pool ; (b) le scintillement contient DEUX termes `Math.sin` (non commensurables) ; (c) `initStarfield` place les étoiles par jitter sur grille (regex : présence d'une boucle `cols`/`rows` ou d'un commentaire `stratifié`) ; (d) les tweens d'étoile filante utilisent `expo.out` (via `eases` de motion.js — vérifier le nom exact exporté, ex. `eases.EXPO` ; s'il n'existe pas, l'ajouter à motion.js `eases`). RED.
- [ ] **Step 2:** scintillement (ligne 402) :

```js
const ph = _starPhase[i] + t * _starSpd[i] * 5.5;
const twk = 0.4 + 0.6 * (0.5 + 0.5 * (0.7 * Math.sin(ph) + 0.3 * Math.sin(2.63 * ph + 1.7)));
const bri = _starBri[i] * twk * (1 + hiEnergy * 0.7 * (0.3 + 0.7 * _starBri[i])); // réaction par étoile
```

- [ ] **Step 3:** `initStarfield` stratifié : grille `15×12` (=180), `_starX[i] = (col + Math.random()) / 15`, `_starY[i] = (row + Math.random()) / 12` — plus d'amas/trous.
- [ ] **Step 4:** traînée : au launch, construire `st.trailGrad = null` invalidé — le gradient dépend de la position courante, donc à CHAQUE frame il faudrait le recréer → à la place, dessiner la traînée en 3 segments de fillRect à alpha décroissant (0.5 / 0.25 / 0.10 sur les tiers de `trailLen`), tête en `lighter` avec micro-halo (`arc` rayon 4, alpha `st.alpha * 0.35`). Zéro allocation, effet filé.
- [ ] **Step 5:** easing : tween de `_launchShootingStar` et decay `_waveBeatObj` → `eases.EXPO` (`'expo.out'` GSAP ; ajouter `EXPO: 'expo.out'` à l'objet `eases` de motion.js si absent).
- [ ] **Step 6:** GREEN ; smoke starfield ; commit `feat(cinema): starfield premium -- filé d'etoile, scintillement organique, distribution stratifiee, decay expo`.

### Task 20: écume crédible

**Files:** Modify: `frontend/src/cinema-canvas.js:144-173`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans/tests : (a) `_spawnFoam` échantillonne `waveY` (recherche des minima — crêtes) au lieu d'un `nx` purement aléatoire ; (b) `f.life` initialisée dans [0.85, 1.0] (naissances étalées) ; (c) l'écume n'est plus `#fff` dur : elle utilise la couleur de crête de sa couche (`_waveCrestStrokes[f.layer]` déjà caché) — scan : `_drawFoam` ne contient plus `'#fff'`. RED.
- [ ] **Step 2:** `_spawnFoam` : pour chacun des 4 glints, tirer 3 candidats `nx` aléatoires, garder celui dont `waveY(nx, ph, freq, amp)` est minimal (crête locale — 9 appels sin au beat, hors hot path) ; `f.life = 0.85 + Math.random() * 0.15;`.
- [ ] **Step 3:** `_drawFoam` : `ctx.fillStyle = _waveCrestStrokes[f.layer]` par glint (string cachée — pas d'allocation) ; le bloc reste sous `lighter` (T16).
- [ ] **Step 4:** GREEN ; commit `feat(cinema): ecume sur les cretes reelles, naissances etalees, teintee par couche`.

### Task 21: calibration luminance, ambient/amoled audio-réactifs, mode light, finitions

**Files:** Modify: `frontend/src/ambientRenderer.js`, `frontend/src/cinema-bg.js`, `frontend/src/cinema-viz.js:146-152`, `frontend/src/style.css:4718-4723,4817,5419-5431`, `frontend/src/design-system.css`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) `renderAmbientFrame` accepte un paramètre `bassEnergy` (0-1) et l'utilise (breathe/alpha) ; (b) style.css : les overrides texte light du cinéma sont scopés `:not(.bg-waves):not(.bg-starfield):not(.bg-amoled)` ; (c) la transition 800 ms de `.cinema-viz` est tokenisée (`var(--dur-cin-reveal)` déclaré dans design-system.css) ; (d) la vignette canvas d'ambientRenderer est supprimée (scan : plus de bloc vignette dans le fichier) ; (e) cinema-viz : le glow spectrum n'utilise plus `Math.round(v * 14) / 100`. RED.
- [ ] **Step 2:** ambientRenderer.js : signature `renderAmbientFrame(t, canvas, ctx, mode, colorStr, ambientColors, W, H, bassEnergy = 0)` — `breathR` du lobe g1 : `* (1 + bassEnergy * 0.01)` ; alpha des lobes : `* (1 + bassEnergy * 0.10)` (via globalAlpha, gradients inchangés — zéro invalidation) ; halo amoled : alpha de base 0.09 → **0.14** ; stop-0 du g1 ambient réduit à 85 % de son intensité actuelle (calibration — spec Phase 4). cinema-bg.js `drawBgFrame` passe `bassEnergy` (exposer une petite EMA `getBassEnergySmoothed()` depuis cinema-canvas, ou calculer localement depuis `fft` avec `computeBassEnergy` importé de cinema-loop — retenir CE dernier : 3 lignes, pas de nouveau couplage).
- [ ] **Step 3:** vignette : supprimer le bloc vignette canvas d'ambientRenderer (la CSS `::before` style.css:4718-4723 uniformise les 5 fonds).
- [ ] **Step 4:** mode light : scoper les overrides (style.css:5419-5431) — le texte reste clair sur les 3 fonds à canvas sombre.
- [ ] **Step 5:** finitions : token `--dur-cin-reveal: 800ms` (design-system.css, section Cinema) consommé par `.cinema-viz` ; glow spectrum : `ctx.globalAlpha = v * 0.14;` (suppression de la quantisation) ; constantes magiques de cinema-canvas nommées en tête (`_FOAM_DECAY = 0.035`, `_CREST_LIGHTEN = 70`, `_STAR_LIGHTEN = 90`, `_STAR_TINT_R = 0.045`, `_STAR_TINT_B = 0.10` — remplacer les littéraux).
- [ ] **Step 6:** GREEN + token-source + theme-palette ; smoke : cycle B sans saut d'exposition, ambient respire avec la musique ; commit `feat(cinema): luminance calibree, ambient/amoled audio-reactifs, fix mode light, finitions tokens`.

---

## Phase 5 — UX & a11y

### Task 22: cibles 24px + contraste timecodes

**Files:** Modify: `frontend/src/style.css:5229-5231,5244-5247,5389-5397`, `frontend/tests/a11y.test.cjs`, `frontend/tests/theme-palette.test.cjs`

- [ ] **Step 1 (TDD):** (a) a11y.test.cjs : `.cinema-vol-slider` (ou son wrapper) déclare `min-height: var(--target-min)` ; la hit-area pbar utilise `inset: -10px 0` ; (b) theme-palette.test.cjs : `.cinema-time` n'utilise plus d'alpha < 0.62 (verrou : parser la règle, asserter la valeur ou le token `--cin-text-mid`). RED.
- [ ] **Step 2:** style.css : `.cinema-vol-slider { min-height: var(--target-min); background: linear-gradient(...) center / 100% var(--track-h) no-repeat; }` — l'input garde sa piste visuelle de 3px dessinée au centre d'une zone cliquable de 24px (vérifier le rendu du thumb WebKit — `::-webkit-slider-runnable-track` si la piste native doit rester) ; pbar : `inset: -10px 0` ; `.cinema-time { color: var(--cin-text-mid); }`.
- [ ] **Step 3:** suites GREEN ; commit `fix(cinema): slider volume cible 24px, pbar 24px, timecodes contraste conforme`.

### Task 23: ordre de focus, ARIA pbar, clavier panneau queue

**Files:** Modify: `frontend/index.html:1336-1471`, `frontend/src/cinema-seek.js:194-208`, `frontend/src/cinema-queue.js:194-246`, `frontend/tests/a11y.test.cjs`

- [ ] **Step 1 (TDD):** a11y.test.cjs : (a) ordre DOM dans index.html : `#cinema-controls` apparaît AVANT `#cinema-pbar`, qui apparaît AVANT `#cinema-next`, qui apparaît AVANT les `.cinema-corner-btn` (comparaison d'index de sous-chaînes) ; (b) scan cinema-seek.js : `_onKeyDown` gère `ArrowUp/ArrowDown` (±5 s) avec `stopPropagation` ; (c) scan cinema-queue.js : `_onPanelKey` stoppe `ArrowLeft/ArrowRight` et gère `Home`/`End`. RED.
- [ ] **Step 2:** index.html : réordonner les blocs de l'overlay (positionnement absolu — zéro impact visuel ; play/pause devient le 1er Tab). Vérifier après coup le filtre de visibilité du trap (cinema-input.js) — l'ordre des focusables suit le DOM automatiquement.
- [ ] **Step 3:** cinema-seek.js : dans le handler clavier de la pbar, `case 'ArrowUp': case 'ArrowRight': → +5 s`, `case 'ArrowDown': case 'ArrowLeft': → −5 s` (pattern APG slider), chaque case : `e.preventDefault(); e.stopPropagation();` (l'overlay ne voit plus ces touches quand la pbar a le focus — le volume global ↑/↓ reste actif partout ailleurs).
- [ ] **Step 4:** cinema-queue.js : `_onPanelKey` — ajouter `case 'ArrowLeft': case 'ArrowRight': e.stopPropagation(); break;` (pas de seek accidentel) et `Home`/`End` → focus première/dernière rangée. Auto-hide : tant que le panneau est `_open`, `showCinemaControls()` réarmé (exposer un hook `isQueuePanelOpen()` consommé par le timer de `cinema-input.js` — même pattern que le check focus clavier).
- [ ] **Step 5:** suites GREEN ; commit `fix(cinema): ordre de focus logique, pattern ARIA pbar complet, clavier panneau queue`.

### Task 24: interactions héros — clic pochette, morph play/pause, burst unifié

**Files:** Modify: `frontend/src/cinema-input.js`, `frontend/src/cinema.js` (`_syncCinButtons`), `frontend/src/cinema-render.js`, `frontend/src/style.css`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans : (a) cinema-input.js : handler `click` sur `.cinema-art-wrap` qui toggle play/pause (avec garde anti-dblclick : timer ~250 ms annulé par le dblclick) ; (b) cinema.js/`_syncCinButtons` ou le handler play appelle `playPausePress('#cinema-play')` (import motion.js) ; (c) cinema-render.js : le burst cœur est une fonction exportée `spawnHeartBurst()` appelée par le dblclick ET par le chemin like du bouton `#cinema-lk`. RED.
- [ ] **Step 2:** clic pochette : dans `attachCinemaInput`, listener `click` sur `.cinema-art-wrap` — `_artClickTimer = setTimeout(() => { audio.paused ? audio.play().catch(()=>{}) : audio.pause(); updateCinema(); }, 250)` ; le `dblclick` existant fait `clearTimeout(_artClickTimer)` avant son traitement (pattern standard single-vs-double). Timer clearé dans `detachCinemaInput`.
- [ ] **Step 3:** morph : CSS — les deux SVG `#cinema-ico-play`/`#cinema-ico-pause` passent de `display:none` sec à un cross-fade `opacity var(--dur-cin-swap-out) + scale(.8→1)` (superposés en grid/absolute) ; JS `_syncCinButtons` : toggle une classe au lieu de `style.display`. Au clic sur `#cinema-play` (et au clic pochette), appeler `playPausePress('#cinema-play')` (spring existant de motion.js:264-268 — vérifier la signature exacte avant usage).
- [ ] **Step 4:** burst unifié : extraire le bloc cœur de `_onArtDblClick` en `spawnHeartBurst(overlay, x, y)` dans cinema-render.js (le timer reste géré par l'appelant input) ; le handler du bouton like cinéma (là où `#cinema-lk` est câblé — chercher son listener) l'appelle quand le like passe à true, centré sur le bouton.
- [ ] **Step 5:** GREEN ; smoke : clic pochette = pause avec spring, dblclick = like + cœur, bouton like = cœur ; commit `feat(cinema): clic pochette play/pause, morph d'icone avec spring, coeur-burst unifie`.

### Task 25: découvrabilité + molette feedback + i18n

**Files:** Modify: `frontend/src/cinema-input.js`, `frontend/index.html:1356,1393,1450`, `frontend/src/cinema-bg.js:224-231`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`, `frontend/src/cinema.js`, `frontend/tests/a11y.test.cjs`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** (a) scan cinema-input.js : `_onCinKey` gère `KeyS` (shuffle), `KeyL` → like (l'alias next retiré), et `?`/`Slash` → aide raccourcis ; (b) scan : `_onCinWheel` appelle `showCinemaControls()` et écrit le volume dans `#cinema-announce` ; (c) core : clés i18n `cinema_next_label`, `cinema_hint_shortcuts` présentes fr ET en ; scan index.html : `data-i18n="cinema_next_label"` posé, `title="Volume"` hardcodé supprimé, `data-i18n-title="t_cinema_bg"` retiré de `#cinema-bg-btn` ; (d) scan cinema-bg.js : `updateCinemaBgBtn` pose aussi `aria-label` avec le mode courant ; scan : `applyLang` (i18n.js ou app.js — localiser l'appelant) rappelle `updateCinemaBgBtn`. RED.
- [ ] **Step 2:** cinema-input.js : `case 'KeyS': e.preventDefault(); /* toggle shuffle via deps.toggleShuffle */ break;` (ajouter `toggleShuffle` aux deps, fourni par cinema.js depuis son import player/store existant — vérifier où le shuffle est togglé aujourd'hui, probablement `set('shuffle', …)` + saveCfg via un module existant ; utiliser CE chemin) ; `case 'KeyL':` → `deps.toggleLike()` + burst (T24) — retirer `KeyL` du case next ; aide : `if (e.key === '?') { deps.toggleShortcuts(); }` (import/dep du `toggleShortcuts` de shortcuts.js — passer par deps pour éviter l'import cross-feature direct).
- [ ] **Step 3:** molette : `showCinemaControls();` en fin de `_onCinWheel` + `const a = document.getElementById('cinema-announce'); if (a) a.textContent = i18n('cinema_vol_announce', Math.round(v * 100));` — clé fr « Volume {0} % » / en "Volume {0}%" (vérifier la signature exacte de `i18n()` pour les arguments — imiter `t_cinema_bg`).
- [ ] **Step 4:** i18n : `cinema_next_label` (fr « Suivant », en "Up next") + `data-i18n` ; retrait des deux attributs cassés ; `updateCinemaBgBtn` : `btn.setAttribute('aria-label', i18n('t_cinema_bg', label));` ; rappel depuis `applyLang`.
- [ ] **Step 5:** hint raccourcis : petit `<div id="cinema-kb-hint" class="cinema-kb-hint" aria-hidden="true">? — raccourcis</div>` (texte via i18n `cinema_hint_shortcuts`), affiché par la chorégraphie d'ouverture (dernier slot de la timeline GSAP, autoAlpha 0→1) puis fade-out après 4 s (tween autoAlpha→0, killé au close). Inerte sous reduced-motion (motionSet direct sans hint, ou hint jamais montré — retenir : jamais montré).
- [ ] **Step 6:** suites GREEN ; commit `feat(cinema): raccourcis S/L/?, hint decouvrable, molette avec feedback, i18n Suivant + bg-btn`.

### Task 26: fermeture chorégraphiée symétrique

**Files:** Modify: `frontend/src/cinema.js:377-429`, `frontend/src/design-system.css`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scan : `closeCinema` passe par une mini-timeline de sortie (référence `_closeTl` ou tween `art` scale/fade) gated `prefersReducedMotion()` ; le retrait de la classe `.active` est différé à la fin de l'animation (~180 ms) MAIS tous les nettoyages d'état (listeners, timers, loop) restent synchrones. RED.
- [ ] **Step 2:** structure : `closeCinema()` fait TOUT le teardown actuel synchrone (état, listeners, loop, viz) sauf le retrait visuel ; puis :

```js
const doHide = () => { overlay.classList.remove('active', 'ctrl-on'); /* focus restore existant ici */ };
if (prefersReducedMotion()) { doHide(); }
else {
  _closeTl = timeline({ onComplete: doHide })
    .to('.cinema-art-wrap', { scale: 0.94, autoAlpha: 0, duration: 0.18, ease: eases.PREMIUM }, 0)
    .to('#cinema-info, #cinema-controls', { autoAlpha: 0, duration: 0.14 }, 0);
}
```

  `_closeTl` killée + `doHide()` forcé si `openCinema()` arrive pendant la sortie (garde en tête d'openCinema). Le focus restore reste DANS `doHide` (pas avant — l'overlay doit être parti). Nouveau token éventuel `--dur-cin-close: 180ms` si une transition CSS est préférée à GSAP pour l'overlay lui-même (choix implémenteur, documenter).
- [ ] **Step 3:** GREEN ; smoke : Échap = sortie douce, réouverture immédiate pendant la sortie OK ; commit `feat(cinema): fermeture choregraphiee symetrique de l'ouverture`.

---

## Phase 6 — Tests & garde-fous (filet final)

### Task 27: imports ESM réels + garde-fous structurels + caps

**Files:** Modify: `frontend/tests/core.test.cjs`, `frontend/src/cinema-waves.js:97-107`, `frontend/src/cinema-render.js:191`

- [ ] **Step 1:** remplacer les copies inline par des imports réels : (a) `createBeatDetector` — test d'intégration : 42 samples calmes puis 1 pic ×2 → beat ; cooldown respecté ; warm-up sans faux positif ; (b) `_parseColorToRGB` (l'exporter depuis cinema-bg.js) : rgb(...), #hex, transparent → null ; (c) `stepArtColorLerp`/`isArtColorConverged` déjà couverts (T3) — compléter le cas snap ; (d) `_monotonicBin` (l'exporter depuis cinema-viz.js) : strictement croissant, cap à maxBin, rawBin < lastBin+1 → lastBin+1.
- [ ] **Step 2:** garde-fous structurels consolidés (section « cinema loop guards ») : un seul `getByteFrequencyData` dans `cinema-*.js` ; zéro `requestAnimationFrame` dans cinema-bg.js/cinema-viz.js/cinema-canvas.js ; comptage appairé `'lighter'`/`'source-over'` (T16) ; `* dtN` présent sur phases/foam/lerp.
- [ ] **Step 3:** section « cinema split » à jour : `cinema-loop.js` ≤ 200, `cinema-input.js` ≤ 250, `cinema.js` ≤ 650, surface d'exports des nouveaux modules.
- [ ] **Step 4:** hygiène doc : déplacer le JSDoc orphelin de `computeBandEnergies` (cinema-waves.js:97-107) au-dessus de la bonne fonction ; commenter la comparaison `img.src === art` de `decodeArtImage` (absolutisation d'URL — OK pour data:/blob:, casserait sur chemin relatif).
- [ ] **Step 5:** suites complètes + bench + commit `test(cinema): imports ESM reels, garde-fous loop/lighter/dt, caps cinema split`.

---

## Vérification finale (après toutes les tâches)

- `npm test` + `node frontend/tests/a11y.test.cjs` + `node frontend/tests/token-source.test.cjs` + `node frontend/tests/theme-palette.test.cjs` — verts
- `npm run bench` — pas de régression >5 %
- Revue whole-branch (superpowers:requesting-code-review) sur la branche du cycle
- Smoke manuel final (matrice T8 rejouée + les nouveautés : clic pochette, morph, C, ?, molette sur panneau, fermeture douce, mode light sur les 5 fonds)
