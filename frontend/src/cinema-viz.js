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

  const _initRGB = _getCinVizState?.()?.cinArtRGBTarget ?? [255, 255, 255];
  const _col = { r: _initRGB[0], g: _initRGB[1], b: _initRGB[2] };
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
    // Onglet caché : sauter le rendu mais REPLANIFIER — le navigateur gèle les
    // rAF des onglets cachés (coût nul) et la boucle reprend seule au retour.
    // (Avant : `_cinVizRaf = null; return` tuait la boucle définitivement, le
    // handler visibilitychange de cinema.js ne la relançant que pour
    // liquid/aurora avec opacity '0' — jamais vrai dans ce chemin.)
    if (document.hidden) { _cinVizRaf = requestAnimationFrame(draw); return; }
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
