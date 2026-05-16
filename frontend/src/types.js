// @ts-check
// types.js — JSDoc typedefs partagés. Aucune logique, zéro runtime impact.
// Importer via : /** @import { Track } from './types.js' */

/**
 * @typedef {Object} Track
 * @property {string}              id
 * @property {string}              path
 * @property {string}              name
 * @property {string}              artist
 * @property {string}              album
 * @property {number}              duration
 * @property {string}              [ext]
 * @property {number}              [track]
 * @property {string}              [genre]
 * @property {number | null}              [year]
 * @property {number}              [dateAdded]
 * @property {string}              [artistFull]
 * @property {string}              [url]
 * @property {File|null}           [file]
 * @property {boolean}             [metaDone]
 * @property {string|null}         [art]
 * @property {string|null}         [artColor]
 * @property {boolean}             [noArt]
 * @property {number}              [bitrate]
 * @property {number}              [sampleRate]
 * @property {number}              [channels]
 * @property {number}              [bitDepth]
 * @property {boolean}             [rgDone]
 * @property {number}              [rgGain]
 * @property {number}              [rgGainDB]
 * @property {number}              [rgPeak]
 * @property {ArrayBuffer|undefined} [_artBuf]
 * @property {string|undefined}    [_artMime]
 * @property {string|undefined}    [_b64]
 * @property {boolean|undefined}   [_durPending]
 * @property {string|undefined}    [_nlc]
 * @property {string|undefined}    [_artistKey]
 * @property {string|undefined}    [_albumKey]
 * @property {string|undefined}    [_alc]
 * @property {string|undefined}    [_ablc]
 * @property {string|undefined}    [_glc]
 * @property {string|undefined}    [_genreParts]
 */

/**
 * @typedef {Object} Playlist
 * @property {string}    id
 * @property {string}    name
 * @property {string[]}  trackIds
 * @property {string}    [folderId]
 * @property {number}    [created]
 * @property {boolean}                    [smart]
 * @property {boolean}                    [pinned]
 * @property {PlSortKey}                  [sort]
 * @property {string}                     [coverB64]
 * @property {Record<string, unknown>}    [criteria]
 * @property {string}                     [seedId]
 * @property {number}                     [createdAt]
 */

/**
 * @typedef {Object} PlaylogEntry
 * @property {string} id
 * @property {number} ts
 * @property {number} duration
 */

/**
 * @typedef {Object} ImportEntry
 * @property {string}   id
 * @property {number}   date
 * @property {'drag-drop'|'folder-scan'|'manual'|'usb'} source
 * @property {string[]} paths
 * @property {number}   count
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
 * @typedef {'all'|'albums'|'artists'|'genres'|'genre-detail'|'album-detail'|'artist-detail'|'playlists'|'stats'|'radio'|'playlist'|'recent'|'liked'} ViewMode
 * @typedef {'az'|'za'|'artist'|'album'|'duration'|'recent'} SortKey
 * @typedef {'dark'|'light'} DisplayMode
 * @typedef {'name'|'count'|'duration'} AlbumSortKey
 * @typedef {'manual'|'az'|'za'|'artist'|'album'|'duration'} PlSortKey
 */

export {};
