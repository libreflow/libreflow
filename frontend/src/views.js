/**
 * views.js — Jalon 5
 * Navigation entre vues (setView, showView, goHome), recherche (onSearch),
 * tri (nextSort, nextAlbumSort, nextArtistSort, nextGenreSort).
 *
 * Lectures d'état via get() — toujours à jour (les mutations appellent set()).
 * Écritures via set() — les subscriptions dans app.js maintiennent les vars locales.
 *
 * Circulaire-safe : saveCfg / invalidateFilter importés depuis app.js.
 */

import { get, set }                                                  from './store.js';
import { CFG, SORTS, SLBLS }                                         from './cfg.js';
import { i18n }                                                       from './i18n.js';
import { eqOpen, closeEQ }                                           from './eq.js';
import { queueOpen, closeQueue }                                     from './queue.js';
import { VIRT }                                                       from './virt.js';
import { getFiltered, _trackIdxMap }                                 from './search.js';
import { buildQ, clearRvProgFill }                                   from './player.js';
import { _withVT, renderLib, renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid }                                        from './renderer.js';
import { renderGenresGrid, setContentView }                          from './genres.js';
import { renderStats }                                               from './stats.js';
import { renderRadioView, syncRadioLibBar }                          from './radio.js';
import { openNewPlaylistModal }                                      from './playlists.js';
import { openSmartPlaylistModal }                                    from './smartplaylist.js';
// Circulaire-safe (Vite résout les cycles ES module sur les fonctions)
import { saveCfg, invalidateFilter }                                  from './app.js';

// ── Helpers d'état ────────────────────────────────────────────────────────────
// Toutes les lectures passent par get() — les mutations set() maintiennent le store à jour.
// Les vars locales dans app.js sont synchronisées via subscribe() (déclaré dans app.js).

function _v()  { return get('view') || 'all'; }
function _s()  { return get('sort') || 'az'; }
function _q()  { return get('query') || ''; }

// ══ VUE BRUTE (sans VT) ══════════════════════════════════════════════════════

/** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;

  // BUGFIX : retirer .on AVANT .view-leave → .view.on a spécificité > .view-leave
  // → animationend ne fire jamais si .on reste présent (vue précédente figée).
  const prev = document.querySelector('.view.on');
  if (prev && prev !== next) {
    prev.classList.remove('on');
    prev.style.display = 'flex';
    prev.classList.add('view-leave');
    prev.addEventListener('animationend', () => {
      prev.style.display = '';
      prev.classList.remove('view-leave');
    }, { once: true });
  }

  next.classList.add('on');
}

export function showView(v) {
  _withVT(() => _showViewRaw(v));
}

// ══ ACCUEIL ═══════════════════════════════════════════════════════════════════

export function goHome() {
  const tracks = get('tracks') || [];
  if (tracks.length) {
    setView('all', document.getElementById('ni-all'));
    const srch = document.getElementById('srch');
    if (srch && srch.value) {
      srch.value = '';
      onSearch('');
      const clr = document.getElementById('srch-clear');
      if (clr) clr.style.display = 'none';
    }
  } else {
    showView('welcome');
  }
  closeQueue();
  closeEQ();
}

// ══ RECHERCHE ══════════════════════════════════════════════════════════════════

function _setSrchDisabled(disabled, placeholder) {
  const wrap = document.querySelector('.srch');
  const inp  = document.getElementById('srch');
  if (!wrap || !inp) return;
  wrap.style.display = '';
  inp.disabled = disabled;
  inp.placeholder = placeholder;
  wrap.style.opacity = disabled ? '0.45' : '';
  wrap.style.pointerEvents = disabled ? 'none' : '';
  // ERG-1 : vider le champ + réinitialiser query quand on désactive (stats/radio)
  if (disabled && _q()) {
    set('query', '');
    inp.value = '';
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
    invalidateFilter();
  }
}

let _searchDebounceTimer = null;

function _updateSrchBadge(count) {
  let badge = document.getElementById('srch-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'srch-badge';
    badge.className = 'srch-ct';
    document.querySelector('.srch')?.appendChild(badge);
  }
  const show = count > 0 && !!_q();
  badge.textContent = show ? String(count) : '';
  badge.classList.toggle('on', show);
}

export function onSearch(q) {
  const clr = document.getElementById('srch-clear');
  if (clr) clr.style.display = q ? 'flex' : 'none';
  if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => {
    const trimmed = q.trim();
    set('query', trimmed);
    invalidateFilter();
    const view = _v();
    if (!trimmed) {
      const lbl = document.getElementById('sort-lbl');
      if (lbl) lbl.textContent = i18n(SLBLS[_s()] || 'sort_az');
      _updateSrchBadge(0);
    }
    if (view === 'albums')  { renderAlbumsGrid();  _updateSrchBadge(getFiltered().length); return; }
    if (view === 'artists') { renderArtistsGrid(); _updateSrchBadge(getFiltered().length); return; }
    if (view === 'genres')  { renderGenresGrid();  _updateSrchBadge(getFiltered().length); return; }
    renderLib();
    _updateSrchBadge(getFiltered().length);
  }, CFG.SEARCH_DEBOUNCE);
}

// ══ TRI PRINCIPAL ═════════════════════════════════════════════════════════════

export function nextSort() {
  const view = _v();
  const LIMITED_SORTS = ['liked', 'artist-detail', 'genre-detail'];
  const available = LIMITED_SORTS.includes(view) ? ['az', 'za', 'artist'] : SORTS;
  const curPos = available.indexOf(_s());
  const next = available[(curPos < 0 ? 0 : curPos + 1) % available.length];
  set('sort', next);
  // BUG-6 FIX : null-check (sort-lbl absent de certaines vues)
  const _lbl = document.getElementById('sort-lbl');
  if (_lbl) _lbl.textContent = i18n(SLBLS[next] || 'sort_az');
  invalidateFilter(); renderLib(); saveCfg();
}

// ══ TRIS SECONDAIRES (albums / artistes / genres) ════════════════════════════

export function nextAlbumSort() {
  const orders = ['name', 'count', 'duration', 'year'];
  const cur = get('albumSort') || 'name';
  const next = orders[(orders.indexOf(cur) + 1) % orders.length];
  set('albumSort', next);
  const labels = { name: 'A–Z', count: 'Titres', duration: 'Durée', year: 'Année' };
  const btn = document.getElementById('album-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderLib(); saveCfg();
}

export function nextArtistSort() {
  const cur = get('artistSort') || 'name';
  const next = cur === 'name' ? 'count' : 'name';
  set('artistSort', next);
  const labels = { name: 'A–Z', count: 'Titres' };
  const btn = document.getElementById('artist-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderLib(); saveCfg();
}

export function nextGenreSort() {
  const cur = get('genreSort') || 'count';
  const next = cur === 'count' ? 'name' : 'count';
  set('genreSort', next);
  const labels = { count: 'Titres', name: 'A–Z' };
  const btn = document.getElementById('genre-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderLib(); saveCfg();
}

// ══ CHANGEMENT DE VUE ════════════════════════════════════════════════════════

export function setView(v, btn, plId) {
  // Annuler le debounce de recherche en cours
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }

  _withVT(() => {
    // BUG-10 FIX : fermer les popups flottants lors d'un changement de vue
    document.getElementById('pl-quick-pop')?.classList.remove('on');
    const selPicker = document.getElementById('sel-pl-picker');
    if (selPicker) selPicker.style.display = 'none';
    set('view', v);
    set('drillKey', '');
    set('drillFrom', '');
    set('drillDisplayName', '');

    if (v === 'playlist') {
      const pid = plId || null;
      set('curPlId', pid);
      if (pid) {
        const recentPls = get('recentPls') || [];
        set('recentPls', [pid, ...recentPls.filter(id => id !== pid)].slice(0, 5));
        saveCfg();
      }
      // S92 — restaurer le tri mémorisé de cette playlist
      const playlists = get('playlists') || [];
      const _plNav = playlists.find(p => p.id === pid);
      set('plSort', (_plNav && _plNav.sort) || 'manual');
    } else {
      set('curPlId', null);
      set('plSort', 'manual');
    }

    invalidateFilter();
    // RACE-3 FIX : reconstruire le shuffleQ quand la vue change pendant le shuffle
    if (get('shuffle')) buildQ();

    VIRT._lastListSig = '';
    VIRT._lastSig = '';

    document.querySelectorAll('.ni').forEach(b => {
      b.classList.remove('on');
      b.removeAttribute('aria-current');
    });
    if (btn) { btn.classList.add('on'); btn.setAttribute('aria-current', 'page'); }

    // Reset grid/list visibility
    const ag = document.getElementById('album-grid');
    const rg = document.getElementById('artist-grid');
    const pg = document.getElementById('playlist-grid');
    if (ag) ag.style.display = 'none';
    if (rg) rg.style.display = 'none';
    if (pg) pg.style.display = 'none';

    // 'grid' masque #tlist pour les vues en grille (albums/artistes/playlists)
    const _GRID_VIEWS = ['albums', 'artists', 'playlists'];
    setContentView(v === 'genres' ? 'genres' : _GRID_VIEWS.includes(v) ? 'grid' : 'list');

    const bc = document.getElementById('breadcrumb');
    if (bc) bc.style.display = 'none';

    // Titre de vue
    const playlists = get('playlists') || [];
    const pl = playlists.find(p => p.id === plId);
    const lbl = {
      all: i18n('lib_all'), liked: i18n('lib_liked'), artists: i18n('lib_artists'),
      albums: i18n('lib_albums'), genres: 'Genres', recent: i18n('lib_recent'),
      playlist: pl ? pl.name : i18n('pl_new'), radio: '📻 Radio',
      playlists: i18n('nav_playlists'),
    };
    document.getElementById('vhtitle').textContent = lbl[v] || 'Bibliothèque';

    // Boutons de tri contextuels
    const albumSortBtn = document.getElementById('album-sort-btn');
    const mainSortBtn  = document.getElementById('main-sort-btn');
    const NO_MAIN_SORT = ['albums', 'artists', 'genres', 'stats', 'recent', 'playlist', 'radio', 'playlists'];
    if (mainSortBtn) mainSortBtn.style.display = NO_MAIN_SORT.includes(v) ? 'none' : '';
    if (albumSortBtn) albumSortBtn.style.display = (v === 'albums') ? '' : 'none';

    let artistSortBtn = document.getElementById('artist-sort-btn');
    if (!artistSortBtn) {
      artistSortBtn = document.createElement('button');
      artistSortBtn.id = 'artist-sort-btn';
      artistSortBtn.className = 'sort-btn';
      artistSortBtn.title = 'Trier les artistes';
      artistSortBtn.onclick = nextArtistSort;
      mainSortBtn?.parentNode?.insertBefore(artistSortBtn, mainSortBtn.nextSibling);
    }
    artistSortBtn.style.display = (v === 'artists') ? '' : 'none';

    let genreSortBtn = document.getElementById('genre-sort-btn');
    if (!genreSortBtn) {
      genreSortBtn = document.createElement('button');
      genreSortBtn.id = 'genre-sort-btn';
      genreSortBtn.className = 'sort-btn';
      genreSortBtn.title = 'Trier les genres';
      genreSortBtn.onclick = nextGenreSort;
      mainSortBtn?.parentNode?.insertBefore(genreSortBtn, mainSortBtn.nextSibling);
    }
    genreSortBtn.style.display = (v === 'genres') ? '' : 'none';

    let albumDetailSortBtn = document.getElementById('album-detail-sort-btn');
    if (!albumDetailSortBtn) {
      albumDetailSortBtn = document.createElement('button');
      albumDetailSortBtn.id = 'album-detail-sort-btn';
      albumDetailSortBtn.className = 'sort-btn';
      albumDetailSortBtn.onclick = () => {
        const cur = get('albumDetailSort') || 'track';
        const next = cur === 'track' ? 'az' : 'track';
        set('albumDetailSort', next);
        albumDetailSortBtn.title = next === 'track' ? 'Trié par n° de piste' : 'Trié A–Z';
        albumDetailSortBtn.querySelector('span').textContent = next === 'track' ? '# Piste' : 'A–Z';
        invalidateFilter(); VIRT._lastListSig = ''; renderLib();
      };
      albumDetailSortBtn.innerHTML = '<span># Piste</span>';
      albumDetailSortBtn.title = 'Trié par n° de piste';
      mainSortBtn?.parentNode?.insertBefore(albumDetailSortBtn, mainSortBtn);
    }
    albumDetailSortBtn.style.display = (v === 'album-detail') ? '' : 'none';
    if (v === 'album-detail') {
      const ads = get('albumDetailSort') || 'track';
      albumDetailSortBtn.querySelector('span').textContent = ads === 'track' ? '# Piste' : 'A–Z';
    }

    let plNewBtn = document.getElementById('pl-new-btn');
    if (!plNewBtn) {
      plNewBtn = document.createElement('button');
      plNewBtn.id = 'pl-new-btn';
      plNewBtn.className = 'sort-btn';
      plNewBtn.title = i18n('sb_new_pl') || 'Nouvelle playlist';
      plNewBtn.onclick = openNewPlaylistModal;
      plNewBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      mainSortBtn?.parentNode?.insertBefore(plNewBtn, mainSortBtn.nextSibling);
    }
    let plSmartBtn = document.getElementById('pl-smart-btn');
    if (!plSmartBtn) {
      plSmartBtn = document.createElement('button');
      plSmartBtn.id = 'pl-smart-btn';
      plSmartBtn.className = 'sort-btn';
      plSmartBtn.title = i18n('sb_smart_pl') || 'Playlist intelligente';
      plSmartBtn.onclick = openSmartPlaylistModal;
      plSmartBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
      mainSortBtn?.parentNode?.insertBefore(plSmartBtn, plNewBtn);
    }
    plSmartBtn.style.display = (v === 'playlists') ? '' : 'none';
    plNewBtn.style.display   = (v === 'playlists') ? '' : 'none';

    // Dispatch vers la vue
    const tracks = get('tracks') || [];
    if (v === 'albums')    { syncRadioLibBar(); _showViewRaw('lib'); renderAlbumsGrid();    saveCfg(); return; }
    if (v === 'artists')   { syncRadioLibBar(); _showViewRaw('lib'); renderArtistsGrid();   saveCfg(); return; }
    if (v === 'genres')    { syncRadioLibBar(); _showViewRaw('lib'); renderGenresGrid();    saveCfg(); return; }
    if (v === 'playlists') { syncRadioLibBar(); _showViewRaw('lib'); renderPlaylistsGrid(); saveCfg(); return; }
    if (v === 'stats') {
      _setSrchDisabled(true, 'Recherche non disponible ici');
      _showViewRaw('stats');
      renderStats(tracks, _trackIdxMap);
      saveCfg(); return;
    }
    if (v === 'radio') {
      _setSrchDisabled(true, 'Recherche non disponible ici');
      // renderRadioView() va rebuilder innerHTML → invalider le cache DOM
      clearRvProgFill();
      _showViewRaw('radio'); renderRadioView(); saveCfg(); return;
    }
    _setSrchDisabled(false, 'Rechercher…');
    syncRadioLibBar();
    if (tracks.length || v === 'playlist') { _showViewRaw('lib'); renderLib(); }
    saveCfg();
  }); // fin _withVT
}
