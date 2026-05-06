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

/** @type {Record<string, any>} */
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
  manualQueue:       [],        // Track[] — explicit queue (played before shuffle/order)

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
};

/** @type {Map<string, Set<Function>>} */
const _subs = new Map();

function _notify(key, val) {
  const set = _subs.get(key);
  if (!set) return;
  for (const cb of set) {
    try { cb(val); } catch (e) { console.error('[store] subscriber error', key, e); queueMicrotask(() => { throw e; }); }
  }
}

/**
 * Read a state value synchronously.
 * @param {string} key
 * @returns {any}
 */
export function get(key) {
  return _state[key];
}

/**
 * Write a state value and notify subscribers.
 * Skips notification if the value is strictly equal to the current one.
 * @param {string} key
 * @param {any} val
 */
export function set(key, val) {
  if (_state[key] === val) return;
  _state[key] = val;
  _notify(key, val);
}

/**
 * Subscribe to changes on a specific key.
 * The callback is called with the new value every time set() is called for that key.
 * @param {string} key
 * @param {Function} cb
 * @returns {Function} Unsubscribe function
 */
export function subscribe(key, cb) {
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key).add(cb);
  return () => _subs.get(key)?.delete(cb);
}

/**
 * Batch update multiple keys without triggering intermediate notifications.
 * All subscribers are notified once per key after the batch.
 * @param {Record<string, any>} updates
 */
export function setBatch(updates) {
  for (const [key, val] of Object.entries(updates)) {
    _state[key] = val;
    _notify(key, val);
  }
}
