// LibreFlow — watchfolder.js
// Surveillance d'un dossier et import automatique des nouveaux fichiers audio.
// Inclut également importPaths() utilisé par m3u.js et le menu "Ouvrir un dossier".
// Extrait de app.js.
//
// Dépendances :
//   import  : invoke, convertFileSrc  (ipc.js)
//   import  : CFG                     (cfg.js)
//   import  : i18n                    (i18n.js)
//   import  : VIRT                    (virt.js)
//   window  : tracks, toast, saveCfg, updateStats, renderLib,
//             loadTagsBg, rebuildTrackIdxMap
//
// Exports publics :
//   initWatchPath, getWatchPath
//   toggleWatchFolder, stopWatchFolder, updateWatchUI
//   importPaths

import { invoke, convertFileSrc, listen } from './ipc.js';
import { CFG }                            from './cfg.js';
import { i18n }                           from './i18n.js';
import { get, notify }                    from './store.js';
import { on, emit, EVENTS }               from './bus.js';
import { VIRT }                           from './virt.js';
import { rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { toast }                          from './ui.js';
import { setView, showView }              from './views.js';
import { loadTagsBg, loadTagsAndDurations } from './library.js';
import { updateStats }                    from './renderer.js';
import { pushTracks }                     from './state.js';

// SEC-9 : Extensions audio autorisées — synchronisé avec la liste de app.js/_onDrop
const _AUDIO_EXTS = new Set(['mp3','flac','aac','m4a','ogg','opus','wav','wma','aiff','ape','alac']);

/** Retourne true si le chemin a une extension audio reconnue. */
function _isAudioPath(p) {
  const ext = p.replace(/\\/g, '/').split('/').pop().split('.').pop().toLowerCase();
  return _AUDIO_EXTS.has(ext);
}

/** SEC-3 : Valide un chemin de dossier — non vide, sans traversal (..) */
function _isValidFolderPath(p) {
  if (!p || typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/');
  // Interdire path traversal et chemins vides
  if (norm.includes('../') || norm.includes('/..') || norm === '..') return false;
  return norm.length > 0;
}

/**
 * Scan initial d'un dossier avec progress bar.
 * Appelé uniquement par toggleWatchFolder() pour le premier import.
 * Le watcher natif utilise importPaths() pour les nouveaux fichiers détectés ensuite.
 * Retourne le nombre de pistes ajoutées.
 */
async function _doInitialScan(files) {
  showView('scan');
  const elSn  = document.getElementById('sn');
  const elSf  = document.getElementById('sf');
  const elBar = document.getElementById('scan-bar');
  const total = files.length;
  if (elSn)  elSn.textContent = '0';
  if (elSf)  elSf.textContent = `${total} fichiers détectés…`;
  if (elBar) elBar.style.width = '0%';

  const YIELD_EVERY = 200;
  const newTracks   = [];
  let   loaded      = 0;
  const scanStart   = Date.now();

  for (const p of files) {
    if (watchSnapshot.has(p)) continue;
    watchSnapshot.add(p);
    const name    = p.replace(/\\/g, '/').split('/').pop();
    const ext     = name.split('.').pop().toUpperCase();
    const bare    = name.replace(/\.[^.]+$/, '');
    const guess   = bare.includes(' - ') ? bare.split(' - ')[0].trim() : '';
    const t = {
      id:          crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${(++_idSeq).toString(36)}`,
      name:        bare.replace(/[-_]+/g, ' ').trim(),
      artist:      guess || i18n('unknown_artist'),
      artistFull:  guess || i18n('unknown_artist'),
      album: '', ext, path: p,
      duration:    0,
      dateAdded:   Date.now(),
      art: null, artColor: null,
      url:         convertFileSrc(p),
      file:        null,
      metaDone:    false,
      _durPending: true,
      bitrate: null, sampleRate: null, channels: null, bitDepth: null,
    };
    newTracks.push(t);
    loaded++;
    if (elSn) elSn.textContent = String(loaded);
    if (elSn && (loaded % 50 === 0 || loaded <= 10)) {
      elSn.classList.remove('pop'); void elSn.offsetWidth; elSn.classList.add('pop');
    }
    if (loaded % YIELD_EVERY === 0 || loaded === total) {
      const pct = Math.round(loaded / total * 100);
      if (elBar) elBar.style.width = pct + '%';
      const elapsed = Date.now() - scanStart;
      if (elapsed > 300 && loaded > 0) {
        const rate   = loaded / elapsed;
        const etaMs  = (total - loaded) / rate;
        const etaS   = Math.ceil(etaMs / 1000);
        const etaStr = etaS >= 60 ? `${Math.floor(etaS / 60)}m ${etaS % 60}s` : `${etaS}s`;
        if (elSf) elSf.textContent = `${loaded} / ${total} • ETA ~${etaStr}`;
      }
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (!newTracks.length) return 0;
  pushTracks(newTracks);
  emit(EVENTS.LIBRARY_UPDATED, { tracks: get('tracks') });
  invalidateFilterCache();
  emit(EVENTS.FILTER_CHANGED, {});
  VIRT._lastListSig = '';
  updateStats();
  setView('all', document.getElementById('ni-all'));
  loadTagsAndDurations(newTracks);
  return newTracks.length;
}

// ARCH-9 : Pruner watchSnapshot quand des tracks sont supprimées.
// On écoute FILTER_CHANGED (émis après toute suppression) et on synchronise
// watchSnapshot avec les chemins actuellement connus dans le store.
on(EVENTS.FILTER_CHANGED, () => {
  if (!watchPath || !watchSnapshot.size) return;
  const currentPaths = new Set(get('tracks').map(t => t.path).filter(Boolean));
  for (const p of watchSnapshot) {
    if (!currentPaths.has(p)) watchSnapshot.delete(p);
  }
});

// ── État interne ─────────────────────────────────────────────
let watchPath     = null;
let watchSnapshot = new Set();
let _watchUnlisten = null; // unlistener Tauri pour 'watch-new-files'
let _starting     = false; // BUG-11 FIX : lock pour empêcher les appels parallèles à startWatchNative
let _importing    = false; // RACE-2 FIX : lock pour empêcher les imports parallèles
let _pendingPaths = [];    // RACE-2 FIX : queue des paths reçus pendant un import en cours
let _idSeq        = 0;     // compteur pour UUID fallback garanti unique
// SEC-10 : rate-limit sur watch-new-files — debounce pour batcher les bursts d'événements
let _watchDebTimer = null;
let _watchRawPaths = [];
let _watchActive  = false; // true si le watcher natif tourne

/** Initialise watchPath depuis la config au démarrage (pas de side-effects). */
export function initWatchPath(path) { watchPath = path; }
/** Retourne watchPath courant (pour _doSaveCfg dans app.js). */
export function getWatchPath() { return watchPath; }

// ── Toggle ───────────────────────────────────────────────────

export async function toggleWatchFolder() {
  let result;
  try {
    result = await Promise.race([
      invoke('open_folder'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('open_folder timeout')), CFG.IPC_TIMEOUT_MS)),
    ]);
  } catch { return; }
  if (!result?.folder) { updateWatchUI(); return; }
  if (!_isValidFolderPath(result.folder)) {
    console.warn('[watchfolder] Chemin de dossier invalide rejeté :', result.folder);
    return;
  }
  // Si un dossier était déjà surveillé, full stop silencieux avant de remplacer
  if (watchPath) stopWatchFolder(true, false);
  watchPath = result.folder;
  invoke('allow_asset_dir', { path: watchPath }).catch(() => {});
  watchSnapshot = new Set(get('tracks').map(t => t.path).filter(Boolean));
  const newFiles = result.files.filter(p => _isAudioPath(p) && !watchSnapshot.has(p));
  if (newFiles.length) {
    const added = await _doInitialScan(newFiles);
    if (!added) toast(i18n('t_already_imported') || 'Déjà importé', 'info');
  }
  await startWatchNative();
  updateWatchUI();
  const shortName = watchPath.split('\\').pop() || watchPath.split('/').pop() || watchPath;
  toast(i18n('t_watch_active', shortName), 'success');
}

/**
 * Démarre la surveillance native via notify (Rust).
 * Remplace le polling setTimeout — zéro CPU en veille, détection immédiate.
 */
export async function startWatchNative() {
  // Nettoyage de l'ancien listener si existant
  if (_watchUnlisten) { _watchUnlisten(); _watchUnlisten = null; }
  if (_starting) return; // BUG-11 FIX : éviter les appels parallèles
  if (!watchPath) return;
  _watchActive = false;   // reset avant toute tentative — évite état stale si la tentative échoue

  _starting = true;
  try {
    // Démarrer le watcher Rust — timeout pour NAS déconnecté ou chemin invalide (IPC-1 FIX)
    await Promise.race([
      invoke('watch_folder_start', { path: watchPath }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('watch_folder_start timeout')), CFG.IPC_TIMEOUT_MS)),
    ]);

    // Écouter les événements émis par Rust quand de nouveaux fichiers audio apparaissent
    // SEC-10 : debounce WATCH_DEBOUNCE_MS pour batcher les bursts d'événements du watcher
    _watchUnlisten = await listen('watch-new-files', (event) => {
      const paths = event.payload;
      if (!Array.isArray(paths) || !paths.length) return;
      // SEC-9 : filtrer par extension audio valide avant tout import
      const newFiles = paths.filter(p => _isAudioPath(p) && !watchSnapshot.has(p));
      if (!newFiles.length) return;
      _watchRawPaths.push(...newFiles);
      if (_watchDebTimer) clearTimeout(_watchDebTimer);
      _watchDebTimer = setTimeout(async () => {
        _watchDebTimer = null;
        const batch = _watchRawPaths.splice(0);
        if (!batch.length) return;
        const added = await importPaths(batch);
        if (added) toast(i18n('t_new_files', added), 'success');
      }, CFG.WATCH_DEBOUNCE_MS);
    });
    _watchActive = true;
  } catch (e) {
    // Fallback : pas de surveillance native — log silencieux
    console.warn('[watchfolder] surveillance native indisponible :', e);
  } finally {
    _starting = false;
  }
}


/**
 * @param {boolean} [silent=false] - Si true, ne montre pas le toast d'arrêt.
 * @param {boolean} [keepPath=false] - Si true, conserve watchPath/watchSnapshot/_importing
 *   pour permettre un redémarrage du watcher sans perdre le contexte.
 */
export function stopWatchFolder(silent = false, keepPath = false) {
  if (_watchUnlisten) { _watchUnlisten(); _watchUnlisten = null; }
  if (_watchDebTimer) { clearTimeout(_watchDebTimer); _watchDebTimer = null; }
  _watchRawPaths = [];
  invoke('watch_folder_stop').catch(() => {});
  _watchActive = false;
  _starting    = false;
  if (!keepPath) {
    watchPath     = null;
    watchSnapshot = new Set();
    _importing    = false;
    // _pendingPaths intentionnellement conservé — voir commentaire BUG-D3B-5 original
  }
  updateWatchUI();
  if (!silent) toast(i18n('t_watch_stopped'));
}

export function updateWatchUI() {
  const indicator = document.getElementById('watch-indicator');
  const label     = document.getElementById('watch-path-label');
  const chk       = document.getElementById('watch-folder-chk');
  const changeBtn = document.getElementById('watch-change-btn');
  if (watchPath) {
    if (indicator) indicator.style.display = 'flex';
    const shortName = watchPath.split('\\').pop() || watchPath.split('/').pop() || watchPath;
    const watchLabel = document.getElementById('watch-label');
    if (watchLabel) watchLabel.textContent = shortName;
    if (label)     label.textContent = watchPath;
    if (chk) chk.checked = _watchActive;
    if (changeBtn) changeBtn.style.display = '';
  } else {
    if (indicator) indicator.style.display = 'none';
    if (label)     label.textContent = i18n('watch_disabled');
    if (chk)       chk.checked = false;
    if (changeBtn) changeBtn.style.display = 'none';
  }
}

// ── Import de chemins ─────────────────────────────────────────

/** Importe une liste de chemins absolus dans la bibliothèque.
 *  Déduplique via watchSnapshot. Retourne le nombre de titres ajoutés.
 *  RACE-2 FIX : si un import est en cours, paths mis en queue → zéro corruption de tracks[]. */
export async function importPaths(paths) {
  if (_importing) {
    // Accumuler — watchSnapshot déduplique dans _doImportPaths, pas de double-ajout
    _pendingPaths.push(...paths);
    return 0;
  }
  _importing = true;
  try {
    let added = await _doImportPaths(paths);
    // Drainer la queue accumulée pendant cet import
    while (_pendingPaths.length) {
      const pending = _pendingPaths.splice(0);
      added += await _doImportPaths(pending);
    }
    return added;
  } finally {
    _importing = false;
  }
}

async function _doImportPaths(paths) {
  let added = 0;
  const tracks = get('tracks'); // Phase 4
  // RACE-4 FIX : déduplication intra-batch — si `paths` contient des doublons
  // (ex. scan initial + premier événement watcher en chevauchement), watchSnapshot
  // ne les attrape pas encore au moment du second tour de boucle.
  const seenInBatch = new Set();
  for (const p of paths) {
    if (watchSnapshot.has(p) || seenInBatch.has(p)) continue;
    seenInBatch.add(p);
    watchSnapshot.add(p);
    const name = p.replace(/\\/g, '/').split('/').pop();
    const ext  = name.split('.').pop().toUpperCase();
    const t = {
      id:         crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${(++_idSeq).toString(36)}`,
      name:       name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      artist:     i18n('unknown_artist'),
      artistFull: i18n('unknown_artist'),
      album: '', ext, path: p,
      duration: 0, dateAdded: Date.now(),
      art: null, artColor: null,
      url:      convertFileSrc(p),
      file:     null,
      metaDone: false,
      // Bug #16 fix : initialiser les champs audio à null comme les imports drag-drop.
      // Sans ça, le badge LOSSLESS et les infos audio restent indéfinis (undefined ≠ null).
      bitrate: null, sampleRate: null, channels: null, bitDepth: null,
    };
    tracks.push(t);
    loadTagsBg(t);
    added++;
  }
  if (added) {
    rebuildTrackIdxMap();
    notify('tracks'); // BUG-C2 FIX : push() in-place → force-notifie les subscribers
    if (VIRT) VIRT._lastListSig = '';
    updateStats();
    const niAll = document.getElementById('ni-all');
    setView('all', niAll ?? null);
  }
  return added;
}

export async function changeWatchFolder() {
  const prevPath     = watchPath;
  const prevSnapshot = new Set(watchSnapshot);
  stopWatchFolder(true);
  await toggleWatchFolder();
  if (!watchPath && prevPath) {
    watchPath     = prevPath;
    watchSnapshot = prevSnapshot;
    await startWatchNative();
    updateWatchUI();
  }
}
