// renderer-grids.js — Grilles Albums / Artistes / Playlists + drill header
//
// Extrait de renderer.js (Session split — taille >800 lignes §16).
// Responsabilités :
//   - Caches memo album/artiste (_getAlbumMap, _getArtistMap)
//   - Hydratation paresseuse des artworks (IntersectionObserver)
//   - Drill header (album-detail / artist-detail)
//   - Grilles : renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid
//   - updateBreadcrumb
//
// Aucun import depuis renderer.js — évite la dépendance circulaire.

import { get }                     from './store.js';
import { i18n }                    from './i18n.js';
import { esc }                     from './utils.js';
import { getArtUrl }               from './artLoader.js';
import { _trackIdxMap, _coll }     from './search.js';

// ── État interne ──────────────────────────────────────────────────────────────

let _albumMapCache  = null;
let _artistMapCache = null;

// trackId → piste représentative (carte grille / drill header)
const _artTrackById = new Map();

// gridEl → IntersectionObserver — un par grille pour éviter les déconnexions croisées
const _gridArtObservers = new Map();

// ── Helpers privés ────────────────────────────────────────────────────────────

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps matching parts of `text` with <mark> for search highlighting. */
function hlText(text, query, re) {
  if (!text) return '';
  if (!query) return esc(text);
  const r = re || new RegExp(
    `(${query.trim().split(/\s+/).filter(Boolean).map(_escapeRegex).join('|')})`,
    'gi'
  );
  return text.replace(r, '\x00$1\x01').split('\x00').map((seg, i) => {
    if (i === 0) return esc(seg);
    const parts = seg.split('\x01');
    return `<mark>${esc(parts[0])}</mark>${esc(parts[1] || '')}`;
  }).join('');
}

/**
 * Hydrate les placeholders [data-art-tid] d'un conteneur.
 * observe:true → IntersectionObserver (artwork chargé seulement au survol du viewport).
 */
function _hydrateArtPlaceholders(rootEl, { observe = false } = {}) {
  if (!rootEl) return;
  const hydrate = (ph) => {
    const t = _artTrackById.get(ph.getAttribute('data-art-tid'));
    if (!t) return;
    getArtUrl(t).then(url => {
      if (!url || !ph.isConnected) return;
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      if (ph.dataset.artImgClass) img.className = ph.dataset.artImgClass;
      img.src = url;
      ph.replaceWith(img);
    }).catch(e => console.warn('[getArtUrl]', t?.id, e));
  };
  const phs = rootEl.querySelectorAll('[data-art-tid]');
  if (observe && 'IntersectionObserver' in window) {
    const prev = _gridArtObservers.get(rootEl);
    if (prev) prev.disconnect();
    const obs = new IntersectionObserver((entries, observer) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        hydrate(e.target);
      }
    }, { rootMargin: '300px' });
    _gridArtObservers.set(rootEl, obs);
    for (const ph of phs) obs.observe(ph);
  } else {
    for (const ph of phs) hydrate(ph);
  }
}

// ── Caches memo ───────────────────────────────────────────────────────────────

/** Construit la liste des entrées album depuis tracks[].
 *  Chaque entrée porte _artistSet pour la détection multi-artistes. */
function _getAlbumMap() {
  if (_albumMapCache) return _albumMapCache;
  const tracks = get('tracks') || [];
  const map = new Map();
  for (const t of tracks) {
    const key = t.album || '';
    if (!map.has(key)) {
      map.set(key, {
        key,
        displayName:   key,
        artist:        t.artist || '',
        art:           null,
        artTrack:      null,
        count:         0,
        totalDuration: 0,
        year:          (t.year && t.year !== 1970) ? t.year : null,
        _artistSet:    new Set(),
      });
    }
    const a = map.get(key);
    a.count++;
    a.totalDuration += t.duration || 0;
    if (t.art && !a.art) a.art = t.art;
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
    if (t.year && t.year !== 1970 && !a.year) a.year = t.year;
    if (t.artist) a._artistSet.add(t.artist);
  }
  _albumMapCache = [...map.values()];
  return _albumMapCache;
}

/** Construit la liste des entrées artiste depuis tracks[]. */
function _getArtistMap() {
  if (_artistMapCache) return _artistMapCache;
  const tracks = get('tracks') || [];
  const map = new Map();
  for (const t of tracks) {
    const key = t.artist || '';
    if (!map.has(key)) {
      map.set(key, { key, displayName: key, art: null, artTrack: null, count: 0 });
    }
    const a = map.get(key);
    a.count++;
    if (t.art && !a.art) a.art = t.art;
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
  }
  _artistMapCache = [...map.values()];
  return _artistMapCache;
}

// ── API publique — caches ─────────────────────────────────────────────────────

/** Invalide les caches album/artiste et la Map artwork. Appelé depuis renderer.js. */
export function resetGridCaches() {
  _albumMapCache  = null;
  _artistMapCache = null;
  _artTrackById.clear();
}

/** Accès public à la liste des albums (memoïsée). */
export function getAlbumMap() { return _getAlbumMap(); }

/** Accès public à la liste des artistes (memoïsée). */
export function getArtistMap() { return _getArtistMap(); }

// ── Drill header ──────────────────────────────────────────────────────────────

function _getOrCreateDrillHeader() {
  let el = document.getElementById('drill-header');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drill-header';
    const tlist = document.getElementById('tlist');
    tlist?.parentNode?.insertBefore(el, tlist);
  }
  return el;
}

function _removeDrillHeader() {
  document.getElementById('drill-header')?.remove();
}

/** Construit ou met à jour le drill header (album-detail / artist-detail). */
export function renderDrillHeader(view, key) {
  if (view === 'album-detail') {
    const albums = _getAlbumMap();
    const entry  = albums.find(a => a.key === key);
    if (!entry) { _removeDrillHeader(); return; }

    const el   = _getOrCreateDrillHeader();
    const artH = entry.art
      ? `<img src="${esc(entry.art)}" class="dh-art" alt="">`
      : entry.artTrack
        ? `<div class="dh-art dh-art-ph" data-art-tid="${esc(entry.artTrack.id)}" data-art-img-class="dh-art"></div>`
        : `<div class="dh-art dh-art-ph"></div>`;
    const mins      = Math.floor((entry.totalDuration || 0) / 60);
    const artistKey = entry.artist || '';
    const playLbl   = esc(i18n('pl_play_all'));
    const shufLbl   = esc(i18n('pl_shuffle'));

    el.className = 'drill-header';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          ${entry.artist
            ? `<button class="dh-artist-link" data-action="dh-drill-artist"
                 data-artist-key="${esc(artistKey)}"
                 data-artist-name="${esc(entry.artist)}">${esc(entry.artist)}</button>`
            : ''}
          ${entry.year ? `<span>${esc(String(entry.year))}</span>` : ''}
          <span>${i18n('track_count', entry.count)}</span>
          ${mins > 0 ? `<span>${i18n('dur_min', mins)}</span>` : ''}
        </div>
        <div class="dh-actions">
          <button class="dh-btn dh-play" data-action="dh-play-all" aria-label="${playLbl}"><span aria-hidden="true">▶</span> ${playLbl}</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all" aria-label="${shufLbl}"><span aria-hidden="true">⤮</span> ${shufLbl}</button>
        </div>
      </div>`;
    _hydrateArtPlaceholders(el);
    return;
  }

  if (view === 'artist-detail') {
    const artists = _getArtistMap();
    const entry   = artists.find(a => a.key === key);
    if (!entry) { _removeDrillHeader(); return; }

    const keyLc = key.toLowerCase();
    const albums = _getAlbumMap()
      .filter(a => (a.artist || '').toLowerCase() === keyLc)
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 20);

    const el   = _getOrCreateDrillHeader();
    const artH = entry.art
      ? `<img src="${esc(entry.art)}" class="dh-art dh-art-circle" alt="">`
      : entry.artTrack
        ? `<div class="dh-art dh-art-ph dh-art-circle" data-art-tid="${esc(entry.artTrack.id)}" data-art-img-class="dh-art dh-art-circle"></div>`
        : `<div class="dh-art dh-art-ph dh-art-circle"></div>`;

    const albumCards = albums.map(a => {
      const cardArt = a.art
        ? `<img src="${esc(a.art)}" class="dh-mini-art" alt="">`
        : a.artTrack
          ? `<div class="dh-mini-art dh-mini-art-ph" data-art-tid="${esc(a.artTrack.id)}" data-art-img-class="dh-mini-art"></div>`
          : `<div class="dh-mini-art dh-mini-art-ph"></div>`;
      return `<button class="dh-mini-card" data-action="dh-drill-album"
                data-album-key="${esc(a.key)}" data-album-name="${esc(a.displayName)}">
        ${cardArt}
        <div class="dh-mini-name">${esc(a.displayName)}</div>
        ${a.year ? `<div class="dh-mini-year">${esc(String(a.year))}</div>` : ''}
      </button>`;
    }).join('');

    const playLbl = esc(i18n('pl_play_all'));
    const shufLbl = esc(i18n('pl_shuffle'));

    el.className = 'drill-header drill-header--artist';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          <span>${i18n('n_albums', albums.length)}</span>
          <span>${i18n('track_count', entry.count)}</span>
        </div>
        <div class="dh-actions">
          <button class="dh-btn dh-play" data-action="dh-play-all" aria-label="${playLbl}"><span aria-hidden="true">▶</span> ${playLbl}</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all" aria-label="${shufLbl}"><span aria-hidden="true">⤮</span> ${shufLbl}</button>
        </div>
      </div>
      ${albums.length > 0 ? `
        <div class="dh-albums-section">
          <div class="dh-albums-title">Albums</div>
          <div class="dh-albums-mini">${albumCards}</div>
        </div>` : ''}`;
    _hydrateArtPlaceholders(el);
    return;
  }

  _removeDrillHeader();
}

// ── renderAlbumsGrid ──────────────────────────────────────────────────────────

/** Rendu de la grille Albums.
 *
 * AC2 : fallback nom via i18n('sans_album') — plus de clé fantôme 'unknown_album'.
 * AC3 : artiste dans aria-label via esc(' — ' + a.artist) (§13).
 * AC4 : détection isMulti → sub jamais vide (multi_artists / unknown_artist).
 * AC6 : libellés boutons et pluriels via i18n — plus de hardcode FR.
 */
export function renderAlbumsGrid() {
  const tracks    = get('tracks') || [];
  const albumSort = get('albumSort') || 'name';
  const query     = get('query') || '';

  let grid = document.getElementById('album-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'album-grid';
    grid.className = 'grid-view';
    const ca = document.getElementById('content-area');
    if (ca) ca.appendChild(grid);
  }
  grid.style.display = '';

  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';

  const queryLc = query ? query.toLowerCase() : '';
  let albums = _getAlbumMap();
  if (queryLc) {
    albums = albums.filter(a =>
      (a.key || '').toLowerCase().includes(queryLc) ||
      (a.artist || '').toLowerCase().includes(queryLc)
    );
  }
  albums = albums.map(a => ({
    name:       a.key,
    artist:     a.artist,
    artUrl:     a.art,
    artTrack:   a.artTrack,
    count:      a.count,
    totalDur:   a.totalDuration,
    year:       a.year,
    _artistSet: a._artistSet,
  }));

  if (albumSort === 'count')    albums.sort((a, b) => b.count - a.count);
  else if (albumSort === 'duration') albums.sort((a, b) => b.totalDur - a.totalDur);
  else if (albumSort === 'year') albums.sort((a, b) => (b.year || 0) - (a.year || 0));
  else albums.sort((a, b) => _coll.compare(a.name || '', b.name || ''));

  if (!albums.length) {
    const isLibEmpty = !tracks.length && !query;
    const ico = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>`;
    grid.innerHTML = isLibEmpty
      ? `<div class="grid-empty"><div class="empty-ico">${ico}</div><div class="empty-h">${esc(i18n('empty_lib_h'))}</div><div class="empty-s">${esc(i18n('empty_lib_s'))}</div></div>`
      : `<div class="grid-empty"><div class="empty-ico">${ico}</div><div class="empty-h">${esc(i18n('empty_search_h'))}</div><div class="empty-s">${esc(i18n('empty_search_s'))}</div></div>`;
    return;
  }

  grid.innerHTML = albums.map(a => {
    // AC4 : isMulti → sous-titre jamais vide
    const isMulti   = a._artistSet && a._artistSet.size > 1;
    const artistSub = isMulti ? i18n('multi_artists') : (a.artist || i18n('unknown_artist'));
    const meta = a.year ? `<span class="card-year">${esc(String(a.year))}</span>` : '';
    const artHtml = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">💿</div>`
        : `<div class="card-art-ph" aria-hidden="true">💿</div>`;
    // AC3 : esc(' — ' + a.artist) pour éviter tout split sur les entités HTML (§13)
    return `<div class="card" role="button" tabindex="0"
      data-action="drill-album" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="albums" data-display="${esc(a.name)}"
      aria-label="${esc(a.name || i18n('sans_album'))}${a.artist ? esc(' — ' + a.artist) : ''}">
      <div class="card-art">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || i18n('sans_album'), query)}</span>
        <span class="card-sub">${esc(artistSub)}${meta}</span>
        <span class="card-ct">${a.count} ${i18n('n_tracks')}</span>
      </div>
    </div>`;
  }).join('');

  _hydrateArtPlaceholders(grid, { observe: true });
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

  const queryLc = query ? query.toLowerCase() : '';
  const artistMap = new Map();
  for (const t of tracks) {
    const key = t.artist || '';
    if (queryLc && !key.toLowerCase().includes(queryLc) &&
        !(t.name || '').toLowerCase().includes(queryLc)) continue;
    if (!artistMap.has(key)) {
      artistMap.set(key, { name: key, artUrl: null, artTrack: null, count: 0, albumCount: new Set() });
    }
    const a = artistMap.get(key);
    a.count++;
    a.albumCount.add(t.album);
    if (!a.artUrl && t.art) a.artUrl = t.art;
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
  }

  let artists = [...artistMap.values()];
  if (artistSort === 'count') artists.sort((a, b) => b.count - a.count);
  else artists.sort((a, b) => _coll.compare(a.name || '', b.name || ''));

  if (!artists.length) {
    const isLibEmpty = !tracks.length && !query;
    const ico = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    grid.innerHTML = isLibEmpty
      ? `<div class="grid-empty"><div class="empty-ico">${ico}</div><div class="empty-h">${esc(i18n('empty_lib_h'))}</div><div class="empty-s">${esc(i18n('empty_lib_s'))}</div></div>`
      : `<div class="grid-empty"><div class="empty-ico">${ico}</div><div class="empty-h">${esc(i18n('empty_search_h'))}</div><div class="empty-s">${esc(i18n('empty_search_s'))}</div></div>`;
    return;
  }

  grid.innerHTML = artists.map(a => {
    const nbAlbums = a.albumCount.size;
    const artHtml  = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph card-art-circle" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`
        : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`;
    const albumSub = nbAlbums > 1 ? ` · ${i18n('n_albums', nbAlbums)}` : '';
    return `<div class="card card-artist" role="button" tabindex="0"
      data-action="drill-artist" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="artists" data-display="${esc(a.name)}"
      aria-label="${esc(a.name)}">
      <div class="card-art card-art-round">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || '?', query)}</span>
        <span class="card-sub">${a.count} ${i18n('n_tracks')}${albumSub}</span>
      </div>
    </div>`;
  }).join('');

  _hydrateArtPlaceholders(grid, { observe: true });
  updateBreadcrumb();
}

// ── renderPlaylistsGrid ───────────────────────────────────────────────────────

/** Rendu de la grille Playlists (vue "playlists"). */
export function renderPlaylistsGrid() {
  const playlists = get('playlists') || [];
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

  const queryLc  = query ? query.toLowerCase() : '';
  const filtered = queryLc
    ? playlists.filter(p => (p.name || '').toLowerCase().includes(queryLc))
    : playlists;

  if (!filtered.length) {
    const ico = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="14" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="10" y2="18"/><polygon points="17 10 23 14 17 18"/></svg>`;
    grid.innerHTML = `<div class="pl-grid-empty"><div class="empty-ico">${ico}</div>`
      + `<div class="empty-h">${esc(i18n('pl_empty'))}</div>`
      + `<div class="empty-s">${esc(i18n('pl_empty_s'))}</div></div>`;
    return;
  }

  const tracks = get('tracks') || [];
  // FIX-B6 : data-pl-id uniquement sur le div.card root
  grid.innerHTML = filtered.map(pl => {
    const plTracks = (pl.trackIds || []).slice(0, 4)
      .map(id => tracks[_trackIdxMap.get(id)])
      .filter(Boolean);
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

    const smartBadge = pl.smart ? `<span class="smart-badge" title="${esc(i18n('pl_smart_lbl'))}">✦</span>` : '';
    const pinBadge   = pl.pinned ? `<span class="pin-badge" aria-hidden="true">📌</span>` : '';
    const count = (pl.trackIds || []).length;

    return `<div class="card" role="button" tabindex="0"
      data-action="set-view" data-view="playlist" data-pl-id="${esc(pl.id)}"
      aria-label="${esc(pl.name || '?')}">
      <div class="card-art">
        ${artHtml}
        ${smartBadge}${pinBadge}
        <button class="card-play-btn" data-action="play-pl-direct" data-pl-id="${esc(pl.id)}" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(pl.name || '?', query)}</span>
        <span class="card-sub">${count} ${i18n('n_tracks')}</span>
      </div>
    </div>`;
  }).join('');

  updateBreadcrumb();
}

// ── updateBreadcrumb ──────────────────────────────────────────────────────────

/** Met à jour le fil d'Ariane selon l'état de drill-down courant. */
export function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;

  const view         = get('view')             || 'all';
  const drillKey     = get('drillKey')         || '';
  const drillFrom    = get('drillFrom')        || '';
  const drillDisplay = get('drillDisplayName') || drillKey;
  const curPlId      = get('curPlId');
  const playlists    = get('playlists') || [];

  const isDrill = drillKey || (view === 'playlist' && curPlId) ||
    ['album-detail', 'artist-detail', 'genre-detail'].includes(view);

  if (!isDrill) {
    bc.style.display = 'none';
    bc.innerHTML = '';
    return;
  }

  bc.style.display = '';

  const fromLabels = {
    albums:    i18n('lib_albums')    || 'Albums',
    artists:   i18n('lib_artists')  || 'Artistes',
    genres:    'Genres',
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
