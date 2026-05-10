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
import { CFG }                    from './cfg.js';
import { i18n }                   from './i18n.js';
import { get, notify }             from './store.js'; // Phase 4
import { on, EVENTS }              from './bus.js'; // ARCH-9 : écouter les suppressions de tracks
import { VIRT }                   from './virt.js';
import { rebuildTrackIdxMap }      from './search.js';
import { toast }                                        from './ui.js';
import { setView } from './views.js';
import { loadTagsBg } from './library.js';
import { updateStats } from './renderer.js';

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

/** Initialise watchPath depuis la config au démarrage (pas de side-effects). */
export function initWatchPath(path) { watchPath = path; }
/** Retourne watchPath courant (pour _doSaveCfg dans app.js). */
export function getWatchPath() { return watchPath; }

// ── Toggle ───────────────────────────────────────────────────

export async function toggleWatchFolder() {
  if (watchPath) {
    stopWatchFolder();
  } else {
    // IPC-2 FIX : timeout sur open_folder — dialog système bloquée = hang infini sans ça
    let result;
    try {
      result = await Promise.race([
        invoke('open_folder'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('open_folder timeout')), CFG.IPC_TIMEOUT_MS)),
      ]);
    } catch { return; } // timeout ou annulation → pas d'action
    if (!result?.folder) return;
    // SEC-3 : valider le chemin avant d'étendre le scope Tauri — rejeter les paths vides ou traversaux
    if (!_isValidFolderPath(result.folder)) {
      console.warn('[watchfolder] Chemin de dossier invalide rejeté :', result.folder);
      return;
    }
    watchPath = result.folder;
    // SEC : étendre explicitement l'asset protocol scope à ce dossier (défense en profondeur)
    invoke('allow_asset_dir', { path: watchPath }).catch(() => {});
    // Initialiser le snapshot depuis TOUS les tracks connus
    watchSnapshot = new Set(get('tracks').map(t => t.path).filter(Boolean));
    // Scanner immédiatement pour les fichiers déjà présents (SEC-9 : filtrer par extension audio)
    const newFiles = result.files.filter(p => _isAudioPath(p) && !watchSnapshot.has(p));
    if (newFiles.length) await importPaths(newFiles);
    await startWatchNative();
    updateWatchUI();
    toast(i18n('t_watch_active',
      watchPath.split('\\').pop() || watchPath.split('/').pop() || watchPath), 'success');
  }
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
  } catch (e) {
    // Fallback : pas de surveillance native — log silencieux
    console.warn('[watchfolder] surveillance native indisponible :', e);
  } finally {
    _starting = false;
  }
}


export function stopWatchFolder() {
  // Arrêter le listener Tauri
  if (_watchUnlisten) { _watchUnlisten(); _watchUnlisten = null; }
  // Annuler le debounce SEC-10 et vider le batch en attente
  if (_watchDebTimer) { clearTimeout(_watchDebTimer); _watchDebTimer = null; }
  _watchRawPaths = [];
  // Arrêter le watcher Rust (fire-and-forget — pas bloquant)
  invoke('watch_folder_stop').catch(() => {});
  watchPath     = null;
  watchSnapshot = new Set(); // reset pour permettre la réimportation après clearLibrary
  _importing    = false;
  // _pendingPaths intentionnellement conservé — les chemins en attente se drainent
  // via le while(_pendingPaths.length) dans importPaths(). Les supprimer ici causerait
  // une perte silencieuse de fichiers reçus pendant un import en cours (BUG-D3B-5).
  _starting     = false;
  updateWatchUI();
  toast(i18n('t_watch_stopped'));
}

export function updateWatchUI() {
  const indicator = document.getElementById('watch-indicator');
  const label     = document.getElementById('watch-path-label');
  const btnLabel  = document.getElementById('watch-btn-label');
  if (watchPath) {
    if (indicator) indicator.style.display = 'flex';
    const shortName = watchPath.split('\\').pop() || watchPath.split('/').pop() || watchPath;
    const watchLabel = document.getElementById('watch-label');
    if (watchLabel) watchLabel.textContent = shortName;
    if (label)    label.textContent = watchPath;
    if (btnLabel) btnLabel.textContent = i18n('set_watch_btn_off');
  } else {
    if (indicator) indicator.style.display = 'none';
    if (label)    label.textContent = i18n('watch_disabled');
    if (btnLabel) btnLabel.textContent = i18n('set_watch_btn_on');
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
