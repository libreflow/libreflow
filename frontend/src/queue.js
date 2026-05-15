// LibreFlow — queue.js
// Panneau de file d'attente : affichage, drag-and-drop, lecture directe.
// Extrait de app.js.
//
// Remaining window.* : closeSettings (app.js — pas encore extrait).
//
// Exports publics (utilisés par app.js + HTML) :
//   queueOpen
//   toggleQueue, closeQueue, renderQueue, refreshQueueBadge
//   getQueueState, restoreQueueState, clearQueueOverride
//   removeFromQueue, clearExplicitQueue
//   addToQueueNext, addToQueueEnd, playQueueItem
//   initQueueDrag (Task 4)

import { esc, extEmoji, fmtd }            from './utils.js';
import { eqOpen, closeEQ }                from './eq.js';
import { i18n }                           from './i18n.js';
import { get, set }                       from './store.js';
import { getFiltered, filteredIdx, _trackIdxMap,
         invalidateFilterCache }          from './search.js';
import { playAt, togglePlay, isCurrentTrack, audio } from './player.js';
import { patchPlayState } from './renderer.js';
import { closeSettings } from './settings.js';
import { emit, EVENTS } from './bus.js';
import { toast } from './ui.js';
import { setView } from './views.js';

// ── State ────────────────────────────────────────────────────
export let queueOpen  = false;
// BUG FIX : mémoriser l'ordre de la queue après un drag-drop utilisateur.
// On stocke les IDs + le curIdx au moment du reorder pour détecter un changement de piste.
let _queueOverride        = null; // null | Array<string> (IDs dans l'ordre voulu)
let _queueOverrideTrackId = null; // ID de la piste en cours au moment du reorder (pas l'index)

// ── Drag Pointer Events ──────────────────────────────────────────────────────
const Q_ROW_H = 50; // hauteur px d'un .queue-item — padding 7px*2 + art 36px

let _ptrState = null; // null quand inactif
let _springBackTimer = null;

// ── Data builders ────────────────────────────────────────────

/** Queue explicite : map _queueOverride vers Track[], filtre IDs invalides. */
function _buildExplicitQueue() {
  if (!_queueOverride || !_queueOverride.length) return [];
  const tracks = get('tracks');
  return _queueOverride
    .filter(id => _trackIdxMap?.has(id))
    .map(id => tracks[_trackIdxMap.get(id)]);
}

/** Queue naturelle : tracks filtrées après la piste en cours, sans les IDs explicites. */
function _buildNaturalUpcoming() {
  const fl      = getFiltered();
  const curIdx  = get('curIdx');
  const tracks  = get('tracks');
  const overSet = new Set(_queueOverride || []);
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;
  // curTrack = null → startFl = -1 → loop starts at 0 → shows full filtered list
  const startFl = curTrack ? filteredIdx(curTrack) : -1;
  const result  = [];
  for (let i = startFl + 1; i < fl.length && result.length < 50; i++) {
    if (!overSet.has(fl[i].id)) result.push(fl[i]);
  }
  return result;
}

/** Source textuelle pour le header "À suivre : [source]". */
function _getQueueSource() {
  const view = get('view');
  if (view === 'liked')    return 'Titres aimés';
  if (view === 'radio')    return 'Radio';
  if (view === 'playlist') {
    const pl = (get('playlists') || []).find(p => p.id === get('curPlId'));
    if (pl?.name) return pl.name;
  }
  return 'Bibliothèque';
}

/** Retourne l'état courant de la queue pour la persistance en cfg. */
export function getQueueState() {
  return {
    ids:      _queueOverride        ? [..._queueOverride]  : null,
    anchorId: _queueOverrideTrackId ?? null,
  };
}

/**
 * Restaure la queue après le boot (appelé après rebuildTrackIdxMap).
 * IDs invalides (piste supprimée) sont silencieusement filtrés.
 */
export function restoreQueueState({ ids, anchorId } = {}) {
  if (!Array.isArray(ids) || !ids.length) return;
  _queueOverride        = ids.filter(id => _trackIdxMap?.has(id));
  _queueOverrideTrackId = anchorId ?? null;
  if (_queueOverride.length) _updateQueueBadge(_queueOverride.length);
  else { _queueOverride = null; _queueOverrideTrackId = null; }
}

/** Réinitialise l'override (appelé depuis app.js quand la piste en cours change). */
export function clearQueueOverride() {
  _queueOverride = null; _queueOverrideTrackId = null;
  // Le badge doit refléter la queue naturelle, pas forcément 0
  refreshQueueBadge();
}

/** Retire un ID de la queue explicite. */
export function removeFromQueue(id) {
  if (!_queueOverride) return;
  _queueOverride = _queueOverride.filter(x => x !== id);
  if (!_queueOverride.length) {
    _queueOverride        = null;
    _queueOverrideTrackId = null;
  }
  refreshQueueBadge();
  if (queueOpen) renderQueue();
}

/** Vide entièrement la queue explicite. */
export function clearExplicitQueue() {
  _queueOverride        = null;
  _queueOverrideTrackId = null;
  refreshQueueBadge();
  if (queueOpen) renderQueue();
}

/** Recalcule et affiche le badge sans ouvrir le panneau. Appelé par app.js après chaque playAt. */
export function refreshQueueBadge() {
  _updateQueueBadge(_buildUpcoming().length);
}

/** Met à jour le badge numérique sur #btn-queue. Accepte aussi '∞' pour repeat='one'. */
function _updateQueueBadge(count) {
  const badge = document.getElementById('queue-badge');
  if (!badge) return;
  if (count === '∞') {
    badge.textContent = '∞';
    badge.style.display = '';
    return;
  }
  badge.textContent = count > 0 ? String(count > 99 ? '99+' : count) : '';
  badge.style.display = count > 0 ? '' : 'none';
}

/** Construit la liste "upcoming" courante (override ou ordre filtré). */
function _buildUpcoming() {
  const explicit = _buildExplicitQueue();
  const natural  = _buildNaturalUpcoming();
  return [...explicit, ...natural];
}

// ── Toggle / close ───────────────────────────────────────────

export function toggleQueue() {
  queueOpen = !queueOpen;
  document.getElementById('queue-panel').classList.toggle('open', queueOpen);
  document.getElementById('btn-queue').classList.toggle('active', queueOpen);
  document.getElementById('app')?.classList.toggle('panel-queue-open', queueOpen);
  if (eqOpen) closeEQ();
  if (queueOpen && document.getElementById('settings-panel').classList.contains('on')) closeSettings();
  if (queueOpen) { renderQueue(); initQueueDrag(); }
}

export function closeQueue() {
  if (_springBackTimer) {
    clearTimeout(_springBackTimer);
    document.querySelectorAll('.queue-ghost').forEach(el => el.remove());
    _springBackTimer = null;
  }
  if (_ptrState) {
    _cleanupDrag(_ptrState.ghost, _ptrState.items || [], _ptrState.itemEl);
    document.getElementById('queue-list')?.classList.remove('queue-promote-active');
    window.removeEventListener('pointermove',   _onReorderMove);
    window.removeEventListener('pointerup',     _onReorderUp);
    window.removeEventListener('pointercancel', _onReorderUp);
    window.removeEventListener('pointermove',   _onPromotionMove);
    window.removeEventListener('pointerup',     _onPromotionUp);
    window.removeEventListener('pointercancel', _onPromotionUp);
  }
  queueOpen = false;
  document.getElementById('queue-panel').classList.remove('open');
  document.getElementById('btn-queue').classList.remove('active');
  document.getElementById('app')?.classList.remove('panel-queue-open');
}

// ── Rendu ────────────────────────────────────────────────────

export function renderQueue() {
  if (!queueOpen) return;
  initQueueDrag(); // idempotent — guard dataset.dragInit prévient les doubles enregistrements
  const el     = document.getElementById('queue-list');
  const tracks = get('tracks');
  const curIdx = get('curIdx');
  const repeat = get('repeat');

  // repeat='one' — comportement inchangé
  if (repeat === 'one' && curIdx >= 0) {
    const t = tracks[curIdx];
    _updateQueueBadge('∞');
    const artHTML = t?.art
      ? `<img src="${t.art}" alt="">`
      : extEmoji(t?.ext ?? '');
    const row = `<div class="queue-item queue-item--loop" data-action="play-queue-item" data-track-id="${t?.id}">
      <div class="q-art q-art--loop">${artHTML}
        <button class="q-art-hover-play" data-action="toggle-play" tabindex="-1" aria-hidden="true">
          <svg class="icon-play" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        </button>
        <span class="q-loop-icon">🔂</span></div>
      <div class="q-info">
        <div class="q-name">${esc(t?.name ?? '')}</div>
        <div class="q-artist">${esc(t?.artistFull || t?.artist || '–')}</div>
      </div>
      <div class="q-dur">${fmtd(t?.duration ?? 0)}</div>
    </div>`;
    el.innerHTML = Array(5).fill(row).join('');
    patchPlayState(!audio.paused);
    return;
  }

  // Invalider l'override si la piste a changé depuis le reorder
  if (_queueOverride && curIdx >= 0 && tracks[curIdx]?.id !== _queueOverrideTrackId) {
    _queueOverride = null; _queueOverrideTrackId = null;
  }

  const explicit = _buildExplicitQueue();
  const natural  = _buildNaturalUpcoming();

  // repeat='all' : compléter la section naturelle si peu de pistes et pas d'override
  if (!_queueOverride && repeat === 'all' && natural.length < 20 && curIdx >= 0) {
    const fl       = getFiltered();
    const curTrack = tracks[curIdx];
    const startFl  = curTrack ? filteredIdx(curTrack) : -1;
    const naturalSet = new Set(natural.map(t => t.id));
    for (let i = 0; i < fl.length && natural.length < 20; i++) {
      if (i !== startFl && !naturalSet.has(fl[i].id)) {
        natural.push(fl[i]);
        naturalSet.add(fl[i].id);
      }
    }
  }

  _updateQueueBadge(explicit.length + natural.length);

  if (!explicit.length && !natural.length) {
    el.innerHTML = `<div class="queue-empty">${i18n('queue_empty')}</div>`;
    return;
  }

  let html = '';

  // ── Section "Prochainement" (queue explicite) ─────────────
  if (explicit.length) {
    html += `<div class="queue-section-header" role="presentation">
      <span class="queue-section-label">Prochainement (${explicit.length})</span>
      <button class="queue-clear-btn" data-action="clear-queue" aria-label="Vider la file d'attente">✕ tout</button>
    </div>`;
    // A11Y-03: role=listitem + aria-label pour chaque item (remove button labeled)
    html += explicit.map((t, i) => {
      const artHTML  = t.art ? `<img src="${t.art}" alt="">` : extEmoji(t.ext);
      const itemLbl  = `${t.name}${t.artistFull || t.artist ? ' — ' + (t.artistFull || t.artist) : ''}`;
      const rmvLbl   = `Retirer ${t.name} de la file d'attente`;
      return `<div class="queue-item queue-item--explicit" role="listitem" tabindex="0" aria-label="${esc(itemLbl)}" data-id="${t.id}" data-qi="${i}">
        <div class="q-drag-handle" aria-hidden="true"><svg viewBox="0 0 6 14" aria-hidden="true" width="10" height="14"><circle cx="2" cy="2" r="1.2"/><circle cx="5" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="5" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/></svg></div>
        <div class="q-art" aria-hidden="true">${artHTML}
          <button class="q-art-hover-play" data-action="play-queue-item" data-track-id="${t.id}" tabindex="-1" aria-hidden="true">
            <svg class="icon-play" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
          </button>
        </div>
        <div class="q-info">
          <div class="q-name">${esc(t.name)}</div>
          <div class="q-artist">${esc(t.artistFull || t.artist || '–')}</div>
        </div>
        <div class="q-dur" aria-hidden="true">${fmtd(t.duration)}</div>
        <button class="queue-remove-btn" data-action="remove-from-queue" data-track-id="${t.id}" aria-label="${esc(rmvLbl)}" title="Retirer"><span aria-hidden="true">✕</span></button>
      </div>`;
    }).join('');
  }

  // ── Section "À suivre" (naturelle) ──────────────────────
  if (natural.length) {
    html += `<div class="queue-section-divider" role="presentation">À suivre : ${esc(_getQueueSource())}</div>`;
    // A11Y-03: role=listitem + aria-label pour chaque item naturel
    html += natural.slice(0, 50).map((t, i) => {
      const artHTML = t.art ? `<img src="${t.art}" alt="">` : extEmoji(t.ext);
      const itemLbl = `${t.name}${t.artistFull || t.artist ? ' — ' + (t.artistFull || t.artist) : ''}`;
      return `<div class="queue-item queue-item--natural" role="listitem" tabindex="0" aria-label="${esc(itemLbl)}" data-id="${t.id}" data-ni="${i}"
          data-action="play-queue-item" data-track-id="${t.id}">
        <div class="q-art" aria-hidden="true">${artHTML}
          <button class="q-art-hover-play" data-action="play-queue-item" data-track-id="${t.id}" tabindex="-1" aria-hidden="true">
            <svg class="icon-play" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
          </button>
        </div>
        <div class="q-info">
          <div class="q-name">${esc(t.name)}</div>
          <div class="q-artist">${esc(t.artistFull || t.artist || '–')}</div>
        </div>
        <div class="q-dur" aria-hidden="true">${fmtd(t.duration)}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
  // innerHTML wipes .playing-row -> restore from audio state.
  patchPlayState(!audio.paused);
}

// ── Drag helpers ─────────────────────────────────────────────

function _createGhost(itemEl, rect) {
  const ghost = itemEl.cloneNode(true);
  ghost.className = 'queue-ghost';
  ghost.style.cssText = [
    `left:${rect.left}px`, `top:${rect.top}px`,
    `width:${rect.width}px`, `height:${rect.height}px`,
  ].join(';');
  document.body.appendChild(ghost);
  return ghost;
}

function _cleanupDrag(ghost, items, itemEl) {
  ghost.remove();
  if (itemEl) itemEl.classList.remove('q-placeholder');
  items.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _ptrState = null;
}

// ── Init drag (appelé une seule fois) ───────────────────────

export function initQueueDrag() {
  const el = document.getElementById('queue-list');
  if (!el || el.dataset.dragInit) return;
  el.dataset.dragInit = '1';
  el.addEventListener('pointerdown', _onQueuePointerDown);
}

function _onQueuePointerDown(e) {
  // Reorder explicite : drag depuis le handle uniquement
  const handle = e.target.closest('.q-drag-handle');
  if (handle) {
    const itemEl = handle.closest('.queue-item--explicit');
    if (itemEl) { _startReorderDrag(e, itemEl); return; }
  }
  // Promotion : drag depuis item naturel (pas depuis un bouton d'action)
  if (!e.target.closest('[data-action]')) {
    const natural = e.target.closest('.queue-item--natural');
    if (natural) { _startPromotionDrag(e, natural); }
  }
}

// ── Reorder drag (section explicite) ────────────────────────

function _startReorderDrag(e, itemEl) {
  e.preventDefault();
  const listEl = document.getElementById('queue-list');
  const items  = [...listEl.querySelectorAll('.queue-item--explicit')];
  const srcIdx = items.indexOf(itemEl);
  if (srcIdx < 0) return;

  const rect  = itemEl.getBoundingClientRect();
  const ghost = _createGhost(itemEl, rect);

  itemEl.classList.add('q-placeholder');
  items.forEach((el, i) => { if (i !== srcIdx) el.style.transition = 'transform .15s ease'; });

  _ptrState = {
    mode: 'reorder', listEl, itemEl, ghost, items,
    srcIdx, targetIdx: srcIdx,
    startY: e.clientY, startRectTop: rect.top,
  };

  window.addEventListener('pointermove',   _onReorderMove);
  window.addEventListener('pointerup',     _onReorderUp);
  window.addEventListener('pointercancel', _onReorderUp);
}

function _onReorderMove(e) {
  if (!_ptrState || _ptrState.mode !== 'reorder') return;
  const { ghost, items, itemEl, srcIdx, startY, startRectTop } = _ptrState;

  const dy = e.clientY - startY;
  ghost.style.top = (startRectTop + dy) + 'px';

  // Calcul index cible
  const ghostMid = parseFloat(ghost.style.top) + Q_ROW_H / 2;
  let targetIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === itemEl) continue;
    const midY = items[i].getBoundingClientRect().top + Q_ROW_H / 2;
    if (ghostMid > midY) targetIdx = i;
  }
  if (srcIdx <= targetIdx) targetIdx = Math.min(targetIdx, items.length - 1);
  _ptrState.targetIdx = targetIdx;

  // Animer les items voisins
  items.forEach((el, i) => {
    if (el === itemEl) return;
    let shift = 0;
    if (srcIdx < targetIdx && i > srcIdx && i <= targetIdx) shift = -Q_ROW_H;
    if (srcIdx > targetIdx && i >= targetIdx && i < srcIdx) shift =  Q_ROW_H;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function _onReorderUp() {
  if (!_ptrState || _ptrState.mode !== 'reorder') return;
  const { itemEl, ghost, items, srcIdx, targetIdx } = _ptrState;

  if (srcIdx !== targetIdx) {
    const ex = _buildExplicitQueue();
    const [moved] = ex.splice(srcIdx, 1);
    ex.splice(targetIdx, 0, moved);
    _queueOverride        = ex.map(t => t.id);
    _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;
  }

  _cleanupDrag(ghost, items, itemEl);
  window.removeEventListener('pointermove',   _onReorderMove);
  window.removeEventListener('pointerup',     _onReorderUp);
  window.removeEventListener('pointercancel', _onReorderUp);
  renderQueue();
}

// ── Promotion drag (section naturelle → explicite) ───────────

function _startPromotionDrag(e, itemEl) {
  e.preventDefault();
  const listEl  = document.getElementById('queue-list');
  const trackId = itemEl.dataset.id;
  if (!trackId) return;

  const rect  = itemEl.getBoundingClientRect();
  const ghost = _createGhost(itemEl, rect);
  ghost.classList.add('queue-ghost--promote');

  itemEl.classList.add('q-placeholder');

  _ptrState = {
    mode: 'promote', listEl, itemEl, ghost, trackId,
    items: [],  // pas d'items à animer pour la promotion (contrairement au reorder)
    startY: e.clientY, startRectTop: rect.top,
    targetIdx: -1,
  };

  window.addEventListener('pointermove',   _onPromotionMove);
  window.addEventListener('pointerup',     _onPromotionUp);
  window.addEventListener('pointercancel', _onPromotionUp);
}

function _onPromotionMove(e) {
  if (!_ptrState || _ptrState.mode !== 'promote') return;
  const { ghost, listEl, startY, startRectTop } = _ptrState;

  const dy = e.clientY - startY;
  ghost.style.top = (startRectTop + dy) + 'px';

  // Détecter si le ghost est au-dessus du séparateur "À suivre"
  const divider = listEl.querySelector('.queue-section-divider');
  const inZone  = divider
    ? e.clientY < divider.getBoundingClientRect().top
    : true; // pas encore de section explicite → toute la zone est valide

  listEl.classList.toggle('queue-promote-active', inZone);

  if (inZone) {
    const explicitItems = [...listEl.querySelectorAll('.queue-item--explicit')];
    const ghostTop = parseFloat(ghost.style.top);
    const ghostMid = ghostTop + Q_ROW_H / 2;
    let targetIdx = 0;
    for (let i = 0; i < explicitItems.length; i++) {
      const midY = explicitItems[i].getBoundingClientRect().top + Q_ROW_H / 2;
      if (ghostMid > midY) targetIdx = i + 1;
    }
    _ptrState.targetIdx = targetIdx;
  } else {
    _ptrState.targetIdx = -1;
  }
}

function _onPromotionUp() {
  if (!_ptrState || _ptrState.mode !== 'promote') return;
  const { itemEl, ghost, listEl, trackId, targetIdx } = _ptrState;

  listEl.classList.remove('queue-promote-active');

  const _removePromotionListeners = () => {
    window.removeEventListener('pointermove',   _onPromotionMove);
    window.removeEventListener('pointerup',     _onPromotionUp);
    window.removeEventListener('pointercancel', _onPromotionUp);
  };

  if (targetIdx >= 0) {
    // Promouvoir : insérer dans la queue explicite à targetIdx
    const current  = _queueOverride ? [..._queueOverride] : [];
    const filtered = current.filter(id => id !== trackId);
    filtered.splice(targetIdx, 0, trackId);
    _queueOverride        = filtered;
    _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;

    ghost.remove();
    itemEl.classList.remove('q-placeholder');
    _ptrState = null;
    _removePromotionListeners();
    renderQueue();
  } else {
    // Spring-back : annuler avec animation
    ghost.classList.add('queue-ghost--spring');
    _springBackTimer = setTimeout(() => { ghost.remove(); _springBackTimer = null; }, 300);
    itemEl.classList.remove('q-placeholder');
    _ptrState = null;
    _removePromotionListeners();
    // Pas de renderQueue() : rien n'a changé
  }
}

export function playQueueItem(id) {
  if (_ptrState) return;
  const t = (_trackIdxMap.has(id) ? get('tracks')[_trackIdxMap.get(id)] : undefined);
  if (!t) return;
  // repeat=one : toggle au lieu de redémarrer la piste courante.
  if (isCurrentTrack(id)) { togglePlay(); return; }
  const fi = filteredIdx(t);
  if (fi >= 0) { removeFromQueue(id); playAt(fi, { keepQueue: true }); return; }
  // UX-QUEUE-1 FIX : piste hors vue courante → basculer vers 'all' et jouer
  // Couvre : filtre actif, vue "liked" (piste non aimée), vue "playlist" (piste absente)
  const srch = document.getElementById('srch');
  if (srch && srch.value) {
    srch.value = '';
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
    set('query', '');
    invalidateFilterCache();
  }
  setView('all', document.getElementById('ni-all'));
  emit(EVENTS.FILTER_CHANGED, {});
  emit(EVENTS.RENDER_LIB, {});
  toast(i18n('t_queue_filter_cleared') || 'Vue réinitialisée pour jouer ce titre', 'info');
  removeFromQueue(id);
  requestAnimationFrame(() => {
    const fi2 = filteredIdx(t);
    if (fi2 >= 0) playAt(fi2, { keepQueue: true });
  });
}

/**
 * Insère un titre en première position de la file ("Lire ensuite").
 * Si _queueOverride n'existe pas encore, le crée à partir de l'ordre filtré courant.
 * @param {string} trackId — id du titre à insérer
 * @returns {boolean} true si succès
 */
export function addToQueueNext(trackId) {
  const t = (_trackIdxMap.has(trackId) ? get('tracks')[_trackIdxMap.get(trackId)] : null);
  if (!t) return false;
  const explicit = _buildExplicitQueue().filter(u => u.id !== trackId);
  explicit.unshift(t);
  _queueOverride        = explicit.map(u => u.id);
  _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;
  _updateQueueBadge(_buildUpcoming().length);
  if (queueOpen) renderQueue();
  return true;
}

/**
 * Ajoute un titre en DERNIÈRE position de la file d'attente.
 * @param {string} trackId — id du titre à ajouter
 * @returns {boolean} true si succès
 */
export function addToQueueEnd(trackId) {
  const t = _trackIdxMap.has(trackId) ? get('tracks')[_trackIdxMap.get(trackId)] : null;
  if (!t) return false;
  // Construire la file si elle n'existe pas encore
  if (!_queueOverride) {
    _queueOverride        = [];
    _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;
  }
  // Ne pas dupliquer si déjà en queue
  if (!_queueOverride.includes(String(trackId))) _queueOverride.push(String(trackId));
  _updateQueueBadge(_buildUpcoming().length);
  if (queueOpen) renderQueue();
  return true;
}
