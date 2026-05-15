// LibreFlow — selection.js
// Multi-sélection de pistes : mode sélection, opérations en lot.
// Extrait de app.js.
//
// Remaining window.* : toast, toastWithAction, savePlaylists, renderPlNav, renderLib,
//   updateStats, invalidateFilter, openNewPlaylistModal.
//
// Exports publics :
//   selection     (live Set — lu par renderTrackRow dans app.js)
//   selectionMode (live bool — lu via window.selectionMode getter dans app.js)
//   enterSelectionMode, clearSelection, updateSelBar
//   toggleTrackSelection
//   selAddToPlaylist, selAddBatch, selToggleLike, selRemove
//   selBatchTagEdit, closeBatchTagModal, confirmBatchTagEdit

import { esc, mainArtist }                              from './utils.js';
import { VIRT }                                         from './virt.js';
import { ddel }                                         from './db.js';
import { invoke, convertFileSrc }                       from './ipc.js';
import { i18n }                                         from './i18n.js';
import { get, subscribe }                               from './store.js';
import { emit, EVENTS }                                 from './bus.js';
import { getFiltered, _trackIdxMap, invalidateFilterCache } from './search.js';
import { audio, resetShuffleQ, clearCrossfadeTimers }   from './player.js';
import { saveTrackNow }                                 from './library.js';
import { toast, toastWithAction }                                        from './ui.js';
import { saveCfg }                        from './cfgsave.js';
import { setCurIdx, setTracks, setLiked, replaceTracks } from './state.js';
import { updateBar }                       from './playerbar.js';
import { updateStats } from './renderer.js';
import { savePlaylists, renderPlNav, openNewPlaylistModal } from './playlists.js';

// ── État interne ──────────────────────────────────────────────
export let selection     = new Set(); // trackIds sélectionnés
export let selectionMode = false;     // actif = affiche les checkboxes
let _selAnchorId         = null;      // anchor pour Shift+click
let _bteCoverPath        = null;      // chemin absolu de l'image choisie pour le batch cover

// ── Invalidation automatique de la sélection ─────────────────
// Quand tracks[] change (scan, suppression, import…), les IDs sélectionnés
// peuvent ne plus exister → vider la sélection pour éviter des opérations
// en lot sur des pistes fantômes.
subscribe('tracks', () => {
  if (selectionMode || selection.size > 0) clearSelection();
});

// ── Mode sélection ────────────────────────────────────────────

export function enterSelectionMode() {
  selectionMode = true;
  document.getElementById('sel-bar').classList.add('on');
  updateSelBar();
}

export function clearSelection() {
  selection.clear();
  selectionMode = false;
  _selAnchorId  = null;
  document.getElementById('sel-bar').classList.remove('on');
  // Retirer .selected uniquement sur les éléments visibles (pas besoin de renderLib complet)
  document.querySelectorAll('.tr.selected').forEach(el => el.classList.remove('selected'));
  // Invalider le cache filtre (selection peut affecter certaines vues) sans re-render coûteux
  VIRT._lastListSig = '';
}

export function updateSelBar() {
  const n = selection.size;
  document.getElementById('sel-count').textContent = `${n} titre${n!==1?'s':''} sélectionné${n!==1?'s':''}`;
}

export function toggleTrackSelection(trackId, e) {
  e.stopPropagation();
  const t = (_trackIdxMap.has(trackId)?get('tracks')[_trackIdxMap.get(trackId)]:undefined); // Phase 4
  if (!t) return;

  if (e.shiftKey && _selAnchorId) {
    // Sélection de plage : precalcul Map id→pos pour éviter 2×O(n) findIndex
    const fl = getFiltered();
    const posMap = new Map(fl.map((t, i) => [t.id, i]));
    const ai = posMap.get(_selAnchorId) ?? -1;
    const bi = posMap.get(trackId)      ?? -1;
    if (ai >= 0 && bi >= 0) {
      const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
      for (let i = lo; i <= hi; i++) selection.add(fl[i].id);
    }
  } else {
    if (selection.has(trackId)) selection.delete(trackId);
    else { selection.add(trackId); _selAnchorId = trackId; }
  }

  if (selection.size > 0 && !selectionMode) enterSelectionMode();
  else if (selection.size === 0) { clearSelection(); return; }
  updateSelBar();

  // Patch DOM sans re-render
  const el = document.getElementById('tr-' + trackId);
  if (el) el.classList.toggle('selected', selection.has(trackId));
}

// ── Opérations en lot ─────────────────────────────────────────

export function selAddToPlaylist() {
  if (!selection.size) return;
  const ids = [...selection];
  if (!get('playlists').length) {
    // Aucune playlist → proposer d'en créer une et ajouter les titres après
    const batchIds = ids.join(',');
    openNewPlaylistModal(null); // remet selBatch à ''
    document.getElementById('pl-modal-bg').dataset.selBatch = batchIds; // stocker après
    return;
  }
  // Afficher un mini-picker en dessous du sel-bar
  const bar = document.getElementById('sel-bar');
  // Créer un menu temporaire
  let picker = document.getElementById('sel-pl-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'sel-pl-picker';
    picker.style.cssText = `position:fixed;z-index:91;background:var(--bg2);border:1px solid rgba(255,255,255,.1);
      border-radius:var(--r2);padding:6px;display:flex;flex-direction:column;gap:2px;
      min-width:160px;box-shadow:var(--shadow-md);`;
    document.body.appendChild(picker);
  }
  picker.innerHTML = get('playlists').map(pl =>
    `<button class="sleep-opt" data-action="sel-add-batch" data-pl-id="${pl.id}">${esc(pl.name)} <span style="color:var(--t3);font-size:10px">${pl.trackIds.length}</span></button>`
  ).join('') +
  `<div style="height:1px;background:var(--bg4);margin:3px 0"></div>
   <button class="sleep-opt" data-action="sel-add-batch" data-pl-id="__new__">+ Nouvelle playlist</button>`;

  const barRect = bar.getBoundingClientRect();
  picker.style.left   = barRect.left + 'px';
  picker.style.bottom = (window.innerHeight - barRect.top + 8) + 'px';
  picker.style.display = 'flex';

  // Nettoyer l'ancien listener si le picker est ré-ouvert sans avoir été fermé
  if (picker._closePicker) { document.removeEventListener('click', picker._closePicker); picker._closePicker = null; }

  // Fermer en cliquant ailleurs — stocker la ref pour pouvoir la retirer si picker fermé autrement
  const _closePicker = (ev) => {
    if (!picker.contains(ev.target)) {
      picker.style.display = 'none';
      document.removeEventListener('click', _closePicker);
      picker._closePicker = null;
    }
  };
  picker._closePicker = _closePicker;
  setTimeout(() => document.addEventListener('click', _closePicker), 0);
}

export async function selAddBatch(plId) {
  const picker = document.getElementById('sel-pl-picker');
  if (picker) {
    picker.style.display = 'none';
    // BUG FIX : retirer le listener click si picker fermé via selAddBatch (évite fuite)
    if (picker._closePicker) { document.removeEventListener('click', picker._closePicker); picker._closePicker = null; }
  }
  const ids = [...selection].map(String); // normaliser en strings (B6)
  if (plId === '__new__') {
    const batchIds = ids.join(',');
    openNewPlaylistModal(null); // ouvre le modal (remet selBatch à '')
    // Stocker le batch APRÈS l'ouverture (sinon openNewPlaylistModal l'efface)
    document.getElementById('pl-modal-bg').dataset.selBatch = batchIds;
    return;
  }
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  let added = 0;
  const existingIds = new Set(pl.trackIds.map(String));
  for (const id of ids) {
    if (!existingIds.has(id)) { pl.trackIds.push(id); existingIds.add(id); added++; }
  }
  // Persister d'abord, puis vider la sélection (B9)
  await savePlaylists();
  renderPlNav();
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
  clearSelection(); // après persist (B9 fix)
  toast(i18n('t_sel_added_to_pl', added, pl.name), 'success');
}

export function selToggleLike() {
  if (!selection.size) return;
  const liked = get('liked'); // Phase 4
  let likedCount = 0;
  for (const id of selection) {
    // liked est Set<string> d'IDs — opération directe, pas besoin d'index
    if (liked.has(id)) liked.delete(id);
    else { liked.add(id); likedCount++; }
  }
  saveCfg();
  // clearSelection d'abord (reset VIRT._lastListSig), puis renderLib une seule fois
  clearSelection();
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  emit(EVENTS.RENDER_LIB, {});
  updateBar();
  toast(likedCount ? i18n('t_sel_liked', likedCount) : i18n('t_sel_unliked'), 'success');
}

export function selRemove() {
  if (!selection.size) return;
  const n   = selection.size;
  const ids = new Set(selection);
  const tracks = get('tracks'); // Phase 4
  const liked  = get('liked');

  // ── Snapshot pour undo ──────────────────────────────────────
  const oldTracks = [...tracks];
  const oldLiked  = new Set(liked);
  const deletedTs = [...ids].map(id =>
    _trackIdxMap.has(id) ? tracks[_trackIdxMap.get(id)] : null
  ).filter(Boolean);

  // Vérifier si la piste en cours de lecture est dans la sélection supprimée
  const playingDeleted = ids.has(tracks[get('curIdx')]?.id);
  // BUG-D2-8 FIX: clear lingering crossfade timers before batch delete when playing track is removed
  if (playingDeleted) clearCrossfadeTimers();
  // Rebuild tracks sans les pistes supprimées
  const newTracks = tracks.filter(t => !ids.has(t.id));
  // liked est Set<string> d'IDs — filtrer directement sans recalcul d'indices
  const newLiked  = new Set([...liked].filter(id => !ids.has(id)));
  // NE PAS révoquer les blob URLs maintenant — on attend la fin de la fenêtre undo
  replaceTracks(newTracks); // ARCH-3 : set + rebuildTrackIdxMap atomique
  setLiked(newLiked);
  // Piste en cours supprimée → stopper la lecture et invalider curIdx
  if (playingDeleted) { audio.pause(); audio.src = ''; setCurIdx(-1); }
  else if (get('curIdx') >= newTracks.length) setCurIdx(newTracks.length - 1); // BUG FIX : tracks.length était l'ancienne longueur (avant splice)
  // shuffleQ contient des indices vers l'ancien tracks[] → stale après mutation masse
  resetShuffleQ();

  // ── Différer la suppression IDB pour permettre l'annulation ─
  const UNDO_MS = 5000;
  let undone = false;
  const idbTimer = setTimeout(() => {
    if (undone) return;
    // Révoquer les blob URLs et supprimer de l'IDB
    for (const t of deletedTs) {
      if (t.url && t.url.startsWith('blob:')) try { URL.revokeObjectURL(t.url); } catch {}
      if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
    }
    for (const id of ids) ddel('tracks', id).catch(e => console.warn('[selection] IDB delete failed:', e));
  }, UNDO_MS);

  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); clearSelection(); emit(EVENTS.RENDER_LIB, {}); updateStats();

  toastWithAction(i18n('t_sel_deleted', n), 'success', i18n('te_cancel'), () => {
    undone = true;
    clearTimeout(idbTimer);
    // Restaurer l'état complet
    replaceTracks(oldTracks); // ARCH-3 : set + rebuildTrackIdxMap atomique (undo)
    setLiked(oldLiked);
    resetShuffleQ();
    invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();
    toast(i18n('t_sel_undo_delete'), 'info');
  }, UNDO_MS);
}

// ── Édition de tags en lot ─────────────────────────────────────

// ── Cover art helpers (batch modal) ──────────────────────────
export async function bteCoverClick() {
  try {
    const path = await invoke('pick_image', undefined, { timeout: 0 });
    if (!path) return;
    _bteCoverPath = path;
    const img   = document.getElementById('bte-cover-img');
    const label = document.getElementById('bte-cover-label');
    const clear = document.getElementById('bte-cover-clear');
    if (img)   { img.src = convertFileSrc(path); img.style.display = 'block'; }
    if (label) label.style.display = 'none';
    if (clear) clear.style.display = 'flex';
  } catch (e) {
    console.warn('[bteCoverClick]', e);
  }
}

export function bteCoverClear() {
  _bteCoverPath = null;
  const img   = document.getElementById('bte-cover-img');
  const label = document.getElementById('bte-cover-label');
  const clear = document.getElementById('bte-cover-clear');
  if (img)   { img.src = ''; img.style.display = 'none'; }
  if (label) label.style.display = '';
  if (clear) clear.style.display = 'none';
}

// Appelé depuis le file input HTML (fallback, normalement pas utilisé)
export function bteCoverSelected(input) {
  // Le <input type="file"> ne donne pas de chemin absolu dans Tauri → on ignore
  // et on utilise exclusivement pick_image via bteCoverClick
  input.value = '';
}

export function selBatchTagEdit() {
  if (!selection.size) return;
  const ids = [...selection];
  const selectedTracks = ids
    .map(id => _trackIdxMap.has(id) ? get('tracks')[_trackIdxMap.get(id)] : null) // Phase 4
    .filter(Boolean);
  if (!selectedTracks.length) return;

  // Détecter les valeurs communes (null = valeurs mixtes)
  function commonVal(field) {
    const vals = new Set(selectedTracks.map(t => String(t[field] ?? '')));
    return vals.size === 1 ? [...vals][0] : null;
  }
  const MIXED = '—'; // placeholder affiché si valeurs mixtes

  const modal    = document.getElementById('batch-tag-modal-bg');
  const yearEl   = document.getElementById('bte-year');
  const artistEl = document.getElementById('bte-artist');
  const albumEl  = document.getElementById('bte-album');
  const genreEl  = document.getElementById('bte-genre');
  const countEl  = document.getElementById('bte-count');
  const n = ids.length;

  countEl.textContent = `${n} titre${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;

  function applyCommon(el, field) {
    const v = commonVal(field);
    el.value       = v != null ? (v === '0' || v === 'null' ? '' : v) : '';
    el.placeholder = v == null ? MIXED : '';
  }
  applyCommon(yearEl,   'year');
  applyCommon(artistEl, 'artist');
  applyCommon(albumEl,  'album');
  applyCommon(genreEl,  'genre');

  // Reset cover preview
  bteCoverClear();

  // Si tous les tracks ont la même cover, l'afficher en preview
  const commonArt = commonVal('art');
  if (commonArt && commonArt !== '' && commonArt !== 'null') {
    const img   = document.getElementById('bte-cover-img');
    const label = document.getElementById('bte-cover-label');
    if (img)   { img.src = commonArt; img.style.display = 'block'; }
    if (label) label.style.display = 'none';
    // Pas de _bteCoverPath → la cover ne sera pas réécrite sauf si l'utilisateur en choisit une nouvelle
  }

  const btn = document.getElementById('bte-confirm-btn');
  if (btn) btn.disabled = false;

  modal.classList.add('on'); // FIX : .on déclenche fade-in (visibility+opacity, pas display)
  // Focus sur l'artiste (plus logique que l'année)
  artistEl.focus();
  artistEl.select();
}

export function closeBatchTagModal() {
  document.getElementById('batch-tag-modal-bg').classList.remove('on');
  bteCoverClear(); // reset cover state
}

export async function confirmBatchTagEdit() {
  const yearRaw  = document.getElementById('bte-year').value.trim();
  const artistRaw = document.getElementById('bte-artist').value.trim();
  const albumRaw  = document.getElementById('bte-album').value.trim();
  const genreRaw  = document.getElementById('bte-genre').value.trim();

  const yearVal = (() => {
    const v = parseInt(yearRaw, 10);
    // BUG-8 FIX : aligner sur 1900–2099 (cohérence avec tagedit.js)
    return (Number.isInteger(v) && v >= 1900 && v <= 2099) ? v : null;
  })();

  const hasYear   = yearRaw !== '';
  const hasArtist = artistRaw !== '';
  const hasAlbum  = albumRaw  !== '';
  const hasGenre  = genreRaw  !== '';
  const hasCover  = !!_bteCoverPath;
  // Capturer le chemin AVANT closeBatchTagModal() qui appelle bteCoverClear() → _bteCoverPath = null
  const coverPath = _bteCoverPath;

  // Rien de renseigné → fermer sans rien faire
  if (!hasYear && !hasArtist && !hasAlbum && !hasGenre && !hasCover) {
    closeBatchTagModal();
    return;
  }

  const btn = document.getElementById('bte-confirm-btn');
  if (btn) btn.disabled = true;

  const ids = [...selection];
  closeBatchTagModal();

  let saved = 0, failed = 0;
  const total = ids.length;
  const dismissSpinner = toast(i18n('t_batch_tag_saving'), 'loading');

  for (const id of ids) {
    const t = _trackIdxMap.has(id) ? get('tracks')[_trackIdxMap.get(id)] : null; // Phase 4
    if (!t) continue;

    // Appliquer uniquement les champs renseignés
    // BUG-D2-9 FIX: only write year when yearVal is a valid parsed integer (not null).
    // yearVal is null when the user types an invalid/out-of-range value — writing null would
    // silently destroy existing year metadata on every selected track.
    if (hasYear && yearVal !== null) t.year = yearVal;
    if (hasArtist) {
      t.artistFull = artistRaw;
      t.artist     = mainArtist(artistRaw) || artistRaw;
    }
    if (hasAlbum)  t.album  = albumRaw;
    if (hasGenre)  t.genre  = genreRaw;
    // Invalider les clés de cache fuzzy (comme tagedit.js)
    if (hasArtist || hasAlbum || hasGenre) {
      delete t._albumKey; delete t._artistKey;
      delete t._nlc; delete t._trigrams; delete t._alc; delete t._ablc; delete t._glc; delete t._genreParts;
    }

    try {
      // Écrire les tags textuels si au moins un champ modifié
      if (hasYear || hasArtist || hasAlbum || hasGenre) {
        await Promise.race([
          invoke('write_tags', { data: {
            path:         t.path,
            title:        t.name    ?? '',
            artist:       t.artistFull ?? t.artist ?? '',
            album:        t.album   ?? '',
            genre:        t.genre   ?? '',
            year:         t.year    ?? null,
            track_number: t.track   ?? null,
          }}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('IPC timeout')), 15000)),
        ]);
      }
      // Écrire la pochette si une image a été sélectionnée
      if (hasCover) {
        await Promise.race([
          invoke('write_cover', { data: {
            audio_path: t.path,
            image_path: coverPath,
          }}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('cover timeout')), 20000)),
        ]);
        // Mettre à jour l'art en mémoire (blob URL via convertFileSrc)
        if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
        t.art = convertFileSrc(coverPath);
        t.noArt = false;
        t.artColor = null; // sera recalculé au prochain affichage
      }
      await saveTrackNow(t);
      saved++;
    } catch (e) {
      console.warn('[batch-tag] failed for:', t.path, e);
      failed++;
    }
    // Mise à jour du compteur de progrès dans le toast
    dismissSpinner.update?.(`${i18n('t_batch_tag_saving')} ${saved + failed}/${total}`);
  }

  if (typeof dismissSpinner === 'function') dismissSpinner();

  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  VIRT._lastListSig = '';
  emit(EVENTS.RENDER_LIB, {});
  updateBar();

  if (saved > 0) {
    const msg = failed > 0
      ? i18n('t_batch_tag_done_err', saved, failed)
      : i18n('t_batch_tag_done', saved);
    toast(msg, failed === 0 ? 'success' : 'warning');
  } else {
    toast(i18n('t_batch_tag_none'), 'warning');
  }
}
