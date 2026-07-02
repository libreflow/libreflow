// LibreFlow — cinema-viz.js
// Visualiseur audio du mode Cinéma (barres spectrales + beat detection).
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
//
// Exports publics :
//   initCinemaVizModule({ getCinemaOpen })
//   startCinemaViz()
//   stopCinemaViz()

import { eqCtx, eqAnalyser }                              from './eq.js';
import { cinemaBg, _cinArtRGBCur, _cinArtRGBTarget, _LERP_K } from './cinema-bg.js';

// ── Constante locale ─────────────────────────────────────────
const BEAT_PULSE_MS = 620;  // durée du pulse visuel sur beat

// ── État module ──────────────────────────────────────────────
let _cinVizRaf    = null;
let _beatTimer    = null; // timer classe .beat — module scope pour pouvoir le nettoyer dans _stopViz()
let _artWrapCache = null; // cache DOM .cinema-art-wrap — module scope pour reset propre dans _stopViz()

// ── Vol-vis canvas (ambient sur la barre de volume) ─────────
let _volVisCtx = null, _volVisW = 0, _volVisH = 0;

// ── PERF : caches de strings couleur — zéro allocation par frame ────────────
// _lerpRGB (et les fillStyle/rgb(...) qui en dérivent) ne sont reconstruits que
// lorsque les composantes RGB arrondies ont réellement changé depuis la frame
// précédente (§ audit perf cinema — cinema-viz.js:201,240,273).
let _lerpRLast = -1, _lerpGLast = -1, _lerpBLast = -1;
let _lerpRGBCache = '0,0,0';
let _glowFillCache = 'rgb(0,0,0)';   // mode spectrum : glow + ligne centrale
let _stdFillRGB    = '';             // mode standard : cache de rgb(${_lerpRGB})
let _stdFillCache  = 'rgb(0,0,0)';

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
  for (let i = 0; i < barCount; i++) {
    const t   = i / barCount;
    const bin = Math.round(Math.pow(2, logMin + t * (logMax - logMin)));
    const v   = data[Math.min(bin, totalBins - 1)] / 255;
    const bh  = Math.max(1, v * h * 0.82);
    _volVisCtx.globalAlpha = 0.07 + v * 0.30;
    _volVisCtx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  }
  _volVisCtx.globalAlpha = 1;
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
  if (ac.state === 'suspended') ac.resume();

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  let   cw  = 0, ch = 0;

  // ── Beat detector ──────────────────────────────────────────
  const BEAT_HISTORY  = 43;   // ~1.4s à 30fps
  const BEAT_THRESH   = 1.35; // énergie > 1.35× moyenne → beat
  const BEAT_COOLDOWN = 650;  // ms entre deux beats — >= durée animation (620ms) pour éviter overlap
  const _beatHistory  = new Float32Array(BEAT_HISTORY);
  let   _beatIdx      = 0;
  let   _beatHistorySum = 0;  // running sum O(1) — évite reduce() dans la hot path (§5)
  let   _lastBeat     = 0;
  // _beatTimer est au scope module (déclaré en haut) pour être nettoyable par _stopViz()

  // lerpRGB : chaîne "r,g,b" de la couleur courante interpolée — passée depuis draw()
  // afin que le flash beat soit cohérent avec l'ambient (même frame de couleur).
  function _detectBeat(data, lerpRGB) {
    // Énergie basses fréquences (premiers 10% des bins)
    const end = Math.floor(data.length * 0.10);
    let energy = 0;
    for (let i = 0; i < end; i++) energy += data[i] * data[i];
    energy /= end;

    // Running sum O(1) — slot calculé une seule fois
    const slot = _beatIdx % BEAT_HISTORY;
    _beatHistorySum -= _beatHistory[slot];
    _beatHistory[slot] = energy;
    _beatHistorySum += energy;
    _beatIdx++;

    // BUG FIX 1 — Warm-up : tant que le buffer n'est pas plein, avg ≈ 0
    // → pratiquement tous les frames déclenchaient un faux beat au démarrage.
    if (_beatIdx < BEAT_HISTORY) return;

    // BUG FIX 2 — Correction de dérive flottante : recompute exact tous les BEAT_HISTORY frames.
    // Les additions/soustractions fp s'accumulent sur de longues sessions et font dériver la moyenne.
    if (_beatIdx % BEAT_HISTORY === 0) {
      _beatHistorySum = 0;
      for (let i = 0; i < BEAT_HISTORY; i++) _beatHistorySum += _beatHistory[i];
    }

    const avg = _beatHistorySum / BEAT_HISTORY;
    const now = performance.now();
    if (energy > avg * BEAT_THRESH && now - _lastBeat > BEAT_COOLDOWN) {
      _lastBeat = now;
      // PERF : cache lazy — querySelector une seule fois puis réutilisé
      if (!_artWrapCache) _artWrapCache = document.querySelector('.cinema-art-wrap');
      const artWrap = _artWrapCache;
      if (artWrap) {
        // BUG FIX 3 — utiliser lerpRGB (couleur interpolée de ce frame) et non _cinArtRGB
        // (snapshot instantané) — cohérence avec le reste de la scène pendant les transitions.
        artWrap.style.setProperty('--beat-color', `rgba(${lerpRGB},.32)`);
        artWrap.classList.remove('beat');
        requestAnimationFrame(() => artWrap.classList.add('beat'));
        if (_beatTimer) clearTimeout(_beatTimer);
        _beatTimer = setTimeout(() => { artWrap.classList.remove('beat'); _beatTimer = null; }, BEAT_PULSE_MS);
      }
    }
  }

  // ── Cache gradients spectre ────────────────────────────────
  // PERF FIX : 2 gradients partagés recalculés seulement quand la couleur ou la hauteur change.
  // Avant : 144 createLinearGradient/frame (72 barres × 2 gradients). Après : max 2/frame,
  // 0 en régime stable (couleur LERP convergée). Gain ~72× sur le GC et le compositing GPU.
  let _specGradTop  = null, _specGradBot  = null;
  let _specGradRGB  = '',   _specGradMidY = -1;

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

    // LERP couleur vers la cible (évite le snap brutal sur changement de piste).
    // Calculé AVANT _detectBeat pour que le flash beat et les barres utilisent
    // exactement la même couleur interpolée dans ce frame (BUG FIX 3 + 4).
    // Convergence guard: snap to target when all channels are within 0.5 to
    // stop running LERP math every frame in steady state (CP-2).
    if (Math.abs(_cinArtRGBCur[0] - _cinArtRGBTarget[0]) < 0.5 &&
        Math.abs(_cinArtRGBCur[1] - _cinArtRGBTarget[1]) < 0.5 &&
        Math.abs(_cinArtRGBCur[2] - _cinArtRGBTarget[2]) < 0.5) {
      _cinArtRGBCur[0] = _cinArtRGBTarget[0];
      _cinArtRGBCur[1] = _cinArtRGBTarget[1];
      _cinArtRGBCur[2] = _cinArtRGBTarget[2];
    } else {
      _cinArtRGBCur[0] += (_cinArtRGBTarget[0] - _cinArtRGBCur[0]) * _LERP_K;
      _cinArtRGBCur[1] += (_cinArtRGBTarget[1] - _cinArtRGBCur[1]) * _LERP_K;
      _cinArtRGBCur[2] += (_cinArtRGBTarget[2] - _cinArtRGBCur[2]) * _LERP_K;
    }
    // PERF : le template literal n'est reconstruit que si les composantes arrondies
    // ont changé — en régime stable (couleur convergée), zéro allocation par frame.
    const _rR = Math.round(_cinArtRGBCur[0]);
    const _rG = Math.round(_cinArtRGBCur[1]);
    const _rB = Math.round(_cinArtRGBCur[2]);
    if (_rR !== _lerpRLast || _rG !== _lerpGLast || _rB !== _lerpBLast) {
      _lerpRLast = _rR; _lerpGLast = _rG; _lerpBLast = _rB;
      _lerpRGBCache = `${_rR},${_rG},${_rB}`;
    }
    const _lerpRGB = _lerpRGBCache;

    _detectBeat(data, _lerpRGB);
    _drawVolVis(data, _lerpRGB);

    // Modes avec visualiseur intégré sur cinema-bg : ne pas dessiner les barres sur cinema-viz.
    // Le canvas est clearRect'd chaque frame → propre lors du retour en mode barres.
    if (cinemaBg === 'waves' || cinemaBg === 'starfield' || cinemaBg === 'amoled') {
      _cinVizRaf = requestAnimationFrame(draw);
      return;
    }

    if (cinemaBg === 'spectrum') {
      // ── Mode Spectre : barres bilatérales logarithmiques + glow ──
      const barCount = 72;
      const bw    = w / barCount;
      const midY  = h / 2;
      const rr    = 3;
      const gap   = 1;
      const totalBins = analyser.frequencyBinCount;
      // Échelle logarithmique : distribue mieux basses/médiums/aigus
      const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.72);

      // PERF FIX : recréer les 2 gradients partagés seulement si couleur ou hauteur a changé.
      // _lerpRGB converge après ~16 frames de LERP → 0 allocation en régime stable.
      // globalAlpha par barre assure la modulation d'opacité individuelle (a = 0.08+v*0.75).
      if (_lerpRGB !== _specGradRGB || midY !== _specGradMidY) {
        _specGradRGB = _lerpRGB; _specGradMidY = midY;
        _specGradTop = ctx.createLinearGradient(0, 0, 0, midY);
        _specGradTop.addColorStop(0,    `rgba(${_lerpRGB},1)`);
        _specGradTop.addColorStop(0.65, `rgba(${_lerpRGB},0.5)`);
        _specGradTop.addColorStop(1,    `rgba(${_lerpRGB},0.08)`);
        _specGradBot = ctx.createLinearGradient(0, midY, 0, h);
        _specGradBot.addColorStop(0,    `rgba(${_lerpRGB},0.08)`);
        _specGradBot.addColorStop(0.35, `rgba(${_lerpRGB},0.5)`);
        _specGradBot.addColorStop(1,    `rgba(${_lerpRGB},1)`);
        // PERF : rgb() glow/ligne centrale — reconstruit seulement avec les gradients
        // (même clé d'invalidation _lerpRGB/_specGradMidY) au lieu de chaque frame.
        _glowFillCache = `rgb(${_lerpRGB})`;
      }

      // Glow fillStyle mis en cache — rgb() sans alpha (globalAlpha gère l'opacité par barre)
      const _glowFill = _glowFillCache;
      for (let i = 0; i < barCount; i++) {
        const t   = i / barCount;
        const bin = Math.round(Math.pow(2, logMin + t * (logMax - logMin)));
        const v   = data[Math.min(bin, totalBins - 1)] / 255;
        const bh  = Math.max(2, v * midY * 0.94);
        const a   = 0.08 + v * 0.75;
        const x   = i * bw + 1, bww = Math.max(1, bw - 2);
        // Opacité par barre via globalAlpha — gradient partagé fournit le dégradé spatial
        ctx.globalAlpha = a;
        if (ctx.roundRect) {
          ctx.fillStyle = _specGradTop;
          ctx.beginPath(); ctx.roundRect(x, midY - bh - gap, bww, bh, [rr, rr, 0, 0]); ctx.fill();
          ctx.fillStyle = _specGradBot;
          ctx.beginPath(); ctx.roundRect(x, midY + gap, bww, bh, [0, 0, rr, rr]); ctx.fill();
        } else {
          ctx.fillStyle = _specGradTop; ctx.fillRect(x, midY - bh - gap, bww, bh);
          ctx.fillStyle = _specGradBot; ctx.fillRect(x, midY + gap, bww, bh);
        }
        ctx.globalAlpha = 1;
        // Glow — fillStyle set once before loop (rgb, no alpha); globalAlpha handles per-bar opacity
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

    } else {
      // ── Mode standard (ambient) : barres logarithmiques en bas ──
      const barCount = 56;
      const bw = w / barCount;
      const totalBins = analyser.frequencyBinCount;
      const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.65);
      // PERF : rgb() mis en cache — reconstruit seulement si _lerpRGB a changé (pas par frame)
      if (_lerpRGB !== _stdFillRGB) { _stdFillRGB = _lerpRGB; _stdFillCache = `rgb(${_lerpRGB})`; }
      ctx.fillStyle = _stdFillCache; // set once — no per-bar string alloc (globalAlpha handles per-bar opacity)
      for (let i = 0; i < barCount; i++) {
        const t   = i / barCount;
        const bin = Math.round(Math.pow(2, logMin + t * (logMax - logMin)));
        const v   = data[Math.min(bin, totalBins - 1)] / 255;
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
    _cinVizRaf = requestAnimationFrame(draw);
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
