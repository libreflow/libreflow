// @ts-nocheck
// LibreFlow — Main application
import { invoke, listen, convertFileSrc } from './ipc.js';
import { audio, playAt, prev, next, togglePlay, buildQ,
         toggleShuffle, toggleRepeat, toggleLike, likeat,
         setIcon, setSpeed, setCrossfade, initCrossfadeAudio,
         clearCrossfadeTimers, getNextIdx, ensureUrl,
         initMediaSession, updateMediaSession, updateMediaSessionState,
         checkCrossfade, setManualQueue, resetShuffleQ,
         adjustShuffleQAfterDelete, setBootVizState }       from './player.js';
import { emit, on, EVENTS }                                from './bus.js';
import { get, set, notify, subscribe, setBatch }           from './store.js';
// Side-effect import: registers GSAP core + Flip + CustomEase once at boot.
// Consumers import named primitives from './motion.js' as needed.
import './motion.js';
import './player-seekbar.js';
import { CFG, SORTS, SLBLS, SPEEDS, SPEED_LBLS } from './cfg.js';
import { openDB, tx, dget, dall, dput, ddel, DB, getStorageEstimate } from './db.js';
import { extractColor, GENRE_ARTISTS, GENRE_KEYWORDS, guessGenre } from './tags.js';
import { LANGS, i18n, initLang, getLang, applyLang, setLang } from './i18n.js';
import { cinemaOpen, cinemaBg, initCinemaBg, toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress, setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn, toggleCinemaFullscreen, CINEMA_BG_MODES, CINEMA_BG_LABELS, updateCinArtColor, startWelcomeAmbient, stopWelcomeAmbient } from './cinema.js';
import { queueOpen, toggleQueue, closeQueue, renderQueue, playQueueItem, clearQueueOverride, addToQueueNext, addToQueueEnd, refreshQueueBadge, getQueueState, restoreQueueState, toggleQueuePin, clearQueuePin } from './queue.js';
import { exportM3U, importM3U } from './m3u.js';
import { VIRT } from './virt.js';
import { playLog, setPlayLog, logPlay, flushPlayLog, cancelPlayLogFlush } from './playlog.js';
import { eqCtx, eqSource, eqNodes, eqEnabled, eqOpen, initEQ, ensureEQResumed, toggleEQ, closeEQ, renderEQBands, setEQBand, applyEQPreset, eqAutoMode, setEQAutoMode, toggleEQAutoMode, loadEQProfiles, getEQProfiles, applyGenreEQ, startSmartEQ, stopSmartEQ, updateSmartEQLoudness, updateSmartEQGenre, filterEQPresets, initBootEQ, getActiveEqPreset, masterGainNode, setMasterGain, setEQExpert } from './eq.js';
import { initDeviceEQ, setDefaultDeviceLabel }         from './eqdevice.js';
import { initDevices }                                 from './devices.js';
import { cleanupCdCache }                              from './cdaudio.js';
import { initViz, startViz, stopViz, updateVizColor, setVizMode, getVizMode, setVizEnabled, getVizEnabled } from './viz.js';
import { sleepFading, setSleepFading, sleepEndOfTrack, toggleSleepMenu, setSleepTimer, setSleepEndOfTrack, setSleepCustom, cancelSleepTimer } from './sleep.js';
import { esc, fmt, fmtd, extEmoji, normTag, mainArtist, validYear, normalizePathKey, extractAudioFileArg, smtcMetaFromTrack } from './utils.js';
import { radioActive, startRadio, stopRadio, resetRadio, radioRefillQueue, toggleRadio, ctxStartRadio, radioRegenerateFromCurrent, radioSaveAsPlaylist, getRadioQueue, renderRadioView, openRadioView, syncRadioLibBar, getRadioSeedId, initRadioSeedId } from './radio.js';
import { initWatchPath, getWatchPath, stopWatchFolder, updateWatchUI, importPaths, startWatchNative } from './watchfolder.js'; // Bug #7 fix : startWatchNative ajouté
import { renderStats, getHeatPeriod, initHeatPeriod } from './stats.js';
import { switchPlTab, openSmartPlaylistModal, _setSmartSeed, smartSeedSearch, smartPreview, confirmSmartPlaylist, regenerateSmartPlaylist } from './smartplaylist.js';
import { detectDupes, removeDupeTrack, deleteAllDupes, closeDupes } from './dupes.js';
import { checkOrphans } from './orphans.js';
import { selection, selectionMode, clearSelection, toggleTrackSelection, selAddToPlaylist, selAddBatch, selToggleLike, selRemove, selBatchTagEdit, closeBatchTagModal, confirmBatchTagEdit } from './selection.js';
import { toggleMiniPlayer, updateMiniPlayer, updateMiniProgress, resetMiniProgressThrottle, setMiniPos, getMiniPos } from './miniplayer.js';
import { toggleMiniOverlay, syncMiniOverlay, updateMiniOverlayProgress, initMiniOverlayDrag, reclampMiniOverlay } from './minioverlay.js';
import { rgEnabled, rgTargetLUFS, initRgState, initRG, setReplayGain, setRGTarget, analyzeAndApplyRG, applyRGGain, cancelRgAnalysis } from './replaygain.js';
import { openTagEditor, saveTagEdit, cancelTagEdit } from './tagedit.js';
import { toast, toastWithAction, confirmAction, resolveConfirm, initRipple, setToastCloseLabel } from './ui.js';
import { checkForUpdate, checkForUpdateManual, initAppVersion } from './updater.js';
import { getFiltered, filteredIdx, rebuildTrackIdxMap, trackIdx, invalidateFilterCache,
         _trackIdxMap }    from './search.js';
import { loadTagsAndDurations, loadTagsBg,
         saveTrack, saveTracks, saveTrackNow, flushTrackBatch,
         cancelTrackBatch }                                           from './library.js';
import { renderGenresGrid, drillGenre, setContentView, rescanGenres, invalidateGenreGridSig } from './genres.js';
import {
  savePlaylists, renderPlNav, setupPlNavDrop,
  renderPlHero, setPlSort, setPlModalMode,
  openNewPlaylistModal, openRenamePlaylistModal, closePlModal, confirmPlaylistModal,
  deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, movePlaylistTrack,
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

import { toggleNowPlaying, closeNowPlaying, updateNowPlaying, initNpBg, onResizeNowPlaying } from './nowplaying.js';
import {
  initSettingsVars, getTheme, getDynColor, getDisplayMode, isShortcutsOpen,
  switchSetTab, openSettings, closeSettings,
  setTheme, applyTheme, setDynColor,
  applyArtColor, clearArtColor, _updateArtBlur,
  closeShortcuts, toggleShortcuts,
  setMode, toggleMode,
  _syncVizBtns,
} from './settings.js';
import {
  _showViewRaw, showView, goHome, setView, onSearch, nextSort,
  nextAlbumSort, nextArtistSort, nextGenreSort,
  statsGoToGenre, statsGoToArtist, statsGoToAlbum,
  updateClearFiltersBtn, clearAllFilters,
  registerWelcomeHooks,
} from './views.js';
import { _showSkeletonRows,
         virtRenderWindow, virtAttachScroll,
         renderLib, renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid,
         drillDown, updatePlActionBar, updateBreadcrumb,
         makeLikeBtn, makeAddBtn, artPlaceholder, hlText, thtml,
         playById, patchActiveTrack, patchPlayState, patchTrackEl,
         scheduleStatsUpdate, updateStats, updateSidebarCounts,
         _withVT, scrollToCurrentTrack } from './renderer.js';
import { _allPlayerUI } from './allplayerui.js';
import { showCtxMenu, closeCtxMenu, ctxToggleLike, ctxDeleteTrack, ctxEditTags, ctxGoToArtist, ctxGoToAlbum, ctxNewPlaylist, ctxRemoveFromPlaylist, ctxSmartPlaylist, ctxPlayNext, ctxAddToQueueEnd, ctxCopyInfo } from './ctxmenu.js';
import { initDrop } from './dropin.js';
import { initKeyNav } from './keynav.js';
import { initShortcuts } from './shortcuts.js';
import { setTlistZoom, initTlistZoomWheel } from './tlistZoom.js';
import { confirmClear, closeModal } from './modal.js';
export { confirmClear, closeModal };
import { updateBar, updateVolSlider, setupMarquee, reflowMarquee } from './playerbar.js';
export { updateBar, updateVolSlider };
import { saveCfg, saveCfgNow } from './cfgsave.js';
export { saveCfg, saveCfgNow };
import { setCurIdx, setTracks, setLiked, setCtxTrackId, replaceTracks } from './state.js';
import { setAriaValueText }                                    from './a11y.js';
import { _clearLibraryState, _clearLibraryDOM, _clearLibraryIDB, _clearLibraryView } from './library-reset.js';
import { _applyBootUI, _playFileArg }                         from './boot-ui.js';

let tracks  = [];       // full track array
let liked   = new Set();
let curIdx  = -1;
let shuffle    = false;    // shuffleQ est dans player.js
let repeat     = 'none';  // none | all | one
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

subscribe('curIdx',          v => { curIdx          = v; });
subscribe('shuffle',         v => { shuffle         = v; });
subscribe('repeat',          v => { repeat          = v; });
subscribe('manualQueue',     v => { manualQueue     = v; });
subscribe('recentPlays',     v => { recentPlays     = v; });
subscribe('playbackSpeed',   v => { playbackSpeed   = v; });
subscribe('crossfadeDur',    v => { crossfadeDur    = v; });
subscribe('liked',        v => { liked      = v; });
subscribe('tracks',       v => { tracks     = v; });
subscribe('ctxTrackId',   v => { ctxTrackId = v; });
subscribe('drillFrom',        v => { drillFrom        = v; });
subscribe('drillDisplayName', v => { drillDisplayName = v; });
subscribe('genreSort',        v => { genreSort        = v; });
subscribe('albumSort',        v => { albumSort        = v; });
subscribe('artistSort',       v => { artistSort       = v; });
subscribe('plFolders',        v => { plFolders        = v; });
subscribe('recentPls',        v => { recentPls        = v; });
subscribe('view',             v => { view             = v; });
subscribe('sort',             v => { sort             = v; });
subscribe('query',            v => { query            = v; });
subscribe('curPlId',          v => { curPlId          = v; });
subscribe('plSort',           v => { plSort           = v; });
subscribe('drillKey',         v => { drillKey         = v; });
subscribe('albumDetailSort',  v => { albumDetailSort  = v; });

on(EVENTS.TRACK_CHANGE, ({ track, idx }) => {
  // radioRefillQueue() safety net — guard in radio.js absorbs concurrent calls
  if (radioActive) radioRefillQueue().catch(e => console.warn('[radio refill safety-net]', e));
  updateBar(); patchActiveTrack(); patchPlayState(!audio.paused); _allPlayerUI();
  invoke('smtc_metadata', { meta: track ? smtcMetaFromTrack(track, audio.duration) : null })
    .catch(e => console.warn('[smtc] metadata:', e));
});
on(EVENTS.PLAY_STATE, ({ playing }) => {
  patchPlayState(playing); _allPlayerUI();
});
on(EVENTS.RENDER_LIB, () => renderLib());
on(EVENTS.FILTER_CHANGED, () => { renderLib(); updateClearFiltersBtn(); });
on(EVENTS.LIBRARY_UPDATED, ({ tracks }) => {
  invoke('taskbar_set_has_tracks', { hasTracks: tracks.length > 0 }).catch(e => { console.warn('[taskbar] taskbar_set_has_tracks failed:', e); });
  updateSidebarCounts();
});
on(EVENTS.RENDER_LIB, () => updateSidebarCounts());
on(EVENTS.PLAYLIST_CHANGED, () => {
  renderPlNav();
  setupPlNavDrop();
});

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
  }).catch(e => console.warn('[app:storageEstimate]', e));

  // Load config
  const cfg = await dget('cfg','state').catch(e => { console.error('[boot] cfg read failed:', e); return null; });
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
    set('formatFilter', cfg.formatFilter || '');
    set('queuePinned', cfg.queuePinned === true);
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
    setDefaultDeviceLabel(i18n('device_default_label'));
    setToastCloseLabel(i18n('toast_close'));
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
    if (cfg.npBg) initNpBg(cfg.npBg);
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
    if (cfg.eqExpert)    setEQExpert(true);
    if (cfg.eqProfiles)  loadEQProfiles(cfg.eqProfiles);
    initDeviceEQ(cfg.eqDeviceProfiles ?? {}).catch(e => console.warn('[boot] initDeviceEQ failed:', e)); // detects current audio output device
    initDevices(); // démarrer le polling USB + CD audio
    // Purge tout résidu de cache CD orphelin (rip interrompu, crash, etc.)
    cleanupCdCache(null).catch(e => console.warn('[boot] CD cache GC failed:', e));
    // Watch folder : restaurer le chemin ET relancer la surveillance native.
    // Bug #7 fix : initWatchPath() seul restaure le chemin mais ne relance pas le watcher.
    // La surveillance était inactive jusqu'au prochain clic sur le bouton.
    if (cfg.watchPath) {
      initWatchPath(cfg.watchPath);
      startWatchNative().catch(e => console.warn('[app:startWatchNative]', e)); // fire-and-forget — timeout géré dans startWatchNative
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
        // A11Y-08 : initialiser aria-valuetext au boot
        setAriaValueText(_volEl, _v => `${Math.round(_v * 100)} pour cent`, parseFloat(_volEl.value));
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
  // Welcome ambient canvas hooks — unconditional (canvas may not exist yet, calls are safe no-ops)
  registerWelcomeHooks(startWelcomeAmbient, stopWelcomeAmbient);
  // Zoom liste de pistes — appliquer AVANT le premier rendu (tlistZoom.js)
  setTlistZoom((cfg && cfg.tlistZoom) || 'normal');
  // Ctrl/Cmd + molette → cycle le niveau de zoom sur #tlist (throttle 150ms).
  initTlistZoomWheel();
  if (cfg) _showSkeletonRows(cfg.view);
  const [savedPl, savedLog, saved] = await Promise.all([
    dall('playlists').catch(e => { console.error('[boot] playlists read failed:', e); return []; }),
    dall('playlog').catch(e => { console.error('[boot] playlog read failed:', e); return []; }),
    dall('tracks').catch(e => { console.error('[boot] tracks read failed — library may appear empty:', e); return []; }),
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
    // PERF-BOOT : traitement par tranches — évite le blocage main-thread sur grandes bibliothèques.
    // BOOT-2 FIX : cadence réduite à 10-20 yields pour 50k pistes (était 100 yields × setTimeout(0) ≈ +400ms).
    const _tracksArr = [];
    for (let _bi = 0; _bi < saved.length; _bi += CFG.BOOT_CHUNK) {
      const _slice = saved.slice(_bi, _bi + CFG.BOOT_CHUNK);
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
      if (_bi + CFG.BOOT_CHUNK < saved.length) await new Promise(res => setTimeout(res, 0));
    }
    tracks = _tracksArr;
    replaceTracks(tracks);
    emit(EVENTS.LIBRARY_UPDATED, { tracks });

    // Restore asset:// scope for all parent directories (reset at each launch in prod)
    const _assetDirs = [...new Set(
      tracks.map(t => t.path ? t.path.replace(/[/\\][^/\\]+$/, '') : null).filter(Boolean)
    )];
    _assetDirs.forEach(dir => invoke('allow_asset_dir', { path: dir }).catch(e => console.warn('[app:allow_asset_dir]', dir, e)));
    // Reconstruire liked par IDs si disponible (robuste aux réordres)
    updateStats();
    renderLib();
    // UX-3 : masquer le spinner de boot après le premier rendu de la bibliothèque
    const _bootSpinner = document.getElementById('boot-spinner');
    if (_bootSpinner) _bootSpinner.style.display = 'none';
    showView('lib');
    // Queue persist — restaurer après rebuildTrackIdxMap (IDs validés contre _trackIdxMap)
    if (cfg?.queueState?.ids?.length) restoreQueueState(cfg.queueState);
    if (cfg?.queuePinned === true && window.innerWidth >= 720) {
      if (!queueOpen) toggleQueue();
      // Delegate pin DOM + aria to toggleQueuePin() — avoids hardcoded labels and DOM divergence.
      // Store was set to true at line ~401; reset to false so toggleQueuePin() flips it to true.
      set('queuePinned', false);
      toggleQueuePin();
    }
    const cb=document.getElementById('btn-clear'); if(cb) cb.disabled=false;
    toast(i18n('t_loaded', tracks.length), 'success');
    // Restaurer la position de scroll après que renderLib() ait réinitialisé scrollTop à 0
    if (cfg && cfg.scrollTop > 0) {
      const _tlist = document.getElementById('tlist');
      if (_tlist) requestAnimationFrame(() => { _tlist.scrollTop = cfg.scrollTop; });
    }
    // Rouvrir le mini-overlay si il était visible à la fermeture
    if (cfg && cfg.miniOvOpen) setTimeout(() => toggleMiniOverlay(), 350);

    // Retry artwork for tracks whose scan was interrupted (metaDone=true, art=null, noArt=false)
    const _retryList = tracks.filter(t => t.metaDone && !t.art && !t.noArt && t.path);
    if (_retryList.length) {
      _retryArtTimer = setTimeout(async () => { // FIX #21 — stocker le timer
        // Afficher un toast spinner pendant le chargement des pochettes manquantes
        const dismissSpinner = toast(i18n('t_artwork_retry', _retryList.length), 'loading');
        const BATCH = CFG.TAG_LOAD_CONCURRENCY;
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

    _applyBootUI(cfg);

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
          if (radioActive) await radioRefillQueue().catch(e => console.warn('[boot] radioRefillQueue', e));
          updateBar();
          patchActiveTrack();
          // UX-5: toast de session restaurée
          // L-08 : resumeTrack.file est toujours null sur les pistes restaurées depuis l'IDB — branche file?.split retirée.
          const _resumeTitle = resumeTrack.name || '…';
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
  initAppVersion().catch(e => console.warn('[app:initAppVersion]', e));
  // Vérifier les mises à jour 10s après le boot (non bloquant, silencieux si pas configuré)
  if (get('autoUpdate') !== false) {
    setTimeout(() => checkForUpdate().catch(e => console.warn('[app:checkForUpdate]', e)), 10_000);
  }

  listen('win-state', (e) => { const s = e.payload;
    document.getElementById('tbt-max').title = (s==='maximized'||s==='fullscreen') ? i18n('tb_restore') : i18n('tb_maximize');
  }, { target: { kind: 'Any' } }).then(u => _unlisteners.push(u));
  listen('media-key', function(e) { const cmd = e.payload;
    if      (cmd === 'toggle-play') togglePlay();
    else if (cmd === 'next')        next(true);
    else if (cmd === 'prev')        prev();
    else if (cmd === 'stop')        { audio.pause(); audio.currentTime = 0; setIcon(false); patchPlayState(false); }
    // SMTC envoie Play/Pause distincts (boutons overlay) — idempotents par garde.
    else if (cmd === 'play')        { if (audio.paused)  togglePlay(); }
    else if (cmd === 'pause')       { if (!audio.paused) togglePlay(); }
  }).then(u => _unlisteners.push(u));
  // Scrub depuis l'overlay média (SMTC SetPosition) — position absolue en secondes.
  listen('smtc-seek', (e) => {
    const s = Number(e.payload);
    if (Number.isFinite(s) && s >= 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(s, audio.duration);
    }
  }).then(u => _unlisteners.push(u));
  // Seek relatif (Seek/SeekBy SMTC) — delta signé en secondes (positif = avant).
  listen('smtc-seek-by', (e) => {
    const delta = Number(e.payload);
    if (Number.isFinite(delta) && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, audio.duration));
    }
  }).then(u => _unlisteners.push(u));
  // ── Plugin single-instance : 2e invocation (« Ouvrir avec » sur un fichier) ──
  listen('single-instance', (e) => {
    const argv = Array.isArray(e.payload) ? e.payload : [];
    _playFileArg(extractAudioFileArg(argv.slice(1))); // argv[0] = chemin de l'exe
  }).then(u => _unlisteners.push(u));
  // ── Plugin cli : fichier passé au premier lancement (association de fichiers) ──
  invoke('plugin:cli|cli_matches', undefined, { timeout: 3000 })
    .then((m) => {
      const v = m?.args?.file?.value;
      if (typeof v === 'string' && v) _playFileArg(extractAudioFileArg([v]));
    })
    .catch(e => console.warn('[app:cli_matches]', e));
  window.addEventListener('pagehide', () => { _unlisteners.forEach(u => { try { u(); } catch(e) { console.warn('[app:unlisten]', e); } }); });

  // flush all pending saves before window closes (Tauri CloseRequested + beforeunload fallback)
  async function _flushAllAndClose() {
    try {
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
      }).catch((e) => {
        console.warn('[app:onCloseRequested promise]', e);
        window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
      });
    } catch(e) {
      console.warn('[app:onCloseRequested setup]', e);
      window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
    }
  } else {
    // Fallback navigateur web (mode dev)
    window.addEventListener('beforeunload', () => { _flushAllAndClose(); });
  }
}

export function invalidateFilter() {
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
}
export function cycleSpeed() {
  const cur = SPEEDS.indexOf(playbackSpeed);
  const next = (cur + 1) % SPEEDS.length;
  setSpeed(SPEEDS[next]);
}

document.addEventListener('DOMContentLoaded', () => { initDrop(); });

// Attendre __TAURI__ avant de démarrer (fix build MSI)
function waitForTauri(cb, n = 0) {
  if (window.__TAURI__?.core?.invoke) { cb(); }
  else if (n < 200) { setTimeout(() => waitForTauri(cb, n + 1), 25); }
  else { console.warn('[LibreFlow] __TAURI__ non disponible'); cb(); }
}

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
});

let _globalResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_globalResizeTimer);
  _globalResizeTimer = setTimeout(() => {
    onResizeNowPlaying();
    reclampMiniOverlay();
    reflowMarquee();
  }, 180);
});

waitForTauri(() => {
  boot().catch(e => console.error('[LibreFlow] boot failed:', e));
  initShortcuts({ updateVolSlider, closeModal, cycleSpeed });
  initMediaSession(audio, { prev, next, toggleLike, ensureEQResumed });
  initMiniOverlayDrag();
  initRipple();
  initKeyNav({ reorderTrack: movePlaylistTrack });

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
    else if (cmd === 'volume-down') { const vel=document.getElementById('vol'); const _c=vel?parseFloat(vel.value):(masterGainNode?masterGainNode.gain.value:1); const v=Math.max(0,_c-0.05); setMasterGain(v); if(vel){vel.value=v; updateVolSlider(vel); setAriaValueText(vel, _v => `${Math.round(_v * 100)} pour cent`, v);} saveCfg(); _allPlayerUI(); }
    else if (cmd === 'volume-up')   { const vel=document.getElementById('vol'); const _c=vel?parseFloat(vel.value):(masterGainNode?masterGainNode.gain.value:1); const v=Math.min(1,_c+0.05); setMasterGain(v); if(vel){vel.value=v; updateVolSlider(vel); setAriaValueText(vel, _v => `${Math.round(_v * 100)} pour cent`, v);} saveCfg(); _allPlayerUI(); }
    else if (cmd === 'volume-set' && data != null) { const v=Math.max(0,Math.min(1,data)); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel); setAriaValueText(vel, _v => `${Math.round(_v * 100)} pour cent`, v);} saveCfg(); _allPlayerUI(); } // QW-10
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

/** Jouer un album ou artiste depuis sa card grid (hover play button). */
export function playCardByKey(from, key, displayName) {
  _withVT(() => {
    drillDown(from, key, displayName);
    setTimeout(() => playPlaylistFrom(0), 80);
  });
}

export async function clearAppCache() {
  const ok = await confirmAction(
    'Vider les caches ?',
    'Toutes les données seront supprimées : bibliothèque, configuration, playlists et historique d\'écoute.\n\nL\'application redémarrera automatiquement.',
    'Vider et redémarrer', 'danger'
  );
  if (!ok) return;
  // 1. Annuler les timers de sauvegarde différée AVANT de fermer la DB.
  //    Sans ça, un debounce en attente peut écrire sur une DB déjà fermée → crash IDB.
  cancelTrackBatch();
  cancelPlayLogFlush();
  // 2. Fermer la connexion IDB.
  if (DB) { try { DB.close(); } catch(e) { console.warn('[app:DB.close]', e); } }
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

/** Annule les timers de fond (artwork retry, orphelins) et les batches IDB en attente. */
function _clearLibraryTimersAndBatches() {
  clearTimeout(_retryArtTimer); _retryArtTimer = null; // FIX #21
  clearTimeout(_orphansTimer);  _orphansTimer  = null; // FIX #22
  cancelTrackBatch();
  cancelPlayLogFlush();
  setPlayLog([]);
}

export async function clearLibrary() {
  closeModal();
  // Fermer tous les panneaux ouverts avant de vider l'état (évite l'affichage de données périmées)
  closeNowPlaying();
  clearQueuePin(); closeQueue();
  clearQueueOverride();
  closeEQ();
  if (cinemaOpen) closeCinema();
  _clearLibraryTimersAndBatches();
  _clearLibraryState();
  _clearLibraryDOM();
  await _clearLibraryIDB();
  _clearLibraryView();
  toast(i18n('t_cleared'), 'success');
}

