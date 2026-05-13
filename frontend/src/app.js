// @ts-nocheck
// LibreFlow — Main application
import { invoke, invokeRetry, listen, convertFileSrc } from './ipc.js';
import { audio, playAt, prev, next, togglePlay, buildQ,
         toggleShuffle, toggleRepeat, toggleLike, likeat,
         setIcon, setSpeed, setCrossfade, initCrossfadeAudio,
         clearCrossfadeTimers, getNextIdx, ensureUrl,
         initMediaSession, updateMediaSession, updateMediaSessionState,
         checkCrossfade, setManualQueue, resetShuffleQ,
         adjustShuffleQAfterDelete, setBootVizState }       from './player.js';
import { emit, on, EVENTS }                                from './bus.js';
import { get, set, notify, subscribe, setBatch }           from './store.js';
import { CFG, SORTS, SLBLS, SPEEDS, SPEED_LBLS } from './cfg.js';
import { openDB, tx, dget, dall, dput, ddel, DB, getStorageEstimate } from './db.js';
import { readTags, extractColor, GENRE_ARTISTS, GENRE_KEYWORDS, guessGenre } from './tags.js';
import { LANGS, i18n, initLang, getLang, applyLang, setLang } from './i18n.js';
import { cinemaOpen, cinemaBg, initCinemaBg, toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress, setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn, toggleCinemaFullscreen, CINEMA_BG_MODES, CINEMA_BG_LABELS, updateCinArtColor } from './cinema.js';
import { queueOpen, toggleQueue, closeQueue, renderQueue, playQueueItem, clearQueueOverride, addToQueueNext, addToQueueEnd, refreshQueueBadge, getQueueState, restoreQueueState } from './queue.js';
import { exportM3U, importM3U } from './m3u.js';
import { VIRT } from './virt.js';
import { playLog, setPlayLog, logPlay, flushPlayLog, cancelPlayLogFlush } from './playlog.js';
import { eqCtx, eqSource, eqNodes, eqEnabled, eqOpen, initEQ, ensureEQResumed, toggleEQ, closeEQ, renderEQBands, setEQBand, applyEQPreset, eqAutoMode, setEQAutoMode, toggleEQAutoMode, loadEQProfiles, getEQProfiles, applyGenreEQ, startSmartEQ, stopSmartEQ, updateSmartEQLoudness, updateSmartEQGenre, filterEQPresets, toggleEQAB, initBootEQ, getActiveEqPreset, masterGainNode, setMasterGain } from './eq.js';
import { initViz, startViz, stopViz, updateVizColor, setVizMode, getVizMode, setVizEnabled, getVizEnabled } from './viz.js';
import { sleepFading, setSleepFading, sleepEndOfTrack, toggleSleepMenu, setSleepTimer, setSleepEndOfTrack, setSleepCustom, cancelSleepTimer } from './sleep.js';
import { esc, fmt, fmtd, extEmoji, normTag, mainArtist } from './utils.js';
import { radioActive, startRadio, stopRadio, resetRadio, radioRefillQueue, toggleRadio, ctxStartRadio, radioRegenerateFromCurrent, radioSaveAsPlaylist, getRadioQueue, renderRadioView, openRadioView, syncRadioLibBar, getRadioSeedId, initRadioSeedId } from './radio.js';
import { initWatchPath, getWatchPath, toggleWatchFolder, stopWatchFolder, updateWatchUI, importPaths, startWatchNative } from './watchfolder.js'; // Bug #7 fix : startWatchNative ajouté
import { renderStats, getHeatPeriod, initHeatPeriod } from './stats.js';
import { switchPlTab, openSmartPlaylistModal, _setSmartSeed, smartSeedSearch, smartPreview, confirmSmartPlaylist, regenerateSmartPlaylist } from './smartplaylist.js';
import { detectDupes, removeDupeTrack, deleteAllDupes, closeDupes } from './dupes.js';
import { checkOrphans } from './orphans.js';
import { selection, selectionMode, clearSelection, toggleTrackSelection, selAddToPlaylist, selAddBatch, selToggleLike, selRemove, selBatchTagEdit, closeBatchTagModal, confirmBatchTagEdit } from './selection.js';
import { toggleMiniPlayer, updateMiniPlayer, updateMiniProgress, resetMiniProgressThrottle, setMiniPos, getMiniPos } from './miniplayer.js';
import { toggleMiniOverlay, syncMiniOverlay, updateMiniOverlayProgress, initMiniOverlayDrag } from './minioverlay.js';
import { rgEnabled, rgTargetLUFS, initRgState, initRG, setReplayGain, setRGTarget, analyzeAndApplyRG, applyRGGain, cancelRgAnalysis } from './replaygain.js';
import { openTagEditor, saveTagEdit, cancelTagEdit } from './tagedit.js';
import { toast, toastWithAction, confirmAction, resolveConfirm, initRipple } from './ui.js';
import { checkForUpdate, checkForUpdateManual, initAppVersion } from './updater.js';
import { getFiltered, filteredIdx, rebuildTrackIdxMap, trackIdx, invalidateFilterCache,
         _trackIdxMap }    from './search.js';
import { openFolder, loadTagsAndDurations, loadTagsBg, rescanTags,
         saveTrack, saveTracks, saveTrackNow, flushTrackBatch,
         cancelTrackBatch }                                           from './library.js';
import { renderGenresGrid, drillGenre, setContentView, rescanGenres, invalidateGenreGridSig } from './genres.js';
import {
  savePlaylists, renderPlNav, setupPlNavDrop,
  renderPlHero, setPlSort, setPlModalMode,
  openNewPlaylistModal, openRenamePlaylistModal, closePlModal, confirmPlaylistModal,
  deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist,
  showPlCtxMenu, ctxPlayPlaylist, ctxShufflePlaylist,
  showPlQuickPop, closePlQuickPop, pqpAdd, pqpNew,
  onTrackDragStart, onPlNavDragStart,
  togglePinPlaylist, movePlToFolder, removePlFromFolder,
  togglePlFolder, showPlFolderCtxMenu, renamePlFolder, deletePlFolder,
  // S157 FIX-1 : onPlFolderDragOver/Leave/Drop retirés des imports — code mort.
  // Le drag-drop folder est entièrement géré par event delegation dans setupPlNavDrop()
  // (cf. data-folder-drop-id sur .pl-folder-h). Plus aucun handler inline ondragover=…
  onPlCoverSelected, clearPlCover, trapFocus,
  _plHeroInlineRename, _plNavInlineRename,
  _attachPlaylistReorder, _detachPlaylistReorder,
  playPlaylistFrom, playPlaylistDirect, shufflePlaylist,
} from './playlists.js';
export { playPlaylistFrom, playPlaylistDirect, shufflePlaylist }; // re-export (handlers.js backward compat)

import { initWaveform, wfLoad, wfClear } from './waveform.js';
import { toggleNowPlaying, closeNowPlaying, updateNowPlaying } from './nowplaying.js';
import {
  initSettingsVars, getTheme, getDynColor, getDisplayMode, isShortcutsOpen,
  switchSetTab, openSettings, closeSettings,
  setTheme, applyTheme, setDynColor,
  applyArtColor, clearArtColor, animateArtChange, _updateArtBlur,
  closeShortcuts, toggleShortcuts,
  setMode, toggleMode,
  _syncVizBtns,
} from './settings.js';
import {
  _showViewRaw, showView, goHome, setView, onSearch, nextSort,
  nextAlbumSort, nextArtistSort, nextGenreSort,
  statsGoToGenre, statsGoToArtist, statsGoToAlbum,
} from './views.js';
export { statsGoToGenre, statsGoToArtist, statsGoToAlbum }; // re-export (backward compat)
import { _showSkeletonRows,
         virtRenderWindow, virtAttachScroll,
         renderLib, renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid,
         drillDown, updatePlActionBar, updateBreadcrumb,
         makeLikeBtn, makeAddBtn, makeEqHTML, artPlaceholder, hlText, thtml,
         playById, patchActiveTrack, patchPlayState, patchTrackEl,
         scheduleStatsUpdate, updateStats,
         _withVT, animateViewChange, scrollToCurrentTrack } from './renderer.js';
// ── allplayerui.js (ARCH-1) ──────────────────────────────────────────────────
import { _allPlayerUI } from './allplayerui.js';
export { _allPlayerUI }; // re-export pour handlers.js
import { showCtxMenu, closeCtxMenu, ctxToggleLike, ctxDeleteTrack, ctxEditTags, ctxGoToArtist, ctxGoToAlbum, ctxNewPlaylist, ctxRemoveFromPlaylist, ctxSmartPlaylist, ctxPlayNext, ctxAddToQueueEnd, ctxCopyInfo } from './ctxmenu.js';
import { initDrop } from './dropin.js';
import { initKeyNav } from './keynav.js';
import { initShortcuts } from './shortcuts.js';
import { confirmClear, closeModal } from './modal.js';
export { confirmClear, closeModal }; // re-export pour handlers.js
import { updateBar, updateVolSlider, setupMarquee } from './playerbar.js';
export { updateBar, updateVolSlider }; // re-exports pour library.js, selection.js, tagedit.js, handlers.js
// ── cfgsave.js (ARCH-1) ──────────────────────────────────────────────────────
import { saveCfg, saveCfgNow } from './cfgsave.js';
export { saveCfg, saveCfgNow }; // re-exports pour cinema.js, ctxmenu.js, player.js, etc.
// ── state.js (ARCH-1) ────────────────────────────────────────────────────────
import { setCurIdx, setTracks, setLiked, setCtxTrackId } from './state.js';
export { setCurIdx, setTracks, setLiked, setCtxTrackId }; // re-exports (backward compat)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Retourne l'année si elle est plausible (1900–2100), null sinon.
 *  Note : les faux-1970 (TDRC="1970-01-01T00:00:00") sont filtrés en amont dans tags.js. */
function validYear(y) {
  const n = Number(y);
  return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null;
}

// ── JSDoc type definitions ────────────────────────────────────────────────────

/**
 * A music track stored in the 'tracks' IDB store.
 * @typedef {object} Track
 * @property {string}       id          - Unique ID (hash of path)
 * @property {string}       name        - Track title
 * @property {string}       artist      - Main artist (first before feat./&)
 * @property {string}       artistFull  - Full artist string incl. featuring
 * @property {string}       album       - Album name
 * @property {string}       path        - Absolute OS path
 * @property {string}       ext         - File extension (flac, mp3, …)
 * @property {number}       duration    - Duration in seconds
 * @property {number}       dateAdded   - Unix timestamp (ms) when added
 * @property {string|null}  art         - Base64-encoded album art (JPEG/PNG) or null
 * @property {string|null}  artColor    - Dominant colour hex extracted from art
 * @property {string|null}  genre       - Guessed or tagged genre
 * @property {boolean}      liked       - In-memory liked flag (rebuilt from IDB on load)
 * @property {boolean}      metaDone    - True once tags have been fully loaded
 * @property {string|null}  url         - asset:// URL (set on first play, null until then)
 * @property {File|null}    file        - Temporary File object during tag loading, null afterward
 * @property {number|undefined} rgGain  - ReplayGain track gain in dB, if analysed
 */

/**
 * A user-created playlist.
 * @typedef {object} Playlist
 * @property {string}   id        - UUID
 * @property {string}   name      - Display name
 * @property {string[]} trackIds  - Ordered array of Track ids
 * @property {boolean}  [smart]   - True if this is a smart playlist
 * @property {object}   [rules]   - Smart playlist filter rules
 */

/**
 * A play-log entry persisted in the 'playlog' IDB store.
 * @typedef {object} PlaylogEntry
 * @property {number} ts   - Timestamp of play start (Date.now())
 * @property {string} id   - Track id
 * @property {number} dur  - Seconds actually played
 */




// ══ State ══════════════════════════════════════
// audio + _DOM sont dans player.js (importé ci-dessus)
let tracks  = [];       // full track array
let liked   = new Set();
let curIdx  = -1;
let shuffle    = false;    // shuffleQ est dans player.js
let repeat     = 'none';  // none | all | one
let _autoUpdate = true;
let sort    = 'az';
let view    = 'all';
let drillKey         = '';
let drillFrom        = '';
let drillDisplayName = ''; // nom d'affichage propre (≠ fuzzy key minuscule) pour le breadcrumb
let playlists   = [];   // [{ id, name, trackIds:[], folderId?, pinned?, coverB64?, smart?, ... }]
let curPlId     = null; // currently viewed playlist id
let recentPlays = [];   // [trackId, ...] max 50, most recent first
// S91 — Vague A : organisation des playlists
let plFolders   = [];   // [{ id, name, collapsed, order }]
let recentPls   = [];   // [plId, ...] max 5, most recent first (piste « Récemment écoutées »)
// S92 — Tri des titres dans une playlist ('manual'|'az'|'za'|'artist'|'album'|'duration')
let plSort      = 'manual'; // lu depuis pl.sort au chargement, réinitialisé par setPlSort()
// playLog, logPlay, flushPlayLog → playlog.js
// selection, selectionMode, _selAnchorId → selection.js
let ctxTrackId  = null; // track id for context menu
// plModalMode → playlists.js (setPlModalMode export)
let query   = '';
// _recentFilterToastShown et _queueEndedToastShown → player.js

// ══ Variables déclarées ici pour éviter ReferenceError (utilisées avant leur section) ══
// _coll → search.js (importé ci-dessus)
// radioActive, radioSeedId, radioQueue, _radioPlayedIds → radio.js
// _lastNotifTrackId → playerbar.js (moved CQ-2)
// _saveCfgTimer → cfgsave.js (moved ARCH-1)
let _retryArtTimer    = null; // FIX #21 — annulable dans clearLibrary()
let _orphansTimer     = null; // FIX #22 — annulable dans clearLibrary()
// _pqpTrackId, _dragTrackId → playlists.js
// _smartSeedId → smartplaylist.js
// lang → i18n.js (initLang / getLang)
let crossfadeDur = 0;
// cfFadeTimer, cfNextTimer, _cfRafId, _cfGen, audioNext, audioNextSource,
// audioNextGain, _gaplessNextIdx → player.js
// queueOpen, _ptrState → queue.js
let manualQueue       = [];
// eqOpen, eqCtx, eqSource, eqNodes → eq.js
// cinemaOpen, cinemaBg, cinemaHideTimer → cinema.js
// eqEnabled → eq.js
// rgEnabled, rgTargetLUFS, rgGainNode → replaygain.js
// watchPath, watchInterval, watchSnapshot → watchfolder.js
let albumSort         = 'name';   // 'name' | 'count' | 'duration'
let artistSort        = 'name';   // 'name' | 'count'
let genreSort         = 'count';  // 'count' | 'name'
const _unlisteners    = [];        // Tauri listeners — collected for cleanup on pagehide
// Signatures de cache pour les grilles — évite de recalculer si rien n'a changé
// _genreGridSig → genres.js (Jalon 5)

// _PSC, _albumMapCache, _artistMapCache → search.js (importés ci-dessus)
// _saveTrackBatch, _saveTrackTimer, _scanInProgress → library.js
let albumDetailSort   = 'track';  // 'track' | 'az' — tri dans la vue détail album
// dupesGroups → dupes.js
// sleepTimerEnd, sleepTickTimer, sleepFading → sleep.js
// _playLogFlushTimer → playlog.js
let playbackSpeed     = 1;

// ── Sync des vars locales depuis le store (mises à jour par player.js) ────────
// Ces abonnements maintiennent les variables locales d'app.js en phase avec
// l'état canonique écrit par player.js, sans casser les fonctions existantes
// qui lisent encore ces variables directement.
subscribe('curIdx',          v => { curIdx          = v; });
subscribe('shuffle',         v => { shuffle         = v; });
subscribe('repeat',          v => { repeat          = v; });
subscribe('manualQueue',     v => { manualQueue     = v; });
subscribe('recentPlays',     v => { recentPlays     = v; });
subscribe('playbackSpeed',   v => { playbackSpeed   = v; });
subscribe('crossfadeDur',    v => { crossfadeDur    = v; });
// ARCH-1 — state.js setters write to store only; subscriptions keep local vars in sync
subscribe('liked',        v => { liked      = v; });
subscribe('tracks',       v => { tracks     = v; });
subscribe('ctxTrackId',   v => { ctxTrackId = v; });
// Jalon 5 — sync des vars locales depuis le store (genres.js, future extraction)
subscribe('drillFrom',        v => { drillFrom        = v; });
subscribe('drillDisplayName', v => { drillDisplayName = v; });
subscribe('genreSort',        v => { genreSort        = v; });
subscribe('albumSort',        v => { albumSort        = v; });
subscribe('artistSort',       v => { artistSort       = v; });
subscribe('plFolders',        v => { plFolders        = v; });
subscribe('recentPls',        v => { recentPls        = v; });
// Views.js — synchro vars locales depuis le store
subscribe('view',             v => { view             = v; });
subscribe('sort',             v => { sort             = v; });
subscribe('query',            v => { query            = v; });
subscribe('curPlId',          v => { curPlId          = v; });
subscribe('plSort',           v => { plSort           = v; });
subscribe('drillKey',         v => { drillKey         = v; });
subscribe('albumDetailSort',  v => { albumDetailSort  = v; });

// ── Bus event handlers ────────────────────────────────────────────────────────
// TRACK_CHANGE : player.js a démarré une nouvelle piste → mettre à jour l'UI
on(EVENTS.TRACK_CHANGE, ({ track, idx }) => {
  updateBar(); patchActiveTrack(); _allPlayerUI();
});
// PLAY_STATE : play ou pause → mettre à jour la ligne active + widgets
on(EVENTS.PLAY_STATE, ({ playing }) => {
  patchPlayState(playing); _allPlayerUI();
});
// RENDER_LIB : demande de re-rendu émise par player.js (ex: toggle like)
// Jalon 4 — évite window.renderLib() dans les satellites
on(EVENTS.RENDER_LIB, () => renderLib());
// LIBRARY_UPDATED : enable/disable taskbar thumbnail buttons based on track count
on(EVENTS.LIBRARY_UPDATED, ({ tracks }) => {
  invoke('taskbar_set_has_tracks', { hasTracks: tracks.length > 0 }).catch(e => { console.warn('[taskbar] taskbar_set_has_tracks failed:', e); });
});

// ══ Boot ═══════════════════════════════════════

/**
 * Application entry point.
 * Initialises IndexedDB, restores persisted configuration, loads saved
 * tracks and playlists from IDB, then renders the UI.
 * Called once by DOMContentLoaded at the bottom of this file.
 *
 * @returns {Promise<void>}
 */

/**
 * Affiche un skeleton pendant le chargement de la DB.
 * Appelé uniquement si cfg existe (app déjà utilisée → DB non vide).
 * Adapte le skeleton au type de vue sauvegardée (tracks / albums / artistes / genres).
 * renderLib() efface tout et affiche le vrai contenu quand les données arrivent.
 * @param {string} [savedView] — valeur de cfg.view au dernier arrêt
 */
/**
 * Initialise la langue, le mode d'affichage et les widgets UI communs au boot,
 * que la bibliothèque soit chargée (cfgObj non null) ou que l'écran de bienvenue
 * soit affiché (cfgObj null ou incomplet). Extrait pour éliminer la duplication
 * entre les deux branches du boot (PERF-BOOT Fix B).
 * @param {object|null} cfgObj — objet cfg tel que lu depuis IDB (peut être null)
 */
function _applyBootUI(cfgObj) {
  applyLang();
  setMode(getDisplayMode());
  document.getElementById('pc-shuf')?.classList.toggle('on', shuffle);
  document.getElementById('pc-shuf')?.setAttribute('aria-pressed', String(shuffle));
  document.getElementById('pc-rep')?.classList.toggle('on', repeat !== 'none');
  document.getElementById('pc-rep')?.setAttribute('aria-pressed', String(repeat !== 'none'));
  if (getWatchPath()) updateWatchUI();
  setTimeout(updateVolSlider, 100);
  if (playbackSpeed !== 1) setSpeed(playbackSpeed);
  const rgChk = document.getElementById('rg-enabled');
  if (rgChk) rgChk.checked = rgEnabled;
  const rgSlider = document.getElementById('rg-target');
  if (rgSlider) rgSlider.value = rgTargetLUFS;
  const rgLbl = document.getElementById('rg-target-lbl');
  if (rgLbl) rgLbl.textContent = rgTargetLUFS + ' LUFS';
  const autoUpdateChk = document.getElementById('auto-update-chk');
  if (autoUpdateChk) {
    _autoUpdate = cfgObj?.autoUpdate !== false;
    set('autoUpdate', _autoUpdate); // ARCH-1 : sync store → cfgsave.js peut lire via get()
    autoUpdateChk.checked = _autoUpdate;
    autoUpdateChk.addEventListener('change', () => {
      _autoUpdate = autoUpdateChk.checked;
      set('autoUpdate', _autoUpdate); // ARCH-1 : sync store
      saveCfg();
    });
  }
  const checkUpdateBtn = document.getElementById('check-update-btn');
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener('click', () => checkForUpdateManual(checkUpdateBtn));
  }
}

async function boot() {
  // R-2 : health check IDB — si la DB est corrompue ou bloquée, openDB() rejette.
  // Sans ce try/catch, l'erreur part en UnhandledPromiseRejection → crash silencieux.
  try {
    await openDB();
  } catch(e) {
    console.error('[boot] IDB failed to open:', e);
    // Afficher une bannière d'erreur dans l'UI (toast pas encore disponible à ce stade)
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#111;color:#f55;font-size:1.1rem;text-align:center;padding:2rem">
        Base de données corrompue ou inaccessible.<br>
        Essayez de relancer l&rsquo;application.<br>
        Si le problème persiste, effacez les données de l&rsquo;app.
      </div>`);
    return;
  }
  // ARCH-7 : vérifier le quota IDB au boot — avertir si > 80% utilisé
  getStorageEstimate().then(est => {
    if (!est || !est.quota) return;
    const pct = est.usage / est.quota;
    if (pct > 0.9) {
      toast(
        `Stockage utilisé à ${Math.round(pct * 100)}% — libérez de l'espace disque pour éviter la perte de données.`,
        'error'
      );
    } else if (pct > 0.8) {
      toast(
        `Stockage utilisé à ${Math.round(pct * 100)}% — pensez à libérer de l'espace disque.`,
        'warning'
      );
    }
  }).catch(() => {});

  // Load config
  const cfg = await dget('cfg','state').catch(()=>null);
  if (cfg) {
    // Restaurer liked directement par IDs de pistes (Set<string>)
    // cfg.likedIds = array de track.id (source de vérité depuis session 138+)
    // cfg.liked (ancien format : indices) ignoré — périmé depuis la migration
    liked = new Set(Array.isArray(cfg.likedIds) ? cfg.likedIds : []);
    set('liked', liked);
    sort        = cfg.sort||'az';   set('sort', sort);
    // Toutes les vues persistées sont valides, y compris les drill-downs
    const safeViews = ['all','liked','albums','artists','genres','recent','playlist','stats','album-detail','artist-detail','genre-detail'];
    view = safeViews.includes(cfg.view) ? cfg.view : 'all'; set('view', view);
    if (cfg.curPlId)   { curPlId  = cfg.curPlId;  set('curPlId', curPlId); }
    if (cfg.drillKey)  { drillKey = cfg.drillKey; set('drillKey', drillKey); drillFrom = cfg.drillFrom || ''; drillDisplayName = cfg.drillDisplayName || ''; set('drillFrom', drillFrom); set('drillDisplayName', drillDisplayName); }
    recentPlays = cfg.recentPlays||[];  set('recentPlays', recentPlays);
    // S91 — Vague A : organisation playlists
    if (Array.isArray(cfg.plFolders)) { plFolders = cfg.plFolders; set('plFolders', plFolders); }
    if (Array.isArray(cfg.recentPls)) { recentPls = cfg.recentPls.slice(0, 5); set('recentPls', recentPls); }
    // Modules persist — restauration anticipée (avant les tracks)
    if (cfg.heatPeriod)  initHeatPeriod(cfg.heatPeriod);
    if (cfg.radioSeedId) initRadioSeedId(cfg.radioSeedId);
    initLang(cfg.lang||'fr');
    initSettingsVars({
      theme:       cfg.theme || 'blue',
      dynColor:    cfg.dynColor !== false,
      displayMode: cfg.displayMode || 'dark',
    });
    set('displayMode', cfg.displayMode || 'dark');
    crossfadeDur  = cfg.crossfadeDur||0;  set('crossfadeDur', crossfadeDur);
    initRgState(cfg.rgEnabled !== false, cfg.rgTargetLUFS||-14);
    if (cfg.playbackSpeed && SPEEDS.includes(cfg.playbackSpeed)) {
      playbackSpeed = cfg.playbackSpeed;
      set('playbackSpeed', playbackSpeed);
      // ERG-3 : pré-initialiser le bouton avant tout repaint pour éviter le flash "1×"
      if (playbackSpeed !== 1) {
        const _bspd = document.getElementById('btn-speed');
        if (_bspd) _bspd.textContent = playbackSpeed + '×';
      }
    }
    if (cfg.cinemaBg) {
      // Migration : anciens modes → nouveaux modes
      const _bgMigration = { solid: 'amoled', none: 'ambient', blur: 'ambient' };
      initCinemaBg(_bgMigration[cfg.cinemaBg] || cfg.cinemaBg);
    }
    // Restaurer état playback
    if (cfg.shuffle)   { shuffle = true; set('shuffle', true); }
    if (cfg.repeat && ['none','all','one'].includes(cfg.repeat)) { repeat = cfg.repeat; set('repeat', repeat); }
    if (cfg.albumSort       && ['name','duration','count','year'].includes(cfg.albumSort))    { albumSort       = cfg.albumSort;       set('albumSort',       albumSort); }
    if (cfg.artistSort      && ['name','count'].includes(cfg.artistSort))              { artistSort      = cfg.artistSort;      set('artistSort',      artistSort); }
    if (cfg.genreSort       && ['count','name'].includes(cfg.genreSort))               { genreSort       = cfg.genreSort;       set('genreSort',       genreSort); }
    if (cfg.albumDetailSort && ['track','az'].includes(cfg.albumDetailSort))           { albumDetailSort = cfg.albumDetailSort; set('albumDetailSort', albumDetailSort); }
    // EQ : sera appliqué après initEQ() (les nodes n'existent pas encore)
    initBootEQ(cfg.eqGains, cfg.eqEnabled, cfg.eqPreset);
    setBootVizState(cfg.vizMode, cfg.vizEnabled === false);
    if (cfg.eqAutoMode)  setEQAutoMode(true);
    if (cfg.eqProfiles)  loadEQProfiles(cfg.eqProfiles);
    // Watch folder : restaurer le chemin ET relancer la surveillance native.
    // Bug #7 fix : initWatchPath() seul restaure le chemin mais ne relance pas le watcher.
    // La surveillance était inactive jusqu'au prochain clic sur le bouton.
    if (cfg.watchPath) {
      initWatchPath(cfg.watchPath);
      startWatchNative().catch(() => {}); // fire-and-forget — timeout géré dans startWatchNative
    }
    // Position mini-player
    setMiniPos(cfg.miniPos ?? null);
    // Volume : restaurer avant updateVolSlider()
    if (cfg.volume !== undefined) {
      const _volEl = document.getElementById('vol');
      if (_volEl) {
        _volEl.value = cfg.volume;
        // DSP-5 : setMasterGain — masterGainNode sera initialisé par initEQ() ensuite
        // Si EQ déjà prêt, met à jour le gain; sinon audio.volume = cfg.volume comme fallback
        setMasterGain(cfg.volume);
      }
    }
    // Position mini-overlay flottant
    if (cfg.miniOvPos) {
      const _ovEl = document.getElementById('mp-ov');
      if (_ovEl) {
        _ovEl.style.right  = 'auto';
        _ovEl.style.bottom = 'auto';
        _ovEl.style.left   = cfg.miniOvPos.x + 'px';
        _ovEl.style.top    = cfg.miniOvPos.y + 'px';
      }
    }
  }
  // PERF : charger playlists, playlog et tracks EN PARALLÈLE (était séquentiel → 3× plus lent)
  // Les trois stores sont indépendants — aucun n'a besoin que l'autre soit chargé en premier.
  // Afficher le skeleton adapté à la vue sauvegardée (albums/artistes/genres/liste)
  if (cfg) _showSkeletonRows(cfg.view);
  const [savedPl, savedLog, saved] = await Promise.all([
    dall('playlists').catch(()=>[]),
    dall('playlog').catch(()=>[]),
    dall('tracks').catch(()=>[]),
  ]);
  if (savedPl) {
    playlists = savedPl; set('playlists', playlists); renderPlNav(); setupPlNavDrop();
    // S92 FIX — restaurer le tri de la playlist active (curPlId déjà résolu depuis cfg)
    if (curPlId) {
      const _sp = playlists.find(p => p.id === curPlId);
      if (_sp) { plSort = _sp.sort || 'manual'; set('plSort', plSort); } // FIX #29
    }
  }
  setPlayLog(savedLog || []);
  // sort label applied in applyLang()
  if (saved && saved.length > 0) {
    // FIX BUG 4: tracks from DB have no blob URL → must be loaded on demand
    // We store them but flag them as needing file load
    // PERF-BOOT : traitement par tranches de 500 — évite le blocage main-thread sur grandes bibliothèques
    const _BOOT_CHUNK = 500;
    const _tracksArr = [];
    for (let _bi = 0; _bi < saved.length; _bi += _BOOT_CHUNK) {
      const _slice = saved.slice(_bi, _bi + _BOOT_CHUNK);
      for (const r of _slice) {
        // Re-apply mainArtist on load to fix any old bad data in DB
        const artistFull = r.artistFull || r.artist || i18n('unknown_artist');
        const artist     = mainArtist(artistFull) || artistFull;
        _tracksArr.push({
          id: r.id, name: r.name,
          artist,            // canonical main artist
          artistFull,        // full string incl. featuring
          album: r.album,
          ext: r.ext, path: r.path, duration: r.duration,
          dateAdded: r.dateAdded,
          // ARCH-2/PERF-1 : artwork chargé paresseusement via artLoader.js (LRU 60 entrées).
          // On stocke uniquement un flag booléen au boot pour éviter 200-400 MB de RAM.
          // artLoader.prefetchArts() est appelé par virtRenderWindow() après chaque rendu.
          art:      null,
          _hasArt:  !!(r.artBuf || r.artB64),
          _artBuf:  null,
          _artMime: r.artMime || null,
          artColor: r.artColor || null,
          url: null, file: null,
          genre: r.genre || null,
          year:  validYear(r.year),
          track: r.track || null,
          liked: false, metaDone: true,
          noArt:      r.noArt     || false,
          rgGain:     r.rgGain    != null ? r.rgGain    : undefined,
          // C-3 : propriétés audio techniques
          bitrate:    r.bitrate    != null ? r.bitrate    : null,
          sampleRate: r.sampleRate != null ? r.sampleRate : null,
          channels:   r.channels   != null ? r.channels   : null,
          bitDepth:   r.bitDepth   != null ? r.bitDepth   : null,
        });
      }
      if (_bi + _BOOT_CHUNK < saved.length) await new Promise(res => setTimeout(res, 0));
    }
    tracks = _tracksArr;
    set('tracks', tracks); // Jalon 3/4
    rebuildTrackIdxMap(); // FIX #3 — doit précéder updateStats(), renderLib() et LIBRARY_UPDATED
    emit(EVENTS.LIBRARY_UPDATED, { tracks });

    // IPC-ASSET : restaurer l'accès asset:// pour chaque dossier parent unique des pistes
    // chargées depuis l'IDB. En production, le scope asset:// est remis à zéro à chaque
    // lancement — sans ce call, audio.src = asset://... échoue avec MEDIA_ERR_SRC_NOT_SUPPORTED.
    // allow_directory(recursive=true) couvre tous les sous-dossiers → O(dossiers distincts) appels.
    const _assetDirs = [...new Set(
      tracks.map(t => t.path ? t.path.replace(/[/\\][^/\\]+$/, '') : null).filter(Boolean)
    )];
    _assetDirs.forEach(dir => invoke('allow_asset_dir', { path: dir }).catch(() => {}));
    // Reconstruire liked par IDs si disponible (robuste aux réordres)
    updateStats();
    renderLib();
    // UX-3 : masquer le spinner de boot après le premier rendu de la bibliothèque
    const _bootSpinner = document.getElementById('boot-spinner');
    if (_bootSpinner) _bootSpinner.style.display = 'none';
    showView('lib');
    // Queue persist — restaurer après rebuildTrackIdxMap (IDs validés contre _trackIdxMap)
    if (cfg?.queueState?.ids?.length) restoreQueueState(cfg.queueState);
    const cb=document.getElementById('btn-clear'); if(cb) cb.disabled=false;
    toast(i18n('t_loaded', tracks.length), 'success');
    // Restaurer la position de scroll après que renderLib() ait réinitialisé scrollTop à 0
    if (cfg && cfg.scrollTop > 0) {
      const _tlist = document.getElementById('tlist');
      if (_tlist) requestAnimationFrame(() => { _tlist.scrollTop = cfg.scrollTop; });
    }
    // Rouvrir le mini-overlay si il était visible à la fermeture
    if (cfg && cfg.miniOvOpen) setTimeout(() => toggleMiniOverlay(), 350);

    // ── Retry loadTagsBg en arrière-plan pour les pistes sans pochette ──────
    // Cas : scan précédent interrompu (timeout IPC, fichier verrouillé) →
    // metaDone=true mais art=null et noArt=false (lecture avortée, pas confirmée vide).
    // On ne retente PAS les pistes avec noArt=true (lecture OK mais fichier sans art).
    const _retryList = tracks.filter(t => t.metaDone && !t.art && !t.noArt && t.path);
    if (_retryList.length) {
      _retryArtTimer = setTimeout(async () => { // FIX #21 — stocker le timer
        // Afficher un toast spinner pendant le chargement des pochettes manquantes
        const dismissSpinner = toast(i18n('t_artwork_retry', _retryList.length), 'loading');
        const BATCH = 4;
        for (let i = 0; i < _retryList.length; i += BATCH) {
          const batch = _retryList.slice(i, i + BATCH).filter(t => _trackIdxMap.has(t.id));
          if (!batch.length) continue;
          batch.forEach(t => { t.metaDone = false; }); // autoriser loadTagsBg à tourner
          await Promise.all(batch.map(t => loadTagsBg(t)));
          await new Promise(r => setTimeout(r, 50));
        }
        dismissSpinner();
        const loaded = _retryList.filter(t => t.art).length;
        if (loaded) toast(i18n('t_artwork_retry_done', loaded), 'success');
        scheduleStatsUpdate();
      }, 3000); // 3s après boot pour ne pas concurrencer le rendu initial
    }

    // C-2 : vérification des fichiers orphelins — 6s après boot, non-bloquant
    // (après l'artwork retry pour ne pas cumuler les I/O au démarrage)
    _orphansTimer = setTimeout(() => checkOrphans(), 6000); // FIX #22 — stocker le timer

    // MINOR-1 FIX : applyLang() / setMode() / sync UI AVANT le await BOOT-1.
    // Avant ce fix, ces appels venaient après le bloc if/else → bloqués jusqu'à 5s
    // si le fichier audio de reprise était lent à répondre (NAS, fichier manquant).
    _applyBootUI(cfg);

    // ── Restaurer la dernière piste et position ──────────────────────────
    if (cfg && cfg.curTrackId) {
      const resumeTrack = _trackIdxMap.has(cfg.curTrackId) ? tracks[_trackIdxMap.get(cfg.curTrackId)] : undefined;
      if (resumeTrack) {
        setCurIdx(trackIdx(resumeTrack)); // FIX #4 — notifier le store
        const ok  = await ensureUrl(resumeTrack);
        if (ok) {
          audio.src = resumeTrack.url;
          // Attendre les métadonnées avant de seek.
          // BOOT-1 FIX : si le fichier est manquant (error) ou introuvable (5s timeout),
          // on résout quand même — évite un freeze infini au démarrage.
          await new Promise(res => {
            if (audio.readyState >= 1) { res(); return; }
            const cleanup = () => {
              audio.removeEventListener('loadedmetadata', onMeta);
              audio.removeEventListener('error',          onErr);
              clearTimeout(timer);
            };
            const onMeta = () => { cleanup(); res(); };
            const onErr  = () => { cleanup(); res(); }; // fichier manquant — on skip le seek
            const timer  = setTimeout(() => { cleanup(); res(); }, 5000); // safety net 5s
            audio.addEventListener('loadedmetadata', onMeta, { once: true });
            audio.addEventListener('error',          onErr,  { once: true });
          });
          if (cfg.curPos && cfg.curPos > 0 && cfg.curPos < (audio.duration - 2)) {
            audio.currentTime = cfg.curPos;
          }
          updateBar();
          patchActiveTrack();
          // UX-5: toast de session restaurée
          const _resumeTitle = resumeTrack.name || resumeTrack.file?.split(/[\\/]/).pop() || '…';
          toast(i18n('t_session_restored', _resumeTitle), 'info');
          // On ne relance PAS la lecture — l'utilisateur choisit de reprendre
        }
      }
    }
  } else {
    showView('welcome');
    // Apply language + UI even on welcome screen
    _applyBootUI(cfg);
    // UX-3 : masquer le spinner de boot même si la bibliothèque est vide
    document.getElementById('boot-spinner')?.remove();
  }
  initAppVersion().catch(() => {});
  // Vérifier les mises à jour 10s après le boot (non bloquant, silencieux si pas configuré)
  if (_autoUpdate) {
    setTimeout(() => checkForUpdate().catch(() => {}), 10_000);
  }

  listen('win-state', (e) => { const s = e.payload;
    document.getElementById('tbt-max').title = (s==='maximized'||s==='fullscreen') ? i18n('tb_restore') : i18n('tb_maximize');
  }, { target: { kind: 'Any' } }).then(u => _unlisteners.push(u));
  listen('media-key', function(e) { const cmd = e.payload;
    if      (cmd === 'toggle-play') togglePlay();
    else if (cmd === 'next')        next(true);
    else if (cmd === 'prev')        prev();
    else if (cmd === 'stop')        { audio.pause(); audio.currentTime = 0; setIcon(false); patchPlayState(false); }
  }).then(u => _unlisteners.push(u));
  window.addEventListener('pagehide', () => { _unlisteners.forEach(u => { try { u(); } catch {} }); });

  // ── Sauvegarde complète avant fermeture ──────────────────────────────────
  // beforeunload seul ne suffit pas sous Tauri : les promises async ne sont pas attendues.
  // On intercepte CloseRequested (Tauri v2) pour bloquer la fermeture le temps de tout flusher.
  // Fallback : beforeunload synchrone pour les cas où Tauri n'est pas dispo (dev web).
  async function _flushAllAndClose() {
    // Bug #20 fix : catch silencieux remplacé par un log d'avertissement.
    // return explicite pour confirmer la résolution (utile pour onCloseRequested + await).
    try {
      // 1. cfg (curTrackId, curPos, liked, volume, shuffle, repeat…) — flush via cfgsave.js
      // 2. Toutes les saves en parallèle — allSettled garantit qu'aucune rejection ne coupe les autres
      await Promise.allSettled([
        saveCfgNow(),
        flushTrackBatch(),
        flushPlayLog(),
      ]);
      return true;
    } catch (e) {
      console.warn('[flushAllAndClose]', e);
      return false;
    }
  }

  if (window.__TAURI__?.window?.getCurrentWindow) {
    // Tauri v2 : intercepter CloseRequested pour un flush garanti
    try {
      const appWin = window.__TAURI__.window.getCurrentWindow();
      appWin.onCloseRequested(async (event) => {
        event.preventDefault();
        await _flushAllAndClose();
        await appWin.destroy();
      }).catch(() => {
        // Fallback si onCloseRequested échoue
        window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
      });
    } catch {
      window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
    }
  } else {
    // Fallback navigateur web (mode dev)
    window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
  }
// ══ Color extraction ═══════════════════════════
}

// ══ Open folder / Library import → library.js ═════════════════
// openFolder, loadTagsAndDurations, loadTagsBg → library.js
// getFiltered, rebuildTrackIdxMap, trackIdx, _trackIdxMap → search.js (imports directs)

export function invalidateFilter() {
  invalidateFilterCache();    // search.js : _GF, _PSC, _albumMapCache, _artistMapCache
  invalidateGenreGridSig();   // genres.js (Jalon 5)
  emit(EVENTS.FILTER_CHANGED, {}); // Jalon 4 — signal "dirty" : subscribers appellent getFiltered()
}
// ══ playPlaylistFrom / playPlaylistDirect / shufflePlaylist → playlists.js (ARCH-1) ═
// Imported above from playlists.js and re-exported for backward compat.

// ══ Drag & Drop → dropin.js (CQ-2) ═════════════════════════════
// Logique extraite dans dropin.js ; initDrop() appelé dans DOMContentLoaded ci-dessous.

// ══ Keyboard shortcuts → shortcuts.js (CQ-2) ════════════════════
// Handler attaché ici après définition de updateVolSlider, closeModal, cycleSpeed
// (fonctions injectées comme callbacks pour éviter la dépendance circulaire).
initShortcuts({ updateVolSlider, closeModal, cycleSpeed });

// ══ Persistence ═════════════════════════════════

// Batch save : pendant un import, les appels saveTrack() sont accumulés et
// écrits ensemble toutes les 250ms (une seule transaction IDB au lieu de N).

// _flushTrackBatch, saveTrack, saveTracks, saveTrackNow → library.js

// ══ saveCfg / saveCfgNow / _doSaveCfg → cfgsave.js (ARCH-1) ══════════════════
// Imported at the top of this file and re-exported as saveCfg / saveCfgNow.

// ══ PLAYLISTS → playlists.js ══════════════════════════════════════════════
// savePlaylists, trapFocus, renderPlHero, setPlSort,
// _plHeroInlineRename, _plNavInlineRename, _plNavItemHTML, renderPlNav,
// renamePlFolder, deletePlFolder, togglePlFolder, showPlFolderCtxMenu,
// onPlFolderDragOver/Leave/Drop, togglePinPlaylist, movePlToFolder,
// removePlFromFolder, showPlQuickPop, pqpAdd/pqpNew/closePlQuickPop,
// onTrackDragStart, _attachPlaylistReorder, _detachPlaylistReorder,
// onPlNavDragStart, setupPlNavDrop,
// _resizeImageToBase64, _renderPlCoverPreview, onPlCoverSelected, clearPlCover,
// openNewPlaylistModal, showPlCtxMenu, ctxPlayPlaylist, ctxShufflePlaylist,
// openRenamePlaylistModal, closePlModal, confirmPlaylistModal,
// deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist.
// (keyboard listener pl-modal-inp → playlists.js)


// ══ CROSSFADE → player.js ═════════════════════════════════════

// setCrossfade, initCrossfadeAudio, clearCrossfadeTimers,
// _commitGapless, checkCrossfade, getNextIdx → player.js

// ══ MINI-PLAYER → miniplayer.js ═══════════════════════════════

// ══ DÉTECTION DOUBLONS → dupes.js ════════════════════════════

// ══ RESCAN TAGS ══════════════════════════════════════════════
// rescanTags → library.js

// rescanGenres → genres.js (Jalon 5)

// ══ VUE GENRES → genres.js (Jalon 5) ═════════════════════════

// ══ MULTI-SÉLECTION → selection.js ════════════════════════════

// ══ VITESSE DE LECTURE ════════════════════════════════════════

export function cycleSpeed() {
  const cur = SPEEDS.indexOf(playbackSpeed);
  const next = (cur + 1) % SPEEDS.length;
  setSpeed(SPEEDS[next]);
}

// setSpeed → player.js

// FIX DRAG-MODULE → dropin.js : initDrop() résout #drago + attache les listeners après DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => { initDrop(); });

// Attendre __TAURI__ avant de démarrer (fix build MSI)
function waitForTauri(cb, n = 0) {
  if (window.__TAURI__?.core?.invoke) { cb(); }
  else if (n < 200) { setTimeout(() => waitForTauri(cb, n + 1), 25); }
  else { console.warn('[LibreFlow] __TAURI__ non disponible'); cb(); }
}

// ARCH-4 : Global error boundary — attrape les exceptions non gérées et les rejections de promesse
// pour éviter un crash silencieux de l'UI. Affiché en toast 'error' pour informer l'utilisateur.
window.addEventListener('error', (e) => {
  if (e.filename && !e.filename.includes('LibreFlow') && !e.filename.includes('localhost')) return; // ignorer les erreurs d'extensions tierces
  console.error('[LibreFlow] Uncaught error:', e.error || e.message);
  const msg = e.error?.message || e.message || 'Erreur inconnue';
  toast(`Erreur inattendue : ${msg}`, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  // Éviter de re-toaster les erreurs déjà loguées (ex: boot IDB)
  if (reason && reason._alreadyToasted) return;
  console.error('[LibreFlow] Unhandled rejection:', reason);
  const msg = reason?.message || String(reason) || 'Erreur asynchrone';
  toast(`Erreur asynchrone : ${msg}`, 'error');
  e.preventDefault(); // empêche l'affichage dans la console DevTools (déjà logué)
});

waitForTauri(() => {
  boot().catch(e => console.error('[LibreFlow] boot failed:', e)); // FIX #19
  initWaveform(audio); // Waveform progress bar
  initMediaSession(); // Contrôles Windows 11 SMTC / taskbar
  initMiniOverlayDrag(); // Drag du mini-player overlay in-page
  initRipple(); // Ripple feedback sur boutons et lignes
  initKeyNav(); // A11Y: roving tabindex arrow-key navigation in track list

  // Commandes depuis le mini-player (fenêtre séparée)
  // BUG FIX F6 : stocker l'unlistener mini-cmd avec les autres (voir boot())
  listen('mini-cmd', (e) => { const msg = e.payload;
    const { cmd, data } = msg;
    if      (cmd === 'toggle-play')    togglePlay();
    else if (cmd === 'prev')           prev();
    else if (cmd === 'next')           next(true);
    else if (cmd === 'toggle-like')    toggleLike();
    else if (cmd === 'toggle-shuffle') toggleShuffle();
    else if (cmd === 'toggle-repeat')  toggleRepeat();
    else if (cmd === 'go-home')        goHome();
    else if (cmd === 'volume-down') { const _c=masterGainNode?masterGainNode.gain.value:audio.volume; const v=Math.max(0,_c-0.05); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel);} saveCfg(); _allPlayerUI(); }
    else if (cmd === 'volume-up')   { const _c=masterGainNode?masterGainNode.gain.value:audio.volume; const v=Math.min(1,_c+0.05); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel);} saveCfg(); _allPlayerUI(); }
    else if (cmd === 'volume-set' && data != null) { const v=Math.max(0,Math.min(1,data)); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel);} saveCfg(); _allPlayerUI(); } // QW-10
    else if (cmd === 'seek' && data != null && audio.duration) {
      audio.currentTime = data * audio.duration;
      resetMiniProgressThrottle(); // le prochain timeupdate passe immédiatement
    }
    else if (cmd === 'save-mini-pos' && data) {
      setMiniPos(data); saveCfg();
    }
  }).then(u => { _unlisteners.push(u); });
});
// Note: mini.html uses invoke('mini_get_state') on load to get initial state,
// so the mini-request-state event is not needed.

// ── P1-3 Parallax tilt — cartes playlist / album / artiste ───────────────
// Délégation sur #content-area : un seul listener pour les grilles dynamiques.
// Remplace le transform CSS hover (.card:hover translateY(-4px)) par un tilt 3D.
const _contentArea = document.getElementById('content-area');
if (_contentArea) {
  _contentArea.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width  - 0.5;
    const cy = (e.clientY - rect.top)  / rect.height - 0.5;
    card.style.transform =
      `perspective(400px) rotateX(${(cy * -6).toFixed(2)}deg) rotateY(${(cx * 6).toFixed(2)}deg) translateY(-4px) scale(1.02)`;
  }, { passive: true });
  _contentArea.addEventListener('mouseleave', (e) => {
    const card = e.target.closest('.card');
    if (card) card.style.removeProperty('transform');
  }, true);
  // Reset au pointerleave de chaque card (cas où mouseleave délégué rate le timing)
  _contentArea.addEventListener('mouseover', (e) => {
    const prev = e.relatedTarget?.closest?.('.card');
    if (prev && prev !== e.target.closest('.card')) prev.style.removeProperty('transform');
  }, { passive: true });
}

// ── Toast notification (supprimé lors du refactoring, réintégré ici) ────────
// ── Toast riche — type : 'info' | 'success' | 'error' | 'warning' ──
// toast / toastWithAction / _TOAST_ICONS / _TOAST_DUR → ui.js (Phase 6)

// ══ statsGoToGenre / statsGoToArtist / statsGoToAlbum → views.js (ARCH-1) ════
// Imported above from views.js and re-exported for backward compat.

/** Jouer un album ou artiste depuis sa card grid (hover play button). */
export function playCardByKey(from, key, displayName) {
  _withVT(() => {
    drillDown(from, key, displayName);
    setTimeout(() => playPlaylistFrom(0), 80);
  });
}

// ── Volume slider, marquee, now-playing bar → playerbar.js (CQ-2) ────────────
// updateVolSlider(), setupMarquee(), updateBar() extraits dans playerbar.js.
// Re-exportés ci-dessus pour les consommateurs existants (handlers.js, library.js…).

// ── Modal de confirmation "vider la bibliothèque" → modal.js (CQ-2) ──────────
// confirmClear(), closeModal() extraits dans modal.js ; re-exportés ci-dessus.

export async function clearAppCache() {
  const ok = await confirmAction(
    'Vider les caches ?',
    'Toutes les données seront supprimées : bibliothèque, configuration, playlists et historique d\'écoute.<br><br>L\'application redémarrera automatiquement.',
    'Vider et redémarrer', 'danger'
  );
  if (!ok) return;
  // 1. Annuler les timers de sauvegarde différée AVANT de fermer la DB.
  //    Sans ça, un debounce en attente peut écrire sur une DB déjà fermée → crash IDB.
  cancelTrackBatch();
  cancelPlayLogFlush();
  // 2. Fermer la connexion IDB.
  if (DB) { try { DB.close(); } catch(e) {} }
  // 3. Supprimer la base. On track `deleted` séparément :
  //    onblocked = resolve était un bug silencieux — la DB n'était pas supprimée
  //    mais l'app rechargait quand même, laissant les données intactes.
  let deleted = false;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lp4');
    req.onsuccess = () => { deleted = true; resolve(); };
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB blocked: another connection is still open'));
  }).catch(e => console.warn('[clearAppCache]', e));
  // 4. Ne recharger que si la suppression a réellement eu lieu.
  if (!deleted) {
    toast('Impossible de vider les caches. Ferme toutes les fenêtres LibreFlow et réessaie.', 'error');
    return;
  }
  window.location.reload();
}

export async function clearLibrary() {
  closeModal();
  // Fermer tous les panneaux ouverts avant de vider l'état (évite l'affichage de données périmées)
  closeNowPlaying();
  closeQueue();
  clearQueueOverride();
  closeEQ();
  if (cinemaOpen) closeCinema();
  // FIX #21/#22 — annuler les timers de retry artwork et orphelins
  clearTimeout(_retryArtTimer); _retryArtTimer = null;
  clearTimeout(_orphansTimer);  _orphansTimer  = null;
  // Annuler le batch IDB en attente (cancelTrackBatch → library.js)
  cancelTrackBatch();
  cancelPlayLogFlush();
  setPlayLog([]);
  // Révoquer tous les blob URLs pour libérer la mémoire (B4 FIX : guard blob: — data: URIs ne doivent pas être révoquées)
  for (const t of tracks) {
    if (t.url && t.url.startsWith('blob:'))  try { URL.revokeObjectURL(t.url);  } catch {}
    if (t.art && t.art.startsWith('blob:'))  try { URL.revokeObjectURL(t.art);  } catch {}
  }
  tracks  = []; set('tracks', tracks); rebuildTrackIdxMap(); notify('tracks'); invalidateFilter(); // INVARIANT : map must stay in sync; store gets same ref as local var so openFolder mutations stay visible to updateBar()
  liked   = new Set(); set('liked', liked);
  playlists = []; set('playlists', playlists); recentPlays = []; set('recentPlays', recentPlays);
  curPlId = null; set('curPlId', null);
  plFolders = []; set('plFolders', plFolders); recentPls = []; set('recentPls', recentPls);
  renderPlNav();
  curIdx  = -1; set('curIdx', -1);
  shuffle = false; set('shuffle', false); resetShuffleQ();
  repeat  = 'none'; set('repeat', 'none');
  query   = ''; set('query', '');
  albumSort = 'name'; set('albumSort', 'name');
  artistSort = 'name'; set('artistSort', 'name');
  genreSort = 'count'; set('genreSort', 'count');
  albumDetailSort = 'track'; set('albumDetailSort', 'track');
  // (_lastNotifTrackId dans playerbar.js se réinitialise naturellement au prochain updateBar)
  // Arrêter l'audio
  audio.pause();
  audio.src = '';
  // Réinitialiser la barre player
  document.title = 'LibreFlow';
  setupMarquee(document.getElementById('pl-n'), '–');
  setupMarquee(document.getElementById('pl-a'), '–');
  wfClear();
  _updateArtBlur(null);
  clearArtColor(); // réinitialise --art-color, --g, --g-rgb, --gd, --gg
  document.getElementById('pl-img').style.display = 'none';
  document.getElementById('pl-em').style.display  = '';
  document.getElementById('pl-em').innerHTML      = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  document.getElementById('pfill').style.transform = 'scaleX(0)';
  document.getElementById('tc').textContent       = '0:00';
  document.getElementById('td').textContent       = '–:––';
  document.getElementById('pl-lk').classList.remove('on');
  document.getElementById('pl-lk').setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-lk')?.classList.remove('on');
  document.getElementById('cinema-lk')?.setAttribute('aria-pressed', 'false');
  document.getElementById('pc-shuf').classList.remove('on');
  document.getElementById('pc-shuf').setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-shuf')?.classList.remove('on');
  document.getElementById('cinema-shuf')?.setAttribute('aria-pressed', 'false');
  document.getElementById('pc-rep').classList.remove('on');
  document.getElementById('pc-rep').setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-rep')?.classList.remove('on');
  document.getElementById('cinema-rep')?.setAttribute('aria-pressed', 'false');
  setIcon(false);
  // Barre de recherche — vider le champ DOM et masquer le badge/bouton clear
  const _srch = document.getElementById('srch');
  if (_srch) _srch.value = '';
  const _srchClr = document.getElementById('srch-clear');
  if (_srchClr) _srchClr.style.display = 'none';
  document.getElementById('srch-badge')?.remove();
  // Stats sidebar
  document.getElementById('sb-stats').innerHTML  = i18n('sb_empty');
  const _btnClear = document.getElementById('btn-clear');
  if (_btnClear) _btnClear.disabled = true;
  // Vider IndexedDB
  try {
    await new Promise((ok, fail) => {
      const store = tx('tracks', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
    });
    await new Promise((ok, fail) => {
      const store = tx('playlists', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
    });
    await new Promise((ok, fail) => {
      const store = tx('playlog', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
    });
    await _doSaveCfg();
  } catch(e) { console.warn('[clearLibrary] DB error:', e); }
  // Réinitialiser radio, crossfade, watchfolder
  resetRadio();
  clearCrossfadeTimers();
  cancelSleepTimer(true); // BUG-D1-13 FIX: cancel sleep timer so it can't fire on an empty library
  stopWatchFolder();
  // Réinitialiser l'état de vue et de drill (évite le flash de contenu périmé au retour)
  view = 'all'; set('view', 'all');
  drillKey = ''; set('drillKey', '');
  drillFrom = ''; set('drillFrom', '');
  drillDisplayName = ''; set('drillDisplayName', '');
  document.getElementById('drill-header')?.remove();
  // Vider les grilles et la liste de pistes pour éviter le flash de contenu périmé
  const _tlistClr = document.getElementById('tlist');
  if (_tlistClr) _tlistClr.innerHTML = '';
  ['album-grid', 'artist-grid', 'playlist-grid'].forEach(id => {
    const g = document.getElementById(id);
    if (g) g.innerHTML = '';
  });
  // Retour à l'écran d'accueil
  showView('wlc');
  toast(i18n('t_cleared'), 'success');
}

// ── State mutation helpers → state.js (ARCH-1) ────────────────────────────────
// setCurIdx / setLiked / setTracks / setCtxTrackId imported from state.js + re-exported above.
// app.js local vars stay in sync via subscribe() callbacks (lines above).
