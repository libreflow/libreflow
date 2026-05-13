// LibreFlow — cinema.js
// Mode Cinéma : overlay plein-écran, fond flou, contrôles masquables.
// Extrait de app.js.
//
// Dépendances :
//   import  : fmt, extEmoji  (utils.js)
//   import  : saveCfg (cfgsave.js), updateVolSlider (playerbar.js)
//   window  : audio, curIdx, tracks, liked, shuffle, repeat, getFiltered (getters), toast
//
// Exports publics (utilisés par app.js) :
//   cinemaOpen, cinemaBg
//   toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress
//   setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn
//   toggleCinemaFullscreen
//   CINEMA_BG_MODES, CINEMA_BG_LABELS

import { fmt, extEmoji }                     from './utils.js';
import { eqCtx, eqAnalyser, masterGainNode, setMasterGain } from './eq.js'; // réutiliser le graphe EQ existant
import { i18n }                               from './i18n.js';
import { get, set }                           from './store.js';
import { getFiltered, filteredIdx }            from './search.js';
import { audio, toggleLike, next, prev }      from './player.js';
import { radioActive, stopRadio, startRadio, getRadioQueue } from './radio.js';
import { toast }                                        from './ui.js';
import { saveCfg }                   from './cfgsave.js';
import { updateVolSlider }            from './playerbar.js';
import { rgbToHsl, hslToRgb, boostSat, regionAvg, sampleArtColors } from './artcolor.js';

// ── State ───────────────────────────────────────────────────
export let cinemaOpen     = false;
export let cinemaBg       = 'ambient'; // default mode
let cinemaHideTimer       = null;

// DOM cache (peuplé dans openCinema, vidé dans closeCinema)
// Utilisé par updateCinemaProgress() pour les mises à jour timeupdate à 60 fps.
let _cinFill    = null;
let _cinTc      = null;
let _cinTd      = null;
let _lastCinArt  = null; // dernière URL d'art — évite le bug de normalisation url("…")
let _noiseCanvas = null; // cache du canvas noise (généré une seule fois)
let _cinBgCtx    = null; // cache du contexte 2D de #cinema-bg (évite getContext() par frame)

// Visualiseur (animation RAF uniquement — pas de création d'AudioContext ni de source)
let _cinVizRaf  = null;
let _beatTimer  = null; // timer classe .beat — module scope pour pouvoir le nettoyer dans _stopViz()
// Couleur dominante de la pochette courante — mise à jour dans updateCinema()
// (même principe que _vizRGB dans viz.js — évite la lecture async artColor dans le loop rAF)
let _cinArtRGB       = '255,255,255'; // couleur courante (interpolée)
let _cinArtRGBTarget = [255,255,255]; // couleur cible
let _cinArtRGBCur    = [255,255,255]; // couleur affichée (LERP)
const _LERP_K        = 0.06;          // vitesse de transition (~16 frames → 50% done)
let _kbVariant  = 0;                  // variante Ken Burns courante (0-3)
let _lastCinIdx = -1;                 // dernier curIdx vu dans updateCinema — détecte le changement de piste

// Horloge
let _clockInterval = null;

// Timers pour l'animation de swap pochette — stockés pour annulation dans closeCinema()
let _cinSwapOutTimer = null;
let _cinSwapInTimer  = null;

// ── Constantes ──────────────────────────────────────────────
// ── Modes d'arrière-plan disponibles ────────────────────────
// blur     : pochette ultra-floue, saturée — signature colorée
// ambient  : gradient radial depuis la couleur dominante de la pochette (Apple Music style)
// spectrum : visualiseur audio plein écran, barres bilatérales colorées
// amoled   : noir pur, optimal pour écrans OLED
export const CINEMA_BG_MODES  = ['ambient', 'spectrum', 'amoled'];
export const CINEMA_BG_LABELS = {
  ambient:  'Ambient',
  spectrum: 'Spectre',
  amoled:   'AMOLED',
};
const CINEMA_BG_ICONS = {
  ambient:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" opacity=".5"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="21"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="21" y2="12"/></svg>`,
  spectrum: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4"  y1="20" x2="4"  y2="12"/><line x1="8"  y1="20" x2="8"  y2="6"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="16" y1="20" x2="16" y2="9"/><line x1="20" y1="20" x2="20" y2="14"/></svg>`,
  amoled:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".4"/></svg>`,
};

// ── Constantes d'animation ──────────────────────────────────
const CINEMA_CONTROLS_HIDE_MS  = 3000;  // délai avant masquage des contrôles
const AMOLED_DRIFT_FREQ        = 0.000350; // fréquence de dérive sinusoïdale halo (~0.35 Hz)
const AMOLED_DRIFT_AMP         = 0.04;    // amplitude de dérive (4% de la largeur)
const AMBIENT_CROSSFADE_MS     = 1400;  // durée du cross-fade ambient
const AMBIENT_DRIFT_FREQ_X     = 0.000524; // fréquence dérive X gradient
const AMBIENT_DRIFT_FREQ_Y     = 0.000370; // fréquence dérive Y (breath)
const AMBIENT_DRIFT_AMP        = 0.06;    // amplitude dérive gradient
const NOISE_DITHER_AMPLITUDE   = 22;    // amplitude bruit grain AMOLED (±22/255)
const NOISE_OVERLAY_OPACITY    = 0.055; // opacité overlay grain AMOLED

// ── Arrière-plan ────────────────────────────────────────────

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
    c.clearRect(0, 0, cinBg.width || 1, cinBg.height || 1);
  }
  // ambient : gradient multi-radial complet. amoled : halo minimaliste (même boucle RAF).
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled') _updateAmbientGradient();
  // Bug #9 fix : rafraîchir l'UI cinéma (pochette, infos piste, contrôles) après chaque
  // switch de mode — sans ça la pochette flou reste stale après cycleCinemaBg().
  if (cinemaOpen) updateCinema();
}

/**
 * Mode ambient : gradient radial depuis la couleur dominante de la pochette.
 * Inspiré du mode "ambient" d'Apple Music — la couleur rayonne depuis le haut de l'écran.
 */
/**
 * Ambient : rendu canvas avec dithering noise pour éliminer le banding CSS.
 * Technique : gradient canvas multi-radial + calque noise grain (Perlin simplifié).
 */
let _ambientAnimRaf = null;   // RAF handle for continuous breathing loop
let _ambientT       = 0;      // animation time in ms — persists across tracks
let _ambientColors  = null;   // { cT, cL, cR } — rebuilt each track change
let _ambientCross   = null;   // { snapshot, start, dur } — active cross-fade
let _frameCount     = 0;      // frame counter for ambient 30fps cap
let _ambientGen     = 0;      // génération courante — incrémentée à chaque _stopAmbientAnim() pour invalider les loops orphelins

// Vignette gradient cache — recréé uniquement si W ou H changent (évite createRadialGradient/frame)
let _vignetteGrad = null;
let _vignetteW    = 0;
let _vignetteH    = 0;

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

/**
 * Render one frame of the breathing animation onto canvas.
 * t = animation time in ms — drives all sinusoidal drifts.
 */
function _renderAmbientFrame(t, canvas, ctx) {
  // FIX HiDPI : le contexte est transformé via setTransform(dpr,…) → coordonnées en pixels CSS.
  // Utiliser innerWidth/innerHeight (CSS px) et non canvas.width/height (pixels physiques).
  const W = window.innerWidth  || 1280;
  const H = window.innerHeight || 800;
  if (!ctx) return;

  // ── Mode AMOLED : halo coloré minimaliste (réutilise la boucle ambient) ──
  // Un seul createRadialGradient/frame au lieu de 4 — quasiment gratuit.
  // Dérive sinusoïdale douce depuis le centre-haut — rend le mode vivant sans le trahir.
  if (cinemaBg === 'amoled') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const ax = W * 0.5 + Math.sin(t * AMOLED_DRIFT_FREQ) * W * AMOLED_DRIFT_AMP;
    const ay = H * 0.22;
    const ga = ctx.createRadialGradient(ax, ay, 0, ax, ay, H * 0.55);
    ga.addColorStop(0,   `rgba(${_cinArtRGB},.09)`);
    ga.addColorStop(0.5, `rgba(${_cinArtRGB},.02)`);
    ga.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = ga;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (!_ambientColors) return;

  const { cT, cL, cR } = _ambientColors;
  const [rT, gT, bT] = cT;
  const [rL, gL, bL] = cL;
  const [rR, gR, bR] = cR;
  const rM = (rL + rR) >> 1, gM = (gL + gR) >> 1, bM = (bL + bR) >> 1;

  // ── Animated positions — independent sinusoidal drifts ───────
  // Halo principal : horizontal drift T≈12s, radius breath T≈17s
  const driftX  = Math.sin(t * AMBIENT_DRIFT_FREQ_X) * W * AMBIENT_DRIFT_AMP;
  const breathR = 1 + Math.sin(t * AMBIENT_DRIFT_FREQ_Y) * AMBIENT_DRIFT_AMP;
  // Accent gauche : drift X, T≈15s
  const driftLX = W * (0.10 + Math.sin(t * 0.000419 + 1.0) * 0.05);
  // Accent droit : drift X, T≈14s
  const driftRX = W * (0.90 + Math.sin(t * 0.000449 + 2.1) * 0.05);
  // Centre-bas : drift Y, T≈22s
  const driftCY = H * (1.02 + Math.sin(t * 0.000287 + 0.5) * 0.03);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ── Base noire ───────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // ── Halo principal — top-center, couleur dominante ───────────
  const cx1 = W * 0.5 + driftX;
  const g1 = ctx.createRadialGradient(cx1, 0, 0, cx1, 0, H * 1.15 * breathR);
  g1.addColorStop(0,    `rgb(${rT},${gT},${bT})`);
  g1.addColorStop(0.22, `rgb(${rT * .75 | 0},${gT * .75 | 0},${bT * .75 | 0})`);
  g1.addColorStop(0.48, `rgb(${rT * .30 | 0},${gT * .30 | 0},${bT * .30 | 0})`);
  g1.addColorStop(0.76, `rgb(${rT * .07 | 0},${gT * .07 | 0},${bT * .07 | 0})`);
  g1.addColorStop(1,    'rgb(0,0,0)');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

  // ── Accent bas-gauche ─────────────────────────────────────────
  const g2 = ctx.createRadialGradient(driftLX, H, 0, driftLX, H, W * .60);
  g2.addColorStop(0,    `rgba(${rL},${gL},${bL},.65)`);
  g2.addColorStop(0.50, `rgba(${rL},${gL},${bL},.12)`);
  g2.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

  // ── Accent bas-droit ──────────────────────────────────────────
  const g3 = ctx.createRadialGradient(driftRX, H, 0, driftRX, H, W * .55);
  g3.addColorStop(0,    `rgba(${rR},${gR},${bR},.55)`);
  g3.addColorStop(0.50, `rgba(${rR},${gR},${bR},.09)`);
  g3.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);

  // ── Halo centre-bas — blend L+R pour profondeur ──────────────
  const g4 = ctx.createRadialGradient(W * .5, driftCY, 0, W * .5, driftCY, W * .48);
  g4.addColorStop(0,    `rgba(${rM},${gM},${bM},.38)`);
  g4.addColorStop(0.55, `rgba(${rM},${gM},${bM},.06)`);
  g4.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g4; ctx.fillRect(0, 0, W, H);

  // ── Noise dithering — film grain ─────────────────────────────
  if (!_noiseCanvas) {
    const NS = 256;
    _noiseCanvas = document.createElement('canvas');
    _noiseCanvas.width = NS; _noiseCanvas.height = NS;
    const nc = _noiseCanvas.getContext('2d');
    const id = nc.createImageData(NS, NS);
    const px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = (Math.random() * 2 - 1) * NOISE_DITHER_AMPLITUDE;
      px[i] = px[i + 1] = px[i + 2] = 128 + v;
      px[i + 3] = 255;
    }
    nc.putImageData(id, 0, 0);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = NOISE_OVERLAY_OPACITY;
  ctx.drawImage(_noiseCanvas, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ── Vignette bords — gradient mis en cache (recréé uniquement si W ou H changent) ──
  if (!_vignetteGrad || W !== _vignetteW || H !== _vignetteH) {
    _vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, H * .18, W / 2, H / 2, H * .88);
    _vignetteGrad.addColorStop(0,    'rgba(0,0,0,0)');
    _vignetteGrad.addColorStop(0.65, 'rgba(0,0,0,.08)');
    _vignetteGrad.addColorStop(1,    'rgba(0,0,0,.62)');
    _vignetteW = W;
    _vignetteH = H;
  }
  ctx.fillStyle = _vignetteGrad; ctx.fillRect(0, 0, W, H);
}

/** Start the continuous breathing animation RAF loop. No-op if already running. */
function _startAmbientAnim() {
  if (_ambientAnimRaf) return;
  const myGen = _ambientGen; // capturer le token de génération courante
  let last = performance.now();
  function loop(now) {
    // Guard génération : si _stopAmbientAnim() a été appelé depuis, ce loop est orphelin
    if (myGen !== _ambientGen) return;
    // Boucle active en mode 'ambient' ET 'amoled' (halo minimaliste dans _renderAmbientFrame)
    if ((cinemaBg !== 'ambient' && cinemaBg !== 'amoled') || !cinemaOpen || document.hidden) {
      last = now;  // prevent time-jump on resume (BUG-D3A-7)
      _ambientAnimRaf = null;
      return;
    }
    // Ambient 30fps cap — skip odd frames to halve GPU load
    if (cinemaBg === 'ambient' && _frameCount++ % 2 !== 0) {
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
      const _dpr = window.devicePixelRatio || 1;
      _cinBgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
      _vignetteGrad = null; // gradient lié au ctx précédent — invalider
    }
    _renderAmbientFrame(_ambientT, canvas, _cinBgCtx);
    // ── Cross-fade overlay — draw old snapshot fading out ────────
    if (_ambientCross) {
      const { snapshot, start, dur } = _ambientCross;
      const p    = Math.min(1, (now - start) / dur);
      // easeInOutQuad : transition symétrique qui passe vite au milieu (50/50 blend)
      // et ralentit aux extrêmes → moins de "boue" chromatique lors du cross-fade.
      // easeOutCubic parcourait 58% en 30% du temps → instabilité visible sur couleurs contrastées.
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      // FIX HiDPI : ctx est transformé en CSS px → dessiner le snapshot aux dimensions CSS.
      const _cW = window.innerWidth || 1280, _cH = window.innerHeight || 800;
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
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _vignetteGrad = null; // invalider — nouveau ctx ou canvas redimensionné
    // Pas de _buildAmbientColors ni de cross-fade pour AMOLED
    _startAmbientAnim();
    return;
  }

  if (cinemaBg !== 'ambient') return;

  // Snapshot current canvas for cross-fade (only if colors already exist)
  let snapshot = null;
  if (_ambientColors && canvas.width > 0 && canvas.height > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = PW; snapshot.height = PH;
    snapshot.getContext('2d').drawImage(canvas, 0, 0, PW, PH);
  }

  _stopAmbientAnim();
  canvas.width  = PW;
  canvas.height = PH;
  _cinBgCtx = canvas.getContext('2d');
  _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _vignetteGrad = null; // invalider — nouveau ctx ou canvas redimensionné
  _ambientColors = _buildAmbientColors();

  if (snapshot) {
    _ambientCross = { snapshot, start: performance.now(), dur: AMBIENT_CROSSFADE_MS };
  }

  _startAmbientAnim();
}

export function updateCinemaBgBtn() {
  const btn = document.getElementById('cinema-bg-btn');
  if (!btn) return;
  // Fallback sur 'ambient' si mode inconnu (CINEMA_BG_ICONS n'a pas de clé 'blur')
  btn.innerHTML = CINEMA_BG_ICONS[cinemaBg] || CINEMA_BG_ICONS.ambient;
  const label = CINEMA_BG_LABELS[cinemaBg] || cinemaBg;
  btn.title = i18n('t_cinema_bg', label) + ' [B]';
}

// ── Resize handler — redessine blur/ambient si dimensions changent ──
let _resizeTimer = null;
window.addEventListener('resize', () => {
  if (!cinemaOpen) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (cinemaBg === 'ambient' || cinemaBg === 'amoled') applyCinemaBg();
  }, 200);
});

// ── Ouverture / fermeture ────────────────────────────────────

export function toggleCinema() {
  if (cinemaOpen) closeCinema(); else openCinema();
}


// ── Raccourcis clavier cinema ────────────────────────────────
function _onArtDblClick(e) {
  e.stopPropagation();
  // Appeler toggleLike du player principal (window scope)
  toggleLike();
  // Feedback visuel : cœur qui pulse sur la pochette
  const wrap = document.querySelector('.cinema-art-wrap');
  const overlay = document.getElementById('cinema-overlay');
  if (!wrap || !overlay) return;
  const r = wrap.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const heart = document.createElement('div');
  heart.className = 'cin-heart-burst';
  heart.textContent = '❤';
  heart.style.left = cx + 'px';
  heart.style.top  = cy + 'px';
  overlay.appendChild(heart);
  setTimeout(() => heart.remove(), 750);
}

function _onCinKey(e) {
  if (!cinemaOpen) return;
  // Ignorer si focus sur un input/slider
  const _ct = e.target.tagName;
  if (_ct === 'INPUT' || _ct === 'TEXTAREA' || _ct === 'SELECT' || e.target.isContentEditable) return;
  _showControls(); // reset idle timer sur toute touche
  // audio imported from player.js
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (audio) { audio.paused ? audio.play() : audio.pause(); updateCinema(); }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (audio) { audio.currentTime = Math.max(0, audio.currentTime - 5); }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (audio) { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (audio) { const _cur = masterGainNode ? masterGainNode.gain.value : audio.volume; const v = Math.min(1, _cur + 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (audio) { const _cur = masterGainNode ? masterGainNode.gain.value : audio.volume; const v = Math.max(0, _cur - 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
      break;
    case 'KeyN': case 'KeyL':
      e.preventDefault();
      next();
      break;
    case 'KeyP':
      e.preventDefault();
      prev();
      break;
    case 'KeyF':
      e.preventDefault();
      toggleCinemaFullscreen();
      break;
    case 'KeyB':
      e.preventDefault();
      cycleCinemaBg();
      break;
    case 'KeyR':
      e.preventDefault();
      toggleCinemaRadio();
      break;
    case 'Escape':
      // Si plein écran actif → quitter le plein écran uniquement (pas fermer le cinéma)
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        closeCinema();
      }
      break;
  }
}

// ── Scroll molette → volume ──────────────────────────────────
function _syncCinVol(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; updateVolSlider(cvol); }
  const vel = document.getElementById('vol');
  if (vel) { vel.value = v; updateVolSlider(vel); }
  saveCfg();
}

function _onCinWheel(e) {
  e.preventDefault();
  e.stopPropagation();
  // audio imported from player.js
  if (!audio) return;
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const _cur = masterGainNode ? masterGainNode.gain.value : audio.volume;
  const v = Math.min(1, Math.max(0, _cur + delta));
  setMasterGain(v);
  _syncCinVol(v);
  updateCinema();
}

export function openCinema() {
  if (cinemaOpen) return;
  cinemaOpen = true;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  // Marquer le bouton toolbar comme actif (état toggle visible)
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.add('on'); tbtCinema.setAttribute('aria-pressed', 'true'); }
  // Mettre en cache les refs cinéma pour updateCinemaProgress (timeupdate à 60 fps)
  _cinFill = document.getElementById('cinema-fill');
  _cinTc   = document.getElementById('cinema-tc');
  _cinTd   = document.getElementById('cinema-td');
  // Synchroniser le slider volume avec l'état courant de l'audio
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider) volSlider.value = (typeof masterGainNode !== 'undefined' && masterGainNode) ? masterGainNode.gain.value : (audio ? audio.volume : 1);
  applyCinemaBg();
  updateCinema();
  _startClock();
  _startViz();
  // Animation d'entrée : scale 0.88 → 1 + fade-in
  const artWrap = document.querySelector('.cinema-art-wrap');
  if (artWrap) {
    artWrap.classList.remove('cin-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      artWrap.classList.add('cin-enter');
      _startKenBurns(); // démarrer Ken Burns à l'ouverture du mode cinéma
    }));
  }
  overlay.removeEventListener('mousemove', onCinemaMouseMove);
  overlay.addEventListener('mousemove', onCinemaMouseMove);
  overlay.removeEventListener('click',     onCinemaMouseMove);
  overlay.addEventListener('click',     onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  overlay.addEventListener('wheel',     _onCinWheel, { passive: false });
  document.removeEventListener('keydown',  _onCinKey);
  document.addEventListener('keydown',  _onCinKey);
  // Double-clic pochette → like/unlike (removeEventListener d'abord : évite les listeners zombies)
  const _artWrapDb = document.querySelector('.cinema-art-wrap');
  _artWrapDb?.removeEventListener('dblclick', _onArtDblClick);
  _artWrapDb?.addEventListener('dblclick', _onArtDblClick);
  _showControls();
}

export function closeCinema() {
  cinemaOpen = false;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.remove('active', 'ctrl-on');
  // Retirer l'état actif du bouton toolbar
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.remove('on'); tbtCinema.setAttribute('aria-pressed', 'false'); }
  // Cache unique — évite 2 querySelector distincts sur la même requête
  const _aw = document.querySelector('.cinema-art-wrap');
  _aw?.classList.remove('cin-enter', 'cin-swap-out', 'cin-swap');
  overlay.removeEventListener('mousemove', onCinemaMouseMove);
  overlay.removeEventListener('click',     onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  document.removeEventListener('keydown',  _onCinKey);
  _aw?.removeEventListener('dblclick', _onArtDblClick);
  if (cinemaHideTimer) { clearTimeout(cinemaHideTimer); cinemaHideTimer = null; } // Bug 5 fix
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  // Libérer les refs cachées
  _cinFill = _cinTc = _cinTd = null;
  _lastCinArt = null; // reset pour forcer le swap à la prochaine ouverture
  _lastCinIdx = -1;   // reset pour détecter le changement de piste à la prochaine ouverture
  _stopKenBurns();
  _stopAmbientAnim();
  _ambientColors = null;
  _stopClock();
  _stopViz();
  // Quitter le plein écran si actif
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ── Contrôles — visibilité unifiée via .ctrl-on sur l'overlay ──

function _showControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.add('ctrl-on');
  if (cinemaHideTimer) clearTimeout(cinemaHideTimer);
  cinemaHideTimer = setTimeout(_hideControls, CINEMA_CONTROLS_HIDE_MS);
}

function _hideControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (overlay) overlay.classList.remove('ctrl-on');
}

function onCinemaMouseMove() {
  _showControls();
}

// ── Rendu cinéma ─────────────────────────────────────────────

/**
 * Appelé depuis app.js/applyArtColor() en même temps que updateVizColor() —
 * permet de pousser la couleur dominante immédiatement sans attendre updateCinema().
 */
export function updateCinArtColor(hex) {
  const rgb = _parseColorToRGB(hex);
  if (rgb) {
    _cinArtRGBTarget = rgb.split(',').map(Number);
    _cinArtRGB = rgb; // mise à jour immédiate du fallback statique
  } else {
    _cinArtRGBTarget = [255, 255, 255];
    _cinArtRGB = '255,255,255';
  }
}

/**
 * Met à jour _cinArtRGB depuis artColor de la piste, avec fallback sur --art-color CSS.
 * Même principe que updateVizColor() dans viz.js — évite de lire artColor dans le loop rAF.
 */
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

function _updateCinArtRGB(t) {
  // 1. Priorité : artColor sur l'objet track
  const parsed = _parseColorToRGB(t?.artColor);
  if (parsed) { _cinArtRGB = parsed; _cinArtRGBTarget = parsed.split(',').map(Number); return; }
  // 2. Fallback : CSS variable --art-color
  const css = getComputedStyle(document.documentElement).getPropertyValue('--art-color').trim();
  const parsed2 = _parseColorToRGB(css);
  if (parsed2) { _cinArtRGB = parsed2; _cinArtRGBTarget = parsed2.split(',').map(Number); return; }
  // 3. Blanc neutre
  _cinArtRGB = '255,255,255'; _cinArtRGBTarget = [255, 255, 255];
}

// ── Ken Burns — zoom+pan lent sur la pochette (direction aléatoire) ────────

/** Démarre une variante Ken Burns aléatoire sur #cinema-art-img. */
function _startKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img || img.style.display === 'none') return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
  _kbVariant = Math.floor(Math.random() * 4);
  void img.offsetWidth; // force reflow pour redémarrer l'animation
  img.classList.add('cin-kb-' + _kbVariant);
}

/** Stoppe le Ken Burns et remet l'image à son état neutre. */
function _stopKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img) return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
}

export function updateCinema() {
  if (!cinemaOpen) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  // audio imported from player.js
  if (!audio) return; // Bug 4 fix : audio peut être null avant l'init du player
  const t = curIdx >= 0 ? tracks[curIdx] : null;
  const title  = t ? t.name : '–';
  const artist = t ? (t.artistFull || t.artist || '–') : '–';
  const art    = t ? (t.art || null) : null;

  // ARCH-5 : Réinitialiser l'état interne lors d'un changement de piste.
  // Snap immédiat de la couleur LERP vers la nouvelle cible — évite les artefacts visuels
  // de couleur résiduelle de la piste précédente dans le visualiseur spectrum.
  const _trackChanged = curIdx !== _lastCinIdx;
  _lastCinIdx = curIdx;
  if (_trackChanged) {
    // Snap couleur LERP → couleur cible immédiatement (pas de fondu depuis l'ancienne piste)
    _cinArtRGBCur[0] = _cinArtRGBTarget[0];
    _cinArtRGBCur[1] = _cinArtRGBTarget[1];
    _cinArtRGBCur[2] = _cinArtRGBTarget[2];
    // Effacer le canvas visualiseur pour éviter les artefacts de persistance entre pistes
    const vizCanvas = document.getElementById('cinema-viz');
    if (vizCanvas) {
      const vCtx = vizCanvas.getContext('2d');
      if (vCtx) vCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
    }
  }

  // Mettre à jour la couleur dominante pour le visualiseur (même logique que viz.js/_vizRGB)
  // Fallback : lire la CSS var --art-color posée par applyArtColor() dans app.js
  _updateCinArtRGB(t);
  // Après _updateCinArtRGB, si la piste a changé, synchroniser aussi _cinArtRGBCur avec la nouvelle valeur
  if (_trackChanged) {
    const parts = _cinArtRGB.split(',').map(Number);
    _cinArtRGBCur[0] = parts[0]; _cinArtRGBCur[1] = parts[1]; _cinArtRGBCur[2] = parts[2];
  }
  // Propager --cin-rgb → teinte CSS du sous-titre artiste et album
  document.getElementById('cinema-overlay')?.style.setProperty('--cin-rgb', _cinArtRGB);

  const elT = document.getElementById('cinema-title');
  const elA = document.getElementById('cinema-artist');
  const img  = document.getElementById('cinema-art-img');
  const em   = document.getElementById('cinema-art-em');
  const bg   = document.getElementById('cinema-bg');

  if (elT) elT.textContent = title;
  if (elA) elA.textContent = artist;
  // Ligne album + année — absente si données manquantes (masquée via display:none)
  const elAlb = document.getElementById('cinema-album');
  if (elAlb) {
    const parts = [t?.album, t?.year ? `(${t.year})` : null].filter(Boolean);
    elAlb.textContent = parts.join(' ');
    elAlb.style.display = parts.length ? '' : 'none';
  }

  if (art) {
    if (em) em.style.display = 'none';
    const artWrap = document.querySelector('.cinema-art-wrap');
    // Fond flou pour pochettes non carrées — custom property lue par ::before
    // (plus fiable que style.backgroundImage + background-image:inherit dans WebView2)
    if (artWrap) artWrap.style.setProperty('--cin-bg-url', `url("${art}")`);

    if (art !== _lastCinArt) {
      const hadArt = _lastCinArt !== null;
      _lastCinArt = art; // préempter : évite le re-déclenchement si updateCinema rappelé pendant la transition

      // Fonction de swap-in partagée entre premier chargement et changement de piste
      const _doSwapIn = () => {
        if (!cinemaOpen) return;
        if (img) { img.src = art; img.style.display = 'block'; }
        if (artWrap) {
          artWrap.classList.remove('cin-swap-out', 'cin-swap');
          requestAnimationFrame(() => artWrap.classList.add('cin-swap'));
          _cinSwapInTimer = setTimeout(() => artWrap.classList.remove('cin-swap'), 440);
        }
        _startKenBurns(); // nouvelle piste → nouvelle direction Ken Burns
        if (cinemaBg === 'ambient' || cinemaBg === 'amoled') _updateAmbientGradient();
      };

      if (hadArt && artWrap) {
        // Animation sortante (120ms) puis entrante — transition bi-directionnelle
        artWrap.classList.add('cin-swap-out');
        _cinSwapOutTimer = setTimeout(_doSwapIn, 120);
      } else {
        // Premier chargement : pas d'animation sortante, swap immédiat
        _doSwapIn();
      }
    } else {
      // Même pochette (play/pause, volume…) — juste s'assurer que l'image est visible
      if (img) { img.src = art; img.style.display = 'block'; }
    }
  } else {
    if (img) img.style.display = 'none';
    if (em)  { em.style.display = 'flex'; em.innerHTML = t ? extEmoji(t.ext) : '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'; }
    document.querySelector('.cinema-art-wrap')?.style.removeProperty('--cin-bg-url');
    _lastCinArt = null;
  }

  const playing = !audio.paused;
  const iplay  = document.getElementById('cinema-ico-play');
  const ipause = document.getElementById('cinema-ico-pause');
  if (iplay)  iplay.style.display  = playing ? 'none'  : 'block';
  if (ipause) ipause.style.display = playing ? 'block' : 'none';

  // Sync états shuffle / repeat / like / radio
  document.getElementById('cinema-shuf')?.classList.toggle('on', get('shuffle'));
  const _cinRep = document.getElementById('cinema-rep');
  _cinRep?.classList.toggle('on',      get('repeat') !== 'none');
  _cinRep?.classList.toggle('rep-one', get('repeat') === 'one');
  const isLiked = curIdx >= 0 && get('liked').has(get('tracks')?.[curIdx]?.id); // Phase 4
  document.getElementById('cinema-lk')?.classList.toggle('on', isLiked);
  document.getElementById('cinema-radio')?.classList.toggle('on', !!radioActive);
  document.getElementById('cinema-radio')?.setAttribute('aria-pressed', radioActive ? 'true' : 'false');

  // Piste suivante
  _updateNextTrack();

  // Sync volume slider + icône (muet / bas / haut)
  const vol = (typeof masterGainNode !== 'undefined' && masterGainNode) ? masterGainNode.gain.value : audio.volume;
  const muted = audio.muted || vol === 0;
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider && !volSlider.matches(':active')) volSlider.value = vol;
  const w1 = document.getElementById('cinema-vol-wave1');
  const w2 = document.getElementById('cinema-vol-wave2');
  if (w1) w1.style.display = muted ? 'none' : '';
  if (w2) w2.style.display = (muted || vol < 0.5) ? 'none' : '';

  // Sync progress
  const fill = document.getElementById('cinema-fill');
  const tc   = document.getElementById('cinema-tc');
  const td   = document.getElementById('cinema-td');
  if (fill && audio.duration) fill.style.transform = 'scaleX(' + (audio.currentTime / audio.duration) + ')';
  if (tc)  tc.textContent = fmt(audio.currentTime);
  if (td)  td.textContent = audio.duration ? fmt(audio.duration) : '–:––';
}

/**
 * Mise à jour légère de la progression — appelée depuis le handler timeupdate
 * de app.js à ~60 fps (evite getElementById par cycle grâce au cache _cinFill/Tc/Td).
 */
export function updateCinemaProgress(p, cur, dur) {
  if (!cinemaOpen) return;
  if (_cinFill) _cinFill.style.transform = 'scaleX(' + p + ')';
  if (_cinTc)   _cinTc.textContent = cur;
  if (_cinTd)   _cinTd.textContent = dur;
}

// ═══════════════════════════════════════════════════════════
// ── Plein écran ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

export function toggleCinemaFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ── Radio depuis le cinéma ───────────────────────────────────
export async function toggleCinemaRadio() {
  if (radioActive) {
    await stopRadio();
  } else {
    const t = get('tracks')?.[get('curIdx')]; // Phase 4
    if (!t) { toast?.(i18n('radio_no_seed'), 'warning'); return; }
    await startRadio(t.id);
  }
  updateCinema();
}

// Icônes expand / compress pour le bouton
const _FS_ICON_EXPAND  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const _FS_ICON_COMPRESS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;

const _onFullscreenChange = () => {
  if (!cinemaOpen) return;
  const full = !!document.fullscreenElement;
  const btn  = document.getElementById('cinema-fs-btn');
  if (!btn) return;
  btn.classList.toggle('on', full);
  btn.innerHTML = full ? _FS_ICON_COMPRESS : _FS_ICON_EXPAND;
  btn.title = full ? i18n('t_cin_fs_exit') : i18n('t_cin_fs_enter');
};
document.addEventListener('fullscreenchange', _onFullscreenChange);

// ═══════════════════════════════════════════════════════════
// ── Horloge idle ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function _updateClock() {
  const timeEl = document.getElementById('cinema-clock-time');
  const dateEl = document.getElementById('cinema-clock-date');
  if (!timeEl) return;
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

function _startClock() {
  _stopClock();   // Bug 2 fix : éviter un double intervalle si appelé plusieurs fois
  _updateClock(); // affichage immédiat sans attendre le premier tick
  _clockInterval = setInterval(_updateClock, 1000); // toutes les 1s
}

function _stopClock() {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
}

// ═══════════════════════════════════════════════════════════
// ── Visualiseur audio ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════

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
  let   _artWrapCache = null; // PERF : cache lazy — évite querySelector à chaque beat
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
        _beatTimer = setTimeout(() => { artWrap.classList.remove('beat'); _beatTimer = null; }, 620);
      }
    }
  }

  // ── Cache gradients spectre ────────────────────────────────
  // PERF FIX : 2 gradients partagés recalculés seulement quand la couleur ou la hauteur change.
  // Avant : 144 createLinearGradient/frame (72 barres × 2 gradients). Après : max 2/frame,
  // 0 en régime stable (couleur LERP convergée). Gain ~72× sur le GC et le compositing GPU.
  let _specGradTop  = null, _specGradBot  = null;
  let _specGradRGB  = '',   _specGradMidY = -1;

  function draw() {
    if (!cinemaOpen) return;
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

    analyser.getByteFrequencyData(_vizBuf);
    const data = _vizBuf;
    const usedBins = Math.floor(data.length * 0.6);

    // LERP couleur vers la cible (évite le snap brutal sur changement de piste).
    // Calculé AVANT _detectBeat pour que le flash beat et les barres utilisent
    // exactement la même couleur interpolée dans ce frame (BUG FIX 3 + 4).
    _cinArtRGBCur[0] += (_cinArtRGBTarget[0] - _cinArtRGBCur[0]) * _LERP_K;
    _cinArtRGBCur[1] += (_cinArtRGBTarget[1] - _cinArtRGBCur[1]) * _LERP_K;
    _cinArtRGBCur[2] += (_cinArtRGBTarget[2] - _cinArtRGBCur[2]) * _LERP_K;
    const _lerpRGB = `${Math.round(_cinArtRGBCur[0])},${Math.round(_cinArtRGBCur[1])},${Math.round(_cinArtRGBCur[2])}`;

    _detectBeat(data, _lerpRGB);

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
      }

      // Set glow fillStyle once before the loop — rgb() with no alpha (globalAlpha handles per-bar opacity)
      const _glowFill = `rgb(${_lerpRGB})`;
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
      // Ligne centrale subtile
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = `rgb(${_lerpRGB})`;
      ctx.fillRect(0, midY - 1, w, 2);
      ctx.globalAlpha = 1;

    } else {
      // ── Mode standard (blur/ambient/amoled) : barres logarithmiques en bas ──
      const barCount = 56;
      const bw = w / barCount;
      const totalBins = analyser.frequencyBinCount;
      const logMin = Math.log2(1), logMax = Math.log2(totalBins * 0.65);
      ctx.fillStyle = `rgb(${_lerpRGB})`; // set once — no per-bar string alloc (globalAlpha handles per-bar opacity)
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

  // PERF : pré-allouer hors du loop draw — évite new Uint8Array(128) à chaque frame
  const _vizBuf = new Uint8Array(analyser.frequencyBinCount);

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
  const canvas = document.getElementById('cinema-viz');
  if (canvas) canvas.style.opacity = '0';
  // Ne pas fermer l'AudioContext — il appartient au module EQ
}

// ═══════════════════════════════════════════════════════════
// ── Piste suivante ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function _updateNextTrack() {
  const panel = document.getElementById('cinema-next');
  if (!panel) return;
  const tracks  = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  const curIdx  = get('curIdx');
  const shuffle = get('shuffle');

  // En mode radio : piste suivante = tête de file radio
  if (radioActive && getRadioQueue) {
    const rq = getRadioQueue();
    const nt = rq && rq.length ? rq[0] : null;
    if (!nt) { panel.classList.remove('cin-has-next'); return; }
    panel.classList.add('cin-has-next');
    const titleEl  = document.getElementById('cinema-next-title');
    const artistEl = document.getElementById('cinema-next-artist');
    const imgEl    = document.getElementById('cinema-next-img');
    if (titleEl)  titleEl.textContent  = nt.name || '–';
    if (artistEl) artistEl.textContent = nt.artistFull || nt.artist || '–';
    if (imgEl) { if (nt.art) { imgEl.src = nt.art; imgEl.style.display = 'block'; } else imgEl.style.display = 'none'; }
    return;
  }

  // En mode aléatoire on ne peut pas prédire la piste suivante
  if (shuffle || !tracks || curIdx < 0) {
    panel.classList.remove('cin-has-next'); return;
  }

  // Chercher dans la liste filtrée si disponible, sinon tracks bruts
  let nt = null;
  const filtered = getFiltered();
  if (filtered && filtered.length) {
    const curTrack = tracks[curIdx];
    const posInFiltered = filteredIdx(curTrack); // O(1) via posMap
    nt = posInFiltered >= 0 && posInFiltered + 1 < filtered.length ? filtered[posInFiltered + 1] : null;
  } else {
    nt = curIdx + 1 < tracks.length ? tracks[curIdx + 1] : null;
  }

  if (!nt) { panel.classList.remove('cin-has-next'); return; }
  panel.classList.add('cin-has-next');

  const titleEl  = document.getElementById('cinema-next-title');
  const artistEl = document.getElementById('cinema-next-artist');
  const imgEl    = document.getElementById('cinema-next-img');

  if (titleEl)  titleEl.textContent  = nt.name || '–';
  if (artistEl) artistEl.textContent = nt.artistFull || nt.artist || '–';
  if (imgEl) {
    if (nt.art) { imgEl.src = nt.art; imgEl.style.display = 'block'; }
    else          imgEl.style.display = 'none';
  }
}

// ── Visibilité onglet — relancer le loop ambient si l'onglet redevient visible ──
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cinemaOpen && (cinemaBg === 'ambient' || cinemaBg === 'amoled')) {
    _startAmbientAnim();
  }
});

// ── Barre de progression cinéma (click pour seek) ───────────
document.addEventListener('DOMContentLoaded', function() {
  const cpbar = document.getElementById('cinema-pbar');
  if (cpbar) {
    cpbar.addEventListener('click', function(e) {
      // audio imported from player.js
      if (!audio.duration) return;
      const r = cpbar.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });
  }
});
