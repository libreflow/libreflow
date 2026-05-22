// LibreFlow — handlers.js
// Phase 5 : registre d'actions centralisé — remplace les onclick="fn()" inline.
// BRIDGE-1 (session 146) : window.* entièrement éliminé — tous les
// onclick/ondblclick/oncontextmenu/onkeydown/ondragstart migrent ici.
//
// Patterns :
//   data-action="..."      + data-* params → click delegated via _ACTIONS
//   data-track-id="..."                    → dblclick, contextmenu, keydown, dragstart
//   data-pl-hero-id="..."                  → dblclick (hero cover rename)
//   data-pl-rename-id="..."                → dblclick (nav span rename)
//   data-pl-ctx-id="..."                   → contextmenu (playlist nav)
//   data-pl-folder-ctx-id="..."            → contextmenu (folder)
//   data-pl-drag-id="..."                  → dragstart (playlist nav)
//   .q-drag-handle (queue-item--explicit)  → Pointer Events via initQueueDrag()
//   data-backdrop-action="..."             → click uniquement si e.target === element
//   data-input-action="..."                → 'input' / 'change'
//
// Export : registerHandlers() — à appeler UNE SEULE FOIS au boot (main.js)

import { togglePlay, prev, next, toggleShuffle, toggleRepeat, toggleLike,
         likeat, playAt, isCurrentTrack, audio }              from './player.js';
import { toggleQueue, closeQueue, playQueueItem,
         addToQueueNext, addToQueueEnd,
         removeFromQueue, clearExplicitQueue }                 from './queue.js';
import { toggleEQ, closeEQ, applyEQPreset,
         filterEQPresets, setMasterGain,
         setEQExpert }                                         from './eq.js';
import { saveCurrentDeviceProfile, deleteDeviceProfile,
         renderDeviceProfiles }                                from './eqdevice.js';
import { organizePreview, organizeConfirm,
         organizeCancel }                                      from './organize.js';
import { exportBackup, importBackup }                          from './backup.js';
import { openUsbImportModal, closeUsbImportModal,
         importFromDrive }                                     from './devices.js';
import { closeCdModal, playCdTrack, extractCd,
         cancelCurrentRip }                                    from './cdaudio.js';
import { toggleSleepMenu, setSleepTimer, setSleepEndOfTrack,
         setSleepCustom, cancelSleepTimer }                    from './sleep.js';
import { toggleMiniOverlay }                                   from './minioverlay.js';
import { toggleMiniPlayer, openMiniAndMinimize }               from './miniplayer.js';
import { clearSelection, selAddToPlaylist, selToggleLike,
         selBatchTagEdit, selRemove, selAddBatch,
         selectionMode, toggleTrackSelection,
         closeBatchTagModal, confirmBatchTagEdit,
         bteCoverClick, bteCoverClear, bteCoverSelected }      from './selection.js';
import { closeDupes, detectDupes,
         removeDupeTrack, deleteAllDupes }                     from './dupes.js';
import { showCtxMenu, closeCtxMenu,
         ctxToggleLike, ctxDeleteTrack, ctxEditTags,
         ctxGoToArtist, ctxGoToAlbum,
         ctxNewPlaylist, ctxRemoveFromPlaylist, ctxSmartPlaylist,
         ctxPlayNext, ctxAddToQueueEnd, ctxCopyInfo, ctxWriteRG } from './ctxmenu.js';
import { toggleCinema, closeCinema, cycleCinemaBg,
         toggleCinemaFullscreen }                              from './cinema.js';
import { openRadioView, ctxStartRadio,
         radioSaveAsPlaylist, radioRegenerateFromCurrent,
         stopRadio, playRadioTrackAt, removeRadioTrack }       from './radio.js';
import { changeWatchFolder, toggleWatchFolder }               from './watchfolder.js';
import { setVizMode, setVizEnabled, getVizEnabled }            from './viz.js';
import { resolveConfirm }                                      from './ui.js';
import { setCrossfade }                                        from './player.js';
import { importM3U, exportM3U, exportXSPF }                    from './m3u.js';
import { invoke }                                              from './ipc.js';
import { cycleSpeed, closeModal, clearLibrary, confirmClear, clearAppCache, updateVolSlider, playPlaylistFrom, shufflePlaylist, playPlaylistDirect, playCardByKey, saveCfg } from './app.js';
import { _syncVizBtns, openSettings, closeSettings, toggleSettings, toggleMode, toggleShortcuts, closeShortcuts, setTheme, setMode, switchSetTab, syncMiniSettingsBtn } from './settings.js';
import { goHome, setView, nextSort, nextAlbumSort, onSearch, clearAllFilters } from './views.js';
import { setCinemaBg, toggleCinemaRadio }                      from './cinema.js';
import { rescanGenres, drillGenre }                            from './genres.js';
import { setLang }                                             from './i18n.js';
import { playById, scrollToCurrentTrack, drillDown,
         renderImportHistory }                                 from './renderer.js';
import { getFiltered, invalidateFilterCache }                  from './search.js';

// ── Module state ──────────────────────────────────────────────────────────
let _registered = false;  // Guard against double-registration during HMR

import { closePlModal, clearPlCover,
         confirmPlaylistModal, onPlCoverSelected,
         openNewPlaylistModal, openRenamePlaylistModal,
         addTrackToPlaylist,
         deletePlaylist, togglePinPlaylist, togglePlFolder,
         ctxPlayPlaylist, ctxShufflePlaylist,
         showPlCtxMenu, showPlQuickPop,
         closePlCtxMenu, getPqpTrackId, closePlQuickPop,
         pqpAdd, pqpNew,
         movePlToFolder, removePlFromFolder,
         renamePlFolder, deletePlFolder,
         onTrackDragStart, onPlNavDragStart,
         _plHeroInlineRename, _plNavInlineRename,
         showPlFolderCtxMenu, setPlSort }                      from './playlists.js';
import { switchPlTab, smartPreview,
         confirmSmartPlaylist, smartSeedSearch,
         openSmartPlaylistModal, _setSmartSeed,
         regenerateSmartPlaylist,
         addSmartRule, switchSmartMode }                       from './smartplaylist.js'; // Bug #13 fix
import { setReplayGain, setRGTarget }                          from './replaygain.js';
import { openTagEditor, saveTagEdit, cancelTagEdit }            from './tagedit.js';
import { setHeatPeriod }                                       from './stats.js';
import { get, set }                                            from './store.js';
import { toggleNowPlaying, closeNowPlaying,
         toggleNowPlayingFullscreen, cycleNpBg }              from './nowplaying.js';
import { emit, EVENTS }                                        from './bus.js';

// ── Registre d'actions ────────────────────────────────────────────────────

const _ACTIONS = {
  // ── Playback ──────────────────────────────────────────────
  'toggle-play':           ()    => togglePlay(),
  'prev':                  ()    => prev(),
  'next':                  ()    => next(true),
  'toggle-shuffle':        ()    => toggleShuffle(),
  'toggle-repeat':         ()    => toggleRepeat(),
  'toggle-like':           ()    => toggleLike(),
  'cycle-speed':           ()    => cycleSpeed(),

  // ── Mini-player / overlay ─────────────────────────────────
  'toggle-mini-player':    async () => { await toggleMiniPlayer(); syncMiniSettingsBtn(); },
  'toggle-mini-overlay':   ()    => toggleMiniOverlay(),

  // ── Now Playing ───────────────────────────────────────────
  'toggle-now-playing':    ()    => toggleNowPlaying(),
  'close-now-playing':     ()    => closeNowPlaying(),
  'toggle-np-full':        ()    => toggleNowPlayingFullscreen(),
  'cycle-np-bg':           ()    => cycleNpBg(),
  'np-drill-album':        btn  => { closeNowPlaying(); drillDown('albums',  btn.dataset.albumKey,  btn.dataset.albumName);  },
  'np-drill-artist':       btn  => { closeNowPlaying(); drillDown('artists', btn.dataset.artistKey, btn.dataset.artistName); },

  // ── Drill header ──────────────────────────────────────────
  'dh-play-all':    ()    => { const fl = getFiltered(); if (fl.length) playAt(0); },
  'dh-shuffle-all': ()    => { if (!get('shuffle')) toggleShuffle(); const fl = getFiltered(); if (fl.length) playAt(0); },
  'dh-drill-album':  btn  => drillDown('albums',  btn.dataset.albumKey,  btn.dataset.albumName),
  'dh-drill-artist': btn  => drillDown('artists', btn.dataset.artistKey, btn.dataset.artistName),

  // ── Queue ─────────────────────────────────────────────────
  'toggle-queue':          ()    => { closeNowPlaying(); toggleQueue(); },
  'close-queue':           ()    => closeQueue(),
  'clear-queue':           ()    => clearExplicitQueue(),
  'remove-from-queue':     btn  => { removeFromQueue(btn.dataset.trackId); },

  // ── EQ ────────────────────────────────────────────────────
  'toggle-eq':             ()    => { closeNowPlaying(); toggleEQ(); },
  'close-eq':              ()    => closeEQ(),
  'eq-preset':             btn  => applyEQPreset(btn.dataset.preset),
  'eq-mode':               btn  => setEQExpert(btn.dataset.mode === 'expert'),
  // ── Sleep timer ───────────────────────────────────────────
  'toggle-sleep':          ()    => toggleSleepMenu(),
  'sleep-timer':           btn  => setSleepTimer(+btn.dataset.minutes),
  'sleep-end-track':       ()    => setSleepEndOfTrack(),
  'sleep-custom':          ()    => setSleepCustom(),
  'cancel-sleep':          ()    => cancelSleepTimer(),

  // ── Cinema ────────────────────────────────────────────────
  'toggle-cinema':         ()    => toggleCinema(),
  'close-cinema':          ()    => closeCinema(),
  'cinema-fullscreen':     ()    => toggleCinemaFullscreen(),
  'cycle-cinema-bg':       ()    => cycleCinemaBg(),
  'toggle-cinema-radio':   ()    => toggleCinemaRadio(),

  // ── Radio ─────────────────────────────────────────────────
  'open-radio':            (btn) => openRadioView(btn),
  'ctx-start-radio':       ()    => ctxStartRadio(),
  'ctx-write-rg':          ()    => ctxWriteRG(),
  'radio-save-pl':         ()    => radioSaveAsPlaylist(),
  'radio-regen':           ()    => radioRegenerateFromCurrent(),
  'radio-stop':            ()    => stopRadio(),
  'play-radio-track':      btn   => playRadioTrackAt(+btn.dataset.idx),
  'remove-radio-track':    (btn, e) => { e.stopPropagation(); removeRadioTrack(+btn.dataset.idx); },

  // ── Selection ─────────────────────────────────────────────
  'clear-selection':       ()    => clearSelection(),
  'sel-add-playlist':      ()    => selAddToPlaylist(),
  'sel-toggle-like':       ()    => selToggleLike(),
  'sel-batch-tag-edit':    ()    => selBatchTagEdit(),
  'sel-remove':            ()    => selRemove(),
  'sel-add-batch':         btn  => selAddBatch(btn.dataset.plId),

  // ── Batch tag edit modal ──────────────────────────────────
  'bte-cover-click':        ()   => bteCoverClick(),
  'bte-cover-clear':        ()   => bteCoverClear(),
  'close-batch-tag-modal':  ()   => closeBatchTagModal(),
  'confirm-batch-tag-edit': ()   => confirmBatchTagEdit(),

  // ── Context menu ──────────────────────────────────────────
  'ctx-toggle-like':       ()    => ctxToggleLike(),
  'ctx-delete':            ()    => ctxDeleteTrack(),
  'ctx-edit-tags':         ()    => ctxEditTags(),
  'ctx-go-artist':         ()    => ctxGoToArtist(),
  'ctx-go-album':          ()    => ctxGoToAlbum(),
  'ctx-new-playlist':      ()    => ctxNewPlaylist(),
  'ctx-remove-pl':         ()    => ctxRemoveFromPlaylist(),
  'ctx-smart-playlist':    ()    => ctxSmartPlaylist(),
  'ctx-play-next':         ()    => ctxPlayNext(),
  'ctx-add-queue-end':     ()    => ctxAddToQueueEnd(),
  'ctx-copy-info':         ()    => ctxCopyInfo(),
  'add-track-to-pl':       btn  => { addTrackToPlaylist(btn.dataset.trackId, btn.dataset.plId); closeCtxMenu(); },

  // ── Dupes ─────────────────────────────────────────────────
  'close-dupes':           ()    => closeDupes(),
  'detect-dupes':          ()    => detectDupes(),
  'delete-all-dupes':      ()    => deleteAllDupes(),
  'remove-dupe-track':     btn  => removeDupeTrack(btn.dataset.id, +btn.dataset.gi, +btn.dataset.ti),

  // ── Library ───────────────────────────────────────────────
  'open-folder':           async () => { await toggleWatchFolder(); },
  'import-m3u':            ()    => importM3U(),
  'export-m3u':            ()    => exportM3U(),
  'export-xspf':           ()    => exportXSPF(),

  // ── Settings + action combinée ────────────────────────────
  'settings-open-folder':  async () => { closeSettings(); await toggleWatchFolder(); },
  'settings-import-m3u':   ()    => { closeSettings(); importM3U(); },
  'settings-export-m3u':   ()    => { closeSettings(); exportM3U(); },
  'settings-export-xspf':  ()    => { closeSettings(); exportXSPF(); },
  'settings-rescan-genres':()    => { closeSettings(); rescanGenres(); },
  'settings-detect-dupes': ()    => { closeSettings(); detectDupes(); },
  'settings-confirm-clear':()    => { closeSettings(); confirmClear(); },
  'settings-clear-cache':  ()    => { closeSettings(); clearAppCache(); },

  // ── Watch folder ──────────────────────────────────────────
  'change-watch-folder':   async () => { await changeWatchFolder(); saveCfg(); },

  // ── Visualiseur ───────────────────────────────────────────
  'viz-bars':        ()    => { setVizMode('bars');         _syncVizBtns(true); },
  'viz-oscilloscope':()    => { setVizMode('oscilloscope'); _syncVizBtns(true); },
  'viz-circle':      ()    => { setVizMode('circle');       _syncVizBtns(true); },
  'viz-toggle':      ()    => { setVizEnabled(!getVizEnabled()); _syncVizBtns(true); },

  // ── Window controls ───────────────────────────────────────
  'win-minimize':    ()    => openMiniAndMinimize(),
  'win-maximize':    ()    => invoke('win_maximize'),
  'win-close':       ()    => invoke('win_close'),

  // ── Settings — appearance ─────────────────────────────────
  'set-lang':              btn  => { setLang(btn.dataset.lang); saveCfg(); },
  'set-mode':              btn  => setMode(btn.dataset.mode),
  'set-cinema-bg':         btn  => setCinemaBg(btn.dataset.bg),

  // ── EQ device profiles ───────────────────────────────────
  'save-device-eq': () => {
    saveCurrentDeviceProfile();
    saveCfg();
  },
  'delete-device-eq': (btn) => {
    const deviceId = btn.dataset.deviceId;
    if (!deviceId) return;
    deleteDeviceProfile(deviceId);
    saveCfg();
  },

  // ── Organize ──────────────────────────────────────────────
  'organize-trigger': async (btn) => {
    const scheme = btn.dataset.scheme || 'artist-album';
    await organizePreview(scheme);
  },

  'organize-confirm': async () => {
    await organizeConfirm();
  },

  'organize-cancel': () => {
    organizeCancel();
  },

  'backup-export': async () => {
    await exportBackup(false);
  },

  'backup-import': async () => {
    await importBackup();
  },

  'usb-open-modal': async () => {
    await openUsbImportModal();
  },

  'usb-scan': async (btn) => {
    const path = btn.dataset.path || '';
    if (!path) return;
    await importFromDrive(path);
  },

  'usb-cancel': () => {
    closeUsbImportModal();
  },

  'usb-refresh': async () => {
    await openUsbImportModal(); // re-renders the list
  },

  // ── CD audio ──────────────────────────────────────────────
  // Drive path is read from the TOC stashed on #cd-modal-bg by openCdModal,
  // matching the existing modal-element-stash pattern (avoids polluting window).
  'cd-play': async () => {
    const drive = document.getElementById('cd-modal-bg')?._toc?.drive;
    if (drive) await playCdTrack(drive, 1);
  },
  'cd-extract': async () => {
    const drive = document.getElementById('cd-modal-bg')?._toc?.drive;
    if (drive) await extractCd(drive);
  },
  'cd-cancel-modal': () => {
    closeCdModal();
  },
  'cd-cancel-rip': async () => {
    await cancelCurrentRip();
  },

  // ── EQ — filtrage des presets ─────────────────────────────
  'filter-eq-presets':     btn  => filterEQPresets(btn.dataset.cat),

  // ── Queue / Library ───────────────────────────────────────
  'scroll-to-current':     ()   => scrollToCurrentTrack(),

  // ── Search clear ─────────────────────────────────────────
  'clear-search':          ()   => {
    const s = document.getElementById('srch');
    if (s) { s.value = ''; onSearch(''); s.focus(); }
    const c = document.getElementById('srch-clear');
    if (c) c.style.display = 'none';
  },

  // ── ERG-P1 : Effacer TOUS les filtres (search + format + drill) ─────────
  'clear-filters':         ()   => clearAllFilters(),

  // ── Misc (app.js) ─────────────────────────────────────────
  // UX-Ergo : 'open-settings' devient un toggle — re-presser le bouton ferme le panneau.
  // Le nom data-action est conservé pour la compatibilité HTML existante.
  'open-settings':         ()    => toggleSettings(),
  'close-settings':        ()    => closeSettings(),
  'toggle-mode':           ()    => toggleMode(),
  'go-home':               ()    => goHome(),
  'toggle-shortcuts':      ()    => toggleShortcuts(),
  'close-shortcuts':       ()    => closeShortcuts(),
  'set-view':              btn  => {
    // BUG-5 FIX : null-safe (getElementById peut renvoyer null → classList.add TypeError)
    const niEl = (btn.dataset.niId && document.getElementById(btn.dataset.niId)) || btn;
    setView(btn.dataset.view, niEl, btn.dataset.plId || undefined);
  },
  'next-sort':             ()    => nextSort(),
  'next-album-sort':       ()    => nextAlbumSort(),
  'filter-format': (btn) => {
    const fmt = btn.dataset.fmt ?? '';
    set('formatFilter', fmt);
    invalidateFilterCache();
    emit(EVENTS.FILTER_CHANGED, {});
    saveCfg();
  },
  'set-theme':             btn  => setTheme(btn.dataset.theme),
  'set-tab': (btn) => {
    const tab = btn.dataset.tab;
    switchSetTab(tab);
    if (tab === 'library') renderImportHistory();
    if (tab === 'audio')   renderDeviceProfiles();
  },
  'pl-tab':                btn  => switchPlTab(btn.dataset.tab),
  'close-modal':           ()    => closeModal(),
  'clear-library':         ()    => clearLibrary(),
  'close-pl-modal':        ()    => closePlModal(),
  'clear-pl-cover':        ()    => clearPlCover(),
  'pl-cover-click':        ()    => document.getElementById('pl-cover-file')?.click(),
  'bte-cover-file-click':  ()    => document.getElementById('bte-cover-file')?.click(),
  'confirm-playlist':      ()    => confirmPlaylistModal(),
  'smart-preview':         ()    => smartPreview(),
  'confirm-smart-pl':      ()    => confirmSmartPlaylist(),
  'spl-add-rule':          ()    => addSmartRule(),          // Bug #13 fix : bouton "+ règle"
  'spl-mode':              btn  => switchSmartMode(btn.dataset.mode), // Bug #13 fix : switch mode
  'confirm-resolve-yes':   ()    => resolveConfirm(true),
  'confirm-resolve-no':    ()    => resolveConfirm(false),

  // ── Grid cards — hover play button ───────────────────────
  'play-card': (btn, e) => {
    e.stopPropagation();
    const card = btn.closest('.card');
    if (card) playCardByKey(card.dataset.from, card.dataset.key, card.dataset.display);
  },

  // ── BRIDGE-1 : anciens onclick inline ────────────────────

  // Playback / tracks
  'play-track': btn => {
    const id = btn.dataset.trackId;
    if (isCurrentTrack(id)) { togglePlay(); return; }
    playById(id);
  },
  'track-click':           (btn, e) => {
    if (e.ctrlKey || e.metaKey || selectionMode)
      toggleTrackSelection(btn.dataset.trackId, e);
    else
      playById(btn.dataset.trackId);
  },
  'open-tag-editor':       (btn, e) => { e.stopPropagation(); openTagEditor(btn.dataset.trackId); },
  'save-tag-edit':         btn  => saveTagEdit(btn.dataset.trackId),
  'cancel-tag-edit':       ()   => cancelTagEdit(),
  'likeat':                (btn, e) => likeat(e, btn.dataset.trackId, btn),
  'play-queue-item':       btn  => playQueueItem(btn.dataset.trackId),

  // Genres + grilles drill-down
  'drill-genre':           btn  => drillGenre(btn.dataset.key, btn.dataset.name),
  'drill-album':           btn  => drillDown('albums',  btn.dataset.key, btn.dataset.name),
  'drill-artist':          btn  => drillDown('artists', btn.dataset.key, btn.dataset.name),
  'rescan-genres':         ()   => rescanGenres(),

  // Breadcrumb
  'bc-navigate':           btn  => {
    const idx = parseInt(btn.dataset.bcIdx, 10);
    if (idx === 0) {
      const drillFrom = get('drillFrom');
      if (drillFrom) setView(drillFrom);
    }
  },

  // Stats
  'heat-period':           btn  => setHeatPeriod(+btn.dataset.days),

  // Playlists — lecture
  'play-pl-from':          ()   => playPlaylistFrom(0),
  'shuffle-cur-pl':        ()   => shufflePlaylist(),
  'play-pl-direct':        (btn, e) => playPlaylistDirect(btn.dataset.plId, e),
  'regen-cur-pl':          ()   => regenerateSmartPlaylist(get('curPlId')),
  'rename-cur-pl':         ()   => openRenamePlaylistModal(get('curPlId')),
  'delete-cur-pl':         (btn, e) => deletePlaylist(e, get('curPlId')),

  // Playlists — modals / actions
  'new-playlist':          ()   => openNewPlaylistModal(),
  'rename-pl':             btn  => { openRenamePlaylistModal(btn.dataset.plId); closePlCtxMenu(); },
  'delete-pl':             (btn, e) => { deletePlaylist(e, btn.dataset.plId); closePlCtxMenu(); },
  'toggle-pin-pl':         btn  => { togglePinPlaylist(btn.dataset.plId); closePlCtxMenu(); },
  'toggle-pl-folder':      btn  => togglePlFolder(btn.dataset.folderId),
  'show-pl-ctx':           (btn, e) => { e.stopPropagation(); showPlCtxMenu(e, btn.dataset.plId); },
  // S157 FIX-4 : ouvre le menu ••• pour la playlist courante (rename/delete déplacés ici)
  'show-cur-pl-menu':      (btn, e) => {
    e.stopPropagation();
    const plId = get('curPlId');
    if (!plId) return;
    // Positionner le menu sous le bouton ••• (anchored)
    const r = btn.getBoundingClientRect();
    const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {}, clientX: r.right, clientY: r.bottom + 4 };
    showPlCtxMenu(fakeEvent, plId);
  },
  'show-pl-qpop':          (btn, e) => showPlQuickPop(e, btn.dataset.trackId, btn), // B16 : passer le bouton déclencheur
  'pqp-add':               btn  => pqpAdd(btn.dataset.plId),
  'pqp-new':               ()   => pqpNew(),
  'pqp-smart':             ()   => { closePlQuickPop(); openSmartPlaylistModal(getPqpTrackId()); },
  'ctx-play-pl':           btn  => ctxPlayPlaylist(btn.dataset.plId),
  'ctx-shuffle-pl':        btn  => ctxShufflePlaylist(btn.dataset.plId),
  'move-pl-folder':        (btn, e) => { e.stopPropagation(); movePlToFolder(btn.dataset.plId, btn.dataset.folderId); closePlCtxMenu(); },
  'remove-pl-folder':      btn  => { removePlFromFolder(btn.dataset.plId); closePlCtxMenu(); },
  'rename-pl-folder':      btn  => { renamePlFolder(btn.dataset.folderId); closePlCtxMenu(); },
  'delete-pl-folder':      btn  => { deletePlFolder(btn.dataset.folderId); closePlCtxMenu(); },

  // Smart playlist
  'set-smart-seed':        btn  => _setSmartSeed(btn.dataset.trackId),
};

// ── Delegation de clic ────────────────────────────────────────────────────

function _handleClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const handler = _ACTIONS[action];
  if (handler) {
    e._lfActionHandled = true; // B25 FIX : marqueur — empêche _handleBackdropClick de re-déclencher
    handler(btn, e);
  } else {
    console.warn('[handlers] Action inconnue :', action);
  }
}

function _handleBackdropClick(e) {
  // B25 FIX : si _handleClick a déjà traité un data-action sur cet event, ne pas
  // re-déclencher — un élément portant data-action ET data-backdrop-action
  // exécuterait l'action deux fois.
  if (e._lfActionHandled) return;
  const el = e.target.closest('[data-backdrop-action]');
  if (el && e.target === el) {
    const action = el.dataset.backdropAction;
    const handler = _ACTIONS[action];
    if (handler) handler(el, e);
  }
}

// ── Delegation d'input ────────────────────────────────────────────────────

function _handleInput(e) {
  const el = e.target.closest('[data-input-action]');
  if (!el) return;
  switch (el.dataset.inputAction) {

    case 'vol': {
      const v = +el.value;
      // DSP-5 : volume via masterGainNode (graph) — fallback audio.volume si graph absent
      setMasterGain(v);
      updateVolSlider(el);
      // A11Y : aria-valuetext humain ("74%") au lieu de "0.74" lu brut par les SR.
      el.setAttribute('aria-valuetext', `${Math.round(v * 100)} %`);
      break;
    }

    case 'cinema-vol': {
      const main = document.getElementById('vol');
      const v = +el.value;
      setMasterGain(v);
      if (main) { main.value = el.value; updateVolSlider(main); }
      el.setAttribute('aria-valuetext', `${Math.round(v * 100)} %`);
      main?.setAttribute('aria-valuetext', `${Math.round(v * 100)} %`);
      break;
    }

    case 'search': {
      onSearch(el.value);
      const clr = document.getElementById('srch-clear');
      if (clr) clr.style.display = el.value ? 'flex' : 'none';
      break;
    }

    case 'smart-seed-search':
      smartSeedSearch(el.value);
      break;

    case 'spl-rules-preview':        // combinator AND/OR change → re-preview
    case 'smart-preview-if-visible':
      if (document.getElementById('smart-preview')?.style.display !== 'none') {
        smartPreview();
      }
      break;

    case 'pl-cover-selected':
      onPlCoverSelected(e);
      break;

    case 'bte-cover-selected':
      bteCoverSelected(el);
      break;

    case 'rg-enabled':
      setReplayGain(el.checked);
      break;

    case 'rg-target':
      setRGTarget(+el.value);
      // A11Y : "-14 LUFS" lu correctement au lieu de "-14"
      el.setAttribute('aria-valuetext', `${el.value} LUFS`);
      break;

    case 'crossfade':
      setCrossfade(+el.value);
      // A11Y : "5 secondes" au lieu de "5"
      el.setAttribute('aria-valuetext', el.value === '0' ? 'Désactivé' : `${el.value} secondes`);
      break;

    // S157 FIX-2 : tri playlist (remplace l'inline onchange="setPlSort(...)")
    case 'pl-sort':
      setPlSort(el.value);
      break;
  }
}

// ── Delegated listeners — events autres que click ────────────────────────────

function _handleDblClick(e) {
  // Playlist hero cover — inline rename
  const hero = e.target.closest('[data-pl-hero-id]');
  if (hero) { _plHeroInlineRename(hero.dataset.plHeroId); return; }
  // Playlist nav span — inline rename (this = span)
  const span = e.target.closest('[data-pl-rename-id]');
  if (span) { e.stopPropagation(); _plNavInlineRename(span.dataset.plRenameId, span); return; }
  // Track row — play track (tag editor accessible via context menu)
  const tr = e.target.closest('[data-track-id]');
  if (tr) { playById(tr.dataset.trackId); return; }
}

function _handleContextMenu(e) {
  // Playlist folder — folder context menu
  const folder = e.target.closest('[data-pl-folder-ctx-id]');
  if (folder) { e.preventDefault(); e.stopPropagation(); showPlFolderCtxMenu(e, folder.dataset.plFolderCtxId); return; }
  // Playlist nav item — playlist context menu
  const plNav = e.target.closest('[data-pl-ctx-id]');
  if (plNav) { e.preventDefault(); e.stopPropagation(); showPlCtxMenu(e, plNav.dataset.plCtxId); return; }
  // Track row — track context menu
  const tr = e.target.closest('[data-track-id]');
  if (tr) { e.preventDefault(); showCtxMenu(e, tr.dataset.trackId); return; }
}

function _handleKeydown(e) {
  // A11Y BLOCKER (WCAG 2.1.1) : seek bar #pbar opérable au clavier.
  // ArrowLeft/Right ±5s, ArrowUp/Down ±10s, PageUp/Down ±10s, Home/End début/fin.
  // updateBar() (player.js) ré-écrira aria-valuenow / aria-valuetext sur le tick suivant.
  if (e.target.id === 'pbar' && audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    const dur = audio.duration;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':   audio.currentTime = Math.min(dur, audio.currentTime + 5);  break;
      case 'ArrowLeft':
      case 'ArrowDown': audio.currentTime = Math.max(0,   audio.currentTime - 5);  break;
      case 'PageUp':    audio.currentTime = Math.min(dur, audio.currentTime + 10); break;
      case 'PageDown':  audio.currentTime = Math.max(0,   audio.currentTime - 10); break;
      case 'Home':      audio.currentTime = 0;   break;
      case 'End':       audio.currentTime = dur; break;
      default:          handled = false;
    }
    if (handled) { e.preventDefault(); return; }
  }

  if (e.key !== 'Enter' && e.key !== ' ') return;
  // sleep-custom-key: Enter on #sleep-custom-input → setSleepCustom()
  if (e.key === 'Enter' && e.target.id === 'sleep-custom-input') {
    e.preventDefault();
    setSleepCustom();
    return;
  }
  // BUG-1 FIX : ne pas intercepter si le focus est dans un champ de saisie ou
  // du contenu éditable (ex. éditeur de tags inline, renommage playlist).
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'
      || e.target.isContentEditable) return;
  // Éléments non-button/link avec data-action (ex: .sb-brand role=button) → simuler click
  const tag = e.target.tagName;
  if (tag !== 'BUTTON' && tag !== 'A') {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl && actionEl.tagName !== 'BUTTON' && actionEl.tagName !== 'A') {
      e.preventDefault();
      actionEl.click();
      return;
    }
  }
  const el = e.target.closest('[data-track-id]');
  if (!el) return;
  e.preventDefault();
  playById(el.dataset.trackId);
}

function _handleDragStart(e) {
  // Playlist nav item drag
  const plNav = e.target.closest('[data-pl-drag-id]');
  if (plNav) { onPlNavDragStart(e, plNav.dataset.plDragId); return; }
  // Queue : géré par Pointer Events (initQueueDrag)
  // Track row drag
  const tr = e.target.closest('[draggable="true"][data-track-id]');
  if (tr) { onTrackDragStart(e, tr.dataset.trackId); return; }
}

// ── Enregistrement ────────────────────────────────────────────────────────

/**
 * Enregistre les delegated listeners sur document.
 * A appeler UNE SEULE FOIS au boot (main.js).
 * @returns {Function} cleanup — retire tous les listeners (utile pour les tests)
 */
export function registerHandlers() {
  if (_registered) { console.warn('[handlers] registerHandlers() called more than once'); return () => {}; }
  _registered = true;
  const ac = new AbortController();
  const { signal } = ac;
  document.addEventListener('click',       _handleClick,        { signal });
  document.addEventListener('click',       _handleBackdropClick, { signal });
  document.addEventListener('input',       _handleInput,        { signal });
  document.addEventListener('change',      _handleInput,        { signal });
  document.addEventListener('dblclick',    _handleDblClick,     { signal });
  document.addEventListener('contextmenu', _handleContextMenu,  { signal });
  document.addEventListener('keydown',     _handleKeydown,      { signal });
  document.addEventListener('dragstart',   _handleDragStart,    { signal });

  // Wheel volume — molette sur #vol → ±2% par tick (même pattern que cinema.js _onCinWheel)
  const _volEl = document.getElementById('vol');
  if (_volEl) {
    _volEl.addEventListener('wheel', e => {
      e.preventDefault();
      const cur = +_volEl.value;
      const v   = Math.min(1, Math.max(0, cur + (e.deltaY < 0 ? 0.02 : -0.02)));
      _volEl.value = String(v);
      setMasterGain(v);
      updateVolSlider(_volEl);
    }, { passive: false, signal });
  }

  return () => ac.abort();
}
