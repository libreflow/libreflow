# Cinema.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/src/cinema.js` (1453 lines) into three focused modules — `cinema-viz.js` (visualiseur canvas), `cinema-bg.js` (gestion du fond + animation ambient), et un `cinema.js` résiduel — tout en préservant l'API publique à 100% sans modifier aucun consommateur.

**Architecture:** Deux nouveaux modules recevant l'état via callback (`getCinemaState`) pour éviter toute dépendance circulaire. `cinema.js` re-exporte les symboles déplacés pour que `app.js`, `handlers.js`, `player.js`, `playerbar.js`, `radio.js`, `settings.js`, `shortcuts.js` restent inchangés. Les tests existants (383/383) doivent rester verts à chaque commit.

**Tech Stack:** Vanilla ESM JS, Canvas 2D, GSAP (motion.js), `npm test` (core.test.cjs).

---

## File Map

| Fichier | Action | Responsabilité après le split |
|---|---|---|
| `frontend/src/cinema-viz.js` | **Créer** | Visualiseur canvas : liquid waves, aurora, barres, beat detector, RAF loop |
| `frontend/src/cinema-bg.js` | **Créer** | Modes BG, état `cinemaBg`, animation ambient RAF, crossfade pochette → fond |
| `frontend/src/cinema.js` | **Modifier** | Overlay, open/close, rendu piste, clock, fullscreen, radio — re-exporte les symboles déplacés |
| `frontend/tests/core.test.cjs` | **Modifier** | Ajouter section statique cinema-split (comptage lignes + exports) |

**Modules consommateurs — aucun changement d'import :**
`app.js`, `handlers.js`, `player.js`, `playerbar.js`, `radio.js`, `settings.js`, `shortcuts.js`

---

## Préambule : interface des callbacks

Les deux nouveaux modules reçoivent l'état via des callbacks pour éviter les imports circulaires.

**`cinema-viz.js`** reçoit :
```js
getCinemaState: () => {
  cinemaOpen: boolean,
  cinemaBg: string,          // 'ambient'|'liquid'|'aurora'|'amoled'
  cinArtRGBTarget: number[], // [r, g, b] — cible couleur pour tween GSAP
}
```

**`cinema-bg.js`** reçoit deux callbacks à l'init :
```js
getCinemaState: () => { cinemaOpen: boolean, cinArtRGB: string } // 'r,g,b'
onApplied: () => void  // appelé par applyCinemaBg() si cinemaOpen — remplace l'appel inline à updateCinema()
```

---

## Task 1 : Créer `cinema-viz.js`

**Files:**
- Create: `frontend/src/cinema-viz.js`

- [ ] **Step 1.1 : Créer le fichier avec le contenu extrait**

Créer `frontend/src/cinema-viz.js` avec le contenu suivant (extrait et adapté de cinema.js lignes 966–1372, plus les deux vars d'état des lignes 51–52) :

```js
// cinema-viz.js — Visualiseur canvas Cinema : liquid waves, aurora, barres, beat detector.
// Extrait de cinema.js. Pas d'import depuis cinema.js (dépendance via callback getCinemaState).

import { eqCtx, eqAnalyser }  from './eq.js';
import { quickTo, tween, kill, timeline, eases } from './motion.js';
import { rgbToHsl, hslToRgb } from './artcolor.js';

// ── État module ──────────────────────────────────────────────
let _cinVizRaf = null;
let _beatTimer = null;
let _getCinVizState = null; // () => { cinemaOpen, cinemaBg, cinArtRGBTarget }

/**
 * Enregistre le fournisseur d'état. Appelé par cinema.js au chargement du module.
 * @param {() => { cinemaOpen: boolean, cinemaBg: string, cinArtRGBTarget: number[] }} fn
 */
export function initCinemaVizModule(fn) {
  _getCinVizState = fn;
}

/** Démarre le loop RAF du visualiseur. */
export function startCinemaViz() {
  const canvas = document.getElementById('cinema-viz');
  if (!canvas) return;

  const analyser = eqAnalyser;
  const ac       = eqCtx;
  if (!analyser || !ac) return;
  if (ac.state === 'suspended') ac.resume();

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  let cw = 0, ch = 0;

  const _col = { r: 255, g: 255, b: 255 };
  let _colKey = '', _colTween = null;

  const _envRms = { v: 0.0 };
  const _envMul = { v: 1.0 };
  const _qRms   = quickTo(_envRms, 'v', { duration: 0.22, ease: 'power2.out' });

  const BAR_STD = 56;
  const _bars   = Array.from({ length: BAR_STD }, () => ({ h: 0 }));
  const _qs     = _bars.map(b => quickTo(b, 'h', { duration: 0.12, ease: 'power2.out' }));

  // ── Beat detector ──────────────────────────────────────────────────────────
  const BEAT_HISTORY = 43, BEAT_THRESH = 1.35, BEAT_COOLDOWN = 650;
  const _bh = new Float32Array(BEAT_HISTORY);
  let _bi = 0, _bsum = 0, _blast = 0, _artWrap = null;

  function _detectBeat(freq) {
    const end = Math.floor(freq.length * 0.10);
    let e = 0;
    for (let i = 0; i < end; i++) e += freq[i] * freq[i];
    e /= end;
    const slot = _bi % BEAT_HISTORY;
    _bsum -= _bh[slot]; _bh[slot] = e; _bsum += e; _bi++;
    if (_bi < BEAT_HISTORY) return;
    if (_bi % BEAT_HISTORY === 0) { _bsum = 0; for (let i = 0; i < BEAT_HISTORY; i++) _bsum += _bh[i]; }
    const avg = _bsum / BEAT_HISTORY, now = performance.now();
    if (e > avg * BEAT_THRESH && now - _blast > BEAT_COOLDOWN) {
      _blast = now;
      if (!_artWrap) _artWrap = document.querySelector('.cinema-art-wrap');
      if (_artWrap) {
        const rgb = `${Math.round(_col.r)},${Math.round(_col.g)},${Math.round(_col.b)}`;
        _artWrap.style.setProperty('--beat-color', `rgba(${rgb},.32)`);
        _artWrap.classList.remove('beat');
        requestAnimationFrame(() => _artWrap.classList.add('beat'));
        if (_beatTimer) clearTimeout(_beatTimer);
        _beatTimer = setTimeout(() => { _artWrap.classList.remove('beat'); _beatTimer = null; }, 620);
      }
      kill(_envMul);
      const tl = timeline();
      tl.to(_envMul, { v: 1.55, duration: 0.06, ease: eases.SNAP });
      tl.to(_envMul, { v: 1.00, duration: 0.70, ease: 'power3.out' });
    }
  }

  // ── Liquid wave buffers ────────────────────────────────────────────────────
  const NLIQ = 7, LPTS = 200;
  const _lPx  = new Float32Array(LPTS);
  const _lPy  = Array.from({ length: NLIQ }, () => new Float32Array(LPTS));
  const _lSmt = new Float32Array(NLIQ);
  const _lBnd = new Float32Array(NLIQ);
  const _lBR  = [
    0.000, 0.015,  0.015, 0.045,  0.045, 0.10,
    0.10,  0.22,   0.22,  0.42,   0.42,  0.68,   0.68, 1.00,
  ];
  const _lPrm = [
    [0.60, 0.30, 0.8, 4.5e-4, 0.28],
    [0.52, 0.24, 1.2, 6.5e-4, 0.24],
    [0.45, 0.18, 1.7, 9.0e-4, 0.19],
    [0.39, 0.13, 2.2, 1.2e-3, 0.15],
    [0.34, 0.09, 2.8, 1.5e-3, 0.12],
    [0.29, 0.06, 3.5, 1.8e-3, 0.09],
    [0.25, 0.04, 4.2, 2.2e-3, 0.06],
  ];
  let _lGrads = null, _lGradRGB = '', _lGradH = 0, _lPxW = -1;
  let _lColors = new Array(NLIQ).fill('255,255,255'), _lColorsRGB = '';

  function _liqRebuildColors(rgb) {
    _lColorsRGB = rgb;
    const parts = rgb.split(',');
    const r = +parts[0], g = +parts[1], b = +parts[2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const shifts    = [0, -28, 28, -16, 20, -42, 36];
    const satBoosts = [1.25, 1.20, 1.30, 1.15, 1.20, 1.25, 1.15];
    for (let L = 0; L < NLIQ; L++) {
      const nh = ((h + shifts[L]) % 360 + 360) % 360;
      const ns = Math.min(1, s * satBoosts[L]);
      const nl = Math.min(0.75, Math.max(0.22, l));
      const [nr, ng, nb] = hslToRgb(nh, ns, nl);
      _lColors[L] = `${nr|0},${ng|0},${nb|0}`;
    }
  }

  function _liqRebuildGrads(rgb, h) {
    if (_lColorsRGB !== rgb) _liqRebuildColors(rgb);
    _lGrads = []; _lGradRGB = rgb; _lGradH = h;
    for (let L = 0; L < NLIQ; L++) {
      const c = _lColors[L], a = _lPrm[L][4];
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0,    `rgba(${c},${a.toFixed(3)})`);
      g.addColorStop(0.50, `rgba(${c},${(a * 0.55).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${c},0.008)`);
      _lGrads[L] = g;
    }
  }

  function _liqBloom(w, h, bassE, midE) {
    if (bassE <= 0.04) return;
    const bA = Math.min(0.24, bassE * 0.32);
    const bg = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h);
    bg.addColorStop(0,    `rgba(${_lColors[0]},${bA.toFixed(3)})`);
    bg.addColorStop(0.45, `rgba(${_lColors[1]},${(bA * 0.35).toFixed(3)})`);
    bg.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (midE > 0.10) {
      const mA = Math.min(0.10, midE * 0.14);
      const mg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
      mg.addColorStop(0, `rgba(${_lColors[2]},${mA.toFixed(3)})`);
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
    }
  }

  function _drawLiquidWaves(T, w, h, rgb) {
    if (_lPxW !== w) { for (let i = 0; i < LPTS; i++) _lPx[i] = (i / (LPTS - 1)) * w; _lPxW = w; }
    const nBins = analyser.frequencyBinCount;
    for (let L = 0; L < NLIQ; L++) {
      const s = Math.floor(_lBR[L * 2] * nBins), e = Math.floor(_lBR[L * 2 + 1] * nBins);
      let sum = 0; for (let i = s; i < e; i++) sum += _vizBuf[i];
      _lSmt[L] = _lSmt[L] * 0.80 + (e > s ? sum / ((e - s) * 255) : 0) * 0.20;
      _lBnd[L] = _lSmt[L];
    }
    if (_lGradRGB !== rgb || _lGradH !== h) _liqRebuildGrads(rgb, h);
    _liqBloom(w, h, _lBnd[0] * _envMul.v, _lBnd[2] * _envMul.v);
    const _PHI = 1.618033988;
    for (let L = NLIQ - 1; L >= 0; L--) {
      const prm = _lPrm[L], energy = Math.min(1, _lBnd[L] * 1.5);
      const amp = h * prm[1] * (0.18 + energy * 0.82) * _envMul.v, cy = h * prm[0];
      const phase = T * prm[3];
      for (let i = 0; i < LPTS; i++) {
        const a = (i / (LPTS - 1)) * Math.PI * 2 * prm[2] + phase;
        _lPy[L][i] = cy - amp * (Math.sin(a) * 0.62 + Math.sin(a * _PHI + phase * 0.35) * 0.38);
      }
      const alpha = prm[4] * (0.35 + energy * 0.65);
      ctx.globalCompositeOperation = L <= 1 ? 'screen' : 'source-over';
      ctx.beginPath(); ctx.moveTo(_lPx[0], _lPy[L][0]);
      for (let i = 0; i < LPTS - 1; i++) {
        ctx.quadraticCurveTo(_lPx[i], _lPy[L][i],
          (_lPx[i] + _lPx[i + 1]) * 0.5, (_lPy[L][i] + _lPy[L][i + 1]) * 0.5);
      }
      ctx.lineTo(_lPx[LPTS - 1], _lPy[L][LPTS - 1]);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = _lGrads[L]; ctx.fill();
      if (energy > 0.04) {
        ctx.beginPath(); ctx.moveTo(_lPx[0], _lPy[L][0]);
        for (let i = 0; i < LPTS - 1; i++) {
          ctx.quadraticCurveTo(_lPx[i], _lPy[L][i],
            (_lPx[i] + _lPx[i + 1]) * 0.5, (_lPy[L][i] + _lPy[L][i + 1]) * 0.5);
        }
        ctx.lineTo(_lPx[LPTS - 1], _lPy[L][LPTS - 1]);
        ctx.strokeStyle = `rgb(${_lColors[L]})`; ctx.lineWidth = Math.max(1.0, 3.0 - L * 0.3);
        ctx.globalAlpha = Math.min(0.72, energy) * alpha; ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ── Aurora buffers ─────────────────────────────────────────────────────────
  const NAUR = 7, APTS = 90;
  const _aLx = Array.from({ length: NAUR }, () => new Float32Array(APTS));
  const _aRx = Array.from({ length: NAUR }, () => new Float32Array(APTS));
  const _aPy = new Float32Array(APTS);
  const _aBnd = new Float32Array(NAUR);
  const _aBR  = [0.00,0.03, 0.03,0.08, 0.08,0.18, 0.18,0.35, 0.35,0.55, 0.55,0.78, 0.78,1.00];
  const _aPrm = [
    [0.10, 0.04, 3.0e-4, 0.0,  1.5, 0.12, 0.30],
    [0.27, 0.05, 2.5e-4, 1.4,  2.0, 0.10, 0.26],
    [0.43, 0.06, 3.5e-4, 2.8,  1.8, 0.15, 0.32],
    [0.58, 0.05, 2.8e-4, 0.6,  2.2, 0.12, 0.28],
    [0.70, 0.07, 4.0e-4, 3.2,  1.6, 0.13, 0.28],
    [0.82, 0.04, 3.2e-4, 1.8,  2.4, 0.09, 0.24],
    [0.92, 0.03, 2.8e-4, 4.0,  2.8, 0.08, 0.22],
  ];
  let _aGrads = null, _aGradRGB = '', _aGradH = 0, _aPyH = -1;
  let _aColors = new Array(NAUR).fill('255,255,255'), _aColorsRGB = '';
  const NSTAR = 100;
  const _aSX = new Float32Array(NSTAR), _aSY = new Float32Array(NSTAR), _aSP = new Float32Array(NSTAR);
  for (let i = 0; i < NSTAR; i++) {
    _aSX[i] = ((i * 7919 + 13) % 997) / 997;
    _aSY[i] = ((i * 6271 +  7) % 997) / 997 * 0.55;
    _aSP[i] = (i * 2.3999) % (Math.PI * 2);
  }

  function _aurRebuildColors(rgb) {
    _aColorsRGB = rgb;
    const parts = rgb.split(',');
    const r = +parts[0], g = +parts[1], b = +parts[2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const shifts = [-60, -40, -18, 0, 22, 46, 70];
    for (let C = 0; C < NAUR; C++) {
      const nh = ((h + shifts[C]) % 360 + 360) % 360;
      const ns = Math.min(1, s * 1.35), nl = Math.min(0.78, Math.max(0.28, l * 1.08));
      const [nr, ng, nb] = hslToRgb(nh, ns, nl);
      _aColors[C] = `${nr|0},${ng|0},${nb|0}`;
    }
  }

  function _aurRebuildGrads(rgb, h) {
    if (_aColorsRGB !== rgb) _aurRebuildColors(rgb);
    _aGrads = []; _aGradRGB = rgb; _aGradH = h;
    for (let C = 0; C < NAUR; C++) {
      const c = _aColors[C], a = _aPrm[C][6];
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0,    `rgba(${c},0)`);
      g.addColorStop(0.12, `rgba(${c},${a.toFixed(3)})`);
      g.addColorStop(0.42, `rgba(${c},${(a * 0.68).toFixed(3)})`);
      g.addColorStop(0.72, `rgba(${c},${(a * 0.22).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${c},0)`);
      _aGrads[C] = g;
    }
  }

  function _aurBloom(w, h, energy) {
    if (energy <= 0.04) return;
    const bA = Math.min(0.20, energy * 0.28);
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.28, 0, w * 0.5, h * 0.28, w * 0.68);
    bg.addColorStop(0,    `rgba(${_aColors[3]},${bA.toFixed(3)})`);
    bg.addColorStop(0.45, `rgba(${_aColors[1]},${(bA * 0.38).toFixed(3)})`);
    bg.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function _drawAurora(T, w, h, rgb) {
    if (_aPyH !== h) { for (let i = 0; i < APTS; i++) _aPy[i] = (i / (APTS - 1)) * h; _aPyH = h; }
    const nBins = analyser.frequencyBinCount;
    for (let C = 0; C < NAUR; C++) {
      const s = Math.floor(_aBR[C*2]*nBins), e = Math.floor(_aBR[C*2+1]*nBins);
      let sum = 0; for (let i = s; i < e; i++) sum += _vizBuf[i];
      _aBnd[C] = _aBnd[C] * 0.86 + (e > s ? sum / ((e - s) * 255) : 0) * 0.14;
    }
    if (_aGradRGB !== rgb || _aGradH !== h) _aurRebuildGrads(rgb, h);
    ctx.fillStyle = '#fff';
    for (let pass = 0; pass < 3; pass++) {
      ctx.globalAlpha = 0.06 + pass * 0.05 * (0.5 + 0.5 * Math.sin(T * 8e-4 + pass * 2.1));
      for (let i = pass; i < NSTAR; i += 3) ctx.fillRect(_aSX[i] * w | 0, _aSY[i] * h | 0, 1, 1);
    }
    ctx.globalAlpha = 1;
    _aurBloom(w, h, _aBnd[0] * _envMul.v);
    const _PHI = 1.618033988;
    for (let C = NAUR - 1; C >= 0; C--) {
      const prm = _aPrm[C], energy = Math.min(1, _aBnd[C] * 1.6);
      const cx  = prm[0] * w + prm[1] * w * Math.sin(T * prm[2] + prm[3]);
      const cw2 = prm[5] * w * (0.35 + energy * 0.65) * _envMul.v;
      const rA  = w * 0.016 * (0.25 + energy * 0.75);
      for (let i = 0; i < APTS; i++) {
        const yf  = i / (APTS - 1);
        const rip = Math.sin(yf * Math.PI * 2 * prm[4] + T * 7e-4 + prm[3]) * rA
                  + Math.sin(yf * Math.PI * 2 * prm[4] * _PHI + T * 5e-4) * rA * 0.3;
        _aLx[C][i] = cx - cw2 * 0.5 + rip;
        _aRx[C][i] = cx + cw2 * 0.5 + rip;
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = prm[6] * (0.30 + energy * 0.70);
      ctx.beginPath();
      ctx.moveTo(_aLx[C][0], _aPy[0]);
      for (let i = 1; i < APTS; i++) ctx.lineTo(_aLx[C][i], _aPy[i]);
      ctx.lineTo(_aRx[C][APTS - 1], _aPy[APTS - 1]);
      for (let i = APTS - 2; i >= 0; i--) ctx.lineTo(_aRx[C][i], _aPy[i]);
      ctx.closePath(); ctx.fillStyle = _aGrads[C]; ctx.fill();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ── Buffer fréquence ──────────────────────────────────────────────────────
  let _vizBuf = new Uint8Array(analyser.frequencyBinCount);

  // ── Boucle RAF principale ─────────────────────────────────────────────────
  function draw(timestamp) {
    const st = _getCinVizState?.();
    if (!st?.cinemaOpen) return;
    if (document.hidden) { _cinVizRaf = null; return; }
    const T = timestamp !== undefined ? timestamp : performance.now();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) { _cinVizRaf = requestAnimationFrame(draw); return; }
    if (w !== cw || h !== ch) {
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cw = w; ch = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (_vizBuf.length !== analyser.frequencyBinCount) _vizBuf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(_vizBuf);

    const { cinArtRGBTarget } = st;
    const ck = `${cinArtRGBTarget[0]},${cinArtRGBTarget[1]},${cinArtRGBTarget[2]}`;
    if (ck !== _colKey) {
      _colKey = ck;
      if (_colTween) { _colTween.kill(); _colTween = null; }
      _colTween = tween(_col, { r: cinArtRGBTarget[0], g: cinArtRGBTarget[1], b: cinArtRGBTarget[2], duration: 0.75, ease: 'power2.inOut' });
    }
    const rgb = `${Math.round(_col.r)},${Math.round(_col.g)},${Math.round(_col.b)}`;

    _detectBeat(_vizBuf);

    const barCount  = BAR_STD;
    const totalBins = analyser.frequencyBinCount;
    const lMax      = Math.log2(totalBins * 0.65);
    const lMin      = Math.log2(1);
    let   avgH      = 0;
    for (let i = 0; i < barCount; i++) {
      const bin = Math.round(Math.pow(2, lMin + (i / barCount) * (lMax - lMin)));
      _qs[i](_vizBuf[Math.min(bin, totalBins - 1)] / 255);
      avgH += _bars[i].h;
    }
    avgH /= barCount;

    const { cinemaBg } = st;
    if (cinemaBg === 'liquid') {
      _drawLiquidWaves(T, w, h, rgb);
    } else if (cinemaBg === 'aurora') {
      _drawAurora(T, w, h, rgb);
    } else {
      const bw = w / barCount;
      ctx.fillStyle = `rgb(${rgb})`;
      for (let i = 0; i < barCount; i++) {
        const v = _bars[i].h, bh = Math.max(2, v * h * 0.42);
        ctx.globalAlpha = 0.05 + v * 0.35;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(i * bw + 1, h - bh, bw - 2, bh, [3,3,0,0]); ctx.fill(); }
        else { ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh); }
        if (v > 0.18) { ctx.globalAlpha = v * 0.07; ctx.fillRect(i * bw + 1, h, bw - 2, bh * 0.28); }
      }
      ctx.globalAlpha = 1;
    }
    _cinVizRaf = requestAnimationFrame(draw);
  }

  if (_cinVizRaf) cancelAnimationFrame(_cinVizRaf);
  draw();
  canvas.style.opacity = '1';
}

/** Arrête le loop RAF du visualiseur et nettoie les effets visuels. */
export function stopCinemaViz() {
  if (_cinVizRaf) { cancelAnimationFrame(_cinVizRaf); _cinVizRaf = null; }
  if (_beatTimer) {
    clearTimeout(_beatTimer);
    _beatTimer = null;
    document.querySelector('.cinema-art-wrap')?.classList.remove('beat');
  }
  const canvas = document.getElementById('cinema-viz');
  if (canvas) canvas.style.opacity = '0';
}
```

- [ ] **Step 1.2 : Vérifier la syntaxe**

```
node --check frontend/src/cinema-viz.js
```
Attendu : aucune sortie (succès).

- [ ] **Step 1.3 : Vérifier les lignes**

```
node -e "const fs=require('fs'); const l=fs.readFileSync('frontend/src/cinema-viz.js','utf8').split('\n').length; console.log(l,'lines'); process.exit(l>500?1:0)"
```
Attendu : ≤ 500 lignes, exit 0.

- [ ] **Step 1.4 : Commit**

```
git add frontend/src/cinema-viz.js
git commit -m "feat(cinema): extract cinema-viz.js — visualiseur canvas (liquid/aurora/barres/beat)"
```

---

## Task 2 : Créer `cinema-bg.js`

**Files:**
- Create: `frontend/src/cinema-bg.js`

- [ ] **Step 2.1 : Créer le fichier**

Créer `frontend/src/cinema-bg.js` avec le contenu suivant (extrait et adapté des lignes 72–328 de cinema.js) :

```js
// cinema-bg.js — Gestion du fond Cinema : modes BG, état cinemaBg, animation ambient.
// Extrait de cinema.js. Pas d'import depuis cinema.js (dépendance via initCinemaBgModule).

import { i18n }                                from './i18n.js';
import { get, set }                            from './store.js';
import { saveCfg }                             from './cfgsave.js';
import { toast }                               from './ui.js';
import { rgbToHsl, hslToRgb, boostSat, sampleArtColors5 } from './artcolor.js';
import { renderAmbientFrame }                  from './ambientRenderer.js';

// ── Modes disponibles ────────────────────────────────────────
export const CINEMA_BG_MODES  = ['ambient', 'liquid', 'aurora', 'amoled'];
export const CINEMA_BG_LABELS = {
  ambient: 'Ambient',
  liquid:  'Liquide',
  aurora:  'Aurore',
  amoled:  'AMOLED',
};
const CINEMA_BG_ICONS = {
  ambient: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" opacity=".5"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="21"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="21" y2="12"/></svg>`,
  liquid:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/><path d="M2 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".55"/><path d="M2 7c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".25"/></svg>`,
  aurora:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 22 Q4 16 5 11 Q6 6 5 2"/><path d="M10 22 Q9 15 10 9 Q11 5 10 2" opacity=".65"/><path d="M15 22 Q16 14 15 9 Q14 4 15 2" opacity=".45"/><path d="M20 22 Q21 16 20 11 Q19 6 20 2" opacity=".28"/></svg>`,
  amoled:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".4"/></svg>`,
};
const AMBIENT_CROSSFADE_MS = 1400;

// ── État ─────────────────────────────────────────────────────
export let cinemaBg = 'ambient';

let _cinBgCtx      = null;
let _ambientAnimRaf = null;
let _ambientT       = 0;
let _ambientColors  = null;
let _ambientCross   = null;
let _frameCount     = 0;
let _ambientGen     = 0;

// Callbacks injectés par cinema.js via initCinemaBgModule()
let _getCinemaState = null; // () => { cinemaOpen, cinArtRGB }
let _onApplied      = null; // () => void — appelé par applyCinemaBg quand cinemaOpen

/**
 * Enregistre les dépendances de cinema.js. Appelé une fois au chargement du module cinema.js.
 * @param {() => { cinemaOpen: boolean, cinArtRGB: string }} getCinemaState
 * @param {() => void} onApplied — updateCinema() côté cinema.js
 */
export function initCinemaBgModule(getCinemaState, onApplied) {
  _getCinemaState = getCinemaState;
  _onApplied      = onApplied;
}

// ── Extraction des couleurs ambient ──────────────────────────

function _buildAmbientColors() {
  const img = document.getElementById('cinema-art-img');
  if (img && img.naturalWidth && img.style.display !== 'none') {
    const colors = sampleArtColors5(img, 64);
    if (colors && colors.length >= 3) {
      return {
        cT:  colors[0],
        cL:  colors[1],
        cR:  colors[2],
        cB1: colors[3] || null,
        cB2: colors[4] || null,
      };
    }
  }
  const cinArtRGB = _getCinemaState?.()?.cinArtRGB ?? '255,255,255';
  const [rF, gF, bF] = cinArtRGB.split(',').map(Number);
  const cT = boostSat(rF, gF, bF);
  const [hF, sF, lF] = rgbToHsl(...cT);
  return {
    cT,
    cL:  hslToRgb((hF + 38) % 360, Math.min(1, sF), lF),
    cR:  hslToRgb((hF - 32 + 360) % 360, Math.min(1, sF), lF),
    cB1: null,
    cB2: null,
  };
}

// ── Animation ambient ─────────────────────────────────────────

export function stopAmbientAnim() {
  _ambientGen++;
  if (_ambientAnimRaf) { cancelAnimationFrame(_ambientAnimRaf); _ambientAnimRaf = null; }
  _ambientCross = null;
}

function _startAmbientAnim() {
  if (_ambientAnimRaf) return;
  const myGen = _ambientGen;
  let last = performance.now();
  function loop(now) {
    if (myGen !== _ambientGen) return;
    const { cinemaOpen } = _getCinemaState?.() ?? {};
    if ((cinemaBg !== 'ambient' && cinemaBg !== 'amoled') || !cinemaOpen || document.hidden) {
      last = now;
      _ambientAnimRaf = null;
      return;
    }
    if (cinemaBg === 'ambient' && _frameCount++ % 2 !== 0) {
      _ambientAnimRaf = requestAnimationFrame(loop);
      return;
    }
    _ambientT += now - last;
    last = now;
    const canvas = document.getElementById('cinema-bg');
    if (!canvas) { _ambientAnimRaf = null; return; }
    if (!_cinBgCtx || _cinBgCtx.canvas !== canvas) {
      _cinBgCtx = canvas.getContext('2d');
      if (!_cinBgCtx) { _ambientAnimRaf = requestAnimationFrame(loop); return; }
      const _dpr = window.devicePixelRatio || 1;
      _cinBgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    }
    const cinArtRGB = _getCinemaState?.()?.cinArtRGB ?? '255,255,255';
    renderAmbientFrame(_ambientT, canvas, _cinBgCtx, cinemaBg, cinArtRGB, _ambientColors);
    if (_ambientCross) {
      const { snapshot, start, dur } = _ambientCross;
      const p    = Math.min(1, (now - start) / dur);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const _cW  = window.innerWidth || 1280, _cH = window.innerHeight || 800;
      _cinBgCtx.globalAlpha = 1 - ease;
      _cinBgCtx.drawImage(snapshot, 0, 0, _cW, _cH);
      _cinBgCtx.globalAlpha = 1;
      if (p >= 1) _ambientCross = null;
    }
    _ambientAnimRaf = requestAnimationFrame(loop);
  }
  _ambientAnimRaf = requestAnimationFrame(loop);
}

function _updateAmbientGradient() {
  const canvas = document.getElementById('cinema-bg');
  if (!canvas || !canvas.getContext) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = window.innerWidth  || 1280;
  const H   = window.innerHeight || 800;
  const PW  = Math.round(W * dpr);
  const PH  = Math.round(H * dpr);

  if (cinemaBg === 'amoled') {
    stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _startAmbientAnim();
    return;
  }

  if (cinemaBg !== 'ambient') return;

  let snapshot = null;
  if (_ambientColors && canvas.width > 0 && canvas.height > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = PW; snapshot.height = PH;
    const snapCtx = snapshot.getContext('2d');
    if (snapCtx) snapCtx.drawImage(canvas, 0, 0, PW, PH);
  }

  stopAmbientAnim();
  canvas.width  = PW;
  canvas.height = PH;
  _cinBgCtx = canvas.getContext('2d');
  if (!_cinBgCtx) return;
  _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _ambientColors = _buildAmbientColors();

  if (snapshot) {
    _ambientCross = { snapshot, start: performance.now(), dur: AMBIENT_CROSSFADE_MS };
  }
  _startAmbientAnim();
}

/** Relance l'animation ambient si le mode est ambient/amoled (visibilitychange). */
export function restartAmbientIfNeeded() {
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled') _startAmbientAnim();
}

// ── API publique modes BG ─────────────────────────────────────

export function initCinemaBg(mode) {
  if (CINEMA_BG_MODES.includes(mode)) { cinemaBg = mode; set('cinemaBg', mode); }
}

export function setCinemaBg(mode) {
  if (!CINEMA_BG_MODES.includes(mode)) return;
  cinemaBg = mode; set('cinemaBg', mode);
  applyCinemaBg();
  syncCinemaBgSettings();
  saveCfg();
}

export function syncCinemaBgSettings() {
  CINEMA_BG_MODES.forEach(m => {
    const btn = document.getElementById('set-cinema-' + m);
    if (!btn) return;
    const active = m === cinemaBg;
    btn.classList.toggle('on', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

export function cycleCinemaBg() {
  const cur = CINEMA_BG_MODES.indexOf(cinemaBg);
  cinemaBg  = CINEMA_BG_MODES[(cur + 1) % CINEMA_BG_MODES.length];
  set('cinemaBg', cinemaBg);
  applyCinemaBg();
  syncCinemaBgSettings();
  saveCfg();
  toast(i18n('t_cinema_bg', CINEMA_BG_LABELS[cinemaBg]));
}

export function applyCinemaBg() {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  CINEMA_BG_MODES.forEach(m => overlay.classList.remove('bg-' + m));
  overlay.classList.add('bg-' + cinemaBg);
  updateCinemaBgBtn();
  const cinBg = document.getElementById('cinema-bg');
  stopAmbientAnim();
  _ambientColors = null;
  if (cinBg?.getContext) {
    const c = _cinBgCtx || cinBg.getContext('2d');
    if (c) c.clearRect(0, 0, cinBg.width || 1, cinBg.height || 1);
  }
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled') _updateAmbientGradient();
  // Délègue updateCinema() à cinema.js pour éviter une dépendance circulaire (Bug #9 fix).
  const { cinemaOpen } = _getCinemaState?.() ?? {};
  if (cinemaOpen) _onApplied?.();
}

export function updateCinemaBgBtn() {
  const btn = document.getElementById('cinema-bg-btn');
  if (!btn) return;
  btn.innerHTML = CINEMA_BG_ICONS[cinemaBg] || CINEMA_BG_ICONS.ambient;
  const label = CINEMA_BG_LABELS[cinemaBg] || cinemaBg;
  btn.title = i18n('t_cinema_bg', label) + ' [B]';
}

/** Appelé depuis cinema.js lors d'un changement de piste/couleur pour rebuilder les couleurs ambient. */
export function updateAmbientGradient() {
  _updateAmbientGradient();
}

// ── Resize ───────────────────────────────────────────────────
let _resizeTimer = null;
window.addEventListener('resize', () => {
  const { cinemaOpen } = _getCinemaState?.() ?? {};
  if (!cinemaOpen) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (cinemaBg === 'ambient' || cinemaBg === 'amoled') applyCinemaBg();
  }, 200);
});
```

- [ ] **Step 2.2 : Vérifier la syntaxe**

```
node --check frontend/src/cinema-bg.js
```
Attendu : aucune sortie.

- [ ] **Step 2.3 : Vérifier les lignes**

```
node -e "const fs=require('fs'); const l=fs.readFileSync('frontend/src/cinema-bg.js','utf8').split('\n').length; console.log(l,'lines'); process.exit(l>350?1:0)"
```
Attendu : ≤ 350 lignes, exit 0.

- [ ] **Step 2.4 : Commit**

```
git add frontend/src/cinema-bg.js
git commit -m "feat(cinema): extract cinema-bg.js — modes BG, état cinemaBg, animation ambient"
```

---

## Task 3 : Refactorer `cinema.js`

**Files:**
- Modify: `frontend/src/cinema.js`

- [ ] **Step 3.1 : Remplacer les imports en haut du fichier**

Remplacer les lignes 1–29 (tout le bloc d'imports + commentaire d'en-tête) par :

```js
// LibreFlow — cinema.js
// Mode Cinéma : overlay plein-écran, fond flou, contrôles masquables.
//
// Exports publics (tous les consommateurs importent depuis ce fichier) :
//   cinemaOpen, cinemaBg + toutes les fonctions BG (re-exports de cinema-bg.js)
//   toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress
//   toggleCinemaFullscreen, getCinArtRGB, updateCinArtColor

import { fmt, extEmoji }                      from './utils.js';
import { eqCtx, masterGainNode, setMasterGain } from './eq.js';
import { i18n }                                from './i18n.js';
import { get, set }                            from './store.js';
import { getFiltered, filteredIdx }            from './search.js';
import { audio, toggleLike, next, prev }       from './player.js';
import { radioActive, stopRadio, startRadio, getRadioQueue } from './radio.js';
import { toast }                               from './ui.js';
import { saveCfg }                             from './cfgsave.js';
import { updateVolSlider }                     from './playerbar.js';
import { timeline, set as motionSet, kill as motionKill, eases } from './motion.js';

import { startCinemaViz, stopCinemaViz, initCinemaVizModule } from './cinema-viz.js';
import {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  stopAmbientAnim, updateAmbientGradient, restartAmbientIfNeeded,
  initCinemaBgModule,
} from './cinema-bg.js';

// Re-exports pour rétrocompatibilité — tous les consommateurs importent depuis cinema.js
export {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
};
```

- [ ] **Step 3.2 : Supprimer les blocs extraits vers cinema-viz.js**

Dans `cinema.js`, supprimer les éléments suivants (chercher par contenu exact) :

**a)** Les deux lignes de déclaration de state viz (lignes ~51–52 dans l'original) :
```js
let _cinVizRaf  = null;
let _beatTimer  = null; // timer classe .beat — module scope pour pouvoir le nettoyer dans _stopViz()
```

**b)** La fonction `function _startViz()` entière — de la ligne `function _startViz() {` jusqu'à la fermeture `}` correspondante (environ 390 lignes, inclut toutes les fonctions internes liquid/aurora).

**c)** La fonction `function _stopViz()` entière (environ 12 lignes après `_startViz`).

- [ ] **Step 3.3 : Supprimer les blocs extraits vers cinema-bg.js**

Dans `cinema.js`, supprimer :

**a)** La déclaration `export let cinemaBg = 'ambient';` (ligne 33 original — maintenant importée et re-exportée)

**b)** Les 6 variables d'état ambient (lignes ~164–169 original) :
```js
let _ambientAnimRaf = null;
let _ambientT       = 0;
let _ambientColors  = null;
let _ambientCross   = null;
let _frameCount     = 0;
let _ambientGen     = 0;
```

**c)** La variable `let _cinBgCtx = null;` (ligne ~48 original)

**d)** Les constantes BG : `export const CINEMA_BG_MODES`, `CINEMA_BG_LABELS`, `CINEMA_BG_ICONS` (lignes ~78–90)

**e)** La constante `const AMBIENT_CROSSFADE_MS = 1400;`

**f)** Les fonctions : `initCinemaBg`, `setCinemaBg`, `syncCinemaBgSettings`, `cycleCinemaBg`, `applyCinemaBg` (lignes ~99–154)

**g)** Les fonctions : `_buildAmbientColors`, `_stopAmbientAnim`, `_startAmbientAnim`, `_updateAmbientGradient` (lignes ~172–309)

**h)** La fonction `updateCinemaBgBtn` (lignes ~311–318)

**i)** Le bloc `window.addEventListener('resize', ...)` ambient (lignes ~321–328)

- [ ] **Step 3.4 : Enregistrer les callbacks et mettre à jour les appels internes**

**a)** Juste après le bloc `export { ... }` des re-exports, ajouter :

```js
// ── Init inter-modules (pas d'import circulaire — passage par callbacks) ────
initCinemaBgModule(
  () => ({ cinemaOpen, cinArtRGB: _cinArtRGB }),
  () => updateCinema(),
);
initCinemaVizModule(
  () => ({ cinemaOpen, cinemaBg, cinArtRGBTarget: _cinArtRGBTarget }),
);
```

**b)** Dans `openCinema()`, remplacer l'appel `_startViz()` par `startCinemaViz()`.

**c)** Dans `closeCinema()` :
- Remplacer `_stopViz()` par `stopCinemaViz()`
- Remplacer `_stopAmbientAnim()` par `stopAmbientAnim()`
- Supprimer la ligne `_ambientColors = null;` (maintenant gérée dans cinema-bg.js/stopAmbientAnim)

**d)** Dans `updateCinema()`, remplacer `_updateAmbientGradient()` par `updateAmbientGradient()`.

**e)** Remplacer le handler `document.addEventListener('visibilitychange', ...)` en bas du fichier par :
```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cinemaOpen) {
    restartAmbientIfNeeded();
    if ((cinemaBg === 'liquid' || cinemaBg === 'aurora') && !_cinVizActive()) {
      startCinemaViz();
    }
  }
});
```
où `_cinVizActive` est une petite fonction locale :
```js
function _cinVizActive() {
  const cv = document.getElementById('cinema-viz');
  return cv ? cv.style.opacity !== '0' : false;
}
```

- [ ] **Step 3.5 : Vérifier le nombre de lignes**

```
node -e "const fs=require('fs'); const l=fs.readFileSync('frontend/src/cinema.js','utf8').split('\n').length; console.log(l,'lines'); process.exit(l>800?1:0)"
```
Attendu : < 800 lignes, exit 0.

Si le fichier dépasse 800 lignes, utiliser `grep -n "function _start\|function _stop\|export const CINEMA\|let _ambient\|let _cinBgCtx\|let _cinVizRaf" frontend/src/cinema.js` pour identifier les blocs non encore supprimés, et les retirer.

---

## Task 4 : Tests + vérification + commit final

**Files:**
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 4.1 : Ajouter la section de tests statiques**

Dans `frontend/tests/core.test.cjs`, trouver la ligne `TOKEN-SOURCE OK` (fin de la section token-source). Ajouter immédiatement après le bloc `}` qui ferme la section token :

```js
// =============================================================================
// cinema split — vérification statique (lignes + exports publics)
// =============================================================================
{
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '../..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  section('cinema split — line count + public surface');

  const cinLines = read('frontend/src/cinema.js').split('\n').length;
  const vizLines = read('frontend/src/cinema-viz.js').split('\n').length;
  const bgLines  = read('frontend/src/cinema-bg.js').split('\n').length;

  assert(cinLines < 800, `cinema.js < 800 lignes (actual: ${cinLines})`);
  assert(vizLines < 500, `cinema-viz.js < 500 lignes (actual: ${vizLines})`);
  assert(bgLines  < 400, `cinema-bg.js < 400 lignes (actual: ${bgLines})`);

  const vizSrc = read('frontend/src/cinema-viz.js');
  const bgSrc  = read('frontend/src/cinema-bg.js');
  const cinSrc = read('frontend/src/cinema.js');

  assert(/export function startCinemaViz/.test(vizSrc),      'cinema-viz.js exports startCinemaViz');
  assert(/export function stopCinemaViz/.test(vizSrc),       'cinema-viz.js exports stopCinemaViz');
  assert(/export function initCinemaVizModule/.test(vizSrc), 'cinema-viz.js exports initCinemaVizModule');

  assert(/export let cinemaBg/.test(bgSrc),                'cinema-bg.js exports cinemaBg');
  assert(/export const CINEMA_BG_MODES/.test(bgSrc),       'cinema-bg.js exports CINEMA_BG_MODES');
  assert(/export function applyCinemaBg/.test(bgSrc),      'cinema-bg.js exports applyCinemaBg');
  assert(/export function initCinemaBgModule/.test(bgSrc), 'cinema-bg.js exports initCinemaBgModule');

  assert(/from '.\/cinema-viz.js'/.test(cinSrc),          "cinema.js importe depuis cinema-viz.js");
  assert(/from '.\/cinema-bg.js'/.test(cinSrc),           "cinema.js importe depuis cinema-bg.js");
  assert(/export \{[\s\S]*?cinemaBg/.test(cinSrc),        "cinema.js re-exporte cinemaBg");
  assert(/export let cinemaOpen/.test(cinSrc),             "cinema.js exporte toujours cinemaOpen");
  assert(/export function updateCinema/.test(cinSrc),      "cinema.js exporte toujours updateCinema");
}
```

- [ ] **Step 4.2 : Vérifier la syntaxe des trois fichiers**

```
node --check frontend/src/cinema.js && node --check frontend/src/cinema-bg.js && node --check frontend/src/cinema-viz.js
```
Attendu : aucune sortie (succès). Corriger toute erreur de syntaxe avant de continuer.

- [ ] **Step 4.3 : Lancer npm test**

```
npm test
```
Attendu : **383+ OK, 0 KO**. Si des assertions échouent sur le bloc cinema-split, vérifier les exports manquants ou les lignes non supprimées dans cinema.js (Step 3).

- [ ] **Step 4.4 : Commit final**

```
git add frontend/src/cinema.js frontend/tests/core.test.cjs
git commit -m "refactor(cinema): wire cinema-viz.js + cinema-bg.js, drop extracted code — cinema.js < 800 lignes"
```

---

## Checklist CLAUDE.md §19

- [x] Pas de mutation `tracks[]` — aucun touché
- [x] `audio.volume` jamais assigné littéralement — `_readVol()` inchangé
- [x] Pas de `fetch`/`XHR`/`WebSocket` — aucun ajouté
- [x] Pas d'IDB write — extraction pure de code existant
- [x] Pas d'AudioParam `.value =` — aucun touché
- [x] Pas d'IPC — aucun touché
- [x] Constantes virtual scroll depuis CFG — virt.js non touché
- [x] `radioRefillQueue()` inchangé — chemin playback non touché
- [x] Pas de `console.log` dans le code commité
- [x] `cinema-viz.js` < 500 lignes, `cinema-bg.js` < 400 lignes, `cinema.js` < 800 lignes

---

## Self-Review

**1. Spec coverage :**
- Extract `cinema-viz.js` → Task 1 ✓
- Extract `cinema-bg.js` → Task 2 ✓
- Refactor `cinema.js` + re-exports backward-compat → Task 3 ✓
- Tests statiques line count + exports → Task 4 ✓
- Aucun consommateur (`app.js`, `handlers.js`, etc.) modifié → re-exports en Task 3 ✓

**2. Placeholder scan :** Aucun TBD/TODO. Chaque étape a le code exact ou la commande exacte.

**3. Cohérence des noms :**
- `startCinemaViz` / `stopCinemaViz` / `initCinemaVizModule` — cohérents entre Task 1 et Task 3
- `stopAmbientAnim` / `updateAmbientGradient` / `restartAmbientIfNeeded` / `initCinemaBgModule` — cohérents entre Task 2 et Task 3
- Callback `getCinemaState` — même signature dans `initCinemaBgModule` et `initCinemaVizModule`
- Re-exports (`cinemaBg`, `CINEMA_BG_MODES`, etc.) — correspondent exactement aux exports de `cinema-bg.js`

**4. Risques identifiés :**
- `initCinemaBgModule` et `initCinemaVizModule` sont appelés à l'évaluation du module. Les variables `_cinArtRGB`, `_cinArtRGBTarget`, `cinemaOpen` sont déclarées avant cet appel → les closures captureront les variables live (pas des snapshots). Correct car ESM live bindings.
- `eqAnalyser` retiré des imports de `cinema.js` en Step 3.1 — ne pas l'oublier.
- `_ambientColors = null` dans `closeCinema()` : à supprimer car `stopAmbientAnim()` dans `cinema-bg.js` ne remet pas `_ambientColors` à null. Vérifier que `applyCinemaBg()` dans `cinema-bg.js` le fait bien (c'est le cas : `_ambientColors = null;` est dans `applyCinemaBg()`).
