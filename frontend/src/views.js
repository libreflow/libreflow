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
import { emit, on, EVENTS }                                          from './bus.js';
import { eqOpen, closeEQ }                                           from './eq.js';
import { queueOpen, closeQueue }                                     from './queue.js';
import { VIRT }                                                       from './virt.js';
import { getFiltered, _trackIdxMap, invalidateFilterCache }         from './search.js';
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
import { runViewTransition, triggerNavWipe }                         from './view-transition.js';
import { transitionViews, staggerIn }                                from './motion.js';

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

// ── Barre d'action Play/Shuffle (audit 2026-07-27) ───────────────────────────
// Visible sur les vues liste principales ; les vues playlist/drill ont déjà
// leur propre barre (#pl-action-bar / .dh-actions), les grilles n'en ont pas.
const _ACTION_BAR_VIEWS = new Set(['all', 'liked', 'recent', 'genre-detail']);

function _syncLibActionBar(v) {
  const bar = document.getElementById('lib-action-bar');
  if (bar) bar.hidden = !_ACTION_BAR_VIEWS.has(v);
}

subscribe('view', _syncLibActionBar);

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
    const cards = document.querySelectorAll('.card');
    if (cards.length) staggerIn(cards);
  }, 0);
}

// ══ VUE BRUTE (sans VT) ══════════════════════════════════════════════════════

const _COARSE_NAV_ORDER = ['welcome', 'lib', 'stats', 'radio', 'now-playing'];
let _lastCoarseView = null;

/** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
export function _showViewRaw(v) {
  const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
  const next = document.getElementById(map[v] || 'vlib');
  if (!next) return;

  // Coarse direction layer — covers welcome/lib/stats/radio/now-playing switches
  // that the fine _NAV_ORDER layer in setView() never sees (that layer only
  // compares two fine sub-view keys, e.g. 'albums' vs 'artists', both of which
  // resolve to the SAME coarse container here — so this stays silent for those,
  // and the fine layer stays silent whenever the destination isn't one of its 8
  // sub-view keys — each transition is handled by exactly one of the two layers.
  const _CONTAINER_TO_COARSE = { vw: 'welcome', vlib: 'lib', vstats: 'stats', vradio: 'radio', vnp: 'now-playing' };
  const _coarseTo = _CONTAINER_TO_COARSE[next.id];
  if (_coarseTo) {
    const _cfi = _COARSE_NAV_ORDER.indexOf(_lastCoarseView);
    const _cti = _COARSE_NAV_ORDER.indexOf(_coarseTo);
    if (_cfi >= 0 && _cti >= 0 && _cfi !== _cti) {
      document.documentElement.setAttribute('data-nav-dir', _cti > _cfi ? 'forward' : 'back');
      setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
      triggerNavWipe();
    }
    _lastCoarseView = _coarseTo;
  }

  if (v === 'welcome' || v === 'wlc') {
    document.querySelectorAll('.sb-nav .ni').forEach(b => {
      b.classList.remove('on');
      b.removeAttribute('aria-current');
    });
  }

  const prev = document.querySelector('.view.on');

  if (typeof document.startViewTransition === 'function') {
    // VT API path : simple swap, browser handles visual transition
    if (prev && prev !== next) prev.classList.remove('on');
    next.classList.add('on');
  } else {
    // Fallback path : GSAP "exit on top" cross-fade
    transitionViews(prev !== next ? prev : null, next);
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
let _navDirTimer = null;
const _NAV_ORDER = ['all', 'liked', 'recent', 'artists', 'albums', 'genres', 'playlists'];

/** Annule le debounce de recherche en cours (ex: drill-down depuis renderer.js). */
function cancelSearchDebounce() {
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
}
// drillDown() (renderer.js) émet SEARCH_DEBOUNCE_CANCEL avant de naviguer, pour éviter
// qu'un debounce de recherche en vol ne se déclenche après-coup et écrase la vue.
on(EVENTS.SEARCH_DEBOUNCE_CANCEL, cancelSearchDebounce);

function _updateSrchBadge(count) {
  let badge = document.getElementById('srch-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'srch-badge';
    badge.className = 'sr-only';
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');
    document.querySelector('.srch')?.appendChild(badge);
  }
  const hasQuery = !!_q();
  if (!hasQuery)        badge.textContent = '';
  else if (count === 0) badge.textContent = 'aucun résultat';
  else if (count === 1) badge.textContent = '1 résultat';
  else                  badge.textContent = `${count} résultats`;
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
  saveCfg();
  // Remettre le focus sur la recherche pour fluidité clavier
  if (srch) srch.focus();
}

export function onSearch(q) {
  const clr = document.getElementById('srch-clear');
  if (clr) clr.style.display = q.trim() ? 'flex' : 'none';
  if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => {
    const trimmed = q.trim();
    set('query', trimmed);
    // N'émet PAS FILTER_CHANGED ici — le rendu est déclenché explicitement ci-dessous
    // pour éviter le double-render (invalidateFilter() émettrait l'event → app.js renderLib()
    // puis le renderAlbumsGrid/renderLib explicite ci-dessous en ferait un second).
    invalidateFilterCache();
    invalidateGenreGridSig();
    const view = _v();
    if (!trimmed) {
      const lbl = document.getElementById('sort-lbl');
      if (lbl) lbl.textContent = i18n(SLBLS[_s()] || 'sort_az');
    }
    if (view === 'albums')  { renderAlbumsGrid();  _updateSrchBadge(getFiltered().length); return; }
    if (view === 'artists') { renderArtistsGrid(); _updateSrchBadge(getFiltered().length); return; }
    if (view === 'genres')  { renderGenresGrid();  _updateSrchBadge(getFiltered().length); return; }
    renderLib();
    _updateSrchBadge(getFiltered().length);
  }, CFG.SEARCH_DEBOUNCE);
}

// ══ TRI PRINCIPAL ═════════════════════════════════════════════════════════════

// ── Colonnes cliquables (audit 2026-07-27) ────────────────────────────────────
// Titre : bascule A–Z ↔ Z–A ; Album / Durée : tri simple. Le bouton cyclique
// #main-sort-btn reste le chemin clavier (l'en-tête est aria-hidden).

/** Synchronise l'état visuel des boutons colonnes avec le tri courant. */
function _syncColHdrSort(sort) {
  const s = sort || _s();
  const state = { title: null, album: null, duration: null };
  if (s === 'az') state.title = 'asc';
  else if (s === 'za') state.title = 'desc';
  else if (s === 'album') state.album = 'asc';
  else if (s === 'duration') state.duration = 'asc';
  document.querySelectorAll('#tlist-col-hdr .col-btn').forEach(b => {
    const col = b.dataset.col;
    const dir = state[col];
    b.classList.toggle('on', !!dir);
    if (dir) b.dataset.dir = dir; else delete b.dataset.dir;
  });
}
subscribe('sort', _syncColHdrSort);

export function sortByColumn(col) {
  const cur = _s();
  let next = null;
  if (col === 'title')    next = cur === 'az' ? 'za' : 'az';
  if (col === 'album')    next = 'album';
  if (col === 'duration') next = 'duration';
  if (!next || next === cur) return;
  set('sort', next);
  const _lbl = document.getElementById('sort-lbl');
  const _key = SLBLS[next] || 'sort_az';
  if (_lbl) _lbl.textContent = i18n(_key);
  document.getElementById('main-sort-btn')?.setAttribute('aria-label', `${i18n('pl_sort_label')}: ${i18n(_key)}`);
  invalidateFilter(); renderLib(); saveCfg();
}

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
  // A11Y : le bouton parent reçoit un aria-label complet (ex. "Sort: A–Z") — la couleur seule ne porte pas l'info.
  const _btn = document.getElementById('main-sort-btn');
  if (_btn) _btn.setAttribute('aria-label', `${i18n('pl_sort_label')}: ${i18n(_key)}`);
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
  // VIEWS-VT-1 FIX : runViewTransition() is the CSS-animation fallback only —
  // do NOT call it when the View Transitions API is available, otherwise both
  // CSS fade AND startViewTransition() run simultaneously.
  if (typeof document.startViewTransition !== 'function') runViewTransition();
  // Annuler le debounce de recherche en cours
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
  // Nettoyer la sélection active avant tout changement de vue (BUG-1 FIX)
  clearSelection();

  // Direction slide — active les animations directionnelles CSS (navSlideOut/In)
  // + le wipe équaliseur (triggerNavWipe) — même attribut, même granularité fine.
  const _fi = _NAV_ORDER.indexOf(get('view') || 'all');
  const _ti = _NAV_ORDER.indexOf(v);
  if (_fi >= 0 && _ti >= 0 && _fi !== _ti) {
    clearTimeout(_navDirTimer);
    document.documentElement.setAttribute('data-nav-dir', _ti > _fi ? 'forward' : 'back');
    _navDirTimer = setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
    triggerNavWipe();
  }

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

    // VIEWS-SQ-1 FIX : clear search immediately without going through the debounce
    // path (onSearch('') would schedule a setTimeout, leaving stale query visible
    // until the debounce fires).  Set store + DOM synchronously, cancel any
    // in-flight debounce, then invalidate caches so the subsequent invalidateFilter()
    // call below renders with an empty query from the start.
    // VIEWS-SQ-2 FIX : only emit FILTER_CHANGED once (via the single invalidateFilter()
    // below) to avoid the double render that occurred when switching views with an
    // active search (the old code emitted FILTER_CHANGED before AND after clearing).
    const _srch = document.getElementById('srch');
    if (_srch && _srch.value) {
      _srch.value = '';
      set('query', '');
      cancelSearchDebounce();
      document.getElementById('srch-clear')?.style?.setProperty('display', 'none');
      invalidateFilterCache();
      invalidateGenreGridSig();
    }
    invalidateFilter();
    // RACE-3 FIX : reconstruire le shuffleQ quand la vue change pendant le shuffle
    if (get('shuffle')) buildQ();

    VIRT._lastListSig   = '';
    VIRT._lastWindowSig = '';
    VIRT._lastScrollTop = null;

    _svMarkNav(v, btn);
    _svResetChrome(v, plId);
    _svSyncSortButtons(v);
    _svDispatchView(v, plId);
  }); // fin _withVT
}

// ── setView helpers (AUDIT-2026-07-01 L6 : extraction <50 lignes, §16) ────────

/** Marque l'item sidebar + l'onglet lib actifs (classe .on + aria-current/selected). */
function _svMarkNav(v, btn) {
  document.querySelectorAll('.ni, .sb-nav-btn').forEach(b => {
    b.classList.remove('on');
    b.removeAttribute('aria-current');
  });
  // AUDIT-2026-07-27 : les onglets sont des facettes de la bibliothèque
  // (Titres/Artistes/Albums/Genres) ; Radio et Stats ont leur item sidebar dédié.
  const _LIB_VIEWS = ['all', 'artists', 'albums', 'genres'];
  const _NI_BY_VIEW = { liked: 'ni-liked', recent: 'ni-recent', radio: 'ni-radio', stats: 'ni-stats' };
  const _niId = _LIB_VIEWS.includes(v) ? 'ni-all' : _NI_BY_VIEW[v];
  if (_niId) {
    const _ni = document.getElementById(_niId);
    if (_ni) { _ni.classList.add('on'); _ni.setAttribute('aria-current', 'page'); }
  } else if (btn && !btn.classList.contains('lib-tab')) {
    btn.classList.add('on'); btn.setAttribute('aria-current', 'page');
  }
  // Sync lib-tab underline indicators + visibilité : la rangée d'onglets ne
  // s'affiche que sur les vues facettes (sinon : onglets tous éteints = confus).
  const _tabsBar = document.querySelector('.lib-tabs');
  if (_tabsBar) _tabsBar.hidden = !_LIB_VIEWS.includes(v);
  document.querySelectorAll('.lib-tab').forEach(t => { t.classList.remove('on'); t.setAttribute('aria-selected', 'false'); });
  if (_LIB_VIEWS.includes(v)) {
    const _tab = document.querySelector(`.lib-tab[data-view="${v}"]`);
    if (_tab) { _tab.classList.add('on'); _tab.setAttribute('aria-selected', 'true'); }
  }

  _positionNiIndicator(document.querySelector('.ni.on'));
}

/** Glide #ni-indicator to the currently active sidebar item (or hide it).
 * Skips inline transform/height on mobile — html[data-platform="mobile"]
 * #ni-indicator (style.css) owns that geometry instead (centered top bar,
 * distinct from the desktop gliding side bar). */
function _positionNiIndicator(el) {
  const ind = document.getElementById('ni-indicator');
  if (!ind) return;
  if (!el) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  if (document.documentElement.dataset.platform === 'mobile') return;
  ind.style.transform = `translateY(${el.offsetTop}px)`;
  ind.style.height = `${el.offsetHeight}px`;
}

/** Reset grilles/breadcrumb + mode contenu + titre de vue. */
function _svResetChrome(v, plId) {
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
}

/**
 * M-14 : bouton de tri créé paresseusement. Le pattern `if (!getElementById)`
 * reste la garde d'idempotence : le listener n'est câblé qu'à la création.
 */
function _svLazyBtn(id, init) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement('button');
    b.id = id;
    b.className = 'sort-btn';
    init(b);
  }
  return b;
}

/** Visibilité + libellés des boutons de tri contextuels de la barre de vue. */
function _svSyncSortButtons(v) {
  const albumSortBtn = document.getElementById('album-sort-btn');
  const mainSortBtn  = document.getElementById('main-sort-btn');
  const NO_MAIN_SORT = ['albums', 'artists', 'genres', 'stats', 'recent', 'playlist', 'radio', 'playlists', 'album-detail', 'artist-detail', 'genre-detail'];
  if (mainSortBtn) mainSortBtn.style.display = NO_MAIN_SORT.includes(v) ? 'none' : '';
  if (albumSortBtn) albumSortBtn.style.display = (v === 'albums') ? '' : 'none';

  const artistSortBtn = _svLazyBtn('artist-sort-btn', b => {
    b.addEventListener('click', nextArtistSort);
    mainSortBtn?.parentNode?.insertBefore(b, mainSortBtn.nextSibling);
  });
  artistSortBtn.title = i18n('sort_btn_artists');
  artistSortBtn.style.display = (v === 'artists') ? '' : 'none';
  artistSortBtn.textContent = i18n(get('artistSort') === 'count' ? 'sort_count_lbl' : 'sort_az');

  const genreSortBtn = _svLazyBtn('genre-sort-btn', b => {
    b.addEventListener('click', nextGenreSort);
    mainSortBtn?.parentNode?.insertBefore(b, mainSortBtn.nextSibling);
  });
  genreSortBtn.title = i18n('sort_btn_genres');
  genreSortBtn.style.display = (v === 'genres') ? '' : 'none';
  genreSortBtn.textContent = i18n(get('genreSort') === 'name' ? 'sort_az' : 'sort_count_lbl');

  _svSyncDetailPlBtns(v, mainSortBtn);
}

/** Boutons album-detail + nouvelle playlist / smart playlist. */
function _svSyncDetailPlBtns(v, mainSortBtn) {
  const albumDetailSortBtn = _svLazyBtn('album-detail-sort-btn', b => {
    b.addEventListener('click', () => {
      const cur = get('albumDetailSort') || 'track';
      const next = cur === 'track' ? 'az' : 'track';
      set('albumDetailSort', next);
      b.title = i18n(next === 'track' ? 'sort_btn_track_num' : 'sort_btn_az_ttl');
      b.querySelector('span').textContent = next === 'track' ? i18n('sort_by_track_lbl') : i18n('sort_az');
      invalidateFilter(); VIRT._lastListSig = ''; renderLib(); saveCfg();
    });
    b.innerHTML = `<span>${i18n('sort_by_track_lbl')}</span>`;
    b.title = i18n('sort_btn_track_num');
    mainSortBtn?.parentNode?.insertBefore(b, mainSortBtn);
  });
  albumDetailSortBtn.style.display = (v === 'album-detail') ? '' : 'none';
  if (v === 'album-detail') {
    const ads = get('albumDetailSort') || 'track';
    albumDetailSortBtn.querySelector('span').textContent = ads === 'track' ? i18n('sort_by_track_lbl') : i18n('sort_az');
  }

  const plNewBtn = _svLazyBtn('pl-new-btn', b => {
    b.title = i18n('sb_new_pl') || 'Nouvelle playlist';
    b.addEventListener('click', openNewPlaylistModal);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    mainSortBtn?.parentNode?.insertBefore(b, mainSortBtn.nextSibling);
  });
  const plSmartBtn = _svLazyBtn('pl-smart-btn', b => {
    b.title = i18n('sb_smart_pl') || 'Playlist intelligente';
    b.addEventListener('click', openSmartPlaylistModal);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    mainSortBtn?.parentNode?.insertBefore(b, plNewBtn);
  });
  plSmartBtn.style.display = (v === 'playlists') ? '' : 'none';
  plNewBtn.style.display   = (v === 'playlists') ? '' : 'none';
  _svSyncPlGridSortBtn(v, mainSortBtn, plSmartBtn);
}

/** REWORK-1 : tri de la grille playlists (manuel → A-Z → récentes), persisté. */
function _svSyncPlGridSortBtn(v, mainSortBtn, anchorBtn) {
  const LBL = mode => mode === 'az' ? i18n('sort_az')
    : mode === 'recent' ? i18n('pl_sort_recent')
    : i18n('pl_sort_manual');
  const btn = _svLazyBtn('pl-grid-sort-btn', b => {
    b.title = i18n('sort_btn_playlists');
    b.addEventListener('click', () => {
      const order = ['manual', 'az', 'recent'];
      const next = order[(order.indexOf(get('plGridSort') || 'manual') + 1) % order.length];
      set('plGridSort', next);
      b.textContent = LBL(next);
      renderPlaylistsGrid();
      saveCfg();
    });
    mainSortBtn?.parentNode?.insertBefore(b, anchorBtn);
  });
  btn.textContent = LBL(get('plGridSort') || 'manual');
  btn.style.display = (v === 'playlists') ? '' : 'none';
}

/** Dispatch final vers la vue demandée (grilles différées, stats, radio, liste). */
function _svDispatchView(v, plId) {
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
    set('view', 'artists');
    invalidateFilter(); // émet FILTER_CHANGED + invalide genre grid (correctif rev-3a)
    renderArtistsGrid();
    // B36 FIX : passer le nom brut comme clé de drill. getFiltered() le compare
    // (en lowercase) à t.artist / t.artistFull bruts ; l'ancien strip [^\w\s]
    // retirait accents et ponctuation → 0 résultat pour « Beyoncé », « AC/DC »…
    requestAnimationFrame(() => drillDown('artists', displayName, displayName));
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
// Note : STATS_DRILL_ARTIST / STATS_DRILL_GENRE sont câblés dans app.js (wiring
// cross-module, cf. CLAUDE.md §6). STATS_DRILL_ALBUM est câblé ici (et non dans
// app.js) pour rester dans le scope de cet audit — même pattern « emit depuis
// stats.js → listener qui appelle le helper views.js ».
on(EVENTS.STATS_DRILL_ALBUM, ({ key, displayName }) => statsGoToAlbum(key, displayName));
