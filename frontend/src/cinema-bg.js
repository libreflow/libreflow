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
