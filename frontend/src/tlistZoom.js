// @ts-check
/** @import { ZoomLevel } from './types.js' */
// LibreFlow — tlistZoom.js
// Zoom de la liste de pistes : Compact / Comfortable / Spacious (proportions Spotify).
// Source de vérité unique : cfg.tlistZoom.
//
// API publique :
//   setTlistZoom(level, opts) — applique un niveau (data-attr + VIRT.ROW_H + cfg + re-render + HUD)
//   tlistZoomIn()         — niveau suivant (plus grand) si possible
//   tlistZoomOut()        — niveau précédent (plus petit) si possible
//   tlistZoomReset()      — retour à 'comfortable'
//   _nextZoomLevel(cur, dir) — logique pure de cycling (testable sans DOM)
//   TLIST_ZOOM_LEVELS     — ['compact','comfortable','spacious']
//   TLIST_ZOOM_ROW_H      — {compact:44, comfortable:56, spacious:72} — DOIT rester
//                           synchro avec --tr-h sous [data-tlist-zoom] (design-system.css) :
//                           VIRT.ROW_H (le pas du virtual scroll) doit toujours correspondre
//                           à la hauteur RÉELLEMENT rendue par .tr, sous peine de désynchroniser
//                           le rendu de la position de scroll (lignes tronquées, cf. historique).

import { VIRT }            from './virt.js';
import { set, get }        from './store.js';
import { emit, EVENTS }    from './bus.js';
import { saveCfg }         from './cfgsave.js';
import { i18n }            from './i18n.js';

export const TLIST_ZOOM_LEVELS = ['compact', 'comfortable', 'spacious'];

// comfortable = 56 / spacious = 72 (proportions Spotify — art scale en même temps,
// voir --tart-size dans design-system.css). compact = 44 (pas moins) : plancher
// WCAG 2.5.8 partagé avec .tr { min-height: 44px }.
export const TLIST_ZOOM_ROW_H = {
  compact:     44,
  comfortable: 56,
  spacious:    72,
};

// Anciens noms de niveaux (avant le renommage Spotify) → nouveaux noms.
// Remappe une seule fois, à l'entrée de setTlistZoom() — pas de double mapping :
// 'comfortable' (déjà un nom valide aujourd'hui, = spacious) ne repasse pas dans
// la map une deuxième fois puisque le lookup n'est fait qu'une fois par appel.
const _LEGACY_ZOOM_MAP = { normal: 'comfortable', comfortable: 'spacious' };

/**
 * Logique pure de cycling (sans effet de bord — testable unitairement).
 * @param {ZoomLevel} current  niveau actuel
 * @param {'in'|'out'} dir     direction
 * @returns {ZoomLevel} niveau résultant (identique si déjà à la limite)
 */
export function _nextZoomLevel(current, dir) {
  const idx = TLIST_ZOOM_LEVELS.indexOf(current);
  if (idx === -1) return 'comfortable';
  if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
  if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
  return current;
}

// ── HUD feedback (#zoom-hud, index.html) ─────────────────────────────────────
let _hudTimer = null;

/** Affiche brièvement le nom du niveau dans #zoom-hud, puis le masque après 1.2s. */
function _showZoomHud(level) {
  const hud = document.getElementById('zoom-hud');
  if (!hud) return;
  hud.textContent = i18n(`tlist_zoom_${level}`) || level;
  hud.classList.add('show');
  clearTimeout(_hudTimer);
  _hudTimer = setTimeout(() => hud.classList.remove('show'), 1200);
}

/**
 * Applique un niveau de zoom à la liste de pistes.
 * Synchronise : attribut data-tlist-zoom → CSS, VIRT.ROW_H, store, cfg, re-render, HUD.
 * @param {ZoomLevel} level  'compact' | 'comfortable' | 'spacious' (ou un ancien nom,
 *   remappé automatiquement via _LEGACY_ZOOM_MAP)
 * @param {{ silent?: boolean }} [opts] — silent:true = pas de HUD (boot initial)
 * @returns {void}
 */
export function setTlistZoom(level, { silent = false } = {}) {
  level = _LEGACY_ZOOM_MAP[level] || level;

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
  set('tlistZoom', level);
  saveCfg();

  // 5. Feedback visuel — pas au boot (silent:true), seulement sur action utilisateur
  if (!silent) _showZoomHud(level);

  // 6. Forcer un re-render de la liste
  // R1-A FIX : ne pas émettre au boot quand tracks[] est encore vide — évite
  // l'écran "liste vide" de 300-600 ms causé par le RENDER_LIB prématuré.
  if (get('tracks')?.length) emit(EVENTS.RENDER_LIB, {});
}

/** Passe au niveau plus grand si possible (compact → comfortable → spacious). */
export function tlistZoomIn() {
  const cur = get('tlistZoom') || 'comfortable';
  setTlistZoom(_nextZoomLevel(cur, 'in'));
}

/** Passe au niveau plus petit si possible (spacious → comfortable → compact). */
export function tlistZoomOut() {
  const cur = get('tlistZoom') || 'comfortable';
  setTlistZoom(_nextZoomLevel(cur, 'out'));
}

/** Remet la densité à 'comfortable'. */
export function tlistZoomReset() {
  setTlistZoom('comfortable');
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
  if (tlist._tlistZoomWheelBound) return;     // idempotence
  tlist._tlistZoomWheelBound = true;

  tlist.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;    // requiert Ctrl (ou Cmd sur macOS)
    e.preventDefault();                       // bloque le zoom navigateur
    const now = Date.now();
    if (now - _wheelLastAt < _WHEEL_THROTTLE_MS) return;
    _wheelLastAt = now;
    if (e.deltaY < 0)      tlistZoomIn();     // scroll vers le haut → plus grand
    else if (e.deltaY > 0) tlistZoomOut();    // scroll vers le bas → plus petit
  }, { passive: false });
}
