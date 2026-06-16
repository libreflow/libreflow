// LibreFlow — playlists.js
// Hero display, modals, ctx menus, cover art, drag-to-reorder.
// CRUD → playlist-crud.js  |  nav sidebar → playlist-nav.js (barrel re-exported at bottom).

import { modalOpen, modalClose } from './motion.js';
import { esc }                   from './utils.js';
import { i18n }                  from './i18n.js';
import { get, set, notify }      from './store.js';
import { emit, EVENTS }          from './bus.js';
import { toast }                 from './ui.js';
import { closeCtxMenu }          from './ctxmenu.js';
import { openSmartPlaylistModal, switchPlTab } from './smartplaylist.js';
import { clearSelection }        from './selection.js';
import { invalidateFilterCache } from './search.js';
import { FOCUSABLE_SEL }         from './modal.js';
import { setView }               from './views.js';

import { savePlaylists, deletePlaylist, addTrackToPlaylist,
         removeTrackFromPlaylist, togglePinPlaylist, movePlToFolder,
         removePlFromFolder, movePlaylist, movePlaylistTrack,
         playPlaylistFrom, playPlaylistDirect,
         shufflePlaylist }                    from './playlist-crud.js';
import { renderPlNav, setupPlNavDrop, onPlNavDragStart,
         renamePlFolder, deletePlFolder, togglePlFolder,
         showPlFolderCtxMenu, _plNavInlineRename,
         setNavDragTrackId }                  from './playlist-nav.js';

// ── État local du module ─────────────────────────────────────────
let plModalMode       = 'new';  // 'new' | 'rename'
let _pqpTrackId       = null;   // track en cours dans le quick-pop ajout playlist
let _dragTrackId      = null;   // track en cours de drag (sidebar + reorder)
let _plCtxClose       = null;   // listener mousedown pour fermer le ctx-menu playlist
let _plCtxEscClose    = null;   // listener keydown Escape pour fermer le ctx-menu playlist
let _plModalPrevFocus = null;   // focus à restaurer après fermeture du modal
let _plModalFocusTrap = null;   // keydown handler Tab-trap dans #pl-modal
let _plModalCoverB64  = null;   // cover en cours d'édition dans le modal
let _plModalBusy      = false;  // guard anti double-submit confirmPlaylistModal
let _heroMosaicGen    = 0;      // B19 : token anti-race pour les img.onload du hero-mosaic

/** Setter pour smartplaylist.js (window.setPlModalMode). */
export function setPlModalMode(v) { plModalMode = v; }

/** Attache les listeners mousedown + Escape pour fermer le ctx-menu playlist/dossier. */
function _attachPlCtxClose(menu) {
  if (_plCtxClose)    { document.removeEventListener('mousedown', _plCtxClose,    true); _plCtxClose    = null; }
  if (_plCtxEscClose) { document.removeEventListener('keydown',   _plCtxEscClose, true); _plCtxEscClose = null; }
  // B27 FIX : _close capture ses propres références locales pour éviter que
  // l'ouverture d'un 2e menu n'écrase les vars module et ne laisse des listeners orphelins.
  const _close = () => {
    menu.classList.remove('on');
    document.removeEventListener('mousedown', mdHandler,  true);
    document.removeEventListener('keydown',   escHandler, true);
    if (_plCtxClose    === mdHandler)  _plCtxClose    = null;
    if (_plCtxEscClose === escHandler) _plCtxEscClose = null;
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

/** Focus trap (WCAG 2.1.2) — confine le focus à l'intérieur d'un modal. Retourne un cleanup. */
export function trapFocus(containerEl) {
  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  function handler(e) {
    if (e.code !== 'Tab') return;
    const visible = containerEl.classList.contains('on') ||
                    containerEl.style.display === 'flex';
    if (!visible) return;
    const els = [...containerEl.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null && !el.closest('[hidden]'));
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (!containerEl.contains(document.activeElement) || document.activeElement === first) {
        e.preventDefault(); last.focus();
      }
    } else {
      if (!containerEl.contains(document.activeElement) || document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }
  containerEl.addEventListener('keydown', handler);
  return () => containerEl.removeEventListener('keydown', handler);
}

// ── Hero playlist ─────────────────────────────────────────────────────────────

/** Rend le hero header de la vue playlist : cover, nom éditable, stats. */
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

/** Dessine une mosaïque 2×2 des pochettes dans #pl-hero-mosaic. */
function _drawHeroMosaic(fl) {
  // B19 FIX : token de génération — évite qu'un img.onload lent d'une playlist précédente
  // ne peigne sur le canvas d'une playlist ouverte depuis.
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
      if (_heroMosaicGen !== _myGen) return;
      const cv = document.getElementById('pl-hero-mosaic'); if (!cv) return;
      const ctx2d = cv.getContext('2d'); if (ctx2d) ctx2d.drawImage(img, px, py, 100, 100);
    };
    img.onerror = () => {
      if (_heroMosaicGen !== _myGen) return;
      const cv = document.getElementById('pl-hero-mosaic'); if (!cv) return;
      const c2 = cv.getContext('2d'); if (!c2) return;
      c2.fillStyle = '#1a1a2a'; c2.fillRect(px, py, 100, 100);
    };
    img.src = toLoad[i];
  }
}

/** Changer le tri interne de la playlist courante. Persiste dans pl.sort + re-rend. */
export async function setPlSort(val) {
  const playlists = get('playlists');
  const curPlId   = get('curPlId');
  const pl = playlists.find(p => p.id === curPlId);
  if (!pl || get('plSort') === val) return;
  set('plSort', val);
  pl.sort = val;
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  emit(EVENTS.RENDER_LIB, {});
  await savePlaylists().catch(e => console.warn('[playlists] setPlSort save failed:', e));
}

/** Renommage inline du nom dans le hero (double-clic). */
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
    el.contentEditable = 'false';
    const newName = el.textContent.trim();
    if (newName && newName !== orig) {
      pl.name = newName;
      try {
        await savePlaylists();
      } catch (e) {
        pl.name = orig;
        el.textContent = orig;
        console.warn('[playlists] hero inline rename IDB failed:', e);
        toast(i18n('error_save') || 'Erreur de sauvegarde', 'error');
        return;
      }
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

// ── Popup ajout rapide à playlist ─────────────────────────────────────────────
export function showPlQuickPop(e, trackId, triggerEl) {
  e.stopPropagation();
  // B16 FIX : utiliser l'élément déclencheur explicite (e.currentTarget vaut null après dispatch).
  const _trigger = triggerEl || e.target?.closest?.('[data-action="show-pl-qpop"]');
  _pqpTrackId = trackId;
  const pop = document.getElementById('pl-quick-pop');
  const playlists = get('playlists');
  if (!playlists.length) { openNewPlaylistModal(trackId); return; }
  pop.innerHTML = `<div class="pqp-head">${i18n('pl_add_to_hd')}</div>` +
    playlists.filter(pl => !pl.smart).map(pl => `
      <div class="pqp-item" data-action="pqp-add" data-pl-id="${pl.id}">
        ${pl.smart
          ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" style="color:#f59e0b;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
          : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="flex-shrink:0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
        }
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

  // Afficher hors-écran pour mesurer la hauteur réelle avant positionnement
  pop.style.visibility = 'hidden';
  pop.style.left = '-9999px';
  pop.style.top  = '0px';
  pop.classList.add('on');

  requestAnimationFrame(() => {
    if (!_trigger) { pop.style.visibility = ''; return; }
    const rect  = _trigger.getBoundingClientRect();
    const popH  = pop.offsetHeight;
    const popW  = pop.offsetWidth || 190;
    const x = Math.max(4, Math.min(rect.left, window.innerWidth  - popW - 8));
    const opensAbove = rect.bottom + 4 + popH > window.innerHeight;
    const y = opensAbove
      ? Math.max(4, rect.top - popH - 4)
      : rect.bottom + 4;
    pop.style.left = x + 'px';
    pop.style.top  = y + 'px';
    // FIX : adapter transform-origin pour éviter un saut visuel à l'ouverture au-dessus
    pop.style.transformOrigin = `left ${opensAbove ? 'bottom' : 'top'}`;
    pop.style.visibility = '';
  });
}
export function pqpAdd(plId) { if (_pqpTrackId) addTrackToPlaylist(_pqpTrackId, plId); closePlQuickPop(); }
export function pqpNew() { closePlQuickPop(); openNewPlaylistModal(_pqpTrackId); }
export function closePlCtxMenu() { document.getElementById('pl-ctx-menu')?.classList.remove('on'); }

export function getPqpTrackId() { return _pqpTrackId; }

export function closePlQuickPop() {
  // PLAYLISTS-5: optional chaining guards against missing element
  document.getElementById('pl-quick-pop')?.classList.remove('on');
  _pqpTrackId = null;
}
document.addEventListener('click', e => {
  const pop = document.getElementById('pl-quick-pop');
  if (pop && pop.classList.contains('on') && !pop.contains(e.target)) closePlQuickPop();
});

// ── Drag & drop titre → playlist sidebar ──────────────────────────────────────
export function onTrackDragStart(e, trackId) {
  _dragTrackId = trackId;
  setNavDragTrackId(trackId); // Sync drag-track state into playlist-nav.js
  // En vue playlist sans filtre → move (réorganisation), sinon copy (ajout)
  const view    = get('view');
  const curPlId = get('curPlId');
  const query   = get('query');
  e.dataTransfer.effectAllowed = (view === 'playlist' && curPlId && !query) ? 'move' : 'copy';
  e.dataTransfer.setData('text/plain', trackId);
  setTimeout(() => { const el = document.getElementById('tr-' + trackId); if (el) el.classList.add('dragging'); }, 0);
}
// PLAYLISTS-1: clear _dragTrackId on drag cancel so spurious reorders cannot occur
document.addEventListener('dragend', () => { _dragTrackId = null; });

// ── Réorganisation playlist par drag-and-drop ─────────────────────────────────
export function _attachPlaylistReorder(tlist) {
  if (tlist._plReorderAttached) return;
  tlist._plReorderAttached = true;

  tlist._plDragOver = e => {
    const row = e.target.closest('.tr');
    if (!row || !_dragTrackId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear previous indicators
    tlist.querySelectorAll('.pl-drop-above,.pl-drop-below').forEach(el => {
      el.classList.remove('pl-drop-above', 'pl-drop-below');
    });
    const rect = row.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
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
    if (pl.smart) return; // B20 FIX : smart playlist = read-only, order reset by regenerateSmartPlaylist

    const fromId = _dragTrackId;
    const toId   = row.id.replace('tr-', '');
    if (fromId === toId) return;

    const fromIdx = pl.trackIds.indexOf(fromId);
    let   toIdx   = pl.trackIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const rect = row.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    if (!insertBefore) toIdx++;

    // BUG-m1 FIX : calculer insertAt avant splice ; compenser le décalage causé par la suppression
    // PLAYLISTS-4: snapshot trackIds; rollback splice on IDB failure
    const _snapshot = [...pl.trackIds];
    let insertAt = toIdx;
    if (fromIdx < insertAt) insertAt--;
    pl.trackIds.splice(fromIdx, 1);
    pl.trackIds.splice(Math.max(0, Math.min(insertAt, pl.trackIds.length)), 0, fromId);

    try { await savePlaylists(); }
    catch (e) {
      pl.trackIds = _snapshot;
      console.warn('[playlists] reorder IDB failed:', e);
      toast(i18n('error_save') || 'Erreur de sauvegarde', 'error');
      return;
    }
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

// ── Cover custom de playlist (upload image → base64 → IDB) ───────────────────

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


function _buildPlFocusTrap(dialogEl) {
  return function(e) {
    if (e.key !== 'Tab') return;
    const els = [...dialogEl.querySelectorAll(FOCUSABLE_SEL)]
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
  switchPlTab('manual');
  const plModal = document.getElementById('pl-modal');
  if (plModal && !_plModalFocusTrap) {
    _plModalFocusTrap = _buildPlFocusTrap(plModal);
    plModal.addEventListener('keydown', _plModalFocusTrap);
  }
  if (plModal) modalOpen(plModal);
  setTimeout(() => document.getElementById('pl-modal-inp').focus(), 50);
}

export function showPlCtxMenu(event, plId) {
  event.preventDefault();
  event.stopPropagation();
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  // Fermer tout menu ouvert
  closeCtxMenu();
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
    <div class="ctx-item" data-action="ctx-play-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21"/></svg>
      ${i18n('pl_play_all')}
    </div>
    <div class="ctx-item" data-action="ctx-shuffle-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 5h3a6 6 0 0 1 5.5 3.6"/><path d="M4 19h3a6 6 0 0 0 5.5-3.6"/><polyline points="16 3 20 7 16 11"/><polyline points="16 13 20 17 16 21"/><path d="M20 7h-3a6 6 0 0 0-5 2.7"/><path d="M20 17h-3a6 6 0 0 1-5-2.7"/></svg>
      ${i18n('pl_shuffle')}
    </div>
    <div class="ctx-sep"></div>` : ''}
    <div class="ctx-item" data-action="toggle-pin-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="${_isPinned?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.4 4.3h4.5l-3.6 2.6 1.4 4.3L12 10.6 8.3 13.2l1.4-4.3L6.1 6.3h4.5z"/></svg>
      ${_isPinned ? i18n('pl_unpin') : i18n('pl_pin')}
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-action="pl-move-up" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      ${i18n('ctx_move_up')}
    </div>
    <div class="ctx-item" data-action="pl-move-down" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      ${i18n('ctx_move_down')}
    </div>
    ${_moveOpts.length ? `
    <div class="ctx-item ctx-item--sub">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      ${i18n('pl_move_to_folder')}
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-left:auto"><polyline points="9 18 15 12 9 6"/></svg>
      <div class="ctx-submenu">
        ${_moveOpts.map(f => `
          <div class="ctx-item" data-action="move-pl-folder" data-pl-id="${plId}" data-folder-id="${f.id}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            ${esc(f.name)}
          </div>`).join('')}
      </div>
    </div>` : ''}
    ${_inFolder ? `
    <div class="ctx-item" data-action="remove-pl-folder" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      ${i18n('pl_remove_from_folder')}
    </div>` : ''}
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-action="rename-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>
      ${i18n('pl_rename_btn')}
    </div>
    <div class="ctx-item ctx-item--danger" data-action="delete-pl" data-pl-id="${plId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
      ${i18n('pl_delete')}
    </div>`;
  // S157 FIX-5 : positionnement basé sur la hauteur réelle du menu
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top  = '0px';
  menu.classList.add('on');
  const mw = menu.offsetWidth  || 200;
  const mh = menu.offsetHeight || 200;
  const pad = 8;
  const x = Math.max(pad, Math.min(event.clientX, window.innerWidth  - mw - pad));
  const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - mh - pad));
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.style.visibility = '';
  _attachPlCtxClose(menu); // FIX-B9 : fermeture mousedown extérieur + Escape
}

/** Lire toute la playlist depuis le ctx-menu sidebar (navigue + joue). */
export function ctxPlayPlaylist(plId) {
  document.getElementById('pl-ctx-menu')?.classList.remove('on');
  setView('playlist', document.getElementById('ni-pl-' + plId), plId);
  setTimeout(() => playPlaylistFrom(0), 80);
}
/** Lecture aléatoire depuis le ctx-menu sidebar. */
export function ctxShufflePlaylist(plId) {
  document.getElementById('pl-ctx-menu')?.classList.remove('on');
  setView('playlist', document.getElementById('ni-pl-' + plId), plId);
  setTimeout(() => shufflePlaylist(), 80);
}

export function openRenamePlaylistModal(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
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
  switchPlTab('manual'); // FIX-B3 : reset onglets AVANT de les cacher (évite désync visuel)
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
  if (plModalR) modalOpen(plModalR);
  setTimeout(() => {
    const inp = document.getElementById('pl-modal-inp');
    inp.focus(); inp.select();
  }, 50);
}

export function closePlModal() {
  const _plBg = document.getElementById('pl-modal-bg');
  const _plModal = document.getElementById('pl-modal');
  const _doClose = () => _plBg.classList.remove('on');
  // PLAYLISTS-7: .catch(_doClose) ensures _doClose runs even if modalClose rejects
  if (_plModal) modalClose(_plModal).then(_doClose).catch(_doClose);
  else _doClose();
  closeCtxMenu();
  // S88 FIX : reset complet pour éviter les fuites d'état entre ouvertures
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

export async function confirmPlaylistModal() {
  if (_plModalBusy) return;
  // S88 FIX : snapshoter nom+mode immédiatement (plModalMode relu après await = risque de race)
  const inp     = document.getElementById('pl-modal-inp');
  const rawName = inp ? inp.value : '';
  const name    = rawName.trim();
  const mode    = plModalMode;

  if (!name) { // S88 FIX : feedback explicite si nom vide
    if (inp) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); inp.focus(); }
    toast(i18n('t_pl_name_required') || 'Donne un nom à ta playlist', 'warning');
    return;
  }

  _plModalBusy = true;
  try {
    if (mode === 'rename') {
      const plId = document.getElementById('pl-modal-bg').dataset.renamePlId;
      const pl = get('playlists').find(p => p.id === plId);
      if (!pl) { closePlModal(); return; }
      // PLAYLISTS-2: snapshot before mutation; rollback on IDB failure
      const origName  = pl.name;
      const origCover = pl.coverB64;
      pl.name = name;
      if (_plModalCoverB64) pl.coverB64 = _plModalCoverB64; // S90 : cover custom
      else delete pl.coverB64;
      document.getElementById('pl-modal-bg').dataset.selBatch     = '';
      document.getElementById('pl-modal-bg').dataset.pendingTrack = '';
      try { await savePlaylists(); }
      catch (e) {
        pl.name = origName;
        if (origCover !== undefined) pl.coverB64 = origCover; else delete pl.coverB64;
        console.warn('[playlists] rename IDB failed:', e);
        toast(i18n('error_save') || 'Erreur de sauvegarde', 'error'); return;
      }
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

    // Mode création — S88 FIX : capturer les datasets avant tout await
    const bg       = document.getElementById('pl-modal-bg');
    const pending  = bg.dataset.pendingTrack;
    const selBatch = bg.dataset.selBatch;
    const pl = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: name, trackIds: [] };
    if (_plModalCoverB64) pl.coverB64 = _plModalCoverB64;
    if (pending) pl.trackIds.push(pending);
    if (selBatch) selBatch.split(',').filter(Boolean).forEach(id => { if (!pl.trackIds.includes(id)) pl.trackIds.push(id); });
    // Clear datasets avant l'await (évite contamination si l'utilisateur réouvre le modal)
    bg.dataset.selBatch     = '';
    bg.dataset.pendingTrack = '';
    // PLAYLISTS-3: push to memory, rollback on IDB failure
    get('playlists').push(pl);
    notify('playlists'); // CM-5 FIX: push() in-place → notify() so subscribers see the change
    try { await savePlaylists(); }
    catch (e) {
      const pls = get('playlists'); pls.splice(pls.indexOf(pl), 1); notify('playlists');
      console.warn('[playlists] new playlist IDB failed:', e);
      toast(i18n('error_save') || 'Erreur de sauvegarde', 'error'); return;
    }
    renderPlNav();
    setupPlNavDrop();
    closePlModal();
    if (selBatch) { clearSelection(); toast(i18n('t_added_to', name), 'success'); }
    else if (pending) toast(i18n('t_added_to', name), 'success');
    else { setView('playlist', document.getElementById('ni-pl-'+pl.id), pl.id); toast(i18n('t_pl_created', name), 'success'); }
  } finally {
    _plModalBusy = false;
  }
}

// FIX-B5 : Enter/Escape câblés sur tous les champs texte du modal (manuel + smart)
['pl-modal-inp', 'smart-pl-name', 'spl-rules-name'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('keydown', e => {
    if (e.code === 'Enter') { e.preventDefault(); confirmPlaylistModal(); }
    if (e.code === 'Escape') { e.preventDefault(); closePlModal(); }
  });
});
// ── Barrel re-exports — call sites externes inchangés ────────────────────────
export { savePlaylists, addTrackToPlaylist, removeTrackFromPlaylist,
         deletePlaylist, togglePinPlaylist, movePlToFolder,
         removePlFromFolder, movePlaylist, movePlaylistTrack,
         playPlaylistFrom, playPlaylistDirect,
         shufflePlaylist }                    from './playlist-crud.js';
export { renderPlNav, setupPlNavDrop, onPlNavDragStart,
         renamePlFolder, deletePlFolder, togglePlFolder,
         showPlFolderCtxMenu, _plNavInlineRename }                from './playlist-nav.js';
