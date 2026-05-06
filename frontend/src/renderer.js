// renderer.js — Rendu de la bibliothèque, grilles et helpers HTML
// Extrait de app.js (Session 144 — Jalon 5).
//
// Responsabilités :
//   - Virtual scroll : virtRenderWindow, virtAttachScroll
//   - Rendu liste/grilles : renderLib, renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid
//   - Helpers HTML : thtml, hlText, artPlaceholder, makeLikeBtn, makeAddBtn, makeEqHTML
//   - Mises à jour DOM partielles : patchActiveTrack, patchPlayState, patchTrackEl
//   - Navigation drill-down : drillDown
//   - Stats : updateStats, scheduleStatsUpdate
//   - Animations : _withVT, animateViewChange, scrollToCurrentTrack
//
// Fixes inclus :
//   P6   — Spring animation (el._springRaf, el._springVel, cancelAnimationFrame avant ré-attache)
//   A11Y-3 — thtml() → role="listitem" tabindex="0" aria-label
//   FIX-B1 — guard null _plHero avant masquage vhtitle
//   FIX-B2 — pl-action-bar ancrée après #pl-hero dans le DOM
//   FIX-B6 — pas de data-pl-id dupliqué sur les cartes grille playlist
//   FIX-UX4 — card-play-btn sur les cartes playlist
//   FIX-A1  — role=button + tabindex=0 + aria-label sur cartes grille

import { get, set }                                          from './store.js';
import { emit, EVENTS }                                      from './bus.js';
import { getFiltered, filteredIdx, trackIdx,
         _trackIdxMap, invalidateFilterCache }               from './search.js';
import { VIRT, virtBuildRows, virtIdxAtScroll,
         virtTotalH, virtOffsetOf }                          from './virt.js';
import { esc, fmtd, extEmoji, fmt }                         from './utils.js';
import { i18n }                                              from './i18n.js';
import { CFG }                                               from './cfg.js';

// Imports circulaires — OK en ES modules (appelés à l'exécution, pas à l'init)
import { playAt }                                            from './player.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _statsTimer = null;      // debounce updateStats
let _plHero     = null;      // référence au #pl-hero courant (FIX-B1)

// ── Helpers inline ────────────────────────────────────────────────────────────

/** Wraps matching parts of `text` with <mark> for search highlighting. */
export function hlText(text, query) {
  if (!text) return '';
  if (!query) return esc(text);
  const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return esc(text).replace(re, '<mark>$1</mark>');
}

/** Génère le HTML d'un placeholder d'artwork (lettre initiale). */
export function artPlaceholder(t) {
  const letter = t.name?.[0]?.toUpperCase() || '♪';
  const color  = t.artColor ? ` style="background:${t.artColor}"` : '';
  return `<div class="tart-ph" aria-hidden="true"${color}><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
}

/** Génère le bouton ♥ Like pour une piste. */
export function makeLikeBtn(t) {
  const liked = get('liked');
  const on    = liked?.has(t.id);
  return `<button class="tlk${on ? ' on' : ''}" data-action="likeat" data-track-id="${esc(t.id)}" aria-pressed="${!!on}" aria-label="${i18n('a11y_like') || 'Like'}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>`;
}

/** Génère le bouton + Ajouter à une playlist pour une piste. */
export function makeAddBtn(t) {
  const lbl = i18n('add_to_playlist') || 'Ajouter à une playlist';
  return `<button class="tr-add-btn" data-action="show-pl-qpop" data-track-id="${esc(t.id)}" title="${esc(lbl)}" aria-label="${esc(lbl)}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
}

/** Génère le badge qualité audio (LOSSLESS / bitrate) pour une piste. */
export function makeEqHTML(t) {
  if (!t) return '';
  const ext = (t.ext || '').toLowerCase();
  const lossless = ['flac', 'alac', 'aiff', 'aif', 'wav', 'ape'].includes(ext);
  if (lossless) {
    const bd  = t.bitDepth  ? `${t.bitDepth}bit` : '';
    const sr  = t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)}kHz` : '';
    const tip = [bd, sr].filter(Boolean).join(' · ');
    return `<span class="badge-lossless" title="${esc(tip)}">LOSSLESS</span>`;
  }
  if (t.bitrate) return `<span class="badge-tech">${t.bitrate}</span>`;
  return '';
}

// ── thtml — génère le HTML d'une ligne piste ─────────────────────────────────
// A11Y-3 : role="listitem" tabindex="0" aria-label
// P6     : classes dynamiques

/**
 * Génère le HTML d'une ligne piste pour le virtual scroll.
 * @param {Track}  t       - Piste
 * @param {number} fi      - Index dans la liste filtrée courante
 * @param {object} [opts]  - { active, liked, query }
 */
export function thtml(t, fi, { active = false, liked = false, query = '' } = {}) {
  // Artwork — img avec fade-in (.art-img → .art-loaded au onload) OU placeholder
  const artInner = t.art
    ? `<img class="art-img" src="${esc(t.art)}" alt="" aria-hidden="true" onload="this.classList.add('art-loaded')">`
    : artPlaceholder(t);

  const classes  = ['tr', active ? 'act' : ''].filter(Boolean).join(' ');
  const ariaLbl  = [t.name, t.artistFull || t.artist].filter(Boolean).join(' — ');

  return `<div class="${classes}" id="tr-${esc(t.id)}" data-track-id="${esc(t.id)}" data-fi="${fi}"
  data-action="track-click" role="listitem" tabindex="0" aria-label="${esc(ariaLbl)}"
  draggable="true" data-drag-action="track-drag">
  <div class="tart">
    ${artInner}
    <button class="tart-hover-play" data-action="play-track" data-track-id="${esc(t.id)}" tabindex="-1" aria-label="${i18n('play') || 'Lire'}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
    </button>
  </div>
  <div class="ti">
    <div class="tn">${hlText(t.name || '', query)}</div>
    <div class="ts">${hlText(t.artistFull || t.artist || '', query)}</div>
  </div>
  <div class="tr-r">
    ${makeEqHTML(t)}
    <span class="tdur">${fmtd(t.duration)}</span>
    ${makeLikeBtn(t)}
    ${makeAddBtn(t)}
  </div>
</div>`;
}

// ── Virtual scroll ────────────────────────────────────────────────────────────

/** Rend uniquement la fenêtre visible + buffer. */
export function virtRenderWindow(fl) {
  const listEl = document.getElementById('tlist');
  if (!listEl || !fl) return;

  const sort  = get('sort')  || 'az';
  const query = get('query') || '';
  const view  = get('view')  || 'all';

  // Construire les descripteurs de lignes si la signature a changé
  const sig = `${fl.length}|${sort}|${query}|${view}`;
  if (VIRT._lastListSig !== sig) {
    VIRT._rows        = virtBuildRows(fl, { sort, query, view });
    VIRT._lastListSig = sig;
  }

  const rows     = VIRT._rows;
  if (!rows.length) { listEl.innerHTML = ''; return; }

  const scrollTop = listEl.scrollTop;
  const viewH     = listEl.clientHeight || window.innerHeight;

  const firstVisible = virtIdxAtScroll(rows, scrollTop);
  const startIdx     = Math.max(0, firstVisible - VIRT.BUFFER);
  // Utiliser la plus petite hauteur de ligne (GRP_H) pour ne jamais sous-estimer le nombre de lignes visibles
  const visibleCount = Math.ceil(viewH / Math.min(VIRT.ROW_H, VIRT.GRP_H)) + 1;
  const endIdx       = Math.min(rows.length, firstVisible + visibleCount + VIRT.BUFFER);

  VIRT._startIdx = startIdx;
  VIRT._endIdx   = endIdx;

  const curIdx  = get('curIdx');
  const tracks  = get('tracks');
  const liked   = get('liked');
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;

  const topH    = virtOffsetOf(rows, startIdx);
  const totalH  = virtTotalH(rows);
  const botH    = Math.max(0, totalH - virtOffsetOf(rows, endIdx));

  let html = `<div class="virt-sp" style="height:${topH}px" aria-hidden="true"></div>`;

  for (let i = startIdx; i < endIdx; i++) {
    const row = rows[i];
    if (row.type === 'grp') {
      let hint = '';
      if (row.artistHint) hint = ` <span class="grp-artist">${esc(row.artistHint)}</span>`;
      html += `<div class="tr-grp" style="height:${VIRT.GRP_H}px" aria-hidden="true">${esc(row.key)}${hint}</div>`;
    } else {
      const t       = row.track;
      const isActive = curTrack?.id === t.id;
      const isLiked  = liked?.has(t.id) ?? false;
      html += thtml(t, row.fi, { active: isActive, liked: isLiked, query });
    }
  }

  html += `<div class="virt-sp" style="height:${botH}px" aria-hidden="true"></div>`;

  // P6 : annuler les spring animations en vol avant de remplacer le DOM
  listEl.querySelectorAll('[data-spring-raf]').forEach(el => {
    const id = parseInt(el.dataset.springRaf);
    if (id) cancelAnimationFrame(id);
  });

  listEl.innerHTML = html;
}

/** Attache le handler de scroll virtual au conteneur de la liste. */
export function virtAttachScroll(listEl) {
  if (!listEl) return;
  const onScroll = () => {
    if (VIRT._raf) cancelAnimationFrame(VIRT._raf);
    VIRT._raf = requestAnimationFrame(() => {
      const fl = getFiltered();
      virtRenderWindow(fl);
      // Mettre à jour le suivi de direction
      VIRT._lastScrollTop = listEl.scrollTop;
    });
  };
  // Réattacher proprement (évite les duplicata)
  listEl.removeEventListener('scroll', listEl._virtScrollHandler);
  listEl._virtScrollHandler = onScroll;
  listEl.addEventListener('scroll', onScroll, { passive: true });
}

// ── renderLib ─────────────────────────────────────────────────────────────────

/** Reconstruit la vue liste de la bibliothèque (virtual scroll).
 *  Appelé à chaque changement de tri, filtre ou vue. */
export function renderLib() {
  const fl = getFiltered();

  // Invalider le cache de virt pour forcer un rebuild
  VIRT._lastListSig = '';

  virtRenderWindow(fl);

  // (Re)attacher le scroll
  const listEl = document.getElementById('tlist');
  virtAttachScroll(listEl);

  scheduleStatsUpdate();
}

// ── Skeleton loading ──────────────────────────────────────────────────────────

/** Affiche des lignes squelette pendant le chargement des données. */
export function _showSkeletonRows(savedView) {
  const listEl = document.getElementById('tlist');
  if (!listEl) return;
  const count = Math.max(8, Math.ceil((listEl.clientHeight || window.innerHeight) / CFG.VIRT_ROW_H));
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="tr tr-skel" aria-hidden="true">'
          + '<div class="tart loading"></div>'
          + '<div class="ti"><div class="skel-line skel-title"></div><div class="skel-line skel-sub"></div></div>'
          + '<div class="tr-r"><div class="skel-line skel-dur"></div></div>'
          + '</div>';
  }
  listEl.innerHTML = html;
}

// ── renderAlbumsGrid ──────────────────────────────────────────────────────────

/** Rendu de la grille Albums. */
export function renderAlbumsGrid() {
  const tracks    = get('tracks') || [];
  const albumSort = get('albumSort') || 'name';
  const query     = get('query') || '';

  // Rendre le conteneur visible
  let grid = document.getElementById('album-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'album-grid';
    grid.className = 'grid-view';
    const ca = document.getElementById('content-area');
    if (ca) ca.appendChild(grid);
  }
  grid.style.display = '';

  // Masquer les autres grilles
  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';

  // Construire la map albums
  const albumMap = new Map();
  for (const t of tracks) {
    const key = t.album || '';
    if (query && !key.toLowerCase().includes(query.toLowerCase()) &&
        !(t.artist || '').toLowerCase().includes(query.toLowerCase())) continue;
    if (!albumMap.has(key)) {
      albumMap.set(key, { name: key, artist: t.artist || '', arts: [], count: 0, totalDur: 0, year: t.year || null });
    }
    const a = albumMap.get(key);
    a.count++;
    a.totalDur += t.duration || 0;
    if (t.art && a.arts.length < 1) a.arts.push(t.art);
    if (t.year && !a.year) a.year = t.year;
  }

  let albums = [...albumMap.values()];

  // Tri
  if (albumSort === 'count')    albums.sort((a, b) => b.count - a.count);
  else if (albumSort === 'duration') albums.sort((a, b) => b.totalDur - a.totalDur);
  else if (albumSort === 'year') albums.sort((a, b) => (b.year || 0) - (a.year || 0));
  else albums.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));

  if (!albums.length) {
    grid.innerHTML = `<div class="grid-empty">${esc(i18n('no_results') || 'Aucun résultat')}</div>`;
    return;
  }

  grid.innerHTML = albums.map(a => {
    const artHtml = a.arts[0]
      ? `<img src="${esc(a.arts[0])}" alt="" aria-hidden="true">`
      : `<div class="card-art-ph" aria-hidden="true">💿</div>`;
    const meta = a.year ? `<span class="card-year">${a.year}</span>` : '';
    return `<div class="card" role="button" tabindex="0"
      data-action="drill-album" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="albums" data-display="${esc(a.name)}"
      aria-label="${esc(a.name)}${a.artist ? ' — ' + a.artist : ''}">
      <div class="card-art">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true">▶</button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || i18n('unknown_album') || '?', query)}</span>
        <span class="card-sub">${hlText(a.artist, query)}${meta}</span>
        <span class="card-ct">${a.count} ${i18n('n_tracks') || 'titres'}</span>
      </div>
    </div>`;
  }).join('');

  updateBreadcrumb();
}

// ── renderArtistsGrid ─────────────────────────────────────────────────────────

/** Rendu de la grille Artistes. */
export function renderArtistsGrid() {
  const tracks     = get('tracks') || [];
  const artistSort = get('artistSort') || 'name';
  const query      = get('query') || '';

  let grid = document.getElementById('artist-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'artist-grid';
    grid.className = 'grid-view';
    const ca = document.getElementById('content-area');
    if (ca) ca.appendChild(grid);
  }
  grid.style.display = '';

  const ag = document.getElementById('album-grid');
  const pg = document.getElementById('playlist-grid');
  if (ag) ag.style.display = 'none';
  if (pg) pg.style.display = 'none';

  const artistMap = new Map();
  for (const t of tracks) {
    const key = t.artist || '';
    if (query && !key.toLowerCase().includes(query.toLowerCase()) &&
        !(t.name || '').toLowerCase().includes(query.toLowerCase())) continue;
    if (!artistMap.has(key)) {
      artistMap.set(key, { name: key, arts: [], count: 0, albumCount: new Set() });
    }
    const a = artistMap.get(key);
    a.count++;
    a.albumCount.add(t.album);
    if (t.art && a.arts.length < 1) a.arts.push(t.art);
  }

  let artists = [...artistMap.values()];
  if (artistSort === 'count') artists.sort((a, b) => b.count - a.count);
  else artists.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));

  if (!artists.length) {
    grid.innerHTML = `<div class="grid-empty">${esc(i18n('no_results') || 'Aucun résultat')}</div>`;
    return;
  }

  grid.innerHTML = artists.map(a => {
    const artHtml = a.arts[0]
      ? `<img src="${esc(a.arts[0])}" alt="" aria-hidden="true">`
      : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`;
    const nbAlbums = a.albumCount.size;
    return `<div class="card card-artist" role="button" tabindex="0"
      data-action="drill-artist" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="artists" data-display="${esc(a.name)}"
      aria-label="${esc(a.name)}">
      <div class="card-art card-art-round">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true">▶</button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || '?', query)}</span>
        <span class="card-sub">${a.count} ${i18n('n_tracks') || 'titres'}${nbAlbums > 1 ? ` · ${nbAlbums} albums` : ''}</span>
      </div>
    </div>`;
  }).join('');

  updateBreadcrumb();
}

// ── renderPlaylistsGrid ───────────────────────────────────────────────────────

/** Rendu de la grille Playlists (vue "playlists"). */
export function renderPlaylistsGrid() {
  const playlists = get('playlists') || [];
  const tracks    = get('tracks')    || [];
  const query     = get('query')     || '';

  let grid = document.getElementById('playlist-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'playlist-grid';
    grid.className = 'grid-view';
    const ca = document.getElementById('content-area');
    if (ca) ca.appendChild(grid);
  }
  grid.style.display = '';

  const ag = document.getElementById('album-grid');
  const rg = document.getElementById('artist-grid');
  if (ag) ag.style.display = 'none';
  if (rg) rg.style.display = 'none';

  const filtered = query
    ? playlists.filter(p => (p.name || '').toLowerCase().includes(query.toLowerCase()))
    : playlists;

  if (!filtered.length) {
    grid.innerHTML = `<div class="pl-grid-empty">${esc(i18n('no_results') || 'Aucune playlist')}</div>`;
    return;
  }

  const byId = new Map(tracks.map(t => [t.id, t]));

  // FIX-B6 : data-pl-id n'est placé QU'UNE FOIS (sur le div.card root, pas sur le bouton interne)
  grid.innerHTML = filtered.map(pl => {
    // Mosaïque 4 arts
    const plTracks = (pl.trackIds || []).slice(0, 4).map(id => byId.get(id)).filter(Boolean);
    const arts = plTracks.map(t => t.art).filter(Boolean).slice(0, 4);
    let artHtml;
    if (pl.coverB64) {
      artHtml = `<img src="${esc(pl.coverB64)}" alt="" aria-hidden="true">`;
    } else if (arts.length >= 4) {
      artHtml = `<div class="card-mosaic" aria-hidden="true">${arts.map(a => `<img src="${esc(a)}" alt="">`).join('')}</div>`;
    } else if (arts.length > 0) {
      artHtml = `<img src="${esc(arts[0])}" alt="" aria-hidden="true">`;
    } else {
      artHtml = `<div class="card-art-ph" aria-hidden="true">🎵</div>`;
    }

    const smartBadge = pl.smart ? `<span class="smart-badge" title="${i18n('smart_playlist') || 'Smart'}">✦</span>` : '';
    const pinBadge   = pl.pinned ? `<span class="pin-badge" aria-hidden="true">📌</span>` : '';
    const count = (pl.trackIds || []).length;

    // FIX-A1 : role=button + tabindex=0 + aria-label
    return `<div class="card" role="button" tabindex="0"
      data-action="set-view" data-view="playlist" data-pl-id="${esc(pl.id)}"
      aria-label="${esc(pl.name || i18n('pl_untitled') || 'Playlist')}">
      <div class="card-art">
        ${artHtml}
        ${smartBadge}${pinBadge}
        <button class="card-play-btn" data-action="play-pl-direct" data-pl-id="${esc(pl.id)}" tabindex="-1" aria-hidden="true">▶</button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(pl.name || '?', query)}</span>
        <span class="card-sub">${count} ${i18n('n_tracks') || 'titres'}</span>
      </div>
    </div>`;
  }).join('');

  updateBreadcrumb();
}

// ── drillDown ─────────────────────────────────────────────────────────────────

/** Navigue vers la vue détail d'un album ou artiste.
 *  @param {string} key         - Clé de filtre (nom album/artiste exact)
 *  @param {string} from        - 'albums' | 'artists'
 *  @param {string} displayName - Nom d'affichage (propre, avec casse d'origine) */
export function drillDown(from, key, displayName) {
  set('drillKey',         key);
  set('drillFrom',        from);
  set('drillDisplayName', displayName || key);
  const viewName = from === 'albums' ? 'album-detail'
                 : from === 'genres' ? 'genre-detail'
                 : 'artist-detail';
  set('view', viewName);
  invalidateFilterCache();
  emit(EVENTS.FILTER_CHANGED, {});

  // Masquer les grilles, basculer en vue liste
  const ag = document.getElementById('album-grid');
  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  if (ag) ag.style.display = 'none';
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';

  // Définir data-view='list' sur content-area
  const ca = document.getElementById('content-area');
  if (ca) ca.dataset.view = 'list';

  // Titre de la vue
  const vhtitle = document.getElementById('vhtitle');
  if (vhtitle) vhtitle.textContent = displayName || key;

  // Breadcrumb
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.style.display = '';
  updateBreadcrumb();

  emit(EVENTS.RENDER_LIB, {});
}

// ── updatePlActionBar ─────────────────────────────────────────────────────────

/** Génère ou met à jour la barre d'action pour la playlist courante.
 *  FIX-B2 : ancrée après #pl-hero dans le DOM. */
export function updatePlActionBar() {
  const curPlId   = get('curPlId');
  const playlists = get('playlists') || [];
  const tracks    = get('tracks')    || [];

  const pl = curPlId ? playlists.find(p => p.id === curPlId) : null;
  if (!pl) {
    const existing = document.getElementById('pl-action-bar');
    if (existing) existing.remove();
    return;
  }

  const count   = (pl.trackIds || []).length;
  const plTracks = pl.trackIds.map(id => {
    const idx = _trackIdxMap.get(id);
    return idx !== undefined ? tracks[idx] : null;
  }).filter(Boolean);
  const totalDur = plTracks.reduce((s, t) => s + (t.duration || 0), 0);

  const plSort = get('plSort') || 'manual';
  const sorts = [
    { v: 'manual',   l: i18n('pl_sort_manual')   || 'Manuel' },
    { v: 'az',       l: i18n('sort_az')           || 'A–Z' },
    { v: 'za',       l: i18n('sort_za')           || 'Z–A' },
    { v: 'artist',   l: i18n('sort_artist')       || 'Artiste' },
    { v: 'album',    l: i18n('sort_album')         || 'Album' },
    { v: 'duration', l: i18n('pl_sort_duration')  || 'Durée' },
  ];
  const sortOptions = sorts.map(s =>
    `<option value="${s.v}"${plSort === s.v ? ' selected' : ''}>${esc(s.l)}</option>`
  ).join('');

  const html = `<div id="pl-action-bar" class="pl-action-bar">
    <span class="pl-bar-count">${count} ${i18n('n_tracks') || 'titres'}${totalDur > 0 ? ' · ' + fmtd(totalDur) : ''}</span>
    <span class="pl-bar-spacer"></span>
    <button class="pl-act-btn" data-action="play-pl-from" data-idx="0">▶ ${i18n('pl_play_all') || 'Tout lire'}</button>
    <button class="pl-act-btn" data-action="shuffle-cur-pl">⇀ ${i18n('pl_shuffle') || 'Aléatoire'}</button>
    <select class="pl-sort-sel" data-input-action="pl-sort" aria-label="${i18n('sort') || 'Tri'}">${sortOptions}</select>
    <button class="pl-act-btn icon-btn" data-action="show-cur-pl-menu" aria-label="${i18n('pl_more') || 'Plus'}">•••</button>
  </div>`;

  // FIX-B2 : insérer après #pl-hero, pas dans un slot pré-existant
  const hero = document.getElementById('pl-hero');
  const existing = document.getElementById('pl-action-bar');
  if (existing) existing.remove();
  if (hero) {
    _plHero = hero; // FIX-B1 : mémoriser la référence
    hero.insertAdjacentHTML('afterend', html);
  } else {
    // Fallback : insérer dans content-area
    const ca = document.getElementById('content-area');
    if (ca) ca.insertAdjacentHTML('afterbegin', html);
  }
}

// ── updateBreadcrumb ──────────────────────────────────────────────────────────

/** Met à jour le fil d'Ariane selon l'état de drill-down courant. */
export function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;

  const view         = get('view')         || 'all';
  const drillKey     = get('drillKey')     || '';
  const drillFrom    = get('drillFrom')    || '';
  const drillDisplay = get('drillDisplayName') || drillKey;
  const curPlId      = get('curPlId');
  const playlists    = get('playlists') || [];

  // Afficher uniquement en drill-down
  const isDrill = drillKey || (view === 'playlist' && curPlId) ||
    ['album-detail', 'artist-detail', 'genre-detail'].includes(view);

  if (!isDrill) {
    bc.style.display = 'none';
    bc.innerHTML = '';
    return;
  }

  bc.style.display = '';

  const fromLabels = {
    albums:  i18n('lib_albums')  || 'Albums',
    artists: i18n('lib_artists') || 'Artistes',
    genres:  'Genres',
    playlists: i18n('nav_playlists') || 'Playlists',
  };

  let items = [];
  if (drillFrom) {
    items.push({ label: fromLabels[drillFrom] || drillFrom, action: `setView('${drillFrom}')` });
    items.push({ label: drillDisplay, current: true });
  } else if (view === 'playlist' && curPlId) {
    const pl = playlists.find(p => p.id === curPlId);
    items.push({ label: fromLabels.playlists, action: "setView('playlists')" });
    items.push({ label: pl?.name || '?', current: true });
  }

  bc.innerHTML = items.map((item, i) => {
    if (item.current) {
      return `<span class="bc-cur" aria-current="page">${esc(item.label)}</span>`;
    }
    return `<button class="bc-link" data-action="bc-navigate" data-bc-idx="${i}">${esc(item.label)}</button>
            <span class="bc-sep" aria-hidden="true">›</span>`;
  }).join('');
}

// ── Mises à jour DOM partielles ───────────────────────────────────────────────

/** Joue une piste par son ID. */
export function playById(id) {
  if (!id) return;
  const tidx = trackIdx(id);
  if (tidx < 0) return;
  const tracks = get('tracks') || [];
  const t = tracks[tidx];
  if (!t) return;
  const fi = filteredIdx(t);
  if (fi >= 0) playAt(fi);
}

/** Met à jour la classe .act sur la piste courante dans le DOM (sans re-rendu complet). */
export function patchActiveTrack() {
  const curIdx   = get('curIdx');
  const tracks   = get('tracks') || [];
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;

  // Retirer .act / .playing-row de tous les éléments
  document.querySelectorAll('.tr.act').forEach(el => {
    el.classList.remove('act', 'playing-row');
  });

  if (curTrack) {
    const el = document.querySelector(`.tr[data-track-id="${CSS.escape(curTrack.id)}"]`);
    if (el) el.classList.add('act');
  }
}

/** Met à jour la classe .playing-row sur la piste active (play vs pause). */
export function patchPlayState(playing) {
  document.querySelectorAll('.tr.act').forEach(el => {
    el.classList.toggle('playing-row', playing);
  });
}

/** Remplace le DOM d'une seule ligne piste (ex: après un tag edit). */
export function patchTrackEl(id) {
  const el = document.querySelector(`.tr[data-track-id="${CSS.escape(id)}"]`);
  if (!el) return; // hors viewport — ignoré (prochain virtRenderWindow le prendra)

  const idx = trackIdx(id);
  if (idx < 0) return;

  const tracks = get('tracks');
  const t      = tracks[idx];
  if (!t) return;

  const fi    = parseInt(el.dataset.fi || '0', 10);
  const liked = get('liked');
  const query = get('query') || '';
  const curIdx = get('curIdx');
  const isActive = curIdx === idx;

  el.insertAdjacentHTML('beforebegin',
    thtml(t, fi, { active: isActive, liked: liked?.has(t.id) ?? false, query }));
  el.remove();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/** Met à jour les compteurs de la bibliothèque (#lib-stats). */
export function updateStats() {
  const tracks   = get('tracks') || [];
  const el       = document.getElementById('lib-stats');
  if (!el) return;

  const fl       = getFiltered();
  const total    = fl.length;
  const totalDur = fl.reduce((s, t) => s + (t.duration || 0), 0);

  const countStr = `${total} ${i18n('n_tracks') || 'titre' + (total !== 1 ? 's' : '')}`;
  const durStr   = totalDur > 0 ? ' · ' + fmtd(totalDur) : '';
  el.textContent = countStr + durStr;
}

/** Planifie une mise à jour des stats après le délai de debounce. */
export function scheduleStatsUpdate() {
  if (_statsTimer) clearTimeout(_statsTimer);
  _statsTimer = setTimeout(updateStats, CFG.STATS_UPDATE_DELAY);
}

// ── View Transition ───────────────────────────────────────────────────────────

/** Exécute `fn` dans une View Transition si disponible, sinon directement. */
export function _withVT(fn) {
  if (typeof document.startViewTransition === 'function') {
    // startViewTransition() retourne un ViewTransition dont ready et finished
    // rejettent avec AbortError quand une nouvelle transition démarre avant la fin.
    // Sans catch, ces rejections propagent comme unhandledrejection → logs parasites
    // et, dans certains WebViews, spamme la console et perturbe les événements suivants.
    const vt = document.startViewTransition(fn);
    const ignoreAbort = e => { if (e?.name !== 'AbortError') throw e; };
    vt.ready.catch(ignoreAbort);
    vt.finished.catch(ignoreAbort);
  } else {
    fn();
  }
}

/** Déclenche une animation de changement de vue sur #content-area. */
export function animateViewChange() {
  const ca = document.getElementById('content-area');
  if (!ca) return;
  ca.classList.remove('view-in');
  // Forcer le reflow avant d'ajouter la classe d'animation
  void ca.offsetWidth;
  ca.classList.add('view-in');
  ca.addEventListener('animationend', () => ca.classList.remove('view-in'), { once: true });
}

// ── Scroll to current track ───────────────────────────────────────────────────

/** Fait défiler la liste pour centrer la piste en cours de lecture. */
export function scrollToCurrentTrack() {
  const curIdx = get('curIdx');
  if (curIdx < 0) return;

  const tracks = get('tracks');
  const t = tracks[curIdx];
  if (!t) return;

  const fl = getFiltered();
  const fi = filteredIdx(t);
  if (fi < 0) return;

  const rows = VIRT._rows;
  if (!rows || !rows.length) return;

  // Trouver l'index de ligne pour cette position filtrée
  let rowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'tr' && rows[i].fi === fi) { rowIdx = i; break; }
  }
  if (rowIdx < 0) return;

  const listEl = document.getElementById('tlist');
  if (!listEl) return;

  const offset  = virtOffsetOf(rows, rowIdx);
  const rowH    = VIRT.ROW_H;
  const viewH   = listEl.clientHeight;
  const scrollT = listEl.scrollTop;

  // Si déjà visible, ne pas scroller
  if (offset >= scrollT && offset + rowH <= scrollT + viewH) return;

  const targetTop = Math.max(0, offset - (viewH / 2) + (rowH / 2));
  // Smooth si saut < 3 viewports, sinon instantané (évite 3s d'animation pour un skip de 500 titres)
  listEl.scrollTo({
    top:      targetTop,
    behavior: Math.abs(scrollT - targetTop) < window.innerHeight * 3 ? 'smooth' : 'instant',
  });
}
