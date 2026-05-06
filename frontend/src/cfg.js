// cfg.js — Constantes globales LibreFlow
// Source unique de vérité pour toutes les magic numbers.
// Ne rien importer ici (pas de dépendances circulaires possibles).

export const CFG = Object.freeze({
  IDB_TIMEOUT_DEFAULT:    8000,   // ms — timeout par défaut pour les opérations IDB
  IDB_TIMEOUT_DALL:      30000,   // ms — timeout pour dall() (lecture lib complète)
  TRACK_SAVE_DEBOUNCE:     250,   // ms — debounce sur saveTrack()
  CFG_SAVE_DEBOUNCE:       800,   // ms — debounce sur saveCfg()
  SEARCH_DEBOUNCE:         150,   // ms — debounce sur la barre de recherche
  PLAYLOG_FLUSH_DELAY:    3000,   // ms — délai avant flush du play log vers IDB
  STATS_UPDATE_DELAY:     1500,   // ms — délai debounce pour updateStats()
  RADIO_QUEUE_SIZE:         30,   // pistes précalculées dans la file radio
  RADIO_REFILL_THRESHOLD:    8,   // refill quand < n pistes restantes
  RG_MAX_FILE_BYTES:  31457280,   // 30 MB — taille max fichier pour analyse ReplayGain
  RG_ANALYSIS_SECS:         30,   // durée max d'analyse RG (OfflineAudioContext)
  WATCH_INTERVAL_MS:     30000,   // ms — intervalle de surveillance dossier (fallback)
  VIRT_BUFFER:               8,   // lignes buffer virtual scroll de chaque côté
  VIRT_ROW_H:               48,   // px — hauteur d'une ligne piste
  VIRT_GRP_H:               28,   // px — hauteur d'un en-tête de groupe
  TAG_LOAD_CONCURRENCY:      4,   // pistes chargées en parallèle (tags async)
  PLAYLOG_MAX_ENTRIES:    2000,   // max entrées dans playlog IDB
  SLEEP_FADE_SECS:          30,   // secondes de fondu avant sleep timer
  IPC_TIMEOUT_MS:        15000,   // ms — timeout global pour les appels IPC Tauri
});

export const SORTS = ['az', 'za', 'artist', 'album', 'recent'];

export const SLBLS = {
  az:     'sort_az',
  za:     'sort_za',
  artist: 'sort_artist',
  album:  'sort_album',
  recent: 'sort_recent',
};

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const SPEED_LBLS = ['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×'];
