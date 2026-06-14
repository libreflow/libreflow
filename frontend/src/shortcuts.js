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
import { togglePlay, next, prev,
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
import { tlistZoomIn, tlistZoomOut, tlistZoomReset }  from './tlistZoom.js';

// ── A11Y-10 : guard typage ────────────────────────────────────────────────
// Vérifie si l'élément focalisé est un champ de saisie texte.
// Utilisé pour bloquer les raccourcis single-key pendant la frappe.
function _isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.('role');
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'combobox') return true;
  return false;
}

// ── Handlers internes — groupés par domaine fonctionnel ──────────────────────

/**
 * Raccourcis Ctrl/Meta : Ctrl+F, Ctrl+,, zoom liste (Ctrl+= / - / 0).
 * Interceptés avant le guard typing pour fonctionner dans tous contextes.
 * @returns {boolean} true si l'événement a été consommé
 */
function _handleCtrlShortcuts(e) {
  if (!e.ctrlKey && !e.metaKey) return false;

  if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const srch = document.getElementById('srch');
    if (srch) { showView('lib'); srch.focus(); srch.select(); }
    return true;
  }

  if (e.key === ',' || e.code === 'Comma') {
    e.preventDefault();
    toggleSettings();
    return true;
  }

  if (!e.altKey) {
    const _inField = _isTypingTarget(e.target);
    if ((e.key === '=' || e.key === '+') && !_inField) {
      e.preventDefault(); tlistZoomIn(); return true;
    }
    if ((e.key === '-' || e.key === '_') && !_inField) {
      e.preventDefault(); tlistZoomOut(); return true;
    }
    if (e.key === '0' && !_inField) {
      e.preventDefault(); tlistZoomReset(); return true;
    }
  }

  return false;
}

/**
 * Guards globaux : typing target, IME composition, settings panel, modales,
 * panneau raccourcis, édition inline, mode cinéma.
 * @returns {boolean} true si le traitement doit s'arrêter (event bloqué)
 */
function _handleGuards(e) {
  // A11Y-10 : bloquer les single-key dans les champs de saisie (SC 2.1.4).
  if (_isTypingTarget(e.target)) {
    // Ctrl/Meta : laisser le navigateur gérer nativement (Ctrl+A, Ctrl+C…).
    // Les raccourcis app Ctrl+F et Ctrl+, sont traités par _handleCtrlShortcuts
    // AVANT ce guard. Retourner true ici bloque _handlePlayback/_handleMiscKeys
    // pour éviter Ctrl+Space → togglePlay, Ctrl+Arrow → skip track, etc.
    if (e.ctrlKey || e.metaKey) return true;
    if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
    return true;
  }

  // A11Y SC 2.1.4 : ignorer les frappes de composition IME.
  if (e.isComposing) return true;

  // BUG H-02 : Escape ferme le panneau Paramètres avant le guard _anyModalOpen.
  if (e.code === 'Escape' && document.getElementById('settings-panel')?.classList.contains('on')) {
    closeSettings();
    return true;
  }

  // BUG X-10 : #ctx-menu détecté via getElementById (pas de classe CSS "ctx-menu").
  const _anyModalOpen =
    document.querySelector('[id$="modal-bg"].on') !== null ||
    document.querySelector('.orphan-modal-bg.on') !== null ||
    document.getElementById('ctx-menu')?.classList.contains('on') === true;
  if (_anyModalOpen && e.code !== 'Escape') return true;

  // Panneau raccourcis : bascule `.open` — échappe au guard _anyModalOpen.
  if (isShortcutsOpen() && e.code !== 'Escape' && e.key !== '?') return true;

  // Bloquer les raccourcis pendant l'édition inline de métadonnées.
  if (document.querySelector('.tr.editing')) return true;

  // Laisser cinema.js gérer ses propres raccourcis quand le mode cinéma est ouvert.
  if (cinemaOpen) return true;

  return false;
}

/**
 * Navigation clavier WAI-ARIA 1.2 §5.7 pour le burger menu.
 * @returns {boolean} true si l'événement a été consommé
 */
function _handleBurgerMenu(e) {
  if (!e.target.closest?.('#tb-burger-panel')) return false;
  const _bp = document.getElementById('tb-burger-panel');
  if (!_bp?.classList.contains('on')) return false;

  const _bItems = [..._bp.querySelectorAll('[role="menuitem"]')];
  const _bIdx   = _bItems.indexOf(document.activeElement);
  const _roveTo = (item) => {
    _bItems.forEach(el => el.setAttribute('tabindex', '-1'));
    item?.setAttribute('tabindex', '0');
    item?.focus();
  };

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault(); _roveTo(_bItems[(_bIdx + 1) % _bItems.length]); return true;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault(); _roveTo(_bItems[(_bIdx - 1 + _bItems.length) % _bItems.length]); return true;
  }
  if (e.key === 'Home') { e.preventDefault(); _roveTo(_bItems[0]); return true; }
  if (e.key === 'End')  { e.preventDefault(); _roveTo(_bItems[_bItems.length - 1]); return true; }
  if (e.key === 'Tab') {
    _bp.classList.remove('on');
    document.getElementById('tbt-burger')?.setAttribute('aria-expanded', 'false');
    _bItems.forEach(el => el.setAttribute('tabindex', '-1'));
    // Don't preventDefault — let Tab navigate the document normally
  }
  return false;
}

/**
 * Raccourcis lecture : Space, flèches, volume, shuffle, repeat, like, mini.
 * M-13 : ArrowUp/Down volume ignoré si le focus est dans la liste de pistes.
 */
function _handlePlayback(e, updateVolSlider) {
  if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); next(true); }
  if (e.code === 'ArrowLeft')  { e.preventDefault(); prev(); }

  const _inTrackList = document.activeElement?.closest('#tlist');
  if (e.code === 'ArrowUp' && !_inTrackList) {
    e.preventDefault();
    const vel = document.getElementById('vol');
    const _cur = vel ? parseFloat(vel.value) : (masterGainNode ? masterGainNode.gain.value : 1);
    const v = Math.min(1, _cur + 0.05);
    setMasterGain(v);
    if (vel) { vel.value = v; updateVolSlider(vel); }
  }
  if (e.code === 'ArrowDown' && !_inTrackList) {
    e.preventDefault();
    const vel = document.getElementById('vol');
    const _cur = vel ? parseFloat(vel.value) : (masterGainNode ? masterGainNode.gain.value : 1);
    const v = Math.max(0, _cur - 0.05);
    setMasterGain(v);
    if (vel) { vel.value = v; updateVolSlider(vel); }
  }

  if (e.key.toLowerCase() === 's') toggleShuffle();
  if (e.key.toLowerCase() === 'r') toggleRepeat();
  if (e.key === '/') { document.getElementById('srch')?.focus(); e.preventDefault(); }
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !cinemaOpen) toggleLike();
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.altKey) { toggleMiniPlayer(); syncMiniSettingsBtn(); }
  if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.altKey && !cinemaOpen) toggleMiniOverlay();
}

/**
 * Gestion complète de la touche Escape : burger, sleep-menu, cinéma,
 * raccourcis, modales, EQ, queue, et réinitialisation de la recherche.
 * @returns {boolean} true si l'événement a été consommé
 */
function _handleEscape(e, closeModal) {
  if (e.code !== 'Escape') return false;

  const _burgerPanel = document.getElementById('tb-burger-panel');
  if (_burgerPanel?.classList.contains('on')) {
    _burgerPanel.classList.remove('on');
    document.getElementById('tbt-burger')?.setAttribute('aria-expanded', 'false');
    _burgerPanel.querySelectorAll('[role="menuitem"]').forEach(el => el.setAttribute('tabindex', '-1'));
    document.getElementById('tbt-burger')?.focus();
    return true;
  }

  // A11Y-14 : sleep-menu est un role=dialog aria-modal trappé.
  const _sleepMenu = document.getElementById('sleep-menu');
  if (_sleepMenu?.classList.contains('on')) { _sleepMenu.classList.remove('on'); return true; }
  if (cinemaOpen)       { closeCinema(); return true; }
  if (isShortcutsOpen()) { closeShortcuts(); return true; }
  if (document.getElementById('pl-modal-bg')?.classList.contains('on'))      { closePlModal(); return true; }
  if (document.getElementById('modal-bg')?.classList.contains('on'))         { closeModal(); return true; }
  if (document.getElementById('confirm-modal-bg')?.classList.contains('on')) {
    document.querySelector('#confirm-modal .mbtn.cancel')?.click(); return true;
  }
  if (document.getElementById('ctx-menu')?.classList.contains('on')) { closeCtxMenu(); return true; }
  if (eqOpen)    { closeEQ(); return true; }
  if (queueOpen) { closeQueue(); return true; }

  const srch = document.getElementById('srch');
  if (srch?.value) {
    // BUG FIX : _searchDebounceTimer est privé dans views.js — pas de clearTimeout ici.
    srch.value = '';
    set('query', '');
    invalidateFilterCache();
    invalidateGenreGridSig();
    emit(EVENTS.FILTER_CHANGED, {});
    renderLib();
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
    return true;
  }
  return false;
}

/**
 * Raccourcis divers : F11, F12 (dev), cinéma, dupes, vitesse, viz, aide.
 */
function _handleMiscKeys(e, cycleSpeed) {
  // H-22 : timeout explicite via le 3e param de ipc.invoke.
  if (e.code === 'F11') {
    e.preventDefault();
    if (window.__TAURI__) invoke('win_maximize', undefined, { timeout: 5000 }).catch(err => console.warn('[shortcuts] win_maximize:', err));
  }
  if (e.code === 'F12' && import.meta.env.DEV) {
    e.preventDefault();
    if (window.__TAURI__) invoke('open_devtools', undefined, { timeout: 5000 }).catch(err => console.warn('[shortcuts] open_devtools:', err));
  }

  if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey) toggleCinema();
  // Note : 'b' (cycleCinemaBg) et 'f' (toggleCinemaFullscreen) sont gérés par cinema.js
  // — inatteignables ici car _handleGuards retourne true si cinemaOpen.
  if (e.key.toLowerCase() === 'd' && !e.ctrlKey) detectDupes();
  if (e.key.toLowerCase() === 'x' && !e.ctrlKey && !e.altKey) cycleSpeed();
  if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey) {
    const _vmodes = ['bars', 'oscilloscope', 'circle'];
    setVizMode(_vmodes[(_vmodes.indexOf(getVizMode()) + 1) % _vmodes.length]);
    _syncVizBtns(true);
  }
  if (e.key === '?') toggleShortcuts();
}

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
    if (_handleCtrlShortcuts(e)) return;
    if (_handleGuards(e)) return;
    if (_handleBurgerMenu(e)) return;
    if (_handleEscape(e, closeModal)) return;
    _handlePlayback(e, updateVolSlider);
    _handleMiscKeys(e, cycleSpeed);
  });
}
