/**
 * library.js — Gestion de la bibliothèque musicale (Phase 3 refactoring)
 *
 * Possède : _saveTrackBatch, _saveTrackTimer, _scanInProgress.
 *
 * Imports directs depuis les modules stables.
 * Lit/écrit l'état applicatif via window.* (défini dans app.js).
 * Ces dépendances window.* seront éliminées lors des phases ultérieures
 * (Phase 4 : migration vers store.js/bus.js).
 *
 * Exports : loadTagsAndDurations, loadTagsBg,
 *           saveTrack, saveTracks, saveTrackNow, flushTrackBatch.
 */

import { _trackIdxMap, trackIdx, invalidateFilterCache } from './search.js';
import { emit, EVENTS }                                from './bus.js';
import { DB, dput, dget, isQuotaError }               from './db.js';
import { invoke, invokeRetry }                        from './ipc.js';
import { i18n }                                       from './i18n.js';
import { extractColor, guessGenre }                   from './tags.js';
import { rgEnabled }                                  from './replaygain.js';
import { CFG }                                        from './cfg.js';
import { normTag, mainArtist, fmtd, validYear }       from './utils.js';

import { adjustShuffleQAfterDelete }                  from './player.js';
import { VIRT }                                       from './virt.js';
import { cacheArt, resolveArtBuf, ART_MIME_ALLOWLIST } from './artLoader.js';
import { get, set }                                   from './store.js'; // Phase 4
import { toast, toastWithAction }                                        from './ui.js';
import { setCurIdx, removeTrackAt } from './state.js';
import { updateBar } from './playerbar.js';
import { updateStats, scheduleStatsUpdate, patchTrackEl } from './renderer.js';
import { setReplayGain } from './replaygain.js';

// ── Helpers locaux ────────────────────────────────────────────────────────────

/**
 * SEC-5 : Valide et tronque un champ tag textuel provenant d'un fichier externe.
 * Protège contre les chaînes excessivement longues issues de fichiers malformés.
 * @param {unknown} val — valeur brute de l'IPC
 * @param {number} [maxLen=500] — longueur max autorisée
 * @returns {string | null}
 */
function _sanitizeTagStr(val, maxLen = 500) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().slice(0, maxLen);
  return trimmed || null;
}

// ── État interne ──────────────────────────────────────────────────────────────
let _saveTrackBatch    = new Map();  // Map<id, Track> — pistes à flush
let _saveTrackTimer    = null;       // debounce timer
let _saveTrackMaxTimer = null;       // garantit un flush toutes les 2s sous charge continue

// ── loadTagsAndDurations ──────────────────────────────────────────────────────
/**
 * Charge les durées + tags ID3 en arrière-plan pour les pistes nouvellement importées.
 * Utilise asset:// URL pour les durées (très rapide, sans IPC).
 */
export async function loadTagsAndDurations(newTracks) {
  const DUR_CONCURRENCY = CFG.TAG_LOAD_CONCURRENCY; // OPT-4 : CFG au lieu de 4 hardcodé
  const _tagsLoadingId  = 'tags-loading-' + Date.now();
  const _sbStats = document.getElementById('sb-stats');
  if (_sbStats) _sbStats.insertAdjacentHTML('beforeend',
    ` <span id="${_tagsLoadingId}" style="opacity:.5;font-size:10px">· chargement…</span>`);
  let _skippedCount = 0;

  async function loadOne(t) {
    // OPT-1 : read_tags remplace read_audio_props + read_file + JS readTags() + read_audio_props×2
    // 3 IPC et jusqu'à 50 Mo de transfert → 1 IPC, transfert limité à la pochette (~200 Ko)
    if (t._durPending && t.path) {
      let rustTags;
      try {
        rustTags = await invokeRetry('read_tags', { path: t.path });
      } catch (_e) {
        return 'timeout'; // compte dans _timedOutCount → toast groupé en fin de scan
      }
      const dur = rustTags?.duration_secs ?? 0;
      t.duration    = dur;
      t._durPending = false;
      if (dur > 0 && dur < CFG.SHORT_TRACK_MIN_SECS) {
        // Piste trop courte — supprimer
        const idx = trackIdx(t.id);
        if (idx > -1) {
          get('liked').delete(t.id);
          setCurIdx(get('curIdx') > idx ? get('curIdx') - 1 : get('curIdx') === idx ? -1 : get('curIdx'));
          adjustShuffleQAfterDelete(idx); // ⚠ AVANT removeTrackAt — utilise l'index original
          const _tracks = get('tracks');
          if (_tracks[idx].art  && _tracks[idx].art.startsWith('blob:'))  try { URL.revokeObjectURL(_tracks[idx].art);  } catch {}
          if (_tracks[idx].url  && _tracks[idx].url.startsWith('blob:'))  try { URL.revokeObjectURL(_tracks[idx].url);  } catch {}
          removeTrackAt(idx); // ARCH-3 : splice + rebuildTrackIdxMap + notify (rebuild avant notify ✓)
          emit(EVENTS.LIBRARY_UPDATED, { tracks: get('tracks') });
          invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
          _skippedCount++;
          console.warn('[library] Piste ignorée — durée < ' + CFG.SHORT_TRACK_MIN_SECS + 's :', t.name || t.path);
        }
        return;
      }
      saveTracks(t);
      const el = document.getElementById('tr-' + t.id);
      if (el) {
        let durEl = el.querySelector('.tdur');
        if (!durEl && dur > 0) {
          durEl = document.createElement('span');
          durEl.className = 'tdur';
          const trR = el.querySelector('.tr-r');
          if (trR) trR.insertBefore(durEl, trR.firstChild);
        }
        if (durEl) durEl.textContent = fmtd(dur);
      }
      VIRT._lastListSig = '';
      // OPT-1 : passer rustTags pré-chargés pour éviter tout IPC supplémentaire dans loadTagsBg
      return await loadTagsBg(t, rustTags);
    }
  }

  let _timedOutCount = 0;
  for (let i = 0; i < newTracks.length; i += DUR_CONCURRENCY) {
    const results = await Promise.all(newTracks.slice(i, i + DUR_CONCURRENCY).map(t => loadOne(t)));
    for (const r of results) { if (r === 'timeout') _timedOutCount++; }
    await new Promise(r => setTimeout(r, 0)); // OPT-3 : yield event loop, délai artificiel supprimé
  }
  if (_timedOutCount > 0) toast(i18n('err_tag_timeout', _timedOutCount), 'warning');
  if (_saveTrackTimer) { clearTimeout(_saveTrackTimer); await flushTrackBatch(); }
  if (_skippedCount > 0) {
    toast(i18n('t_short_tracks_skipped', _skippedCount), 'warning');
  }
  document.getElementById(_tagsLoadingId)?.remove();
  scheduleStatsUpdate();

  // RG-PROMPT : proposer d'activer ReplayGain si ≥ 3 pistes non analysées
  const _unanalyzed = newTracks.filter(t => t.rgGain === undefined || t.rgGain === null).length;
  if (!rgEnabled && _unanalyzed >= 3) {
    setTimeout(() => {
      toastWithAction(
        i18n('t_rg_prompt', _unanalyzed),
        'info',
        i18n('t_rg_enable_btn'),
        () => setReplayGain(true),
        8000
      );
    }, 2000);
  }
}

// ── loadTagsBg ────────────────────────────────────────────────────────────────
/**
 * Lit les tags d'un track via read_tags (Rust/lofty) — 1 IPC, pas de transfert du fichier complet.
 * Accepte optionnellement des rustTags pré-chargés par loadOne() pour éviter tout IPC supplémentaire.
 * Patch l'élément DOM et sauvegarde en IDB si les métadonnées changent.
 * @param {import('./types.js').Track} t
 * @param {import('./ipc.js').TrackTags | null} [rustTags]
 */
export async function loadTagsBg(t, rustTags = null) {
  // OPT-1 : si pas de tags pré-chargés (cas rescan), charger via read_tags
  if (!rustTags && t.path) {
    let _ipcTimeoutId;
    try {
      const _ipcTimeout = new Promise((_, rej) => {
        _ipcTimeoutId = setTimeout(() => rej(new Error('IPC timeout')), CFG.IPC_TIMEOUT_MS);
      });
      rustTags = /** @type {any} */ (await Promise.race([
        invokeRetry('read_tags', { path: t.path }),
        _ipcTimeout,
      ]));
    } catch (e) {
      console.warn('[library] read_tags failed for', t.name, ':', e);
      // UX-16 : ne pas spammer si c'est un timeout/retry — on toast uniquement en cas d'erreur réelle
      if (e && e.message !== 'IPC timeout') {
        toast(`${i18n('t_tags_read_error') || 'Impossible de lire les tags'} : ${t.name}`, 'warning');
      }
      t.metaDone = true; saveTracks(t);
      const _wasTimeout = e && e.message === 'IPC timeout';
      return _wasTimeout ? 'timeout' : undefined;
    } finally {
      clearTimeout(_ipcTimeoutId);
    }
  }
  if (!_trackIdxMap.has(t.id)) return;
  if (!rustTags) { t.metaDone = true; saveTracks(t); return; }

  // B3 FIX : pistes courtes importées via watchfolder (sans _durPending) sauvées en IDB
  // → les supprimer avant tout traitement. _durPending=true = déjà géré par loadTagsAndDurations.
  if (!t._durPending) {
    const _bgDur = rustTags.duration_secs ?? 0;
    if (_bgDur > 0 && _bgDur < CFG.SHORT_TRACK_MIN_SECS) {
      const _bidx = trackIdx(t.id);
      if (_bidx > -1) {
        const _bTracks = get('tracks');
        if (_bTracks[_bidx]?.url && _bTracks[_bidx].url.startsWith('blob:'))
          try { URL.revokeObjectURL(_bTracks[_bidx].url); } catch {}
        if (_bTracks[_bidx]?.art && _bTracks[_bidx].art.startsWith('blob:'))
          try { URL.revokeObjectURL(_bTracks[_bidx].art); } catch {}
        setCurIdx(get('curIdx') > _bidx ? get('curIdx') - 1 : get('curIdx') === _bidx ? -1 : get('curIdx'));
        adjustShuffleQAfterDelete(_bidx); // ⚠ AVANT removeTrackAt — utilise l'index original
        removeTrackAt(_bidx); // ARCH-3 : splice + rebuildTrackIdxMap + notify (rebuild avant notify ✓)
        invalidateFilterCache();
        emit(EVENTS.FILTER_CHANGED, {});
        console.warn('[loadTagsBg] Piste ignorée — durée < 20s :', t.name || t.path);
      }
      return; // ne pas sauvegarder en IDB
    }
  }

  try {
    let changed = false;
    // SEC-5 : valider et tronquer les champs textuels avant tout traitement
    const ntitle      = normTag(_sanitizeTagStr(rustTags.title));
    const nartistFull = normTag(_sanitizeTagStr(rustTags.artist));
    const nartist     = mainArtist(nartistFull);
    const nalbum      = normTag(_sanitizeTagStr(rustTags.album));
    if (ntitle      && ntitle      !== t.name)       { t.name       = ntitle;       changed = true; delete t._nlc; }
    if (nartistFull && nartistFull !== t.artistFull) { t.artistFull = nartistFull;  changed = true; delete t._nlc; }
    if (nartist     && nartist     !== t.artist)     { t.artist     = nartist;      changed = true; delete t._nlc; delete t._artistKey; delete t._alc; }
    if (nalbum      && nalbum      !== t.album)      { t.album      = nalbum;       changed = true; delete t._nlc; delete t._albumKey;  delete t._ablc; }
    const ngenre = normTag(_sanitizeTagStr(rustTags.genre));
    if (ngenre && ngenre !== t.genre) { t.genre = ngenre; changed = true; delete t._nlc; delete t._glc; delete t._genreParts; }
    if (!t.genre) { const guessed = guessGenre(t); if (guessed) { t.genre = guessed; changed = true; } }
    // Mettre à jour l'année — y compris la vider si le tag est absent/epoch (nettoyage des 1970 parasites)
    { const ny = validYear(rustTags.year); if (ny !== (t.year ?? null)) { t.year = ny; changed = true; } }
    if (rustTags.track && rustTags.track !== t.track) { t.track = rustTags.track; changed = true; }
    // Cover : décodage base64 → ArrayBuffer → blob URL géré par artLoader LRU.
    // Évite les blob URLs hors-cache qui s'accumulent en RAM (50-60 MB en batch).
    if (rustTags.cover_base64) {
      if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
      const mime = ART_MIME_ALLOWLIST.includes(rustTags.cover_mime) ? rustTags.cover_mime : 'image/jpeg';
      const u8 = Uint8Array.from(atob(rustTags.cover_base64), c => c.charCodeAt(0));
      t._artBuf  = u8.buffer;
      t._artMime = mime;
      t._b64     = null; // invalider tout cache base64 existant
      t.art      = cacheArt(t);    // ajoute à artLoader LRU + crée blob URL
      t.noArt    = false;
      t._hasArt  = true;             // ARCH-2 : marquer comme ayant une artwork
      changed    = true;
      // OPT-2 : extractColor fire-and-forget — ne bloque plus le batch critique
      const artUrl = t.art;
      extractColor(artUrl).then(color => {
        if (!_trackIdxMap.has(t.id)) return;
        t.artColor = color;
        saveTracks(t);
      }).catch(e => console.warn('[library:extractColor]', t.id, e));
    } else {
      t.noArt   = true;
      t._hasArt = false; // ARCH-2 : aucune artwork → désactiver le chargement paresseux
    }
    // Propriétés audio techniques (bitrate, sampleRate, channels, bitDepth)
    if (rustTags.bitrate     != null) { t.bitrate    = rustTags.bitrate;      changed = true; }
    if (rustTags.sample_rate != null) { t.sampleRate = rustTags.sample_rate;  changed = true; }
    if (rustTags.channels    != null) { t.channels   = rustTags.channels;     changed = true; }
    if (rustTags.bit_depth   != null) { t.bitDepth   = rustTags.bit_depth;    changed = true; }
    t.metaDone = true;
    if (changed) { delete t._trigrams; }
    if (changed) patchTrackEl(t.id);
    if (trackIdx(t.id) === get('curIdx')) updateBar();
    if (changed) scheduleStatsUpdate();
  } catch(e) {
    console.warn('[loadTagsBg]', e);
    t.metaDone = true;
    t.noArt = true;
  }
  t.file = null;
  if (_trackIdxMap.has(t.id)) saveTracks(t);
}



// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Flush le batch de pistes vers IndexedDB (une seule transaction atomique).
 * Appelé par le timer debounced ou de force avant un flush critique.
 */
export async function flushTrackBatch() {
  _saveTrackTimer = null;
  if (!_saveTrackBatch.size || !DB) return;
  const batch = [..._saveTrackBatch.values()];
  _saveTrackBatch.clear();

  const records = await Promise.all(batch.map(async t => {
    if (!_trackIdxMap.has(t.id)) return null;
    const artRes = t.noArt ? null : await resolveArtBuf(t);
    return {
      id: t.id, name: t.name, artist: t.artist, artistFull: t.artistFull || t.artist,
      album: t.album, ext: t.ext, path: t.path, duration: t.duration, dateAdded: t.dateAdded,
      artBuf: artRes?.buf || null, artMime: artRes?.mime || null,
      artColor: t.artColor || null, genre: t.genre || null,
      year:   (t.year  != null && t.year  !== false ? t.year  : null),
      track:  (t.track != null && t.track !== false ? t.track : null),
      rgGain:     t.rgGain    !== undefined ? t.rgGain    : null,
      noArt:      t.noArt     || false,
      // C-3 : propriétés audio techniques
      bitrate:    t.bitrate    != null ? t.bitrate    : null,
      sampleRate: t.sampleRate != null ? t.sampleRate : null,
      channels:   t.channels   != null ? t.channels   : null,
      bitDepth:   t.bitDepth   != null ? t.bitDepth   : null,
    };
  }));

  const validRecords = records.filter(Boolean);
  if (!validRecords.length) return;

  /** Exécute une transaction IDB de type readwrite pour écrire les records donnés. */
  async function _writeTx(recs) {
    const transaction = DB.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    for (const rec of recs) store.put(rec);
    await new Promise((ok, fail) => {
      transaction.oncomplete = ok;
      transaction.onerror   = () => fail(transaction.error);
    });
  }

  try {
    await _writeTx(validRecords);
  } catch(e) {
    if (isQuotaError(e)) {
      // ARCH-7 : quota IDB dépassé — réessayer sans artBuf (artwork sacrifié, métadonnées préservées)
      console.warn('[flushTrackBatch] Quota IDB dépassé — retry sans artwork', e);
      const stripped = validRecords.map(r => ({ ...r, artBuf: null, artMime: null }));
      try {
        await _writeTx(stripped);
        // Invalider le flag _hasArt sur les tracks concernées pour éviter des retentatives IDB
        for (const rec of stripped) {
          const idx = _trackIdxMap.get(rec.id);
          if (idx != null) { const t = get('tracks')[idx]; if (t) { t._hasArt = false; t.noArt = true; } }
        }
        toast(
          i18n('t_idb_quota_artwork') || 'Stockage presque plein — artwork non sauvegardé. Libérez de l\'espace disque.',
          'warning'
        );
      } catch(e2) {
        console.error('[flushTrackBatch] Quota IDB critique — métadonnées non sauvegardées', e2);
        toast(
          i18n('t_idb_quota_critical') || 'Stockage plein — données non sauvegardées. Libérez de l\'espace disque immédiatement.',
          'error'
        );
      }
    } else {
      console.warn('[flushTrackBatch] Erreur IDB inattendue:', e);
      toast(i18n('t_idb_write_error') || 'Erreur d\'écriture IDB — relancez l\'application si le problème persiste.', 'error');
    }
  }
}

/**
 * Accumule un track dans le batch de sauvegarde IDB (debounced).
 * Préférer saveTracks() en interne ; saveTrack() reste pour les satellites.
 */
export async function saveTrack(t) {
  _saveTrackBatch.set(t.id, t);
  if (!_saveTrackTimer) _saveTrackTimer = setTimeout(flushTrackBatch, CFG.TRACK_SAVE_DEBOUNCE);
}

/**
 * Variante variadique de saveTrack — réinitialise le timer à chaque appel (vrai debounce).
 */
export function saveTracks(...ts) {
  ts.forEach(t => _saveTrackBatch.set(t.id, t));
  if (_saveTrackTimer) clearTimeout(_saveTrackTimer);
  _saveTrackTimer = setTimeout(flushTrackBatch, CFG.TRACK_SAVE_DEBOUNCE);
  if (!_saveTrackMaxTimer) {
    _saveTrackMaxTimer = setTimeout(async () => {
      _saveTrackMaxTimer = null;
      if (_saveTrackTimer) { clearTimeout(_saveTrackTimer); _saveTrackTimer = null; }
      await flushTrackBatch();
    }, 2000);
  }
}

/**
 * Annule le batch de sauvegarde en attente sans rien écrire en IDB.
 * Utilisé par clearLibrary() pour éviter que des tracks "fantômes" soient
 * réécrites après le vidage de la bibliothèque (race condition timer).
 */
export function cancelTrackBatch() {
  if (_saveTrackTimer)    { clearTimeout(_saveTrackTimer);    _saveTrackTimer    = null; }
  if (_saveTrackMaxTimer) { clearTimeout(_saveTrackMaxTimer); _saveTrackMaxTimer = null; }
  _saveTrackBatch.clear();
}

/**
 * Sauvegarde immédiate d'une piste en IDB (ex: après édition manuelle de tags).
 * Retire le track du batch debounce pour éviter une double-écriture.
 */
export async function saveTrackNow(t) {
  _saveTrackBatch.delete(t.id);
  if (!DB) return;
  try {
    const artRes = t.noArt ? null : await resolveArtBuf(t);
    const rec = {
      id: t.id, name: t.name, artist: t.artist, artistFull: t.artistFull || t.artist,
      album: t.album, ext: t.ext, path: t.path, duration: t.duration, dateAdded: t.dateAdded,
      artBuf: artRes?.buf || null, artMime: artRes?.mime || null,
      artColor: t.artColor || null, genre: t.genre || null,
      year:   (t.year  != null && t.year  !== false ? t.year  : null),
      track:  (t.track != null && t.track !== false ? t.track : null),
      rgGain:     t.rgGain    !== undefined ? t.rgGain    : null,
      noArt:      t.noArt     || false,
      bitrate:    t.bitrate    != null ? t.bitrate    : null,
      sampleRate: t.sampleRate != null ? t.sampleRate : null,
      channels:   t.channels   != null ? t.channels   : null,
      bitDepth:   t.bitDepth   != null ? t.bitDepth   : null,
    };
    const transaction = DB.transaction('tracks', 'readwrite');
    transaction.objectStore('tracks').put(rec);
    await new Promise((ok, fail) => {
      transaction.oncomplete = ok;
      transaction.onerror   = () => fail(transaction.error);
    });
  } catch(e) { console.warn('[saveTrackNow]', e); }
}
