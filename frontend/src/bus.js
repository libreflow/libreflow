// @ts-check
/**
 * bus.js — Typed EventBus (zero deps)
 *
 * Usage:
 *   import { emit, on, EVENTS } from './bus.js';
 *   const off = on(EVENTS.TRACK_CHANGE, ({ track }) => console.log(track));
 *   emit(EVENTS.TRACK_CHANGE, { track: t });
 *   off(); // unsubscribe
 */

/** @import { EventPayloadMap } from './types.js' */

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map(); // event → Set<fn>

/**
 * Emit an event with an optional payload.
 * @template {keyof EventPayloadMap} K
 * @param {K} event
 * @param {EventPayloadMap[K]} payload
 * @returns {void}
 */
export function emit(event, payload) {
  const set = _listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { console.error('[bus] handler error', event, e); queueMicrotask(() => { throw e; }); }
  }
}

/**
 * Subscribe to an event.
 * @template {keyof EventPayloadMap} K
 * @param {K} event
 * @param {(payload: EventPayloadMap[K]) => void} fn
 * @returns {Function} off — call to unsubscribe
 */
export function on(event, fn) {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event).add(fn);
  return () => _listeners.get(event)?.delete(fn);
}

/** Typed event constants — prevents typos in event names. */
export const EVENTS = Object.freeze({
  // Player
  TRACK_CHANGE:     'track:change',       // { track, idx }
  PLAY_STATE:       'player:state',       // { playing }
  SEEK:             'player:seek',        // { time, ratio }
  VOLUME_CHANGE:    'player:volume',      // { volume }
  // Library
  LIBRARY_UPDATED:  'library:updated',   // { tracks }
  TAGS_READY:       'library:tags',      // { track }
  // Search / filter
  FILTER_CHANGED:   'search:filtered',   // { list }
  // Playlists
  PLAYLIST_CHANGED: 'playlist:changed',  // { playlists }
  // UI
  VIEW_CHANGE:      'ui:view',           // { view }
  THEME_CHANGE:     'ui:theme',          // { theme }
  RENDER_LIB:       'ui:render_lib',     // {} — demande un renderLib() à app.js
});
