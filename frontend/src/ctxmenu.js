// LibreFlow — ctxmenu.js
// Menu contextuel (clic droit sur une piste).
// Extrait de app.js.
//
// Remaining window.* : toast, confirmAction, savePlaylists, invalidateFilter, renderLib,
//   updateStats, openTagEditor, openNewPlaylistModal, openSmartPlaylistModal,
//   addTrackToPlaylist, removeTrackFromPlaylist, drillDown, addToQueueNext, addToQueueEnd.
//
// Exports publics :
//   showCtxMenu, closeCtxMenu,
//   ctxToggleLike, ctxDeleteTrack, ctxEditTags,
//   ctxGoToArtist, ctxGoToAlbum,
//   ctxNewPlaylist, ctxRemoveFromPlaylist, ctxSmartPlaylist,
//   ctxPlayNext, ctxAddToQueueEnd, ctxCopyInfo

import { esc, trackCopyText }                           from './utils.js';
import { ddel }                                         from './db.js';
import { i18n }                                         from './i18n.js';
import { get }                                          from './store.js';
import { emit, EVENTS }                                 from './bus.js';
import { trackIdx, _trackIdxMap, invalidateFilterCache } from './search.js';
import { addToQueueNext, addToQueueEnd }                        from './queue.js';
import { audio }                                        from './player.js';
import { toast, confirmAction, toastWithAction }                        from './ui.js';
import { saveCfg }                  from './cfgsave.js';
import { setCurIdx, setCtxTrackId, removeTrackAt, replaceTracks } from './state.js';
import { adjustShuffleQAfterDelete, resetShuffleQ } from './player.js';
import { updateStats, drillDown } from './renderer.js';
import { openNewPlaylistModal, removeTrackFromPlaylist, savePlaylists, movePlaylistTrack } from './playlists.js';
import { openSmartPlaylistModal } from './smartplaylist.js';
import { openTagEditor } from './tagedit.js';
import { invoke }        from './ipc.js';

// ── Context menu (right-click on track) ──────────────────────

// A11Y-01: module-level state for focus management + keyboard navigation
let _ctxTrigger    = null; // élément qui a ouvert le menu (restauré au close)
let _ctxKeyHandler = null; // handler clavier actif sur #ctx-menu

/** Navigation clavier dans le menu contextuel (flèches haut/bas + Enter/Space). */
function _setupCtxKeyNav(menu) {
  if (_ctxKeyHandler) menu.removeEventListener('keydown', _ctxKeyHandler);
  _ctxKeyHandler = (e) => {
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(el => el.style.display !== 'none');
      const idx   = items.indexOf(document.activeElement);
      const next  = e.code === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next?.focus();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      const cur = document.activeElement;
      if (cur && cur.closest('#ctx-menu') && cur.getAttribute('role') === 'menuitem') {
        e.preventDefault();
        cur.click();
      }
    }
  };
  menu.addEventListener('keydown', _ctxKeyHandler);
}

export function showCtxMenu(e, trackId) {
  e.preventDefault(); e.stopPropagation();
  setCtxTrackId(trackId);
  const t = (_trackIdxMap.has(trackId) ? get('tracks')[_trackIdxMap.get(trackId)] : undefined);
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  // A11Y-01: stocker l'élément déclencheur pour restaurer le focus à la fermeture
  _ctxTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // Titre de la piste en en-tête
  const nameEl = document.getElementById('ctx-track-name');
  if (nameEl) nameEl.textContent = t ? t.name : '–';

  // Like / Unlike
  const isLiked = !!t && get('liked').has(t.id);
  const likeIcon = document.getElementById('ctx-like-icon');
  const likeLbl  = document.getElementById('ctx-like-lbl');
  if (likeIcon) likeIcon.style.fill = isLiked ? 'currentColor' : 'none';
  if (likeLbl)  likeLbl.textContent  = isLiked
    ? (i18n('ctx_unlike') || 'Retirer des favoris')
    : (i18n('ctx_like')   || 'Liker');

  // Aller à l'artiste (toujours visible si artiste connu)
  const artistEl = document.getElementById('ctx-go-artist');
  const artistLbl = document.getElementById('ctx-artist-lbl');
  const unknownArtist = i18n('unknown_artist') || 'Artiste inconnu';
  const hasArtist = t && t.artist && t.artist !== unknownArtist && t.artist !== 'Unknown Artist';
  if (artistEl) artistEl.style.display = hasArtist ? '' : 'none';
  if (artistLbl && t) artistLbl.textContent = i18n('ctx_go_artist', t.artist) || `Voir ${t.artist}`;

  // Aller à l'album (visible si album renseigné)
  const albumEl  = document.getElementById('ctx-go-album');
  const albumLbl = document.getElementById('ctx-album-lbl');
  const hasAlbum = t && t.album;
  if (albumEl) albumEl.style.display = hasAlbum ? '' : 'none';
  if (albumLbl && t) albumLbl.textContent = i18n('ctx_go_album', t.album) || `Voir « ${t.album} »`;

  // Fill playlist items
  // BUG-9 FIX : exclure les smart playlists — ajouter manuellement une piste à une
  // smart playlist bypasse ses critères et crée un état incohérent (la piste disparaît
  // à la prochaine régénération automatique).
  const plItems = document.getElementById('ctx-pl-items');
  if (plItems) {
    // A11Y-01: items dynamiques — role="menuitem" tabindex="-1" requis pour la navigation clavier
    plItems.innerHTML = get('playlists').filter(pl => !pl.smart).map(pl => `
      <div class="ctx-item" role="menuitem" tabindex="-1" data-action="add-track-to-pl" data-track-id="${esc(trackId)}" data-pl-id="${esc(pl.id)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg>
        ${esc(pl.name)}
      </div>`).join('');
  }

  // Show "remove" option only when inside a playlist
  const inPl = get('view') === 'playlist' && get('curPlId');
  const sepRemove = document.getElementById('ctx-sep-remove');
  const removeBtn = document.getElementById('ctx-remove-from-pl');
  if (sepRemove) sepRemove.style.display = inPl ? '' : 'none';
  if (removeBtn) removeBtn.style.display = inPl ? '' : 'none';

  // WCAG 2.2 SC 2.5.7 : alternative non-drag à la réorganisation — visible
  // uniquement dans une playlist manuelle (non-smart) affichée sans filtre.
  const plCur = inPl ? get('playlists').find(p => p.id === get('curPlId')) : null;
  const canReorder = !!(inPl && plCur && !plCur.smart && !get('query'));
  for (const mid of ['ctx-sep-move', 'ctx-move-up', 'ctx-move-down']) {
    const el = document.getElementById(mid);
    if (el) el.style.display = canReorder ? '' : 'none';
  }

  // F-7 — Écrire les tags RG : visible seulement si RG analysé et fichier local
  const rgBtn = document.getElementById('ctx-write-rg');
  if (rgBtn) rgBtn.style.display = (t && t.rgGain !== undefined && t.path) ? '' : 'none';

  // Plugin opener — visible seulement si la piste a un fichier local
  const revealBtn = document.getElementById('ctx-reveal-file');
  if (revealBtn) revealBtn.style.display = (t && t.path) ? '' : 'none';

  // Plugin clipboard-manager — copier le chemin : même condition que reveal
  const copyPathBtn = document.getElementById('ctx-copy-path');
  if (copyPathBtn) copyPathBtn.style.display = (t && t.path) ? '' : 'none';

  // Position — calculée avant d'ouvrir pour éviter le flash
  // Le menu est déjà rendu (display block) mais invisible (opacity 0)
  // offsetWidth/Height sont donc valides sans toggler display
  const mw = menu.offsetWidth  || 190;
  const mh = menu.offsetHeight || 200;
  const flipX = e.clientX + mw + 10 > window.innerWidth;
  const flipY = e.clientY + mh + 10 > window.innerHeight;
  const mx = flipX ? e.clientX - mw : e.clientX;
  const my = flipY ? e.clientY - mh : e.clientY;
  menu.style.left = `${Math.max(6, mx)}px`;
  menu.style.top  = `${Math.max(6, my)}px`;
  // Adapter l'origine de l'animation au coin le plus proche du curseur
  menu.style.transformOrigin = `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`;
  menu.classList.add('on');

  // A11Y-01: navigation clavier + focus sur le premier item visible
  _setupCtxKeyNav(menu);
  setTimeout(() => {
    const first = [...menu.querySelectorAll('[role="menuitem"]')].find(el => el.style.display !== 'none');
    first?.focus();
  }, 30);
}

export function closeCtxMenu() {
  const menu = document.getElementById('ctx-menu');
  menu?.classList.remove('on');
  setCtxTrackId(null);
  // A11Y-01: nettoyer le handler clavier et restaurer le focus à l'élément déclencheur
  if (_ctxKeyHandler && menu) {
    menu.removeEventListener('keydown', _ctxKeyHandler);
    _ctxKeyHandler = null;
  }
  if (_ctxTrigger) {
    _ctxTrigger.focus();
    _ctxTrigger = null;
  }
}

// BUG-AUDIT HIGH : listeners document encapsulés dans initCtxMenu() avec AbortController
// (cf. pattern handlers.js registerHandlers). Évite le cumul lors d'un HMR/test et permet
// le nettoyage via le cleanup retourné. Appelé une seule fois au boot depuis main.js.
let _ctxMenuInit = false; // garde anti-double-appel

/**
 * Attache les listeners globaux du menu contextuel (clic extérieur + Escape).
 * Idempotent — à appeler UNE SEULE FOIS au boot (main.js).
 * @returns {Function} cleanup — retire les listeners (utile pour les tests)
 */
export function initCtxMenu() {
  if (_ctxMenuInit) { console.warn('[ctxmenu] initCtxMenu() called more than once'); return () => {}; }
  _ctxMenuInit = true;
  const ac = new AbortController();
  const { signal } = ac;
  document.addEventListener('click', e => {
    const menu = document.getElementById('ctx-menu');
    if (menu && !menu.contains(e.target)) closeCtxMenu();
  }, { signal });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && document.getElementById('ctx-menu')?.classList.contains('on')) {
      e.stopImmediatePropagation(); closeCtxMenu();
    }
  }, { signal });
  return () => ac.abort();
}

// ── Actions ───────────────────────────────────────────────────

export function ctxMoveTrackUp()        { movePlaylistTrack(get('ctxTrackId'), -1); closeCtxMenu(); }
export function ctxMoveTrackDown()      { movePlaylistTrack(get('ctxTrackId'),  1); closeCtxMenu(); }
export function ctxNewPlaylist()        { openNewPlaylistModal(get('ctxTrackId')); closeCtxMenu(); }
export function ctxRemoveFromPlaylist() { if (get('ctxTrackId') && get('curPlId')) removeTrackFromPlaylist(get('ctxTrackId'), get('curPlId')); closeCtxMenu(); }
export function ctxSmartPlaylist()      { closeCtxMenu(); openSmartPlaylistModal(get('ctxTrackId')); }

export function ctxPlayNext() {
  const id = get('ctxTrackId');
  closeCtxMenu();
  if (!id) return;
  const ok = addToQueueNext(id);
  if (ok) toast(i18n('t_queue_play_next'), 'success');
}

export function ctxAddToQueueEnd() {
  const id = get('ctxTrackId');
  closeCtxMenu();
  if (!id) return;
  const ok = addToQueueEnd(id);
  if (ok) toast(i18n('t_queue_added_end'), 'success');
}

export function ctxCopyInfo() {
  const t = _trackIdxMap.has(get('ctxTrackId'))
    ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : null;
  closeCtxMenu();
  if (!t) return;
  _copyToClipboard(trackCopyText(t, i18n('unknown_artist') || 'Artiste inconnu'));
}

/** Copie le chemin du fichier de la piste (plugin clipboard-manager). */
export function ctxCopyPath() {
  const t = _trackIdxMap.has(get('ctxTrackId'))
    ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : null;
  closeCtxMenu();
  if (!t?.path) return;
  _copyToClipboard(t.path);
}

/** Écrit dans le presse-papier OS via le plugin (fiable hors focus webview) ;
 *  fallback navigator.clipboard pour le dev hors Tauri. */
async function _copyToClipboard(text) {
  if (!text) return;
  try {
    await invoke('plugin:clipboard-manager|write_text', { text });
    toast(i18n('t_ctx_copied'), 'success');
  } catch (e) {
    try {
      await navigator.clipboard.writeText(text);
      toast(i18n('t_ctx_copied'), 'success');
    } catch (e2) {
      console.warn('[ctxmenu] clipboard write failed:', e, e2);
      toast(i18n('t_copy_err') || 'Copie impossible', 'error');
    }
  }
}

export function ctxEditTags() {
  const id = get('ctxTrackId');
  closeCtxMenu();
  // Scroller jusqu'à la piste si elle est hors vue, puis ouvrir l'éditeur
  const el = document.getElementById('tr-' + id);
  if (el) {
    el.scrollIntoView({ block: 'nearest' });
    openTagEditor(id);
  } else {
    // Hors de la fenêtre virtuelle — renderLib puis ré-essayer
    invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {});
    requestAnimationFrame(() => openTagEditor(id));
  }
}

export function ctxToggleLike() {
  const t = (_trackIdxMap.has(get('ctxTrackId')) ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : undefined);
  if (!t) { closeCtxMenu(); return; }
  const liked = get('liked'); // Phase 4
  liked.has(t.id) ? liked.delete(t.id) : liked.add(t.id);
  const isNowLiked = liked.has(t.id);
  // Sync tous les boutons like visibles dans le DOM
  const btns = [
    document.getElementById('pl-lk'),
    document.getElementById('cinema-lk'),
    document.getElementById('tr-' + t.id)?.querySelector('.tlk'),
  ].filter(Boolean);
  btns.forEach(b => b.classList.toggle('on', isNowLiked));
  // Invalider le filtre (vue Favoris doit se recalculer)
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  if (get('view') === 'liked') emit(EVENTS.RENDER_LIB, {});
  saveCfg();
  closeCtxMenu();
  toast(isNowLiked
    ? (i18n('ctx_liked_toast')   || '♥ Liké')
    : (i18n('ctx_unliked_toast') || '♡ Retiré des favoris'), 'success');
}

export function ctxGoToArtist() {
  const t = (_trackIdxMap.has(get('ctxTrackId')) ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : undefined);
  closeCtxMenu();
  const unknownArtist = i18n('unknown_artist') || 'Artiste inconnu';
  if (!t || !t.artist || t.artist === unknownArtist || t.artist === 'Unknown Artist') return;
  const rawKey      = t.artist.toLowerCase(); // BUG-C1 FIX : clé exacte — search.js fait un match exact, pas fuzzy
  const displayName = t.artistFull || t.artist; // nom propre pour le titre de vue + breadcrumb
  drillDown('artists', rawKey, displayName);
}

export function ctxGoToAlbum() {
  const t = (_trackIdxMap.has(get('ctxTrackId')) ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : undefined);
  closeCtxMenu();
  if (!t || !t.album) return;
  const rawKey = t.album.toLowerCase(); // BUG-C1 FIX : clé exacte — search.js fait un match exact, pas fuzzy
  drillDown('albums', rawKey, t.album); // t.album = nom d'affichage correct
}

export async function ctxDeleteTrack() {
  const t = (_trackIdxMap.has(get('ctxTrackId')) ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : undefined);
  closeCtxMenu();
  if (!t) return;
  // P4-5 : body enrichi avec pochette + artiste pour les actions destructives
  const _unknownArtist = i18n('unknown_artist') || 'Artiste inconnu';
  const _artist = t.artistFull || t.artist || '';
  const _frag = document.createDocumentFragment();
  const _preview = document.createElement('div');
  Object.assign(_preview.style, { display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', background:'var(--bg3)', borderRadius:'8px', marginBottom:'10px' });
  if (t.art) {
    const _img = document.createElement('img');
    _img.src = t.art; _img.alt = '';
    Object.assign(_img.style, { width:'40px', height:'40px', borderRadius:'6px', objectFit:'cover', flexShrink:'0', verticalAlign:'middle' });
    _preview.appendChild(_img);
  } else {
    const _ic = document.createElement('span');
    Object.assign(_ic.style, { width:'40px', height:'40px', borderRadius:'6px', background:'var(--bg4)', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:'0', fontSize:'18px' });
    _ic.textContent = '🎵';
    _preview.appendChild(_ic);
  }
  const _meta = document.createElement('div');
  _meta.style.minWidth = '0';
  const _nameEl = document.createElement('div');
  Object.assign(_nameEl.style, { fontWeight:'600', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' });
  _nameEl.textContent = t.name;
  _meta.appendChild(_nameEl);
  if (_artist && _artist !== _unknownArtist) {
    const _artEl = document.createElement('div');
    Object.assign(_artEl.style, { fontSize:'.82em', opacity:'.7', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' });
    _artEl.textContent = _artist;
    _meta.appendChild(_artEl);
  }
  _preview.appendChild(_meta);
  _frag.appendChild(_preview);
  const _bodyText = document.createElement('span');
  _bodyText.textContent = i18n('ctx_delete_body') || 'Le titre sera retiré de la bibliothèque. Le fichier sur le disque ne sera pas supprimé.';
  _frag.appendChild(_bodyText);
  // Capturer AVANT l'await : la piste peut être supprimée par un autre flux pendant la modale (TOCTOU)
  const ti = trackIdx(t.id);
  const oldTracks  = [...get('tracks')];
  const wasLiked   = get('liked').has(t.id);
  const oldCurIdx  = get('curIdx');
  const affectedPlSnapshots = [];
  get('playlists').forEach(pl => {
    if (pl.trackIds?.includes(t.id)) affectedPlSnapshots.push({ pl, ids: [...pl.trackIds] });
  });
  const playlistsChanged = affectedPlSnapshots.length > 0;
  const ok = await confirmAction(
    i18n('ctx_delete_h', t.name) || `Supprimer « ${t.name} » ?`,
    _frag,
    i18n('ctx_delete_btn') || 'Supprimer'
  );
  if (!ok) return;
  // Valider que la piste n'a pas disparu pendant la modale
  if (ti < 0 || get('tracks')[ti]?.id !== t.id) return;

  // ── Suppression immédiate (UI) ──────────────────────────────────────────────
  // liked est maintenant Set<string> d'IDs — pas de décalage d'indices nécessaire
  get('liked').delete(t.id);
  // NE PAS révoquer les blob URLs maintenant — différé après la fenêtre undo (MEM-1/MEM-2)
  // ⚠ adjustShuffleQAfterDelete et setCurIdx AVANT removeTrackAt — utilisent l'index original
  adjustShuffleQAfterDelete(ti);
  if (get('curIdx') === ti) { audio.pause(); setCurIdx(-1); emit(EVENTS.TRACK_CHANGE, { track: null, idx: -1 }); }
  else if (get('curIdx') > ti) setCurIdx(get('curIdx') - 1);
  removeTrackAt(ti); // ARCH-3 : splice + rebuildTrackIdxMap + notify (rebuild avant notify ✓)
  // Retirer le titre de toutes les playlists qui le référencent
  get('playlists').forEach(pl => {
    if (!pl.trackIds) return;
    pl.trackIds = pl.trackIds.filter(id => id !== t.id);
  });
  saveCfg(); // persiste curIdx + liked immédiatement
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();

  // ── Différer la suppression IDB pour permettre l'annulation ────────────────
  const UNDO_MS = 5000;
  let undone = false;
  const idbTimer = setTimeout(async () => {
    if (undone) return;
    // Révoquer les blob URLs maintenant que la fenêtre undo est expirée (MEM-1/MEM-2)
    if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
    if (t.url && t.url.startsWith('blob:')) try { URL.revokeObjectURL(t.url); } catch {}
    await ddel('tracks', t.id);
    if (playlistsChanged) savePlaylists();
  }, UNDO_MS);

  toastWithAction(
    i18n('ctx_deleted_toast', t.name) || `🗑 « ${t.name} » supprimé`,
    'info',
    i18n('te_cancel') || 'Annuler',
    () => {
      undone = true;
      clearTimeout(idbTimer);
      // Restaurer l'état complet
      replaceTracks(oldTracks); // ARCH-3 : set + rebuildTrackIdxMap atomique (undo)
      if (wasLiked) get('liked').add(t.id);
      if (oldCurIdx >= 0 && oldCurIdx < oldTracks.length) setCurIdx(oldCurIdx);
      // Restaurer les playlists dans leur état original (ordre préservé)
      for (const { pl, ids } of affectedPlSnapshots) pl.trackIds = ids;
      resetShuffleQ();
      invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();
      saveCfg();
      if (playlistsChanged) savePlaylists();
      toast(i18n('t_sel_undo_delete') || 'Suppression annulée', 'info');
    },
    UNDO_MS
  );
}

/** Révèle le fichier de la piste dans l'Explorateur (plugin opener, reveal only). */
export async function ctxRevealFile() {
  const t = (_trackIdxMap.has(get('ctxTrackId')) ? get('tracks')[_trackIdxMap.get(get('ctxTrackId'))] : undefined);
  closeCtxMenu();
  if (!t?.path) return;
  try {
    await invoke('plugin:opener|reveal_item_in_dir', { path: t.path });
  } catch (e) {
    console.warn('[ctxRevealFile]', e);
    toast(i18n('t_reveal_err') || 'Impossible d\'ouvrir l\'emplacement du fichier', 'error');
  }
}

// ── F-7 — Écriture ReplayGain dans les tags fichier ──────────────────────────
/** Écrit REPLAYGAIN_TRACK_GAIN + REPLAYGAIN_TRACK_PEAK dans le fichier audio.
 *  Requiert que t.rgGainDB et t.rgPeak soient définis (post-analyse RG).
 *  Si rgGainDB manque (ancienne analyse), on recalcule depuis t.rgGain linéaire. */
export async function ctxWriteRG() {
  const ctxId = get('ctxTrackId');
  const t = (_trackIdxMap.has(ctxId) ? get('tracks')[_trackIdxMap.get(ctxId)] : undefined);
  closeCtxMenu();
  if (!t || t.rgGain === undefined || !t.path) return;

  // Fallback : si rgGainDB absent (ancien cache), dériver depuis la valeur linéaire.
  // B14 FIX : Math.log10(rgGain ≤ 0) donne -Infinity / NaN — un rgGain de 0
  // (analyse RG ratée, piste silencieuse) ou négatif corromprait le tag écrit.
  const gainDB = typeof t.rgGainDB === 'number'
    ? t.rgGainDB
    : (t.rgGain > 0 ? 20 * Math.log10(t.rgGain) : 0);
  const peak = typeof t.rgPeak === 'number' ? t.rgPeak : 1.0;
  if (!Number.isFinite(gainDB)) {
    toast(i18n('t_rg_write_err') || 'Valeur ReplayGain invalide', 'error');
    return;
  }

  const dismiss = toast(i18n('t_rg_writing') || 'Écriture des tags RG…', 'loading');
  try {
    await invoke('write_replaygain_tags', { data: { path: t.path, gain_db: gainDB, peak } }, { timeout: 15000 });
    dismiss?.();
    toast(i18n('t_rg_written', t.name) || `Tags RG écrits : « ${t.name} »`, 'success');
  } catch (e) {
    dismiss?.();
    console.warn('[ctxWriteRG]', e);
    toast(i18n('t_rg_write_err') || 'Erreur écriture RG', 'error');
  }
}
