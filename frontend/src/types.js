// @ts-check
// types.js — JSDoc typedefs partagés. Aucune logique, zéro runtime impact.
// Importer via : /** @import { Track } from './types.js' */

/**
 * @typedef {Object} Track
 * @property {string}  id
 * @property {string}  path
 * @property {string}  name
 * @property {string}  artist
 * @property {string}  album
 * @property {number}  duration
 * @property {number}  [track]
 * @property {string}  [genre]
 * @property {number}  [year]
 * @property {string}  [artistFull]
 * @property {string}  [cover]
 * @property {boolean} [rgDone]
 * @property {number}  [rgGain]
 * @property {number}  [rgPeak]
 */

/**
 * @typedef {Object} Playlist
 * @property {string}   id
 * @property {string}   name
 * @property {string[]} trackIds
 * @property {string}   [folderId]
 * @property {number}   [created]
 */

/**
 * @typedef {Object} PlaylogEntry
 * @property {string} id
 * @property {number} ts
 * @property {number} duration
 */

/**
 * @typedef {Object} PlaylistFolder
 * @property {string}  id
 * @property {string}  name
 * @property {boolean} collapsed
 * @property {number}  order
 */

/**
 * @typedef {'none'|'all'|'one'} RepeatMode
 * @typedef {'all'|'albums'|'artists'|'genres'|'playlists'|'stats'|'radio'|'playlist'|'recent'|'liked'} ViewMode
 * @typedef {'az'|'za'|'artist'|'album'|'duration'|'recent'} SortKey
 * @typedef {'dark'|'light'} DisplayMode
 * @typedef {'name'|'count'|'duration'} AlbumSortKey
 * @typedef {'manual'|'az'|'za'|'artist'|'album'|'duration'} PlSortKey
 */

export {};
