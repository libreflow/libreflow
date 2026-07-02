// LibreFlow — sbresize.js
// QUALITÉ-1 (2026-07-02) : redimensionnement accessible de la sidebar.
//
// Surface : la poignée #sb-resize (role="separator", index.html). Trois modes
// d'opération équivalents (SC 2.1.1 / 2.5.7) :
//   - pointeur : drag avec Pointer Events + setPointerCapture ;
//   - clavier  : ←/→ = ±STEP px, Home/End = min/max ;
//   - reset    : double-clic → largeur par défaut (retire l'override).
//
// La largeur vit dans la custom property --sb, posée inline sur <html>. En
// mode compact (<720px) la media query `:root { --sb: var(--sb-sm) }` doit
// gagner : l'override inline est retiré tant que le breakpoint est actif et
// ré-appliqué quand on repasse au-dessus. Persistance via cfg.sbWidth
// (saveCfg, débouncé §8) — restaurée au boot par app.js avant initSbResize().
//
// Dépendances autorisées (§6) : store.js, cfgsave.js.

import { get, set } from './store.js';
import { saveCfg }  from './cfgsave.js';

export const SB_MIN     = 200;
export const SB_MAX     = 420;
export const SB_DEFAULT = 260;
const STEP = 8;

let _handle = null;
let _mqCompact = null;

function _clamp(px) { return Math.max(SB_MIN, Math.min(SB_MAX, Math.round(px))); }

/** Applique la largeur au layout (inline --sb) + reflète aria-valuenow. */
function _apply(px) {
  const root = document.documentElement;
  if (px == null || (_mqCompact && _mqCompact.matches)) {
    // null = largeur par défaut (token) ; compact = --sb-sm doit gagner
    root.style.removeProperty('--sb');
  } else {
    root.style.setProperty('--sb', px + 'px');
  }
  _handle?.setAttribute('aria-valuenow', String(px == null ? SB_DEFAULT : px));
}

/** Fixe la largeur (null = reset) ; persiste sauf pendant un drag en cours. */
function _setWidth(px, persist = true) {
  const w = px == null ? null : _clamp(px);
  set('sbWidth', w);
  _apply(w);
  if (persist) saveCfg();
}

function _currentWidth() {
  const stored = get('sbWidth');
  if (Number.isFinite(stored)) return stored;
  const el = document.getElementById('sb');
  return el ? Math.round(el.getBoundingClientRect().width) : SB_DEFAULT;
}

function _onKeyDown(e) {
  let next = null;
  if      (e.key === 'ArrowLeft')  next = _currentWidth() - STEP;
  else if (e.key === 'ArrowRight') next = _currentWidth() + STEP;
  else if (e.key === 'Home')       next = SB_MIN;
  else if (e.key === 'End')        next = SB_MAX;
  else return;
  e.preventDefault();
  _setWidth(next);
}

function _onPointerDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startX = e.clientX;
  const startW = _currentWidth();
  _handle.setPointerCapture(e.pointerId);
  document.body.classList.add('sb-resizing');

  const onMove = ev => _setWidth(startW + (ev.clientX - startX), false);
  const onUp = () => {
    _handle.removeEventListener('pointermove', onMove);
    _handle.removeEventListener('pointerup',     onUp);
    _handle.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('sb-resizing');
    saveCfg(); // persistance une seule fois en fin de geste
  };
  _handle.addEventListener('pointermove', onMove);
  _handle.addEventListener('pointerup',     onUp);
  _handle.addEventListener('pointercancel', onUp);
}

/** Câblé une fois au boot (app.js) — idempotent. */
export function initSbResize() {
  const h = document.getElementById('sb-resize');
  if (!h || h._sbResizeInit) return;
  h._sbResizeInit = true;
  _handle = h;
  _mqCompact = window.matchMedia('(max-width: 719px)');

  h.setAttribute('aria-valuemin', String(SB_MIN));
  h.setAttribute('aria-valuemax', String(SB_MAX));
  _apply(Number.isFinite(get('sbWidth')) ? get('sbWidth') : null);

  h.addEventListener('pointerdown', _onPointerDown);
  h.addEventListener('keydown',     _onKeyDown);
  h.addEventListener('dblclick',    () => _setWidth(null));
  // Franchissement du breakpoint compact : retirer/ré-appliquer l'override
  _mqCompact.addEventListener('change', () => _apply(get('sbWidth')));
}
