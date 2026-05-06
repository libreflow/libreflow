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
//   trackIdx(id)            Retourne l'index d'une piste par son id, ou -1
//   filteredIdx(t)          Retourne la position de t dans getFiltered(), O(1)
//   getFiltered()           Liste pistes filtrées + triées pour la vue courante
//   invalidateFilterCache() Invalide le cache de getFiltered()
//   GENRE_ALIASES           Map des variantes de genres vers leur clé canonique

import { get } from './store.js';

// ── Collator partagé (P3) ────────────────────────────────────────────────────
// Une seule instance — la construction est coûteuse (~2ms selon le moteur JS).
export const _coll = new Intl.Collator('fr', { sensitivity: 'base', ignorePunctuation: true });
const _compare = (a, b) => _coll.compare(a || '', b || '');

// ── Map id → index (projection exacte de tracks[]) ───────────────────────────
// INVARIANT : _trackIdxMap === projection exacte de tracks[]
// Toute mutation de tracks[] → rebuildTrackIdxMap() OBLIGATOIRE
export const _trackIdxMap = new Map();

/** Reconstruit _trackIdxMap depuis tracks[] en store.
 *  À appeler après chaque mutation de tracks[]. */
export function rebuildTrackIdxMap() {
  const tracks = get('tracks') || [];
  _trackIdxMap.clear();
  for (let i = 0; i < tracks.length; i++) {
    _trackIdxMap.set(tracks[i].id, i);
  }
}

/** Retourne l'index d'une piste dans tracks[] par son id, ou -1. */
export function trackIdx(id) {
  const i = _trackIdxMap.get(id);
  return i !== undefined ? i : -1;
}

// ── Cache getFiltered (P4 / P7) ───────────────────────────────────────────────
// posMap : Map<Track, position_dans_result> pour filteredIdx O(1)
const _GF = { sig: null, result: null, posMap: null };

/** Invalide le cache de getFiltered(). Appeler après toute mutation UI. */
export function invalidateFilterCache() {
  _GF.sig = null;
}

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

/** Normalise un genre : toLowerCase + trim + alias → clé canonique. */
export function _normalizeGenre(g) {
  if (!g) return '';
  const key = g.toLowerCase().trim().replace(/\s+/g, ' ');
  return GENRE_ALIASES[key] || key;
}

// ── Filtrage par query ────────────────────────────────────────────────────────

/** Filtre une liste de pistes par query multi-termes insensible à la casse. */
function _filterByQuery(tracks, query) {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  const parts = q.split(/\s+/).filter(Boolean);
  return tracks.filter(t => {
    const hay = [
      t.name || '', t.artist || '', t.artistFull || '',
      t.album || '', t.genre || '',
    ].join(' ').toLowerCase();
    return parts.every(p => hay.includes(p));
  });
}

// ── Tri ───────────────────────────────────────────────────────────────────────

/** Trie une copie de `src` selon `sort`. Ne mute jamais la source. */
function _sortTracks(src, sort, recentPlays) {
  if (sort === 'recent') {
    // P9 : construire une Map id→position depuis recentPlays pour le tri O(1)
    const order = new Map((recentPlays || []).map((id, i) => [id, i]));
    return [...src].sort((a, b) => {
      const ia = order.has(a.id) ? order.get(a.id) : 1e9;
      const ib = order.has(b.id) ? order.get(b.id) : 1e9;
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

/** Retourne la liste de pistes filtrées + triées pour la vue et le tri courants.
 *  Résultat mis en cache ; invalider via invalidateFilterCache(). */
export function getFiltered() {
  const tracks      = get('tracks')      || [];
  const sort        = get('sort')        || 'az';
  const query       = get('query')       || '';
  const view        = get('view')        || 'all';
  const drillKey    = get('drillKey')    || '';
  const drillFrom   = get('drillFrom')   || '';
  const curPlId     = get('curPlId')     || null;
  const recentPlays = get('recentPlays') || [];
  const plSort      = get('plSort')      || 'manual';
  const liked       = get('liked');

  // Signature de cache — inclure toutes les dimensions qui peuvent changer le résultat
  const tracksSig   = tracks.length + '|' + (tracks[tracks.length - 1]?.id || '');
  const likedSig    = (view === 'liked') ? (liked?.size ?? 0) : '';
  const recentSig   = (sort === 'recent') ? recentPlays.slice(0, 20).join(',') : '';
  const sig = `${sort}|${query}|${view}|${drillKey}|${drillFrom}|${curPlId}|${plSort}|${tracksSig}|${likedSig}|${recentSig}`;

  if (_GF.sig === sig) return _GF.result;

  // ── Filtrage par vue ──────────────────────────────────────────────────────
  let src = tracks;

  if (drillKey && drillFrom) {
    // Drill-down album / artiste / genre
    if (drillFrom === 'albums') {
      const key = drillKey.toLowerCase();
      src = tracks.filter(t => (t.album || '').toLowerCase() === key);
    } else if (drillFrom === 'artists') {
      const key = drillKey.toLowerCase();
      src = tracks.filter(t =>
        (t.artist || '').toLowerCase() === key ||
        (t.artistFull || '').toLowerCase() === key
      );
    } else if (drillFrom === 'genres') {
      src = tracks.filter(t => _normalizeGenre(t.genre) === drillKey);
    }
  } else if (view === 'liked') {
    src = tracks.filter(t => liked?.has(t.id));
  } else if (view === 'playlist' && curPlId) {
    const playlists = get('playlists') || [];
    const pl = playlists.find(p => p.id === curPlId);
    if (pl) {
      const byId = new Map(tracks.map(t => [t.id, t]));
      src = pl.trackIds.filter(id => byId.has(id)).map(id => byId.get(id));
    } else {
      src = [];
    }
  } else if (view === 'recent') {
    // Vue "récentes" : uniquement les pistes jouées récemment
    const recentSet = new Map(recentPlays.map((id, i) => [id, i]));
    src = tracks
      .filter(t => recentSet.has(t.id))
      .sort((a, b) => (recentSet.get(a.id) || 0) - (recentSet.get(b.id) || 0));
  }

  // ── Filtrage par query ────────────────────────────────────────────────────
  let filtered = query ? _filterByQuery(src, query) : src;

  // ── Tri ───────────────────────────────────────────────────────────────────
  // Playlist en mode 'manual' sans query : conserver l'ordre de la playlist
  const isManualPlaylist = (view === 'playlist' || (drillFrom === '' && curPlId))
    && plSort === 'manual' && !query;
  let result;
  if (isManualPlaylist) {
    result = filtered; // ordre de la playlist préservé
  } else {
    result = _sortTracks(filtered, sort, recentPlays);
  }

  // ── Build posMap (P4/P7) ──────────────────────────────────────────────────
  const posMap = new Map(result.map((t, i) => [t, i]));

  _GF.sig    = sig;
  _GF.result = result;
  _GF.posMap = posMap;

  return result;
}

/** Retourne la position de `track` dans le dernier résultat de getFiltered(), O(1).
 *  Retourne -1 si la piste n'est pas dans le résultat courant. */
export function filteredIdx(track) {
  if (!track || !_GF.posMap) return -1;
  const pos = _GF.posMap.get(track);
  return pos !== undefined ? pos : -1;
}
