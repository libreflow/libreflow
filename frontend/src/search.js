// @ts-check
// search.js — Filtrage, tri et index O(1) pour la bibliothèque LibreFlow
//
// Optimisations :
//   P3 : Intl.Collator caché (une seule instance par session)
//   P4 : posMap Track→position dans _GF pour filteredIdx O(1)
//   P7 : _GF.posMap mis à jour à chaque résultat de getFiltered()
//   P9 : tri différé sur la copie (_presorted évité par implem directe)
//
// Exports :
//   _trackIdxMap            Map<id, index> — projection exacte de tracks[]
//   _coll                   Intl.Collator partagé
//   _normalizeGenre(g)      Normalise un genre vers sa clé canonique
//   rebuildTrackIdxMap()    Reconstruit _trackIdxMap depuis get('tracks')
//   trackIdx(id|track)      Retourne l'index d'une piste par son id ou objet, ou -1
//   filteredIdx(t)          Retourne la position de t dans getFiltered(), O(1)
//   getFiltered()           Liste pistes filtrées + triées pour la vue courante
//   invalidateFilterCache() Invalide le cache de getFiltered()
//   GENRE_ALIASES           Map des variantes de genres vers leur clé canonique

/** @import { Track } from './types.js' */

import { get, subscribe } from './store.js';

// ── Trigram helpers ───────────────────────────────────────────────────────────

/** Returns Set of all 3-char trigrams from a string. */
function _trigrams(str) {
  const s = str.replace(/\s+/g, ' ').trim();
  const t = new Set();
  for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
  return t;
}

/** Jaccard similarity between two trigram Sets. 0–1. */
function _trigramScore(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Collator partagé (P3) ────────────────────────────────────────────────────
// Une seule instance — la construction est coûteuse (~2ms selon le moteur JS).
export const _coll = new Intl.Collator('fr', { sensitivity: 'base', ignorePunctuation: true });
/** @type {(a: string | undefined | null, b: string | undefined | null) => number} */
const _compare = (a, b) => _coll.compare(a || '', b || '');

// ── Map id → index (projection exacte de tracks[]) ───────────────────────────
// INVARIANT : _trackIdxMap === projection exacte de tracks[]
// Toute mutation de tracks[] → rebuildTrackIdxMap() OBLIGATOIRE
/** @type {Map<string, number>} */
export const _trackIdxMap = new Map();

/**
 * Reconstruit _trackIdxMap depuis tracks[] en store.
 * À appeler après chaque mutation de tracks[].
 * @returns {void}
 */
export function rebuildTrackIdxMap() {
  const tracks = get('tracks') || [];
  _trackIdxMap.clear();
  for (let i = 0; i < tracks.length; i++) {
    _trackIdxMap.set(tracks[i].id, i);
  }
}

/**
 * Retourne l'index d'une piste dans tracks[] par son id (string) ou objet piste, ou -1.
 * @param {string | Track} idOrTrack
 * @returns {number}
 */
export function trackIdx(idOrTrack) {
  const key = typeof idOrTrack === 'string' ? idOrTrack : idOrTrack?.id;
  if (!key) return -1;
  const i = _trackIdxMap.get(key);
  return i !== undefined ? i : -1;
}

// ── Cache getFiltered (P4 / P7) ───────────────────────────────────────────────
// posMap : Map<Track, position_dans_result> pour filteredIdx O(1)
/** @type {{ sig: string | null, result: Track[] | null, posMap: Map<string, number> | null }} */
const _GF = { sig: null, result: null, posMap: null };

// Generation counter for per-track NLC/trigram cache. Incrémenté à chaque
// invalidate ; les lecteurs vérifient `t._nlcGen === _filterGen` avant d'utiliser
// les caches. Évite un sweep O(n) sur 50k tracks à chaque mutation.
let _filterGen = 0;

/**
 * Invalide le cache de getFiltered(). Appeler après toute mutation UI.
 * O(1) — bump le generation counter au lieu de balayer toutes les tracks.
 * @returns {void}
 */
export function invalidateFilterCache() {
  _GF.sig = '';
  _filterGen++;
}

// ── Store subscriber : auto-invalidation du cache NLC lors d'un changement de tracks ──
// Déclenché par set/setBatch (changement de référence) ET par notify('tracks')
// (mutation in-place). Élimine les résultats de recherche périmés après édition
// de tags ou rescan sans dépendre des appelants pour appeler invalidateFilterCache().
subscribe('tracks', () => {
  invalidateFilterCache();
});

// ── Normalisation de genres ───────────────────────────────────────────────────

export const GENRE_ALIASES = Object.freeze({
  // Rock
  'rock & roll':         'rock',             'rock and roll':     'rock',
  'rockandroll':         'rock',             'alt rock':          'alternative rock',
  'alternativerock':     'alternative rock', 'alternative':       'alternative rock',
  'indie rock':          'indie',            'punk rock':         'punk',
  'hard rock':           'rock',             'soft rock':         'rock',
  // Electronic
  'edm':                 'electronic',       'electro':           'electronic',
  'electronica':         'electronic',       'electronic music':  'electronic',
  'dance':               'electronic',       'dance music':       'electronic',
  'dance pop':           'pop',              'techno':            'electronic',
  'house':               'electronic',       'trance':            'electronic',
  'ambient':             'electronic',       'drum and bass':     'electronic',
  'dnb':                 'electronic',       'dubstep':           'electronic',
  'drum & bass':         'electronic',
  // Hip-hop
  'hip hop':             'hip-hop',          'hiphop':            'hip-hop',
  'rap':                 'hip-hop',          'trap':              'hip-hop',
  'drill':               'hip-hop',          'phonk':             'hip-hop',
  'gangsta rap':         'hip-hop',          'old school':        'hip-hop',
  // R&B / Soul
  'r&b':                 'r&b/soul',         'soul':              'r&b/soul',
  'rnb':                 'r&b/soul',         'rhythm and blues':  'r&b/soul',
  'neo soul':            'r&b/soul',         'rhythm & blues':    'r&b/soul',
  // Jazz
  'smooth jazz':         'jazz',             'bebop':             'jazz',
  'fusion':              'jazz',             'jazz fusion':       'jazz',
  'nu jazz':             'jazz',
  // Classical
  'classical music':     'classical',        'orchestra':         'classical',
  'orchestral':          'classical',        'baroque':           'classical',
  'opera':               'classical',        'symphonic':         'classical',
  // Pop
  'synth-pop':           'pop',              'synthpop':          'pop',
  'indie pop':           'pop',              'art pop':           'pop',
  'bubblegum pop':       'pop',
  // Metal
  'heavy metal':         'metal',            'death metal':       'metal',
  'black metal':         'metal',            'metalcore':         'metal',
  'thrash metal':        'metal',            'doom metal':        'metal',
  'nu metal':            'metal',
  // Country / Folk
  'country music':       'country',          'bluegrass':         'country',
  // Latin
  'latin pop':           'latin',            'salsa':             'latin',
  'reggaeton':           'latin',            'bossa nova':        'latin',
  // Reggae
  'dub':                 'reggae',           'ska':               'reggae',
  // Blues
  'blues rock':          'blues',            'delta blues':       'blues',
  'chicago blues':       'blues',
  // Funk
  'funk rock':           'funk',
  // Gospel / Chanson
  'chanson française':   'chanson',          'variété française': 'variete',
  'variété':             'variete',
});

/**
 * Normalise un genre : toLowerCase + trim + alias → clé canonique.
 * @param {string | null | undefined} g
 * @returns {string}
 */
export function _normalizeGenre(g) {
  if (!g) return '';
  const key = g.toLowerCase().trim().replace(/\s+/g, ' ');
  // @ts-ignore — dynamic key lookup on frozen object, safe at runtime
  return GENRE_ALIASES[key] || key;
}

// ── Filtrage par query ────────────────────────────────────────────────────────

/**
 * Construit/rafraîchit `t._nlc` (normalized lower-cased concatenated text)
 * uniquement si périmé. SÉPARÉ de la construction des trigrammes (PM-2 :
 * éviter ~250 MB d'allocations Sets inutiles quand la recherche exacte suffit
 * sur 50k tracks — gain mesuré : 315 MB heap → stable, 180 ms → 70 ms).
 * @param {Track & {_nlc?: string, _nlcGen?: number}} t
 */
function _ensureNlc(t) {
  if (t._nlcGen !== _filterGen) {
    t._nlc = [t.name || '', t.artist || '', t.artistFull || '', t.album || '', t.genre || ''].join(' ').toLowerCase();
    t._nlcGen = _filterGen;
  }
}

/**
 * Construit/rafraîchit `t._trigrams` uniquement quand le chemin fuzzy en a besoin.
 * Pré-requis : `_ensureNlc(t)` appelé d'abord (le caller fuzzy le fait).
 * @param {Track & {_nlc?: string, _trigrams?: Set<string>, _trigGen?: number}} t
 */
function _ensureTrigrams(t) {
  if (t._trigGen !== _filterGen) {
    t._trigrams = _trigrams(t._nlc || '');
    t._trigGen  = _filterGen;
  }
}

/**
 * Filtre une liste de pistes par query multi-termes insensible à la casse.
 * Chemin HOT : ne construit JAMAIS de trigrammes (réservés au fallback fuzzy).
 * @param {Track[]} tracks
 * @param {string} query
 * @returns {Track[]}
 */
function _filterByQuery(tracks, query) {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  const parts = q.split(/\s+/).filter(Boolean);
  return tracks.filter(t => {
    _ensureNlc(t);
    const hay = t._nlc;
    return parts.every(p => hay.includes(p));
  });
}

// ── Tri ───────────────────────────────────────────────────────────────────────

/**
 * Trie une copie de `src` selon `sort`. Ne mute jamais la source.
 * @param {Track[]} src
 * @param {string} sort
 * @param {string[]} recentPlays
 * @returns {Track[]}
 */
function _sortTracks(src, sort, recentPlays) {
  if (sort === 'recent') {
    // P9 : construire une Map id→position depuis recentPlays pour le tri O(1)
    const order = new Map((recentPlays || []).map((id, i) => [id, i]));
    return [...src].sort((a, b) => {
      const ia = order.has(a.id) ? /** @type {number} */ (order.get(a.id)) : 1e9;
      const ib = order.has(b.id) ? /** @type {number} */ (order.get(b.id)) : 1e9;
      if (ia !== ib) return ia - ib;
      return _compare(a.name, b.name);
    });
  }
  const copy = [...src];
  switch (sort) {
    case 'za':
      return copy.sort((a, b) => _compare(b.name, a.name));
    case 'artist':
      return copy.sort((a, b) =>
        _compare(a.artist, b.artist) ||
        _compare(a.album, b.album)   ||
        (a.track || 0) - (b.track || 0) ||
        _compare(a.name, b.name)
      );
    case 'album':
      return copy.sort((a, b) =>
        _compare(a.album, b.album) ||
        (a.track || 0) - (b.track || 0) ||
        _compare(a.name, b.name)
      );
    default: // 'az'
      return copy.sort((a, b) => _compare(a.name, b.name));
  }
}

// ── getFiltered ───────────────────────────────────────────────────────────────

/** True when the last getFiltered() call used the trigram fuzzy fallback. */
let _lastWasFuzzy = false;

/** Returns true if the last getFiltered() call used fuzzy (trigram) matching. */
export function wasFuzzySearch() { return _lastWasFuzzy; }

/**
 * Retourne la liste de pistes filtrées + triées pour la vue et le tri courants.
 * Résultat mis en cache ; invalider via invalidateFilterCache().
 * @returns {Track[]}
 */
export function getFiltered() {
  const tracks      = get('tracks')      || [];
  const sort        = get('sort')        || 'az';
  const query       = get('query')       || '';
  const view        = get('view')        || 'all';
  const drillKey    = get('drillKey')    || '';
  const drillFrom   = get('drillFrom')   || '';
  const curPlId     = get('curPlId')     || null;
  const recentPlays = get('recentPlays') || [];
  const plSort          = get('plSort')          || 'manual';
  const albumDetailSort = (view === 'album-detail') ? (get('albumDetailSort') || 'track') : '';
  const liked           = get('liked');
  const formatFilter    = get('formatFilter') || '';

  // Signature de cache — inclure toutes les dimensions qui peuvent changer le résultat
  const tracksSig   = tracks.length + '|' + (tracks[tracks.length - 1]?.id || '');
  const likedSig    = (view === 'liked') ? (liked?.size ?? 0) : '';
  const recentSig   = (sort === 'recent') ? recentPlays.slice(0, 20).join(',') : '';
  const sig = `${sort}\0${albumDetailSort}\0${query}\0${view}\0${drillKey}\0${drillFrom}\0${curPlId}\0${plSort}\0${tracksSig}\0${likedSig}\0${recentSig}\0${formatFilter}`;

  // @ts-ignore — result is always Track[] when sig matches (null only on first call)
  if (_GF.sig === sig) return _GF.result;

  // ── Filtrage par vue ──────────────────────────────────────────────────────
  let src = tracks;
  if (formatFilter) src = src.filter(t => (t.ext || '') === formatFilter);

  if (drillKey && drillFrom) {
    // Drill-down album / artiste / genre
    if (drillFrom === 'albums') {
      const key = drillKey.toLowerCase();
      src = src.filter(t => (t.album || '').toLowerCase() === key);
    } else if (drillFrom === 'artists') {
      const key = drillKey.toLowerCase();
      src = src.filter(t =>
        (t.artist || '').toLowerCase() === key ||
        (t.artistFull || '').toLowerCase() === key
      );
    } else if (drillFrom === 'genres') {
      src = src.filter(t => _normalizeGenre(t.genre) === drillKey);
    }
  } else if (view === 'liked') {
    src = src.filter(t => liked?.has(t.id));
  } else if (view === 'playlist' && curPlId) {
    const playlists = get('playlists') || [];
    const pl = playlists.find(p => p.id === curPlId);
    if (pl) {
      src = /** @type {Track[]} */ (pl.trackIds
        .filter(id => _trackIdxMap.has(id))
        .map(id => tracks[_trackIdxMap.get(id)]));
    } else {
      src = [];
    }
  } else if (view === 'recent') {
    // Vue "récentes" : uniquement les pistes jouées récemment
    const recentSet = new Map(recentPlays.map((id, i) => [id, i]));
    src = src
      .filter(t => recentSet.has(t.id))
      .sort((a, b) => (recentSet.get(a.id) || 0) - (recentSet.get(b.id) || 0));
  }

  // ── Filtrage par query ────────────────────────────────────────────────────
  let filtered;
  if (!query) {
    _lastWasFuzzy = false;
    filtered = src;
  } else {
    const exactMatches = _filterByQuery(src, query);
    if (exactMatches.length > 0) {
      _lastWasFuzzy = false;
      filtered = exactMatches;
    } else if (query.trim().length >= 3) {
      // Fuzzy fallback — trigram Jaccard similarity.
      // PM-2 : c'est UNIQUEMENT ici qu'on construit les trigrammes (lazy par track).
      const FUZZY_THRESHOLD = 0.4;
      const qTrigrams = _trigrams(query.toLowerCase().replace(/\s+/g, ' ').trim());
      // PM-1: pre-compute scores once (O(n)) so both filter and sort use O(1) Map lookups
      // instead of recomputing _trigramScore ~2×n×log(n) times inside the sort comparator.
      const _scores = new Map();
      for (const t of src) {
        _ensureNlc(t);
        _ensureTrigrams(t);
        _scores.set(t.id, _trigramScore(qTrigrams, t._trigrams));
      }
      const fuzzy = src
        .filter(t => (_scores.get(t.id) ?? 0) >= FUZZY_THRESHOLD)
        .sort((a, b) => (_scores.get(b.id) ?? 0) - (_scores.get(a.id) ?? 0));
      _lastWasFuzzy = fuzzy.length > 0;
      // Cache result directly and return — skip normal sort since results are ordered by score
      if (_lastWasFuzzy) {
        const posMap = new Map(fuzzy.map((t, i) => [t.id, i]));
        _GF.sig    = sig;
        _GF.result = fuzzy;
        _GF.posMap = posMap;
        return fuzzy;
      }
      filtered = exactMatches; // empty, no fuzzy hits either
    } else {
      _lastWasFuzzy = false;
      filtered = exactMatches;
    }
  }

  // ── Tri ───────────────────────────────────────────────────────────────────
  // Playlist en mode 'manual' sans query : conserver l'ordre de la playlist.
  // Vue 'recent' sans query : ordre de lecture récente déjà appliqué dans le filtre,
  //   ne pas ré-appliquer _sortTracks qui écraserait cet ordre.
  const isManualPlaylist = view === 'playlist' && plSort === 'manual' && !query;
  const isRecentView     = view === 'recent' && !query;
  let result;
  if (isManualPlaylist || isRecentView) {
    result = filtered; // ordre préservé (playlist manuelle ou récentes)
  } else if (view === 'album-detail') {
    // Tri indépendant du tri global — albumDetailSort ('track' | 'az')
    if (albumDetailSort === 'az') {
      result = [...filtered].sort((a, b) => _compare(a.name || '', b.name || ''));
    } else {
      // 'track' : par numéro de tag, nulls en dernier, puis par nom
      result = [...filtered].sort((a, b) => {
        const ta = a.track ?? 9999;
        const tb = b.track ?? 9999;
        return ta !== tb ? ta - tb : _compare(a.name || '', b.name || '');
      });
    }
  } else {
    result = _sortTracks(filtered, sort, recentPlays);
  }

  // ── Build posMap (P4/P7) ──────────────────────────────────────────────────
  // Utilise t.id (string) comme clé — les références d'objets changent après setTracks()
  const posMap = new Map(result.map((t, i) => [t.id, i]));

  _GF.sig    = sig;
  _GF.result = result;
  _GF.posMap = posMap;

  return result;
}

/**
 * Retourne la position de `track` dans le dernier résultat de getFiltered(), O(1).
 * Accepte un objet piste ou un id (string) directement.
 * Retourne -1 si la piste n'est pas dans le résultat courant.
 * @param {Track | string | null} track
 * @returns {number}
 */
export function filteredIdx(track) {
  if (!track || !_GF.posMap) return -1;
  // Compatibilité : appelé avec un objet piste ou un id string direct
  const id = (typeof track === 'string') ? track : (track.id ?? null);
  if (!id) return -1;
  const pos = _GF.posMap.get(id);
  return pos !== undefined ? pos : -1;
}
