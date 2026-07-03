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
  // UI
  VIEW_CHANGE:      'ui:view',           // { view }
  THEME_CHANGE:     'ui:theme',          // { theme }
  RENDER_LIB:       'ui:render_lib',     // {} — demande un renderLib() à app.js
  // Panel coordination (évite les cycles d'import entre panneaux)
  PANEL_CLOSE_QUEUE:    'panel:close_queue',    // {}
  PANEL_CLOSE_SETTINGS: 'panel:close_settings', // {}
  VIEW_REQUEST:         'ui:view_request',       // { view: string, btn: Element|null, plId?: string }
  // i18n
  LANG_CHANGED:         'i18n:lang_changed',     // {}
  // Library
  TRACK_SAVE_REQUEST:   'library:save_request',  // { track }
  // Settings / theme
  THEME_APPLY_REQUEST:  'theme:apply_request',     // {}
  // Player bar
  VOL_SLIDER_UPDATE:    'player:vol_slider_update', // { elId: string }
  // Context menu
  CTX_MENU_CLOSE:       'ui:ctx_menu_close',        // {}
  // Selection
  SELECTION_CLEAR:      'selection:clear',           // {}
  // Stats navigation
  STATS_DRILL_GENRE:    'nav:stats_genre',           // { key, displayName }
  STATS_DRILL_ARTIST:   'nav:stats_artist',          // { displayName }
  // Search
  SEARCH_DEBOUNCE_CANCEL: 'search:debounce_cancel',  // {}
  // Cinema
  CINEMA_RADIO_TOGGLE:  'cinema:radio_toggle',       // {}
  // Smart playlist
  SMART_PLAYLIST_SWITCH_TAB: 'smartplaylist:switch_tab', // { tab: string }
  // Player bar update (from artLoader)
  PLAYERBAR_UPDATE:           'player:bar_update',         // {}
  // Sleep
  SLEEP_CROSSFADE_STOP:       'sleep:crossfade_stop',      // {}
  // Motion (Task 10) — settings.js → app.js (évite settings.js → cinema.js direct)
  MOTION_PREF_CHANGED:        'motion:pref_changed',       // { pref: 'system'|'full'|'reduce' }
});
