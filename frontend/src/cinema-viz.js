// LibreFlow — cinema-viz.js
// Visualiseur audio du mode Cinéma (barres spectrales + beat detection).
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
//
// Exports publics :
//   initCinemaVizModule({ getCinemaOpen })
//   startCinemaViz()
//   stopCinemaViz()

import { eqCtx, eqAnalyser }              from './eq.js';
import { cinemaBg, stepArtColorLerp }     from './cinema-bg.js';
import { createBeatDetector }             from './cinema-beat.js';
import { prefersReducedMotion }           from './motion.js';

// ── Constantes ───────────────────────────────────────────────
const BEAT_PULSE_MS = 620;  // durée du pulse visuel sur beat
// Beat detector pochette — fenêtre glissante. Valeurs inchangées (Task 3).
const BEAT_HISTORY  = 43;   // ~1.4s à 30fps
const BEAT_THRESH   = 1.35; // énergie > 1.35× moyenne → beat
const BEAT_COOLDOWN = 650;  // ms entre deux beats — >= durée animation (620ms) pour éviter overlap

// ── État module ──────────────────────────────────────────────
let _cinVizRaf    = null;
let _beatTimer    = null; // timer classe .beat — module scope pour pouvoir le nettoyer dans _stopViz()
let _artWrapCache = null; // cache DOM .cinema-art-wrap — module scope pour reset propre dans _stopViz()

// ── Vol-vis canvas (ambient sur la barre de volume) ─────────
let _volVisCtx = null, _volVisW = 0, _volVisH = 0;

// ── PERF : caches de strings couleur — zéro allocation par frame ────────────
// Le cache de la string LERP _lerpRGB vit désormais dans stepArtColorLerp()
// (cinema-bg.js, Task 3). Ici on ne cache que les fillStyle rgb(...) qui en dérivent,
// reconstruits seulement quand _lerpRGB change (pas par frame).
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
// Appelé à chaque frame draw() — le canvas est très petit donc perf négligeable.
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
// cache par-session (créé dans _startViz) → gradients liés au contexte courant.
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
function _drawSpectrumBars(ctx, data, w, h, analyser, lerpRGB, sg) {
  const barCount = 72;
  const bw    = w / barCount;
  const midY  = h / 2;
  const rr    = 3;
  const gap   = 1;
  const totalBins = analyser.frequencyBinCount;
  const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.72);
  if (lerpRGB !== sg.rgb || midY !== sg.midY) _buildSpectrumGradients(ctx, h, midY, lerpRGB, sg);
  const _glowFill = _glowFillCache; // rgb() sans alpha (globalAlpha gère l'opacité par barre)
  let lastBin = 0;
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = _monotonicBin(Math.round(Math.pow(2, logMin + t * (logMax - logMin))), lastBin, totalBins - 1);
    lastBin   = bin;
    const v   = data[bin] / 255;
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
}

// ── Mode standard (ambient) : barres logarithmiques en bas ──
function _drawStandardBars(ctx, data, w, h, analyser, lerpRGB) {
  const barCount = 56;
  const bw = w / barCount;
  const totalBins = analyser.frequencyBinCount;
  const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.65);
  // PERF : rgb() mis en cache — reconstruit seulement si _lerpRGB a changé (pas par frame)
  if (lerpRGB !== _stdFillRGB) { _stdFillRGB = lerpRGB; _stdFillCache = `rgb(${lerpRGB})`; }
  ctx.fillStyle = _stdFillCache; // set once — no per-bar string alloc (globalAlpha handles per-bar opacity)
  let lastBin = 0;
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = _monotonicBin(Math.round(Math.pow(2, logMin + t * (logMax - logMin))), lastBin, totalBins - 1);
    lastBin   = bin;
    const v   = data[bin] / 255;
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
}

function _startViz() {
  const canvas = document.getElementById('cinema-viz');
  if (!canvas) return;

  // ──────────────────────────────────────────────────────────
  // Réutiliser le graphe audio de l'EQ (eqCtx + eqAnalyser).
  // L'EQ a déjà appelé createMediaElementSource sur window.audio —
  // on ne peut pas en créer un second : on lit simplement eqAnalyser.
  // ──────────────────────────────────────────────────────────
  const analyser = eqAnalyser; // live binding depuis eq.js
  const ac       = eqCtx;

  if (!analyser || !ac) {
    // L'EQ n'est pas encore initialisé (rare) — on essaiera à la prochaine ouverture
    return;
  }
  // Reprise best-effort du contexte suspendu — un rejet (contexte fermé/refusé)
  // ne doit pas casser le viz (B-fix Task 3 : .catch sur ac.resume()).
  if (ac.state === 'suspended') ac.resume().catch(() => {});

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  let   cw  = 0, ch = 0;

  // ── Beat detector pochette (fenêtre glissante partagée — cinema-beat.js) ──
  const beatDet = createBeatDetector({ history: BEAT_HISTORY, threshold: BEAT_THRESH, cooldownMs: BEAT_COOLDOWN });
  // _beatTimer est au scope module (déclaré en haut) pour être nettoyable par _stopViz()

  // lerpRGB : chaîne "r,g,b" de la couleur courante interpolée — passée depuis draw()
  // afin que le flash beat soit cohérent avec l'ambient (même frame de couleur).
  function _detectBeat(data, lerpRGB) {
    // Énergie basses fréquences (premiers 10% des bins)
    const end = Math.floor(data.length * 0.10);
    let energy = 0;
    for (let i = 0; i < end; i++) energy += data[i] * data[i];
    energy /= end;

    if (!beatDet.sample(energy, performance.now())) return;
    // PERF : cache lazy — querySelector une seule fois puis réutilisé
    if (!_artWrapCache) _artWrapCache = document.querySelector('.cinema-art-wrap');
    const artWrap = _artWrapCache;
    if (artWrap) {
      // utiliser lerpRGB (couleur interpolée de ce frame) — cohérence avec le reste de la scène.
      artWrap.style.setProperty('--beat-color', `rgba(${lerpRGB},.32)`);
      artWrap.classList.remove('beat');
      requestAnimationFrame(() => artWrap.classList.add('beat'));
      if (_beatTimer) clearTimeout(_beatTimer);
      _beatTimer = setTimeout(() => { artWrap.classList.remove('beat'); _beatTimer = null; }, BEAT_PULSE_MS);
    }
  }

  // Cache par-session des gradients spectre — lié au contexte courant (évite la réutilisation
  // d'un CanvasGradient d'un ancien contexte à la réouverture).
  const specGrad = { top: null, bot: null, rgb: '', midY: -1 };

  // PERF : pré-allouer hors du loop draw — évite new Uint8Array(1024) à chaque frame.
  // `let` (et non `const`) : draw() le recrée si analyser.frequencyBinCount change.
  let _vizBuf = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    if (!_getCinemaOpen()) return;
    if (document.hidden) { _cinVizRaf = requestAnimationFrame(draw); return; } // BUG-D3A-2: skip render when tab hidden, keep RAF alive
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Bug 7 fix : skip si le canvas n'est pas encore rendu (dimensions nulles).
    if (w === 0 || h === 0) { _cinVizRaf = requestAnimationFrame(draw); return; }
    if (w !== cw || h !== ch) {
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cw = w; ch = h;
    }
    ctx.clearRect(0, 0, w, h);

    // Recréer le buffer si l'AudioContext a changé de frequencyBinCount (FFT resize / ctx recréé)
    if (_vizBuf.length !== analyser.frequencyBinCount) {
      _vizBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(_vizBuf);
    const data = _vizBuf;

    // LERP couleur vers la cible (délégué à cinema-bg.js — état couleur privé, Task 3).
    // Calculé AVANT _detectBeat pour que le flash beat et les barres utilisent
    // exactement la même couleur interpolée dans ce frame.
    const _lerpRGB = stepArtColorLerp();

    _detectBeat(data, _lerpRGB);
    _drawVolVis(data, _lerpRGB);

    // Modes avec visualiseur intégré sur cinema-bg : ne pas dessiner les barres sur cinema-viz.
    // Le canvas est clearRect'd chaque frame → propre lors du retour en mode barres.
    if (cinemaBg === 'waves' || cinemaBg === 'starfield' || cinemaBg === 'amoled') {
      // A11Y SC 2.3.3 : frame statique sous reduced-motion — pas de replanification rAF.
      if (!prefersReducedMotion()) _cinVizRaf = requestAnimationFrame(draw);
      return;
    }

    if (cinemaBg === 'spectrum') _drawSpectrumBars(ctx, data, w, h, analyser, _lerpRGB, specGrad);
    else                         _drawStandardBars(ctx, data, w, h, analyser, _lerpRGB);

    // A11Y SC 2.3.3 : frame statique sous reduced-motion — pas de replanification rAF.
    if (!prefersReducedMotion()) _cinVizRaf = requestAnimationFrame(draw);
  }

  if (_cinVizRaf) cancelAnimationFrame(_cinVizRaf);
  draw();
  canvas.style.opacity = '1';
}

function _stopViz() {
  if (_cinVizRaf) { cancelAnimationFrame(_cinVizRaf); _cinVizRaf = null; }
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
  const canvas = document.getElementById('cinema-viz');
  if (canvas) canvas.style.opacity = '0';
  // Ne pas fermer l'AudioContext — il appartient au module EQ
}
