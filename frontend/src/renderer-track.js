// renderer-track.js — Templates de ligne de piste + patches DOM ciblés
// Extrait de renderer.js.

import { esc, fmtd, extEmoji }                               from './utils.js';
import { i18n }                                              from './i18n.js';
import { get }                                               from './store.js';
import { getArtUrl }                                         from './artLoader.js';
import { getFiltered, filteredIdx, trackIdx }                from './search.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _activeRowEl = null;   // cache du dernier élément .tr.act

// Regex de validation pour artColor (copie locale — utilisée par artPlaceholder)
const ART_COLOR_RE = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

// ── Helpers privés ────────────────────────────────────────────────────────────

function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

// ── Fonctions exportées ───────────────────────────────────────────────────────

export function hlText(text) {
  return text ? esc(text) : '';
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

// ── thtml — génère le HTML d'une ligne piste ─────────────────────────────────
// A11Y-3 : role="listitem" tabindex="0" aria-label
// P6     : classes dynamiques

/**
 * Génère le HTML d'une ligne piste pour le virtual scroll.
 * @param {Track}  t       - Piste
 * @param {number} fi      - Index dans la liste filtrée courante
 * @param {object} [opts]  - { active, liked, query, isAlbumDetail, isTabStop }
 *   isAlbumDetail — M-1: pré-calculé par l'appelant pour éviter get() dans la boucle
 *   isTabStop     — A11Y-ROVING: true → tabindex="0", false/undefined → tabindex="-1"
 */
export function thtml(t, fi, { active = false, liked = false, likedSet, query = '', isAlbumDetail: _isAlbumDetail, albumDetailSort: _albumDetailSort, isTabStop = false, setSize = 0 } = {}) {
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
    <button class="tart-hover-play" data-action="play-track" data-track-id="${esc(t.id)}" tabindex="-1" aria-label="${esc(i18n('play') || 'Lire')}">
      <svg class="icon-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
      <svg class="icon-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
    </button>
  </div>
  <div class="ti">
    <div class="tn" title="${esc(t.name || '')}">${hlText(t.name || '')}</div>
    <div class="ts" title="${esc(t.artistFull || t.artist || '')}">${hlText(t.artistFull || t.artist || '')}</div>
  </div>
  <div class="ta" title="${esc(t.album || '')}">${esc(t.album || '')}</div>
  <div class="tr-r">
    <span class="tdur">${fmtd(t.duration)}</span>
    ${makeLikeBtn(t, likedSet)}
    ${makeAddBtn(t)}
  </div>
</div>`;
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

/** Met à jour la classe .playing-row sur la piste active (play vs pause). */
export function patchPlayState(playing) {
  const tlist = document.getElementById('tlist');
  const qlist = document.getElementById('queue-list');
  if (tlist) tlist.querySelectorAll('.tr.act').forEach(el => el.classList.toggle('playing-row', playing));
  if (qlist) qlist.querySelectorAll('.queue-item--loop').forEach(el => el.classList.toggle('playing-row', playing));
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

  const fi    = filteredIdx(t); // recalcul frais — évite un dataset stale
  if (fi < 0) { el?.remove(); return; }
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
