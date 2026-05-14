// LibreFlow — orphans.js
// Détection et résolution des fichiers manquants dans la bibliothèque.
//
// Workflow :
//   1. checkOrphans()    — appelé au boot (~6s), vérifie tous les chemins
//   2. toastWithAction   — alerte "N fichiers manquants → Gérer"
//   3. _openOrphanDialog — modal interactif avec bouton "Relocaliser" par piste (P2-6)
//   4. _relocateOrphan   — file picker → update path/url dans tracks[] + IDB
//   5. _deleteOrphans    — splice tracks[], ddel IDB, rebuildTrackIdxMap, emit events

import { ddel }                                                    from './db.js';
import { get, notify }                                            from './store.js';
import { invoke, convertFileSrc }                                 from './ipc.js';
import { emit, EVENTS }                                           from './bus.js';
import { trackIdx, rebuildTrackIdxMap, invalidateFilterCache }    from './search.js';
import { VIRT }                                                   from './virt.js';
import { audio, adjustShuffleQAfterDelete }                       from './player.js';
import { toast, toastWithAction, esc }                            from './ui.js';
import { setCurIdx }                                              from './state.js';
import { updateStats }                                            from './renderer.js';
import { saveTrackNow }                                           from './library.js';
import { CFG }                                                    from './cfg.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _missingPaths = new Set();

// ── API publique ──────────────────────────────────────────────────────────────

export async function checkOrphans() {
  const tracks = get('tracks');
  if (!tracks.length) return;

  const paths = tracks.filter(t => t.path).map(t => t.path);
  if (!paths.length) return;

  let missing;
  try {
    missing = await Promise.race([
      invoke('check_paths', { paths }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('check_paths timeout')), CFG.ORPHAN_CHECK_TIMEOUT_MS)),
    ]);
  } catch(e) {
    console.warn('[checkOrphans] check_paths failed:', e);
    return;
  }

  if (!missing?.length) return;

  _missingPaths = new Set(missing);
  const orphanTracks = tracks.filter(t => t.path && _missingPaths.has(t.path));
  if (!orphanTracks.length) return;

  const n = orphanTracks.length;
  const label = n === 1
    ? '1 fichier manquant dans la bibliothèque'
    : `${n} fichiers manquants dans la bibliothèque`;

  toastWithAction(label, 'warning', 'Gérer', () => _openOrphanDialog(orphanTracks), CFG.ORPHAN_CHECK_TIMEOUT_MS);
}

// ── Privé ─────────────────────────────────────────────────────────────────────
// CQ-8 : esc() supprimé — utiliser esc() importé depuis ui.js (même logique, partagée)

// P2-6 : Dialog interactif avec relocalisation par piste
async function _openOrphanDialog(orphanTracks) {
  const currentTracks = get('tracks');
  const fresh = currentTracks.filter(t => t.path && _missingPaths.has(t.path));
  if (!fresh.length) { _missingPaths.clear(); return; }

  const n = fresh.length;

  const bg = document.createElement('div');
  bg.className = 'modal-bg orphan-modal-bg';

  const buildRows = () => fresh.map(t =>
    '<li class="orphan-item" data-track-id="' + esc(t.id) + '">' +
      '<div class="orphan-item-info">' +
        '<span class="orphan-title">' + esc(t.name) + '</span>' +
        '<span class="orphan-path">' + esc(t.path) + '</span>' +
      '</div>' +
      '<button class="orphan-relocate-btn" data-track-id="' + esc(t.id) + '">Relocaliser</button>' +
    '</li>'
  ).join('');

  bg.innerHTML =
    '<div class="modal orphan-modal" role="dialog" aria-modal="true">' +
      '<div class="modal-title">' + n + ' fichier' + (n > 1 ? 's' : '') + ' manquant' + (n > 1 ? 's' : '') + '</div>' +
      '<p class="orphan-desc">Ces fichiers sont référencés dans la bibliothèque mais introuvables sur le disque. Relocalisez-les si vous les avez déplacés, ou supprimez-les de la bibliothèque.</p>' +
      '<ul class="orphan-list orphan-list-interactive">' + buildRows() + '</ul>' +
      '<div class="modal-actions">' +
        '<button class="mbtn secondary orphan-close-btn">Fermer</button>' +
        '<button class="mbtn danger orphan-delete-btn">Supprimer les manquants</button>' +
      '</div>' +
    '</div>';

  const _prevFocus = document.activeElement;
  document.body.appendChild(bg);
  requestAnimationFrame(() => {
    bg.classList.add('on');
    const firstFocusable = bg.querySelector('button, [tabindex="0"]');
    firstFocusable?.focus();
  });

  const close = () => {
    bg.classList.add('modal-closing');
    bg.addEventListener('animationend', () => bg.remove(), { once: true });
    setTimeout(() => bg.remove(), CFG.MODAL_CLOSE_MS);
    _prevFocus?.focus();
  };

  bg.querySelector('.orphan-close-btn').addEventListener('click', close);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  bg.querySelector('.orphan-delete-btn').addEventListener('click', async () => {
    const remaining = fresh.filter(t => _missingPaths.has(t.path));
    if (!remaining.length) { close(); return; }
    await _deleteOrphans(remaining);
    close();
  });

  bg.querySelector('.orphan-list').addEventListener('click', async e => {
    const btn = e.target.closest('.orphan-relocate-btn');
    if (!btn || btn.disabled) return;
    const id    = btn.dataset.trackId;
    const track = fresh.find(t => t.id === id);
    if (!track) return;
    const row = btn.closest('.orphan-item');
    await _relocateOrphan(track, row, btn);
    if (_missingPaths.size === 0) setTimeout(close, CFG.RELOCATE_SUCCESS_MS);
  });
}

async function _relocateOrphan(track, rowEl, btnEl) {
  btnEl.disabled = true;
  const prevLabel = btnEl.textContent.trim();
  btnEl.textContent = '…';

  let newPath;
  try {
    newPath = await invoke('pick_audio_file');
  } catch(e) {
    console.warn('[orphans] pick_audio_file:', e);
  }

  if (!newPath) {
    btnEl.disabled = false;
    btnEl.textContent = prevLabel;
    return;
  }
  // SEC-4 : valider l'extension du fichier sélectionné avant toute mutation
  const _pickedExt = newPath.replace(/\\/g, '/').split('/').pop().split('.').pop().toLowerCase();
  const _AUDIO_EXTS = ['mp3','flac','aac','m4a','ogg','opus','wav','wma','aiff','ape','alac'];
  if (!_AUDIO_EXTS.includes(_pickedExt)) {
    toast('Type de fichier non reconnu — choisissez un fichier audio', 'warning');
    btnEl.disabled = false; btnEl.textContent = prevLabel;
    return;
  }

  const oldPath = track.path;  // sauvegarder avant mutation
  const tracks = get('tracks');
  const idx    = trackIdx(track);
  if (idx >= 0) {
    tracks[idx].path     = newPath;
    tracks[idx].url      = convertFileSrc(newPath);
    tracks[idx].metaDone = false;
    await saveTrackNow(tracks[idx]);
  }

  _missingPaths.delete(oldPath);  // supprime l'ancien chemin manquant
  // track.path et track.url déjà mis à jour via tracks[idx] (même référence)

  rowEl.classList.add('orphan-relocated');
  const pathEl = rowEl.querySelector('.orphan-path');
  if (pathEl) pathEl.textContent = newPath;
  btnEl.textContent = '✓ OK';

  toast('"' + track.name + '" relocalisé', 'success');

  invalidateFilterCache();
  emit(EVENTS.RENDER_LIB, {});
}

async function _deleteOrphans(orphanTracks) {
  const tracks = get('tracks');

  const toRemove = orphanTracks
    .map(t => trackIdx(t.id))
    .filter(i => i >= 0);
  toRemove.sort((a, b) => b - a);

  const idsToDelete = toRemove.map(i => tracks[i] && tracks[i].id).filter(Boolean);

  for (const idx of toRemove) {
    const t = tracks[idx];
    if (!t) continue;
    if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch(e) {}
    if (t.url && t.url.startsWith('blob:')) try { URL.revokeObjectURL(t.url); } catch(e) {}
  }

  for (const idx of toRemove) {
    adjustShuffleQAfterDelete(idx);
    tracks.splice(idx, 1);
    if (get('curIdx') === idx)    { audio.pause(); setCurIdx(-1); }
    else if (get('curIdx') > idx) { setCurIdx(get('curIdx') - 1); }
  }

  await Promise.all(idsToDelete.map(id => ddel('tracks', id).catch(e => console.warn('[orphans] IDB delete failed:', e))));

  const liked = get('liked');
  idsToDelete.forEach(id => liked.delete(id));

  rebuildTrackIdxMap();
  notify('tracks'); // tracks[] muté en place → force-notify sans changer la référence
  _missingPaths.clear();

  invalidateFilterCache();
  emit(EVENTS.FILTER_CHANGED, {});
  VIRT._lastListSig = '';
  emit(EVENTS.RENDER_LIB, {});
  updateStats();

  const n = idsToDelete.length;
  toast(
    n + ' fichier' + (n > 1 ? 's' : '') + ' supprimé' + (n > 1 ? 's' : '') + ' de la bibliothèque',
    'success'
  );
}
