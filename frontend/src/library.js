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

import { _trackIdxMap, rebuildTrackIdxMap, trackIdx, invalidateFilterCache } from './search.js';
import { emit, EVENTS }                                from './bus.js';
import { DB, dput }                                   from './db.js';
import { invoke, invokeRetry, convertFileSrc }        from './ipc.js';
import { i18n }                                       from './i18n.js';
import { readTags, extractColor, guessGenre }         from './tags.js';
import { rgEnabled }                                  from './replaygain.js';
import { CFG }                                        from './cfg.js';
import { normTag, mainArtist, fmtd }                  from './utils.js';
import { adjustShuffleQAfterDelete }                  from './player.js';
import { VIRT }                                       from './virt.js';
import { get, set }                                   from './store.js'; // Phase 4
import { toast, toastWithAction }                                        from './ui.js';
import { setCurIdx, updateBar } from './app.js';
import { setView, showView } from './views.js';
import { updateStats, scheduleStatsUpdate, patchTrackEl } from './renderer.js';
import { setReplayGain } from './replaygain.js';

// ── Helpers locaux ────────────────────────────────────────────────────────────
/** Valide une année entre 1900 et 2100. */
function _validYear(y) {
  const n = Number(y);
  return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null;
}

// ── État interne ──────────────────────────────────────────────────────────────
let _saveTrackBatch  = new Map();  // Map<id, Track> — pistes à flush
let _saveTrackTimer  = null;       // debounce timer
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
  const { files } = result;
  if (!files.length) { toast(i18n('t_no_audio'), 'warning'); return; }

  _scanInProgress = true;
  try {
  showView('scan');
  const elSn  = document.getElementById('sn');
  const elSf  = document.getElementById('sf');
  const elBar = document.getElementById('scan-bar');
  elSn.textContent = '0';
  elSf.textContent = `${files.length} fichiers détectés…`;
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
    elSn.textContent = loaded;
    if (loaded % 50 === 0 || loaded <= 10) { elSn.classList.remove('pop'); void elSn.offsetWidth; elSn.classList.add('pop'); }
    if (loaded % YIELD_EVERY === 0 || loaded === newPaths.length) {
      const pct = Math.round(loaded / newPaths.length * 100);
      if (elBar) elBar.style.width = pct + '%';
      const elapsed = Date.now() - _scanStart;
      if (elapsed > 300 && loaded > 0) {
        const rate = loaded / elapsed;
        const etaMs = (newPaths.length - loaded) / rate;
        const etaS  = Math.ceil(etaMs / 1000);
        const etaStr = etaS >= 60 ? `${Math.floor(etaS/60)}m ${etaS%60}s` : `${etaS}s`;
        elSf.textContent = `${loaded} / ${newPaths.length} • ETA ~${etaStr}`;
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

  const _tracksArr = get('tracks');
  _tracksArr.push(...newTracks);
  set('tracks', _tracksArr); // notifier les subscribers (mutation in-place sinon invisible)
  emit(EVENTS.LIBRARY_UPDATED, { tracks: _tracksArr }); // cohérence avec app.js drag-drop
  rebuildTrackIdxMap(); // Phase 4
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
  const DUR_CONCURRENCY = 4;
  const _tagsLoadingId  = 'tags-loading-' + Date.now();
  const _sbStats = document.getElementById('sb-stats');
  if (_sbStats) _sbStats.insertAdjacentHTML('beforeend',
    ` <span id="${_tagsLoadingId}" style="opacity:.5;font-size:10px">· chargement…</span>`);

  async function loadOne(t) {
    // 1. Durée via Audio sur l'URL asset://
    if (t._durPending && t.url) {
      const dur = await new Promise(res => {
        const tmp = new Audio();
        tmp.preload = 'metadata';
        tmp.src = t.url;
        const cleanup = val => { tmp.src = ''; tmp.load(); res(val); };
        tmp.addEventListener('loadedmetadata', () => cleanup(tmp.duration || 0), { once: true });
        tmp.addEventListener('error',           () => cleanup(0),                 { once: true });
        setTimeout(() => cleanup(0), 1500);
      });
      t.duration    = dur;
      t._durPending = false;
      if (dur > 0 && dur < 20) {
        // Piste trop courte — supprimer
        const idx = trackIdx(t.id);
        if (idx > -1) {
          // liked migré Set<id> : suppression directe, pas de shift d'indices
          get('liked').delete(t.id); // Phase 4
          setCurIdx(get('curIdx') > idx ? get('curIdx') - 1 : get('curIdx') === idx ? -1 : get('curIdx'));
          adjustShuffleQAfterDelete(idx);
          const _tracks = get('tracks'); // Phase 4
          if (_tracks[idx].art  && _tracks[idx].art.startsWith('blob:'))  try { URL.revokeObjectURL(_tracks[idx].art);  } catch {}
          if (_tracks[idx].url  && _tracks[idx].url.startsWith('blob:'))  try { URL.revokeObjectURL(_tracks[idx].url);  } catch {}
          _tracks.splice(idx, 1);
          rebuildTrackIdxMap();
          set('tracks', _tracks); // notifier les subscribers après splice
          emit(EVENTS.LIBRARY_UPDATED, { tracks: _tracks });
          invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
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
      VIRT._lastSig = '';
    }
    // 2. Tags ID3
    await loadTagsBg(t);
  }

  for (let i = 0; i < newTracks.length; i += DUR_CONCURRENCY) {
    await Promise.all(newTracks.slice(i, i + DUR_CONCURRENCY).map(t => loadOne(t)));
    await new Promise(r => setTimeout(r, 20));
  }
  if (_saveTrackTimer) { clearTimeout(_saveTrackTimer); await flushTrackBatch(); }
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
 * Lit les tags ID3 d'un track en arrière-plan via IPC (évite CORS avec fetch).
 * Patch l'élément DOM et sauvegarde en IDB si les métadonnées changent.
 */
export async function loadTagsBg(t) {
  if (!t.file && t.path) {
    try {
      const _ipcTimeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('IPC timeout')), CFG.IPC_TIMEOUT_MS)
      );
      const b64 = await Promise.race([invokeRetry('read_file', { path: t.path }), _ipcTimeout]);
      if (!_trackIdxMap.has(t.id)) return;
      if (!b64) { t.metaDone = true; saveTracks(t); return; }
      const u8  = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); // P10 — évite la boucle manuelle
      const name = t.path.replace(/\\/g, '/').split('/').pop();
      const ext  = name.split('.').pop().toLowerCase();
      t.file = new File([u8.buffer], name, { type: 'audio/' + ext });
    } catch {
      t.metaDone = true; saveTracks(t); return;
    }
  }
  if (!t.file) { t.metaDone = true; saveTracks(t); return; }
  try {
    // C-3 : lire tags ET propriétés audio en parallèle (même fichier, I/O indépendants)
    const [tags, props] = await Promise.all([
      readTags(t.file),
      invoke('read_audio_props', { path: t.path }).catch(() => null),
    ]);
    if (!_trackIdxMap.has(t.id)) return;
    let changed = false;
    const ntitle      = normTag(tags.title);
    const nartistFull = normTag(tags.artist);
    const nartist     = mainArtist(nartistFull);
    const nalbum      = normTag(tags.album);
    if (ntitle      && ntitle      !== t.name)       { t.name       = ntitle;       changed = true; delete t._nlc; }
    if (nartistFull && nartistFull !== t.artistFull) { t.artistFull = nartistFull;  changed = true; }
    if (nartist     && nartist     !== t.artist)     { t.artist     = nartist;      changed = true; delete t._artistKey; delete t._alc; }
    if (nalbum      && nalbum      !== t.album)      { t.album      = nalbum;       changed = true; delete t._albumKey;  delete t._ablc; }
    const ngenre = normTag(tags.genre);
    if (ngenre && ngenre !== t.genre) { t.genre = ngenre; changed = true; delete t._glc; delete t._genreParts; }
    if (!t.genre) { const guessed = guessGenre(t); if (guessed) { t.genre = guessed; changed = true; } }
    // Mettre à jour l'année — y compris la vider si le tag est absent/epoch (nettoyage des 1970 parasites)
    { const ny = _validYear(tags.year); if (ny !== (t.year ?? null)) { t.year = ny; changed = true; } }
    if (tags.track && tags.track !== t.track) { t.track = tags.track; changed = true; }
    if (tags.picture) {
      if (t.art && t.art.startsWith('blob:')) try { URL.revokeObjectURL(t.art); } catch {}
      // Garder les bytes bruts — stockage IDB direct (ArrayBuffer), plus de base64 round-trip
      const buf = tags.picture instanceof ArrayBuffer ? tags.picture : tags.picture.buffer;
      t._artBuf  = buf;
      t._artMime = tags.picMime || 'image/jpeg';
      t._b64     = null; // invalider tout cache base64 existant
      const blob = new Blob([buf], { type: t._artMime });
      t.art = URL.createObjectURL(blob);
      t.artColor = await extractColor(t.art).catch(() => null);
      if (!_trackIdxMap.has(t.id)) { URL.revokeObjectURL(t.art); return; }
      changed = true;
      t.noArt = false;
    } else {
      t.noArt = true;
    }
    // C-3 : stocker les propriétés audio (bitrate, sampleRate, channels, bitDepth)
    if (props) {
      if (props.bitrate     != null) { t.bitrate     = props.bitrate;      changed = true; }
      if (props.sample_rate != null) { t.sampleRate  = props.sample_rate;  changed = true; }
      if (props.channels    != null) { t.channels    = props.channels;     changed = true; }
      if (props.bit_depth   != null) { t.bitDepth    = props.bit_depth;    changed = true; }
    }
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
  const CONCURRENCY = 4;
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
    await new Promise(r => setTimeout(r, 20));
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
  if (!t.art)    return null;
  // Migration : ancienne IDB avec data: URL base64
  if (t.art.startsWith('data:')) {
    const mime = t.art.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
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
      t._artMime = blob.type || 'image/jpeg';
      return { buf: t._artBuf, mime: t._artMime };
    } catch { return null; }
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
  try {
    const transaction = DB.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    for (const rec of validRecords) store.put(rec);
    await new Promise((ok, fail) => {
      transaction.oncomplete = ok;
      transaction.onerror   = () => fail(transaction.error);
    });
  } catch(e) { console.warn('[flushTrackBatch]', e); }
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
}

/**
 * Annule le batch de sauvegarde en attente sans rien écrire en IDB.
 * Utilisé par clearLibrary() pour éviter que des tracks "fantômes" soient
 * réécrites après le vidage de la bibliothèque (race condition timer).
 */
export function cancelTrackBatch() {
  if (_saveTrackTimer) { clearTimeout(_saveTrackTimer); _saveTrackTimer = null; }
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
