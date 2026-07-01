// LibreFlow — cinema-bg.js
// Gestion de l'arrière-plan du mode Cinéma : modes, gradient ambient, animation RAF.
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
//
// Exports publics :
//   cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS
//   initCinemaBg, setCinemaBg, syncCinemaBgSettings, cycleCinemaBg, applyCinemaBg
//   updateCinemaBgBtn
//   initCinemaBgModule
//   _cinArtRGBCur, _cinArtRGBTarget, _LERP_K
//   getArtColorStr, setArtColorStr
//   updateCinArtColor, updateCinArtRGBFromTrack
//   startAmbientAnim, stopAmbientAnim, resetAmbientColors, updateAmbientGradient

import { i18n }                               from './i18n.js';
import { get, set }                           from './store.js';
import { saveCfg }                            from './cfgsave.js';
import { toast }                              from './ui.js';
import { rgbToHsl, hslToRgb, boostSat, sampleArtColors } from './artcolor.js';
import { renderAmbientFrame }                 from './ambientRenderer.js';
import { drawWavesFrame, drawStarfieldFrame, initStarfield } from './cinema-canvas.js';

// ── Modes d'arrière-plan ─────────────────────────────────────
export let cinemaBg       = 'ambient'; // default mode

export const CINEMA_BG_MODES  = ['ambient', 'spectrum', 'amoled', 'waves', 'starfield'];
export const CINEMA_BG_LABELS = {
  ambient:   'Ambient',
  spectrum:  'Spectrum',
  amoled:    'AMOLED',
  waves:     'Waves',
  starfield: 'Starfield',
};
const CINEMA_BG_ICONS = {
  ambient:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" opacity=".5"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="21"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="21" y2="12"/></svg>`,
  spectrum:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4"  y1="20" x2="4"  y2="12"/><line x1="8"  y1="20" x2="8"  y2="6"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="16" y1="20" x2="16" y2="9"/><line x1="20" y1="20" x2="20" y2="14"/></svg>`,
  amoled:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".4"/></svg>`,
  waves:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 8 0"/></svg>`,
  starfield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/><circle cx="4" cy="5" r="0.8" fill="currentColor" opacity=".5"/><circle cx="20" cy="6" r="0.7" fill="currentColor" opacity=".4"/><circle cx="3" cy="18" r="0.6" fill="currentColor" opacity=".35"/></svg>`,
};

// ── Constantes d'animation ───────────────────────────────────
const AMBIENT_CROSSFADE_MS = 1400;  // durée du cross-fade ambient

// ── Couleur dominante de la pochette ────────────────────────
// (même principe que _vizRGB dans viz.js — évite la lecture async artColor dans le loop rAF)
let          _cinArtRGB       = '255,255,255'; // couleur courante (interpolée) — privée
export const _cinArtRGBTarget = [255, 255, 255]; // couleur cible — exportée par référence
export const _cinArtRGBCur    = [255, 255, 255]; // couleur affichée (LERP) — exportée par référence
export const _LERP_K          = 0.06;            // vitesse de transition (~16 frames → 50% done)

export function getArtColorStr() { return _cinArtRGB; }
export function setArtColorStr(str) { _cinArtRGB = str; }

// ── Ambient animation state ──────────────────────────────────
let _ambientAnimRaf = null;   // RAF handle for continuous breathing loop
let _ambientT       = 0;      // animation time in ms — persists across tracks
let _ambientColors  = null;   // { cT, cL, cR } — rebuilt each track change
let _ambientCross   = null;   // { snapshot, start, dur } — active cross-fade
let _frameCount     = 0;      // frame counter for ambient 30fps cap
let _ambientGen     = 0;      // génération courante — incrémentée à chaque _stopAmbientAnim() pour invalider les loops orphelins
let _cinBgCtx       = null;   // cache du contexte 2D de #cinema-bg (évite getContext() par frame)
let _starsInited    = false;  // flag pour éviter double _initStarfield

// ── Callback pour accéder à l'état de cinema.js sans créer de cycle d'import ──
let _getCinemaOpen   = () => false;
let _doUpdateCinema  = () => {};
let _getIsPlaying    = () => true;  // défaut : considéré en lecture

/**
 * Doit être appelé une seule fois depuis cinema.js après l'initialisation du module.
 * Fournit un accès à cinemaOpen, updateCinema() et isPlaying() sans cycle d'import.
 */
export function initCinemaBgModule({ getCinemaOpen, onUpdateCinema, getIsPlaying }) {
  _getCinemaOpen  = getCinemaOpen;
  _doUpdateCinema = onUpdateCinema || (() => {});
  if (getIsPlaying) _getIsPlaying = getIsPlaying;
}

// ── Modes d'arrière-plan ─────────────────────────────────────

/** Initialise cinemaBg depuis la config au démarrage (pas de side-effects DOM/saveCfg). */
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
  // Synchroniser la pochette dans cinema-bg si disponible
  // Bug 6 fix : plImg.src est TOUJOURS truthy (retourne l'URL absolue de la page si vide)
  //             → utiliser getAttribute('src') qui retourne null si l'attribut est absent
  const cinBg = document.getElementById('cinema-bg');
  // Arrêter l'animation breathing avant tout switch de mode
  _stopAmbientAnim();
  _ambientColors = null;
  // Vider le canvas immédiatement à chaque switch (évite interférence entre modes)
  if (cinBg?.getContext) {
    const c = _cinBgCtx || cinBg.getContext('2d');
    if (c) c.clearRect(0, 0, cinBg.width || 1, cinBg.height || 1);
  }
  // ambient/amoled : gradient/halo. waves/starfield : rendu canvas propre avec RAF.
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled' || cinemaBg === 'waves' || cinemaBg === 'starfield') _updateAmbientGradient();
  // Bug #9 fix : rafraîchir l'UI cinéma (pochette, infos piste, contrôles) après chaque
  // switch de mode — sans ça la pochette flou reste stale après cycleCinemaBg().
  if (_getCinemaOpen()) _doUpdateCinema();
}

export function updateCinemaBgBtn() {
  const btn = document.getElementById('cinema-bg-btn');
  if (!btn) return;
  // Fallback sur 'ambient' si mode inconnu (CINEMA_BG_ICONS n'a pas de clé 'blur')
  btn.innerHTML = CINEMA_BG_ICONS[cinemaBg] || CINEMA_BG_ICONS.ambient;
  const label = CINEMA_BG_LABELS[cinemaBg] || cinemaBg;
  btn.title = i18n('t_cinema_bg', label) + ' [B]';
}

// ── Ambient animation helpers ────────────────────────────────

/** Extract and boost 3 ambient colours from artwork (or fallback to _cinArtRGB). */
function _buildAmbientColors() {
  const img = document.getElementById('cinema-art-img');
  if (img && img.naturalWidth && img.style.display !== 'none') {
    const colors = sampleArtColors(img, 64);
    if (colors) return colors;
  }
  const [rF, gF, bF] = _cinArtRGB.split(',').map(Number);
  const cT = boostSat(rF, gF, bF);
  const [hF, sF, lF] = rgbToHsl(...cT);
  return {
    cT,
    cL: hslToRgb((hF + 38) % 360, Math.min(1, sF), lF),
    cR: hslToRgb((hF - 32 + 360) % 360, Math.min(1, sF), lF),
  };
}

/** Stop the breathing animation loop and clear any pending cross-fade. */
function _stopAmbientAnim() {
  _ambientGen++; // invalider tous les loops RAF orphelins
  if (_ambientAnimRaf) { cancelAnimationFrame(_ambientAnimRaf); _ambientAnimRaf = null; }
  _ambientCross = null;
}

/** Start the continuous breathing animation RAF loop. No-op if already running. */
function _startAmbientAnim() {
  if (_ambientAnimRaf) return;
  const myGen = _ambientGen; // capturer le token de génération courante
  let last = performance.now();
  function loop(now) {
    // Guard génération : si _stopAmbientAnim() a été appelé depuis, ce loop est orphelin
    if (myGen !== _ambientGen) return;
    // Boucle active pour ambient, amoled, waves et starfield
    if ((cinemaBg !== 'ambient' && cinemaBg !== 'amoled' && cinemaBg !== 'waves' && cinemaBg !== 'starfield') || !_getCinemaOpen() || document.hidden) {
      last = now;  // prevent time-jump on resume (BUG-D3A-7)
      _ambientAnimRaf = null;
      return;
    }
    // 30fps cap pour ambient, waves et starfield — skip odd frames to halve GPU load
    if (cinemaBg !== 'amoled' && _frameCount++ % 2 !== 0) {
      _ambientAnimRaf = requestAnimationFrame(loop);
      return;
    }
    _ambientT += now - last;
    last = now;
    const canvas = document.getElementById('cinema-bg');
    if (!canvas) { _ambientAnimRaf = null; return; }
    // Cache le contexte 2D — getContext() une seule fois tant que le canvas est le même.
    // FIX HiDPI : si le cache est invalide, ré-appliquer setTransform après getContext().
    if (!_cinBgCtx || _cinBgCtx.canvas !== canvas) {
      _cinBgCtx = canvas.getContext('2d');
      if (!_cinBgCtx) { _ambientAnimRaf = requestAnimationFrame(loop); return; }
      const _dpr = window.devicePixelRatio || 1;
      _cinBgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    }
    const _cW = window.innerWidth || 1280, _cH = window.innerHeight || 800;
    if (cinemaBg === 'waves') {
      drawWavesFrame(_cinBgCtx, _cW, _cH, _cinArtRGBCur, _getIsPlaying());
    } else if (cinemaBg === 'starfield') {
      drawStarfieldFrame(_cinBgCtx, _cW, _cH, _cinArtRGBCur, _ambientT);
    } else {
      // ambient / amoled
      renderAmbientFrame(_ambientT, canvas, _cinBgCtx, cinemaBg, _cinArtRGB, _ambientColors);
      // ── Cross-fade overlay — draw old snapshot fading out ────────
      if (_ambientCross) {
        const { snapshot, start, dur } = _ambientCross;
        const p    = Math.min(1, (now - start) / dur);
        // easeInOutQuad : transition symétrique qui passe vite au milieu (50/50 blend)
        // et ralentit aux extrêmes → moins de "boue" chromatique lors du cross-fade.
        const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        // FIX HiDPI : ctx est transformé en CSS px → dessiner le snapshot aux dimensions CSS.
        _cinBgCtx.globalAlpha = 1 - ease;
        _cinBgCtx.drawImage(snapshot, 0, 0, _cW, _cH);
        _cinBgCtx.globalAlpha = 1;
        if (p >= 1) _ambientCross = null;
      }
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
  // FIX HiDPI : le backing store doit être en pixels physiques.
  // Sans ça, le canvas est rendu en pixels CSS 1:1 → flou sur écrans 2×.
  const PW  = Math.round(W * dpr);
  const PH  = Math.round(H * dpr);

  // Mode AMOLED : halo coloré simple, animé via le même loop RAF qu'ambient.
  // Il n'a pas besoin de _ambientColors (utilise _cinArtRGB directement).
  // FIX : la garde `if (cinemaBg !== 'ambient') return` empêchait _startAmbientAnim()
  // d'être appelée → canvas vide en mode AMOLED. On isole le cas AMOLED ici.
  if (cinemaBg === 'amoled') {
    _stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Pas de _buildAmbientColors ni de cross-fade pour AMOLED
    _startAmbientAnim();
    return;
  }

  if (cinemaBg === 'waves') {
    _stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _startAmbientAnim();
    return;
  }

  if (cinemaBg === 'starfield') {
    _stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!_starsInited) { initStarfield(); _starsInited = true; }
    _startAmbientAnim();
    return;
  }

  if (cinemaBg !== 'ambient') return;

  // Snapshot current canvas for cross-fade (only if colors already exist)
  let snapshot = null;
  if (_ambientColors && canvas.width > 0 && canvas.height > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = PW; snapshot.height = PH;
    const snapCtx = snapshot.getContext('2d');
    if (snapCtx) snapCtx.drawImage(canvas, 0, 0, PW, PH);
  }

  _stopAmbientAnim();
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

// ── Wrappers exportés pour cinema.js ────────────────────────

/** Démarre l'animation ambient (visibilitychange handler dans cinema.js). */
export function startAmbientAnim() { _startAmbientAnim(); }

/** Arrête l'animation ambient (closeCinema dans cinema.js). */
export function stopAmbientAnim()  { _stopAmbientAnim(); }

/** Remet _ambientColors à null (closeCinema dans cinema.js). */
export function resetAmbientColors() { _ambientColors = null; }

/** Recalcule le gradient ambient (updateCinema dans cinema.js). */
export function updateAmbientGradient() { _updateAmbientGradient(); }

// ── Couleur dominante de la pochette ────────────────────────

function _parseColorToRGB(str) {
  if (!str || str === 'transparent') return null;
  if (str.startsWith('rgb')) {
    const m = str.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return `${m[1]},${m[2]},${m[3]}`;
  }
  if (str.startsWith('#') && str.length >= 7) {
    const r = parseInt(str.slice(1, 3), 16);
    const g = parseInt(str.slice(3, 5), 16);
    const b = parseInt(str.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }
  return null;
}

/**
 * Appelé depuis app.js/applyArtColor() — pousse la couleur dominante immédiatement
 * sans attendre updateCinema().
 */
export function updateCinArtColor(hex) {
  const rgb = _parseColorToRGB(hex);
  if (rgb) {
    const parts = rgb.split(',').map(Number);
    _cinArtRGBTarget[0] = parts[0]; _cinArtRGBTarget[1] = parts[1]; _cinArtRGBTarget[2] = parts[2];
    _cinArtRGB = rgb; // mise à jour immédiate du fallback statique
  } else {
    _cinArtRGBTarget[0] = 255; _cinArtRGBTarget[1] = 255; _cinArtRGBTarget[2] = 255;
    _cinArtRGB = '255,255,255';
  }
}

/**
 * Met à jour _cinArtRGB depuis artColor de la piste, avec fallback sur --art-color CSS.
 * Même principe que updateVizColor() dans viz.js.
 * Mute _cinArtRGBTarget in-place (const array exporté par référence).
 * Retourne la chaîne _cinArtRGB courante pour que cinema.js puisse l'utiliser.
 */
export function updateCinArtRGBFromTrack(t) {
  // 1. Priorité : artColor sur l'objet track
  const parsed = _parseColorToRGB(t?.artColor);
  if (parsed) {
    _cinArtRGB = parsed;
    const rgb = parsed.split(',').map(Number);
    _cinArtRGBTarget[0] = rgb[0]; _cinArtRGBTarget[1] = rgb[1]; _cinArtRGBTarget[2] = rgb[2];
    return _cinArtRGB;
  }
  // 2. Fallback : CSS variable --art-color
  const css = getComputedStyle(document.documentElement).getPropertyValue('--art-color').trim();
  const parsed2 = _parseColorToRGB(css);
  if (parsed2) {
    _cinArtRGB = parsed2;
    const rgb2 = parsed2.split(',').map(Number);
    _cinArtRGBTarget[0] = rgb2[0]; _cinArtRGBTarget[1] = rgb2[1]; _cinArtRGBTarget[2] = rgb2[2];
    return _cinArtRGB;
  }
  // 3. Blanc neutre
  _cinArtRGB = '255,255,255';
  _cinArtRGBTarget[0] = 255; _cinArtRGBTarget[1] = 255; _cinArtRGBTarget[2] = 255;
  return _cinArtRGB;
}
