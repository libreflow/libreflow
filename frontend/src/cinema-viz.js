// LibreFlow — cinema-viz.js
// Visualiseur audio du mode Cinéma (barres spectrales + beat pochette).
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
// Task 4 (cycle 2) : renderer passif — plus de rAF ni de lecture analyser locale.
// La boucle MAÎTRE (cinema-loop.js) appelle drawVizFrame(dt, fft, beat) à chaque frame,
// avec un snapshot FFT et un beat déjà calculés une fois pour bg+viz+vol-vis.
//
// Exports publics :
//   initCinemaVizModule({ getCinemaOpen })
//   startCinemaViz()
//   stopCinemaViz()
//   drawVizFrame(dt, fft, beat) — renderer passif appelé par cinema-loop.js

import { eqCtx, eqAnalyser }              from './eq.js';
import { cinemaBg, stepArtColorLerp }     from './cinema-bg.js';
import { prefersReducedMotion }           from './motion.js';

// ── Constantes ───────────────────────────────────────────────
const BEAT_PULSE_MS = 620;  // durée du pulse visuel sur beat — nom vérifié par core.test.cjs (design-system coherence)

// ── État module ──────────────────────────────────────────────
let _beatTimer    = null; // timer classe .beat — module scope pour pouvoir le nettoyer dans _stopViz()
let _artWrapCache = null; // cache DOM .cinema-art-wrap — module scope pour reset propre dans _stopViz()

// ── État de dessin (posé par _startViz, consommé par drawVizFrame) ──────────
// Task 4 : plus de closure draw() — ces refs vivent au scope module pour survivre
// entre deux appels de drawVizFrame() par la boucle MAÎTRE (cinema-loop.js).
let _cinVizCanvas = null; // <canvas id="cinema-viz">
let _cinVizCtx    = null; // contexte 2D — cache tant que le canvas ne change pas
let _cinVizDpr    = 1;    // devicePixelRatio au moment du setup
let _cinVizCw     = 0, _cinVizCh = 0; // dimensions CSS courantes — détecte le resize
let _specGrad     = { top: null, bot: null, rgb: '', midY: -1 }; // cache gradients mode spectrum

// ── Vol-vis canvas (ambient sur la barre de volume) ─────────
let _volVisCtx = null, _volVisW = 0, _volVisH = 0;

// ── PERF : caches de strings couleur — zéro allocation par frame ────────────
// Le cache de la string LERP _lerpRGB vit dans stepArtColorLerp() (cinema-bg.js, Task 3).
// Ici on ne cache que les fillStyle rgb(...) qui en dérivent, reconstruits seulement
// quand _lerpRGB change (pas par frame).
let _glowFillCache = 'rgb(0,0,0)';   // mode spectrum : glow + ligne centrale
let _stdFillRGB    = '';             // mode standard : clé d'invalidation
let _stdFillCache  = 'rgb(0,0,0)';   // mode standard : cache de rgb(${_lerpRGB})

let _getCinemaOpen = () => false;

/**
 * Doit être appelé une seule fois depuis cinema.js après l'initialisation du module.
 * Fournit un accès à cinemaOpen sans créer de cycle d'import.
 */
export function initCinemaVizModule({ getCinemaOpen }) {
  _getCinemaOpen = getCinemaOpen;
}

export function startCinemaViz() { _startViz(); }
export function stopCinemaViz()  { _stopViz(); }

// ── Implémentation interne ───────────────────────────────────

// Task 15 : mapping log → bin STRICTEMENT croissant. L'arrondi de 2^(t·range)
// faisait pointer les premières barres des graves sur les mêmes bins 1-2
// (colonnes jumelles identiques). Cap à maxBin (jamais atteint en pratique :
// barCount << bins utilisables).
function _monotonicBin(rawBin, lastBin, maxBin) {
  return Math.min(Math.max(rawBin, lastBin + 1), maxBin);
}

// Dessine un mini-visualiseur de fréquences sur le canvas de la barre de volume.
// Appelé à chaque frame drawVizFrame() — le canvas est très petit donc perf négligeable.
function _drawVolVis(data, lerpRGB) {
  const canvas = document.getElementById('cinema-vol-vis');
  if (!canvas) return;
  if (!_volVisCtx || _volVisCtx.canvas !== canvas) {
    _volVisCtx = canvas.getContext('2d');
    if (!_volVisCtx) return;
  }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (w !== _volVisW || h !== _volVisH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    _volVisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _volVisW = w; _volVisH = h;
  }
  _volVisCtx.clearRect(0, 0, w, h);
  const barCount = 22;
  const bw = w / barCount;
  const totalBins = data.length;
  const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.55);
  _volVisCtx.fillStyle = `rgb(${lerpRGB})`;
  let lastBin = 0;
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = _monotonicBin(Math.round(Math.pow(2, logMin + t * (logMax - logMin))), lastBin, totalBins - 1);
    lastBin   = bin;
    const v   = data[bin] / 255;
    const bh  = Math.max(1, v * h * 0.82);
    _volVisCtx.globalAlpha = 0.07 + v * 0.30;
    _volVisCtx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  }
  _volVisCtx.globalAlpha = 1;
}

// ── Mode Spectre : gradients partagés (recréés seulement si couleur/hauteur changent) ──
// PERF FIX : 2 gradients partagés au lieu de 144 createLinearGradient/frame. `sg` est un
// cache par-session (module scope, réinitialisé dans _startViz) → gradients liés au contexte courant.
function _buildSpectrumGradients(ctx, h, midY, lerpRGB, sg) {
  sg.rgb = lerpRGB; sg.midY = midY;
  sg.top = ctx.createLinearGradient(0, 0, 0, midY);
  sg.top.addColorStop(0,    `rgba(${lerpRGB},1)`);
  sg.top.addColorStop(0.65, `rgba(${lerpRGB},0.5)`);
  sg.top.addColorStop(1,    `rgba(${lerpRGB},0.08)`);
  sg.bot = ctx.createLinearGradient(0, midY, 0, h);
  sg.bot.addColorStop(0,    `rgba(${lerpRGB},0.08)`);
  sg.bot.addColorStop(0.35, `rgba(${lerpRGB},0.5)`);
  sg.bot.addColorStop(1,    `rgba(${lerpRGB},1)`);
  // rgb() glow/ligne centrale — reconstruit avec les gradients (même clé d'invalidation).
  _glowFillCache = `rgb(${lerpRGB})`;
}

// ── Mode Spectre : barres bilatérales logarithmiques + glow ──
// Task 4 : signature sans `analyser` — totalBins = data.length (identique à
// analyser.frequencyBinCount, une indirection en moins). Retourne true si au moins
// une barre a une énergie visible (v > 0.004) — needsFrames pour cinema-loop.js.
function _drawSpectrumBars(ctx, data, w, h, lerpRGB, sg) {
  const barCount = 72;
  const bw    = w / barCount;
  const midY  = h / 2;
  const rr    = 3;
  const gap   = 1;
  const totalBins = data.length;
  const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.72);
  if (lerpRGB !== sg.rgb || midY !== sg.midY) _buildSpectrumGradients(ctx, h, midY, lerpRGB, sg);
  const _glowFill = _glowFillCache; // rgb() sans alpha (globalAlpha gère l'opacité par barre)
  let lastBin = 0;
  let anyVisible = false;
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = _monotonicBin(Math.round(Math.pow(2, logMin + t * (logMax - logMin))), lastBin, totalBins - 1);
    lastBin   = bin;
    const v   = data[bin] / 255;
    if (v > 0.004) anyVisible = true;
    const bh  = Math.max(2, v * midY * 0.94);
    const a   = 0.08 + v * 0.75;
    const x   = i * bw + 1, bww = Math.max(1, bw - 2);
    ctx.globalAlpha = a;
    if (ctx.roundRect) {
      ctx.fillStyle = sg.top;
      ctx.beginPath(); ctx.roundRect(x, midY - bh - gap, bww, bh, [rr, rr, 0, 0]); ctx.fill();
      ctx.fillStyle = sg.bot;
      ctx.beginPath(); ctx.roundRect(x, midY + gap, bww, bh, [0, 0, rr, rr]); ctx.fill();
    } else {
      ctx.fillStyle = sg.top; ctx.fillRect(x, midY - bh - gap, bww, bh);
      ctx.fillStyle = sg.bot; ctx.fillRect(x, midY + gap, bww, bh);
    }
    ctx.globalAlpha = 1;
    if (v > 0.25) {
      ctx.fillStyle   = _glowFill;
      ctx.globalAlpha = Math.round(v * 14) / 100;
      const gx = x - 3, gbw = bww + 6;
      ctx.fillRect(gx, midY - bh - gap - 2, gbw, bh + 4);
      ctx.fillRect(gx, midY + gap - 2,       gbw, bh + 4);
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalAlpha = 1; // assure l'état propre après la boucle
  // Ligne centrale subtile — réutilise le cache glow (même couleur)
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = _glowFillCache;
  ctx.fillRect(0, midY - 1, w, 2);
  ctx.globalAlpha = 1;
  return anyVisible;
}

// ── Mode standard (ambient) : barres logarithmiques en bas ──
// Task 4 : signature sans `analyser` — totalBins = data.length. Retourne true si au
// moins une barre a une énergie visible (v > 0.004) — needsFrames pour cinema-loop.js.
function _drawStandardBars(ctx, data, w, h, lerpRGB) {
  const barCount = 56;
  const bw = w / barCount;
  const totalBins = data.length;
  const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.65);
  // PERF : rgb() mis en cache — reconstruit seulement si _lerpRGB a changé (pas par frame)
  if (lerpRGB !== _stdFillRGB) { _stdFillRGB = lerpRGB; _stdFillCache = `rgb(${lerpRGB})`; }
  ctx.fillStyle = _stdFillCache; // set once — no per-bar string alloc (globalAlpha handles per-bar opacity)
  let lastBin = 0;
  let anyVisible = false;
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = _monotonicBin(Math.round(Math.pow(2, logMin + t * (logMax - logMin))), lastBin, totalBins - 1);
    lastBin   = bin;
    const v   = data[bin] / 255;
    if (v > 0.004) anyVisible = true;
    const bh  = Math.max(2, v * h * 0.45);
    const a   = 0.07 + v * 0.38;
    ctx.globalAlpha = a;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(i * bw + 1, h - bh, bw - 2, bh, [3, 3, 0, 0]);
    else               ctx.rect(i * bw + 1, h - bh, bw - 2, bh);
    ctx.fill();
    // Reflet (miroir atténué)
    if (v > 0.15) {
      ctx.globalAlpha = a * 0.25;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(i * bw + 1, h, bw - 2, bh * 0.3, [0, 0, 3, 3]);
      else               ctx.rect(i * bw + 1, h, bw - 2, bh * 0.3);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1; // restore after loop
  return anyVisible;
}

// lerpRGB : chaîne "r,g,b" de la couleur courante interpolée — passée depuis drawVizFrame()
// afin que le flash beat soit cohérent avec l'ambient (même frame de couleur). Le calcul
// d'énergie/détection de beat n'est plus fait ici (cinema-loop.js, beat partagé) : cette
// fonction ne gère plus que l'effet visuel (pulse pochette) quand le beat est déjà avéré.
function _pulseBeat(lerpRGB) {
  // PERF : cache lazy — querySelector une seule fois puis réutilisé
  if (!_artWrapCache) _artWrapCache = document.querySelector('.cinema-art-wrap');
  const artWrap = _artWrapCache;
  if (!artWrap) return;
  artWrap.style.setProperty('--beat-color', `rgba(${lerpRGB},.32)`);
  artWrap.classList.remove('beat');
  requestAnimationFrame(() => artWrap.classList.add('beat'));
  if (_beatTimer) clearTimeout(_beatTimer);
  _beatTimer = setTimeout(() => { artWrap.classList.remove('beat'); _beatTimer = null; }, BEAT_PULSE_MS);
}

/**
 * Setup passif du visualiseur — canvas/ctx/dpr + reset du cache de gradients.
 * Task 4 : plus de rAF, plus de lecture analyser locale (drawVizFrame() reçoit le FFT
 * en paramètre depuis cinema-loop.js). Ne `return`e plus silencieusement un état mort
 * si l'EQ n'est pas encore prêt (rare edge de boot) : le setup canvas/ctx/dpr partiel
 * reste posé — T9 branchera la relance sur l'évènement EQ_READY.
 */
function _startViz() {
  const canvas = document.getElementById('cinema-viz');
  if (!canvas) return;
  _cinVizCanvas = canvas;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    _cinVizCtx = ctx;
    _cinVizDpr = window.devicePixelRatio || 1;
    _cinVizCw  = 0; _cinVizCh = 0; // force la (re)mesure au premier drawVizFrame
    // Cache par-session des gradients spectre — lié au contexte courant (évite la
    // réutilisation d'un CanvasGradient d'un ancien contexte à la réouverture).
    _specGrad = { top: null, bot: null, rgb: '', midY: -1 };
  }
  // Reprise best-effort du contexte suspendu — un rejet (contexte fermé/refusé) ne doit
  // pas casser le viz (B-fix Task 3). eqAnalyser sert de garde "EQ prêt" : sans analyser,
  // il n'y a de toute façon aucun FFT à venir tant que cinema-loop.js n'en a pas un.
  if (eqAnalyser && eqCtx && eqCtx.state === 'suspended') eqCtx.resume().catch(() => {});
  canvas.style.opacity = '1';
}

/**
 * Renderer passif appelé par la boucle MAÎTRE (cinema-loop.js) à chaque frame.
 * Consomme le snapshot FFT et le beat déjà calculés une fois par frame (partagés avec
 * drawBgFrame/vol-vis) — ne lit plus jamais l'analyser lui-même.
 * @param {number} dt — ms écoulées depuis la frame précédente (clampées par l'appelant).
 * @param {Uint8Array|null} fft — snapshot FFT partagé, ou null si aucun analyser dispo.
 * @param {boolean} beat — beat détecté cette frame (déjà gated reduced-motion en amont).
 * @returns {boolean} needsFrames — true si au moins une barre visible a été dessinée.
 */
export function drawVizFrame(dt, fft, beat) {
  if (!_getCinemaOpen()) return false;
  const canvas = _cinVizCanvas;
  if (!canvas || !_cinVizCtx) return false;
  const ctx = _cinVizCtx;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return false;
  if (fft === null) { ctx.clearRect(0, 0, w, h); return false; } // pas de crash cinéma-avant-lecture

  if (w !== _cinVizCw || h !== _cinVizCh) {
    canvas.width  = Math.round(w * _cinVizDpr);
    canvas.height = Math.round(h * _cinVizDpr);
    ctx.setTransform(_cinVizDpr, 0, 0, _cinVizDpr, 0, 0);
    _cinVizCw = w; _cinVizCh = h;
  }
  ctx.clearRect(0, 0, w, h);

  // LERP couleur vers la cible (délégué à cinema-bg.js — état couleur privé, Task 3).
  // SEUL point d'appel de stepArtColorLerp dans tout le cluster cinéma — calculé AVANT
  // le pulse beat et les barres pour que les deux utilisent exactement la même couleur
  // interpolée dans ce frame.
  const dtN = dt / 16.667;
  const _lerpRGB = stepArtColorLerp(dtN);

  if (!prefersReducedMotion() && beat) _pulseBeat(_lerpRGB);
  _drawVolVis(fft, _lerpRGB);

  // Modes avec visualiseur intégré sur cinema-bg : ne pas dessiner les barres sur cinema-viz.
  // Le canvas est clearRect'd chaque frame → propre lors du retour en mode barres. Le pulse
  // pochette ci-dessus n'exige pas de frames supplémentaires en pause (needsFrames = false).
  if (cinemaBg === 'waves' || cinemaBg === 'starfield' || cinemaBg === 'amoled') return false;

  if (cinemaBg === 'spectrum') return _drawSpectrumBars(ctx, fft, w, h, _lerpRGB, _specGrad);
  return _drawStandardBars(ctx, fft, w, h, _lerpRGB);
}

function _stopViz() {
  // Nettoyer le beat timer orphelin (sinon la classe .beat reste si cinema fermé pendant un beat)
  if (_beatTimer) {
    clearTimeout(_beatTimer);
    _beatTimer = null;
    document.querySelector('.cinema-art-wrap')?.classList.remove('beat');
  }
  // Reset du cache DOM — évite une référence stale si l'élément est recréé entre deux ouvertures
  _artWrapCache = null;
  // Reset vol-vis canvas state
  _volVisCtx = null; _volVisW = 0; _volVisH = 0;
  // Reset de l'état de dessin (module scope, Task 4) — assure un _startViz() ultérieur propre
  _cinVizCanvas = null; _cinVizCtx = null; _cinVizCw = 0; _cinVizCh = 0;
  _specGrad = { top: null, bot: null, rgb: '', midY: -1 };
  const canvas = document.getElementById('cinema-viz');
  if (canvas) canvas.style.opacity = '0';
  // Ne pas fermer l'AudioContext — il appartient au module EQ
}
