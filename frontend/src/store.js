// @ts-check
/**
 * store.js — Reactive state container (< 80 lines, zero deps)
 *
 * Usage:
 *   import { get, set, subscribe } from './store.js';
 *
 *   // Read
 *   const tracks = get('tracks');
 *
 *   // Write (notifies all subscribers)
 *   set('curIdx', 3);
 *
 *   // Subscribe (returns unsub function)
 *   const off = subscribe('curIdx', (newVal) => console.log('idx changed', newVal));
 *   off(); // unsubscribe
 *
 * All mutable application state lives here. Player internals (timers,
 * AudioNode refs, RAF handles) stay module-local in their respective files.
 */

/** @import { Track, Playlist, PlaylistFolder, RepeatMode, ViewMode, SortKey, DisplayMode, AlbumSortKey, PlSortKey } from './types.js' */

/**
 * @typedef {Object} AppState
 * @property {Track[]}          tracks
 * @property {Set<string>}      liked
 * @property {string[]}         recentPlays
 * @property {number}           curIdx
 * @property {boolean}          shuffle
 * @property {RepeatMode}       repeat
 * @property {number}           playbackSpeed
 * @property {number}           crossfadeDur
 * @property {number[]}         manualQueue
 * @property {ViewMode}         view
 * @property {SortKey}          sort
 * @property {string}           query
 * @property {string}           drillKey
 * @property {string}           drillFrom
 * @property {string}           drillDisplayName
 * @property {string}           theme
 * @property {boolean}          dynColor
 * @property {DisplayMode}      displayMode
 * @property {string|null}      currentArtColor
 * @property {AlbumSortKey}     albumSort
 * @property {'name'|'count'}   artistSort
 * @property {'count'|'name'}   genreSort
 * @property {'track'|'az'}     albumDetailSort
 * @property {Playlist[]}       playlists
 * @property {string|null}      curPlId
 * @property {PlaylistFolder[]} plFolders
 * @property {string[]}         recentPls
 * @property {PlSortKey}        plSort
 * @property {string|null}      ctxTrackId
 * @property {string}           formatFilter
 */

/** @type {AppState} */
const _state = {
  // ── Library ─────────────────────────────────────────────────────────
  tracks:            [],        // Track[] — full, unfiltered
  liked:             new Set(), // Set<string> — track IDs (migré session 138)
  recentPlays:       [],        // string[] — track IDs, most recent first (max 50)

  // ── Playback ─────────────────────────────────────────────────────────
  curIdx:            -1,        // number — current track index in tracks[]
  shuffle:           false,
  repeat:            'none',    // 'none' | 'all' | 'one'
  playbackSpeed:     1,
  crossfadeDur:      0,
  manualQueue:       [],        // number[] — explicit queue of track indices (played before shuffle/order)

  // ── UI / View ────────────────────────────────────────────────────────
  view:              'all',     // 'all' | 'albums' | 'artists' | 'genres' | 'playlists' | 'stats' | 'radio'
  sort:              'az',      // sort key from SORTS
  query:             '',
  drillKey:          '',
  drillFrom:         '',
  drillDisplayName:  '',
  theme:             'blue',
  dynColor:          true,
  displayMode:       'dark',    // 'dark' | 'light'
  currentArtColor:   null,      // string | null — extracted from current artwork
  albumSort:         'name',    // 'name' | 'count' | 'duration'
  artistSort:        'name',    // 'name' | 'count'
  genreSort:         'count',   // 'count' | 'name'
  albumDetailSort:   'track',   // 'track' | 'az'

  // ── Playlists ────────────────────────────────────────────────────────
  playlists:         [],        // Playlist[]
  curPlId:           null,      // string | null — currently viewed playlist id
  plFolders:         [],        // { id, name, collapsed, order }[]
  recentPls:         [],        // string[] — playlist IDs, most recent first (max 5)
  plSort:            'manual',  // 'manual' | 'az' | 'za' | 'artist' | 'album' | 'duration'

  // ── Misc ─────────────────────────────────────────────────────────────
  ctxTrackId:        null,      // string | null — track id for context menu
  formatFilter:      '',        // '' = tous, 'MP3'/'FLAC'/etc. = filtre actif
};

/** @type {Map<string, Set<Function>>} */
const _subs = new Map();

// Re-entrancy guard: tracks which keys are currently being notified to prevent
// a subscriber calling set() on the same key from causing nested notification mid-iteration.
const _notifying = new Set();

function _notify(key, val) {
  if (_notifying.has(key)) {
    // Re-entrant call: schedule for next microtask to avoid mid-iteration side effects.
    queueMicrotask(() => _notify(key, _state[key]));
    return;
  }
  const set = _subs.get(key);
  if (!set) return;
  // Snapshot avant itération : permet aux subscribers d'appeler subscribe()/unsubscribe()
  // sur la même clé pendant dispatch sans muter la Set en cours d'itération.
  const snapshot = [...set];
  _notifying.add(key);
  try {
    for (const cb of snapshot) {
      try { cb(val); } catch (e) { console.error('[store] subscriber error', key, e); queueMicrotask(() => { throw e; }); }
    }
  } finally {
    _notifying.delete(key);
  }
}

/**
 * @template {keyof AppState} K
 * @param {K} key
 * @returns {AppState[K]}
 */
export function get(key) {
  return _state[key];
}

/**
 * @template {keyof AppState} K
 * @param {K} key
 * @param {AppState[K]} val
 */
export function set(key, val) {
  if (_state[key] === val) return;
  _state[key] = val;
  _notify(key, val);
}

/**
 * @template {keyof AppState} K
 * @param {K} key
 * @param {(val: AppState[K]) => void} cb
 * @returns {() => void}
 */
export function subscribe(key, cb) {
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key).add(cb);
  return () => _subs.get(key)?.delete(cb);
}

/**
 * @param {Partial<AppState>} updates
 */
export function setBatch(updates) {
  const toNotify = [];
  for (const [key, val] of Object.entries(updates)) {
    if (_state[key] === val) continue;
    _state[key] = val;
    toNotify.push(key);
  }
  for (const key of toNotify) _notify(key, _state[key]);
}

/**
 * Force-notify subscribers for a key even if the value reference hasn't changed.
 * Use when mutating an object/array in-place (e.g. tracks.splice()).
 * @param {keyof AppState} key
 * @returns {void}
 */
export function notify(key) { _notify(key, _state[key]); }
