// LibreFlow — cinema-bg.js
// Gestion de l'arrière-plan du mode Cinéma : modes, gradient ambient, rendu passif.
// Extrait de cinema.js pour respecter la limite de 800 lignes par fichier (CLAUDE.md §16).
// Task 3 : cinema-bg.js n'a plus de boucle rAF propre — la boucle MAÎTRE vit dans
// cinema-loop.js, qui appelle drawBgFrame(dt, fft, beat) à chaque frame.
//
// Exports publics :
//   cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS
//   initCinemaBg, setCinemaBg, syncCinemaBgSettings, cycleCinemaBg, applyCinemaBg, updateCinemaBgBtn
//   initCinemaBgModule
//   getArtColorStr, setArtColorStr, snapArtColor, stepArtColorLerp, isArtColorConverged
//   updateCinArtColor, updateCinArtRGBFromTrack
//   NB : l'état couleur (_cinArtRGBCur/_cinArtRGBTarget/_LERP_K) est PRIVÉ (Task 3) —
//        muté uniquement ici via snapArtColor()/stepArtColorLerp(), jamais par référence.
//   drawBgFrame — renderer passif appelé par cinema-loop.js
//   startAmbientAnim, stopAmbientAnim, resetAmbientColors, updateAmbientGradient, updateCachedWinSize

import { i18n }                               from './i18n.js';
import { get, set }                           from './store.js';
import { saveCfg }                            from './cfgsave.js';
import { toast }                              from './ui.js';
import { rgbToHsl, hslToRgb, boostSat, sampleArtColors } from './artcolor.js';
import { renderAmbientFrame }                 from './ambientRenderer.js';
import { drawWavesFrame, drawStarfieldFrame, initStarfield, killCanvasTweens, getMaxBandEnergy } from './cinema-canvas.js';
import { prefersReducedMotion }               from './motion.js';
import { wakeCinemaLoop }                     from './cinema-loop.js';

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
const AMBIENT_CROSSFADE_MS = 1400;  // durée du cross-fade ambient (recolorisation piste)
const MODE_CROSSFADE_MS    = 600;   // durée du cross-fade à la bascule de mode (touche B)

// ── Couleur dominante de la pochette ────────────────────────
// (même principe que _vizRGB dans viz.js — évite la lecture async artColor dans le loop rAF)
let   _cinArtRGB       = '255,255,255'; // fallback statique courant (chaîne "r,g,b") — privé
const _cinArtRGBTarget = [255, 255, 255]; // couleur cible — PRIVÉ (Task 3)
const _cinArtRGBCur    = [255, 255, 255]; // couleur affichée (LERP) — PRIVÉ (Task 3)
const _LERP_K          = 0.06;            // vitesse de transition (~16 frames → 50% done)

export function getArtColorStr() { return _cinArtRGB; }
export function setArtColorStr(str) { _cinArtRGB = str; }

// PERF : cache de la string "r,g,b" de la couleur LERP courante — reconstruite
// seulement quand les composantes arrondies ont changé depuis la frame précédente
// (zéro allocation en régime stable, couleur convergée). Migré depuis cinema-viz.js
// (Task 3) pour garder l'état couleur privé à ce module.
// Sentinelle initiale : 255 (blanc), pas -1 — cohérent avec _cinArtRGBCur ([255,255,255]
// au chargement du module) : drawBgFrame() peut lire ce cache AVANT le premier appel de
// stepArtColorLerp() (ex. tout premier frame après ouverture du cinéma) — un -1 y
// produirait du noir au lieu du blanc neutre attendu (Task 5, cycle 2 polish).
let _lerpRLast = 255, _lerpGLast = 255, _lerpBLast = 255;
let _lerpRGBCache = '255,255,255';

/**
 * Snap immédiat de la couleur affichée vers la cible — appelé par cinema.js au
 * changement de piste (évite le fondu depuis la couleur de la piste précédente).
 */
export function snapArtColor() {
  _cinArtRGBCur[0] = _cinArtRGBTarget[0];
  _cinArtRGBCur[1] = _cinArtRGBTarget[1];
  _cinArtRGBCur[2] = _cinArtRGBTarget[2];
}

/**
 * true quand les 3 canaux de _cinArtRGBCur sont à < 0.5 de la cible — même garde
 * de convergence que stepArtColorLerp(), exposée pour drawBgFrame() (needsFrames).
 */
export function isArtColorConverged() {
  return Math.abs(_cinArtRGBCur[0] - _cinArtRGBTarget[0]) < 0.5 &&
         Math.abs(_cinArtRGBCur[1] - _cinArtRGBTarget[1]) < 0.5 &&
         Math.abs(_cinArtRGBCur[2] - _cinArtRGBTarget[2]) < 0.5;
}

/**
 * Avance le LERP d'une frame vers la cible et retourne la string "r,g,b" courante.
 * Appelé par la boucle rAF (cinema-loop.js, via cinema-viz.js). Zéro allocation en
 * régime stable : la string n'est reconstruite que si une composante arrondie a changé.
 * @param {number} dtN — delta-t normalisé (dt / 16.667), rend le LERP framerate-indépendant.
 * @returns {string} couleur courante interpolée, format "r,g,b"
 */
export function stepArtColorLerp(dtN) {
  // Convergence guard : snap quand tous les canaux sont à < 0.5 de la cible —
  // stoppe le calcul LERP à chaque frame en régime permanent.
  if (isArtColorConverged()) {
    _cinArtRGBCur[0] = _cinArtRGBTarget[0];
    _cinArtRGBCur[1] = _cinArtRGBTarget[1];
    _cinArtRGBCur[2] = _cinArtRGBTarget[2];
  } else {
    const k = 1 - Math.pow(1 - _LERP_K, dtN || 1);
    _cinArtRGBCur[0] += (_cinArtRGBTarget[0] - _cinArtRGBCur[0]) * k;
    _cinArtRGBCur[1] += (_cinArtRGBTarget[1] - _cinArtRGBCur[1]) * k;
    _cinArtRGBCur[2] += (_cinArtRGBTarget[2] - _cinArtRGBCur[2]) * k;
  }
  const rR = Math.round(_cinArtRGBCur[0]);
  const rG = Math.round(_cinArtRGBCur[1]);
  const rB = Math.round(_cinArtRGBCur[2]);
  if (rR !== _lerpRLast || rG !== _lerpGLast || rB !== _lerpBLast) {
    _lerpRLast = rR; _lerpGLast = rG; _lerpBLast = rB;
    _lerpRGBCache = `${rR},${rG},${rB}`;
  }
  return _lerpRGBCache;
}

// ── Ambient animation state ──────────────────────────────────
// Task 3 : plus de RAF/génération locaux — la boucle MAÎTRE (cinema-loop.js) possède
// le rAF ; ce module ne fait que peindre une frame quand drawBgFrame() est appelé.
let _ambientT       = 0;      // animation time in ms — persists across tracks
let _ambientColors  = null;   // { cT, cL, cR } — rebuilt each track change
let _ambientCross   = null;   // { snapshot, start, dur } — active cross-fade
let _cinBgCanvas    = null;   // cache de l'élément #cinema-bg (évite getElementById par frame)
let _cinBgCtx       = null;   // cache du contexte 2D de #cinema-bg (évite getContext() par frame)
let _starsInited    = false;  // flag pour éviter double _initStarfield

// P3 fix : cache innerWidth/innerHeight — évite un getter DOM par frame RAF.
let _winW = (typeof window !== 'undefined' && window.innerWidth)  || 1280;
let _winH = (typeof window !== 'undefined' && window.innerHeight) || 800;
export function updateCachedWinSize() { _winW = window.innerWidth || 1280; _winH = window.innerHeight || 800; }

// ── Callback pour accéder à l'état de cinema.js sans créer de cycle d'import ──
let _getCinemaOpen   = () => false;
let _doUpdateCinema  = () => {};
let _getIsPlaying    = () => true;  // défaut : considéré en lecture

// Appelé une seule fois depuis cinema.js : accès à cinemaOpen/updateCinema/isPlaying sans cycle d'import.
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
  const cinBg = document.getElementById('cinema-bg');
  // Task 8 : snapshot de l'ancien mode AVANT tout switch — base du cross-fade
  // MODE_CROSSFADE_MS. Sous reduced-motion : pas de snapshot → bascule sèche (SC 2.3.3).
  // Task 11 : pas de snapshot VERS spectrum — la boucle rAF ambient n'y tourne pas
  // (rendu par cinema-viz) : le snapshot plein écran ne serait jamais consommé ni
  // libéré. Bascule sèche ; DEPUIS spectrum, fondu depuis le canvas vidé — voulu.
  const modeSnapshot = cinemaBg === 'spectrum' ? null : _snapshotModeCanvas(cinBg);
  _stopAmbientAnim(); // arrêter l'animation breathing avant tout switch de mode
  _ambientColors = null;
  // Vider le canvas immédiatement à chaque switch (évite interférence entre modes)
  if (cinBg?.getContext) {
    const c = _cinBgCtx || cinBg.getContext('2d');
    if (c) c.clearRect(0, 0, cinBg.width || 1, cinBg.height || 1);
  }
  // ambient/amoled : gradient/halo. waves/starfield : rendu canvas propre avec RAF.
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled' || cinemaBg === 'waves' || cinemaBg === 'starfield') _updateAmbientGradient();
  // Cross-fade de bascule de mode : fondu depuis le snapshot vers le nouveau mode (MODE_CROSSFADE_MS).
  // Appelé APRÈS _updateAmbientGradient() : celui-ci peut ré-appeler _stopAmbientAnim() en interne
  // (qui remet _ambientCross à null) — poser le cross ici garantit qu'il survit au switch.
  if (modeSnapshot) _ambientCross = { snapshot: modeSnapshot, start: performance.now(), dur: MODE_CROSSFADE_MS };
  // Task 15 : bascule VERS spectrum sans snapshot (cf. supra) → fade d'entrée CSS
  // du canvas viz à la place du cut sec. Inerte sous reduced-motion (CSS + garde).
  if (cinemaBg === 'spectrum' && !prefersReducedMotion()) _vizFadeIn();
  // Bug #9 fix : rafraîchir l'UI cinéma après chaque switch de mode (pochette flou stale sinon).
  if (_getCinemaOpen()) _doUpdateCinema();
}

// Rejoue l'animation .viz-fade-in sur #cinema-viz. La classe RESTE posée : sans
// fill-mode elle est inerte une fois l'animation finie, et retrait + reflow + ajout
// suffisent à la rejouer — aucun listener animationend (fix revue : une bascule
// interrompue fire animationcancel, pas animationend → le {once} fuyait).
function _vizFadeIn() {
  const viz = document.getElementById('cinema-viz');
  if (!viz) return;
  viz.classList.remove('viz-fade-in');
  void viz.offsetWidth; // reflow — permet de rejouer l'animation
  viz.classList.add('viz-fade-in');
}

// Snapshot du canvas #cinema-bg courant (avant switch de mode) pour le cross-fade
// MODE_CROSSFADE_MS. Retourne null sous reduced-motion (bascule sèche) ou si le canvas
// n'a encore rien dessiné (premier applyCinemaBg — rien à faire fondre).
function _snapshotModeCanvas(cinBg) {
  if (prefersReducedMotion() || !cinBg?.getContext || !cinBg.width || !cinBg.height) return null;
  const snap = document.createElement('canvas');
  snap.width = cinBg.width; snap.height = cinBg.height;
  const snapCtx = snap.getContext('2d');
  if (!snapCtx) return null;
  snapCtx.drawImage(cinBg, 0, 0);
  return snap;
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

/** Stop the breathing animation and clear any pending cross-fade. */
function _stopAmbientAnim() {
  _ambientCross = null;
  // P4 fix : tue les tweens GSAP waves/starfield en vol (évite la fuite mémoire à la
  // fermeture du cinéma ou au changement de mode — cf. killCanvasTweens en tête de fichier).
  killCanvasTweens();
}

// Sous ce niveau d'énergie basses, les vagues/étoiles sont visuellement statiques.
// Consommé par drawBgFrame ci-dessous depuis Task 5 (cycle 2 polish) : remplace le
// « toujours actif » conservateur de T3 une fois le FFT/beat partagé câblé.
const _EPS_BAND = 0.002;

/**
 * Renderer passif appelé par la boucle MAÎTRE (cinema-loop.js) à chaque frame.
 * Peint le mode d'arrière-plan courant sur #cinema-bg et fait avancer le cross-fade
 * de bascule éventuel. Ne planifie plus rien lui-même (pas de rAF, pas de garde de
 * focus/visibilité — la cadence et le sommeil sont décidés par l'appelant).
 * @param {number} dt   — ms écoulées depuis la frame précédente (clampées par l'appelant).
 * @param {Uint8Array|null} fft  — snapshot FFT partagé (câblé aux modes waves/starfield).
 * @param {boolean} beat — beat détecté cette frame (câblé aux modes waves/starfield).
 * @returns {boolean} needsFrames — true si une frame supplémentaire est encore utile
 *   (cross-fade en cours, couleur pas encore convergée, ou mode intrinsèquement animé).
 */
export function drawBgFrame(dt, fft, beat) {
  const canvas = _cinBgCanvas || (_cinBgCanvas = document.getElementById('cinema-bg'));
  if (!canvas) return false;
  // Cache le contexte 2D — getContext() une seule fois tant que le canvas est le même.
  // FIX HiDPI : si le cache est invalide, ré-appliquer setTransform après getContext().
  if (!_cinBgCtx || _cinBgCtx.canvas !== canvas) {
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return false;
    const _dpr = window.devicePixelRatio || 1;
    _cinBgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  }
  const isPlaying = _getIsPlaying();
  // Task 14 : gel en pause (ambient/amoled/starfield) ; les cross-fades (performance.now) se terminent — voulu.
  if (isPlaying) _ambientT += dt;
  // Task 5 (cycle 2 polish) : cinema-canvas.js consomme dtN/fft/beat directement — plus
  // de tableau couleur par référence (r/g/b scalaires depuis stepArtColorLerp, lu une
  // frame plus tôt via cinema-viz.js — même lag pré-existant qu'avec _cinArtRGBCur).
  const dtN = dt / 16.667;
  if (cinemaBg === 'waves') {
    drawWavesFrame(_cinBgCtx, _winW, _winH, _lerpRLast, _lerpGLast, _lerpBLast, isPlaying, dtN, fft, beat);
  } else if (cinemaBg === 'starfield') {
    drawStarfieldFrame(_cinBgCtx, _winW, _winH, _lerpRLast, _lerpGLast, _lerpBLast, _ambientT, dtN, fft, beat);
  } else if (cinemaBg !== 'spectrum') {
    // spectrum : rendu par cinema-viz sur son propre canvas — drawBg ne peint rien
    // (canvas vidé au switch, cf. applyCinemaBg) mais laisse le cross-fade se terminer.
    renderAmbientFrame(_ambientT, canvas, _cinBgCtx, cinemaBg, _cinArtRGB, _ambientColors, _winW, _winH);
  }
  // ── Cross-fade overlay — draw old snapshot fading out over the new mode's frame.
  // Task 8 : plus de restriction par mode — le cross-fade de bascule (MODE_CROSSFADE_MS)
  // doit fonctionner vers/depuis waves et starfield, pas seulement ambient/amoled.
  if (_ambientCross) {
    const { snapshot, start, dur } = _ambientCross;
    const p    = Math.min(1, (performance.now() - start) / dur);
    // easeInOutQuad : transition symétrique, ralentit aux extrêmes (moins de "boue" chromatique)
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    _cinBgCtx.globalAlpha = 1 - ease;
    _cinBgCtx.drawImage(snapshot, 0, 0, _winW, _winH); // FIX HiDPI : ctx transformé en CSS px
    _cinBgCtx.globalAlpha = 1;
    if (p >= 1) _ambientCross = null;
  }
  // Task 5 (cycle 2 polish) : waves/starfield ne réclament plus une frame en continu —
  // seulement tant que leur énergie de bande dépasse l'epsilon de sommeil (silence/pause
  // prolongée → decay asymptotique jamais tout à fait 0, d'où l'epsilon plutôt qu'un test == 0).
  return !!_ambientCross || !isArtColorConverged()
      || ((cinemaBg === 'waves' || cinemaBg === 'starfield') && getMaxBandEnergy() > _EPS_BAND);
}

function _updateAmbientGradient() {
  const canvas = document.getElementById('cinema-bg');
  if (!canvas || !canvas.getContext) return;

  const dpr = window.devicePixelRatio || 1;
  updateCachedWinSize(); // P3 fix — rafraîchit le cache lu par la boucle RAF ambient
  const W   = _winW;
  const H   = _winH;
  // FIX HiDPI : backing store en pixels physiques (sinon flou sur écrans 2×).
  const PW  = Math.round(W * dpr);
  const PH  = Math.round(H * dpr);

  // Mode AMOLED : halo coloré simple (utilise _cinArtRGB directement, pas de _ambientColors).
  if (cinemaBg === 'amoled') {
    _stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Pas de _buildAmbientColors ni de cross-fade pour AMOLED
    wakeCinemaLoop();
    return;
  }

  if (cinemaBg === 'waves') {
    _stopAmbientAnim();
    canvas.width  = PW;
    canvas.height = PH;
    _cinBgCtx = canvas.getContext('2d');
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wakeCinemaLoop();
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
    wakeCinemaLoop();
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

  wakeCinemaLoop();
}

// ── Wrappers exportés pour cinema.js ────────────────────────

/** Réveille la boucle cinéma (visibilitychange handler dans cinema.js). */
export function startAmbientAnim() { wakeCinemaLoop(); }

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
 * Mute _cinArtRGBTarget in-place (array privé — consommé via stepArtColorLerp/snapArtColor).
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
