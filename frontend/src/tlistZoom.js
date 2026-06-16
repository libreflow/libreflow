// @ts-check
/** @import { ZoomLevel } from './types.js' */
// LibreFlow — tlistZoom.js
// Zoom de la liste de pistes : Micro / Compact / Normal / Confortable / Spacieux.
// Source de vérité unique : cfg.tlistZoom.
//
// API publique :
//   setTlistZoom(level)   — applique un niveau (data-attr + VIRT.ROW_H + cfg + re-render)
//   tlistZoomIn()         — niveau suivant (plus grand) si possible
//   tlistZoomOut()        — niveau précédent (plus petit) si possible
//   tlistZoomReset()      — retour à 'normal'
//   _nextZoomLevel(cur, dir) — logique pure de cycling (testable sans DOM)
//   TLIST_ZOOM_LEVELS     — ['micro','compact','normal','comfortable','spacious']
//   TLIST_ZOOM_ROW_H      — {micro:28, compact:36, normal:48, comfortable:60, spacious:76}

import { VIRT }            from './virt.js';
import { CFG }             from './cfg.js';
import { set, get }        from './store.js';
import { emit, EVENTS }    from './bus.js';
import { saveCfg }         from './cfgsave.js';
import { i18n }            from './i18n.js';

export const TLIST_ZOOM_LEVELS = ['micro', 'compact', 'normal', 'comfortable', 'spacious'];

export const TLIST_ZOOM_ROW_H = {
  micro:       CFG.VIRT_ROW_H_MICRO,       // source de vérité : CFG (CLAUDE.md §2, §10)
  compact:     CFG.VIRT_ROW_H_COMPACT,
  normal:      CFG.VIRT_ROW_H,
  comfortable: CFG.VIRT_ROW_H_COMFORTABLE,
  spacious:    CFG.VIRT_ROW_H_SPACIOUS,
};

/**
 * Logique pure de cycling (sans effet de bord — testable unitairement).
 * @param {ZoomLevel} current  niveau actuel
 * @param {'in'|'out'} dir     direction
 * @returns {ZoomLevel} niveau résultant (identique si déjà à la limite)
 */
export function _nextZoomLevel(current, dir) {
  const idx = TLIST_ZOOM_LEVELS.indexOf(current);
  if (idx === -1) return 'normal';
  if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
  if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
  return current;
}

/**
 * Applique un niveau de zoom à la liste de pistes.
 * Synchronise : attribut data-tlist-zoom → CSS, VIRT.ROW_H, store, cfg, re-render.
 * @param {ZoomLevel} level  'micro' | 'compact' | 'normal' | 'comfortable' | 'spacious'
 * @returns {void}
 */
export function setTlistZoom(level) {
  if (!TLIST_ZOOM_LEVELS.includes(level)) {
    console.warn('[tlistZoom] niveau inconnu ignoré:', level);
    return;
  }

  // 1. Mettre à jour l'attribut CSS sur <html>
  document.documentElement.dataset.tlistZoom = level;

  // 2. Mettre à jour la hauteur de ligne runtime du virtual scroll
  VIRT.ROW_H = TLIST_ZOOM_ROW_H[level];

  // 3. Invalider les caches de signature du virtual scroll
  VIRT._lastListSig   = '';
  VIRT._lastWindowSig = '';

  // 4. Persister dans le store et dans IDB (debounced)
  // LIT-COMPONENTS-8: tlistZoom key must be added to AppState in store.js
  set('tlistZoom', level);
  // LIT-COMPONENTS-9: log IDB persist failures; session/persistence divergence is
  // acceptable for zoom level (cosmetic preference, not data-critical).
  const _saved = saveCfg();
  if (_saved && typeof _saved.catch === 'function') {
    _saved.catch(e => console.warn('[tlistZoom] IDB persist failed:', e));
  }

  // 5. Forcer un re-render de la liste
  // R1-A FIX : ne pas émettre au boot quand tracks[] est encore vide — évite
  // l'écran "liste vide" de 300-600 ms causé par le RENDER_LIB prématuré.
  if (get('tracks')?.length) emit(EVENTS.RENDER_LIB, {});

  // 6. Afficher l'indicateur HUD (sauf au boot — pas encore de DOM #tlist visible)
  if (get('tracks')?.length) _showZoomHud(level);
}

/** Passe au niveau plus grand si possible (compact → normal → comfortable). */
export function tlistZoomIn() {
  const cur = get('tlistZoom') || 'normal';
  setTlistZoom(_nextZoomLevel(cur, 'in'));
}

/** Passe au niveau plus petit si possible (comfortable → normal → compact). */
export function tlistZoomOut() {
  const cur = get('tlistZoom') || 'normal';
  setTlistZoom(_nextZoomLevel(cur, 'out'));
}

/** Remet la densité à 'normal'. */
export function tlistZoomReset() {
  setTlistZoom('normal');
}

// ── HUD indicateur de niveau ────────────────────────────────────────────────
let _hudTimer = null;

/**
 * Affiche brièvement le nom du niveau de zoom dans le HUD flottant (#zoom-hud).
 * @param {ZoomLevel} level
 */
function _showZoomHud(level) {
  const hud = document.getElementById('zoom-hud');
  if (!hud) return;
  const labelKey = `tlist_zoom_${level}`;
  hud.textContent = i18n(labelKey) || level;
  hud.classList.remove('zoom-hud-hide');
  hud.classList.add('zoom-hud-show');
  if (_hudTimer) clearTimeout(_hudTimer);
  _hudTimer = setTimeout(() => {
    hud.classList.remove('zoom-hud-show');
    hud.classList.add('zoom-hud-hide');
  }, 1500);
}

// ── Ctrl + Molette ──────────────────────────────────────────────────────────
// Throttle pour ne déclencher qu'un seul cran de zoom par « geste molette »
// (les trackpads/molettes envoient de nombreux événements en rafale).
const _WHEEL_THROTTLE_MS = 150;
let   _wheelLastAt       = 0;

/**
 * Câble le zoom via Ctrl/Cmd + molette sur le conteneur de la liste de pistes.
 * À appeler une seule fois au boot (idempotent : ne ré-attache pas si déjà fait).
 */
export function initTlistZoomWheel() {
  const tlist = document.getElementById('tlist');
  if (!tlist) { console.warn('[tlistZoom] #tlist introuvable — wheel zoom non câblé'); return; }

  // LIT-COMPONENTS-10: remove any previously attached handler before re-attaching,
  // so calling this function more than once does not pile up listeners.
  if (tlist._zoomWheelHandler) tlist.removeEventListener('wheel', tlist._zoomWheelHandler);

  const _handler = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;    // requiert Ctrl (ou Cmd sur macOS)
    e.preventDefault();                       // bloque le zoom navigateur
    const now = Date.now();
    if (now - _wheelLastAt < _WHEEL_THROTTLE_MS) return;
    _wheelLastAt = now;
    if (e.deltaY < 0)      tlistZoomIn();     // scroll vers le haut → plus grand
    else if (e.deltaY > 0) tlistZoomOut();    // scroll vers le bas → plus petit
  };

  // LIT-COMPONENTS-10: store reference so future calls and teardown can remove it.
  tlist._zoomWheelHandler = _handler;
  tlist.addEventListener('wheel', _handler, { passive: false });
}
