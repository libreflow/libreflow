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
import { rgbToHsl, hslToRgb, boostSat, sampleArtColors5 } from './artcolor.js';
import { renderAmbientFrame }                from './ambientRenderer.js';
import { timeline, set as motionSet, kill as motionKill, eases, tween, kill, quickTo } from './motion.js';

// ── State ───────────────────────────────────────────────────
export let cinemaOpen     = false;
export let cinemaBg       = 'ambient'; // default mode
let cinemaHideTimer       = null;

// ── A11Y: focus management (A.8) ────────────────────────────
// Stores the element that had focus before cinema opened so it
// can be restored when the overlay closes.
let _cinemaLastFocus = null;

// DOM cache (peuplé dans openCinema, vidé dans closeCinema)
// Utilisé par updateCinemaProgress() pour les mises à jour timeupdate à 60 fps.
let _cinFill    = null;
let _cinTc      = null;
let _cinTd      = null;
let _lastCinArt  = null; // dernière URL d'art — évite le bug de normalisation url("…")
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

// GSAP timeline pour la chorégraphie d'ouverture — kill au close + au re-open
// (évite que deux séquences se superposent si l'utilisateur toggle vite).
let _openTl = null;

// ── Constantes ──────────────────────────────────────────────
// ── Modes d'arrière-plan disponibles ────────────────────────
// blur     : pochette ultra-floue, saturée — signature colorée
// ambient  : gradient radial depuis la couleur dominante de la pochette (Apple Music style)
// spectrum : visualiseur audio plein écran, barres bilatérales colorées
// amoled   : noir pur, optimal pour écrans OLED
export const CINEMA_BG_MODES  = ['ambient', 'spectrum', 'liquid', 'aurora', 'amoled'];
export const CINEMA_BG_LABELS = {
  ambient:  'Ambient',
  spectrum: 'Spectre',
  liquid:   'Liquide',
  aurora:   'Aurore',
  amoled:   'AMOLED',
};
const CINEMA_BG_ICONS = {
  ambient:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" opacity=".5"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="23" x2="12" y2="21"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="23" y1="12" x2="21" y2="12"/></svg>`,
  spectrum: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4"  y1="20" x2="4"  y2="12"/><line x1="8"  y1="20" x2="8"  y2="6"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="16" y1="20" x2="16" y2="9"/><line x1="20" y1="20" x2="20" y2="14"/></svg>`,
  liquid:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/><path d="M2 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".55"/><path d="M2 7c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".25"/></svg>`,
  aurora:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 22 Q4 16 5 11 Q6 6 5 2"/><path d="M10 22 Q9 15 10 9 Q11 5 10 2" opacity=".65"/><path d="M15 22 Q16 14 15 9 Q14 4 15 2" opacity=".45"/><path d="M20 22 Q21 16 20 11 Q19 6 20 2" opacity=".28"/></svg>`,
  amoled:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".4"/></svg>`,
};

// ── Constantes d'animation ──────────────────────────────────
const CINEMA_CONTROLS_HIDE_MS  = 3000;  // délai avant masquage des contrôles
const AMBIENT_CROSSFADE_MS     = 1400;  // durée du cross-fade ambient

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
    if (c) c.clearRect(0, 0, cinBg.width || 1, cinBg.height || 1);
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

/** Extract and boost 3 ambient colours from artwork (or fallback to _cinArtRGB). */
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
  const [rF, gF, bF] = _cinArtRGB.split(',').map(Number);
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
    // Boucle active en mode 'ambient' ET 'amoled' (halo minimaliste dans renderAmbientFrame)
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
      if (!_cinBgCtx) { _ambientAnimRaf = requestAnimationFrame(loop); return; }
      const _dpr = window.devicePixelRatio || 1;
      _cinBgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    }
    renderAmbientFrame(_ambientT, canvas, _cinBgCtx, cinemaBg, _cinArtRGB, _ambientColors);
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
    if (!_cinBgCtx) return;
    _cinBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

/** Lit le volume depuis le slider DOM #vol (source de vérité — §2). Fallbacks : master gain puis 1. */
function _readVol() {
  const dom = parseFloat(document.getElementById('vol')?.value);
  if (Number.isFinite(dom)) return dom;
  return masterGainNode?.gain.value ?? 1;
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
      if (audio) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); updateCinema(); } // B33 FIX : .catch — évite un rejet non géré si autoplay refuse
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
      if (audio) { const v = Math.min(1, _readVol() + 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (audio) { const v = Math.max(0, _readVol() - 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
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

// ── A11Y A.8 — Tab trap + ESC-to-close ──────────────────────
// Separate from _onCinKey so it can be removed cleanly in closeCinema().
// ESC handling here complements _onCinKey's ESC (which also exits fullscreen).
// Tab cycles focus within the overlay; ESC closes cinema (unless fullscreen
// is active, in which case _onCinKey handles exiting fullscreen first).
function _onCinemaTrapKey(e) {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;

  if (e.key === 'Tab') {
    const focusables = overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) { e.preventDefault(); return; }
    const first  = focusables[0];
    const last   = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ── Scroll molette → volume ──────────────────────────────────
function _syncCinVol(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; updateVolSlider(cvol, `rgb(${_cinArtRGB})`); }
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
  const v = Math.min(1, Math.max(0, _readVol() + delta));
  setMasterGain(v);
  _syncCinVol(v);
  updateCinema();
}

export function openCinema() {
  if (cinemaOpen) return;
  cinemaOpen = true;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  // A11Y A.8 — capture previous focus; move focus into overlay on next paint
  // (overlay has tabindex="-1" from A.7, so it is programmatically focusable)
  _cinemaLastFocus = document.activeElement;
  requestAnimationFrame(() => overlay.focus());
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
  if (volSlider) volSlider.value = _readVol();
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
  document.removeEventListener('keydown', _onCinemaTrapKey);
  document.addEventListener('keydown', _onCinemaTrapKey);
  // Double-clic pochette → like/unlike (removeEventListener d'abord : évite les listeners zombies)
  const _artWrapDb = document.querySelector('.cinema-art-wrap');
  _artWrapDb?.removeEventListener('dblclick', _onArtDblClick);
  _artWrapDb?.addEventListener('dblclick', _onArtDblClick);
  _showControls();
  _runOpenChoreography();
}

// Chorégraphie d'ouverture GSAP — complémente la CSS .cin-enter sur .cinema-art-wrap
// (qui gère le scale + fade de la pochette). Cette timeline anime title / artist /
// progress / contrôles / horloge avec un séquencement type Apple Music.
// L'animation collapse en gsap.set instantané si prefers-reduced-motion = reduce.
/** Re-mesure l'overflow du titre après que #cinema-info est pleinement visible.
 *  Appelée depuis onComplete de _openTl — le rAF initial dans updateCinema() tire
 *  quand autoAlpha:0 est encore actif sur #cinema-info → scrollWidth = 0. */
function _recheckTitleScroll() {
  const elT = document.getElementById('cinema-title');
  if (!elT) return;
  const overflow = elT.scrollWidth - elT.clientWidth;
  if (overflow > 4) {
    // Durée proportionnelle à l'overflow → vitesse constante ~45 px/s (Spotify-like).
    // 17.1 = 45 px/s × 0.38 (fraction de l'animation dédiée au défilement aller).
    const dur = Math.max(8, overflow / 17.1).toFixed(2);
    elT.style.setProperty('--cinema-title-scroll', `-${overflow}px`);
    elT.style.setProperty('--cinema-title-dur', `${dur}s`);
    elT.classList.add('is-scrolling');
  } else {
    elT.style.removeProperty('--cinema-title-scroll');
    elT.style.removeProperty('--cinema-title-dur');
    elT.classList.remove('is-scrolling');
  }
}

function _runOpenChoreography() {
  // Killer d'éventuelle timeline en vol (re-open rapide) + reset des inline styles
  // qu'elle aurait laissés pour éviter le drift visuel à la prochaine séquence.
  if (_openTl) { _openTl.kill(); _openTl = null; }
  const targets = [
    '#cinema-info',
    '#cinema-pbar', '#cinema-tc', '#cinema-td',
    '#cinema-controls',
    '#cinema-clock',
  ];
  for (const sel of targets) motionKill(sel);

  // État initial : utiliser gsap.set (pas inline CSS) — évite tout flash visible
  // avant la première frame de la timeline (les éléments seraient sinon rendus
  // dans leur état CSS naturel pendant 1 frame).
  motionSet('#cinema-info',     { y: 24, autoAlpha: 0 });
  motionSet('#cinema-pbar',     { scaleX: 0.7, transformOrigin: 'left center', autoAlpha: 0 });
  motionSet('#cinema-tc',       { autoAlpha: 0 });
  motionSet('#cinema-td',       { autoAlpha: 0 });
  motionSet('#cinema-controls > *', { y: 14, autoAlpha: 0 });
  motionSet('#cinema-clock',    { autoAlpha: 0 });

  _openTl = timeline({
    defaults: { ease: eases.PREMIUM },
    onComplete() {
      // Libère l'inline transform sur les éléments fixes (info/pbar) pour que
      // tout repaint déclenché par updateCinema repose sur la CSS d'origine.
      motionSet('#cinema-info, #cinema-pbar, #cinema-controls > *', { clearProps: 'transform' });
      _openTl = null;
      // Re-mesure le titre maintenant que #cinema-info est pleinement visible
      // (autoAlpha: 0 pendant l'animation rendait scrollWidth incorrect dans le rAF initial).
      _recheckTitleScroll();
    },
  });

  _openTl
    .to('#cinema-info', { y: 0, autoAlpha: 1, duration: 0.45 }, 0.08)
    .to('#cinema-pbar', { scaleX: 1, autoAlpha: 1, duration: 0.50 }, '-=0.30')
    .to('#cinema-tc',   { autoAlpha: 1, duration: 0.35 }, '<')
    .to('#cinema-td',   { autoAlpha: 1, duration: 0.35 }, '<')
    .to('#cinema-controls > *', {
      y: 0, autoAlpha: 1, duration: 0.42, stagger: 0.035,
    }, '-=0.32')
    .to('#cinema-clock', { autoAlpha: 1, duration: 0.55, ease: eases.SNAP }, '-=0.40');
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
  document.removeEventListener('keydown',  _onCinemaTrapKey);
  _aw?.removeEventListener('dblclick', _onArtDblClick);
  if (cinemaHideTimer) { clearTimeout(cinemaHideTimer); cinemaHideTimer = null; } // Bug 5 fix
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  clearTimeout(_resizeTimer);     _resizeTimer     = null; // évite applyCinemaBg() orphelin après fermeture
  // Killer la timeline d'ouverture si elle est encore en vol + reset des inline
  // styles laissés par gsap (autoAlpha posé display:none / opacity:0 sur l'élément).
  if (_openTl) { _openTl.kill(); _openTl = null; }
  motionSet('#cinema-info, #cinema-pbar, #cinema-tc, #cinema-td, #cinema-controls > *, #cinema-clock',
    { clearProps: 'transform,opacity,visibility,display' });
  // Libérer les refs cachées
  _cinFill = _cinTc = _cinTd = null;
  _lastCinArt = null; // reset pour forcer le swap à la prochaine ouverture
  _lastCinIdx = -1;   // reset pour détecter le changement de piste à la prochaine ouverture
  // A11Y A.8 — restore focus to the element that was focused before cinema opened
  if (_cinemaLastFocus && document.contains(_cinemaLastFocus) && typeof _cinemaLastFocus.focus === 'function') {
    _cinemaLastFocus.focus();
  }
  _cinemaLastFocus = null;
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

/** Retourne la couleur dominante courante "r,g,b" — utilisée par handlers.js pour teinter le slider volume. */
export function getCinArtRGB() { return _cinArtRGB; }

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
    _cinArtRGBCur[0] = _cinArtRGBTarget[0];
    _cinArtRGBCur[1] = _cinArtRGBTarget[1];
    _cinArtRGBCur[2] = _cinArtRGBTarget[2];
  }
  // Propager --cin-rgb → teinte CSS du sous-titre artiste et album
  document.getElementById('cinema-overlay')?.style.setProperty('--cin-rgb', _cinArtRGB);
  // Mettre à jour le gradient de la barre de volume cinéma avec la couleur de la pochette
  const _cvol = document.getElementById('cinema-vol');
  if (_cvol) updateVolSlider(_cvol, `rgb(${_cinArtRGB})`);

  const elT = document.getElementById('cinema-title');
  const elA = document.getElementById('cinema-artist');
  const img  = document.getElementById('cinema-art-img');
  const em   = document.getElementById('cinema-art-em');
  const bg   = document.getElementById('cinema-bg');

  if (elT) {
    if (_trackChanged) {
      elT.classList.remove('is-scrolling');
      elT.style.removeProperty('--cinema-title-scroll');
      elT.style.removeProperty('--cinema-title-dur');
    }
    // Span interne réutilisé — le parent garde overflow:hidden fixe,
    // c'est le span qui se translate (sinon la zone de clip bouge avec l'élément).
    let inner = elT.querySelector('.cin-title-inner');
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'cin-title-inner';
      elT.replaceChildren(inner);
    }
    inner.textContent = title;
    // Mesure après reflow — _recheckTitleScroll() calcule aussi la durée proportionnelle.
    // Skip rAF check while open-animation is running (_openTl active) — autoAlpha:0 gives scrollWidth=0.
    // onComplete calls _recheckTitleScroll() once #cinema-info is fully visible.
    requestAnimationFrame(() => { if (elT.isConnected && !_openTl) _recheckTitleScroll(); });
  }
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
  const vol = _readVol();
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

  // Réutiliser le graphe audio de l'EQ — on ne peut pas créer un second source.
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
  let cw = 0, ch = 0;

  // ── GSAP color (tween entre pistes) ─────────────────────────────────────────
  const _col = { r: _cinArtRGBTarget[0], g: _cinArtRGBTarget[1], b: _cinArtRGBTarget[2] };
  let _colKey = '', _colTween = null;

  // ── GSAP amplitude : suivi RMS + multiplicateur beat séparés ────────────────
  const _envRms = { v: 0.0 };   // suit l'énergie RMS via quickTo
  const _envMul = { v: 1.0 };   // multiplicateur beat — tween indépendant
  const _qRms   = quickTo(_envRms, 'v', { duration: 0.22, ease: 'power2.out' });

  // ── Constantes barres ──────────────────────────────────────────────────────
  const BAR_SPEC = 72;
  const BAR_STD  = 56;
  const BAR_MAX  = Math.max(BAR_SPEC, BAR_STD);

  // ── Barres GSAP quickTo (zéro GC dans draw) ────────────────────────────────
  const _bars = Array.from({ length: BAR_MAX }, () => ({ h: 0 }));
  const _qs   = _bars.map(b => quickTo(b, 'h', { duration: 0.12, ease: 'power2.out' }));

  // ── Beat detector ─────────────────────────────────────────────────────────────
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
      // Pulse du multiplicateur d'amplitude — indépendant du quickTo RMS
      kill(_envMul);
      const tl = timeline();
      tl.to(_envMul, { v: 1.55, duration: 0.06, ease: eases.SNAP });
      tl.to(_envMul, { v: 1.00, duration: 0.70, ease: 'power3.out' });
    }
  }

  // ── Points de courbe pré-alloués (zéro GC dans draw) ────────────────────────
  const NPTS = 280;
  const _px  = new Float32Array(NPTS); // x coordonnées (constantes après resize)
  const _py  = new Float32Array(NPTS); // y waveform principal
  const _mpy = new Float32Array(NPTS); // y miroir

  // ── Buffers audio ─────────────────────────────────────────────────────────────
  let _waveBuf = new Uint8Array(analyser.fftSize);
  let _vizBuf  = new Uint8Array(analyser.frequencyBinCount);

  // ── Gradient cache spectrum ────────────────────────────────────────────────
  let _gRGB = '', _gMid = -1, _gTop = null, _gBot = null;

  // ── Tracé bezier lissé via midpoints ─────────────────────────────────────────
  // Algorithme : quadraticCurveTo vers le milieu de chaque segment → courbe douce sans GC.
  function _tracePath(py) {
    ctx.moveTo(_px[0], py[0]);
    for (let i = 0; i < NPTS - 1; i++) {
      ctx.quadraticCurveTo(_px[i], py[i], (_px[i] + _px[i + 1]) * 0.5, (py[i] + py[i + 1]) * 0.5);
    }
    ctx.lineTo(_px[NPTS - 1], py[NPTS - 1]);
  }

  // ── Liquid wave buffers (pré-alloués — zéro GC dans draw) ─────────────────
  // 7 layers : L0=sub-basse (avant-plan, screen), L6=aigu (arrière-plan).
  const NLIQ = 7;    // couches de vagues
  const LPTS = 200;  // points par chemin — courbes plus douces
  const _lPx  = new Float32Array(LPTS);
  const _lPy  = Array.from({ length: NLIQ }, () => new Float32Array(LPTS));
  const _lSmt = new Float32Array(NLIQ);
  const _lBnd = new Float32Array(NLIQ);
  // 7 plages FFT — layout plat [s0,e0,s1,e1,...] en fraction de frequencyBinCount
  const _lBR  = [
    0.000, 0.015,  // L0 sub-basse
    0.015, 0.045,  // L1 basse
    0.045, 0.10,   // L2 bas-médium
    0.10,  0.22,   // L3 médium
    0.22,  0.42,   // L4 haut-médium
    0.42,  0.68,   // L5 haut
    0.68,  1.00,   // L6 aigu
  ];
  // [yFrac, ampFrac, cycles/largeur, vitesse de phase ms⁻¹, alphaBase]
  const _lPrm = [
    [0.60, 0.30, 0.8, 4.5e-4, 0.28],  // L0 sub-basse — ample, lente, screen
    [0.52, 0.24, 1.2, 6.5e-4, 0.24],  // L1 basse — screen
    [0.45, 0.18, 1.7, 9.0e-4, 0.19],  // L2 bas-médium
    [0.39, 0.13, 2.2, 1.2e-3, 0.15],  // L3 médium
    [0.34, 0.09, 2.8, 1.5e-3, 0.12],  // L4 haut-médium
    [0.29, 0.06, 3.5, 1.8e-3, 0.09],  // L5 haut
    [0.25, 0.04, 4.2, 2.2e-3, 0.06],  // L6 aigu — fins frémissements
  ];
  let _lGrads    = null, _lGradRGB = '', _lGradH = 0, _lPxW = -1;
  let _lColors   = new Array(NLIQ).fill('255,255,255'); // couleur par couche (teinte décalée)
  let _lColorsRGB = '';

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

  // ── Aurora (aurore boréale) buffers ───────────────────────────────────────
  // 7 rideaux verticaux : chacun oscille horizontalement et ondule.
  const NAUR = 7;   // rideaux
  const APTS = 90;  // points par bord de rideau
  const _aLx = Array.from({ length: NAUR }, () => new Float32Array(APTS)); // bord gauche x
  const _aRx = Array.from({ length: NAUR }, () => new Float32Array(APTS)); // bord droit x
  const _aPy = new Float32Array(APTS);
  const _aBnd = new Float32Array(NAUR);
  const _aBR  = [0.00,0.03, 0.03,0.08, 0.08,0.18, 0.18,0.35, 0.35,0.55, 0.55,0.78, 0.78,1.00];
  // [xFrac, xAmp, ω ms⁻¹, φ, rippleFreq, widthFrac, alphaBase]
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
  // Étoiles : positions déterministes (pas de Math.random dans la boucle rAF)
  const NSTAR = 100;
  const _aSX = new Float32Array(NSTAR);
  const _aSY = new Float32Array(NSTAR);
  const _aSP = new Float32Array(NSTAR);
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
      const cw  = prm[5] * w * (0.35 + energy * 0.65) * _envMul.v;
      const rA  = w * 0.016 * (0.25 + energy * 0.75);
      for (let i = 0; i < APTS; i++) {
        const yf  = i / (APTS - 1);
        const rip = Math.sin(yf * Math.PI * 2 * prm[4] + T * 7e-4 + prm[3]) * rA
                  + Math.sin(yf * Math.PI * 2 * prm[4] * _PHI + T * 5e-4) * rA * 0.3;
        _aLx[C][i] = cx - cw * 0.5 + rip;
        _aRx[C][i] = cx + cw * 0.5 + rip;
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

  function draw(timestamp) {
    if (!cinemaOpen) return;
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

    // Sync buffers
    if (_vizBuf.length  !== analyser.frequencyBinCount) _vizBuf  = new Uint8Array(analyser.frequencyBinCount);
    if (_waveBuf.length !== analyser.fftSize)           _waveBuf = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(_vizBuf);
    analyser.getByteTimeDomainData(_waveBuf);

    // GSAP color sync : démarre un tween quand la cible de couleur change
    const ck = `${_cinArtRGBTarget[0]},${_cinArtRGBTarget[1]},${_cinArtRGBTarget[2]}`;
    if (ck !== _colKey) {
      _colKey = ck;
      if (_colTween) { _colTween.kill(); _colTween = null; }
      _colTween = tween(_col, { r: _cinArtRGBTarget[0], g: _cinArtRGBTarget[1], b: _cinArtRGBTarget[2], duration: 0.75, ease: 'power2.inOut' });
    }
    const rgb = `${Math.round(_col.r)},${Math.round(_col.g)},${Math.round(_col.b)}`;

    _detectBeat(_vizBuf);

    // Mise à jour GSAP quickTo — une seule passe pour les deux modes
    const barCount  = cinemaBg === 'spectrum' ? BAR_SPEC : BAR_STD;
    const totalBins = analyser.frequencyBinCount;
    const lMax      = Math.log2(cinemaBg === 'spectrum' ? totalBins * 0.72 : totalBins * 0.65);
    const lMin      = Math.log2(1);
    let   avgH      = 0;
    for (let i = 0; i < barCount; i++) {
      const bin = Math.round(Math.pow(2, lMin + (i / barCount) * (lMax - lMin)));
      _qs[i](_vizBuf[Math.min(bin, totalBins - 1)] / 255);
      avgH += _bars[i].h;
    }
    avgH /= barCount;

    if (cinemaBg === 'spectrum') {
      const midY = h / 2, bw = w / barCount, gap = 1, rr = 3;

      // Couche 0 — waveform oscilloscope
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb},0.11)`;
      ctx.lineWidth   = 1.2;
      const sl = w / _waveBuf.length;
      for (let i = 0; i < _waveBuf.length; i++) {
        const yw = midY + ((_waveBuf[i] - 128) / 128) * midY * 0.26;
        i === 0 ? ctx.moveTo(0, yw) : ctx.lineTo(i * sl, yw);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Couche 1 — barres bilatérales (gradients mis en cache)
      if (_gRGB !== rgb || _gMid !== midY) {
        _gRGB = rgb; _gMid = midY;
        _gTop = ctx.createLinearGradient(0, 0, 0, midY);
        _gTop.addColorStop(0,   `rgba(${rgb},1)`);
        _gTop.addColorStop(0.6, `rgba(${rgb},0.42)`);
        _gTop.addColorStop(1,   `rgba(${rgb},0.05)`);
        _gBot = ctx.createLinearGradient(0, midY, 0, h);
        _gBot.addColorStop(0,   `rgba(${rgb},0.05)`);
        _gBot.addColorStop(0.4, `rgba(${rgb},0.42)`);
        _gBot.addColorStop(1,   `rgba(${rgb},1)`);
      }
      for (let i = 0; i < barCount; i++) {
        const v = _bars[i].h, bh = Math.max(2, v * midY * 0.90);
        const a = 0.05 + v * 0.72, x = i * bw + 1, bww = Math.max(1, bw - 2);
        ctx.globalAlpha = a;
        if (ctx.roundRect) {
          ctx.fillStyle = _gTop; ctx.beginPath(); ctx.roundRect(x, midY - bh - gap, bww, bh, [rr,rr,0,0]); ctx.fill();
          ctx.fillStyle = _gBot; ctx.beginPath(); ctx.roundRect(x, midY + gap, bww, bh, [0,0,rr,rr]); ctx.fill();
        } else {
          ctx.fillStyle = _gTop; ctx.fillRect(x, midY - bh - gap, bww, bh);
          ctx.fillStyle = _gBot; ctx.fillRect(x, midY + gap, bww, bh);
        }
        ctx.globalAlpha = 1;
        if (v > 0.28) {
          ctx.fillStyle = `rgb(${rgb})`; ctx.globalAlpha = v * 0.07;
          ctx.fillRect(x - 2, midY - bh - gap - 1, bww + 4, bh + 2);
          ctx.fillRect(x - 2, midY + gap - 1, bww + 4, bh + 2);
          ctx.globalAlpha = 1;
        }
      }

      // Couche 2 — bloom radial pulsé par GSAP beat intensity
      const bA = Math.min(0.18, avgH * 0.18 + _envMul.v * 0.12);
      if (bA > 0.007) {
        const bloom = ctx.createRadialGradient(w * 0.5, midY, 0, w * 0.5, midY, w * 0.46);
        bloom.addColorStop(0, `rgba(${rgb},${bA.toFixed(3)})`);
        bloom.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = bloom; ctx.fillRect(0, 0, w, h);
      }

      // Ligne centrale
      ctx.globalAlpha = 0.09; ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(0, midY - 1, w, 2); ctx.globalAlpha = 1;

    } else if (cinemaBg === 'liquid') {
      _drawLiquidWaves(T, w, h, rgb);

    } else if (cinemaBg === 'aurora') {
      _drawAurora(T, w, h, rgb);

    } else {
      // Mode standard — waveform + barres du bas
      const bw = w / barCount;

      ctx.beginPath(); ctx.strokeStyle = `rgba(${rgb},0.12)`; ctx.lineWidth = 1.0;
      const sl2 = w / _waveBuf.length;
      for (let i = 0; i < _waveBuf.length; i++) {
        const yw = h * 0.68 + ((_waveBuf[i] - 128) / 128) * h * 0.13;
        i === 0 ? ctx.moveTo(0, yw) : ctx.lineTo(i * sl2, yw);
      }
      ctx.stroke(); ctx.globalAlpha = 1;

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
