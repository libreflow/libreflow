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
 * Exports : openFolder, loadTagsAndDurations, loadTagsBg, rescanTags,
 *           saveTrack, saveTracks, saveTrackNow, flushTrackBatch.
 */

import { _trackIdxMap, trackIdx, invalidateFilterCache } from './search.js';
import { emit, EVENTS }                                from './bus.js';
import { DB, dput, dget, isQuotaError }               from './db.js';
import { invoke, invokeRetry, convertFileSrc }        from './ipc.js';
import { i18n }                                       from './i18n.js';
import { extractColor, guessGenre }                   from './tags.js';
import { rgEnabled }                                  from './replaygain.js';
import { CFG }                                        from './cfg.js';
import { normTag, mainArtist, fmtd }                  from './utils.js';

// ── Security ──────────────────────────────────────────────────────────────────
const ART_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
import { adjustShuffleQAfterDelete }                  from './player.js';
import { VIRT }                                       from './virt.js';
import { get, set }                                   from './store.js'; // Phase 4
import { toast, toastWithAction }                                        from './ui.js';
import { setCurIdx, pushTracks, removeTrackAt } from './state.js';
import { updateBar } from './playerbar.js';
import { setView, showView } from './views.js';
import { updateStats, scheduleStatsUpdate, patchTrackEl } from './renderer.js';
import { setReplayGain } from './replaygain.js';

// ── Helpers locaux ────────────────────────────────────────────────────────────
/** Valide une année entre 1900 et 2100. */
function _validYear(y) {
  const n = Number(y);
  return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null;
}

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
let _scanInProgress  = false;      // RACE-1 : guard contre les openFolder() concurrents

// ── openFolder ────────────────────────────────────────────────────────────────
/**
 * Ouvre le dialog de sélection de dossier, scanne les fichiers audio,
 * crée les pistes avec asset:// URL, puis lance le chargement des tags en BG.
 */
export async function openFolder() {
  if (_scanInProgress) { toast(i18n('t_scan_in_progress') || 'Scan déjà en cours…', 'warning'); return; }
  const result = await invoke('open_folder');
  if (!result) return;
  const { folder, files } = result;
  if (!files.length) { toast(i18n('t_no_audio'), 'warning'); return; }

  // IPC-ASSET : accorder l'accès asset:// au dossier sélectionné (obligatoire en build prod).
  // En dev, Tauri est permissif — en production, le scope doit être explicitement accordé via
  // app.asset_protocol_scope().allow_directory() côté Rust, ce que fait allow_asset_dir.
  // Fire-and-forget : le scan crée les URL avec convertFileSrc ; l'accès sera prêt
  // avant que l'utilisateur puisse cliquer sur Lire (le scan prend ≥ quelques ms).
  if (folder) invoke('allow_asset_dir', { path: folder }).catch(e => console.warn('[allow_asset_dir]', e));

  _scanInProgress = true;
  try {
  showView('scan');
  const elSn  = document.getElementById('sn');
  const elSf  = document.getElementById('sf');
  const elBar = document.getElementById('scan-bar');
  if (elSn) elSn.textContent = '0';
  if (elSf) elSf.textContent = `${files.length} fichiers détectés…`;
  if (elBar) elBar.style.width = '0%';

  const byPath = new Map(get('tracks').map(t => [t.path, t])); // Phase 4
  for (const p of files) { if (byPath.has(p)) byPath.get(p).url = null; }

  const newPaths  = files.filter(p => !byPath.has(p));
  const newTracks = [];
  let   loaded    = 0;
  const _scanStart = Date.now();

  // Créer les pistes SANS lire les fichiers (asset:// direct — zéro IPC par fichier)
  // MINOR-3 FIX : yield toutes les 200 pistes pour que le navigateur repeigne l'UI
  const YIELD_EVERY = 200;
  for (const p of newPaths) {
    const name    = p.replace(/\\/g, '/').split('/').pop();
    const ext     = name.split('.').pop().toUpperCase();
    const guess   = n => { const bare = n.replace(/\.[^.]+$/, ''); return bare.includes(' - ') ? bare.split(' - ')[0].trim() : ''; };
    const assetUrl = convertFileSrc(p);
    const t = {
      id:          crypto.randomUUID(),
      name:        name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      artistFull:  guess(name) || i18n('unknown_artist'),
      artist:      guess(name) || i18n('unknown_artist'),
      album: '', ext, path: p,
      duration:    0,
      dateAdded:   Date.now(),
      art: null, artColor: null,
      url:         assetUrl,
      file:        null,
      metaDone:    false,
      _durPending: true,
    };
    newTracks.push(t);
    loaded++;
    if (elSn) elSn.textContent = String(loaded);
    if (elSn && (loaded % 50 === 0 || loaded <= 10)) { elSn.classList.remove('pop'); void elSn.offsetWidth; elSn.classList.add('pop'); }
    if (loaded % YIELD_EVERY === 0 || loaded === newPaths.length) {
      const pct = Math.round(loaded / newPaths.length * 100);
      if (elBar) elBar.style.width = pct + '%';
      const elapsed = Date.now() - _scanStart;
      if (elapsed > 300 && loaded > 0) {
        const rate = loaded / elapsed;
        const etaMs = (newPaths.length - loaded) / rate;
        const etaS  = Math.ceil(etaMs / 1000);
        const etaStr = etaS >= 60 ? `${Math.floor(etaS/60)}m ${etaS%60}s` : `${etaS}s`;
        if (elSf) elSf.textContent = `${loaded} / ${newPaths.length} • ETA ~${etaStr}`;
      }
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (!newTracks.length && get('tracks').length === 0) { // Phase 4
    showView('wlc'); toast(i18n('t_no_loaded'), 'warning'); return;
  }
  if (!newTracks.length) {
    showView('lib'); toast(i18n('t_already_imported'), 'info'); return;
  }

  pushTracks(newTracks); // ARCH-3 : push + rebuildTrackIdxMap + notify (rebuild avant notify ✓)
  emit(EVENTS.LIBRARY_UPDATED, { tracks: get('tracks') }); // cohérence avec app.js drag-drop
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); VIRT._lastListSig = '';
  updateStats();
  setView('all', document.getElementById('ni-all'));
  toast(i18n('t_scanned', newTracks.length), 'success');

  loadTagsAndDurations(newTracks);
  } catch (e) {
    console.error('[openFolder] scan failed:', e);
    toast(i18n('t_scan_error') || 'Erreur lors du scan', 'error');
  } finally {
    _scanInProgress = false;
  }
}

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
      const rustTags = await invoke('read_tags', { path: t.path }).catch(() => null);
      const dur = rustTags?.duration_secs ?? 0;
      t.duration    = dur;
      t._durPending = false;
      if (dur > 0 && dur < 20) {
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
          console.warn('[library] Piste ignorée — durée < 20s :', t.name || t.path);
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
      await loadTagsBg(t, rustTags);
    }
  }

  for (let i = 0; i < newTracks.length; i += DUR_CONCURRENCY) {
    await Promise.all(newTracks.slice(i, i + DUR_CONCURRENCY).map(t => loadOne(t)));
    await new Promise(r => setTimeout(r, 0)); // OPT-3 : yield event loop, délai artificiel supprimé
  }
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
      t.metaDone = true; saveTracks(t); return;
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
    { const ny = _validYear(rustTags.year); if (ny !== (t.year ?? null)) { t.year = ny; changed = true; } }
    if (rustTags.track && rustTags.track !== t.track) { t.track = rustTags.track; changed = true; }
    // Cover : décodage base64 → ArrayBuffer → blob URL
    if (rustTags.cover_base64) {
      if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
      const mime = ART_MIME_ALLOWLIST.includes(rustTags.cover_mime) ? rustTags.cover_mime : 'image/jpeg';
      const u8 = Uint8Array.from(atob(rustTags.cover_base64), c => c.charCodeAt(0));
      t._artBuf  = u8.buffer;
      t._artMime = mime;
      t._b64     = null; // invalider tout cache base64 existant
      const blob = new Blob([t._artBuf], { type: mime });
      t.art     = URL.createObjectURL(blob);
      t.noArt   = false;
      t._hasArt = true;  // ARCH-2 : marquer comme ayant une artwork (flag lazy loader)
      changed = true;
      // OPT-2 : extractColor fire-and-forget — ne bloque plus le batch critique
      const artUrl = t.art;
      extractColor(artUrl).then(color => {
        if (!_trackIdxMap.has(t.id)) return;
        t.artColor = color;
        saveTracks(t);
      }).catch(() => {});
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

// ── rescanTags ────────────────────────────────────────────────────────────────
/**
 * Re-lit les tags ID3 de toutes les pistes (force metaDone=false).
 * Utile après modification externe des fichiers.
 */
export async function rescanTags() {
  const _tracks = get('tracks'); // Phase 4
  if (!_tracks.length) { toast(i18n('t_rescan_empty'), 'warning'); return; }
  toast(i18n('t_rescan_start'));
  const CONCURRENCY = CFG.TAG_LOAD_CONCURRENCY;
  let count = 0;
  for (const t of _tracks) { t.metaDone = false; t.file = null; }
  for (let i = 0; i < _tracks.length; i += CONCURRENCY) {
    const batch  = _tracks.slice(i, i + CONCURRENCY).filter(t => t.path);
    const before = batch.map(t => ({ name: t.name, artist: t.artist, album: t.album, genre: t.genre }));
    await Promise.all(batch.map(t => loadTagsBg(t)));
    for (let j = 0; j < batch.length; j++) {
      const t = batch[j], b = before[j];
      if (t.name !== b.name || t.artist !== b.artist || t.album !== b.album || t.genre !== b.genre) count++;
    }
    await new Promise(r => setTimeout(r, 0)); // yield event loop
  }
  if (_saveTrackTimer) { clearTimeout(_saveTrackTimer); await flushTrackBatch(); }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();
  toast(i18n('t_rescan_done', count), 'success');
}


/**
 * Résout les bytes bruts de l'artwork depuis le track.
 * Priorité : _artBuf (nouveau) → décodage base64 data: URL (migration IDB)
 *          → fetch blob: URL (compat ultime, ne devrait plus arriver).
 * Met à jour t._artBuf/_artMime pour accélérer les appels suivants.
 * @returns {{ buf: ArrayBuffer, mime: string }|null}
 */
async function _resolveArtBuf(t) {
  if (t._artBuf) return { buf: t._artBuf, mime: t._artMime || 'image/jpeg' };
  // ARCH-2/PERF-1 : artwork paresseux — art existe en IDB mais pas encore chargé en RAM.
  // Lire depuis IDB pour éviter d'écraser artBuf avec null lors du flush (flushTrackBatch).
  // Après ce fetch, _artBuf est mis en cache pour éviter les lectures IDB répétées.
  if (t._hasArt && !t.noArt && !t.art) {
    try {
      const rec = await dget('tracks', t.id);
      if (rec?.artBuf) {
        t._artBuf  = rec.artBuf;
        t._artMime = ART_MIME_ALLOWLIST.includes(rec.artMime) ? rec.artMime : 'image/jpeg';
        return { buf: t._artBuf, mime: t._artMime };
      }
    } catch(e) { console.warn('[_resolveArtBuf] IDB fallback failed for', t.id, e); }
    return null;
  }
  if (!t.art)    return null;
  // Migration : ancienne IDB avec data: URL base64
  if (t.art.startsWith('data:')) {
    const rawMime = t.art.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
    const mime = ART_MIME_ALLOWLIST.includes(rawMime) ? rawMime : 'image/jpeg';
    const b64  = t.art.split(',')[1];
    if (!b64) return null;
    const arr  = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); // P10 — évite la boucle manuelle
    t._artBuf  = arr.buffer;
    t._artMime = mime;
    return { buf: t._artBuf, mime };
  }
  // Fallback : blob: URL (ne devrait plus arriver post-migration)
  if (t.art.startsWith('blob:')) {
    try {
      const resp = await fetch(t.art);
      const blob = await resp.blob();
      t._artBuf  = await blob.arrayBuffer();
      t._artMime = ART_MIME_ALLOWLIST.includes(blob.type) ? blob.type : 'image/jpeg';
      return { buf: t._artBuf, mime: t._artMime };
    } catch(e) { console.warn('[library] _resolveArtBuf blob fetch failed (URL révoquée?):', e); return null; }
  }
  return null;
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
    const artRes = t.noArt ? null : await _resolveArtBuf(t);
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
    const artRes = t.noArt ? null : await _resolveArtBuf(t);
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
