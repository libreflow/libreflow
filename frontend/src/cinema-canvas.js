// LibreFlow — cinema-canvas.js
// Rendu canvas bas-niveau pour les modes Vagues et Étoiles du mode Cinéma.
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
//
// Exports :
//   drawWavesFrame(ctx, w, h, cinArtRGBCur)
//   drawStarfieldFrame(ctx, w, h, cinArtRGBCur, ambientT)
//   initStarfield()

import { eqAnalyser }                                   from './eq.js';
import { tween, kill as motionKill, eases }             from './motion.js';

// ── Vagues — pré-allocation module scope ────────────────────
// Zéro allocation dans le hot path RAF (CLAUDE.md §10).
const _WAVE_LAYERS  = 7;
const _WAVE_STEPS   = 150;          // segments par couche (qualité / perf)
let _waveBuf        = null;          // Uint8Array(frequencyBinCount) — données FFT
let _waveSmoothed   = null;          // Float32Array — basses fréquences lissées
const _wavePhases   = new Float32Array(_WAVE_LAYERS); // phases de chaque couche
let _waveEnergy     = 0;             // énergie basse freq lissée 0-1
let _waveBeatLast   = 0;             // performance.now() du dernier beat vagues
const _waveBeatObj  = { v: 0 };      // GSAP tween target — boost amplitude au beat
let _waveBeatTw     = null;          // handle GSAP courant
const _waveGrads        = new Array(_WAVE_LAYERS).fill(null); // CanvasGradient de remplissage par couche
const _waveCrestStrokes = new Array(_WAVE_LAYERS).fill('');   // style stroke crête par couche (cachés)
let _waveGradRGB    = '';            // clé d'invalidation — couleur LERP
let _waveGradH      = 0;             // clé d'invalidation — hauteur canvas
// Halo atmosphérique en fond — gradient radial teinté par la pochette
let _waveBgGrad    = null;
let _waveBgGradRGB = '';
let _waveBgGradW   = 0;
let _waveBgGradH   = 0;

// ── Étoiles — pré-allocation module scope ───────────────────
const _STAR_COUNT   = 180;
const _starX        = new Float32Array(_STAR_COUNT);  // positions X normalisées 0-1
const _starY        = new Float32Array(_STAR_COUNT);  // positions Y normalisées 0-1
const _starSize     = new Float32Array(_STAR_COUNT);  // taille base en px
const _starBri      = new Float32Array(_STAR_COUNT);  // luminosité de base 0-1
const _starPhase    = new Float32Array(_STAR_COUNT);  // phase scintillement
const _starSpd      = new Float32Array(_STAR_COUNT);  // vitesse scintillement
let _starsReady     = false;
let _starBuf        = null;          // Uint8Array — données FFT étoiles
let _starHiFBuf     = null;          // Float32Array — hautes fréquences lissées
let _starBassSmooth = 0;             // énergie basse lissée → beat étoile filante
let _starBeatLast   = 0;
const _SHOOT_MAX    = 3;
// Étoiles filantes — objets plain tweenés par GSAP, lus dans le RAF
const _shootPool    = Array.from({ length: _SHOOT_MAX }, () => ({ prog: 0, alpha: 0, x0: 0, y0: 0, x1: 0.3, y1: 0.1 }));
const _shootTweens  = new Array(_SHOOT_MAX).fill(null);
let _shootNext      = 0;

// ── Initialisation étoiles ───────────────────────────────────

/** Initialise les étoiles avec des positions pseudo-aléatoires normalisées 0-1. */
export function initStarfield() {
  for (let i = 0; i < _STAR_COUNT; i++) {
    _starX[i]     = Math.random();
    _starY[i]     = Math.random();
    _starSize[i]  = 0.6 + Math.random() * 2.4;
    _starBri[i]   = 0.25 + Math.random() * 0.75;
    _starPhase[i] = Math.random() * Math.PI * 2;
    _starSpd[i]   = 0.008 + Math.random() * 0.035;
  }
  _starsReady = true;
}

// ── Mode Vagues ──────────────────────────────────────────────

/**
 * Rendu mode Vagues sur #cinema-bg.
 * Appelé depuis la boucle RAF de _startAmbientAnim à 30fps.
 * Zéro allocation en régime stable (gradients cachés par couleur + hauteur).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  largeur CSS px
 * @param {number} h  hauteur CSS px
 * @param {number[]} cinArtRGBCur  tableau [r, g, b] de la couleur LERP courante
 * @param {boolean} isPlaying  true si de l'audio est en cours de lecture
 */
export function drawWavesFrame(ctx, w, h, cinArtRGBCur, isPlaying) {
  if (!eqAnalyser) return;

  // Allocation unique — réallocation seulement si l'analyser change de taille (rare)
  if (!_waveBuf || _waveBuf.length !== eqAnalyser.frequencyBinCount) {
    _waveBuf      = new Uint8Array(eqAnalyser.frequencyBinCount);
    _waveSmoothed = new Float32Array(Math.max(1, Math.floor(eqAnalyser.frequencyBinCount * 0.12)));
  }

  eqAnalyser.getByteFrequencyData(_waveBuf);

  // Lissage basses fréquences → énergie d'amplitude
  const bassEnd = _waveSmoothed.length;
  for (let i = 0; i < bassEnd; i++) {
    _waveSmoothed[i] = _waveSmoothed[i] * 0.82 + _waveBuf[i] * 0.18;
  }
  let rawEnergy = 0;
  for (let i = 0; i < bassEnd; i++) rawEnergy += _waveSmoothed[i];
  rawEnergy /= bassEnd * 255;
  _waveEnergy = _waveEnergy * 0.90 + rawEnergy * 0.10;

  // Détection beat → GSAP tween boost amplitude
  const nowMs = performance.now();
  if (rawEnergy > _waveEnergy * 1.55 && nowMs - _waveBeatLast > 650) {
    _waveBeatLast = nowMs;
    motionKill(_waveBeatObj);
    _waveBeatObj.v = 1;
    _waveBeatTw = tween(_waveBeatObj, {
      v: 0, duration: 0.55, ease: eases.PREMIUM,
      onComplete() { _waveBeatTw = null; },
    });
  }

  const boostMult = 1 + _waveBeatObj.v * 0.65;
  const r = Math.round(cinArtRGBCur[0]);
  const g = Math.round(cinArtRGBCur[1]);
  const b = Math.round(cinArtRGBCur[2]);
  const lerpRGB = `${r},${g},${b}`;

  // ── Fond : noir profond + halo atmosphérique teinté par la pochette ──────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Gradient radial centré légèrement haut — invalidé si couleur ou dimensions changent
  if (lerpRGB !== _waveBgGradRGB || w !== _waveBgGradW || h !== _waveBgGradH) {
    _waveBgGradRGB = lerpRGB; _waveBgGradW = w; _waveBgGradH = h;
    const rx = w * 0.5, ry = h * 0.38, rad = Math.max(w, h) * 0.72;
    _waveBgGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rad);
    _waveBgGrad.addColorStop(0,    `rgba(${lerpRGB},0.16)`);
    _waveBgGrad.addColorStop(0.45, `rgba(${lerpRGB},0.05)`);
    _waveBgGrad.addColorStop(1,    'rgba(0,0,0,0)');
  }
  // Intensité réagit à l'énergie basse + beat — animation sans recréer le gradient
  ctx.globalAlpha = Math.min(1, 0.50 + _waveEnergy * 1.1 + _waveBeatObj.v * 0.5);
  ctx.fillStyle   = _waveBgGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // Avancer les phases — figées en pause, animées à la lecture.
  if (isPlaying) {
    for (let l = 0; l < _WAVE_LAYERS; l++) {
      _wavePhases[l] += (0.006 + l * 0.0025 + _waveEnergy * 0.018) * boostMult;
    }
  }

  // Gradients de remplissage + styles de crête — cache invalidé si couleur LERP ou hauteur change
  if (lerpRGB !== _waveGradRGB || h !== _waveGradH) {
    _waveGradRGB = lerpRGB; _waveGradH = h;
    // Couleur crête : version éclaircie de la couleur art pour un effet brillant
    const crR = Math.min(255, r + 70), crG = Math.min(255, g + 70), crB = Math.min(255, b + 70);
    for (let l = 0; l < _WAVE_LAYERS; l++) {
      // Couches arrière plus denses (profondeur), couches avant plus légères/transparentes
      const alpha0 = 0.12 + (l / (_WAVE_LAYERS - 1)) * 0.26;
      const yBase  = h * (0.25 + l * 0.10);
      const grad   = ctx.createLinearGradient(0, yBase - h * 0.12, 0, h);
      grad.addColorStop(0,    `rgba(${lerpRGB},${alpha0.toFixed(2)})`);
      grad.addColorStop(0.38, `rgba(${lerpRGB},${(alpha0 * 0.52).toFixed(2)})`);
      grad.addColorStop(0.72, `rgba(${lerpRGB},${(alpha0 * 0.15).toFixed(2)})`);
      grad.addColorStop(1,    'rgba(0,0,0,0)');
      _waveGrads[l] = grad;
      // Crête : plus lumineuse sur les vagues avant-plan (petit l = avant)
      const crAlpha = 0.18 + ((_WAVE_LAYERS - 1 - l) / (_WAVE_LAYERS - 1)) * 0.55;
      _waveCrestStrokes[l] = `rgba(${crR},${crG},${crB},${crAlpha.toFixed(2)})`;
    }
  }

  // Dessin des couches de vagues — arrière → avant
  for (let l = _WAVE_LAYERS - 1; l >= 0; l--) {
    const yBase     = h * (0.25 + l * 0.10);
    const amplitude = (0.038 + l * 0.022 + _waveEnergy * 0.22) * h * boostMult;
    const ph        = _wavePhases[l];
    // 4 harmoniques distinctes par couche — formes plus organiques, moins répétitives
    const f1 = 2.1 + l * 0.9, f2 = 1.4 + l * 0.55, f3 = 5.3 + l * 0.4, f4 = 3.7 - l * 0.15;

    // ── Remplissage de la vague ──
    ctx.beginPath();
    for (let s = 0; s <= _WAVE_STEPS; s++) {
      const nx = s / _WAVE_STEPS;
      const y  = yBase
        + Math.sin(nx * Math.PI * f1 + ph)        * amplitude
        + Math.sin(nx * Math.PI * f2 + ph * 1.3)  * amplitude * 0.42
        + Math.sin(nx * Math.PI * f3 + ph * 0.55) * amplitude * 0.16
        + Math.sin(nx * Math.PI * f4 + ph * 0.77) * amplitude * 0.09;
      if (s === 0) ctx.moveTo(nx * w, y);
      else         ctx.lineTo(nx * w, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = _waveGrads[l];
    ctx.fill();

    // ── Crête lumineuse — trait brillant sur le bord supérieur de la vague ──
    ctx.beginPath();
    for (let s = 0; s <= _WAVE_STEPS; s++) {
      const nx = s / _WAVE_STEPS;
      const y  = yBase
        + Math.sin(nx * Math.PI * f1 + ph)        * amplitude
        + Math.sin(nx * Math.PI * f2 + ph * 1.3)  * amplitude * 0.42
        + Math.sin(nx * Math.PI * f3 + ph * 0.55) * amplitude * 0.16
        + Math.sin(nx * Math.PI * f4 + ph * 0.77) * amplitude * 0.09;
      if (s === 0) ctx.moveTo(nx * w, y);
      else         ctx.lineTo(nx * w, y);
    }
    ctx.strokeStyle = _waveCrestStrokes[l];
    ctx.lineWidth   = Math.max(0.7, 2.2 - l * 0.22);  // 2.2px avant → 0.7px arrière
    ctx.stroke();
  }
}

// ── Mode Ciel étoilé ─────────────────────────────────────────

/**
 * Rendu mode Ciel étoilé sur #cinema-bg.
 * Étoiles scintillantes pilotées par les hautes fréquences audio.
 * Étoiles filantes lancées par GSAP au moment des beats.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  largeur CSS px
 * @param {number} h  hauteur CSS px
 * @param {number[]} cinArtRGBCur  tableau [r, g, b] de la couleur LERP courante
 * @param {number} ambientT  temps d'animation en ms (depuis _ambientT de cinema-bg.js)
 */
export function drawStarfieldFrame(ctx, w, h, cinArtRGBCur, ambientT) {
  if (!_starsReady || !eqAnalyser) return;

  // Allocation unique — réallocation seulement si l'analyser change de taille
  if (!_starBuf || _starBuf.length !== eqAnalyser.frequencyBinCount) {
    _starBuf    = new Uint8Array(eqAnalyser.frequencyBinCount);
    _starHiFBuf = new Float32Array(Math.max(1, Math.floor(eqAnalyser.frequencyBinCount * 0.3)));
  }

  eqAnalyser.getByteFrequencyData(_starBuf);

  // Hautes fréquences → intensité de scintillement
  const hiStart = Math.floor(_starBuf.length * 0.55);
  const hiBins  = _starHiFBuf.length;
  let hiEnergy  = 0;
  for (let i = 0; i < hiBins; i++) {
    const v = _starBuf[Math.min(hiStart + i, _starBuf.length - 1)];
    _starHiFBuf[i] = _starHiFBuf[i] * 0.78 + v * 0.22;
    hiEnergy += _starHiFBuf[i];
  }
  hiEnergy /= hiBins * 255;

  // Basses fréquences → beat → étoile filante
  let bassE = 0;
  const bassEnd = Math.max(1, Math.floor(_starBuf.length * 0.10));
  for (let i = 0; i < bassEnd; i++) bassE += _starBuf[i];
  bassE /= bassEnd * 255;
  _starBassSmooth = _starBassSmooth * 0.88 + bassE * 0.12;

  const nowMs = performance.now();
  if (bassE > _starBassSmooth * 1.55 && nowMs - _starBeatLast > 720) {
    _starBeatLast = nowMs;
    _launchShootingStar();
  }

  // Couleur dominante — étoiles légèrement éclairées par l'art
  const r = Math.round(cinArtRGBCur[0]);
  const g = Math.round(cinArtRGBCur[1]);
  const b = Math.round(cinArtRGBCur[2]);
  const sr = Math.min(255, r + 90), sg = Math.min(255, g + 90), sb = Math.min(255, b + 90);
  const starFill = `rgb(${sr},${sg},${sb})`;
  const glowFill = `rgb(${r},${g},${b})`;

  // Fond : noir profond avec légère teinte de l'art
  ctx.fillStyle = `rgba(0,0,${Math.round(b * 0.08)},0.96)`;
  ctx.fillRect(0, 0, w, h);

  const t = ambientT * 0.001; // secondes

  // ── Étoiles ──────────────────────────────────────────────────
  for (let i = 0; i < _STAR_COUNT; i++) {
    const twk = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(_starPhase[i] + t * _starSpd[i] * 5.5));
    const bri = _starBri[i] * twk * (1 + hiEnergy * 0.7);
    const sz  = _starSize[i] * (0.75 + twk * 0.5);
    const px  = _starX[i] * w;
    const py  = _starY[i] * h;

    ctx.globalAlpha = Math.min(1, bri);

    if (sz < 1.2) {
      // Pixels simples — zéro arc() pour les petites étoiles
      ctx.fillStyle = starFill;
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    } else {
      ctx.beginPath();
      ctx.arc(px, py, sz * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = starFill;
      ctx.fill();
      // Halo pour les étoiles les plus brillantes
      if (bri > 0.55 && sz > 1.5) {
        ctx.globalAlpha = bri * 0.12;
        ctx.beginPath();
        ctx.arc(px, py, sz * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = glowFill;
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // ── Étoiles filantes (positions tweenées par GSAP, lues ici) ─
  for (let i = 0; i < _SHOOT_MAX; i++) {
    const st = _shootPool[i];
    if (st.alpha < 0.01) continue;

    const cx = (st.x0 + st.prog * (st.x1 - st.x0)) * w;
    const cy = (st.y0 + st.prog * (st.y1 - st.y0)) * h;
    const ox = st.x0 * w, oy = st.y0 * h;
    const dx = cx - ox, dy = cy - oy;
    const trailLen = Math.hypot(dx, dy);

    if (trailLen > 3) {
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = st.alpha * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-trailLen, -1, trailLen, 2);
      ctx.restore();
    }

    // Tête lumineuse
    ctx.globalAlpha = st.alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Lance une étoile filante GSAP dans le _shootPool (round-robin).
 * Les coordonnées prog et alpha sont tweenées ; le RAF lit les valeurs interpolées.
 */
function _launchShootingStar() {
  const idx  = _shootNext % _SHOOT_MAX;
  _shootNext = (_shootNext + 1) % _SHOOT_MAX;
  const star = _shootPool[idx];
  // Direction naturelle : légèrement diagonale haut-gauche → bas-droite
  star.x0   = 0.05 + Math.random() * 0.55;
  star.y0   = 0.03 + Math.random() * 0.32;
  star.x1   = star.x0 + 0.18 + Math.random() * 0.22;
  star.y1   = star.y0 + 0.04 + Math.random() * 0.14;
  star.prog = 0;
  star.alpha = 1;
  // Kill éventuel tween précédent sur ce slot
  if (_shootTweens[idx]) { motionKill(star); _shootTweens[idx] = null; }
  _shootTweens[idx] = tween(star, {
    prog: 1, alpha: 0,
    duration: 0.85 + Math.random() * 0.55,
    ease: eases.PREMIUM,
    onComplete() { _shootTweens[idx] = null; star.alpha = 0; },
  });
}
