// LibreFlow — layout.js
// Disposition libre : la sidebar (#sb), la liste des titres (#main) et la
// player bar (#pl) deviennent des panneaux flottants que l'on peut déplacer
// (drag via la poignée .panel-drag) et redimensionner (poignée .panel-size,
// Pointer Events + setPointerCapture).
//
// Le mode est togglé par data-action="toggle-free-layout" (menu ⋯ de la
// titlebar). La géométrie de chaque panneau vit dans store ('panelLayout')
// et est persistée par cfgsave.js (clé panelLayout).
//
// En mode libre :
//   - <body data-free-layout="on"> : #app passe en position:relative et les
//     panneaux sortent de la grille (position:fixed inline + width/height) ;
//   - un panneau actif monte au-dessus (z-index géré en JS) ;
//   - double-clic sur la poignée de déplacement = recentre/optimise le panneau.
//
// Mode par défaut inchangé : aucune classe/attribut tant que le mode n'est
// pas activé (tests-garde-fous du layout griddle préservés).

import { get, set } from './store.js';
import { saveCfg } from './cfgsave.js';
import { i18n } from './i18n.js';

/** @typedef {{x:number,y:number,w:number,h:number,z:number|null}} PanelRect */

const PANELS = ['sb', 'main', 'pl'];
const MIN_W = 220;
const MIN_H = 120;
const PL_MIN_H = 88;
/** @type {Record<string,PanelRect>|null} */
let _dragged = null;

function _container() {
  return document.getElementById('app');
}

function _defaultRect(id) {
  const el = document.getElementById(id);
  const box = _container()?.getBoundingClientRect();
  if (!el || !box) return { x: 0, y: 0, w: MIN_W, h: MIN_H, z: null };
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left - box.left),
    y: Math.round(r.top - box.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
    z: null
  };
}

/** Clamp le panneau dans les limites de la fenêtre. */
function _clampRect(id, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minH = id === 'pl' ? PL_MIN_H : MIN_H;
  const w = Math.max(MIN_W, Math.min(rect.w, vw));
  const h = Math.max(minH, Math.min(rect.h, vh));
  const x = Math.max(8, Math.min(Math.round(rect.x), vw - w - 8));
  const y = Math.max(8, Math.min(Math.round(rect.y), vh - h - 8));
  return { x, y, w: Math.round(w), h: Math.round(h), z: rect.z ?? null };
}

function _applyAll() {
  const layout = get('panelLayout');
  if (!get('freeLayout')) {
    document.body.removeAttribute('data-free-layout');
    for (const id of PANELS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.removeProperty('position');
      el.style.removeProperty('left');
      el.style.removeProperty('top');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('z-index');
      el.style.removeProperty('--pb');
      el.querySelector('.panel-drag')?.remove();
      el.querySelector('.panel-size')?.remove();
    }
    return;
  }
  document.body.setAttribute('data-free-layout', 'on');
  for (const id of PANELS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = layout?.[id] || _defaultRect(id);
    el.style.position = 'fixed';
    el.style.left = r.x + 'px';
    el.style.top = r.y + 'px';
    el.style.width = r.w + 'px';
    el.style.height = r.h + 'px';
    el.style.zIndex = String(40 + (r.z ?? 0));
    if (id === 'pl') el.style.setProperty('--pb', r.h + 'px');
    if (!el.querySelector('.panel-drag')) {
      const drag = document.createElement('div');
      drag.className = 'panel-drag';
      drag.dataset.panelId = id;
      drag.setAttribute('role', 'button');
      drag.tabIndex = 0;
      drag.setAttribute(
        'aria-label',
        i18n('free_layout_move') + ' — ' + el.getAttribute('aria-label') || ''
      );
      drag.title = i18n('free_layout_move');
      el.prepend(drag);
    }
    if (!el.querySelector('.panel-size')) {
      const size = document.createElement('div');
      size.className = 'panel-size';
      size.dataset.panelId = id;
      size.setAttribute('role', 'separator');
      size.tabIndex = 0;
      size.setAttribute(
        'aria-label',
        i18n('free_layout_resize') + ' — ' + el.getAttribute('aria-label') || ''
      );
      size.title = i18n('free_layout_resize');
      el.appendChild(size);
    }
  }
}

function _persist(persist = true) {
  if (persist) saveCfg();
}

function _rectOf(id) {
  const layout = get('panelLayout') || {};
  return layout[id] || _defaultRect(id);
}

function _setRect(id, rect, persist = true) {
  const layout = { ...(get('panelLayout') || {}) };
  layout[id] = _clampRect(id, rect);
  set('panelLayout', layout);
  _applyAll();
  _persist(persist);
}

function _bringToFront(id) {
  const layout = get('panelLayout') || {};
  const top = PANELS.reduce((m, p) => Math.max(m, layout[p]?.z ?? 0), 0);
  if ((layout[id]?.z ?? 0) === top && top > 0) return;
  const next = { ...layout };
  for (const p of PANELS) {
    const z = next[p]?.z ?? 0;
    next[p] = { ...(next[p] || _defaultRect(p)), z: p === id ? top + 1 : Math.max(0, z - 1) };
  }
  set('panelLayout', next);
  _applyAll();
  _persist();
}

// ── Pointer handling (drag + resize) ────────────────────────────────────────

function _startGesture(e, mode) {
  const id = e.target.dataset.panelId;
  const el = document.getElementById(id);
  if (!id || !el || e.button !== 0) return;
  e.preventDefault();
  _bringToFront(id);
  const start = _rectOf(id);
  const sx = e.clientX;
  const sy = e.clientY;
  _dragged = { id, mode };
  el.setPointerCapture(e.pointerId);
  document.body.classList.add('panel-gesturing');

  const onMove = (ev) => {
    if (!_dragged) return;
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (_dragged.mode === 'move') {
      _setRect(_dragged.id, { ...start, x: start.x + dx, y: start.y + dy }, false);
    } else {
      _setRect(_dragged.id, { ...start, w: start.w + dx, h: start.h + dy }, false);
    }
  };
  const onUp = (ev2) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('panel-gesturing');
    _dragged = null;
    saveCfg();
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function _onPointerDown(e) {
  if (e.target instanceof HTMLElement && e.target.classList.contains('panel-size')) {
    _startGesture(e, 'size');
  }
}

function _onDragPointerDown(e) {
  if (e.target instanceof HTMLElement && e.target.classList.contains('panel-drag')) {
    _startGesture(e, 'move');
  }
}

// ── Keyboard a11y : flèches = déplacer, Shift+flèches = redimensionner ──────

const KSTEP = 16;

function _onKeyDown(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const isDrag = t.classList.contains('panel-drag');
  const isSize = t.classList.contains('panel-size');
  if (!isDrag && !isSize) return;
  const id = t.dataset.panelId;
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }[e.key];
  if (!delta) {
    if (e.key === 'Enter' && isDrag) {
      e.preventDefault();
      _bringToFront(id);
    }
    return;
  }
  e.preventDefault();
  const start = _rectOf(id);
  const step = e.shiftKey ? KSTEP * 4 : KSTEP;
  if (isDrag) {
    _setRect(id, { ...start, x: start.x + delta[0] * step, y: start.y + delta[1] * step });
  } else {
    _setRect(id, {
      ...start,
      w: start.w + delta[0] * step,
      h: start.h + delta[1] * step
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Toggle le mode disposition libre. */
export function toggleFreeLayout() {
  const next = !get('freeLayout');
  set('freeLayout', next);
  if (next && !get('panelLayout')) {
    const layout = {};
    for (const id of PANELS) layout[id] = _defaultRect(id);
    set('panelLayout', layout);
  }
  _applyAll();
  saveCfg();
}

/** Reflète aria-pressed sur le bouton du menu ⋯ (comme syncMiniSettingsBtn). */
export function syncFreeLayoutBtn() {
  const btn = document.getElementById('tbt-free-layout');
  if (btn) btn.setAttribute('aria-pressed', String(get('freeLayout') === true));
}

/** Init au boot (app.js) — idempotent, restauré depuis cfg.freeLayout. */
export function initFreeLayout() {
  if (document.body._freeLayoutInit) return;
  document.body._freeLayoutInit = true;
  document.addEventListener('pointerdown', _onDragPointerDown, true);
  document.addEventListener('pointerdown', _onPointerDown, true);
  document.addEventListener('keydown', _onKeyDown, true);
  window.addEventListener('resize', () => {
    if (get('freeLayout')) _applyAll();
  });
  if (get('freeLayout')) _applyAll();
}
