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

// ── État interne ──────────────────────────────────────────────────────────────
let _statsTimer   = null;    // debounce updateStats
let _plHero       = null;    // référence au #pl-hero courant (FIX-B1)
let _activeRowEl  = null;    // I-1: cache du dernier élément .tr.act
// R-H9 : true tant que #tlist affiche des lignes squelette — le ResizeObserver
// de virtAttachScroll recalcule alors le nombre de lignes au lieu de re-rendre la liste.
let _skeletonActive = false;
const ART_COLOR_RE = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

// C-1: caches memoïsés pour _getAlbumMap / _getArtistMap
let _albumMapCache  = null;
let _artistMapCache = null;
let _tracksSig = ''; // content hash for selective map invalidation

// ── Hydratation paresseuse de l'artwork (grilles albums/artistes + drill header) ──
// Les cartes de grille ne sont PAS virtualisées : on rend un placeholder portant
// data-art-tid, puis on charge l'artwork à la demande (IntersectionObserver) pour
// ne pas instancier des centaines de blob: URLs d'un coup. Corrige le bug
// "certaines pochettes n'apparaissent pas en vue Albums/Artistes".
const _artTrackById    = new Map();   // trackId → piste représentative (carte grille/drill)
let   _gridArtObserver = null;

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
    if (_gridArtObserver) _gridArtObserver.disconnect();
    _gridArtObserver = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        hydrate(e.target);
      }
    }, { rootMargin: '300px' });
    for (const ph of phs) _gridArtObserver.observe(ph);
  } else {
    for (const ph of phs) hydrate(ph);
  }
}

// Restore art-loaded fade-in without inline onload (load events don't bubble → capture phase)
document.addEventListener('load', (e) => {
  if (e.target?.classList?.contains('art-img')) e.target.classList.add('art-loaded');
}, true);

// ── Helpers inline ────────────────────────────────────────────────────────────

/** Escapes special regex characters in a string. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cheap change-tracking signature for tracks[].
 *  Detects adds, removes, and full clears without iterating the whole array.
 *  Returns 'empty' when the array is empty (distinct from the initial '' value
 *  so the very first renderLib() always triggers a rebuild). */
function _computeTracksSig(tracks) {
  if (!tracks.length) return 'empty';
  return `${tracks.length}:${tracks[0].id}:${tracks[tracks.length - 1].id}`;
}

/** Wraps matching parts of `text` with <mark> for search highlighting.
 *  Regex is applied on the raw text first, then each segment is HTML-escaped
 *  individually so that marks are never inserted inside HTML entities.
 *  @param {string}  text  - Raw text to highlight
 *  @param {string}  query - Search query string
 *  @param {RegExp}  [re]  - M-2: optional pre-compiled regex (avoids re-creation per call) */
export function hlText(text, query, re) {
  if (!text) return '';
  if (!query) return esc(text);
  const r = re || new RegExp(`(${escapeRegex(query)})`, 'gi');
  // Split the raw text around matches using sentinel bytes, then escape each part.
  return text.replace(r, '\x00$1\x01').split('\x00').map((seg, i) => {
    if (i === 0) return esc(seg);
    const parts = seg.split('\x01');
    return `<mark>${esc(parts[0])}</mark>${esc(parts[1] || '')}`;
  }).join('');
}

function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

/** Génère le HTML d'un placeholder d'artwork (lettre initiale). */
export function artPlaceholder(t) {
  const letter = t.name?.[0]?.toUpperCase() || '♪';
  if (t.artColor && ART_COLOR_RE.test(t.artColor)) {
    return `<div class="tart-ph" aria-hidden="true" style="background:${esc(t.artColor)}"><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
  }
  const seed = t.artist || t.album || t.name || '';
  const hue  = _djb2(seed) % 360;
  const bg   = `hsl(${hue},32%,26%)`;
  const fg   = `hsl(${hue},55%,72%)`;
  return `<div class="tart-ph" aria-hidden="true" style="background:${bg};color:${fg}"><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
}

/** Génère le bouton ♥ Like pour une piste. */
export function makeLikeBtn(t, liked) {
  liked = liked ?? get('liked');
  const on  = liked?.has(t.id);
  // A11Y-06: label dynamique selon l'état (like_label / unlike_label) — annonce correctement l'état au screen reader
  const lbl = on
    ? (i18n('unlike_label') || 'Retirer des favoris')
    : (i18n('like_label')   || 'Ajouter aux favoris');
  return `<button class="tlk${on ? ' on' : ''}" data-action="likeat" data-track-id="${esc(t.id)}" aria-pressed="${!!on}" aria-label="${esc(lbl)}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>`;
}

/** Génère le bouton + Ajouter à une playlist pour une piste. */
export function makeAddBtn(t) {
  const lbl = i18n('add_to_playlist') || 'Ajouter à une playlist';
  return `<button class="tr-add-btn" data-action="show-pl-qpop" data-track-id="${esc(t.id)}" title="${esc(lbl)}" aria-label="${esc(lbl)}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
}

/** Génère le badge qualité audio — masqué dans la liste, visible uniquement dans Now Playing. */
export function makeEqHTML(_t) { return ''; }

// ── thtml — génère le HTML d'une ligne piste ─────────────────────────────────
// A11Y-3 : role="listitem" tabindex="0" aria-label
// P6     : classes dynamiques

/**
 * Génère le HTML d'une ligne piste pour le virtual scroll.
 * @param {Track}  t       - Piste
 * @param {number} fi      - Index dans la liste filtrée courante
 * @param {object} [opts]  - { active, liked, query, isAlbumDetail, hlRe, isTabStop }
 *   isAlbumDetail — M-1: pré-calculé par l'appelant pour éviter get() dans la boucle
 *   hlRe          — M-2: regex pré-compilée pour la recherche (évite new RegExp par appel)
 *   isTabStop     — A11Y-ROVING: true → tabindex="0", false/undefined → tabindex="-1"
 */
export function thtml(t, fi, { active = false, liked = false, likedSet, query = '', isAlbumDetail: _isAlbumDetail, albumDetailSort: _albumDetailSort, hlRe, isTabStop = false } = {}) {
  // Artwork — img avec fade-in (.art-img → .art-loaded au onload) OU placeholder
  const artInner = t.art
    ? `<img class="art-img" src="${esc(t.art)}" alt="" aria-hidden="true">`
    : artPlaceholder(t);

  // M-1: utiliser la valeur pré-calculée si fournie, sinon fallback sur get() (compatibilité standalone)
  const isAlbumDetail   = _isAlbumDetail   ?? (get('view') === 'album-detail');
  const albumDetailSort = _albumDetailSort  ?? (isAlbumDetail ? (get('albumDetailSort') || 'track') : null);
  const trackNum = isAlbumDetail
    // tri A-Z → numéro séquentiel (position 1-N) ; tri 'track' → numéro de tag (ou position si absent)
    ? `<div class="tr-num">${albumDetailSort === 'az' ? (fi + 1) : (t.track ?? fi + 1)}</div>`
    : '';

  const classes  = ['tr', active ? 'act' : '', isAlbumDetail ? 'tr--album-detail' : ''].filter(Boolean).join(' ');
  const ariaLbl  = [t.name, t.artistFull || t.artist].filter(Boolean).join(' — ');
  // A11Y-ROVING: roving tabindex — seul le tab stop courant reçoit tabindex="0"
  const tabIdx   = isTabStop ? '0' : '-1';
  // A11Y : aria-current="true" sur la piste courante (info non couleur-only) + title sur titres/artistes longs (tooltip troncation)
  const ariaCur  = active ? ' aria-current="true"' : '';

  return `<div class="${classes}" id="tr-${esc(t.id)}" data-track-id="${esc(t.id)}" data-fi="${fi}"
  data-action="track-click" role="listitem" tabindex="${tabIdx}" aria-label="${esc(ariaLbl)}"${ariaCur}
  draggable="true" data-drag-action="track-drag">
  ${trackNum}<div class="tart">
    ${artInner}
    <button class="tart-hover-play" data-action="play-track" data-track-id="${esc(t.id)}" tabindex="-1" aria-label="${i18n('play') || 'Lire'}">
      <svg class="icon-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
      <svg class="icon-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
    </button>
  </div>
  <div class="ti">
    <div class="tn" title="${esc(t.name || '')}">${hlText(t.name || '', query, hlRe)}</div>
    <div class="ts" title="${esc(t.artistFull || t.artist || '')}">${hlText(t.artistFull || t.artist || '', query, hlRe)}</div>
  </div>
  <div class="ta" title="${esc(t.album || '')}">${esc(t.album || '')}</div>
  <div class="tr-r">
    ${makeEqHTML(t)}
    <span class="tdur">${fmtd(t.duration)}</span>
    ${makeLikeBtn(t, likedSet)}
    ${makeAddBtn(t)}
  </div>
</div>`;
}

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
  // M-2: pré-compiler la regex de recherche une seule fois avant la boucle
  const hlRe = query ? new RegExp(`(${escapeRegex(query)})`, 'gi') : null;

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
    // PM-2: Si la piste courante n'est pas dans la fenêtre, utiliser filteredIdx O(1)
    if (tabStopFi < 0) {
      tabStopFi = filteredIdx(curTrack);
    }
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
      html += thtml(t, row.fi, { active: isActive, liked: isLiked, likedSet: liked, query, isAlbumDetail, albumDetailSort, hlRe, isTabStop });
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
  _activeRowEl = null;
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

// ── Private album / artist helpers ───────────────────────────────────────────

/** Construit la liste des entrées album depuis tracks[]. */
function _getAlbumMap() {
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
function _getArtistMap() {
  // C-1: retourner le cache si disponible
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

function renderDrillHeader(view, key) {
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
        ${a.year ? `<div class="dh-mini-year">${a.year}</div>` : ''}
      </button>`;
    }).join('');

    el.className = 'drill-header drill-header--artist';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          <span>${albums.length} album${albums.length > 1 ? 's' : ''}</span>
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
  // C-1: invalider les caches memoïsés album/artist uniquement si tracks[] a changé
  // Évite un rebuild coûteux à chaque navigation (tri, filtre, drill) sur la même lib.
  const _tracks   = get('tracks') || [];
  const _newSig   = _computeTracksSig(_tracks);
  if (_newSig !== _tracksSig) {
    _tracksSig      = _newSig;
    _albumMapCache  = null;
    _artistMapCache = null;
    // R5-A FIX : vider la Map trackId→piste des grilles — évite les références
    // à des pistes supprimées et la fuite mémoire associée.
    _artTrackById.clear();
  }

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
export function _showSkeletonRows(savedView) {
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
  const queryLc = query ? query.toLowerCase() : '';
  const albumMap = new Map();
  for (const t of tracks) {
    const key = t.album || '';
    if (queryLc && !key.toLowerCase().includes(queryLc) &&
        !(t.artist || '').toLowerCase().includes(queryLc)) continue;
    if (!albumMap.has(key)) {
      albumMap.set(key, { name: key, artist: t.artist || '', artUrl: null, artTrack: null, count: 0, totalDur: 0, year: (t.year && t.year !== 1970) ? t.year : null });
    }
    const a = albumMap.get(key);
    a.count++;
    a.totalDur += t.duration || 0;
    // C1 — artUrl : artwork déjà résolu (réutilisé direct). artTrack : 1re piste
    // porteuse d'artwork, chargée paresseusement par _hydrateArtPlaceholders.
    if (!a.artUrl && t.art) a.artUrl = t.art;
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
    if (t.year && t.year !== 1970 && !a.year) a.year = t.year;
  }

  let albums = [...albumMap.values()];

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
      : `<div class="grid-empty"><div class="empty-ico">${_alb}</div>${esc(i18n('no_results') || 'Aucun résultat')}</div>`;
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
        <span class="card-name">${hlText(a.name || i18n('unknown_album') || '?', query)}</span>
        <span class="card-sub">${hlText(a.artist, query)}${meta}</span>
        <span class="card-ct">${a.count} ${i18n('n_tracks') || 'titres'}</span>
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
    // C1 — voir renderAlbumsGrid : artUrl direct, artTrack chargé paresseusement.
    if (!a.artUrl && t.art) a.artUrl = t.art;
    if (!a.artTrack && t._hasArt && !t.noArt) { a.artTrack = t; _artTrackById.set(t.id, t); }
  }

  let artists = [...artistMap.values()];
  if (artistSort === 'count') artists.sort((a, b) => b.count - a.count);
  else artists.sort((a, b) => _coll.compare(a.name || '', b.name || ''));

  if (!artists.length) {
    const isLibEmpty = !tracks.length && !query;
    const _art = `<svg viewBox="0 0 24 24" fill="none" style="fill:none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    grid.innerHTML = isLibEmpty
      ? `<div class="grid-empty"><div class="empty-ico">${_art}</div><div class="empty-h">${esc(i18n('empty_lib_h'))}</div><div class="empty-s">${esc(i18n('empty_lib_s'))}</div></div>`
      : `<div class="grid-empty"><div class="empty-ico">${_art}</div>${esc(i18n('no_results') || 'Aucun résultat')}</div>`;
    return;
  }

  grid.innerHTML = artists.map(a => {
    const artHtml = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph card-art-circle" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`
        : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`;
    const nbAlbums = a.albumCount.size;
    return `<div class="card card-artist" role="button" tabindex="0"
      data-action="drill-artist" data-key="${esc(a.name)}" data-name="${esc(a.name)}"
      data-from="artists" data-display="${esc(a.name)}"
      aria-label="${esc(a.name)}">
      <div class="card-art card-art-round">${artHtml}
        <button class="card-play-btn" data-action="play-card" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg></button>
      </div>
      <div class="card-info">
        <span class="card-name">${hlText(a.name || '?', query)}</span>
        <span class="card-sub">${a.count} ${i18n('n_tracks') || 'titres'}${nbAlbums > 1 ? ` · ${nbAlbums} albums` : ''}</span>
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
    const count = (pl.trackIds || []).length;

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

  // I-1: retirer .act de la ligne précédente via la référence cachée si elle est encore dans le DOM
  if (_activeRowEl?.isConnected) {
    _activeRowEl.classList.remove('act', 'playing-row');
  } else {
    // Fallback : le DOM a changé depuis la dernière fois — balayage complet
    document.querySelectorAll('.tr.act').forEach(el => {
      el.classList.remove('act', 'playing-row');
    });
  }
  _activeRowEl = null;

  if (curTrack) {
    const el = document.querySelector(`.tr[data-track-id="${CSS.escape(curTrack.id)}"]`);
    if (el) {
      el.classList.add('act');
      // I-1: mémoriser la référence pour le prochain appel
      _activeRowEl = el;
    }
  }
}

/** Met à jour la classe .playing-row sur la piste active (play vs pause). */
export function patchPlayState(playing) {
  document.querySelectorAll('.tr.act, .queue-item--loop').forEach(el => {
    el.classList.toggle('playing-row', playing);
  });
}

/** Remplace le DOM d'une seule ligne piste (ex: après un tag edit). */
export function patchTrackEl(id) {
  const el = document.querySelector(`.tr[data-track-id="${CSS.escape(id)}"]`);
  if (!el) return; // hors viewport — ignoré (prochain virtRenderWindow le prendra)

  // B7 FIX : invalider les caches album/artiste APRÈS l'early-return. Avant, un
  // gros batch loadTagsBg (pistes hors-viewport) vidait les caches à chaque piste
  // → reconstruction O(n) répétée (comportement O(n²) sur un gros import).
  // Reste correct : un import change tracks.length → _computeTracksSig change →
  // renderLib() reconstruit les maps album/artiste de toute façon.
  _tracksSig      = '';
  _albumMapCache  = null;
  _artistMapCache = null;
  // R5-A FIX : idem — invalidation complète de la Map grille pour éviter fuite.
  _artTrackById.clear();

  const idx = trackIdx(id);
  if (idx < 0) return;

  const tracks = get('tracks');
  const t      = tracks[idx];
  if (!t) return;

  const fi    = filteredIdx(t); // recalcul frais — évite un dataset stale
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
  const tracks = get('tracks') || [];
  const sbEl = document.getElementById('sb-stats');
  if (!sbEl) return;
  if (tracks.length === 0) {
    sbEl.innerHTML = i18n('sb_empty');
    return;
  }
  const artistCount = _getArtistMap().length;
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
  const liked     = get('liked');
  const recent    = get('recentPlays') || [];
  const playlists = get('playlists')   || [];
  const counts = {
    'ni-all':       tracks.length,
    'ni-liked':     liked ? liked.size : 0,
    'ni-recent':    recent.length,
    'ni-playlists': playlists.length,
    'ni-artists':   tracks.length ? _getArtistMap().length : 0,
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

// ── Format filter chips ───────────────────────────────────────────────────────

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
      <span class="import-date">${dateStr}</span>
      <span class="import-src">${esc(src)}</span>
      <span class="import-count">${e.count} titre${e.count > 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
}
