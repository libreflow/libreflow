// renderer.js — Rendu de la bibliothèque, grilles et helpers HTML

import { get, set }                                          from './store.js';
import { emit, on, EVENTS }                                  from './bus.js';
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
import { playLog }                                           from './playlog.js';
import { getImports }                                        from './imports.js';

// Grilles et drill header — split §16 (renderer.js dépassait 800 lignes)
import { renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid,
         renderDrillHeader, resetGridCaches,
         updateBreadcrumb }                                  from './renderer-grids.js';

export { renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid, updateBreadcrumb };

let _plHero       = null;    // référence au #pl-hero courant (FIX-B1)
let _activeRowEl  = null;    // I-1: cache du dernier élément .tr.act
// R-H9 : true tant que #tlist affiche des lignes squelette — le ResizeObserver
// de virtAttachScroll recalcule alors le nombre de lignes au lieu de re-rendre la liste.
let _skeletonActive = false;
const ART_COLOR_RE = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

let _tracksSig = ''; // content hash for grid cache invalidation (see renderer-grids.js)

// Restore art-loaded fade-in without inline onload (load events don't bubble → capture phase)
document.addEventListener('load', (e) => {
  if (e.target?.classList?.contains('art-img')) e.target.classList.add('art-loaded');
}, true);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns 'empty' when empty (distinct from '' so the first renderLib() always triggers a rebuild).
function _computeTracksSig(tracks) {
  if (!tracks.length) return 'empty';
  return `${tracks.length}:${tracks[0].id}:${tracks[tracks.length - 1].id}`;
}

// M-2: optional pre-compiled regex (avoids re-creation per call)
export function hlText(text, query, re) {
  if (!text) return '';
  if (!query) return esc(text);
  // Build per-word alternation regex when no pre-compiled re provided.
  // Matches "dark side" as /dark|side/ so both words are highlighted even when
  // they appear in different fields (consistent with multi-term filter logic).
  const r = re || new RegExp(
    `(${query.trim().split(/\s+/).filter(Boolean).map(escapeRegex).join('|')})`,
    'gi'
  );
  // Split the raw text around matches using sentinel bytes, then escape each part.
  return text.replace(r, '\x00$1\x01').split('\x00').map((seg, i) => {
    if (i === 0) return esc(seg);
    const parts = seg.split('\x01');
    return `<mark class="srch-hl">${esc(parts[0])}</mark>${esc(parts[1] || '')}`;
  }).join('');
}

function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

export function artPlaceholder(t) {
  const letter = t.name?.[0]?.toUpperCase() || '♪';
  if (t.artColor && ART_COLOR_RE.test(t.artColor)) {
    return `<div class="tart-ph" aria-hidden="true" style="background:${esc(t.artColor)}"><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
  }
  // Album d'abord : les pistes d'un même album partagent la même couleur
  // (les crédits "feat." varient par piste et fragmenteraient la teinte).
  const seed = t.album || t.artist || t.name || '';
  const hue  = _djb2(seed) % 360;
  const bg   = `hsl(${hue},32%,26%)`;
  const fg   = `hsl(${hue},55%,72%)`;
  return `<div class="tart-ph" aria-hidden="true" style="background:${bg};color:${fg}"><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
}

export function makeLikeBtn(t, liked) {
  liked = liked ?? get('liked');
  const on  = liked?.has(t.id);
  // A11Y-06: label dynamique selon l'état (like_label / unlike_label) — annonce correctement l'état au screen reader
  const lbl = on
    ? (i18n('unlike_label') || 'Retirer des favoris')
    : (i18n('like_label')   || 'Ajouter aux favoris');
  return `<button class="tlk${on ? ' on' : ''}" data-action="likeat" data-track-id="${esc(t.id)}" aria-pressed="${!!on}" aria-label="${esc(lbl)}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>`;
}

export function makeAddBtn(t) {
  const lbl = i18n('add_to_playlist') || 'Ajouter à une playlist';
  return `<button class="tr-add-btn" data-action="show-pl-qpop" data-track-id="${esc(t.id)}" title="${esc(lbl)}" aria-label="${esc(lbl)}" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
}

export function makeEqHTML(_t) {
  return '<span class="eq-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
}

// AUDIT-2026-07-27 : ⋯ au hover — ouvre le même menu que le clic droit (tr-more, handlers.js)
export function makeMoreBtn(t) {
  const lbl = i18n('tr_more') || "Plus d'actions";
  return `<button class="tr-more-btn" data-action="tr-more" data-track-id="${esc(t.id)}" title="${esc(lbl)}" aria-label="${esc(lbl)}" aria-haspopup="menu" tabindex="-1"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>`;
}

// A11Y-3: role="listitem" tabindex="0" aria-label; P6: classes dynamiques
export function thtml(t, fi, { active = false, liked = false, likedSet, query = '', isAlbumDetail: _isAlbumDetail, albumDetailSort: _albumDetailSort, hlRe, isTabStop = false, setSize = 0 } = {}) {
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

  // A11Y-16 : aria-setsize/aria-posinset annoncent la position réelle ("X sur Y")
  // dans la liste virtualisée — équivalent role=list correct (les lignes restent
  // role="listitem", pas de grille incomplète sans gridcell).
  return `<div class="${classes}" id="tr-${esc(t.id)}" data-track-id="${esc(t.id)}" data-fi="${fi}"
  data-action="track-click" role="listitem" tabindex="${tabIdx}" aria-setsize="${setSize}" aria-posinset="${fi + 1}" aria-label="${esc(ariaLbl)}"${ariaCur}
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
    ${makeMoreBtn(t)}
  </div>
</div>`;
}

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
  // M-2: pré-compiler la regex de recherche une seule fois avant la boucle (per-word alternation)
  const hlRe = query
    ? new RegExp(`(${query.trim().split(/\s+/).filter(Boolean).map(escapeRegex).join('|')})`, 'gi')
    : null;

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
      html += thtml(t, row.fi, { active: isActive, liked: isLiked, likedSet: liked, query, isAlbumDetail, albumDetailSort, hlRe, isTabStop, setSize: fl.length });
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
    _tracksSig = _newSig;
    resetGridCaches(); // invalide _albumMapCache, _artistMapCache, _artTrackById (renderer-grids.js)
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
      // AUDIT-2026-07-27 : chaque état vide se termine par un bouton (règle
      // flagship) — recherche → effacer, favoris/récents → explorer la biblio.
      const _cta = _libEmpty
        ? `<button class="empty-cta" data-action="open-folder">${esc(i18n('empty_cta_scan') || 'Scanner un dossier')}</button>`
        : _query
          ? `<button class="empty-cta" data-action="clear-search">${esc(i18n('aria_srch_clear') || 'Effacer la recherche')}</button>`
          : (_view === 'playlist' && _curPl?.smart)
            ? `<button class="empty-cta" data-action="regen-cur-pl">${esc(i18n('pl_regen_btn') || 'Régénérer')}</button>`
            : (_view === 'playlist')
              ? `<button class="empty-cta" data-action="set-view" data-view="all" data-ni-id="ni-all">${esc(i18n('empty_cta_add') || 'Ajouter des titres')}</button>`
              : (_view === 'liked' || _view === 'recent')
                ? `<button class="empty-cta" data-action="set-view" data-view="all" data-ni-id="ni-all">${esc(i18n('empty_cta_explore') || 'Explorer la bibliothèque')}</button>`
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

  renderFormatChips();
}

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


export function drillDown(from, key, displayName) {
  emit(EVENTS.SEARCH_DEBOUNCE_CANCEL, {}); // annule tout debounce de recherche en cours avant de drill
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
    _tracksSig = _drillSig;
    resetGridCaches(); // invalide _albumMapCache, _artistMapCache, _artTrackById (renderer-grids.js)
  }
  emit(EVENTS.FILTER_CHANGED, {});

  const ag = document.getElementById('album-grid');
  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  const gg = document.getElementById('genre-grid');
  if (ag) ag.style.display = 'none';
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';
  if (gg) gg.style.display = 'none';

  const ca = document.getElementById('content-area');
  if (ca) ca.dataset.view = 'list';

  const vhtitle = document.getElementById('vhtitle');
  if (vhtitle) vhtitle.textContent = displayName || key;

  const bc = document.getElementById('breadcrumb');
  if (bc) bc.style.display = '';
  updateBreadcrumb();

  const _tl = document.getElementById('tlist');
  if (_tl) _tl.scrollTop = 0;
  VIRT._lastScrollTop = null;
  emit(EVENTS.RENDER_LIB, {});
}

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

  const playLbl = i18n('pl_play_all') || 'Tout lire';
  const shufLbl = i18n('pl_shuffle')  || 'Aléatoire';
  const moreLbl = i18n('pl_more')     || 'Plus';
  // FAB Play accentué + SVG (audit 2026-07-27 : les glyphes Unicode ▶ ⇀ •••
  // cassaient le langage d'icônes SVG de l'app, et l'action primaire n'était
  // pas saillante). Ordre Spotify : Play, Shuffle, méta, puis outils à droite.
  const html = `<div id="pl-action-bar" class="pl-action-bar">
    <button class="fab-play fab-play--sm" data-action="play-pl-from" data-idx="0" aria-label="${playLbl}" title="${playLbl}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 21 12 7 20" fill="currentColor"/></svg>
    </button>
    <button class="lib-shuf-btn" data-action="shuffle-cur-pl" aria-label="${shufLbl}" title="${shufLbl}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6A4 4 0 0 1 16.027 6H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg>
    </button>
    <span class="pl-bar-count">${count} ${i18n('n_tracks') || 'titres'}${totalDur > 0 ? ' · ' + fmtd(totalDur) : ''}</span>
    <span class="pl-bar-spacer"></span>
    <select class="pl-sort-sel" data-input-action="pl-sort" aria-label="${i18n('sort') || 'Tri'}">${sortOptions}</select>
    <button class="pl-act-btn icon-btn" data-action="show-cur-pl-menu" aria-label="${moreLbl}" title="${moreLbl}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
    </button>
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

export function patchActiveTrack() {
  const curIdx   = get('curIdx');
  const tracks   = get('tracks') || [];
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;

  // I-1: retirer .act de la ligne précédente via la référence cachée si elle est encore dans le DOM
  // A11Y-15 : aria-current="true" doit suivre .act exactement (set au render dans renderTrackRow,
  // donc on le retire ici lors du déplacement incrémental sinon il reste sur l'ancienne ligne).
  if (_activeRowEl?.isConnected) {
    _activeRowEl.classList.remove('act', 'playing-row');
    _activeRowEl.removeAttribute('aria-current');
  } else {
    // Fallback : le DOM a changé depuis la dernière fois — balayage complet
    document.querySelectorAll('.tr.act, .tr[aria-current="true"]').forEach(el => {
      el.classList.remove('act', 'playing-row');
      el.removeAttribute('aria-current');
    });
  }
  _activeRowEl = null;

  if (curTrack) {
    const el = document.querySelector(`.tr[data-track-id="${CSS.escape(curTrack.id)}"]`);
    if (el) {
      el.classList.add('act');
      el.setAttribute('aria-current', 'true');
      // I-1: mémoriser la référence pour le prochain appel
      _activeRowEl = el;
    }
  }
}

export function patchPlayState(playing) {
  const tlist = document.getElementById('tlist');
  const qlist = document.getElementById('queue-list');
  if (tlist) tlist.querySelectorAll('.tr.act').forEach(el => el.classList.toggle('playing-row', playing));
  if (qlist) qlist.querySelectorAll('.queue-item--loop').forEach(el => el.classList.toggle('playing-row', playing));
}

export function patchTrackEl(id) {
  const el = document.querySelector(`.tr[data-track-id="${CSS.escape(id)}"]`);
  if (!el) return; // hors viewport — ignoré (prochain virtRenderWindow le prendra)

  // B7 FIX : invalider les caches album/artiste APRÈS l'early-return. Avant, un
  // gros batch loadTagsBg (pistes hors-viewport) vidait les caches à chaque piste
  // → reconstruction O(n) répétée (comportement O(n²) sur un gros import).
  // Reste correct : un import change tracks.length → _computeTracksSig change →
  // renderLib() reconstruit les maps album/artiste de toute façon.
  _tracksSig = '';
  resetGridCaches(); // invalide _albumMapCache, _artistMapCache, _artTrackById (renderer-grids.js)

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

  // A11Y-16 : préserver aria-setsize (taille de la liste filtrée) et le roving
  // tabstop du nœud remplacé — sinon la ligne re-rendue annonce aria-setsize="0"
  // et perd son tabindex="0".
  const isTabStop = el.getAttribute('tabindex') === '0';
  el.insertAdjacentHTML('beforebegin',
    thtml(t, fi, { active: isActive, liked: liked?.has(t.id) ?? false, query, setSize: getFiltered().length, isTabStop }));
  el.remove();
}

// REWORK-5 (2026-07-02) : machinerie du footer stats et des pilules de
// compteurs nav supprimée — ces éléments n'existent plus
// (métriques dans la vue Statistiques, état de surveillance dans Paramètres).

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

const _SRC_LABELS = {
  'drag-drop':    'Glisser-déposer',
  'folder-scan':  'Scan dossier',
  'usb':          'USB',
  'manual':       'Manuel',
};

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
