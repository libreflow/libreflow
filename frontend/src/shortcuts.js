// LibreFlow — shortcuts.js
// Raccourcis clavier globaux de l'application.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// Dépendances :
//   import  : get, set                               (store.js)
//   import  : emit, EVENTS                           (bus.js)
//   import  : invoke                                 (ipc.js)
//   import  : audio, togglePlay, next, prev,
//             toggleShuffle, toggleRepeat, toggleLike,
//             setSpeed                               (player.js)
//   import  : masterGainNode, setMasterGain,
//             eqOpen, closeEQ                        (eq.js)
//   import  : queueOpen, closeQueue                  (queue.js)
//   import  : cinemaOpen, closeCinema, toggleCinema  (cinema.js)
//   import  : isShortcutsOpen, closeShortcuts,
//             toggleShortcuts, closeSettings, _syncVizBtns (settings.js)
//   import  : closePlModal                           (playlists.js)
//   import  : closeCtxMenu                           (ctxmenu.js)
//   import  : toggleMiniPlayer                       (miniplayer.js)
//   import  : toggleMiniOverlay                      (minioverlay.js)
//   import  : detectDupes                            (dupes.js)
//   import  : setVizMode, getVizMode                 (viz.js)
//   import  : renderLib                              (renderer.js)
//   import  : showView                               (views.js)
//   import  : invalidateFilterCache                  (search.js)
//   import  : invalidateGenreGridSig                 (genres.js)
//   import  : SPEEDS                                 (cfg.js)
//   callbacks: updateVolSlider, closeModal, cycleSpeed (app.js — injectés pour éviter dep circulaire)
//
// Exports publics :
//   initShortcuts({ updateVolSlider, closeModal, cycleSpeed })

import { get, set }                                    from './store.js';
import { emit, EVENTS }                                from './bus.js';
import { invoke }                                      from './ipc.js';
import { audio, togglePlay, next, prev,
         toggleShuffle, toggleRepeat, toggleLike,
         setSpeed }                                    from './player.js';
import { masterGainNode, setMasterGain,
         eqOpen, closeEQ }                             from './eq.js';
import { queueOpen, closeQueue }                       from './queue.js';
import { cinemaOpen, closeCinema, toggleCinema }       from './cinema.js';
import { isShortcutsOpen, closeShortcuts, toggleShortcuts,
         closeSettings, toggleSettings, _syncVizBtns, syncMiniSettingsBtn } from './settings.js';
import { closePlModal }                                from './playlists.js';
import { closeCtxMenu }                                from './ctxmenu.js';
import { toggleMiniPlayer }                            from './miniplayer.js';
import { toggleMiniOverlay }                           from './minioverlay.js';
import { detectDupes }                                 from './dupes.js';
import { setVizMode, getVizMode }                      from './viz.js';
import { renderLib }                                   from './renderer.js';
import { showView }                                    from './views.js';
import { invalidateFilterCache }                       from './search.js';
import { invalidateGenreGridSig }                      from './genres.js';
import { SPEEDS }                                      from './cfg.js';

/**
 * Attache le listener global `keydown` de l'application.
 *
 * @param {object} cb — callbacks injectés depuis app.js pour éviter les dépendances circulaires
 * @param {Function} cb.updateVolSlider — met à jour le fond du slider volume + tooltip
 * @param {Function} cb.closeModal     — ferme la modale générique (#modal-bg)
 * @param {Function} cb.cycleSpeed     — cycle la vitesse de lecture
 */
export function initShortcuts({ updateVolSlider, closeModal, cycleSpeed }) {
  document.addEventListener('keydown', e => {
    // Ctrl+F : focus recherche — intercepté avant le guard INPUT/cinéma
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      const srch = document.getElementById('srch');
      if (srch) { showView('lib'); srch.focus(); srch.select(); }
      return;
    }

    // UX-Ergo : Ctrl+, ouvre/ferme les Paramètres — convention universelle (VS Code, Chrome, macOS).
    // Intercepté avant le guard INPUT pour fonctionner même lors d'un focus dans la recherche.
    if (e.ctrlKey && (e.key === ',' || e.code === 'Comma')) {
      e.preventDefault();
      toggleSettings();
      return;
    }

    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    const _anyModalOpen =
      document.getElementById('pl-modal-bg')?.classList.contains('on') ||
      document.getElementById('modal-bg')?.classList.contains('on') ||
      document.getElementById('confirm-modal-bg')?.classList.contains('on') ||
      document.getElementById('settings-panel')?.classList.contains('on') ||
      document.querySelector('.orphan-modal-bg.on') !== null ||
      document.querySelector('.ctx-menu.on') !== null;
    if (_anyModalOpen) return;

    // Bloquer tous les raccourcis pendant l'édition inline de métadonnées
    if (document.querySelector('.tr.editing')) return;

    // Laisser cinema.js gérer les raccourcis quand le mode cinéma est ouvert
    if (cinemaOpen) return;

    if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); next(true); }
    if (e.code === 'ArrowLeft')  { e.preventDefault(); prev(); }

    // M-13 : ne pas capter ArrowUp/Down pour le volume si le focus est dans la
    // liste de pistes — keynav.js gère alors la navigation au clavier (évite la double action).
    const _inTrackList = document.activeElement?.closest('#tlist');
    if (e.code === 'ArrowUp' && !_inTrackList) {
      e.preventDefault();
      const _cur = masterGainNode ? masterGainNode.gain.value : audio.volume;
      const v = Math.min(1, _cur + 0.05);
      setMasterGain(v);
      const vel = document.getElementById('vol');
      if (vel) { vel.value = v; updateVolSlider(vel); }
    }
    if (e.code === 'ArrowDown' && !_inTrackList) {
      e.preventDefault();
      const _cur = masterGainNode ? masterGainNode.gain.value : audio.volume;
      const v = Math.max(0, _cur - 0.05);
      setMasterGain(v);
      const vel = document.getElementById('vol');
      if (vel) { vel.value = v; updateVolSlider(vel); }
    }

    if (e.key.toLowerCase() === 's') toggleShuffle();
    if (e.key.toLowerCase() === 'r') toggleRepeat();
    if (e.key === '/') { document.getElementById('srch')?.focus(); e.preventDefault(); }
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !cinemaOpen) toggleLike();
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.altKey) { toggleMiniPlayer(); syncMiniSettingsBtn(); }
    if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.altKey) toggleMiniOverlay();

    if (e.code === 'Escape') {
      if (cinemaOpen)                        { closeCinema(); return; }
      if (isShortcutsOpen())                 { closeShortcuts(); return; }
      if (document.getElementById('pl-modal-bg')?.classList.contains('on'))      { closePlModal(); return; }
      if (document.getElementById('modal-bg')?.classList.contains('on'))         { closeModal(); return; }
      if (document.getElementById('confirm-modal-bg')?.classList.contains('on')) { document.querySelector('#confirm-modal .mbtn.cancel')?.click(); return; }
      if (document.getElementById('ctx-menu')?.classList.contains('on'))         { closeCtxMenu(); return; }
      if (eqOpen)     { closeEQ(); return; }
      if (queueOpen)  { closeQueue(); return; }
      if (document.getElementById('settings-panel')?.classList.contains('on'))   { closeSettings(); return; }

      const srch = document.getElementById('srch');
      if (srch?.value) {
        // BUG FIX : _searchDebounceTimer est une var privée de views.js (non exportée) →
        // ReferenceError en strict mode ES module. Le timer views.js expirera seul (no-op
        // puisque query sera déjà vide). Pas besoin de le clearTimeout ici.
        srch.value = '';
        set('query', '');
        // Équivalent inline de invalidateFilter() — pas de dépendance circulaire sur app.js
        invalidateFilterCache();
        invalidateGenreGridSig();
        emit(EVENTS.FILTER_CHANGED, {});
        renderLib();
        const clr = document.getElementById('srch-clear');
        if (clr) clr.style.display = 'none';
        return;
      }
    }

    if (e.code === 'F11') { e.preventDefault(); if (window.__TAURI__) invoke('win_maximize'); }
    if (e.code === 'F12' && import.meta.env.DEV) { e.preventDefault(); if (window.__TAURI__) invoke('open_devtools'); }

    if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey) toggleCinema();
    // Note : 'b' (cycleCinemaBg) et 'f' (toggleCinemaFullscreen) en mode cinéma sont gérés
    // par _onCinKey dans cinema.js — ces guards `&& cinemaOpen` seraient inatteignables ici
    // car le `if (cinemaOpen) return` ci-dessus les bloque.
    if (e.key.toLowerCase() === 'd' && !e.ctrlKey) detectDupes();
    if (e.key.toLowerCase() === 'x' && !e.ctrlKey && !e.altKey) cycleSpeed();
    if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey) {
      const _vmodes = ['bars', 'oscilloscope', 'circle'];
      setVizMode(_vmodes[(_vmodes.indexOf(getVizMode()) + 1) % _vmodes.length]);
      _syncVizBtns(true);
    }
    if (e.key === '?') toggleShortcuts();
  });
}
