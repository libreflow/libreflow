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
import { get, set, subscribe, setBatch }                   from './store.js';
import { CFG, SORTS, SLBLS, SPEEDS, SPEED_LBLS } from './cfg.js';
import { openDB, tx, dget, dall, dput, ddel, DB } from './db.js';
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
import { checkForUpdate } from './updater.js';
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
} from './playlists.js';

import { initWaveform, wfLoad, wfClear } from './waveform.js';
import { toggleNowPlaying, closeNowPlaying, updateNowPlaying } from './nowplaying.js';
import {
  initSettingsVars, getTheme, getDynColor, getDisplayMode, getVinylSpin, isShortcutsOpen,
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
} from './views.js';
import { _showSkeletonRows,
         virtRenderWindow, virtAttachScroll,
         renderLib, renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid,
         drillDown, updatePlActionBar, updateBreadcrumb,
         makeLikeBtn, makeAddBtn, makeEqHTML, artPlaceholder, hlText, thtml,
         playById, patchActiveTrack, patchPlayState, patchTrackEl,
         scheduleStatsUpdate, updateStats,
         _withVT, animateViewChange, scrollToCurrentTrack } from './renderer.js';
// Wrapper : met à jour le mini-player Tauri ET l'overlay in-page simultanément.
export function _allPlayerUI() { updateMiniPlayer(); syncMiniOverlay(); }
import { showCtxMenu, closeCtxMenu, ctxToggleLike, ctxDeleteTrack, ctxEditTags, ctxGoToArtist, ctxGoToAlbum, ctxNewPlaylist, ctxRemoveFromPlaylist, ctxSmartPlaylist, ctxPlayNext, ctxAddToQueueEnd, ctxCopyInfo } from './ctxmenu.js';

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
let shuffle = false;    // shuffleQ est dans player.js
let repeat  = 'none';  // none | all | one
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
let _lastNotifTrackId = null;
let _saveCfgTimer     = null;
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
      vinylSpin:   cfg.vinylSpin === true,
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
    tracks = saved.map(r => {
      // Re-apply mainArtist on load to fix any old bad data in DB
      const artistFull = r.artistFull || r.artist || i18n('unknown_artist');
      const artist     = mainArtist(artistFull) || artistFull;
      return {
        id: r.id, name: r.name,
        artist,            // canonical main artist
        artistFull,        // full string incl. featuring
        album: r.album,
        ext: r.ext, path: r.path, duration: r.duration,
        dateAdded: r.dateAdded,
        // ART-IDB : artBuf (ArrayBuffer) depuis IDB v5+ ; artB64 en compat anciens enregistrements
        art: r.artBuf
          ? URL.createObjectURL(new Blob([r.artBuf], { type: r.artMime || 'image/jpeg' }))
          : (r.artB64 || null),
        _artBuf:  r.artBuf  || null,
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
      };
    });
    set('tracks', tracks); emit(EVENTS.LIBRARY_UPDATED, { tracks }); // Jalon 3/4
    rebuildTrackIdxMap(); // FIX #3 — doit précéder updateStats() et renderLib()

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
      autoUpdateChk.checked = cfg.autoUpdate !== false;
      autoUpdateChk.addEventListener('change', () => {
        cfg.autoUpdate = autoUpdateChk.checked;
        saveCfg();
      });
    }

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
    applyLang();
    setMode(getDisplayMode());
    document.getElementById('pc-shuf')?.classList.toggle('on', shuffle);
    document.getElementById('pc-shuf')?.setAttribute('aria-pressed', String(shuffle));
    document.getElementById('pc-rep')?.classList.toggle('on', repeat !== 'none');
    document.getElementById('pc-rep')?.setAttribute('aria-pressed', String(repeat !== 'none'));
    if (getWatchPath()) updateWatchUI();
    setTimeout(updateVolSlider, 100);
    if (playbackSpeed !== 1) setSpeed(playbackSpeed);
    const rgChk2 = document.getElementById('rg-enabled');
    if (rgChk2) rgChk2.checked = rgEnabled;
    const rgSlider2 = document.getElementById('rg-target');
    if (rgSlider2) rgSlider2.value = rgTargetLUFS;
    const rgLbl2 = document.getElementById('rg-target-lbl');
    if (rgLbl2) rgLbl2.textContent = rgTargetLUFS + ' LUFS';
    const autoUpdateChk2 = document.getElementById('auto-update-chk');
    if (autoUpdateChk2) {
      autoUpdateChk2.checked = cfg.autoUpdate !== false;
      autoUpdateChk2.addEventListener('change', () => {
        cfg.autoUpdate = autoUpdateChk2.checked;
        saveCfg();
      });
    }
  }
  // Vérifier les mises à jour 10s après le boot (non bloquant, silencieux si pas configuré)
  if (cfg.autoUpdate !== false) {
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
  }, { target: { kind: 'Any' } }).then(u => _unlisteners.push(u));
  window.addEventListener('pagehide', () => { _unlisteners.forEach(u => { try { u(); } catch {} }); });

  // ── Sauvegarde complète avant fermeture ──────────────────────────────────
  // beforeunload seul ne suffit pas sous Tauri : les promises async ne sont pas attendues.
  // On intercepte CloseRequested (Tauri v2) pour bloquer la fermeture le temps de tout flusher.
  // Fallback : beforeunload synchrone pour les cas où Tauri n'est pas dispo (dev web).
  async function _flushAllAndClose() {
    // Bug #20 fix : catch silencieux remplacé par un log d'avertissement.
    // return explicite pour confirmer la résolution (utile pour onCloseRequested + await).
    try {
      // 1. cfg (curTrackId, curPos, liked, volume, shuffle, repeat…)
      if (_saveCfgTimer) { clearTimeout(_saveCfgTimer); _saveCfgTimer = null; }
      // 2. Toutes les saves en parallèle — allSettled garantit qu'aucune rejection ne coupe les autres
      await Promise.allSettled([
        _doSaveCfg(),
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
export function playPlaylistFrom(fi) {
  // Si une recherche est active, ignorer le filtre et jouer depuis la liste complète
  // (comportement attendu : "Lire tout" joue tout, pas seulement les résultats de recherche)
  if (get('query')) {
    set('query', '');
    invalidateFilter();
    const el = document.getElementById('srch');
    if (el) el.value = '';
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
  }
  const fl = getFiltered();
  if (!fl.length) return;
  playAt(Math.min(fi, fl.length - 1));
}
/**
 * Lire une playlist directement depuis la sidebar sans changer de vue.
 * Si la vue courante n'est pas la playlist visée, bascule vers elle puis joue.
 */
export function playPlaylistDirect(plId, event) {
  if (event) event.stopPropagation();
  const navBtn = document.getElementById('ni-pl-' + plId);
  // Basculer vers la playlist (met à jour curPlId + invalide le filtre, sync)
  setView('playlist', navBtn, plId);
  // getFiltered() est maintenant correct — jouer le premier titre
  requestAnimationFrame(() => playPlaylistFrom(0));
}
export async function shufflePlaylist() {
  const fl = getFiltered();
  if (!fl.length) return;
  const ri = Math.floor(Math.random() * fl.length);
  // Attendre playAt pour que curIdx et le cache soient à jour avant buildQ()
  await playAt(ri);
  shuffle = true;
  set('shuffle', true);
  const _shufBtn = document.getElementById('pc-shuf');
  _shufBtn?.classList.add('on');
  _shufBtn?.setAttribute('aria-pressed', 'true');
  const _cinShufBtn = document.getElementById('cinema-shuf');
  _cinShufBtn?.classList.add('on');
  _cinShufBtn?.setAttribute('aria-pressed', 'true');
  buildQ(); // buildQ() utilise maintenant getFiltered() avec le bon curIdx
  _allPlayerUI();
}

// ══ Drag & Drop ═════════════════════════════════
let drago = null;
// Compteur dragenter/dragleave — évite le flickering sur WebView2
// (e.relatedTarget est parfois null même en intra-fenêtre sur Windows)
let _dragDepth = 0;
// FIX DRAG-MODULE : handlers déclarés ici pour être définis avant DOMContentLoaded,
// mais attachés dans DOMContentLoaded (après drago = getElementById).
function _onDragEnter(e){ e.preventDefault(); _dragDepth++; if (drago) drago.classList.add('on'); }
function _onDragOver(e) { e.preventDefault(); }
function _onDragLeave(e){ _dragDepth = Math.max(0, _dragDepth - 1); if (drago && _dragDepth === 0) drago.classList.remove('on'); }
async function _onDrop(e){
  e.preventDefault(); _dragDepth = 0; if (drago) drago.classList.remove('on');
  const EXTS=new Set(['mp3','flac','aac','m4a','ogg','opus','wav','wma','aiff','ape','alac']);
  const items = [...e.dataTransfer.items];
  const allFiles = [];

  // Support dossiers via DataTransferItem API
  async function traverseEntry(entry) {
    if (entry.isFile) {
      await new Promise(res => entry.file(f => { allFiles.push(f); res(); }));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries() retourne max 100 entrées à la fois — boucler jusqu'au tableau vide
      const readAll = () => new Promise(res => {
        const batch = [];
        const readBatch = () => {
          reader.readEntries(async entries => {
            if (!entries.length) { res(batch); return; }
            batch.push(...entries);
            readBatch(); // continuer jusqu'à la fin
          }, (err) => { console.warn('[drop] readEntries error', err); res(batch); }); // FIX #10
        };
        readBatch();
      });
      const allEntries = await readAll();
      for (const sub of allEntries) await traverseEntry(sub);
    }
  }

  if (items.length && items[0].webkitGetAsEntry) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) await traverseEntry(entry);
    }
  } else {
    allFiles.push(...e.dataTransfer.files);
  }

  const audioFiles = allFiles.filter(f => EXTS.has(f.name.split('.').pop().toLowerCase()));
  if (!audioFiles.length) { toast(i18n('t_drag_hint'), 'warning'); return; }

  showView('scan');
  const newTracks=[];
  for (const file of audioFiles) {
    // Dédup : comparer les basenames (file.webkitRelativePath est toujours vide en drag-drop Tauri).
    // Fonctionne pour t.path = nom seul (drag-drop) ou chemin complet (scan dossier).
    const _dnL = file.name.toLowerCase();
    if (tracks.some(t => t.path.split(/[/\\]/).pop().toLowerCase() === _dnL)) continue;
    const ext=file.name.split('.').pop().toUpperCase();
    const url=URL.createObjectURL(file);
    const dur=await new Promise(res=>{
      const a=new Audio(); a.preload='metadata'; a.src=url;
      const done=(v)=>{ a.src=''; a.load(); res(v); }; // BUG FIX F5 : libérer l'Audio temporaire
      a.addEventListener('loadedmetadata',()=>done(a.duration||0),{once:true});
      a.addEventListener('error',()=>done(0),{once:true});
      setTimeout(()=>done(a.duration||0),3000);
    });
    const t={id:crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now(),name:file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim(),artist:i18n('unknown_artist'),artistFull:i18n('unknown_artist'),album:'',ext,path:file.webkitRelativePath||file.name,duration:dur,dateAdded:Date.now(),art:null,artColor:null,url,file,metaDone:false};
    newTracks.push(t); document.getElementById('sn').textContent=newTracks.length;
  }
  tracks.push(...newTracks); set('tracks', tracks); emit(EVENTS.LIBRARY_UPDATED, { tracks }); rebuildTrackIdxMap(); invalidateFilter(); updateStats(); renderLib(); showView('lib');
  toast(i18n('t_files_added', newTracks.length), 'success');
  newTracks.forEach(t=>loadTagsBg(t));
}

// ══ Keyboard shortcuts ═══════════════════════════
document.addEventListener('keydown', e=>{
  // Ctrl+F : focus recherche — intercepté avant le guard INPUT/cinéma
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const srch = document.getElementById('srch');
    if (srch) { showView('lib'); srch.focus(); srch.select(); }
    return;
  }
  if (e.target.tagName==='INPUT') return;
  // Bloquer tous les raccourcis pendant l'édition inline de métadonnées
  if (document.querySelector('.tr.editing')) return;
  // Laisser cinema.js gérer les raccourcis quand le mode cinéma est ouvert
  if (cinemaOpen) return;
  if (e.code==='Space')      { e.preventDefault(); togglePlay(); }
  if (e.code==='ArrowRight') { e.preventDefault(); next(true); }
  if (e.code==='ArrowLeft')  { e.preventDefault(); prev(); }
  if (e.code==='ArrowUp')    { e.preventDefault(); const _cur=masterGainNode?masterGainNode.gain.value:audio.volume; const v=Math.min(1,_cur+0.05); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel);} }
  if (e.code==='ArrowDown')  { e.preventDefault(); const _cur=masterGainNode?masterGainNode.gain.value:audio.volume; const v=Math.max(0,_cur-0.05); setMasterGain(v); const vel=document.getElementById('vol'); if(vel){vel.value=v; updateVolSlider(vel);} }
  if (e.key.toLowerCase()==='s') toggleShuffle();
  if (e.key.toLowerCase()==='r') toggleRepeat();
  if (e.key === '/') { document.getElementById('srch')?.focus(); e.preventDefault(); } // FIX #25
  if (e.key.toLowerCase()==='f' && !e.ctrlKey && !e.altKey && !cinemaOpen) toggleLike();
  if (e.key.toLowerCase()==='m' && !e.ctrlKey && !e.altKey) toggleMiniPlayer();
  if (e.key.toLowerCase()==='i' && !e.ctrlKey && !e.altKey) toggleMiniOverlay();
  if (e.code==='Escape') {
    if (cinemaOpen) { closeCinema(); return; }
    if (isShortcutsOpen()) { closeShortcuts(); return; }
    if (document.getElementById('pl-modal-bg')?.classList.contains('on')) { closePlModal(); return; } // FIX #26
    if (document.getElementById('modal-bg')?.classList.contains('on')) { closeModal(); return; }
    if (document.getElementById('confirm-modal-bg')?.classList.contains('on')) { document.querySelector('#confirm-modal .mbtn.cancel')?.click(); return; }
    if (document.getElementById('ctx-menu')?.classList.contains('on')) { closeCtxMenu(); return; } // FIX #26
    if (eqOpen) { closeEQ(); return; }
    if (queueOpen) { closeQueue(); return; }
    if (document.getElementById('settings-panel')?.classList.contains('on')) { closeSettings(); return; } // FIX #27
    const srch = document.getElementById('srch');
    if (srch.value) {
      // BUG FIX : _searchDebounceTimer est une var privée de views.js (non exportée) →
      // ReferenceError en strict mode ES module. Le timer views.js expirera seul (no-op
      // puisque query sera déjà vide). Pas besoin de le clearTimeout ici.
      srch.value = ''; set('query', ''); invalidateFilter(); renderLib();
      const clr = document.getElementById('srch-clear');
      if (clr) clr.style.display = 'none';
      return;
    }
  }
  if (e.code==='F11')        { e.preventDefault(); if (window.__TAURI__) invoke('win_maximize'); }
  if (e.code==='F12' && import.meta.env.DEV) { e.preventDefault(); if (window.__TAURI__) invoke('open_devtools'); }
  if (e.key.toLowerCase()==='c' && !e.ctrlKey && !e.altKey) toggleCinema();
  // Note : 'b' (cycleCinemaBg) et 'f' (toggleCinemaFullscreen) en mode cinéma sont gérés
  // par _onCinKey dans cinema.js — ces guards `&& cinemaOpen` seraient inatteignables ici
  // car le `if (cinemaOpen) return` ci-dessus les bloque.
  if (e.key.toLowerCase()==='d' && !e.ctrlKey) detectDupes();
  if (e.key.toLowerCase()==='x' && !e.ctrlKey && !e.altKey) cycleSpeed();
  if (e.key.toLowerCase()==='v' && !e.ctrlKey && !e.altKey) {
    const _vmodes = ['bars', 'oscilloscope', 'circle'];
    setVizMode(_vmodes[(_vmodes.indexOf(getVizMode()) + 1) % _vmodes.length]);
    _syncVizBtns(true);
  }
  if (e.key === '?') toggleShortcuts();
});

// ══ Persistence ═════════════════════════════════

// Batch save : pendant un import, les appels saveTrack() sont accumulés et
// écrits ensemble toutes les 250ms (une seule transaction IDB au lieu de N).

// _flushTrackBatch, saveTrack, saveTracks, saveTrackNow → library.js

/**
 * Flush application state to IndexedDB immediately (debounced variant: saveCfg).
 * Serialises the current value of all persistent settings — sort, view, liked,
 * theme, lang, crossfade, ReplayGain, playback speed, EQ, watch folder, etc.
 *
 * @returns {Promise<void>}
 */
// Debounce pour les appels fréquents (changement de piste, crossfade…)
export function saveCfgNow() {
  if (_saveCfgTimer) { clearTimeout(_saveCfgTimer); _saveCfgTimer = null; }
  return _doSaveCfg(); // FIX #13 — retourner la Promise
}
export function saveCfg() {
  if (_saveCfgTimer) clearTimeout(_saveCfgTimer);
  _saveCfgTimer = setTimeout(_doSaveCfg, CFG.CFG_SAVE_DEBOUNCE);
}
async function _doSaveCfg() {
  _saveCfgTimer = null;
  if (!DB) return; // DB pas encore ouverte (ex: premier démarrage avant boot())
  try {
    const likedIds = [...liked]; // liked est déjà un Set<string> d'IDs
    const curTrackId = curIdx >= 0 && tracks[curIdx] ? tracks[curIdx].id : null;
    const curPos     = curTrackId && audio.duration > 0
      ? Math.floor(audio.currentTime)
      : 0;

    // ── État supplémentaire — cohérence Spotify/Deezer ────────────────────
    const volEl     = document.getElementById('vol');
    const volume    = volEl ? Math.round(parseFloat(volEl.value) * 100) / 100 : 1;
    const tlist     = document.getElementById('tlist');
    const scrollTop = tlist ? Math.round(tlist.scrollTop) : 0;
    const ovEl      = document.getElementById('mp-ov');
    const miniOvOpen = ovEl ? ovEl.classList.contains('on') : false;
    // Position de l'overlay : mémoriser seulement si elle a été déplacée (left défini)
    const miniOvPos = (ovEl && ovEl.style.left && ovEl.style.left !== '')
      ? { x: parseInt(ovEl.style.left) || 0, y: parseInt(ovEl.style.top) || 0 }
      : null;
    // Inclure les vues drill-down dans la sauvegarde (artist-detail, album-detail, genre-detail)
    const _allViews = ['all','liked','albums','artists','genres','recent','playlist','stats','album-detail','artist-detail','genre-detail'];

    await dput('cfg', {
      likedIds, sort,
      view: (_allViews.includes(view) ? view : 'all'),
      recentPlays: recentPlays.slice(0,50),
      lang: getLang(), theme: getTheme(), dynColor: getDynColor(), crossfadeDur, displayMode: getDisplayMode(), rgEnabled, rgTargetLUFS,
      playbackSpeed, cinemaBg,
      shuffle, repeat, albumSort, artistSort, genreSort, albumDetailSort,
      eqEnabled, eqGains: eqNodes.length ? eqNodes.map(n => n.gain.value) : null,
      eqPreset: getActiveEqPreset(),
      vizMode: getVizMode(), vizEnabled: getVizEnabled(), vinylSpin: getVinylSpin(),
      eqAutoMode, eqProfiles: getEQProfiles(),
      watchPath: getWatchPath(),
      curTrackId, curPos,
      miniPos: getMiniPos() ?? null,
      // Nouveaux champs
      volume, curPlId: curPlId || null, scrollTop,
      miniOvOpen, miniOvPos,
      drillKey: drillKey ?? '', drillFrom: drillFrom ?? '', drillDisplayName: drillDisplayName ?? '',
      // S91 — Vague A : organisation playlists
      plFolders, recentPls,
      // Persist modules
      heatPeriod:  getHeatPeriod(),
      queueState:  getQueueState(),
      radioSeedId: radioActive ? getRadioSeedId() : null,
      autoUpdate: cfg.autoUpdate !== false,
    }, 'state');
  } catch (e) {
    console.warn('[_doSaveCfg] IDB save failed — config non persistée:', e);
  }
}

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

// FIX DRAG-MODULE : drago + listeners attachés dans DOMContentLoaded (garantit que drago
// est défini avant tout événement drag — évite la race module-level vs DOM)
document.addEventListener('DOMContentLoaded', () => {
  drago = document.getElementById('drago');
  document.addEventListener('dragenter', _onDragEnter);
  document.addEventListener('dragover',  _onDragOver);
  document.addEventListener('dragleave', _onDragLeave);
  document.addEventListener('drop',      _onDrop);
});

// Attendre __TAURI__ avant de démarrer (fix build MSI)
function waitForTauri(cb, n = 0) {
  if (window.__TAURI__?.core?.invoke) { cb(); }
  else if (n < 200) { setTimeout(() => waitForTauri(cb, n + 1), 25); }
  else { console.warn('[LibreFlow] __TAURI__ non disponible'); cb(); }
}

waitForTauri(() => {
  boot().catch(e => console.error('[LibreFlow] boot failed:', e)); // FIX #19
  initWaveform(audio); // Waveform progress bar
  initMediaSession(); // Contrôles Windows 11 SMTC / taskbar
  initMiniOverlayDrag(); // Drag du mini-player overlay in-page
  initRipple(); // Ripple feedback sur boutons et lignes

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

/**
 * Navigue depuis le panneau Stats vers la vue genre-detail.
 * Appelé par le click sur une barre de genre dans stats.js.
 */
export function statsGoToGenre(key, displayName) {
  _withVT(() => {
    _showViewRaw('lib');
    drillGenre(key, displayName); // drillGenre importée depuis genres.js
  });
}
/** Jouer un album ou artiste depuis sa card grid (hover play button). */
export function playCardByKey(from, key, displayName) {
  _withVT(() => {
    drillDown(from, key, displayName);
    setTimeout(() => playPlaylistFrom(0), 80);
  });
}
export function statsGoToArtist(displayName) {
  _withVT(() => {
    const key = displayName.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    set('view', 'artists');
    invalidateFilterCache();
    renderArtistsGrid();
    requestAnimationFrame(() => drillDown('artists', key, displayName));
  });
}
export function statsGoToAlbum(albumKey, displayName) {
  _withVT(() => {
    set('view', 'albums');
    invalidateFilterCache();
    renderAlbumsGrid();
    requestAnimationFrame(() => drillDown('albums', albumKey, displayName));
  });
}

// ── Volume slider visual sync ──────────────────────────────────────────────
// Met à jour le remplissage CSS du slider et le tooltip vol-tip.
// Appelé depuis : oninput inline, touches fléchées, mini-cmd, boot (setTimeout).
// `el` peut être l'élément slider ou undefined (fallback sur #vol).
let _volHideTimer = 0;
export function updateVolSlider(el) {
  const vel = (el instanceof Element) ? el : document.getElementById('vol');
  if (!vel) return;
  const pct = Math.round(+vel.value * 100);
  vel.style.background = `linear-gradient(to right, var(--g) ${pct}%, var(--bg5) ${pct}%)`;
  const tip = document.getElementById('vol-tip');
  if (tip) {
    tip.textContent = pct + '%';
    // UX-10 : afficher/masquer le tooltip avec classe .on
    tip.classList.add('on');
    clearTimeout(_volHideTimer);
    _volHideTimer = setTimeout(() => tip.classList.remove('on'), 1200);
  }
}

// ── Marquee — défilement smooth des titres/artistes longs ─────────────────
// Annuler les RAF orphelins si updateBar() est rappelé avant la fin du frame
// (ex. changement de piste rapide). Sans ça, le callback orphelin accède à un span
// qui n'est plus dans le DOM et tente de lui appliquer des styles inutilement.
const _mqRafMap = new Map();
function _setupMarquee(container, text) {
  if (!container) return;
  const prevRaf = _mqRafMap.get(container);
  if (prevRaf !== undefined) { cancelAnimationFrame(prevRaf); _mqRafMap.delete(container); }
  container.textContent = '';
  const span = document.createElement('span');
  span.className = 'mq';
  span.textContent = text;
  container.appendChild(span);
  const rafId = requestAnimationFrame(() => {
    _mqRafMap.delete(container);
    if (!span.isConnected) return;
    const overflow = span.scrollWidth - container.offsetWidth;
    if (overflow > 4) {
      const shift = -(overflow + 24);
      const dur   = Math.max(6, Math.abs(shift) / 38);
      span.style.setProperty('--mq-shift', `${shift}px`);
      span.style.setProperty('--mq-dur',   `${dur}s`);
      span.classList.add('mq-on');
    }
  });
  _mqRafMap.set(container, rafId);
}

// ── Now-playing bar update ─────────────────────────────────────────────────
// Met à jour le panneau inférieur (titre, artiste, pochette, like, icône)
// et déclenche en Phase 2 les mises à jour lourdes (couleur, waveform, cinéma, notif).
export function updateBar() {
  if (curIdx < 0) return;
  const t = tracks[curIdx];
  if (!t) return; // guard : curIdx hors bornes (ex. clearLibrary pendant un event en queue)

  // Phase 1 : feedback visuel critique — même frame que l'event (INP-1)
  document.title = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')} · LibreFlow`;
  _setupMarquee(document.getElementById('pl-n'), t.name);
  _setupMarquee(document.getElementById('pl-a'), t.artistFull || t.artist || i18n('unknown_artist'));
  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  if (t.art) { img.src = t.art; img.style.display = 'block'; em.style.display = 'none'; animateArtChange(); }
  else       { img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext); }
  const _isLikedNow = liked.has(t.id);
  document.getElementById('pl-lk').classList.toggle('on', _isLikedNow);
  document.getElementById('pl-lk').setAttribute('aria-pressed', String(_isLikedNow));
  document.getElementById('cinema-lk')?.classList.toggle('on', _isLikedNow);
  document.getElementById('cinema-lk')?.setAttribute('aria-pressed', String(_isLikedNow));
  // Heart-beat : piste déjà aimée qui devient active → pulse unique
  if (_isLikedNow && t.id !== _lastNotifTrackId) {
    const _hb = document.getElementById('pl-lk');
    if (_hb) {
      void _hb.offsetWidth;
      _hb.classList.remove('popping');
      requestAnimationFrame(() => {
        _hb.classList.add('popping');
        _hb.addEventListener('animationend', () => _hb.classList.remove('popping'), { once: true });
      });
    }
  }
  setIcon(!audio.paused);
  refreshQueueBadge();
  const _shouldNotify = t.id !== _lastNotifTrackId;
  if (_shouldNotify) _lastNotifTrackId = t.id;

  // Phase 2 : opérations lourdes — différées après le premier paint
  requestAnimationFrame(() => setTimeout(() => {
    if (t.artColor) applyArtColor(t.artColor);
    else if (t.art) extractColor(t.art).then(c => { if (c) { t.artColor = c; applyArtColor(c); } }).catch(() => {});
    else clearArtColor();
    _updateArtBlur(t.art || null);
    wfLoad(t.id, t.url);
    if (cinemaOpen) updateCinema();
    if (_shouldNotify) {
      // ART-IDB : base64 généré lazily depuis _artBuf (fire-and-forget, pas bloquant)
      (async () => {
        let artUrl = null;
        if (t._b64) {
          artUrl = t._b64;
        } else if (t.art && t.art.startsWith('data:')) {
          artUrl = t.art;
        } else if (t._artBuf) {
          artUrl = await new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
          });
          t._b64 = artUrl; // cache pour le prochain changement de piste
        }
        invoke('notify_track', { data: { title: t.name, artist: t.artistFull || t.artist || '', art: artUrl } }).catch(() => {});
      })();
      updateMediaSession(t);
    }
    if (queueOpen) renderQueue();
  }, 0));
}

// ── Modal de confirmation "vider la bibliothèque" ─────────────────────────
let _modalPrevFocus = null;
let _modalFocusTrap = null;

const _MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _buildModalFocusTrap(dialogEl) {
  return function(e) {
    if (e.key !== 'Tab') return;
    const els = [...dialogEl.querySelectorAll(_MODAL_FOCUSABLE)]
      .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
}

export function confirmClear() {
  if (!tracks.length) return;
  _modalPrevFocus = document.activeElement;
  document.getElementById('modal-bg').classList.add('on');
  const modal = document.getElementById('modal');
  if (modal && !_modalFocusTrap) {
    _modalFocusTrap = _buildModalFocusTrap(modal);
    modal.addEventListener('keydown', _modalFocusTrap);
    setTimeout(() => modal.querySelector('.mbtn.cancel')?.focus(), 50);
  }
}
export function closeModal() {
  const bg = document.getElementById('modal-bg');
  bg.classList.add('modal-closing');
  bg.addEventListener('animationend', () => {
    bg.classList.remove('on', 'modal-closing');
  }, { once: true });
  setTimeout(() => bg.classList.remove('on', 'modal-closing'), 250);
  const modal = document.getElementById('modal');
  if (modal && _modalFocusTrap) {
    modal.removeEventListener('keydown', _modalFocusTrap);
    _modalFocusTrap = null;
  }
  _modalPrevFocus?.focus();
  _modalPrevFocus = null;
}

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
  closeEQ();
  if (cinemaOpen) closeCinema();
  // FIX #21/#22 — annuler les timers de retry artwork et orphelins
  clearTimeout(_retryArtTimer); _retryArtTimer = null;
  clearTimeout(_orphansTimer);  _orphansTimer  = null;
  // Annuler le batch IDB en attente (cancelTrackBatch → library.js)
  cancelTrackBatch();
  // Révoquer tous les blob URLs pour libérer la mémoire
  for (const t of tracks) {
    if (t.url)  try { URL.revokeObjectURL(t.url);  } catch {}
    if (t.art)  try { URL.revokeObjectURL(t.art);  } catch {}
  }
  tracks  = []; set('tracks', []); rebuildTrackIdxMap(); invalidateFilter(); // INVARIANT : map must stay in sync; caches filter/album/artist
  liked   = new Set(); set('liked', liked);
  playlists = []; set('playlists', []); recentPlays = []; set('recentPlays', []);
  curPlId = null; set('curPlId', null);
  plFolders = []; set('plFolders', []); recentPls = []; set('recentPls', []);
  renderPlNav();
  curIdx  = -1; set('curIdx', -1);
  shuffle = false; set('shuffle', false); resetShuffleQ();
  repeat  = 'none'; set('repeat', 'none');
  query   = ''; set('query', '');
  albumSort = 'name'; set('albumSort', 'name');
  artistSort = 'name'; set('artistSort', 'name');
  genreSort = 'count'; set('genreSort', 'count');
  albumDetailSort = 'track'; set('albumDetailSort', 'track');
  _lastNotifTrackId = null;
  // Arrêter l'audio
  audio.pause();
  audio.src = '';
  // Réinitialiser la barre player
  document.title = 'LibreFlow';
  _setupMarquee(document.getElementById('pl-n'), '–');
  _setupMarquee(document.getElementById('pl-a'), '–');
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
    await _doSaveCfg();
  } catch(e) { console.warn('[clearLibrary] DB error:', e); }
  // Réinitialiser radio, crossfade, watchfolder
  resetRadio();
  clearCrossfadeTimers();
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

// ── State mutation helpers (exported for satellite modules) ───────────────────────
/** Sync curIdx in both local state and store. Used by dupes, ctxmenu, library, selection. */
export function setCurIdx(v)     { curIdx = v; set('curIdx', v); }
/** Sync liked in both local state and store. Used by selection. */
export function setLiked(v)      { liked  = v; set('liked',  v); }
/** Sync tracks in both local state and store. Used by selection. */
export function setTracks(v)     { tracks = v; set('tracks', v); }
/** Sync ctxTrackId (context menu target). Used by ctxmenu.js. */
export function setCtxTrackId(v) { ctxTrackId = v; set('ctxTrackId', v); }
