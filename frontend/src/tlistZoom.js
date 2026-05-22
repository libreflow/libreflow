// LibreFlow — tlistZoom.js
// Zoom de la liste de pistes : Compact / Normal / Confortable.
// Source de vérité unique : cfg.tlistZoom.
//
// API publique :
//   setTlistZoom(level)   — applique un niveau (data-attr + VIRT.ROW_H + cfg + re-render)
//   tlistZoomIn()         — niveau suivant (plus grand) si possible
//   tlistZoomOut()        — niveau précédent (plus petit) si possible
//   tlistZoomReset()      — retour à 'normal'
//   _nextZoomLevel(cur, dir) — logique pure de cycling (testable sans DOM)
//   TLIST_ZOOM_LEVELS     — ['compact','normal','comfortable']
//   TLIST_ZOOM_ROW_H      — {compact:36, normal:48, comfortable:60}

import { VIRT }            from './virt.js';
import { set, get }        from './store.js';
import { emit, EVENTS }    from './bus.js';
import { saveCfg }         from './cfgsave.js';

export const TLIST_ZOOM_LEVELS = ['compact', 'normal', 'comfortable'];

export const TLIST_ZOOM_ROW_H = {
  compact:     36,
  normal:      48,
  comfortable: 60,
};

/**
 * Logique pure de cycling (sans effet de bord — testable unitairement).
 * @param {string} current  niveau actuel
 * @param {'in'|'out'} dir  direction
 * @returns {string} niveau résultant (identique si déjà à la limite)
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
 * @param {string} level  'compact' | 'normal' | 'comfortable'
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
  set('tlistZoom', level);
  saveCfg();

  // 5. Forcer un re-render de la liste
  emit(EVENTS.RENDER_LIB, {});
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
