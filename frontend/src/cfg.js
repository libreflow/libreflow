// cfg.js — Constantes globales LibreFlow
// Source unique de vérité pour toutes les magic numbers.
// Ne rien importer ici (pas de dépendances circulaires possibles).

export const CFG = Object.freeze({
  IDB_TIMEOUT_DEFAULT:    8000,   // ms — timeout par défaut pour les opérations IDB
  IDB_TIMEOUT_DALL:      30000,   // ms — timeout pour dall() (lecture lib complète)
  TRACK_SAVE_DEBOUNCE:     250,   // ms — debounce sur saveTrack()
  CFG_SAVE_DEBOUNCE:       800,   // ms — debounce sur saveCfg()
  PL_SAVE_DEBOUNCE:        500,   // ms — debounce sur la sauvegarde des playlists
  SEARCH_DEBOUNCE:          90,   // ms — debounce sur la barre de recherche
  PLAYLOG_FLUSH_DELAY:    3000,   // ms — délai avant flush du play log vers IDB
  RADIO_QUEUE_SIZE:         30,   // pistes précalculées dans la file radio
  RADIO_REFILL_THRESHOLD:    8,   // refill quand < n pistes restantes
  RG_MAX_FILE_BYTES:  31457280,   // 30 MB — taille max fichier pour analyse ReplayGain
  RG_ANALYSIS_SECS:         30,   // durée max d'analyse RG (OfflineAudioContext)
  VIRT_BUFFER:               8,   // lignes buffer virtual scroll de chaque côté
  VIRT_ROW_H:               48,   // px — hauteur d'une ligne piste
  VIRT_GRP_H:               28,   // px — hauteur d'un en-tête de groupe
  TAG_LOAD_CONCURRENCY:      8,   // pistes chargées en parallèle — 8 optimal SSD (read_tags Rust = I/O léger, pas de thread JS bloqué)
  PLAYLOG_MAX_ENTRIES:    2000,   // max entrées dans playlog IDB
  SLEEP_FADE_SECS:          30,   // secondes de fondu avant sleep timer
  IPC_TIMEOUT_MS:        15000,   // ms — timeout global pour les appels IPC Tauri
  IPC_COVER_TIMEOUT_MS:  15000,   // ms — timeout pour l'écriture de cover via IPC
  ORPHAN_CHECK_TIMEOUT_MS: 10000, // ms — timeout pour la vérification des pistes orphelines
  ORPHAN_START_DELAY_MS:  6000,   // ms — délai avant vérification des orphelins au boot (6s, cf app.js)
  MODAL_CLOSE_MS:          400,   // ms — durée d'animation de fermeture des modals
  RELOCATE_SUCCESS_MS:     600,   // ms — délai d'affichage avant fermeture après relocalisation réussie
  WATCH_DEBOUNCE_MS:       500,   // ms — debounce sur watch-new-files (SEC-10 rate-limit)
  SHORT_TRACK_MIN_SECS:     20,   // s  — durée min d'une piste valide (< = ignorée)
  RG_GAIN_CAP:           3.162,   // gain linéaire max ReplayGain ≈ +10 dB (B1 fix)
  MAX_ART_CACHE:           200,   // ARCH-2 — cache LRU blob: URL artwork (liste + grilles albums/artistes)
  ART_B64_MAX_CHARS:  4_000_000,   // ~3 MB binary — cap art base64 pour éviter IDB/DOM blow-up
  QUEUE_ROW_H:              50,   // px — hauteur d'un .queue-item (padding 7px*2 + art 36px)
  SCROLL_TO_TRACK_DELAY:    80,   // ms — délai avant scroll auto vers la piste en cours
  CINEMA_QUEUE_LIMIT:        8,   // pistes affichées dans le panneau file d'attente du mode cinéma (Task 9)
  FUZZY_THRESHOLD:         0.4,   // seuil minimal Jaccard similarity pour la recherche floue
  BOOT_CHUNK:             5000,   // pistes traitées par tranche au boot (yield entre tranches)
  STAGGER_CAP:              12,   // nb maximum d'éléments animés en stagger (perf)
  URL_REVOKE_DELAY_MS:    1000,   // ms — délai avant révocation d'un blob URL (export M3U)
  ORGANIZE_TIMEOUT_MS:  120_000,  // ms — timeout pour organize_files (run réel)
  ORGANIZE_DRY_RUN_TIMEOUT_MS: 30_000, // ms — timeout pour organize_files (dry-run)
});

export const SORTS = ['az', 'za', 'artist', 'album', 'duration', 'recent'];

export const SLBLS = {
  az:       'sort_az',
  za:       'sort_za',
  artist:   'sort_artist',
  album:    'sort_album',
  duration: 'pl_sort_duration',
  recent:   'sort_recent',
};

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const SPEED_LBLS = ['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×'];
