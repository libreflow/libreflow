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
// PRÉCISION (v2) :
//   - Snap magnétique multi-cibles pendant le drag/resize : bords + centres
//     de la fenêtre, bords des autres panneaux, et titlebar (marge 8px) ;
//   - Guides d'alignement (.snap-guide-x/.snap-guide-y) affichés pendant
//     l'accroche, retirés dès la sortie du champ magnétique ;
//   - Alt maintenu = snap désactivé pour un placement libre au pixel ;
//   - Clavier : flèches = 8 px, Maj+flèches = 32 px, Alt+flèches = 1 px ;
//     Home/End/Shift+Home… respectent le snap (bords fenêtre) ;
//   - Double-clic sur .panel-drag = répartition optimisée (métro).
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
/** Champ magnétique d'accroche (px). */
const SNAP_RANGE = 8;
/** Marge minimum entre un panneau et le bord de la fenêtre (px). */
const EDGE_MARGIN = 8;
/** Plan des panneaux flottants — sous les dropdowns (200) et la titlebar. */
const PANEL_Z_BASE = 150;
const PANEL_Z_SPAN = 20;

function _tbHeight() {
  const el = document.getElementById('tb');
  return el ? Math.round(el.getBoundingClientRect().height) || 38 : 38;
}

function _panelOrder() {
  // Ordre visuel courant : le panneau avec le plus grand z au-dessus.
  const layout = get('panelLayout') || {};
  return [...PANELS].sort(
    (a, b) => (layout[a]?.z ?? 0) - (layout[b]?.z ?? 0) || a.localeCompare(b)
  );
}

function _zIndexFor(z) {
  // z borné : les 3 panneaux occupent PANEL_Z_BASE..PANEL_Z_BASE+SPAN
  const k = PANELS.length > 1 ? Math.min(z, PANELS.length - 1) / (PANELS.length - 1) : 1;
  return Math.round(PANEL_Z_BASE + k * PANEL_Z_SPAN);
}

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

/** Clamp le panneau dans les limites de la fenêtre (titlebar dynamique). */
function _clampRect(id, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = _tbHeight();
  const minH = id === 'pl' ? PL_MIN_H : MIN_H;
  const w = Math.max(MIN_W, Math.min(rect.w, vw - 2 * EDGE_MARGIN));
  const h = Math.max(minH, Math.min(rect.h, vh - top - EDGE_MARGIN));
  const x = Math.max(EDGE_MARGIN, Math.min(Math.round(rect.x), vw - w - EDGE_MARGIN));
  const y = Math.max(top, Math.min(Math.round(rect.y), vh - h - EDGE_MARGIN));
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
    el.style.zIndex = String(_zIndexFor(r.z ?? 0));
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
  // Renormalise : le panneau demandé passe à z = 2, les autres répartis 0..1
  // selon leur ordre visuel courant (z borné, pas de croissance infinie).
  const order = _panelOrder().filter((p) => p !== id);
  const next = { ...layout };
  let z = 0;
  for (const p of order) next[p] = { ...(next[p] || _defaultRect(p)), z: z++ };
  next[id] = { ...(next[id] || _defaultRect(id)), z: PANELS.length - 1 };
  set('panelLayout', next);
  _applyAll();
  _persist();
}

// ── Snap magnétique + guides visuels ────────────────────────────────────────

/**
 * Collecte les cibles X (verticales) et Y (horizontales) candidates :
 * bords + centres de la fenêtre, bords des autres panneaux.
 * Retourne { xs:Set<number>, ys:Set<number> }.
 */
function _snapTargets(dragId) {
  /** @type {Set<number>} */
  const xs = new Set();
  /** @type {Set<number>} */
  const ys = new Set();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = _tbHeight();
  // Fenêtre : bords (avec marge) + centre
  xs.add(EDGE_MARGIN);
  xs.add(Math.round(vw / 2));
  xs.add(vw - EDGE_MARGIN);
  ys.add(top);
  ys.add(Math.round((top + vh) / 2));
  ys.add(vh - EDGE_MARGIN);
  // Autres panneaux : bords gauche/droit (X), haut/bas (Y)
  const layout = get('panelLayout') || {};
  for (const p of PANELS) {
    if (p === dragId) continue;
    const r = layout[p];
    if (!r) continue;
    xs.add(r.x);
    xs.add(r.x + r.w);
    ys.add(r.y);
    ys.add(r.y + r.h);
  }
  return { xs, ys };
}

/** Retourne la valeur snappée si une cible est à ≤ SNAP_RANGE, sinon null. */
function _snapTo(val, targets) {
  let best = null;
  let bestD = SNAP_RANGE + 1;
  for (const t of targets) {
    const d = Math.abs(t - val);
    if (d <= SNAP_RANGE && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

let _guideX = null;
let _guideY = null;

/** Crée/met à jour les deux lignes guides (une par axe). */
function _showGuides() {
  if (!_guideX) {
    _guideX = document.createElement('div');
    _guideX.className = 'snap-guide snap-guide-y'; // ligne verticale (axe X)
    _guideX.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_guideX);
  }
  if (!_guideY) {
    _guideY = document.createElement('div');
    _guideY.className = 'snap-guide snap-guide-x'; // ligne horizontale (axe Y)
    _guideY.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_guideY);
  }
}

function _hideGuides() {
  _guideX?.remove();
  _guideY?.remove();
  _guideX = null;
  _guideY = null;
}

/** Positionne un guide vertical sur x (pleine hauteur) ou horizontal sur y. */
function _placeGuideX(x) {
  _showGuides();
  _guideX.style.display = 'block';
  _guideX.style.left = x + 'px';
}
function _placeGuideY(y) {
  _showGuides();
  _guideY.style.display = 'block';
  _guideY.style.top = y + 'px';
}
function _clearGuides() {
  if (_guideX) _guideX.style.display = 'none';
  if (_guideY) _guideY.style.display = 'none';
}

/**
 * Applique le snap magnétique au rect proposé pour `id` (mode 'move').
 * Prend en compte le bord gauche/droit et haut/bas du panneau en mouvement,
 * mais aussi son centre. Alt (ev.altKey) = snap off.
 */
function _snapMove(id, rect, altKey) {
  if (altKey) return { rect, guides: null };
  const { xs, ys } = _snapTargets(id);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const out = { ...rect };
  const guides = { x: null, y: null };
  // X : bord gauche, centre, bord droit
  for (const [val, set] of [
    [rect.x, xs],
    [cx, xs],
    [rect.x + rect.w, xs]
  ]) {
    const s = _snapTo(val, set);
    if (s != null) {
      out.x = rect.x + (s - val);
      guides.x = s;
      break;
    }
  }
  // Y : bord haut, centre, bord bas
  for (const [val, set] of [
    [rect.y, ys],
    [cy, ys],
    [rect.y + rect.h, ys]
  ]) {
    const s = _snapTo(val, set);
    if (s != null) {
      out.y = rect.y + (s - val);
      guides.y = s;
      break;
    }
  }
  return { rect: out, guides };
}

/**
 * Snap en mode resize : coin inférieur droit (bords droit/bas) — le coin
 * s'aligne sur les bords des cibles.
 */
function _snapResize(id, rect, altKey) {
  if (altKey) return { rect, guides: null };
  const { xs, ys } = _snapTargets(id);
  const out = { ...rect };
  const guides = { x: null, y: null };
  const sx = _snapTo(rect.x + rect.w, xs);
  if (sx != null) {
    out.w = sx - out.x;
    guides.x = sx;
  }
  const sy = _snapTo(rect.y + rect.h, ys);
  if (sy != null) {
    out.h = sy - out.y;
    guides.y = sy;
  }
  return { rect: out, guides };
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
      const raw = { ...start, x: start.x + dx, y: start.y + dy };
      const { rect, guides } = _snapMove(_dragged.id, raw, ev.altKey);
      _setRect(_dragged.id, rect, false);
      if (guides?.x != null) _placeGuideX(guides.x);
      else if (_guideX) _guideX.style.display = 'none';
      if (guides?.y != null) _placeGuideY(guides.y);
      else if (_guideY) _guideY.style.display = 'none';
    } else {
      const raw = { ...start, w: start.w + dx, h: start.h + dy };
      const { rect, guides } = _snapResize(_dragged.id, raw, ev.altKey);
      _setRect(_dragged.id, rect, false);
      if (guides?.x != null) _placeGuideX(guides.x);
      else if (_guideX) _guideX.style.display = 'none';
      if (guides?.y != null) _placeGuideY(guides.y);
      else if (_guideY) _guideY.style.display = 'none';
    }
  };
  const onUp = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('panel-gesturing');
    _dragged = null;
    _hideGuides();
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

// ── Keyboard a11y : flèches = déplacer/redimensionner, snap inclus ──────────

/**
 * Pas clavier : 1 px (Alt), 8 px, 32 px (Maj).
 */
function _kStep(e) {
  if (e.altKey) return 1;
  return e.shiftKey ? 32 : 8;
}

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
    } else if (isDrag && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      // Home = bord gauche, End = bord droit (avec snap marge)
      const vw = window.innerWidth;
      const start = _rectOf(id);
      if (e.key === 'Home') _setRect(id, { ...start, x: EDGE_MARGIN });
      else _setRect(id, { ...start, x: vw - start.w - EDGE_MARGIN });
    }
    return;
  }
  e.preventDefault();
  const start = _rectOf(id);
  const step = _kStep(e);
  if (isDrag) {
    const raw = { ...start, x: start.x + delta[0] * step, y: start.y + delta[1] * step };
    // Snap léger au clavier aussi (sauf Alt = pas fin)
    const { rect } = e.altKey ? { rect: raw } : _snapMove(id, raw, false);
    _setRect(id, rect);
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
