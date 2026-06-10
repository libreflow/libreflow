// playlist-nav.js — Sidebar nav playlists + dossiers + drag sidebar
// Extrait de playlists.js. Importe savePlaylists + addTrackToPlaylist depuis playlist-crud.js.

import { esc }                            from './utils.js';
import { i18n }                           from './i18n.js';
import { get, set }                       from './store.js';
import { toast, confirmAction, promptAction } from './ui.js';
import { closeCtxMenu }                   from './ctxmenu.js';
import { saveCfg }                        from './cfgsave.js';
import { renderPlaylistsGrid }            from './renderer.js';
import { savePlaylists,
         addTrackToPlaylist }             from './playlist-crud.js';

// ── État local du module ──────────────────────────────────────────────────────
let _dragPlId         = null;   // playlist en cours de drag (sidebar réorganisation)
let _plNavDropInit    = false;  // setupPlNavDrop one-shot (flag module vs DOM node)

// Listeners ctx-menu dossier (fermeture mousedown extérieur + Escape)
let _plCtxClose    = null;
let _plCtxEscClose = null;

// Track drag state (mirrored here so setupPlNavDrop can read it without importing playlists.js)
let _dragTrackId   = null;

/** Setter appelé par onTrackDragStart (playlists.js) pour synchroniser l'état drag-piste. */
export function setNavDragTrackId(id) { _dragTrackId = id; }

// ── Private helpers ───────────────────────────────────────────────────────────

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

// ── S91 — Vague A : rendu sectionné (Pinned / Récentes / Dossiers / Autres) ──
function _plNavItemHTML(pl) {
  const count    = pl.trackIds ? pl.trackIds.length : 0;
  const isSmart  = !!pl.smart;
  const view     = get('view');
  const curPlId  = get('curPlId');
  const isActive = view === 'playlist' && curPlId === pl.id;
  const isPinned = !!pl.pinned;
  return `
  <button class="ni ni-pl${isActive?' on':''}${isSmart?' smart':''}${pl.coverB64?' has-cover':''}${isPinned?' pinned':''}"
    id="ni-pl-${pl.id}" data-action="set-view" data-view="playlist" data-pl-id="${pl.id}"
    draggable="true" data-pl-drag-id="${pl.id}"
    data-pl-ctx-id="${pl.id}">
    <span class="pl-icon">
      ${pl.coverB64
        ? `<img src="${esc(pl.coverB64)}" alt="" class="pl-cover-img">`
        : (isSmart
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`)
      }
    </span>
    <span class="pl-name" data-pl-rename-id="${pl.id}" title="${i18n('pl_rename_title')} (double-clic)">${esc(pl.name)}</span>
    ${isPinned ? `<svg class="pl-pin-badge" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M12 2l1.4 4.3h4.5l-3.6 2.6 1.4-4.3L12 10.6 8.3 13.2l1.4-4.3L6.1 6.3h4.5z"/></svg>` : ''}
    ${count > 0 ? `<span class="pl-count">${count}</span>` : ''}
    <span class="pl-play" title="${i18n('pl_play_all')}" data-action="play-pl-direct" data-pl-id="${pl.id}">
      <svg viewBox="0 0 24 24" width="11" height="11"><polygon points="6 3 20 12 6 21" fill="currentColor"/></svg>
    </span>
    <span class="pl-more" title="${i18n('pl_more')}" data-action="show-pl-ctx" data-pl-id="${pl.id}">
      <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
    </span>
  </button>`;
}

/**
 * S92 — Renommage inline dans la sidebar (double-clic sur .pl-name).
 * Exported for handlers.js event delegation — underscore kept for historical consistency.
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


export function renderPlNav() {
  const el = document.getElementById('pl-list-nav');
  if (!el) return;
  const playlists = get('playlists');
  const plFolders = get('plFolders');
  const recentPls = get('recentPls');

  if (!playlists.length && !plFolders.length) {
    el.innerHTML = `<div style="padding:6px 14px;font-size:11px;color:var(--t3);">${i18n('pl_empty')}</div>`;
    return;
  }

  const visible = playlists;

  // Index rapide id → playlist
  const byId = new Map(visible.map(p => [p.id, p]));

  // Section 1 : Épinglées (respecte l'ordre dans `playlists`)
  const pinned = visible.filter(p => p.pinned);

  // Section 2 : Récentes (plus de 2 items, hors épinglées)
  const recents = recentPls
    .map(id => byId.get(id))
    .filter(p => p && !p.pinned)
    .slice(0, 5);

  // Section 3 : Dossiers + playlists hors dossier
  // AUDIT-2026-05-22 : alimenter shownRecentIds avec les ids deja affiches en
  // section "Recentes" — sans ca la deduplication echoue et les playlists
  // recentes reapparaissent en double dans la section 3.
  const shownRecentIds = new Set(recents.map(p => p.id));
  const folderIds = new Set(plFolders.map(f => f.id));
  const ungroupedOrNoFolder = visible.filter(p =>
    !p.pinned &&
    !shownRecentIds.has(p.id) &&
    (!p.folderId || !folderIds.has(p.folderId))
  );

  // Ordre d'affichage des sections
  const parts = [];

  if (pinned.length) {
    parts.push(`<div class="pl-nav-section-h">${i18n('pl_section_pinned')}</div>`);
    parts.push(pinned.map(_plNavItemHTML).join(''));
  }

  // Section 2 : Récentes — bloc de rendu perdu lors d'un refactor alors que la
  // déduplication shownRecentIds (section 3) le suppose présent ; sans lui les
  // playlists récentes hors dossier disparaissent totalement de la sidebar.
  if (recents.length >= 1) {
    parts.push(`<div class="pl-nav-section-h">${i18n('pl_section_recent')}</div>`);
    parts.push(recents.map(_plNavItemHTML).join(''));
  }

  // Dossiers — regroupement O(N+F) au lieu de O(N×F)
  const byFolder = new Map();
  for (const p of visible) {
    if (p.folderId && !p.pinned) {
      if (!byFolder.has(p.folderId)) byFolder.set(p.folderId, []);
      byFolder.get(p.folderId).push(p);
    }
  }
  for (const folder of plFolders) {
    const inside = byFolder.get(folder.id) || [];
    const collapsed = !!folder.collapsed;
    parts.push(`
      <div class="pl-folder${collapsed?' collapsed':''}" data-folder-id="${folder.id}">
        <div class="pl-folder-h"
             data-action="toggle-pl-folder" data-folder-id="${folder.id}"
             data-pl-folder-ctx-id="${folder.id}"
             data-folder-drop-id="${folder.id}"
             title="${esc(folder.name)}">
          <svg class="pl-folder-chev" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <svg class="pl-folder-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          <span class="pl-folder-name">${esc(folder.name)}</span>
          <span class="pl-folder-count">${inside.length}</span>
        </div>
        <div class="pl-folder-body">
          ${inside.map(_plNavItemHTML).join('') || `<div class="pl-folder-empty">${i18n('pl_folder_empty')}</div>`}
        </div>
      </div>
    `);
  }

  if (ungroupedOrNoFolder.length) {
    parts.push(ungroupedOrNoFolder.map(_plNavItemHTML).join(''));
  }

  el.innerHTML = parts.join('');
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
  if (el) el.classList.toggle('collapsed', f.collapsed);
}

export function showPlFolderCtxMenu(event, folderId) {
  event.preventDefault();
  event.stopPropagation();
  closeCtxMenu();
  let menu = document.getElementById('pl-ctx-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'pl-ctx-menu';
    menu.className = 'ctx-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `
    <div class="ctx-item" data-action="rename-pl-folder" data-folder-id="${folderId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>
      ${i18n('pl_folder_rename')}
    </div>
    <div class="ctx-item ctx-item--danger" data-action="delete-pl-folder" data-folder-id="${folderId}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
      ${i18n('pl_folder_delete')}
    </div>`;
  // S157 FIX-5 : positionnement basé sur la hauteur réelle du menu (pas sur -100 fixe)
  // Affichage temporaire hors écran pour mesurer, puis clamp dans le viewport
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top  = '0px';
  menu.classList.add('on');
  const mw = menu.offsetWidth  || 180;
  const mh = menu.offsetHeight || 100;
  const pad = 8;
  const x = Math.max(pad, Math.min(event.clientX, window.innerWidth  - mw - pad));
  const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - mh - pad));
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.style.visibility = '';
  // FIX-B9 : fermeture mousedown extérieur + Escape (LEAK-1 FIX étendu)
  _attachPlCtxClose(menu);
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

// setupPlNavDrop : utilise la délégation d'événements sur le conteneur nav.
// Appelé une seule fois à l'init — idempotent grâce au flag _initialized.
export function setupPlNavDrop() {
  const nav = document.getElementById('pl-list-nav');
  if (!nav || _plNavDropInit) return;
  _plNavDropInit = true;

  nav.addEventListener('dragover', e => {
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
      nav.querySelectorAll('.ni-pl.pl-drop-above, .ni-pl.pl-drop-below, .ni-pl.drag-over')
         .forEach(b => b.classList.remove('pl-drop-above', 'pl-drop-below', 'drag-over'));
      // Ne pas afficher d'indicateur sur la playlist en cours de drag
      if (btn.id === 'ni-pl-' + _dragPlId) return;
      const rect = btn.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      btn.classList.add(e.clientY < mid ? 'pl-drop-above' : 'pl-drop-below');
      return;
    }
    // Sinon : drop d'une piste → ajout à la playlist (comportement existant)
    if (_dragTrackId) {
      e.dataTransfer.dropEffect = 'copy';
      nav.querySelectorAll('.ni-pl.drag-over').forEach(b => b.classList.remove('drag-over'));
      btn.classList.add('drag-over');
    }
  });
  nav.addEventListener('dragleave', e => {
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
  });
  nav.addEventListener('drop', async e => {
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
      const toId = btn.id.replace('ni-pl-', '');
      const rect = btn.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      const playlists = get('playlists');
      const fromIdx = playlists.findIndex(p => p.id === fromId);
      let   toIdx   = playlists.findIndex(p => p.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      if (!insertBefore) toIdx++;
      if (fromIdx < toIdx) toIdx--;
      if (fromIdx === toIdx) return;
      const [moved] = playlists.splice(fromIdx, 1);
      playlists.splice(toIdx, 0, moved);
      // BUG-M4 FIX : ne pas appeler set() ici — savePlaylists() appelle notify() qui force-notifie
      await savePlaylists();
      renderPlNav();
      return;
    }

    // Drop d'une piste sur une playlist (comportement existant)
    if (!btn || !_dragTrackId) return;
    const plId = btn.id.replace('ni-pl-', '');
    addTrackToPlaylist(_dragTrackId, plId);
    _dragTrackId = null;
  });
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
