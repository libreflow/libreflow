// LibreFlow — playlists.js
// CRUD playlists, navigation hero, drag-drop, dossiers, covers, modals.
// Extrait de app.js (Jalon 5 — Session 143).
//
// Dépendances :
//   store.js  : get, set
//   bus.js    : emit, EVENTS
//   db.js     : DB
//   i18n.js   : i18n
//   utils.js  : esc
//   ui.js     : toast, toastWithAction, confirmAction
//   ctxmenu.js: closeCtxMenu
//   smartplaylist.js: openSmartPlaylistModal, switchPlTab
//   selection.js    : clearSelection
//   search.js       : invalidateFilterCache
//
//   ARCH-1: saveCfg (cfgsave.js), playPlaylistFrom/shufflePlaylist/playPlaylistDirect
//           moved INTO playlists.js — no more app.js circular dep.
//
// Exports publics :
//   savePlaylists, savePlaylistsNow, renderPlNav, setupPlNavDrop
//   renderPlHero, setPlSort, setPlModalMode
//   openNewPlaylistModal, openRenamePlaylistModal, closePlModal, confirmPlaylistModal
//   deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist
//   showPlCtxMenu, ctxPlayPlaylist, ctxShufflePlaylist
//   showPlQuickPop, closePlQuickPop, pqpAdd, pqpNew
//   onTrackDragStart, onPlNavDragStart
//   togglePinPlaylist, movePlToFolder, removePlFromFolder
//   togglePlFolder, showPlFolderCtxMenu, renamePlFolder, deletePlFolder
//   onPlFolderDragOver, onPlFolderDragLeave, onPlFolderDrop
//   onPlCoverSelected, clearPlCover

import { esc, moveByOne }       from './utils.js';
import { CFG }                   from './cfg.js';
import { i18n }                  from './i18n.js';
import { get, set, notify }      from './store.js';
import { emit, EVENTS }          from './bus.js';
import { DB }                    from './db.js';
import { toast, toastWithAction, confirmAction, promptAction } from './ui.js';
import { closeCtxMenu }          from './ctxmenu.js';
import { clearSelection }        from './selection.js';
import { invalidateFilterCache, getFiltered } from './search.js';
import { invalidateGenreGridSig }              from './genres.js';
import { saveCfg }                             from './cfgsave.js';
import { renderPlaylistsGrid }                 from './renderer.js';
import { playAt, buildQ }                      from './player.js';
import { _allPlayerUI }                        from './allplayerui.js';

// ── Inline helper (mirrors app.js:invalidateFilter — ARCH-1) ──────────────────
function invalidateFilter() {
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
}

// ── Play helpers (moved from app.js — ARCH-1) ─────────────────────────────────

export function playPlaylistFrom(fi) {
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

export function playPlaylistDirect(plId, event) {
  if (event) event.stopPropagation();
  const navBtn = document.getElementById('ni-pl-' + plId);
  emit(EVENTS.VIEW_REQUEST, { view: 'playlist', btn: navBtn, plId });
  requestAnimationFrame(() => playPlaylistFrom(0));
}

export async function shufflePlaylist() {
  const fl = getFiltered();
  if (!fl.length) return;
  const ri = Math.floor(Math.random() * fl.length);
  await playAt(ri);
  set('shuffle', true); // app.js subscribe keeps its local var in sync
  const _shufBtn = document.getElementById('pc-shuf');
  _shufBtn?.classList.add('on');
  _shufBtn?.setAttribute('aria-pressed', 'true');
  const _cinShufBtn = document.getElementById('cinema-shuf');
  _cinShufBtn?.classList.add('on');
  _cinShufBtn?.setAttribute('aria-pressed', 'true');
  buildQ();
  _allPlayerUI();
}

// ── État local du module ──────────────────────────────────────────────────────
let plModalMode       = 'new';  // 'new' | 'rename'
let _pqpTrackId       = null;   // track en cours dans le quick-pop ajout playlist
let _dragTrackId      = null;   // track en cours de drag (sidebar + reorder)
let _dragPlId         = null;   // playlist en cours de drag (sidebar réorganisation)
let _plCtxClose       = null;   // listener mousedown pour fermer le ctx-menu playlist
let _plCtxEscClose    = null;   // listener keydown Escape pour fermer le ctx-menu playlist
let _plModalPrevFocus = null;   // focus à restaurer après fermeture du modal
let _plModalFocusTrap = null;   // keydown handler Tab-trap dans #pl-modal
let _plModalCoverB64  = null;   // cover en cours d'édition dans le modal
let _plModalBusy      = false;  // guard anti double-submit confirmPlaylistModal
let _plNavDropInit    = false;  // setupPlNavDrop one-shot (flag module vs DOM node)
let _heroMosaicGen    = 0;      // B19 : token anti-race pour les img.onload du hero-mosaic

/** Setter pour smartplaylist.js (window.setPlModalMode). */
export function setPlModalMode(v) { plModalMode = v; }

// AUDIT-2026-07-01 C3 (SC 2.1.1 / 2.5.7) — le menu ctx playlist/dossier était
// mort au clavier alors qu'il est le SEUL chemin rename/delete/reorder de la
// sidebar. Pattern identique à ctxmenu.js (A11Y-01) : role=menu/menuitem,
// focus au premier item, flèches, Enter/Space, focus restauré à la fermeture.
let _plCtxTrigger    = null; // élément qui a ouvert le menu (focus restauré au close)
let _plCtxKeyHandler = null; // handler clavier actif sur #pl-ctx-menu

function _plCtxMenuItems(menu) {
  // offsetParent null = item dans un sous-menu fermé (display:none) → non navigable
  return [...menu.querySelectorAll('[role="menuitem"]')].filter(el => el.offsetParent !== null);
}

function _setupPlCtxKeyNav(menu) {
  if (_plCtxKeyHandler) menu.removeEventListener('keydown', _plCtxKeyHandler);
  _plCtxKeyHandler = (e) => {
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const items = _plCtxMenuItems(menu);
      if (!items.length) return;
      const idx  = items.indexOf(document.activeElement);
      const next = e.code === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next?.focus();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      const cur = document.activeElement;
      if (cur && menu.contains(cur) && cur.getAttribute('role') === 'menuitem') {
        e.preventDefault();
        // stopPropagation : sans lui, _handleKeydown (handlers.js) simulerait un
        // second click sur le même [data-action] → double exécution (pin/unpin…).
        e.stopPropagation();
        cur.click();
      }
    }
  };
  menu.addEventListener('keydown', _plCtxKeyHandler);
}

/** Nettoie le handler clavier et restaure le focus si celui-ci était dans le menu. */
function _plCtxKeyCleanup(menu) {
  if (_plCtxKeyHandler && menu) {
    menu.removeEventListener('keydown', _plCtxKeyHandler);
    _plCtxKeyHandler = null;
  }
  if (_plCtxTrigger) {
    // Ne pas voler le focus si l'utilisateur a cliqué ailleurs (fermeture mousedown)
    if (!menu || menu.contains(document.activeElement) || document.activeElement === document.body) {
      // Si renderPlNav() a reconstruit la ligne entre-temps, le nœud mémorisé est
      // détaché — re-résoudre par id pour restaurer le focus sur la nouvelle ligne.
      let t = _plCtxTrigger;
      if (!t.isConnected && t.id) t = document.getElementById(t.id) || t;
      t.focus?.();
    }
    _plCtxTrigger = null;
  }
}

/**
 * Position d'ouverture du menu : coordonnées souris, ou — invocation clavier
 * (Shift+F10 / touche Menu → clientX/Y = 0) — le coin bas-gauche du déclencheur.
 */
function _plCtxAnchor(event) {
  if ((event.clientX || event.clientY)) return { x: event.clientX, y: event.clientY };
  const r = event.target?.getBoundingClientRect?.();
  return r ? { x: r.left, y: r.bottom } : { x: 0, y: 0 };
}

/** FIX-B9 — Attache les listeners mousedown + Escape pour fermer le ctx-menu playlist/dossier. */
function _attachPlCtxClose(menu) {
  if (_plCtxClose)    { document.removeEventListener('mousedown', _plCtxClose,    true); _plCtxClose    = null; }
  if (_plCtxEscClose) { document.removeEventListener('keydown',   _plCtxEscClose, true); _plCtxEscClose = null; }
  // B27 FIX : _close capture ses PROPRES références (mdHandler / escHandler).
  // Avant, _close lisait les variables module — un 2e ctx-menu les réassignait
  // et le _close du 1er retirait alors les listeners du 2e, laissant ceux du
  // 1er empilés sur document.
  const _close = () => {
    menu.classList.remove('on');
    document.removeEventListener('mousedown', mdHandler,  true);
    document.removeEventListener('keydown',   escHandler, true);
    if (_plCtxClose    === mdHandler)  _plCtxClose    = null;
    if (_plCtxEscClose === escHandler) _plCtxEscClose = null;
    _plCtxKeyCleanup(menu); // AUDIT-2026-07-01 C3 : cleanup clavier + restauration focus
  };
  const mdHandler  = (e) => { if (!menu.contains(e.target)) _close(); };
  const escHandler = (e) => { if (e.code === 'Escape') { e.stopPropagation(); _close(); } };
  _plCtxClose    = mdHandler;
  _plCtxEscClose = escHandler;
  setTimeout(() => {
    document.addEventListener('mousedown', mdHandler,  true);
    document.addEventListener('keydown',   escHandler, true);
  }, 0);
}

/**
 * AUDIT-2026-07-01 C3 — ouverture commune des menus ctx playlist/dossier :
 * mémorise le déclencheur, positionne (souris ou ancre clavier), attache la
 * fermeture (mousedown/Escape), la navigation flèches et focalise le 1er item.
 * Factorise le code dupliqué de showPlCtxMenu / showPlFolderCtxMenu.
 */
function _openPlCtxMenu(menu, event) {
  _plCtxTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  menu.setAttribute('role', 'menu');
  // S157 FIX-5 : positionnement basé sur la taille réelle (mesure hors écran puis clamp)
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top  = '0px';
  menu.classList.add('on');
  const mw  = menu.offsetWidth  || 200;
  const mh  = menu.offsetHeight || 200;
  const pad = 8;
  const a = _plCtxAnchor(event);
  menu.style.left = Math.max(pad, Math.min(a.x, window.innerWidth  - mw - pad)) + 'px';
  menu.style.top  = Math.max(pad, Math.min(a.y, window.innerHeight - mh - pad)) + 'px';
  menu.style.visibility = '';
  // FIX-B9 : fermeture mousedown extérieur + Escape (LEAK-1 FIX étendu)
  _attachPlCtxClose(menu);
  _setupPlCtxKeyNav(menu);
  setTimeout(() => _plCtxMenuItems(menu)[0]?.focus(), 30);
}

// ══ Persistance ══════════════════════════════════════════════════════════════

// Coalescing debounce: all concurrent `await savePlaylists()` callers share one
// IDB write per burst. Errors propagate to every waiter.
let _savePlTimer   = null;
let _savePlPending = [];

async function _flushPlaylists() {
  _savePlTimer = null;
  const pending = _savePlPending.splice(0);
  const playlists = get('playlists');
  // BUG-M4 FIX : mutation in-place → notify() (set() ignore same-ref)
  // AUDIT-2026-07-01 L4 : emit(PLAYLIST_CHANGED) retiré — zéro abonné, notify() fait foi.
  notify('playlists');
  try {
    // Transaction atomique : clear + écriture en un seul commit
    const transaction = DB.transaction('playlists', 'readwrite');
    const store = transaction.objectStore('playlists');
    store.clear();
    for (const pl of playlists) store.put(pl);
    await new Promise((ok, fail) => {
      transaction.oncomplete = ok;
      transaction.onerror   = () => fail(transaction.error);
    });
    pending.forEach(({ resolve }) => resolve());
  } catch (e) {
    console.warn('[savePlaylists]', e);
    pending.forEach(({ reject }) => reject(e));
  }
}

export function savePlaylists() {
  return new Promise((resolve, reject) => {
    _savePlPending.push({ resolve, reject });
    clearTimeout(_savePlTimer);
    _savePlTimer = setTimeout(_flushPlaylists, CFG.PL_SAVE_DEBOUNCE);
  });
}

export async function savePlaylistsNow() {
  clearTimeout(_savePlTimer);
  await _flushPlaylists();
}

// ══ PLAYLISTS ════════════════════════════════════════════════════════════════

// ── S92 — Hero playlist (style Spotify/Deezer) ───────────────────────────────

/**
 * Rend le hero header de la vue playlist : cover, grand nom (éditable), stats.
 * Insère #pl-hero entre .vh et #pl-action-bar si absent du DOM.
 */
export function renderPlHero(pl, fl) {
  let hero = document.getElementById('pl-hero');
  if (!hero) {
    hero = document.createElement('div');
    hero.id = 'pl-hero';
    const vh = document.querySelector('#vlib .vh');
    if (vh) vh.parentNode.insertBefore(hero, vh.nextSibling);
    else document.getElementById('vlib').prepend(hero);
  }
  if (!pl) { hero.classList.remove('on'); return; }

  // Stats : nombre de titres + durée totale
  const count = fl.length;
  const totalSec = fl.reduce((s, t) => s + (t.duration || 0), 0);
  const hrs = (totalSec / 3600) | 0;
  const min = ((totalSec % 3600) / 60) | 0;
  const durStr = hrs > 0 ? `${hrs} h ${min} min` : min > 0 ? `${min} min` : '';
  const stats = [i18n('sb_chip_tracks', count), durStr].filter(Boolean).join(' · ');
  const isSmart = !!pl.smart;
  const label = (isSmart ? i18n('pl_smart_lbl') + ' · ' : '') + i18n('pl_hero_playlist');

  const coverInner = pl.coverB64
    ? `<img src="${esc(pl.coverB64)}" alt="" class="pl-hero-cover-img">`
    : `<canvas id="pl-hero-mosaic" width="200" height="200" class="pl-hero-mosaic"></canvas>
       <div class="pl-hero-cover-ico">
         <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
           <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
         </svg>
       </div>`;

  hero.innerHTML = `
    <div class="pl-hero-cover" data-action="rename-pl" data-pl-id="${esc(pl.id)}" title="${i18n('pl_hero_edit')}" role="button" tabindex="0" aria-label="${i18n('pl_hero_edit')}">
      ${coverInner}
      <div class="pl-hero-edit-overlay" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </div>
    </div>
    <div class="pl-hero-info">
      <div class="pl-hero-label">${esc(label)}</div>
      <div class="pl-hero-name" id="pl-hero-name"
           title="${i18n('pl_rename_title')} (double-clic)"
           data-pl-hero-id="${esc(pl.id)}">${esc(pl.name)}</div>
      <div class="pl-hero-stats">${stats}</div>
    </div>
    <button class="pl-hero-more"
            data-action="show-cur-pl-menu"
            title="${i18n('pl_more')}"
            aria-label="${i18n('pl_more')}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5"  cy="12" r="1.5" fill="currentColor"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    </button>`;

  // FIX : annuler l'exit animation si on rouvre rapidement une autre playlist
  hero.classList.remove('leaving');
  hero.classList.add('on');

  // Mosaic async si pas de cover custom
  if (!pl.coverB64) _drawHeroMosaic(fl);
}

/**
 * Dessine une mosaïque 2×2 des pochettes des 4 premiers titres dans #pl-hero-mosaic.
 * Ignoré si le canvas n'est plus dans le DOM (playlist changée entre-temps).
 */
function _drawHeroMosaic(fl) {
  // B19 FIX : token de génération — un img.onload lent d'une playlist précédente
  // ne doit pas peindre sur le canvas (même id) d'une playlist ouverte depuis.
  const _myGen = ++_heroMosaicGen;
  const c = document.getElementById('pl-hero-mosaic');
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, 200, 200);

  const arts = [];
  for (const t of fl) { if (t.art && arts.length < 4) arts.push(t.art); }
  if (!arts.length) return;

  // Si un seul art, remplir les 4 cellules avec
  const toLoad = arts.length === 1
    ? [arts[0], arts[0], arts[0], arts[0]]
    : arts.length === 2
      ? [arts[0], arts[1], arts[1], arts[0]]
      : arts;
  const positions = [[0,0],[100,0],[0,100],[100,100]];

  for (let i = 0; i < Math.min(toLoad.length, 4); i++) {
    const img = new Image();
    const [px, py] = positions[i];
    img.onload = () => {
      if (_heroMosaicGen !== _myGen) return; // B19 FIX : playlist changée entre-temps
      const cv = document.getElementById('pl-hero-mosaic');
      if (!cv) return; // canvas retiré du DOM (changement de playlist)
      const ctx2d = cv.getContext('2d');
      if (ctx2d) ctx2d.drawImage(img, px, py, 100, 100);
    };
    // S157 FIX-8 : guard onerror — laisse la cellule en fond #1a1a2a au lieu d'échouer silencieusement
    img.onerror = () => {
      if (_heroMosaicGen !== _myGen) return; // B19 FIX : playlist changée entre-temps
      const cv = document.getElementById('pl-hero-mosaic');
      if (!cv) return;
      const c = cv.getContext('2d');
      if (!c) return;
      c.fillStyle = '#1a1a2a';
      c.fillRect(px, py, 100, 100);
    };
    img.src = toLoad[i];
  }
}

/**
 * S92 — Changer le tri interne de la playlist courante.
 * Persiste dans pl.sort + invalide le filtre + re-rend.
 */
export function setPlSort(val) {
  const playlists = get('playlists');
  const curPlId   = get('curPlId');
  const pl = playlists.find(p => p.id === curPlId);
  if (!pl || get('plSort') === val) return;
  set('plSort', val);
  pl.sort = val;
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  emit(EVENTS.RENDER_LIB, {});
  savePlaylists();
}

/**
 * S92 — Renommage inline du nom dans le hero (double-clic).
 */
export function _plHeroInlineRename(plId) {
  const el = document.getElementById('pl-hero-name');
  const pl = get('playlists').find(p => p.id === plId);
  if (!el || !pl || el.contentEditable === 'true') return;
  const orig = pl.name;
  el.contentEditable = 'true';
  el.setAttribute('spellcheck', 'false');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  const finish = async () => {
    if (el.contentEditable !== 'true') return;
    // AUDIT-2026-07-01 L5 : retirer onKey aussi sur le chemin blur simple (clic
    // ailleurs) — avant, le listener keydown fuyait jusqu'au prochain renderPlHero.
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    const newName = el.textContent.trim();
    if (newName && newName !== orig) {
      pl.name = newName;
      await savePlaylists();
      renderPlNav();
      const vht = document.getElementById('vhtitle');
      if (vht) vht.textContent = newName;
      toast(i18n('t_pl_renamed', newName), 'success');
    } else {
      el.textContent = orig;
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.removeEventListener('keydown', onKey); el.blur(); }
    if (e.key === 'Escape') {
      el.removeEventListener('keydown', onKey); el.removeEventListener('blur', finish);
      el.contentEditable = 'false'; el.textContent = orig;
      el.blur(); // FIX 3 — libérer le focus explicitement après Escape
    }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', finish, { once: true });
}

/**
 * S92 — Renommage inline dans la sidebar (double-clic sur .pl-name).
 */
export function _plNavInlineRename(plId, spanEl) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl || spanEl.contentEditable === 'true') return;
  const orig = pl.name;
  spanEl.contentEditable = 'true';
  spanEl.setAttribute('spellcheck', 'false');
  spanEl.focus();
  const range = document.createRange();
  range.selectNodeContents(spanEl);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  // FIX 1 — bloquer la propagation des clics vers le <button> parent pendant l'édition
  // (sinon chaque clic de positionnement du curseur déclenche setView → rerender → perte de l'édition)
  const blockClick = e => e.stopPropagation();
  spanEl.addEventListener('click', blockClick);

  const _cleanup = () => {
    spanEl.removeEventListener('click', blockClick);
    spanEl.removeEventListener('keydown', onKey);
  };

  const finish = async () => {
    if (spanEl.contentEditable !== 'true') return;
    _cleanup();
    spanEl.contentEditable = 'false';
    const newName = spanEl.textContent.trim();
    if (newName && newName !== orig) {
      pl.name = newName;
      await savePlaylists();
      renderPlNav();
      const curPlId = get('curPlId');
      if (get('view') === 'playlist' && curPlId === plId) {
        const heroName = document.getElementById('pl-hero-name');
        if (heroName) heroName.textContent = newName;
        const vht = document.getElementById('vhtitle');
        if (vht) vht.textContent = newName;
      }
      toast(i18n('t_pl_renamed', newName), 'success');
    } else {
      spanEl.textContent = orig;
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); spanEl.blur(); }
    if (e.key === 'Escape') {
      _cleanup();
      spanEl.removeEventListener('blur', finish);
      spanEl.contentEditable = 'false'; spanEl.textContent = orig;
      spanEl.blur(); // FIX 3 — libérer le focus explicitement
    }
  };
  spanEl.addEventListener('keydown', onKey);
  spanEl.addEventListener('blur', finish, { once: true });
}

// ── S91 — Vague A : rendu sectionné (Pinned / Récentes / Dossiers / Autres) ──
// AUDIT-2026-07-01 C5/H9/M4 : la ligne était un <button> contenant des <span>
// cliquables (HTML invalide, ▶/⋯ inexistants pour AT), sans aria-current, avec
// un nom accessible pollué par le compteur. Nouvelle structure : div role=button
// (activation Enter/Space via _handleKeydown de handlers.js) + vrais <button>
// enfants pour ▶ et ⋯.
function _plNavItemHTML(pl) {
  const count    = pl.trackIds ? pl.trackIds.length : 0;
  const isSmart  = !!pl.smart;
  const view     = get('view');
  const curPlId  = get('curPlId');
  const isActive = view === 'playlist' && curPlId === pl.id;
  const isPinned = !!pl.pinned;
  return `
  <div class="ni ni-pl${isActive?' on':''}${isSmart?' smart':''}${pl.coverB64?' has-cover':''}${isPinned?' pinned':''}"
    id="ni-pl-${pl.id}" role="button" tabindex="0" aria-label="${esc(pl.name)}"${isActive ? ' aria-current="page"' : ''}
    data-action="set-view" data-view="playlist" data-pl-id="${pl.id}"
    draggable="true" data-pl-drag-id="${pl.id}"
    data-pl-ctx-id="${pl.id}">
    <span class="pl-icon">
      ${pl.coverB64
        ? `<img src="${esc(pl.coverB64)}" alt="" class="pl-cover-img">`
        : (isSmart
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`)
      }
      ${isPinned ? `<svg class="pl-pin-badge" viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M12 2l1.4 4.3h4.5l-3.6 2.6 1.4 4.3L12 10.6 8.3 13.2l1.4-4.3L6.1 6.3h4.5z"/></svg>` : ''}
    </span>
    <span class="pl-name" data-pl-rename-id="${pl.id}" title="${i18n('pl_rename_title')} (double-clic)">${esc(pl.name)}</span>
    ${count > 0 ? `<span class="pl-count" aria-hidden="true">${count}</span>` : ''}
    <span class="pl-actions">
      <button type="button" class="pl-play" title="${i18n('pl_play_all')}" aria-label="${i18n('pl_play_all')}" data-action="play-pl-direct" data-pl-id="${pl.id}">
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><polygon points="6 3 20 12 6 21" fill="currentColor"/></svg>
      </button>
      <button type="button" class="pl-more" title="${i18n('pl_more')}" aria-label="${i18n('pl_more')}" data-action="show-pl-ctx" data-pl-id="${pl.id}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
      </button>
    </span>
  </div>`;
}


/**
 * Construit le HTML sectionné de la nav playlists (Épinglées / Récentes /
 * Dossiers / Hors dossier). Extrait de renderPlNav (règle <50 lignes, §16).
 * @returns {string[]} fragments HTML dans l'ordre d'affichage
 */
function _plNavSectionsHTML(playlists, plFolders) {
  const folderIds = new Set(plFolders.map(f => f.id));

  // Section 1 : Épinglées (respecte l'ordre dans `playlists`)
  const pinned = playlists.filter(p => p.pinned);

  // REWORK-1 (2026-07-02) : la section « Récentes » est supprimée — elle
  // réordonnait la sidebar à chaque ouverture (instabilité spatiale) et
  // collisionnait avec l'item nav « Récents ». La récence vit désormais dans
  // le tri de la grille playlists (plGridSort='recent', cf. renderer-grids.js).
  const ungroupedOrNoFolder = playlists.filter(p =>
    !p.pinned &&
    (!p.folderId || !folderIds.has(p.folderId))
  );

  const parts = [];
  if (pinned.length) {
    parts.push(`<div class="pl-nav-section-h">${i18n('pl_section_pinned')}</div>`);
    parts.push(pinned.map(_plNavItemHTML).join(''));
  }
  // Dossiers — regroupement O(N+F) au lieu de O(N×F)
  const byFolder = new Map();
  for (const p of playlists) {
    if (p.folderId && !p.pinned) {
      if (!byFolder.has(p.folderId)) byFolder.set(p.folderId, []);
      byFolder.get(p.folderId).push(p);
    }
  }
  for (const folder of plFolders) {
    parts.push(_plFolderHTML(folder, byFolder.get(folder.id) || []));
  }
  if (ungroupedOrNoFolder.length) {
    parts.push(ungroupedOrNoFolder.map(_plNavItemHTML).join(''));
  }
  return parts;
}

/** Bloc dossier (en-tête focalisable + corps). Extrait de renderPlNav (§16). */
function _plFolderHTML(folder, inside) {
  const collapsed = !!folder.collapsed;
  return `
    <div class="pl-folder${collapsed?' collapsed':''}" data-folder-id="${folder.id}">
      <div class="pl-folder-h"
           role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}"
           aria-label="${esc(folder.name)}"
           data-action="toggle-pl-folder" data-folder-id="${folder.id}"
           data-pl-folder-ctx-id="${folder.id}"
           data-folder-drop-id="${folder.id}"
           title="${esc(folder.name)}">
        <svg class="pl-folder-chev" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="pl-folder-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <span class="pl-folder-name">${esc(folder.name)}</span>
        <span class="pl-folder-count" aria-hidden="true">${inside.length}</span>
      </div>
      <div class="pl-folder-body">
        ${inside.map(_plNavItemHTML).join('') || `<div class="pl-folder-empty">${i18n('pl_folder_empty')}</div>`}
      </div>
    </div>
  `;
}

export function renderPlNav() {
  const el = document.getElementById('pl-list-nav');
  if (!el) return;
  const playlists = get('playlists');
  const plFolders = get('plFolders');

  if (!playlists.length && !plFolders.length) {
    // AUDIT-2026-07-01 M3-CSS : utiliser l'empty-state designé (.pl-nav-empty,
    // style.css) au lieu d'un div inline avec px codés en dur.
    el.innerHTML = `<div class="pl-nav-empty">
      <svg class="pl-nav-empty-ico" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <div class="pl-nav-empty-h">${i18n('pl_empty')}</div>
      <button type="button" class="pl-nav-empty-btn" data-action="new-playlist">${i18n('pl_new')}</button>
    </div>`;
    return;
  }

  const parts = _plNavSectionsHTML(playlists, plFolders);

  // AUDIT-2026-07-01 H9 (SC 2.4.3) : le swap innerHTML détruisait le focus
  // clavier (perdu sur <body> après un « Déplacer vers le haut », un pin, etc.).
  // Mémoriser l'élément focalisé (id ou en-tête de dossier) et le re-focaliser.
  const _act = document.activeElement;
  let _refocus = null;
  if (el.contains(_act)) {
    const idHost = _act.closest('[id]');
    if (idHost?.id) _refocus = '#' + CSS.escape(idHost.id);
    else if (_act.classList?.contains('pl-folder-h')) {
      const fid = _act.closest('.pl-folder')?.dataset.folderId;
      if (fid) _refocus = `.pl-folder[data-folder-id="${CSS.escape(fid)}"] .pl-folder-h`;
    }
  }
  el.innerHTML = parts.join('');
  if (_refocus) el.querySelector(_refocus)?.focus();
  // Sync la grille playlists si elle est actuellement affichée
  if (get('view') === 'playlists') renderPlaylistsGrid();
}

// ── Dossiers : helpers ────────────────────────────────────────

export async function renamePlFolder(folderId) {
  const plFolders = get('plFolders');
  const f = plFolders.find(x => x.id === folderId);
  if (!f) return;
  // S157 FIX-3 : modal cohérent (window.prompt natif est bloquant en Tauri v2)
  const name = await promptAction(i18n('pl_folder_rename_prompt'), f.name, i18n('pl_rename_btn'), i18n('btn_cancel'));
  if (!name) return;
  f.name = name;
  saveCfg();
  renderPlNav();
  setupPlNavDrop();
}

export async function deletePlFolder(folderId) {
  const plFolders = get('plFolders');
  const f = plFolders.find(x => x.id === folderId);
  if (!f) return;
  const ok = await confirmAction(
    `${i18n('pl_folder_del_h')} « ${f.name} » ?`,
    i18n('pl_folder_del_body'),
    i18n('pl_delete'), 'danger'
  );
  if (!ok) return;
  const newFolders = plFolders.filter(x => x.id !== folderId);
  set('plFolders', newFolders);
  // Libérer les playlists du dossier
  get('playlists').forEach(p => { if (p.folderId === folderId) delete p.folderId; });
  saveCfg();
  await savePlaylists();
  renderPlNav();
  setupPlNavDrop();
  toast(i18n('t_pl_folder_deleted'), 'success');
}

export function togglePlFolder(folderId) {
  const plFolders = get('plFolders');
  const f = plFolders.find(x => x.id === folderId);
  if (!f) return;
  f.collapsed = !f.collapsed;
  saveCfg();
  const el = document.querySelector(`.pl-folder[data-folder-id="${folderId}"]`);
  if (el) {
    el.classList.toggle('collapsed', f.collapsed);
    // AUDIT-2026-07-01 C4 : refléter l'état plié/déplié pour les AT
    el.querySelector('.pl-folder-h')?.setAttribute('aria-expanded', f.collapsed ? 'false' : 'true');
  }
}

export function showPlFolderCtxMenu(event, folderId) {
  event.preventDefault();
  event.stopPropagation();
  emit(EVENTS.CTX_MENU_CLOSE, {});
  let menu = document.getElementById('pl-ctx-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'pl-ctx-menu';
    menu.className = 'ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="rename-pl-folder" data-folder-id="${folderId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>
      ${i18n('pl_folder_rename')}
    </div>
    <div class="ctx-item ctx-item--danger" role="menuitem" tabindex="-1" data-action="delete-pl-folder" data-folder-id="${folderId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
      ${i18n('pl_folder_delete')}
    </div>`;
  _openPlCtxMenu(menu, event);
}

// ── Pinned ────────────────────────────────────────────────────
export async function togglePinPlaylist(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  pl.pinned = !pl.pinned;
  await savePlaylists();
  renderPlNav();
  setupPlNavDrop();
  toast(pl.pinned ? i18n('t_pl_pinned') : i18n('t_pl_unpinned'), 'success');
}

// ── Déplacer une playlist dans un dossier (clic droit → "Déplacer vers…") ──
export async function movePlToFolder(plId, folderId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  const folder = get('plFolders').find(f => f.id === folderId);
  if (!folder) return;
  pl.folderId = folderId;
  await savePlaylists();
  renderPlNav();
  setupPlNavDrop();
  toast(i18n('t_pl_moved_to_folder', folder.name) || `Déplacée dans « ${folder.name} »`, 'success');
}

// ── Sortir une playlist de son dossier (clic droit) ──────────
export async function removePlFromFolder(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl || !pl.folderId) return;
  delete pl.folderId;
  await savePlaylists();
  renderPlNav();
  setupPlNavDrop();
  toast(i18n('t_pl_removed_from_folder') || 'Retirée du dossier', 'success');
}


// ── Popup ajout rapide à playlist ────────────────────────────
export function showPlQuickPop(e, trackId, triggerEl) {
  e.stopPropagation();
  // B16 FIX : e.currentTarget vaut `document` dans un listener délégué puis null
  // une fois le dispatch terminé — utiliser l'élément déclencheur passé explicitement.
  const _trigger = triggerEl || e.target?.closest?.('[data-action="show-pl-qpop"]');
  _pqpTrackId = trackId;
  const pop = document.getElementById('pl-quick-pop');
  const playlists = get('playlists');
  if (!playlists.length) { openNewPlaylistModal(trackId); return; }
  // AUDIT-2026-07-01 L3 : branche smart supprimée — la liste est déjà filtrée
  // sur !pl.smart trois lignes plus haut, l'icône étoile était inatteignable.
  pop.innerHTML = `<div class="pqp-head">${i18n('pl_add_to_hd')}</div>` +
    playlists.filter(pl => !pl.smart).map(pl => `
      <div class="pqp-item" data-action="pqp-add" data-pl-id="${pl.id}">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="flex-shrink:0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pl.name)}</span>
        <span style="font-size:10px;color:var(--t3)">${pl.trackIds.length}</span>
      </div>`).join('') +
    `<div style="height:1px;background:var(--bg4);margin:4px 0"></div>
     <div class="pqp-item" data-action="pqp-new">
       <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" style="flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
       ${i18n('pl_new')}
     </div>
     <div class="pqp-item pqp-item--smart" data-action="pqp-smart">
       <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" style="flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
       ${i18n('pl_smart_lbl')}
     </div>`;

  // Afficher hors-écran d'abord pour mesurer la hauteur réelle
  pop.style.visibility = 'hidden';
  pop.style.left = '-9999px';
  pop.style.top  = '0px';
  pop.classList.add('on');

  // Positionner après le paint pour avoir offsetHeight correct
  requestAnimationFrame(() => {
    if (!_trigger) { pop.style.visibility = ''; return; }
    const rect  = _trigger.getBoundingClientRect();
    const popH  = pop.offsetHeight;
    const popW  = pop.offsetWidth || 190;
    const x = Math.max(4, Math.min(rect.left, window.innerWidth  - popW - 8));
    const opensAbove = rect.bottom + 4 + popH > window.innerHeight;
    const y = opensAbove
      ? Math.max(4, rect.top - popH - 4)   // au-dessus si pas de place en dessous
      : rect.bottom + 4;
    pop.style.left = x + 'px';
    pop.style.top  = y + 'px';
    // FIX : adapter transform-origin selon le sens d'ouverture.
    // Sans ça, l'animation scale partait toujours de "top left" même quand
    // le popup s'ouvre au-dessus du bouton → effet de saut visuel.
    pop.style.transformOrigin = `left ${opensAbove ? 'bottom' : 'top'}`;
    pop.style.visibility = '';
  });
}
export function pqpAdd(plId) {
  if (_pqpTrackId) addTrackToPlaylist(_pqpTrackId, plId);
  closePlQuickPop();
}
export function pqpNew() {
  closePlQuickPop();
  openNewPlaylistModal(_pqpTrackId);
}
export function closePlCtxMenu() {
  const menu = document.getElementById('pl-ctx-menu');
  if (!menu || !menu.classList.contains('on')) return;
  menu.classList.remove('on');
  // AUDIT-2026-07-01 C3 : détacher aussi les listeners document (avant : ils
  // traînaient jusqu'au prochain mousedown extérieur) + cleanup clavier/focus.
  if (_plCtxClose)    { document.removeEventListener('mousedown', _plCtxClose,    true); _plCtxClose    = null; }
  if (_plCtxEscClose) { document.removeEventListener('keydown',   _plCtxEscClose, true); _plCtxEscClose = null; }
  _plCtxKeyCleanup(menu);
}

export function getPqpTrackId() { return _pqpTrackId; }

export function closePlQuickPop() {
  document.getElementById('pl-quick-pop').classList.remove('on');
  _pqpTrackId = null;
}
document.addEventListener('click', e => {
  const pop = document.getElementById('pl-quick-pop');
  if (pop && pop.classList.contains('on') && !pop.contains(e.target)) closePlQuickPop();
});

// ── Drag & drop titre → playlist sidebar ─────────────────────
export function onTrackDragStart(e, trackId) {
  _dragTrackId = trackId;
  // En vue playlist sans filtre → move (réorganisation), sinon copy (ajout)
  const view    = get('view');
  const curPlId = get('curPlId');
  const query   = get('query');
  e.dataTransfer.effectAllowed = (view === 'playlist' && curPlId && !query) ? 'move' : 'copy';
  e.dataTransfer.setData('text/plain', trackId);
  setTimeout(() => { const el = document.getElementById('tr-' + trackId); if (el) el.classList.add('dragging'); }, 0);
}

/**
 * WCAG 2.2 SC 2.5.7 — alternative non-drag à la réorganisation des pistes d'une
 * playlist : déplace `trackId` d'un cran (dir -1 = haut, +1 = bas) dans la playlist
 * courante. No-op (false) hors vue playlist, sur une smart playlist, avec un filtre
 * actif, ou en butée. Persiste via savePlaylists (débouncé) puis re-render.
 * @param {string} trackId
 * @param {-1|1}   dir
 * @returns {boolean} true si l'ordre a changé
 */
export function movePlaylistTrack(trackId, dir) {
  const curPlId = get('curPlId');
  if (get('view') !== 'playlist' || !curPlId || get('query')) return false;
  const pl = get('playlists').find(p => p.id === curPlId);
  if (!pl || pl.smart || !Array.isArray(pl.trackIds)) return false;
  const idx = pl.trackIds.indexOf(trackId);
  if (moveByOne(pl.trackIds, idx, dir) < 0) return false;
  savePlaylists();
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {});
  return true;
}

/**
 * WCAG 2.2 SC 2.5.7 — alternative non-drag à la réorganisation des playlists dans
 * la sidebar : déplace la playlist `plId` d'un cran (dir -1 = haut, +1 = bas).
 * AUDIT-2026-07-01 M3 : le déplacement se fait par rapport au voisin du même
 * groupe VISUEL (épinglées / même dossier / hors dossier) — un cran dans le
 * tableau brut pouvait être un no-op à l'écran (voisin array = autre section).
 * Persiste (savePlaylists, débouncé) puis re-render nav.
 * @param {string} plId
 * @param {-1|1}   dir
 * @returns {boolean} true si l'ordre a changé
 */
export function movePlaylist(plId, dir) {
  const playlists = get('playlists');
  const idx = playlists.findIndex(p => p.id === plId);
  if (idx < 0) return false;
  const pl = playlists[idx];
  const folderIds = new Set(get('plFolders').map(f => f.id));
  const inFolder = !pl.pinned && pl.folderId && folderIds.has(pl.folderId);
  const sameGroup = p => pl.pinned ? !!p.pinned
    : inFolder ? (!p.pinned && p.folderId === pl.folderId)
    : (!p.pinned && (!p.folderId || !folderIds.has(p.folderId)));
  let nIdx = -1;
  for (let i = idx + dir; i >= 0 && i < playlists.length; i += dir) {
    if (sameGroup(playlists[i])) { nIdx = i; break; }
  }
  if (nIdx < 0) return false; // butée du groupe
  const [moved] = playlists.splice(idx, 1);
  // Après le splice, insérer à nIdx place l'item juste avant (dir -1) ou juste
  // après (dir +1, le voisin ayant reculé d'un cran) le voisin de même groupe.
  playlists.splice(nIdx, 0, moved);
  savePlaylists();
  renderPlNav();
  return true;
}

// ── Réorganisation playlist par drag-and-drop ──────────────
export function _attachPlaylistReorder(tlist) {
  if (tlist._plReorderAttached) return;
  tlist._plReorderAttached = true;

  tlist._plDragOver = e => {
    const row = e.target.closest('.tr');
    if (!row || !_dragTrackId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // AUDIT-2026-07-01 : lire la géométrie AVANT les écritures de classes —
    // l'ordre écriture→lecture→écriture forçait un reflow synchrone par événement.
    const rect = row.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    tlist.querySelectorAll('.pl-drop-above,.pl-drop-below').forEach(el => {
      el.classList.remove('pl-drop-above', 'pl-drop-below');
    });
    row.classList.add(e.clientY < mid ? 'pl-drop-above' : 'pl-drop-below');
  };

  tlist._plDragLeave = e => {
    if (!e.relatedTarget || !tlist.contains(e.relatedTarget)) {
      tlist.querySelectorAll('.pl-drop-above,.pl-drop-below').forEach(el => {
        el.classList.remove('pl-drop-above', 'pl-drop-below');
      });
    }
  };

  tlist._plDrop = async e => {
    e.preventDefault();
    const row = e.target.closest('.tr');
    tlist.querySelectorAll('.pl-drop-above,.pl-drop-below').forEach(el => {
      el.classList.remove('pl-drop-above', 'pl-drop-below');
    });
    const curPlId = get('curPlId');
    if (!row || !_dragTrackId || !curPlId) return;

    const pl = get('playlists').find(p => p.id === curPlId);
    if (!pl) return;
    // B20 FIX : pas de réorganisation manuelle d'une smart playlist — l'ordre
    // serait écrasé au prochain regenerateSmartPlaylist (contrat read-only).
    if (pl.smart) return;

    const fromId = _dragTrackId;
    const toId   = row.id.replace('tr-', '');
    if (fromId === toId) return;

    const fromIdx = pl.trackIds.indexOf(fromId);
    let   toIdx   = pl.trackIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;

    // Determine drop position (above or below)
    const rect = row.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    if (!insertBefore) toIdx++; // insert after

    // Remove from source position, insert at target
    // Calculer la position cible AVANT le splice (le splice décale les indices)
    let insertAt = toIdx; // BUG-m1 FIX : ligne morte supprimée (toIdx déjà incrémenté ci-dessus)
    // Compenser le décalage causé par la suppression de fromIdx
    if (fromIdx < insertAt) insertAt--;
    // Éviter no-op : si insertAt === fromIdx, l'ordre n'a pas changé
    pl.trackIds.splice(fromIdx, 1);
    pl.trackIds.splice(Math.max(0, Math.min(insertAt, pl.trackIds.length)), 0, fromId);

    await savePlaylists();
    invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
    emit(EVENTS.RENDER_LIB, {});
  };

  tlist.addEventListener('dragover',  tlist._plDragOver);
  tlist.addEventListener('dragleave', tlist._plDragLeave);
  tlist.addEventListener('drop',      tlist._plDrop);
}

export function _detachPlaylistReorder(tlist) {
  if (!tlist._plReorderAttached) return;
  tlist.removeEventListener('dragover',  tlist._plDragOver);
  tlist.removeEventListener('dragleave', tlist._plDragLeave);
  tlist.removeEventListener('drop',      tlist._plDrop);
  tlist._plReorderAttached = false;
}

// S89 : drag & drop pour réorganiser les playlists dans la sidebar
export function onPlNavDragStart(e, plId) {
  _dragPlId = plId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'pl:' + plId);
  e.stopPropagation();
  const btn = document.getElementById('ni-pl-' + plId);
  if (btn) setTimeout(() => btn.classList.add('pl-dragging'), 0);
}

// ── setupPlNavDrop : délégation d'événements sur le conteneur nav ────────────
// Handlers extraits en fonctions module (règle <50 lignes, §16).

function _onPlNavDragOver(nav, e) {
  // Priorité 1 : drag d'une playlist vers un dossier
  if (_dragPlId) {
    const folderEl = e.target.closest('[data-folder-drop-id]');
    if (folderEl) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      nav.querySelectorAll('.pl-folder-drop').forEach(f => f.classList.remove('pl-folder-drop'));
      folderEl.classList.add('pl-folder-drop');
      return;
    }
  }
  const btn = e.target.closest('.ni-pl');
  if (!btn) return;
  e.preventDefault();
  // S89 : si on réorganise une playlist (mode move), afficher les indicateurs above/below
  if (_dragPlId) {
    e.dataTransfer.dropEffect = 'move';
    // AUDIT-2026-07-01 : lecture géométrie avant écritures (anti layout-thrash)
    const isSelf = btn.id === 'ni-pl-' + _dragPlId;
    const rect = isSelf ? null : btn.getBoundingClientRect();
    nav.querySelectorAll('.ni-pl.pl-drop-above, .ni-pl.pl-drop-below, .ni-pl.drag-over')
       .forEach(b => b.classList.remove('pl-drop-above', 'pl-drop-below', 'drag-over'));
    // Ne pas afficher d'indicateur sur la playlist en cours de drag
    if (isSelf) return;
    const mid = rect.top + rect.height / 2;
    btn.classList.add(e.clientY < mid ? 'pl-drop-above' : 'pl-drop-below');
    return;
  }
  // Sinon : drop d'une piste → ajout à la playlist (comportement existant)
  if (_dragTrackId) {
    e.dataTransfer.dropEffect = 'copy';
    nav.querySelectorAll('.ni-pl.drag-over').forEach(b => b.classList.remove('drag-over'));
    btn.classList.add('drag-over');
  }
}

function _onPlNavDragLeave(nav, e) {
  // Retrait du highlight dossier dès qu'on quitte son en-tête
  const folderEl = e.target.closest('[data-folder-drop-id]');
  if (folderEl && !folderEl.contains(e.relatedTarget)) {
    folderEl.classList.remove('pl-folder-drop');
  }
  if (!nav.contains(e.relatedTarget)) {
    nav.querySelectorAll('.pl-folder-drop').forEach(f => f.classList.remove('pl-folder-drop'));
    nav.querySelectorAll('.ni-pl.drag-over, .ni-pl.pl-drop-above, .ni-pl.pl-drop-below')
       .forEach(b => b.classList.remove('drag-over', 'pl-drop-above', 'pl-drop-below'));
  }
}

/** S89 : réorganisation par drop sur une ligne .ni-pl (extrait de _onPlNavDrop). */
async function _dropReorderPlaylist(e, btn, fromId) {
  const toId = btn.id.replace('ni-pl-', '');
  const rect = btn.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  const playlists = get('playlists');
  const fromIdx = playlists.findIndex(p => p.id === fromId);
  let   toIdx   = playlists.findIndex(p => p.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  // AUDIT-2026-07-01 M3 : adopter le conteneur visuel de la cible — déposer
  // entre deux lignes d'un dossier rejoint ce dossier, déposer sur une ligne
  // hors dossier en sort. Avant : l'array était réordonné mais l'item restait
  // dans sa section → aucun changement visible.
  const _fromPl = playlists[fromIdx];
  const _toPl   = playlists[toIdx];
  if (!_fromPl.pinned && _fromPl.folderId !== _toPl.folderId) {
    if (_toPl.folderId) _fromPl.folderId = _toPl.folderId;
    else delete _fromPl.folderId;
  }
  if (!insertBefore) toIdx++;
  if (fromIdx < toIdx) toIdx--;
  if (fromIdx === toIdx) return;
  const [moved] = playlists.splice(fromIdx, 1);
  playlists.splice(toIdx, 0, moved);
  // BUG-M4 FIX : ne pas appeler set() ici — savePlaylists() appelle notify() qui force-notifie
  await savePlaylists();
  renderPlNav();
}

async function _onPlNavDrop(nav, e) {
  e.preventDefault();
  // Nettoyage global des highlights
  nav.querySelectorAll('.pl-folder-drop').forEach(f => f.classList.remove('pl-folder-drop'));
  nav.querySelectorAll('.ni-pl.drag-over, .ni-pl.pl-drop-above, .ni-pl.pl-drop-below')
     .forEach(b => b.classList.remove('drag-over', 'pl-drop-above', 'pl-drop-below'));

  // Priorité 1 : drop d'une playlist dans un dossier
  const folderEl = e.target.closest('[data-folder-drop-id]');
  if (folderEl && _dragPlId) {
    e.stopPropagation();
    const folderId = folderEl.dataset.folderDropId;
    const pl = get('playlists').find(p => p.id === _dragPlId);
    _dragPlId = null;
    if (!pl || pl.folderId === folderId) return;
    pl.folderId = folderId;
    await savePlaylists();
    renderPlNav();
    // B29 FIX : passer le nom du dossier à i18n — sinon toast « … « undefined » ».
    const folder = get('plFolders').find(f => f.id === folderId);
    toast(i18n('t_pl_moved_to_folder', folder?.name) || 'Déplacée dans le dossier', 'success');
    return;
  }

  const btn = e.target.closest('.ni-pl');

  // S89 : réorganisation de playlists
  if (_dragPlId) {
    const fromId = _dragPlId;
    _dragPlId = null;
    if (!btn || btn.id === 'ni-pl-' + fromId) return;
    await _dropReorderPlaylist(e, btn, fromId);
    return;
  }

  // Drop d'une piste sur une playlist (comportement existant)
  if (!btn || !_dragTrackId) return;
  const plId = btn.id.replace('ni-pl-', '');
  addTrackToPlaylist(_dragTrackId, plId);
  _dragTrackId = null;
}

// Appelé une seule fois à l'init — idempotent grâce au flag _plNavDropInit.
export function setupPlNavDrop() {
  const nav = document.getElementById('pl-list-nav');
  if (!nav || _plNavDropInit) return;
  _plNavDropInit = true;

  nav.addEventListener('dragover',  e => _onPlNavDragOver(nav, e));
  nav.addEventListener('dragleave', e => _onPlNavDragLeave(nav, e));
  nav.addEventListener('drop',      e => { _onPlNavDrop(nav, e); });
  // dragend global — une seule fois
  if (!setupPlNavDrop._dragEndAttached) {
    setupPlNavDrop._dragEndAttached = true;
    document.addEventListener('dragend', () => {
      document.querySelectorAll('.tr.dragging').forEach(el => el.classList.remove('dragging'));
      document.querySelectorAll('.ni-pl.drag-over, .ni-pl.pl-drop-above, .ni-pl.pl-drop-below, .ni-pl.pl-dragging')
        .forEach(el => el.classList.remove('drag-over', 'pl-drop-above', 'pl-drop-below', 'pl-dragging'));
      document.querySelectorAll('.pl-folder-drop').forEach(el => el.classList.remove('pl-folder-drop'));
      _dragTrackId = null;
      _dragPlId = null;
    });
  }
}

// ── S90 : Cover custom de playlist (upload image, stocké base64 dans IDB) ──

/** Redimensionne une image en base64 (JPEG) via canvas. */
function _resizeImageToBase64(file, maxSize = 256) {
  return new Promise((ok, fail) => {
    if (!file || !file.type || !file.type.startsWith('image/')) { fail(new Error('not an image')); return; }
    const reader = new FileReader();
    reader.onerror = () => fail(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => fail(new Error('image decode failed'));
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const c  = document.createElement('canvas');
        c.width  = cw; c.height = ch;
        const ctx = c.getContext('2d');
        if (!ctx) { fail(new Error('canvas context unavailable')); return; }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        try { ok(c.toDataURL('image/jpeg', 0.82)); }
        catch (e) { fail(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Met à jour l'aperçu cover dans le modal en fonction de _plModalCoverB64. */
function _renderPlCoverPreview() {
  const prev = document.getElementById('pl-cover-preview');
  const rm   = document.getElementById('pl-cover-rm');
  if (!prev) return;
  if (_plModalCoverB64) {
    prev.innerHTML = `<img src="${esc(_plModalCoverB64)}" alt="" class="pl-cover-img">`;
    prev.classList.add('has-cover');
    if (rm) rm.style.display = '';
  } else {
    prev.innerHTML = `<svg class="pl-cover-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    prev.classList.remove('has-cover');
    if (rm) rm.style.display = 'none';
  }
}

/** Handler input[type=file] → encode et affiche l'aperçu. */
export async function onPlCoverSelected(ev) {
  const f = ev?.target?.files?.[0];
  if (!f) return;
  try {
    _plModalCoverB64 = await _resizeImageToBase64(f, 256);
    _renderPlCoverPreview();
  } catch (e) {
    console.warn('[pl-cover] resize failed', e);
    toast(i18n('t_pl_cover_fail') || 'Impossible de charger cette image', 'warning');
  } finally {
    if (ev.target) ev.target.value = '';
  }
}

/** Retire le cover (revient au placeholder). */
export function clearPlCover() {
  _plModalCoverB64 = null;
  _renderPlCoverPreview();
  const inp = document.getElementById('pl-cover-file');
  if (inp) inp.value = '';
}

const _PL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _buildPlFocusTrap(dialogEl) {
  return function(e) {
    if (e.key !== 'Tab') return;
    const els = [...dialogEl.querySelectorAll(_PL_FOCUSABLE)]
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

export function openNewPlaylistModal(preTrackId) {
  _plModalPrevFocus = document.activeElement;
  plModalMode = 'new';
  document.getElementById('pl-modal-title').textContent = i18n('pl_modal_h');
  const btn = document.getElementById('pl-modal-bg').querySelector('#pl-panel-manual .mbtn.confirm');
  if (btn) btn.textContent = i18n('pl_create');
  document.getElementById('pl-modal-inp').value = '';
  document.getElementById('pl-modal-bg').dataset.pendingTrack = preTrackId || '';
  document.getElementById('pl-modal-bg').dataset.renamePlId   = '';
  document.getElementById('pl-modal-bg').dataset.selBatch     = ''; // éviter contamination batch précédent
  _plModalCoverB64 = null;
  _renderPlCoverPreview();
  const tabs = document.querySelector('.pl-modal-tabs');
  if (tabs) tabs.style.display = '';
  document.getElementById('pl-modal-bg').classList.add('on');
  emit(EVENTS.SMART_PLAYLIST_SWITCH_TAB, { tab: 'manual' });
  const plModal = document.getElementById('pl-modal');
  if (plModal && !_plModalFocusTrap) {
    _plModalFocusTrap = _buildPlFocusTrap(plModal);
    plModal.addEventListener('keydown', _plModalFocusTrap);
  }
  setTimeout(() => document.getElementById('pl-modal-inp').focus(), 50);
}

export function showPlCtxMenu(event, plId) {
  event.preventDefault();
  event.stopPropagation();
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  // Fermer tout menu ouvert
  emit(EVENTS.CTX_MENU_CLOSE, {});
  let menu = document.getElementById('pl-ctx-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'pl-ctx-menu';
    menu.className = 'ctx-menu';
    document.body.appendChild(menu);
  }
  const _hasItems  = pl.trackIds && pl.trackIds.length > 0;
  const _inFolder  = !!pl.folderId;
  const _isPinned  = !!pl.pinned;
  // Sous-menu « Déplacer vers… » (les dossiers existants sauf celui où elle est)
  const _moveOpts = get('plFolders').filter(f => f.id !== pl.folderId);
  menu.innerHTML = `
    ${_hasItems ? `
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="ctx-play-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21"/></svg>
      ${i18n('pl_play_all')}
    </div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="ctx-shuffle-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 5h3a6 6 0 0 1 5.5 3.6"/><path d="M4 19h3a6 6 0 0 0 5.5-3.6"/><polyline points="16 3 20 7 16 11"/><polyline points="16 13 20 17 16 21"/><path d="M20 7h-3a6 6 0 0 0-5 2.7"/><path d="M20 17h-3a6 6 0 0 1-5-2.7"/></svg>
      ${i18n('pl_shuffle')}
    </div>
    <div class="ctx-sep"></div>` : ''}
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="toggle-pin-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="${_isPinned?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l1.4 4.3h4.5l-3.6 2.6 1.4 4.3L12 10.6 8.3 13.2l1.4-4.3L6.1 6.3h4.5z"/></svg>
      ${_isPinned ? i18n('pl_unpin') : i18n('pl_pin')}
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="pl-move-up" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      ${i18n('ctx_move_up')}
    </div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="pl-move-down" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      ${i18n('ctx_move_down')}
    </div>
    ${_moveOpts.length ? `
    <div class="ctx-item ctx-item--sub" role="menuitem" tabindex="-1" aria-haspopup="true">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      ${i18n('pl_move_to_folder')}
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-left:auto" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
      <div class="ctx-submenu" role="menu">
        ${_moveOpts.map(f => `
          <div class="ctx-item" role="menuitem" tabindex="-1" data-action="move-pl-folder" data-pl-id="${plId}" data-folder-id="${f.id}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            ${esc(f.name)}
          </div>`).join('')}
      </div>
    </div>` : ''}
    ${_inFolder ? `
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="remove-pl-folder" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      ${i18n('pl_remove_from_folder')}
    </div>` : ''}
    <div class="ctx-sep"></div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-action="rename-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>
      ${i18n('pl_rename_btn')}
    </div>
    <div class="ctx-item ctx-item--danger" role="menuitem" tabindex="-1" data-action="delete-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
      ${i18n('pl_delete')}
    </div>`;
  _openPlCtxMenu(menu, event);
}

/** Lire toute la playlist depuis le menu contextuel sidebar (navigue + joue). */
export function ctxPlayPlaylist(plId) {
  closePlCtxMenu();
  const niBtn = document.getElementById('ni-pl-' + plId);
  emit(EVENTS.VIEW_REQUEST, { view: 'playlist', btn: niBtn, plId });
  setTimeout(() => playPlaylistFrom(0), 80);
}
/** Lecture aléatoire depuis le menu contextuel sidebar. */
export function ctxShufflePlaylist(plId) {
  closePlCtxMenu();
  const niBtn = document.getElementById('ni-pl-' + plId);
  emit(EVENTS.VIEW_REQUEST, { view: 'playlist', btn: niBtn, plId });
  setTimeout(() => shufflePlaylist(), 80);
}

export function openRenamePlaylistModal(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return; // smart playlists peuvent aussi être renommées
  _plModalPrevFocus = document.activeElement;
  plModalMode = 'rename';
  document.getElementById('pl-modal-title').textContent = i18n('pl_rename_title');
  const btn = document.getElementById('pl-modal-bg').querySelector('#pl-panel-manual .mbtn.confirm');
  if (btn) btn.textContent = i18n('pl_rename_btn');
  document.getElementById('pl-modal-inp').value = pl.name;
  document.getElementById('pl-modal-bg').dataset.pendingTrack = '';
  document.getElementById('pl-modal-bg').dataset.renamePlId   = plId;
  _plModalCoverB64 = pl.coverB64 || null;
  _renderPlCoverPreview();
  // FIX-B3 : reset de l'état actif des onglets AVANT de les cacher
  // (évite le désync visuel si l'utilisateur était sur l'onglet Smart)
  emit(EVENTS.SMART_PLAYLIST_SWITCH_TAB, { tab: 'manual' });
  const tabs = document.querySelector('.pl-modal-tabs');
  if (tabs) tabs.style.display = 'none';
  document.getElementById('pl-panel-manual').style.display = '';
  document.getElementById('pl-panel-smart').style.display  = 'none';
  document.getElementById('pl-modal-bg').classList.add('on');
  const plModalR = document.getElementById('pl-modal');
  if (plModalR && !_plModalFocusTrap) {
    _plModalFocusTrap = _buildPlFocusTrap(plModalR);
    plModalR.addEventListener('keydown', _plModalFocusTrap);
  }
  setTimeout(() => {
    const inp = document.getElementById('pl-modal-inp');
    inp.focus(); inp.select();
  }, 50);
}

export function closePlModal() {
  const _plBg = document.getElementById('pl-modal-bg');
  _plBg.classList.add('modal-closing');
  _plBg.addEventListener('animationend', () => {
    _plBg.classList.remove('on', 'modal-closing');
  }, { once: true });
  setTimeout(() => _plBg.classList.remove('on', 'modal-closing'), 250);
  emit(EVENTS.CTX_MENU_CLOSE, {});
  // S88 FIX : reset complet de l'état modal pour éviter les fuites d'état
  // Avant le fix, plModalMode/datasets pouvaient persister entre deux ouvertures
  // (ex. rename → fermeture sans sauvegarde → nouvelle playlist avec mode 'rename' fantôme)
  plModalMode = 'new';
  const bg = document.getElementById('pl-modal-bg');
  if (bg) {
    bg.dataset.renamePlId   = '';
    bg.dataset.pendingTrack = '';
    bg.dataset.selBatch     = '';
  }
  const inp = document.getElementById('pl-modal-inp');
  if (inp) inp.value = '';
  _plModalCoverB64 = null;
  _renderPlCoverPreview();
  const coverInp = document.getElementById('pl-cover-file');
  if (coverInp) coverInp.value = '';
  const plModal = document.getElementById('pl-modal');
  if (plModal && _plModalFocusTrap) {
    plModal.removeEventListener('keydown', _plModalFocusTrap);
    _plModalFocusTrap = null;
  }
  _plModalPrevFocus?.focus();
  _plModalPrevFocus = null;
}

// Guard anti double-submit (double clic sur "Créer" / Enter répété)
export async function confirmPlaylistModal() {
  if (_plModalBusy) return;
  // S88 FIX : lire le nom ET le mode IMMÉDIATEMENT et snapshoter dans des locals
  // Avant, plModalMode était relu après l'await — risque si un autre handler le modifiait
  const inp     = document.getElementById('pl-modal-inp');
  const rawName = inp ? inp.value : '';
  const name    = rawName.trim();
  const mode    = plModalMode;

  // S88 FIX : feedback explicite si nom vide (au lieu d'un silent return)
  if (!name) {
    if (inp) {
      inp.classList.add('shake');
      setTimeout(() => inp.classList.remove('shake'), 400);
      inp.focus();
    }
    toast(i18n('t_pl_name_required') || 'Donne un nom à ta playlist', 'warning');
    return;
  }

  _plModalBusy = true;
  try {
    if (mode === 'rename') {
      const plId = document.getElementById('pl-modal-bg').dataset.renamePlId;
      const pl = get('playlists').find(p => p.id === plId);
      if (!pl) { closePlModal(); return; }
      pl.name = name;
      // S90 : sauvegarder / retirer le cover custom
      if (_plModalCoverB64) pl.coverB64 = _plModalCoverB64;
      else delete pl.coverB64;
      // Nettoyer les datasets pour éviter les effets de bord
      document.getElementById('pl-modal-bg').dataset.selBatch     = '';
      document.getElementById('pl-modal-bg').dataset.pendingTrack = '';
      await savePlaylists();
      renderPlNav();
      setupPlNavDrop();
      closePlModal();
      const curPlId = get('curPlId');
      if (get('view') === 'playlist' && curPlId === plId) {
        document.getElementById('vhtitle').textContent = name;
      }
      toast(i18n('t_pl_renamed', name) || `Playlist renommée en « ${name} »`, 'success');
      return;
    }

    // Mode création
    // S88 FIX : capturer les datasets AVANT toute autre opération (évite qu'un handler
    // async concurrent ne les modifie entre-temps)
    const bg       = document.getElementById('pl-modal-bg');
    const pending  = bg.dataset.pendingTrack;
    const selBatch = bg.dataset.selBatch;
    // Construire l'objet playlist avec le nom en local (pas via variable modifiable)
    const pl = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: name, trackIds: [] };
    if (_plModalCoverB64) pl.coverB64 = _plModalCoverB64;
    if (pending) pl.trackIds.push(pending);
    if (selBatch) selBatch.split(',').filter(Boolean).forEach(id => { if (!pl.trackIds.includes(id)) pl.trackIds.push(id); });
    // Clear datasets avant l'await pour éviter contamination si l'utilisateur réouvre le modal
    bg.dataset.selBatch     = '';
    bg.dataset.pendingTrack = '';
    get('playlists').push(pl);
    notify('playlists'); // CM-5 FIX: push() in-place → notify() so subscribers see the change
    await savePlaylists();
    renderPlNav();
    setupPlNavDrop();
    closePlModal();
    if (selBatch) { emit(EVENTS.SELECTION_CLEAR, {}); toast(i18n('t_added_to', name), 'success'); }
    else if (pending) toast(i18n('t_added_to', name), 'success');
    else { emit(EVENTS.VIEW_REQUEST, { view: 'playlist', btn: document.getElementById('ni-pl-'+pl.id), plId: pl.id }); toast(i18n('t_pl_created', name), 'success'); }
  } finally {
    _plModalBusy = false;
  }
}

export async function deletePlaylist(e, plId) {
  e.stopPropagation();
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;

  if (pl.trackIds && pl.trackIds.length > 0) {
    // Playlist non vide → confirmation obligatoire (risque de perte de données)
    const confirmed = await confirmAction(
      i18n('pl_delete_confirm_h', pl.name) || `Supprimer « ${pl.name} » ?`,
      i18n('pl_delete_confirm_body', pl.trackIds.length) || `${pl.trackIds.length} titre${pl.trackIds.length > 1 ? 's' : ''} seront retirés de la playlist (les fichiers restent sur le disque).`,
      i18n('pl_delete_confirm_btn') || 'Supprimer', 'danger'
    );
    if (!confirmed) return;
    // Suppression définitive (playlist avec contenu)
    set('playlists', get('playlists').filter(p => p.id !== plId));
    await savePlaylists();
    const curPlId = get('curPlId');
    if (curPlId === plId) { emit(EVENTS.VIEW_REQUEST, { view: 'all', btn: document.getElementById('ni-all') }); set('curPlId', null); }
    renderPlNav();
    toast(i18n('t_pl_deleted'), 'success');
  } else {
    // FIX-B10 : playlist vide → suppression immédiate avec undo 5s (pas de dialogue bloquant)
    const plSnapshot = { ...pl, trackIds: [...(pl.trackIds || [])] };
    set('playlists', get('playlists').filter(p => p.id !== plId));
    const curPlId = get('curPlId');
    if (curPlId === plId) { emit(EVENTS.VIEW_REQUEST, { view: 'all', btn: document.getElementById('ni-all') }); set('curPlId', null); }
    renderPlNav();

    let undone = false;
    const UNDO_MS = 5000;
    const saveTimer = setTimeout(() => {
      if (!undone) savePlaylists().catch(e => console.warn('[playlists:savePlaylists delete]', e));
    }, UNDO_MS);

    toastWithAction(i18n('t_pl_deleted'), 'success', i18n('t_undo') || 'Annuler', () => {
      undone = true;
      clearTimeout(saveTimer);
      get('playlists').push(plSnapshot);
      notify('playlists'); // BUG-M4 FIX : push() in-place → notify() (set() ignore same-ref)
      savePlaylists().catch(e => console.warn('[playlists:savePlaylists undo-delete]', e));
      renderPlNav();
      toast(i18n('t_undo_done') || 'Annulé', 'info');
    }, UNDO_MS);
  }
}

export async function addTrackToPlaylist(trackId, plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  if (pl?.smart) {
    toast(i18n('t_smart_readonly') || 'Les playlists intelligentes ne peuvent pas être modifiées manuellement.', 'warning');
    return;
  }
  const sid = String(trackId);
  if (pl.trackIds.some(id => String(id) === sid)) { toast(i18n('t_already_in'), 'warning'); return; }
  pl.trackIds.push(sid);
  await savePlaylists();
  renderPlNav();
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
  toast(i18n('t_added_to', pl.name), 'success');
}

export function removeTrackFromPlaylist(trackId, plId) {
  const pl = get('playlists').find(p=>p.id===plId);
  if (!pl || !pl.trackIds) return;
  if (pl?.smart) {
    toast(i18n('t_smart_readonly') || 'Les playlists intelligentes ne peuvent pas être modifiées manuellement.', 'warning');
    return;
  }
  // UNDO-PL FIX : mémoriser la position avant suppression pour permettre l'annulation
  const removedIdx = pl.trackIds.indexOf(trackId);
  if (removedIdx === -1) return; // trackId absent — rien à faire
  // B4 FIX : ancrer sur l'id des voisins, pas sur un index numérique — une 2e
  // suppression dans la même playlist décale pl.trackIds et rend removedIdx périmé.
  const _prevAnchorId = removedIdx > 0 ? pl.trackIds[removedIdx - 1] : null;
  const _nextAnchorId = removedIdx < pl.trackIds.length - 1 ? pl.trackIds[removedIdx + 1] : null;

  // Retrait immédiat en mémoire + mise à jour UI
  pl.trackIds = pl.trackIds.filter(id => id !== trackId);
  renderPlNav();
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});

  // Différer la persistance pour permettre l'annulation dans la fenêtre de 5 s
  const UNDO_MS = 5000;
  let undone = false;
  const saveTimer = setTimeout(() => {
    if (!undone) savePlaylists().catch(e => console.warn('[playlists:savePlaylists remove-track]', e));
  }, UNDO_MS);

  toastWithAction(i18n('t_removed'), 'success', i18n('t_undo') || 'Annuler', () => {
    undone = true;
    clearTimeout(saveTimer);
    // B4 FIX : ré-insérer après l'ancre précédente si elle existe encore, sinon
    // avant la suivante, sinon en tête — robuste face à une 2e suppression.
    if (!pl.trackIds.includes(trackId)) {
      const _prevPos = _prevAnchorId != null ? pl.trackIds.indexOf(_prevAnchorId) : -1;
      let _insertAt;
      if (_prevPos >= 0) {
        _insertAt = _prevPos + 1;
      } else {
        const _nextPos = _nextAnchorId != null ? pl.trackIds.indexOf(_nextAnchorId) : -1;
        _insertAt = _nextPos >= 0 ? _nextPos : 0;
      }
      pl.trackIds.splice(_insertAt, 0, trackId);
    }
    savePlaylists().catch(e => console.warn('[playlists:savePlaylists undo-remove-track]', e));
    renderPlNav();
    if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
    toast(i18n('t_undo_done') || 'Annulé', 'info');
  }, UNDO_MS);
}

// FIX-B5 : Enter/Escape câblés sur tous les champs texte du modal (manuel + smart)
// Avant : seul pl-modal-inp avait le listener → Enter ignoré dans les champs Smart
['pl-modal-inp', 'smart-pl-name', 'spl-rules-name'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('keydown', e => {
    if (e.code === 'Enter') { e.preventDefault(); confirmPlaylistModal(); }
    if (e.code === 'Escape') { e.preventDefault(); closePlModal(); }
  });
});
