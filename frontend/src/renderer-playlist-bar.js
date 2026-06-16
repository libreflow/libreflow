// renderer-playlist-bar.js — Barre d'action playlist et fil d'Ariane
// Extrait de renderer-grids.js.

import { get }              from './store.js';
import { _trackIdxMap }    from './search.js';
import { esc, fmtd }       from './utils.js';
import { i18n }            from './i18n.js';

// ── État interne (pl-action-bar) ──────────────────────────────────────────────
let _plHero = null;    // référence au #pl-hero courant (FIX-B1)

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
