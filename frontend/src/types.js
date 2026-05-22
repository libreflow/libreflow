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

/**
 * Schéma de la configuration applicative persistée en IndexedDB (store 'cfg', key 'state').
 * Tous les champs sont optionnels pour la robustesse au boot (IDB peut être vide ou partiel).
 *
 * @typedef {Object} CfgShape
 * @property {string}              [view]             — vue active ('all', 'albums', …)
 * @property {string}              [sort]             — tri courant ('az', 'za', 'artist', …)
 * @property {string}              [query]            — terme de recherche courant
 * @property {number}              [volume]           — volume (0–1)
 * @property {number}              [playbackSpeed]    — vitesse de lecture (0.5, 0.75, 1, 1.25, 1.5, 2)
 * @property {number}              [crossfadeDur]     — durée crossfade en secondes
 * @property {string}              [theme]            — thème couleur ('blue', 'green', …)
 * @property {boolean}             [dynColor]         — couleur dynamique activée
 * @property {string}              [displayMode]      — 'dark' | 'light'
 * @property {string}              [mode]             — mode d'affichage UI
 * @property {string}              [lang]             — langue ('fr', 'en', …)
 * @property {string[]}            [likedIds]         — IDs des pistes likées (source de vérité)
 * @property {string[]}            [recentPlays]      — IDs des pistes jouées récemment
 * @property {string}              [curPlId]          — ID de la playlist courante
 * @property {string[]}            [recentPls]        — IDs des playlists récentes (max 5)
 * @property {string}              [plSort]           — tri playlist courant
 * @property {PlaylistFolder[]}    [plFolders]        — dossiers de playlists
 * @property {string}              [drillKey]         — clé de drill-down courant
 * @property {string}              [drillFrom]        — vue source du drill-down
 * @property {string}              [drillDisplayName] — nom affiché du drill-down
 * @property {string}              [albumSort]        — tri albums ('name', 'count', 'duration', 'year')
 * @property {string}              [artistSort]       — tri artistes ('name', 'count')
 * @property {string}              [genreSort]        — tri genres ('count', 'name')
 * @property {string}              [albumDetailSort]  — tri détail album ('track', 'az')
 * @property {string}              [formatFilter]     — filtre format actif (ex: 'flac', 'mp3', '')
 * @property {ZoomLevel}           [tlistZoom]        — niveau de zoom de la liste de pistes
 * @property {boolean}             [cdCopyrightAck]   — accord copyright CD accepté
 * @property {boolean}             [autoUpdate]       — mises à jour automatiques activées
 * @property {string}              [lastSettingsTab]  — dernier onglet Settings visité
 * @property {string}              [npBg]             — fond Now Playing ('blur', 'art', …)
 * @property {string}              [cinemaBg]         — fond Cinema ('ambient', 'amoled', …)
 * @property {string}              [watchPath]        — chemin du dossier surveillé
 * @property {number[]|null}       [eqGains]          — gains EQ par bande (dB)
 * @property {boolean}             [eqEnabled]        — EQ activé
 * @property {string}              [eqPreset]         — preset EQ actif
 * @property {boolean}             [eqAutoMode]       — mode auto EQ activé
 * @property {boolean}             [eqExpert]         — mode expert EQ activé
 * @property {Record<string, unknown>} [eqProfiles]   — profils EQ sauvegardés
 * @property {Record<string, unknown>} [eqDeviceProfiles] — profils EQ par device audio
 * @property {boolean}             [vizEnabled]       — visualiseur activé
 * @property {string}              [vizMode]          — mode visualiseur ('bars', 'oscilloscope', 'circle')
 * @property {string}              [vizColor]         — couleur visualiseur
 * @property {boolean}             [rgEnabled]        — ReplayGain activé
 * @property {number}              [rgTargetLUFS]     — cible ReplayGain en LUFS
 * @property {string}              [radioSeedId]      — ID piste seed radio
 * @property {boolean}             [radioActive]      — radio en cours
 * @property {number}              [heatPeriod]       — période heatmap en jours
 * @property {{ x: number, y: number } | null} [miniPos]   — position mini-player
 * @property {{ x: number, y: number } | null} [miniOvPos] — position mini-overlay flottant
 * @property {boolean}             [miniOvOpen]       — mini-overlay était ouvert
 * @property {number}              [scrollTop]        — position de scroll de #tlist
 * @property {string}              [curTrackId]       — ID de la piste courante
 * @property {number}              [curPos]           — position de lecture en secondes
 * @property {RepeatMode}          [repeat]           — mode répétition
 * @property {boolean}             [shuffle]          — lecture aléatoire activée
 * @property {{ ids: string[] }}   [queueState]       — état de la file d'attente
 */

/**
 * Discriminated union pour les lignes du virtual scroll.
 * - type 'tr'  : une piste de la liste filtrée
 * - type 'grp' : un en-tête de groupe (lettre, artiste ou album)
 *
 * @typedef {{ type: 'tr', track: Track, fi: number } | { type: 'grp', key: string, artistHint?: string }} VirtRow
 */

/**
 * Niveaux de zoom de la liste de pistes.
 * Correspond aux valeurs de TLIST_ZOOM_LEVELS dans tlistZoom.js.
 *
 * @typedef {'compact'|'normal'|'comfortable'} ZoomLevel
 */

/**
 * Table des payloads par événement du bus.
 * Les clés correspondent aux VALEURS des constantes EVENTS (strings).
 *
 * @typedef {Object} EventPayloadMap
 * @property {{ track: Track, idx: number }} 'track:change'
 * @property {{ playing: boolean }} 'player:state'
 * @property {{ time: number, ratio: number }} 'player:seek'
 * @property {{ volume: number }} 'player:volume'
 * @property {{ tracks: Track[] }} 'library:updated'
 * @property {{ track: Track }} 'library:tags'
 * @property {{ list: Track[] }} 'search:filtered'
 * @property {{ playlists: Playlist[] }} 'playlist:changed'
 * @property {{ view: string }} 'ui:view'
 * @property {{ theme: string }} 'ui:theme'
 * @property {{}} 'ui:render_lib'
 */

// ── ActionKey — union des data-action strings du registre handlers.js ──────────

/** Actions de transport / lecture */
/** @typedef {'toggle-play'|'prev'|'next'|'toggle-shuffle'|'toggle-repeat'|'toggle-like'|'cycle-speed'} TransportAction */

/** Actions mini-player / now-playing */
/** @typedef {'toggle-mini-player'|'toggle-mini-overlay'|'toggle-now-playing'|'close-now-playing'|'toggle-np-full'|'cycle-np-bg'|'np-drill-album'|'np-drill-artist'} NpAction */

/** Actions drill / header */
/** @typedef {'dh-play-all'|'dh-shuffle-all'|'dh-drill-album'|'dh-drill-artist'} DrillHeaderAction */

/** Actions file d'attente */
/** @typedef {'toggle-queue'|'close-queue'|'clear-queue'|'remove-from-queue'} QueueAction */

/** Actions EQ */
/** @typedef {'toggle-eq'|'close-eq'|'eq-preset'|'eq-mode'|'filter-eq-presets'|'save-device-eq'|'delete-device-eq'} EQAction */

/** Actions sleep timer */
/** @typedef {'toggle-sleep'|'sleep-timer'|'sleep-end-track'|'sleep-custom'|'cancel-sleep'} SleepAction */

/** Actions cinéma */
/** @typedef {'toggle-cinema'|'close-cinema'|'cinema-fullscreen'|'cycle-cinema-bg'|'toggle-cinema-radio'} CinemaAction */

/** Actions radio */
/** @typedef {'open-radio'|'ctx-start-radio'|'ctx-write-rg'|'radio-save-pl'|'radio-regen'|'radio-stop'|'play-radio-track'|'remove-radio-track'} RadioAction */

/** Actions sélection / batch */
/** @typedef {'clear-selection'|'sel-add-playlist'|'sel-toggle-like'|'sel-batch-tag-edit'|'sel-remove'|'sel-add-batch'|'bte-cover-click'|'bte-cover-clear'|'close-batch-tag-modal'|'confirm-batch-tag-edit'} SelectionAction */

/** Actions menu contextuel */
/** @typedef {'ctx-toggle-like'|'ctx-delete'|'ctx-edit-tags'|'ctx-go-artist'|'ctx-go-album'|'ctx-new-playlist'|'ctx-remove-pl'|'ctx-smart-playlist'|'ctx-play-next'|'ctx-add-queue-end'|'ctx-copy-info'|'add-track-to-pl'} CtxMenuAction */

/** Actions doublons */
/** @typedef {'close-dupes'|'detect-dupes'|'delete-all-dupes'|'remove-dupe-track'} DupesAction */

/** Actions bibliothèque / import */
/** @typedef {'open-folder'|'import-m3u'|'export-m3u'|'export-xspf'|'change-watch-folder'} LibraryAction */

/** Actions Settings (combos) */
/** @typedef {'settings-open-folder'|'settings-import-m3u'|'settings-export-m3u'|'settings-export-xspf'|'settings-rescan-genres'|'settings-detect-dupes'|'settings-confirm-clear'|'settings-clear-cache'} SettingsAction */

/** Actions visualiseur */
/** @typedef {'viz-bars'|'viz-oscilloscope'|'viz-circle'|'viz-toggle'} VizAction */

/** Actions fenêtre */
/** @typedef {'win-minimize'|'win-maximize'|'win-close'} WindowAction */

/** Actions apparence / langue */
/** @typedef {'set-lang'|'set-mode'|'set-cinema-bg'|'set-theme'|'set-tab'} AppearanceAction */

/** Actions playlists */
/** @typedef {'close-pl-modal'|'clear-pl-cover'|'pl-cover-click'|'confirm-playlist'|'smart-preview'|'confirm-smart-pl'|'spl-add-rule'|'spl-mode'|'new-playlist'|'rename-pl'|'delete-pl'|'toggle-pin-pl'|'toggle-pl-folder'|'show-pl-ctx'|'show-cur-pl-menu'|'show-pl-qpop'|'pqp-add'|'pqp-new'|'pqp-smart'|'ctx-play-pl'|'ctx-shuffle-pl'|'move-pl-folder'|'remove-pl-folder'|'rename-pl-folder'|'delete-pl-folder'|'play-pl-from'|'shuffle-cur-pl'|'play-pl-direct'|'regen-cur-pl'|'rename-cur-pl'|'delete-cur-pl'|'set-smart-seed'|'pl-tab'} PlaylistAction */

/** Actions tracks / tags */
/** @typedef {'play-track'|'track-click'|'open-tag-editor'|'save-tag-edit'|'cancel-tag-edit'|'likeat'|'play-queue-item'} TrackAction */

/** Actions navigation / divers */
/** @typedef {'drill-genre'|'drill-album'|'drill-artist'|'rescan-genres'|'bc-navigate'|'heat-period'|'scroll-to-current'|'clear-search'|'clear-filters'|'open-settings'|'close-settings'|'toggle-mode'|'go-home'|'toggle-shortcuts'|'close-shortcuts'|'set-view'|'next-sort'|'next-album-sort'|'filter-format'|'close-modal'|'clear-library'|'confirm-resolve-yes'|'confirm-resolve-no'|'play-card'} NavAction */

/** Actions organize / backup / USB / CD */
/** @typedef {'organize-trigger'|'organize-confirm'|'organize-cancel'|'backup-export'|'backup-import'|'usb-open-modal'|'usb-scan'|'usb-cancel'|'usb-refresh'|'cd-play'|'cd-extract'|'cd-cancel-modal'|'cd-cancel-rip'|'bte-cover-file-click'} PeriphAction */

/**
 * Union de toutes les data-action strings reconnues par handlers.js (_ACTIONS).
 * @typedef {TransportAction|NpAction|DrillHeaderAction|QueueAction|EQAction|SleepAction|CinemaAction|RadioAction|SelectionAction|CtxMenuAction|DupesAction|LibraryAction|SettingsAction|VizAction|WindowAction|AppearanceAction|PlaylistAction|TrackAction|NavAction|PeriphAction} ActionKey
 */

export {};
