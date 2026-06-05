// renderer-grids.js — Grilles albums/artistes/playlists, drill-down, breadcrumb
// Extrait de renderer.js.

import { get, set }                                          from './store.js';
import { emit, EVENTS }                                      from './bus.js';
import { _trackIdxMap, invalidateFilterCache, _coll }        from './search.js';
import { VIRT }                                              from './virt.js';
import { esc, fmtd }                                         from './utils.js';
import { i18n }                                              from './i18n.js';
import { getArtUrl }                                         from './artLoader.js';
import { hlText }                                            from './renderer-track.js';
import { cancelSearchDebounce }                              from './views.js';

// ── État interne (caches grilles) ─────────────────────────────────────────────
let _albumMapCache  = null;
let _artistMapCache = null;
let _tracksSig      = ''; // content hash for selective map invalidation
const _artTrackById     = new Map();   // trackId → piste représentative (carte grille/drill)
// R5-B FIX : un IntersectionObserver par grille (Albums / Artistes) au lieu d'un unique
// partagé. L'ancien code déconnectait l'observer Albums quand la grille Artistes en créait
// un nouveau, laissant des placeholders non-hydratés dans la grille Albums si les deux
// grilles étaient rendues dans la même session.
const _gridArtObservers = new Map(); // gridEl → IntersectionObserver

// ── État interne (pl-action-bar) ──────────────────────────────────────────────
let _plHero = null;    // référence au #pl-hero courant (FIX-B1)

// ── Private helpers ───────────────────────────────────────────────────────────

/** Cheap change-tracking signature for tracks[].
 *  Detects adds, removes, and full clears without iterating the whole array.
 *  Returns 'empty' when the array is empty (distinct from the initial '' value
 *  so the very first renderLib() always triggers a rebuild). */
function _computeTracksSig(tracks) {
  if (!tracks.length) return 'empty';
  return `${tracks.length}:${tracks[0].id}:${tracks[tracks.length - 1].id}`;
}

/**
 * Hydrate les placeholders [data-art-tid] d'un conteneur : résout l'artwork via
 * getArtUrl() et remplace le placeholder par un <img>.
 * @param {Element|null} rootEl
 * @param {{observe?: boolean}} [opts] - observe:true → ne charge que les cartes proches du viewport
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
    }).catch((e) => console.warn('[getArtUrl]', t?.id, e));
  };
  const phs = rootEl.querySelectorAll('[data-art-tid]');
  if (observe && 'IntersectionObserver' in window) {
    // R5-B FIX : déconnecter l'observer existant POUR CE rootEl uniquement
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

/** Construit la liste des entrées album depuis tracks[]. */
export function _getAlbumMap() {
  // C-1: retourner le cache si disponible
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
      });
    }
    const a = map.get(key);
    a.count++;
    a.totalDuration += t.duration || 0;
    if (t.art && !a.art) a.art = t.art;
    // C1 — piste représentative pour l'hydratation paresseuse du drill header.
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
    if (t.year && t.year !== 1970 && !a.year) a.year = t.year;
  }
  _albumMapCache = [...map.values()];
  return _albumMapCache;
}

/** Construit la liste des entrées artiste depuis tracks[]. */
export function _getArtistMap() {
  // C-1: retourner le cache si disponible
  if (_artistMapCache) return _artistMapCache;

  const tracks = get('tracks') || [];
  const map = new Map();
  for (const t of tracks) {
    const key = t.artist || '';
    if (!map.has(key)) {
      map.set(key, { key, displayName: key, art: null, artTrack: null, count: 0, albumCount: new Set() });
    }
    const a = map.get(key);
    a.count++;
    // BUG-5 FIX: n'ajouter que les noms d'album non-vides — undefined/''/null gonflaient
    // le Set d'un bucket fantôme et faisaient afficher "2 albums" au lieu de "1".
    if (t.album) a.albumCount.add(t.album);
    if (t.art && !a.art) a.art = t.art;
    // C1 — piste représentative pour l'hydratation paresseuse du drill header.
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
  }
  _artistMapCache = [...map.values()];
  return _artistMapCache;
}

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
          ${entry.year ? `<span>${entry.year}</span>` : ''}
          <span>${entry.count} titre${entry.count > 1 ? 's' : ''}</span>
          ${mins > 0 ? `<span>${mins} min</span>` : ''}
        </div>
        <div class="dh-actions">
          <!-- A11Y-13: aria-label sur les boutons icône-texte du drill header -->
          <button class="dh-btn dh-play" data-action="dh-play-all" aria-label="Lire tout"><span aria-hidden="true">▶</span> Lire tout</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all" aria-label="Mélanger"><span aria-hidden="true">⤮</span> Mélanger</button>
        </div>
      </div>`;
    _hydrateArtPlaceholders(el);   // C1 — artwork paresseux du drill header
    return;
  }

  if (view === 'artist-detail') {
    const artists = _getArtistMap();
    const entry   = artists.find(a => a.key === key);
    if (!entry) { _removeDrillHeader(); return; }

    const keyLc = key.toLowerCase();
    // BUG-1 FIX: calcul du total AVANT slice(0,20) — les artistes avec >20 albums
    // affichaient "20 albums" au lieu du vrai total.
    const allArtistAlbums = _getAlbumMap()
      .filter(a => (a.artist || '').toLowerCase() === keyLc)
      .sort((a, b) => (b.year || 0) - (a.year || 0));
    const albums = allArtistAlbums.slice(0, 20);

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
        ${a.year ? `<div class="dh-mini-year">${a.year}</div>` : ''}
      </button>`;
    }).join('');

    el.className = 'drill-header drill-header--artist';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          <span>${allArtistAlbums.length} album${allArtistAlbums.length > 1 ? 's' : ''}</span>
          <span>${entry.count} titre${entry.count > 1 ? 's' : ''}</span>
        </div>
        <div class="dh-actions">
          <!-- A11Y-13: aria-label sur les boutons icône-texte du drill header -->
          <button class="dh-btn dh-play" data-action="dh-play-all" aria-label="Lire tout"><span aria-hidden="true">▶</span> Lire tout</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all" aria-label="Mélanger"><span aria-hidden="true">⤮</span> Mélanger</button>
        </div>
      </div>
      ${albums.length > 0 ? `
        <div class="dh-albums-section">
          <div class="dh-albums-title">Albums</div>
          <div class="dh-albums-mini">${albumCards}</div>
        </div>` : ''}`;
    _hydrateArtPlaceholders(el);   // C1 — artwork paresseux du drill header
    return;
  }

  // Toutes les autres vues : supprimer le header si présent
  _removeDrillHeader();
}

// ── invalidateGridMaps ────────────────────────────────────────────────────────

/**
 * Invalide les caches mémoïsés album/artiste sans toucher à _tracksSig.
 * À appeler après une édition de tags utilisateur (tagedit.js) pour que les
 * grilles albums/artistes et le drill header reflètent immédiatement les nouveaux
 * noms — même si tracks[] n'a pas changé de longueur.
 * Distinct du reset de _tracksSig (qui lui déclencherait un rebuild complet du
 * virtual scroll, non nécessaire ici).
 */
export function invalidateGridMaps() {
  _albumMapCache  = null;
  _artistMapCache = null;
  _artTrackById.clear();
}

/**
 * Invalide les caches mémoïsés album/artiste uniquement si tracks[] a changé.
 * C-1: évite un rebuild coûteux à chaque navigation (tri, filtre, drill) sur la même lib.
 * À appeler depuis renderLib() dans renderer.js.
 * @param {Array} tracks - tracks[] courant (get('tracks') || [])
 */
export function invalidateGridMapsIfChanged(tracks) {
  const newSig = _computeTracksSig(tracks);
  if (newSig !== _tracksSig) {
    _tracksSig      = newSig;
    _albumMapCache  = null;
    _artistMapCache = null;
    // R5-A FIX : vider la Map trackId→piste des grilles — évite les références
    // à des pistes supprimées et la fuite mémoire associée.
    _artTrackById.clear();
  }
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

  // PERF-H1 FIX : réutiliser _getAlbumMap() (memoïsée) plutôt que de reconstruire
  // la map depuis tracks[] à chaque navigation dans la grille Albums.
  // _getAlbumMap() invalide son cache quand tracks[] change (via _computeTracksSig).
  const queryLc = query ? query.toLowerCase() : '';
  let albums = _getAlbumMap();
  // Filtrage par requête : appliquer en post-filtre sur le résultat caché
  if (queryLc) {
    albums = albums.filter(a =>
      (a.key || '').toLowerCase().includes(queryLc) ||
      (a.artist || '').toLowerCase().includes(queryLc)
    );
  }
  // Adapter les noms de champs pour la couche de rendu (displayName→name, art→artUrl, totalDuration→totalDur)
  // On crée une vue légère (pas de copie profonde — les valeurs sont scalaires ou refs partagées).
  albums = albums.map(a => ({
    name:    a.key,
    artist:  a.artist,
    artUrl:  a.art,
    artTrack: a.artTrack,
    count:   a.count,
    totalDur: a.totalDuration,
    year:    a.year,
  }));

  // Tri
  if (albumSort === 'count')    albums.sort((a, b) => b.count - a.count);
  else if (albumSort === 'duration') albums.sort((a, b) => b.totalDur - a.totalDur);
  else if (albumSort === 'year') albums.sort((a, b) => (b.year || 0) - (a.year || 0));
  else albums.sort((a, b) => _coll.compare(a.name || '', b.name || ''));

  if (!albums.length) {
    const isLibEmpty = !tracks.length && !query;
    const _alb = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>`;
    grid.innerHTML = isLibEmpty
      ? `<div class="grid-empty"><div class="empty-ico">${_alb}</div><div class="empty-h">${esc(i18n('empty_lib_h'))}</div><div class="empty-s">${esc(i18n('empty_lib_s'))}</div></div>`
      : `<div class="grid-empty"><div class="empty-ico">${_alb}</div><div class="empty-h">${esc(i18n('empty_search_h'))}</div><div class="empty-s">${esc(i18n('empty_search_s'))}</div></div>`;
    return;
  }

  grid.innerHTML = albums.map(a => {
    const artHtml = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">💿</div>`
        : `<div class="card-art-ph" aria-hidden="true">💿</div>`;
    const meta = a.year ? `<span class="card-year">${a.year}</span>` : '';
    return `<div class="card" role="button" tabindex="0"
      data-action="drill-album" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="albums" data-display="${esc(a.name)}"
      aria-label="${esc(a.name)}${a.artist ? ' — ' + a.artist : ''}">
      <div class="card-art">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || i18n('unknown_album') || '?')}</span>
        <span class="card-sub">${hlText(a.artist)}${meta}</span>
        <span class="card-ct">${a.count} ${i18n('n_tracks', a.count)}</span>
      </div>
    </div>`;
  }).join('');

  _hydrateArtPlaceholders(grid, { observe: true });   // C1 — artwork paresseux des cartes
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
  let artists;
  if (!queryLc) {
    artists = _getArtistMap().slice();
  } else {
    const artistMap = new Map();
    for (const t of tracks) {
      const key = t.artist || '';
      if (!key.toLowerCase().includes(queryLc) &&
          !(t.name || '').toLowerCase().includes(queryLc)) continue;
      if (!artistMap.has(key)) {
        artistMap.set(key, { key, displayName: key, art: null, artTrack: null, count: 0, albumCount: new Set() });
      }
      const a = artistMap.get(key);
      a.count++;
      if (t.album) a.albumCount.add(t.album);
      if (!a.art && t.art) a.art = t.art;
      if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
    }
    artists = [...artistMap.values()];
  }
  if (artistSort === 'count') artists.sort((a, b) => b.count - a.count);
  else artists.sort((a, b) => _coll.compare(a.displayName || '', b.displayName || ''));

  if (!artists.length) {
    const isLibEmpty = !tracks.length && !query;
    const _art = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    grid.innerHTML = isLibEmpty
      ? `<div class="grid-empty"><div class="empty-ico">${_art}</div><div class="empty-h">${esc(i18n('empty_lib_h'))}</div><div class="empty-s">${esc(i18n('empty_lib_s'))}</div></div>`
      : `<div class="grid-empty"><div class="empty-ico">${_art}</div><div class="empty-h">${esc(i18n('empty_search_h'))}</div><div class="empty-s">${esc(i18n('empty_search_s'))}</div></div>`;
    return;
  }

  grid.innerHTML = artists.map(a => {
    const artHtml = a.art
      ? `<img src="${esc(a.art)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph card-art-circle" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">${esc(a.displayName?.[0]?.toUpperCase() || '?')}</div>`
        : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.displayName?.[0]?.toUpperCase() || '?')}</div>`;
    const nbAlbums = a.albumCount.size;
    return `<div class="card card-artist" role="button" tabindex="0"
      data-action="drill-artist" data-key="${esc(a.displayName)}" data-name="${esc(a.displayName)}"
      data-from="artists" data-display="${esc(a.displayName)}"
      aria-label="${esc(a.displayName)}">
      <div class="card-art card-art-round">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.displayName || '?')}</span>
        <span class="card-sub">${a.count} ${i18n('n_tracks', a.count)}${nbAlbums > 1 ? ` · ${nbAlbums} albums` : ''}</span>
      </div>
    </div>`;
  }).join('');

  _hydrateArtPlaceholders(grid, { observe: true });   // C1 — artwork paresseux des cartes
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

  const queryLc = query ? query.toLowerCase() : '';
  const filtered = queryLc
    ? playlists.filter(p => (p.name || '').toLowerCase().includes(queryLc))
    : playlists;

  if (!filtered.length) {
    const _pl = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="14" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="10" y2="18"/><polygon points="17 10 23 14 17 18"/></svg>`;
    grid.innerHTML = `<div class="pl-grid-empty"><div class="empty-ico">${_pl}</div>`
      + `<div class="empty-h">${esc(i18n('pl_empty'))}</div>`
      + `<div class="empty-s">${esc(i18n('pl_empty_s'))}</div></div>`;
    return;
  }

  // I-4: utilise _trackIdxMap (déjà disponible en module) au lieu d'allouer une nouvelle Map
  // FIX-B6 : data-pl-id n'est placé QU'UNE FOIS (sur le div.card root, pas sur le bouton interne)
  grid.innerHTML = filtered.map(pl => {
    // Mosaïque 4 arts
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

    const smartBadge = pl.smart ? `<span class="smart-badge" title="${esc(i18n('smart_playlist') || 'Smart')}">✦</span>` : '';
    const pinBadge   = pl.pinned ? `<span class="pin-badge" aria-hidden="true">📌</span>` : '';
    // BUG-2 FIX: ne compter que les IDs qui existent dans la bibliothèque actuelle —
    // les IDs orphelins (pistes supprimées) gonflaient le count affiché.
    const count = (pl.trackIds || []).filter(id => _trackIdxMap.has(id)).length;

    // FIX-A1 : role=button + tabindex=0 + aria-label
    return `<div class="card" role="button" tabindex="0"
      data-action="set-view" data-view="playlist" data-pl-id="${esc(pl.id)}"
      aria-label="${esc(pl.name || i18n('pl_untitled') || 'Playlist')}">
      <div class="card-art">
        ${artHtml}
        ${smartBadge}${pinBadge}
        <button class="card-play-btn" data-action="play-pl-direct" data-pl-id="${esc(pl.id)}" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(pl.name || '?')}</span>
        <span class="card-sub">${count} ${i18n('n_tracks', count)}</span>
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
  cancelSearchDebounce(); // annule tout debounce de recherche en cours avant de drill
  set('drillKey',         key);
  set('drillFrom',        from);
  set('drillDisplayName', displayName || key);
  const viewName = from === 'albums' ? 'album-detail'
                 : from === 'genres' ? 'genre-detail'
                 : 'artist-detail';
  set('view', viewName);
  invalidateFilterCache();
  // AUDIT-2026-05-22 (M-06) : les maps album/artist derivent de tracks[], pas du
  // contexte de filtre. Un drill-down ne modifie pas tracks[] → n'invalider les
  // caches que si la signature de tracks[] a reellement change (evite un rebuild
  // couteux des maps a chaque navigation sur une bibliotheque de 50k pistes).
  const _drillSig = _computeTracksSig(get('tracks') || []);
  if (_drillSig !== _tracksSig) {
    _tracksSig      = _drillSig;
    _albumMapCache  = null;
    _artistMapCache = null;
    // R5-A FIX : cohérence avec renderLib — vider les références grille obsolètes.
    _artTrackById.clear();
  }
  emit(EVENTS.FILTER_CHANGED, {});

  // Masquer les grilles, basculer en vue liste
  const ag = document.getElementById('album-grid');
  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  const gg = document.getElementById('genre-grid');
  if (ag) ag.style.display = 'none';
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';
  if (gg) gg.style.display = 'none';

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

  const _tl = document.getElementById('tlist');
  if (_tl) _tl.scrollTop = 0;
  VIRT._lastScrollTop = null;
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

  const plTracks = pl.trackIds.map(id => {
    const idx = _trackIdxMap.get(id);
    return idx !== undefined ? tracks[idx] : null;
  }).filter(Boolean);
  // BUG-2 FIX: count = pistes résolues uniquement (sans les IDs orphelins)
  const count    = plTracks.length;
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
    <span class="pl-bar-count">${count} ${i18n('n_tracks', count)}${totalDur > 0 ? ' · ' + fmtd(totalDur) : ''}</span>
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

// ── renderFormatChips ─────────────────────────────────────────────────────────

/**
 * Render format filter chips in #format-bar.
 * Shows bar only when 2+ distinct formats exist in the library.
 * Called from renderLib() and after FILTER_CHANGED events.
 */
export function renderFormatChips() {
  const bar = document.getElementById('format-bar');
  if (!bar) return;
  const tracks = get('tracks');
  const formats = [...new Set(tracks.map(t => t.ext).filter(Boolean))].sort();
  if (formats.length < 2) { bar.innerHTML = ''; return; }
  const active = get('formatFilter') || '';
  bar.innerHTML = [
    `<button class="fmt-chip${!active ? ' active' : ''}" data-action="filter-format" data-fmt="" aria-pressed="${String(!active)}">Tous</button>`,
    ...formats.map(f =>
      `<button class="fmt-chip${active === f ? ' active' : ''}" data-action="filter-format" data-fmt="${esc(f)}" aria-pressed="${String(active === f)}">${esc(f)}</button>`
    ),
  ].join('');
}
