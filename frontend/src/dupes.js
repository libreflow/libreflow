// LibreFlow — dupes.js
// Détection et suppression de doublons dans la bibliothèque.
// Extrait de app.js.
//
// Remaining window.* : confirmAction, invalidateFilter, renderLib, updateStats, toast (app.js).
//
// Exports publics :
//   detectDupes, removeDupeTrack, deleteAllDupes, closeDupes

import { esc, normTag }                              from './utils.js';
import { ddel }                                      from './db.js';
import { i18n }                                      from './i18n.js';
import { get, notify }                               from './store.js';
import { emit, EVENTS }                              from './bus.js';
import { trackIdx, _trackIdxMap, rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { audio, adjustShuffleQAfterDelete }           from './player.js';
import { toast, confirmAction }                                        from './ui.js';
import { setCurIdx } from './state.js';
import { updateStats } from './renderer.js';

// ── État interne ──────────────────────────────────────────────
let dupesGroups = [];

// ── Détection ────────────────────────────────────────────────

export function detectDupes() {
  // Grouper par clé fuzzy : titre normalisé + artiste principal
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  const map = new Map();
  for (const t of tracks) {
    const key = normTag(t.name).toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim()
              + '|' + (t.artist || '').toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
    if (!key.replace('|','')) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  dupesGroups = [...map.values()].filter(g => g.length > 1);
  _renderDupes();
  document.getElementById('dupes-panel').classList.add('open');
}

function _renderDupes() {
  const el = document.getElementById('dupes-list');
  const delBtn = document.getElementById('dupes-del-all-btn');
  if (!dupesGroups.length) {
    el.innerHTML = `<div class="dupes-empty">${i18n('t_no_dupes')}</div>`;
    if (delBtn) delBtn.style.display = 'none';
    return;
  }
  if (delBtn) delBtn.style.display = '';
  el.innerHTML = dupesGroups.map((group, gi) => {
    const items = group.map((t, ti) => `
      <div class="dupe-item">
        <div class="dupe-item-name">${esc(t.name)}</div>
        <div class="dupe-item-path" title="${esc(t.path)}">${esc(t.path)}</div>
        <button class="dupe-del-btn" data-action="remove-dupe-track" data-id="${t.id}" data-gi="${gi}" data-ti="${ti}">${i18n('t_dupe_remove_btn')}</button>
      </div>`).join('');
    return `<div class="dupe-group">
      <div class="dupe-group-head">${i18n('t_dupe_group_head', group.length, esc(group[0].name))}</div>
      ${items}
    </div>`;
  }).join('');
}

export async function removeDupeTrack(id, gi, ti) {
  const tracks = get('tracks'); // Phase 4
  const t = (_trackIdxMap.has(id) ? tracks[_trackIdxMap.get(id)] : undefined);
  if (!t) return;
  const ok = await confirmAction(
    i18n('t_remove_dupe_h'),
    i18n('t_remove_dupe_body', t.name),
    i18n('t_delete_btn'), 'danger'
  );
  if (!ok) return;
  // Retirer de la bibliothèque
  const idx = trackIdx(t.id);
  if (idx >= 0) {
    // MEM-1/MEM-2 FIX : révoquer art ET url blob
    if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
    if (t.url && t.url.startsWith('blob:')) try { URL.revokeObjectURL(t.url); } catch {}
    tracks.splice(idx, 1);
    adjustShuffleQAfterDelete(idx); // BUG-D2-2 FIX: sync shuffle queue after splice
    // liked migré Set<id> : suppression directe, pas de shift d'indices
    get('liked').delete(t.id);
    if (get('curIdx') === idx) { audio.pause(); setCurIdx(-1); }
    else if (get('curIdx') > idx) setCurIdx(get('curIdx') - 1);
  }
  // Persister la suppression en IDB — sinon la piste réapparaît au redémarrage
  await ddel('tracks', t.id).catch(e => console.warn('[dupes] IDB delete failed:', e));
  // Mettre à jour le groupe
  if (dupesGroups[gi]) {
    dupesGroups[gi].splice(ti, 1);
    if (dupesGroups[gi].length < 2) dupesGroups.splice(gi, 1);
  }
  rebuildTrackIdxMap(); // RÈGLE CRITIQUE : après tout tracks.splice(), AVANT notify
  notify('tracks');     // BUG-D2-2 FIX: notify subscribers after map rebuild
  _renderDupes();
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();
}

export async function deleteAllDupes() {
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  // Garder le premier de chaque groupe, supprimer les autres.
  // liked migré Set<id> : pas besoin de snapshot, suppression directe par ID.
  // CRITIQUE : collecter TOUS les indices d'abord (avant tout splice),
  // puis trier décroissant et splicer. Sans ça, _trackIdxMap devient stale
  // après le 1er splice → trackIdx() retourne de mauvais indices → mauvaises pistes supprimées.
  const toRemove = [];
  const toRemoveSet = new Set();
  for (const group of dupesGroups) {
    for (let i = 1; i < group.length; i++) {
      const idx = trackIdx(group[i].id);
      if (idx >= 0 && !toRemoveSet.has(idx)) { toRemoveSet.add(idx); toRemove.push(idx); }
    }
  }
  toRemove.sort((a, b) => b - a); // décroissant : splice haute→basse, indices stables

  // Capturer les IDs AVANT de splicer (après splice, les indices sont périmés)
  const idsToDelete = toRemove.map(idx => tracks[idx]?.id).filter(Boolean);

  let removed = 0;
  for (const idx of toRemove) {
    // MEM-1/MEM-2 FIX : révoquer art ET url blob
    if (tracks[idx].art && tracks[idx].art.startsWith('blob:')) try { URL.revokeObjectURL(tracks[idx].art); } catch {}
    if (tracks[idx].url && tracks[idx].url.startsWith('blob:')) try { URL.revokeObjectURL(tracks[idx].url); } catch {}
    tracks.splice(idx, 1);
    adjustShuffleQAfterDelete(idx); // BUG-D2-4 FIX: sync shuffle queue after each splice (indices sorted desc, so idx is stable)
    if (get('curIdx') === idx) { audio.pause(); setCurIdx(-1); }
    else if (get('curIdx') > idx) setCurIdx(get('curIdx') - 1);
    removed++;
  }

  // Persister toutes les suppressions en IDB en parallèle
  await Promise.all(idsToDelete.map(id => ddel('tracks', id).catch(e => console.warn('[dupes] IDB delete failed:', e))));

  // liked migré Set<id> : supprimer directement les IDs supprimés
  const liked = get('liked'); // Phase 4
  idsToDelete.forEach(id => liked.delete(id));
  rebuildTrackIdxMap(); // RÈGLE CRITIQUE : après suppression en lot, AVANT notify
  notify('tracks');     // BUG-D2-4 FIX: notify subscribers after batch splice + map rebuild
  dupesGroups = [];
  _renderDupes();
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();
  toast(i18n('t_dupes_deleted', removed), 'success');
}

export function closeDupes() {
  document.getElementById('dupes-panel').classList.remove('open');
}
