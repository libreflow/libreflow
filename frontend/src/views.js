/**
 * views.js — Jalon 5
 * Navigation entre vues (setView, showView, goHome), recherche (onSearch),
 * tri (nextSort, nextAlbumSort, nextArtistSort, nextGenreSort).
 *
 * Lectures d'état via get() — toujours à jour (les mutations appellent set()).
 * Écritures via set() — les subscriptions dans app.js maintiennent les vars locales.
 *
 * ARCH-1 : saveCfg depuis cfgsave.js, invalidateFilter inliné (bus+search+genres).
 */

import { get, set, subscribe }                                        from './store.js';
import { CFG, SORTS, SLBLS }                                         from './cfg.js';
import { i18n }                                                       from './i18n.js';
import { emit, EVENTS }                                              from './bus.js';
import { eqOpen, closeEQ }                                           from './eq.js';
import { queueOpen, closeQueue }                                     from './queue.js';
import { VIRT }                                                       from './virt.js';
import { getFiltered, _trackIdxMap, invalidateFilterCache,
         wasFuzzySearch }                                            from './search.js';
import { buildQ, clearRvProgFill }                                   from './player.js';
import { _withVT, renderLib, renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid, drillDown, updatePlActionBar }         from './renderer.js';
import { renderGenresGrid, setContentView, invalidateGenreGridSig,
         drillGenre }                                               from './genres.js';
import { renderStats }                                               from './stats.js';
import { renderRadioView, syncRadioLibBar }                          from './radio.js';
import { openNewPlaylistModal, renderPlHero }                        from './playlists.js';
import { openSmartPlaylistModal }                                    from './smartplaylist.js';
import { saveCfg }                                                   from './cfgsave.js';
import { clearSelection }                                            from './selection.js';

// Inline helper — équivalent de app.js:invalidateFilter() (ARCH-1, no circular dep)
function invalidateFilter() {
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
}

// ── Helpers d'état ────────────────────────────────────────────────────────────
// Toutes les lectures passent par get() — les mutations set() maintiennent le store à jour.
// Les vars locales dans app.js sont synchronisées via subscribe() (déclaré dans app.js).

function _v()  { return get('view') || 'all'; }
function _s()  { return get('sort') || 'az'; }
function _q()  { return get('query') || ''; }

// ── Visibilité boutons tri — réagit à TOUT changement de vue (setView ET drillDown) ──────
// drillDown() appelle set('view') directement sans passer par setView() → la logique de
// visibilité des boutons tri doit être attachée au store, pas à setView() seulement.
const _NO_MAIN_VIEWS = new Set(['albums','artists','genres','stats','recent','playlist','radio','playlists','album-detail','artist-detail','genre-detail','now-playing']);

function _syncSortBtns(v) {
  const mainSortBtn = document.getElementById('main-sort-btn');
  if (mainSortBtn) mainSortBtn.style.display = _NO_MAIN_VIEWS.has(v) ? 'none' : '';

  const albumDetailSortBtn = document.getElementById('album-detail-sort-btn');
  if (albumDetailSortBtn) {
    const show = v === 'album-detail';
    albumDetailSortBtn.style.display = show ? '' : 'none';
    if (show) {
      const ads = get('albumDetailSort') || 'track';
      const span = albumDetailSortBtn.querySelector('span');
      if (span) span.textContent = ads === 'track' ? i18n('sort_by_track_lbl') : i18n('sort_az');
      albumDetailSortBtn.title = i18n(ads === 'track' ? 'sort_btn_track_num' : 'sort_btn_az_ttl');
    }
  }
}

// S'abonner au store — déclenché par set('view') quel que soit l'appelant
subscribe('view', _syncSortBtns);

// ── INP — Renders de grilles différés ─────────────────────────────────────────
// renderAlbumsGrid / renderArtistsGrid / renderGenresGrid / renderPlaylistsGrid
// construisent la totalité du HTML synchronement (O(n_tracks) + O(m log m) sort
// + innerHTML ~400 cards ≈ 80–200ms bloquants → INP > 200ms pour de grandes biblio).
//
// Fix : on diffère le render lourd via setTimeout(0) — le browser peut peindre
// l'état intermédiaire (nav active, titre de vue, View Transition) AVANT de
// construire les cards. L'INP est ainsi limité au travail léger (< 20ms).
//
// _gridRenderToken : annule un render périmé si l'utilisateur change de vue
// rapidement (ex. clic rapide albums → artistes → albums).
let _gridRenderToken = 0;

/**
 * Diffère `renderFn` au prochain tick en annulant toute invocation précédente.
 * @param {Function} renderFn
 */
function _deferGridRender(renderFn) {
  const token = ++_gridRenderToken;
  setTimeout(() => {
    if (token !== _gridRenderToken) return; // render périmé — ignorer
    renderFn();
  }, 0);
}

// ══ VUE BRUTE (sans VT) ══════════════════════════════════════════════════════

/** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
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
  // Animation d'entrée en fallback non-VT (VT API gère le cross-fade quand disponible)
  if (prev && prev !== next && typeof document.startViewTransition !== 'function') {
    next.classList.add('view-enter');
    next.addEventListener('animationend', () => next.classList.remove('view-enter'), { once: true });
  }
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

function _setSrchDisabled(disabled) {
  const wrap = document.querySelector('.srch');
  const inp  = document.getElementById('srch');
  if (!wrap || !inp) return;
  wrap.style.display = '';
  inp.disabled = disabled;
  inp.placeholder = disabled ? i18n('srch_disabled') : i18n('srch_ph');
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

/** Annule le debounce de recherche en cours (ex: drill-down depuis renderer.js). */
export function cancelSearchDebounce() {
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
}

function _updateSrchBadge(count) {
  let badge = document.getElementById('srch-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'srch-badge';
    badge.className = 'srch-ct';
    document.querySelector('.srch')?.appendChild(badge);
  }
  const hasQuery = !!_q();
  const show = count > 0 && hasQuery;
  // A11Y : annoncer le résultat (y compris "0") via aria-live. Le visuel reste piloté
  // par `.on` qui contrôle opacity — quand count=0, .on retiré donc badge invisible,
  // mais aria-live="polite" annonce le textContent quand-même.
  if (hasQuery && count === 0) {
    badge.textContent = '0 résultats';
  } else if (show) {
    badge.textContent = wasFuzzySearch() ? '≈ ' + String(count) : String(count);
  } else {
    badge.textContent = '';
  }
  badge.classList.toggle('on', show);
  updateClearFiltersBtn();
}

// ── ERG-P1 : Bouton "Effacer tous les filtres" ───────────────────────────────
// Visible si au moins un filtre actif : search, format chip non-Tous, ou drill.
export function updateClearFiltersBtn() {
  const btn = document.getElementById('clear-filters');
  if (!btn) return;
  const hasQuery  = !!_q();
  const hasFormat = !!(get('formatFilter'));
  const hasDrill  = !!(get('drillKey'));
  btn.style.display = (hasQuery || hasFormat || hasDrill) ? 'flex' : 'none';
}

/**
 * ERG-P1 — Réinitialise les 3 filtres (search, format chip, drill) sans changer la vue.
 * Diffère de goHome() qui force la vue "all".
 */
export function clearAllFilters() {
  let changed = false;
  // 1. Recherche
  const srch = document.getElementById('srch');
  if (srch && srch.value) {
    srch.value = '';
    set('query', '');
    const clr = document.getElementById('srch-clear');
    if (clr) clr.style.display = 'none';
    changed = true;
  }
  // 2. Format chip
  if (get('formatFilter')) {
    set('formatFilter', '');
    changed = true;
  }
  // 3. Drill
  if (get('drillKey')) {
    set('drillKey', '');
    set('drillFrom', '');
    set('drillDisplayName', '');
    document.getElementById('drill-header')?.remove();
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.style.display = 'none';
    changed = true;
  }
  if (!changed) return;
  cancelSearchDebounce();
  invalidateFilter();
  emit(EVENTS.FILTER_CHANGED, {});
  saveCfg();
  // Remettre le focus sur la recherche pour fluidité clavier
  if (srch) srch.focus();
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
  const _key = SLBLS[next] || 'sort_az';
  if (_lbl) _lbl.textContent = i18n(_key);
  // A11Y : le bouton parent reçoit un aria-label complet ("Tri : A à Z, cycle suivant") — la couleur seule ne porte pas l'info.
  const _btn = document.getElementById('main-sort-btn');
  if (_btn) _btn.setAttribute('aria-label', `Tri : ${i18n(_key)} — cliquer pour cycler`);
  invalidateFilter(); renderLib(); saveCfg();
}

// ══ TRIS SECONDAIRES (albums / artistes / genres) ════════════════════════════

export function nextAlbumSort() {
  const orders = ['name', 'count', 'duration', 'year'];
  const cur = get('albumSort') || 'name';
  const next = orders[(orders.indexOf(cur) + 1) % orders.length];
  set('albumSort', next);
  const labels = { name: i18n('sort_az'), count: i18n('sort_count_lbl'), duration: i18n('pl_sort_duration'), year: i18n('sort_year_lbl') };
  const btn = document.getElementById('album-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderAlbumsGrid(); saveCfg();
}

export function nextArtistSort() {
  const cur = get('artistSort') || 'name';
  const next = cur === 'name' ? 'count' : 'name';
  set('artistSort', next);
  const labels = { name: i18n('sort_az'), count: i18n('sort_count_lbl') };
  const btn = document.getElementById('artist-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderArtistsGrid(); saveCfg();
}

export function nextGenreSort() {
  const cur = get('genreSort') || 'count';
  const next = cur === 'count' ? 'name' : 'count';
  set('genreSort', next);
  const labels = { count: i18n('sort_count_lbl'), name: i18n('sort_az') };
  const btn = document.getElementById('genre-sort-btn');
  if (btn) btn.textContent = labels[next];
  renderGenresGrid(); saveCfg();
}

// ══ CHANGEMENT DE VUE ════════════════════════════════════════════════════════

export function setView(v, btn, plId) {
  // Annuler le debounce de recherche en cours
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
  // Nettoyer la sélection active avant tout changement de vue (BUG-1 FIX)
  clearSelection();

  _withVT(() => {
    // BUG-10 FIX : fermer les popups flottants lors d'un changement de vue
    document.getElementById('pl-quick-pop')?.classList.remove('on');
    const selPicker = document.getElementById('sel-pl-picker');
    if (selPicker) selPicker.style.display = 'none';
    set('view', v);
    set('drillKey', '');
    set('drillFrom', '');
    set('drillDisplayName', '');
    document.getElementById('drill-header')?.remove();

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
    // BUG-2 FIX : vider la recherche lors d'un changement de vue top-level (cohérent avec goHome)
    const _srch = document.getElementById('srch');
    if (_srch && _srch.value) {
      _srch.value = '';
      onSearch('');
      const _clr = document.getElementById('srch-clear');
      if (_clr) _clr.style.display = 'none';
    }
    // RACE-3 FIX : reconstruire le shuffleQ quand la vue change pendant le shuffle
    if (get('shuffle')) buildQ();

    VIRT._lastListSig   = '';
    VIRT._lastWindowSig = '';
    VIRT._lastScrollTop = null;

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
      albums: i18n('lib_albums'), genres: i18n('lib_genres'), recent: i18n('lib_recent'),
      playlist: pl ? pl.name : i18n('pl_new'), radio: i18n('lib_radio'),
      playlists: i18n('nav_playlists'),
    };
    const vhtitleEl = document.getElementById('vhtitle');
    if (vhtitleEl) vhtitleEl.textContent = lbl[v] || i18n('sb_group_lib');

    // Boutons de tri contextuels
    const albumSortBtn = document.getElementById('album-sort-btn');
    const mainSortBtn  = document.getElementById('main-sort-btn');
    const NO_MAIN_SORT = ['albums', 'artists', 'genres', 'stats', 'recent', 'playlist', 'radio', 'playlists', 'album-detail', 'artist-detail', 'genre-detail'];
    if (mainSortBtn) mainSortBtn.style.display = NO_MAIN_SORT.includes(v) ? 'none' : '';
    if (albumSortBtn) albumSortBtn.style.display = (v === 'albums') ? '' : 'none';

    let artistSortBtn = document.getElementById('artist-sort-btn');
    if (!artistSortBtn) {
      artistSortBtn = document.createElement('button');
      artistSortBtn.id = 'artist-sort-btn';
      artistSortBtn.className = 'sort-btn';
      artistSortBtn.onclick = nextArtistSort;
      mainSortBtn?.parentNode?.insertBefore(artistSortBtn, mainSortBtn.nextSibling);
    }
    artistSortBtn.title = i18n('sort_btn_artists');
    artistSortBtn.style.display = (v === 'artists') ? '' : 'none';
    artistSortBtn.textContent = i18n(get('artistSort') === 'count' ? 'sort_count_lbl' : 'sort_az');

    let genreSortBtn = document.getElementById('genre-sort-btn');
    if (!genreSortBtn) {
      genreSortBtn = document.createElement('button');
      genreSortBtn.id = 'genre-sort-btn';
      genreSortBtn.className = 'sort-btn';
      genreSortBtn.onclick = nextGenreSort;
      mainSortBtn?.parentNode?.insertBefore(genreSortBtn, mainSortBtn.nextSibling);
    }
    genreSortBtn.title = i18n('sort_btn_genres');
    genreSortBtn.style.display = (v === 'genres') ? '' : 'none';
    genreSortBtn.textContent = i18n(get('genreSort') === 'name' ? 'sort_az' : 'sort_count_lbl');

    let albumDetailSortBtn = document.getElementById('album-detail-sort-btn');
    if (!albumDetailSortBtn) {
      albumDetailSortBtn = document.createElement('button');
      albumDetailSortBtn.id = 'album-detail-sort-btn';
      albumDetailSortBtn.className = 'sort-btn';
      albumDetailSortBtn.onclick = () => {
        const cur = get('albumDetailSort') || 'track';
        const next = cur === 'track' ? 'az' : 'track';
        set('albumDetailSort', next);
        albumDetailSortBtn.title = i18n(next === 'track' ? 'sort_btn_track_num' : 'sort_btn_az_ttl');
        albumDetailSortBtn.querySelector('span').textContent = next === 'track' ? i18n('sort_by_track_lbl') : i18n('sort_az');
        invalidateFilter(); VIRT._lastListSig = ''; renderLib(); saveCfg();
      };
      albumDetailSortBtn.innerHTML = `<span>${i18n('sort_by_track_lbl')}</span>`;
      albumDetailSortBtn.title = i18n('sort_btn_track_num');
      mainSortBtn?.parentNode?.insertBefore(albumDetailSortBtn, mainSortBtn);
    }
    albumDetailSortBtn.style.display = (v === 'album-detail') ? '' : 'none';
    if (v === 'album-detail') {
      const ads = get('albumDetailSort') || 'track';
      albumDetailSortBtn.querySelector('span').textContent = ads === 'track' ? i18n('sort_by_track_lbl') : i18n('sort_az');
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
    // INP FIX : renders de grilles différés → le pointer event se termine < 20ms,
    // le browser peint immédiatement, le contenu arrive dans la task suivante (~0ms après).
    if (v === 'albums')    { syncRadioLibBar(); _showViewRaw('lib'); saveCfg(); _deferGridRender(renderAlbumsGrid);    return; }
    if (v === 'artists')   { syncRadioLibBar(); _showViewRaw('lib'); saveCfg(); _deferGridRender(renderArtistsGrid);   return; }
    if (v === 'genres')    { syncRadioLibBar(); _showViewRaw('lib'); saveCfg(); _deferGridRender(renderGenresGrid);    return; }
    if (v === 'playlists') { syncRadioLibBar(); _showViewRaw('lib'); saveCfg(); _deferGridRender(renderPlaylistsGrid); return; }
    if (v === 'stats') {
      _setSrchDisabled(true);
      _showViewRaw('stats');
      renderStats(tracks, _trackIdxMap);
      saveCfg(); return;
    }
    if (v === 'radio') {
      _setSrchDisabled(true);
      // renderRadioView() va rebuilder innerHTML → invalider le cache DOM
      clearRvProgFill();
      _showViewRaw('radio'); renderRadioView(); saveCfg(); return;
    }
    _setSrchDisabled(false);
    syncRadioLibBar();
    const _tl = document.getElementById('tlist');
    if (_tl) _tl.scrollTop = 0;
    _showViewRaw('lib'); renderLib();
    // Playlist hero + barre d'action (play / shuffle / ••• → supprimer)
    if (v === 'playlist') {
      const _fl  = getFiltered();
      const _pls = get('playlists') || [];
      const _pl  = _pls.find(p => p.id === (plId || get('curPlId')));
      renderPlHero(_pl, _fl);
      updatePlActionBar();
    } else {
      // Nettoyer les éléments propres à la vue playlist quand on la quitte
      document.getElementById('pl-action-bar')?.remove();
      document.getElementById('pl-col-header')?.remove();
      if (document.getElementById('pl-hero')) renderPlHero(null);
    }
    saveCfg();
  }); // fin _withVT
}

// ── Stats navigation helpers (moved from app.js — ARCH-1) ────────────────────
// stats.js now imports these directly instead of from app.js.

/** Navigue depuis le panneau Stats vers la vue genre-detail. */
export function statsGoToGenre(key, displayName) {
  _withVT(() => {
    _showViewRaw('lib');
    drillGenre(key, displayName);
  });
}

/** Navigue depuis le panneau Stats vers la vue artist-detail. */
export function statsGoToArtist(displayName) {
  _withVT(() => {
    const key = displayName.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    set('view', 'artists');
    invalidateFilter(); // émet FILTER_CHANGED + invalide genre grid (correctif rev-3a)
    renderArtistsGrid();
    requestAnimationFrame(() => drillDown('artists', key, displayName));
  });
}

/** Navigue depuis le panneau Stats vers la vue album-detail. */
export function statsGoToAlbum(albumKey, displayName) {
  _withVT(() => {
    set('view', 'albums');
    invalidateFilter(); // émet FILTER_CHANGED + invalide genre grid (correctif rev-3a)
    renderAlbumsGrid();
    requestAnimationFrame(() => drillDown('albums', albumKey, displayName));
  });
}
