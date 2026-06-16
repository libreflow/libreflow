// playlist-crud.js — CRUD playlists + IDB + play helpers
// Extrait de playlists.js. Aucune dépendance vers playlist-nav.js ou playlists.js.
//
// NOTE: togglePinPlaylist, movePlToFolder, removePlFromFolder, movePlaylist,
//       addTrackToPlaylist, removeTrackFromPlaylist originally called renderPlNav() and
//       setupPlNavDrop() directly. Here those calls are replaced with
//       emit(EVENTS.PLAYLIST_CHANGED, { playlists }) so that playlists.js (or a future
//       playlist-nav.js) can subscribe and re-render the nav without a circular import.

import { moveByOne }                          from './utils.js';
import { i18n }                               from './i18n.js';
import { get, set, notify }                   from './store.js';
import { emit, EVENTS }                       from './bus.js';
import { DB }                                 from './db.js';
import { toast, toastWithAction, confirmAction } from './ui.js';
import { invalidateFilterCache, getFiltered } from './search.js';
import { invalidateGenreGridSig }             from './genres.js';
import { setView }                            from './views.js';
import { playAt, buildQ }                     from './player.js';
import { _allPlayerUI }                       from './allplayerui.js';

// ── Inline helper (mirrors playlists.js:invalidateFilter — ARCH-1) ─────────
function invalidateFilter() {
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
}

// ── Debounced savePlaylists for move-by-one hot paths (CLAUDE.md §2) ──────
let _savePLTimer = null;
function _savePLDebounced() {
  if (_savePLTimer) clearTimeout(_savePLTimer);
  _savePLTimer = setTimeout(() => savePlaylists().catch(e => console.warn('[playlist-crud] savePlaylists error', e)), 150);
}

// ── Play helpers (moved from app.js — ARCH-1) ─────────────────────────────

export function playPlaylistFrom(fi) {
  if (get('query')) {
    set('query', '');
    invalidateFilter();
    const el = document.getElementById('srch');
    if (el) el.value = '';
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
  }
  const fl = getFiltered();
  if (!fl.length) return;
  playAt(Math.min(fi, fl.length - 1));
}

export function playPlaylistDirect(plId, event) {
  if (event) event.stopPropagation();
  const navBtn = document.getElementById('ni-pl-' + plId);
  setView('playlist', navBtn, plId);
  requestAnimationFrame(() => playPlaylistFrom(0));
}

export async function shufflePlaylist() {
  const fl = getFiltered();
  if (!fl.length) return;
  const ri = Math.floor(Math.random() * fl.length);
  await playAt(ri);
  set('shuffle', true); // app.js subscribe keeps its local var in sync
  const _shufBtn = document.getElementById('pc-shuf');
  _shufBtn?.classList.add('on');
  _shufBtn?.setAttribute('aria-pressed', 'true');
  const _cinShufBtn = document.getElementById('cinema-shuf');
  _cinShufBtn?.classList.add('on');
  _cinShufBtn?.setAttribute('aria-pressed', 'true');
  buildQ();
  _allPlayerUI();
}

// ══ Persistance ══════════════════════════════════════════════════════════════

export async function savePlaylists() {
  const playlists = get('playlists');
  notify('playlists'); emit(EVENTS.PLAYLIST_CHANGED, { playlists }); // BUG-M4 FIX : mutation in-place → notify() (set() ignore same-ref)
  try {
    // Transaction atomique : clear + écriture en un seul commit
    // Évite la perte de données si l'app crashe entre clear() et les dput() individuels
    const transaction = DB.transaction('playlists', 'readwrite');
    const store = transaction.objectStore('playlists');
    store.clear();
    for (const pl of playlists) store.put(pl);
    await new Promise((ok, fail) => {
      transaction.oncomplete = ok;
      transaction.onerror   = () => fail(transaction.error);
    });
  } catch(e) { console.warn('[savePlaylists]', e); throw e; }
}

// ── Pinned ────────────────────────────────────────────────────
export async function togglePinPlaylist(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  const wasPinned = !!pl.pinned;
  pl.pinned = !pl.pinned;
  try { await savePlaylists(); }
  catch(e) {
    pl.pinned = wasPinned;
    console.warn('[togglePinPlaylist] IDB failed:', e);
    toast(i18n('error_save') || 'Erreur de sauvegarde', 'error');
    return;
  }
  toast(pl.pinned ? i18n('t_pl_pinned') : i18n('t_pl_unpinned'), 'success');
}

// ── Déplacer une playlist dans un dossier (clic droit → "Déplacer vers…") ──
export async function movePlToFolder(plId, folderId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  const folder = get('plFolders').find(f => f.id === folderId);
  if (!folder) return;
  const prevFolderId = pl.folderId;
  pl.folderId = folderId;
  try {
    await savePlaylists();
  } catch (e) {
    pl.folderId = prevFolderId;
    notify('playlists');
    console.warn('[playlist-crud] movePlToFolder: save failed, rolled back:', e);
    return;
  }
  toast(i18n('t_pl_moved_to_folder', folder.name) || `Déplacée dans « ${folder.name} »`, 'success');
}

// ── Sortir une playlist de son dossier (clic droit) ──────────
export async function removePlFromFolder(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl || !pl.folderId) return;
  const prevFolderId = pl.folderId;
  delete pl.folderId;
  try {
    await savePlaylists();
  } catch (e) {
    pl.folderId = prevFolderId;
    notify('playlists');
    console.warn('[playlist-crud] removePlFromFolder: save failed, rolled back:', e);
    return;
  }
  toast(i18n('t_pl_removed_from_folder') || 'Retirée du dossier', 'success');
}

/**
 * WCAG 2.2 SC 2.5.7 — alternative non-drag à la réorganisation des pistes d'une
 * playlist : déplace `trackId` d'un cran (dir -1 = haut, +1 = bas) dans la playlist
 * courante. No-op (false) hors vue playlist, sur une smart playlist, avec un filtre
 * actif, ou en butée. Persiste via savePlaylists (débouncé) puis re-render.
 * @param {string} trackId
 * @param {-1|1}   dir
 * @returns {boolean} true si l'ordre a changé
 */
export function movePlaylistTrack(trackId, dir) {
  const curPlId = get('curPlId');
  if (get('view') !== 'playlist' || !curPlId || get('query')) return false;
  const pl = get('playlists').find(p => p.id === curPlId);
  if (!pl || pl.smart || !Array.isArray(pl.trackIds)) return false;
  const idx = pl.trackIds.indexOf(trackId);
  if (moveByOne(pl.trackIds, idx, dir) < 0) return false;
  _savePLDebounced();
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {});
  return true;
}

/**
 * WCAG 2.2 SC 2.5.7 — alternative non-drag à la réorganisation des playlists dans
 * la sidebar : déplace la playlist `plId` d'un cran (dir -1 = haut, +1 = bas)
 * dans le tableau `playlists`. Persiste (savePlaylists, débouncé) puis re-render nav.
 * @param {string} plId
 * @param {-1|1}   dir
 * @returns {boolean} true si l'ordre a changé
 */
export function movePlaylist(plId, dir) {
  const playlists = get('playlists');
  const idx = playlists.findIndex(p => p.id === plId);
  if (moveByOne(playlists, idx, dir) < 0) return false;
  _savePLDebounced();
  return true;
}

export async function addTrackToPlaylist(trackId, plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  if (pl?.smart) {
    toast(i18n('t_smart_readonly') || 'Les playlists intelligentes ne peuvent pas être modifiées manuellement.', 'warning');
    return;
  }
  const sid = String(trackId);
  if (pl.trackIds.some(id => String(id) === sid)) { toast(i18n('t_already_in'), 'warning'); return; }
  pl.trackIds.push(sid);
  try { await savePlaylists(); }
  catch(e) {
    pl.trackIds.pop();
    console.warn('[addTrackToPlaylist] IDB failed:', e);
    toast(i18n('error_save') || 'Erreur de sauvegarde', 'error'); return;
  }
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
  toast(i18n('t_added_to', pl.name), 'success');
}

export async function deletePlaylist(e, plId) {
  e.stopPropagation();
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;

  if (pl.trackIds && pl.trackIds.length > 0) {
    // Playlist non vide → confirmation obligatoire (risque de perte de données)
    const confirmed = await confirmAction(
      i18n('pl_delete_confirm_h', pl.name) || `Supprimer « ${pl.name} » ?`,
      i18n('pl_delete_confirm_body', pl.trackIds.length) || `${pl.trackIds.length} titre${pl.trackIds.length > 1 ? 's' : ''} seront retirés de la playlist (les fichiers restent sur le disque).`,
      i18n('pl_delete_confirm_btn') || 'Supprimer', 'danger'
    );
    if (!confirmed) return;
    // Suppression définitive (playlist avec contenu)
    const prevPlaylists = [...get('playlists')];
    set('playlists', get('playlists').filter(p => p.id !== plId));
    try { await savePlaylists(); }
    catch(e) {
      set('playlists', prevPlaylists);
      console.warn('[deletePlaylist] IDB failed:', e);
      toast(i18n('error_save') || 'Erreur de sauvegarde', 'error'); return;
    }
    const curPlId = get('curPlId');
    if (curPlId === plId) { setView('all', document.getElementById('ni-all')); set('curPlId', null); }
    // Comme la branche "playlist vide" : notifier app.js pour re-render la nav,
    // sinon la playlist supprimée reste affichée dans la sidebar.
    emit(EVENTS.PLAYLIST_CHANGED, { playlists: get('playlists') });
    toast(i18n('t_pl_deleted'), 'success');
  } else {
    // Playlist vide → suppression immédiate avec undo 5s (pas de dialogue bloquant)
    const plSnapshot = { ...pl, trackIds: [...(pl.trackIds || [])] };
    set('playlists', get('playlists').filter(p => p.id !== plId));
    const curPlId = get('curPlId');
    if (curPlId === plId) { setView('all', document.getElementById('ni-all')); set('curPlId', null); }
    // renderPlNav() replaced with event — subscriber re-renders nav
    emit(EVENTS.PLAYLIST_CHANGED, { playlists: get('playlists') });

    let undone = false;
    const UNDO_MS = 5000;
    const saveTimer = setTimeout(() => {
      if (!undone) savePlaylists().catch(err => console.warn('[playlists:savePlaylists delete]', err));
    }, UNDO_MS);

    toastWithAction(i18n('t_pl_deleted'), 'success', i18n('t_undo') || 'Annuler', () => {
      undone = true;
      clearTimeout(saveTimer);
      get('playlists').push(plSnapshot);
      notify('playlists'); // BUG-M4 FIX : push() in-place → notify() (set() ignore same-ref)
      savePlaylists().catch(err => console.warn('[playlists:savePlaylists undo-delete]', err));
      toast(i18n('t_undo_done') || 'Annulé', 'info');
    }, UNDO_MS);
  }
}

export function removeTrackFromPlaylist(trackId, plId) {
  const pl = get('playlists').find(p=>p.id===plId);
  if (!pl || !pl.trackIds) return;
  if (pl?.smart) {
    toast(i18n('t_smart_readonly') || 'Les playlists intelligentes ne peuvent pas être modifiées manuellement.', 'warning');
    return;
  }
  // UNDO-PL FIX : mémoriser la position avant suppression pour permettre l'annulation
  const removedIdx = pl.trackIds.indexOf(trackId);
  if (removedIdx === -1) return; // trackId absent — rien à faire
  // B4 FIX : ancrer sur l'id des voisins, pas sur un index numérique — une 2e
  // suppression dans la même playlist décale pl.trackIds et rend removedIdx périmé.
  const _prevAnchorId = removedIdx > 0 ? pl.trackIds[removedIdx - 1] : null;
  const _nextAnchorId = removedIdx < pl.trackIds.length - 1 ? pl.trackIds[removedIdx + 1] : null;

  // Retrait immédiat en mémoire + mise à jour UI
  pl.trackIds = pl.trackIds.filter(id => id !== trackId);
  // renderPlNav() replaced with event — subscriber re-renders nav
  emit(EVENTS.PLAYLIST_CHANGED, { playlists: get('playlists') });
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});

  // Différer la persistance pour permettre l'annulation dans la fenêtre de 5 s
  const UNDO_MS = 5000;
  let undone = false;
  const saveTimer = setTimeout(() => {
    if (!undone) savePlaylists().catch(e => console.warn('[playlists:savePlaylists remove-track]', e));
  }, UNDO_MS);

  toastWithAction(i18n('t_removed'), 'success', i18n('t_undo') || 'Annuler', () => {
    undone = true;
    clearTimeout(saveTimer);
    // B4 FIX : ré-insérer après l'ancre précédente si elle existe encore, sinon
    // avant la suivante, sinon en tête — robuste face à une 2e suppression.
    if (!pl.trackIds.includes(trackId)) {
      const _prevPos = _prevAnchorId != null ? pl.trackIds.indexOf(_prevAnchorId) : -1;
      let _insertAt;
      if (_prevPos >= 0) {
        _insertAt = _prevPos + 1;
      } else {
        const _nextPos = _nextAnchorId != null ? pl.trackIds.indexOf(_nextAnchorId) : -1;
        _insertAt = _nextPos >= 0 ? _nextPos : 0;
      }
      pl.trackIds.splice(_insertAt, 0, trackId);
    }
    savePlaylists().catch(e => console.warn('[playlists:savePlaylists undo-remove-track]', e));
    if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
    toast(i18n('t_undo_done') || 'Annulé', 'info');
  }, UNDO_MS);
}
