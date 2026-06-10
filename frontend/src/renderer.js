// renderer.js — Rendu de la bibliothèque, grilles et helpers HTML
// Extrait de app.js (Session 144 — Jalon 5).
//
// Responsabilités :
//   - Virtual scroll : virtRenderWindow, virtAttachScroll
//   - Rendu liste : renderLib
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
         _trackIdxMap, invalidateFilterCache, _coll }        from './search.js';
import { VIRT, virtBuildRows, virtIdxAtScroll,
         virtTotalH, virtOffsetOf }                          from './virt.js';
import { esc, fmtd, extEmoji, fmt }                         from './utils.js';
import { i18n }                                              from './i18n.js';
import { CFG }                                               from './cfg.js';
import { prefetchArts, getArtUrl }                           from './artLoader.js';

// Imports circulaires — OK en ES modules (appelés à l'exécution, pas à l'init)
import { playAt, audio }                                     from './player.js';
import { cancelSearchDebounce }                              from './views.js';
import { playLog }                                           from './playlog.js';
import { getImports }                                        from './imports.js';

import { thtml, artPlaceholder, patchActiveTrack,
         patchPlayState, patchTrackEl }                      from './renderer-track.js';
import { renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid, drillDown,
         updatePlActionBar, updateBreadcrumb,
         renderFormatChips, invalidateGridMaps,
         invalidateGridMapsIfChanged,
         renderDrillHeader, _getArtistMap,
         _getAlbumMap }                                      from './renderer-grids.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _statsTimer   = null;    // debounce updateStats
// R-H9 : true tant que #tlist affiche des lignes squelette — le ResizeObserver
// de virtAttachScroll recalcule alors le nombre de lignes au lieu de re-rendre la liste.
let _skeletonActive = false;

// Restore art-loaded fade-in without inline onload (load events don't bubble → capture phase)
document.addEventListener('load', (e) => {
  if (e.target?.classList?.contains('art-img')) e.target.classList.add('art-loaded');
}, true);

// ── Virtual scroll ────────────────────────────────────────────────────────────

/** Rend uniquement la fenêtre visible + buffer. */
export function virtRenderWindow(fl) {
  const listEl = document.getElementById('tlist');
  if (!listEl || !fl) return;

  // R-H9 : un rendu réel de la liste sort de l'état skeleton.
  _skeletonActive = false;

  const sort  = get('sort')  || 'az';
  const query = get('query') || '';
  const view  = get('view')  || 'all';

  // Construire les descripteurs de lignes si la signature a changé
  const midId = fl[fl.length >> 1]?.id || '';
  const sig = `${fl.length}|${sort}|${query}|${view}|${fl[0]?.id||''}|${midId}|${fl[fl.length-1]?.id||''}`;
  if (VIRT._lastListSig !== sig) {
    VIRT._rows        = virtBuildRows(fl, { sort, query, view });
    VIRT._lastListSig = sig;
    // I-2: construire la Map fi→rowIdx pour O(1) lookup dans scrollToCurrentTrack
    const fiMap = new Map();
    for (let i = 0; i < VIRT._rows.length; i++) {
      const r = VIRT._rows[i];
      if (r.type === 'tr') fiMap.set(r.fi, i);
    }
    VIRT._fiToRowIdx = fiMap;
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

  // Delta check — ne pas reconstruire le DOM si la fenêtre et la piste active n'ont pas changé
  const curIdx  = get('curIdx');
  const _windowSig = `${startIdx}|${endIdx}|${curIdx}`;
  if (VIRT._lastWindowSig === _windowSig) return;
  VIRT._lastWindowSig = _windowSig;

  VIRT._startIdx = startIdx;
  VIRT._endIdx   = endIdx;
  const tracks  = get('tracks');
  const liked   = get('liked');
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;

  const topH    = virtOffsetOf(rows, startIdx);
  const totalH  = virtTotalH(rows);
  const botH    = Math.max(0, totalH - virtOffsetOf(rows, endIdx));

  // M-1: hoist isAlbumDetail + albumDetailSort — évite un get() par ligne dans la boucle
  const isAlbumDetail   = view === 'album-detail';
  const albumDetailSort = isAlbumDetail ? (get('albumDetailSort') || 'track') : null;
  // A11Y-ROVING: déterminer quel fi reçoit tabindex="0"
  // La piste courante (curTrack) est le tab stop si elle est dans la liste filtrée.
  // Sinon, la première ligne de piste visible reçoit tabindex="0".
  let tabStopFi = -1;
  if (curTrack) {
    // Chercher le fi de la piste courante dans la fenêtre rendue
    for (let i = startIdx; i < endIdx; i++) {
      if (rows[i].type === 'tr' && rows[i].track.id === curTrack.id) {
        tabStopFi = rows[i].fi;
        break;
      }
    }
    // A11Y-ROVING: si la piste courante est hors de la fenêtre rendue, aucune ligne DOM
    // ne peut porter son fi — laisser tabStopFi à -1 pour que le premier tr visible
    // reste focusable (sinon toute la liste devient inaccessible au clavier).
  }
  // Si aucune piste courante ou piste courante absente de la liste filtrée :
  // le premier tr rendu reçoit tabindex="0"
  let firstTrFiFound = false;

  let html = `<div class="virt-sp" style="height:${topH}px" aria-hidden="true"></div>`;

  for (let i = startIdx; i < endIdx; i++) {
    const row = rows[i];
    if (row.type === 'grp') {
      let hint = '';
      if (row.artistHint) hint = ` <span class="grp-artist">${esc(row.artistHint)}</span>`;
      const cls = row.key.length === 1 ? 'tr-grp tr-grp--alpha' : 'tr-grp';
      html += `<div class="${cls}" style="height:${VIRT.GRP_H}px" aria-hidden="true">${esc(row.key)}${hint}</div>`;
    } else {
      const t       = row.track;
      const isActive = curTrack?.id === t.id;
      const isLiked  = liked?.has(t.id) ?? false;
      // A11Y-ROVING: tabindex="0" pour la piste courante, ou pour le premier tr si aucune courante
      let isTabStop = false;
      if (tabStopFi >= 0) {
        isTabStop = (row.fi === tabStopFi);
      } else if (!firstTrFiFound) {
        isTabStop = true;
        firstTrFiFound = true;
      }
      html += thtml(t, row.fi, { active: isActive, liked: isLiked, likedSet: liked, query, isAlbumDetail, albumDetailSort, isTabStop, setSize: fl.length });
    }
  }

  html += `<div class="virt-sp" style="height:${botH}px" aria-hidden="true"></div>`;

  // P6 : annuler les spring animations en vol avant de remplacer le DOM
  listEl.querySelectorAll('[data-spring-raf]').forEach(el => {
    const id = parseInt(el.dataset.springRaf);
    if (id) cancelAnimationFrame(id);
  });

  // R3-A FIX : sauvegarder la position de scroll avant le remplacement du DOM.
  // innerHTML = reset scrollTop à 0 — l'utilisateur perd sa position à chaque
  // changement de zoom (Ctrl+Wheel). On restaure dans un rAF après la mise en DOM.
  const _savedScrollTop = listEl.scrollTop;
  listEl.innerHTML = html;
  // I-1: le DOM a été entièrement reconstruit — invalider la référence de ligne active cachée
  // (managed by renderer-track.js patchActiveTrack)
  if (_savedScrollTop > 0) {
    requestAnimationFrame(() => { listEl.scrollTop = _savedScrollTop; });
  }

  // ARCH-2/PERF-1 : précharger l'artwork des pistes visibles (lazy loading)
  const _artBatch = [];
  for (let _ai = startIdx; _ai < endIdx; _ai++) {
    const _ar = rows[_ai];
    if (_ar.type === 'tr' && _ar.track._hasArt && !_ar.track.art && !_ar.track.noArt) {
      _artBatch.push(_ar.track);
    }
  }
  if (_artBatch.length) prefetchArts(_artBatch);
}

/** Attache le handler de scroll virtual au conteneur de la liste. */
export function virtAttachScroll(listEl) {
  if (!listEl) return;
  const onScroll = () => {
    if (VIRT._raf) cancelAnimationFrame(VIRT._raf);
    // PM-9: Calculer la liste filtrée maintenant (cache chaud) plutôt que dans le rAF
    const fl = getFiltered();
    VIRT._raf = requestAnimationFrame(() => {
      virtRenderWindow(fl);
      // Mettre à jour le suivi de direction
      VIRT._lastScrollTop = listEl.scrollTop;
    });
  };
  // Réattacher proprement (évite les duplicata)
  listEl.removeEventListener('scroll', listEl._virtScrollHandler);
  listEl._virtScrollHandler = onScroll;
  listEl.addEventListener('scroll', onScroll, { passive: true });

  // R-C4 / R-H9 / R-H10 : recalculer la fenêtre virtuelle quand la hauteur de
  // #tlist change (resize de la fenêtre, ouverture/fermeture d'un panneau…).
  // Sans ça, agrandir la fenêtre laisse une bande blanche en bas de la liste
  // jusqu'au prochain scroll (viole CLAUDE.md §10).
  // Callback debouncé via rAF — aucune allocation dans la boucle rAF.
  if (typeof ResizeObserver !== 'undefined') {
    // Détacher l'ancien observer avant réattache (cf. handler de scroll).
    if (listEl._virtResizeObserver) listEl._virtResizeObserver.disconnect();
    let _roRaf = null;
    const ro = new ResizeObserver(() => {
      if (_roRaf) cancelAnimationFrame(_roRaf);
      _roRaf = requestAnimationFrame(() => {
        _roRaf = null;
        // R-H9 : tant que la liste est en état skeleton, recalculer le nombre
        // de lignes squelette plutôt que de rendre la fenêtre virtuelle.
        if (_skeletonActive) { _showSkeletonRows(); return; }
        // Forcer un re-rendu même à signature de fenêtre identique.
        VIRT._lastWindowSig = '';
        virtRenderWindow(getFiltered());
      });
    });
    ro.observe(listEl);
    listEl._virtResizeObserver = ro;
  }
}

// ── renderLib ─────────────────────────────────────────────────────────────────

/** Reconstruit la vue liste de la bibliothèque (virtual scroll).
 *  Appelé à chaque changement de tri, filtre ou vue. */
export function renderLib() {
  const fl = getFiltered();

  // PERF (audit 2026-05-19) : ne PAS wiper les caches de virt ici.
  // virtRenderWindow détecte les changements via sa signature granulaire
  // (length|sort|query|view|first/mid/last id) ; les mutations de tracks[]
  // sont invalidées explicitement par leurs callsites (backup, cdaudio,
  // library, player, orphans, selection, tagedit). Un reset systématique
  // forçait un rebuild complet même sur simple changement de tri.
  // C-1: invalider les caches memoïsés album/artist uniquement si tracks[] a changé.
  // Délégué à invalidateGridMapsIfChanged() dans renderer-grids.js.
  const _tracks = get('tracks') || [];
  invalidateGridMapsIfChanged(_tracks);

  virtRenderWindow(fl);

  // (Re)attacher le scroll
  const listEl = document.getElementById('tlist');
  virtAttachScroll(listEl);

  // État vide : afficher un message contextuel quand la liste est vide
  if (!fl.length && listEl) {
    const _view   = get('view')     || 'all';
    const _query  = get('query')    || '';
    const _drill  = get('drillKey') || '';
    const _tracks = get('tracks')   || [];
    let _ico = '', _h = '', _s = '';
    const _svg = (d) => `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const _libEmpty = !_tracks.length;
    if (_query) {
      // Recherche sans résultat
      _ico = _svg(`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`);
      _h = i18n('empty_search_h'); _s = i18n('empty_search_s');
    } else if (_view === 'liked') {
      _ico = _svg(`<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.35l-.77-.77a5.4 5.4 0 0 0-7.65 7.65l.77.77L12 20.77l7.65-7.77.77-.77a5.4 5.4 0 0 0 0-7.65z"/>`);
      _h = i18n(_libEmpty ? 'empty_lib_h' : 'empty_liked_h');
      _s = i18n(_libEmpty ? 'empty_lib_s' : 'empty_liked_s');
    } else if (_view === 'recent') {
      _ico = _svg(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="16.5" y1="13.5" x2="12" y2="13"/>`);
      _h = i18n(_libEmpty ? 'empty_lib_h' : 'empty_recent_h');
      _s = i18n(_libEmpty ? 'empty_lib_s' : 'empty_recent_s');
    } else if (_view === 'playlist') {
      _ico = _svg(`<line x1="3" y1="6" x2="14" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="10" y2="18"/><polygon points="17 10 23 14 17 18"/>`);
      _h = i18n(_libEmpty ? 'empty_lib_h' : 'empty_pl_h');
      _s = i18n(_libEmpty ? 'empty_lib_s' : 'empty_pl_s');
    } else if (_drill || _view === 'album-detail' || _view === 'artist-detail') {
      _ico = _svg(`<rect x="2.5" y="2.5" width="19" height="19" rx="3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>`);
      _h = i18n('empty_drill_h'); _s = i18n('empty_drill_s');
    } else {
      // Vue générique (all, albums, artists, genres…)
      _ico = _svg(`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`);
      _h = i18n('empty_lib_h'); _s = i18n('empty_lib_s');
    }
    if (_h) {
      const _curPl = _view === 'playlist'
        ? (get('playlists') || []).find(p => p.id === get('curPlId'))
        : null;
      const _cta = _libEmpty
        ? `<button class="empty-cta" data-action="open-folder">${esc(i18n('empty_cta_scan') || 'Scanner un dossier')}</button>`
        : (_view === 'playlist' && !_query && _curPl?.smart)
          ? `<button class="empty-cta" data-action="regen-cur-pl">${esc(i18n('pl_regen_btn') || 'Régénérer')}</button>`
          : (_view === 'playlist' && !_query)
            ? `<button class="empty-cta" data-action="set-view" data-view="all" data-ni-id="ni-all">${esc(i18n('empty_cta_add') || 'Ajouter des titres')}</button>`
            : '';
      listEl.innerHTML = `<div class="empty"><div class="empty-ico">${_ico}</div>`
        + `<div class="empty-h">${esc(_h)}</div><div class="empty-s">${esc(_s)}</div>${_cta}</div>`;
    }
  }

  // Drill header pour album-detail / artist-detail
  const view     = get('view')     || 'all';
  const drillKey = get('drillKey') || '';
  renderDrillHeader(view, drillKey);

  // innerHTML wipes any prior .playing-row → restore from audio state.
  patchPlayState(!audio.paused);

  scheduleStatsUpdate();
  renderFormatChips();
}

// ── Skeleton loading ──────────────────────────────────────────────────────────

/** Affiche des lignes squelette pendant le chargement des données. */
export function _showSkeletonRows() {
  const listEl = document.getElementById('tlist');
  if (!listEl) return;
  // R-H9 : marquer l'état skeleton — le ResizeObserver de virtAttachScroll
  // recalcule le nombre de lignes tant que ce flag est actif.
  _skeletonActive = true;
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

// ── Stats ─────────────────────────────────────────────────────────────────────

/** Met à jour les compteurs de la bibliothèque (#lib-stats). */
export function updateStats() {
  const tracks = get('tracks') || [];
  const sbEl = document.getElementById('sb-stats');
  if (!sbEl) return;
  if (tracks.length === 0) {
    sbEl.innerHTML = `<span class="sb-empty-msg"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>${esc(i18n('sb_empty'))}</span>`;
    return;
  }
  // BUG-7 FIX: exclure l'entrée clé-vide (pistes sans tag artiste) du compte sidebar
  // pour être cohérent avec renderStats() dans stats.js qui fait `if (t.artist)`.
  const artistCount = _getArtistMap().filter(a => a.key).length;
  const playCount   = playLog.length;
  const tracksLbl   = esc(i18n('sb_chip_tracks',  tracks.length));
  const artistsLbl  = esc(i18n('sb_chip_artists', artistCount));
  const playedLbl   = esc(i18n('sb_chip_played',  playCount));
  sbEl.innerHTML = `
    <span class="sb-stat-chip" aria-label="${tracksLbl}" title="${tracksLbl}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span class="sb-stat-val" aria-hidden="true">${tracks.length.toLocaleString()}</span>
    </span>
    <span class="sb-stat-chip" aria-label="${artistsLbl}" title="${artistsLbl}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg>
      <span class="sb-stat-val" aria-hidden="true">${artistCount.toLocaleString()}</span>
    </span>
    <span class="sb-stat-chip" aria-label="${playedLbl}" title="${playedLbl}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="sb-stat-val" aria-hidden="true">${playCount.toLocaleString()}</span>
    </span>`;
}

/** Planifie une mise à jour des stats après le délai de debounce. */
export function scheduleStatsUpdate() {
  if (_statsTimer) clearTimeout(_statsTimer);
  _statsTimer = setTimeout(updateStats, CFG.STATS_UPDATE_DELAY);
}

// ── ERG-P2 : Compteurs par vue dans la sidebar ────────────────────────────────
/**
 * Met à jour les badges `(N)` à droite des items sidebar fixes :
 *   #ni-all, #ni-liked, #ni-recent, #ni-playlists, #ni-artists, #ni-albums.
 * Réutilise les memo-caches existants (_getArtistMap / _getAlbumMap).
 */
export function updateSidebarCounts() {
  const tracks    = get('tracks')      || [];
  document.body.classList.toggle('lib-empty', tracks.length === 0);
  const liked     = get('liked');
  const recent    = get('recentPlays') || [];
  const playlists = get('playlists')   || [];
  const counts = {
    'ni-all':       tracks.length,
    'ni-liked':     liked ? liked.size : 0,
    'ni-recent':    recent.length,
    'ni-playlists': playlists.length,
    'ni-artists':   tracks.length ? _getArtistMap().filter(a => a.key).length : 0,
    'ni-albums':    tracks.length ? _getAlbumMap().length  : 0,
  };
  for (const [id, n] of Object.entries(counts)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    let badge = btn.querySelector('.ni-count');
    if (n > 0) {
      const text = n.toLocaleString();
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ni-count';
        badge.setAttribute('aria-hidden', 'true');
        btn.appendChild(badge);
      }
      if (badge.textContent !== text) badge.textContent = text;
    } else if (badge) {
      badge.remove();
    }
  }
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
  // C-4: double-rAF — évite le reflow synchrone forcé; re-query dans l'inner rAF
  // pour ne pas agir sur un nœud détaché si une transition DOM survient entre les deux ticks
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const live = document.getElementById('content-area');
      if (!live) return;
      live.classList.add('view-in');
      live.addEventListener('animationend', () => live.classList.remove('view-in'), { once: true });
    });
  });
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

  // I-2: lookup O(1) via la Map fi→rowIdx construite dans virtRenderWindow
  const rowIdx = VIRT._fiToRowIdx?.get(fi);
  if (rowIdx == null) return;

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

// ── Import history ────────────────────────────────────────────────────────────

const _SRC_LABELS = {
  'drag-drop':    'Glisser-déposer',
  'folder-scan':  'Scan dossier',
  'usb':          'USB',
  'manual':       'Manuel',
};

/**
 * Render import history in #import-history-list (settings panel).
 * Called when the settings Library tab is opened.
 */
export async function renderImportHistory() {
  const el = document.getElementById('import-history-list');
  if (!el) return;
  el.innerHTML = '<span class="import-history-empty">Chargement…</span>';
  const entries = await getImports();
  if (!entries.length) {
    el.innerHTML = '<span class="import-history-empty">Aucun import enregistré.</span>';
    return;
  }
  el.innerHTML = entries.slice(0, 50).map(e => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const src = _SRC_LABELS[e.source] ?? e.source;
    return `<div class="import-entry">
      <span class="import-date">${esc(dateStr)}</span>
      <span class="import-src">${esc(src)}</span>
      <span class="import-count">${e.count} titre${e.count > 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
}

// ── Barrel re-exports — call sites externes inchangés ────────────────────────
// (see also renderLib, updateStats, virtRenderWindow etc. exported natively above)
export { hlText, artPlaceholder, makeLikeBtn, makeAddBtn,
         thtml, patchActiveTrack, patchPlayState,
         patchTrackEl }                                      from './renderer-track.js'
export { renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid, drillDown,
         updatePlActionBar, updateBreadcrumb,
         renderFormatChips, invalidateGridMaps }             from './renderer-grids.js'
