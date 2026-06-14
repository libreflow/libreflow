// @ts-check
/**
 * player.js — Moteur de lecture (Phase 2 refactoring)
 *
 * Possède : audio, curIdx, shuffle, shuffleQ, repeat, manualQueue,
 *           recentPlays, playbackSpeed, crossfadeDur + internals crossfade/gapless.
 *
 * Émet (bus.js) :
 *   EVENTS.TRACK_CHANGE  { track, idx }  — après chaque changement de piste
 *   EVENTS.PLAY_STATE    { playing }     — sur play / pause
 *
 * Importe directement les satellites déjà isolés ; utilise window.* pour les
 * fonctions encore dans app.js (saveCfg, getFiltered, trackIdx, toast, …).
 * Ces shims seront éliminés lors des phases ultérieures.
 */
/** @import { Track } from './types.js' */

import { emit, EVENTS }                           from './bus.js';
import { get, set, subscribe }                    from './store.js';
import { i18n }                                   from './i18n.js';
import { invoke, convertFileSrc }                 from './ipc.js';
import { fmt }                                    from './utils.js';
// VIRT import removed — moved to player-likes.js
import { eqCtx, eqNodes, eqAutoMode,
         initEQ, ensureEQResumed,
         masterGainNode, audioOutGain,
         setMasterGain,
         updateSmartEQGenre, startSmartEQ }       from './eq.js';
import { initViz, startViz, stopViz,
         setVizMode, setVizEnabled }              from './viz.js';
import { sleepFading, sleepEndOfTrack,
         setSleepFading, cancelSleepTimer }       from './sleep.js';
import { radioActive, radioRefillQueue,
         getRadioQueue }                          from './radio.js';
import { logPlay }                                from './playlog.js';
import { rgEnabled, analyzeAndApplyRG,
         cancelRgAnalysis }                       from './replaygain.js';
import { updateMiniProgress }                     from './miniplayer.js';
import { updateMiniOverlayProgress } from './minioverlay.js';
import { clearQueueOverride, queueOpen,
         renderQueue }                            from './queue.js';
import { updateCinemaProgress }                   from './cinema.js';
import { CFG, SPEEDS, SPEED_LBLS }                from './cfg.js';
import { getFiltered, filteredIdx, trackIdx, _trackIdxMap, invalidateFilterCache } from './search.js';
import { toast }                                        from './ui.js';
import { saveCfg, saveCfgNow } from './cfgsave.js';
import { scrollToCurrentTrack }  from './renderer.js';
import { _allPlayerUI }           from './allplayerui.js';
import { playPausePress }         from './motion.js';
import { updateMediaSessionState } from './player-mediasession.js';
export { updateMediaSession, initMediaSession, updateMediaSessionState } from './player-mediasession.js';

// Boot viz state (remplace window._pendingVizMode/_pendingVizDisabled)
/** @type {string | null} */
let _pendingVizMode     = null;
let _pendingVizDisabled = false;
/**
 * Appel depuis app.js boot() pour transmettre la config viz sans window.*.
 * @param {string | null} [mode]
 * @param {boolean} [disabled]
 * @returns {void}
 */
export function setBootVizState(mode, disabled) {
  _pendingVizMode     = mode ?? null;
  _pendingVizDisabled = !!disabled;
}


// ── Audio element ─────────────────────────────────────────────────────────────
export const audio = /** @type {HTMLAudioElement} */ (document.getElementById('audio'));
audio.crossOrigin = 'anonymous'; // requis pour Web Audio API createMediaElementSource

// ── DOM refs cachées pour timeupdate (évite getElementById à 60fps) ───────────
const _DOM = {
  pfill:      document.getElementById('pfill'),
  tc:         document.getElementById('tc'),
  td:         document.getElementById('td'),
  rvProgFill: null, // lazy-init à la première vue radio
  pcplay:     document.querySelector('.pcplay'),
  sbDot:      document.querySelector('.sb-dot'),
};

/**
 * Invalide le cache rvProgFill quand renderRadioView() rebuide l'innerHTML.
 * @returns {void}
 */
export function clearRvProgFill() { _DOM.rvProgFill = null; }

// ── Playback state — initialisé depuis le store ───────────────────────────────
let curIdx        = get('curIdx');        // -1
let shuffle       = get('shuffle');       // false
/** @type {number[]} */
let shuffleQ      = [];
let repeat        = get('repeat');        // 'none'
let manualQueue   = get('manualQueue');   // []
let recentPlays   = (get('recentPlays') || []).slice(0, 50);   // []
let playbackSpeed = get('playbackSpeed'); // 1
let crossfadeDur  = get('crossfadeDur');  // 0

// Crossfade / gapless internals
/** @type {ReturnType<typeof setTimeout> | null} */
let cfFadeTimer    = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let cfNextTimer    = null;
/** @type {number | null} */
let _cfRafId       = null;
let _cfGen         = 0; // token anti-race incrémenté à chaque clearCrossfadeTimers()
let _cfPending     = false; // guard anti-race pendant l'await ensureUrl dans checkCrossfade()
/** @type {HTMLAudioElement | null} */
export let audioNext       = null;
/** @type {MediaElementAudioSourceNode | null} */
let audioNextSource        = null;
/** @type {GainNode | null} */
let audioNextGain          = null;  // fade-in 0→1 (crossfade shape)
/** @type {GainNode | null} */
let audioNextRgGain        = null;  // DSP-7: compensation ReplayGain indépendante
let _gaplessNextIdx        = -1;

// ── Courbes de crossfade précalculées (constantes module — évite la réallocation) ──
const CURVE_LEN      = 128;
const FADE_IN_CURVE  = new Float32Array(CURVE_LEN + 1);
const FADE_OUT_CURVE = new Float32Array(CURVE_LEN + 1);
for (let _i = 0; _i <= CURVE_LEN; _i++) {
  FADE_IN_CURVE[_i]  = Math.sin((_i / CURVE_LEN) * Math.PI / 2); // 0→1 cosinus pur
  FADE_OUT_CURVE[_i] = Math.cos((_i / CURVE_LEN) * Math.PI / 2); // 1→0 cosinus pur
}

// Flags session
let _playLock              = false;
let _audioErrSrc           = '';
let _audioErrCount         = 0;
let _consecErrCount        = 0;  // AUDIO-2 : circuit-breaker — reset sur 'playing', stoppe à 10
let _lastPosSave           = 0;
let _queueEndedToastShown  = false;
let _recentFilterToastShown= false;

// ── Sync des vars locales depuis le store (mises à jour par le boot d'app.js) ─
subscribe('curIdx',        v => { curIdx        = v; });
subscribe('shuffle',       v => { shuffle       = v; });
subscribe('repeat',        v => { repeat        = v; });
subscribe('manualQueue',   v => { manualQueue   = v; });
subscribe('recentPlays',   v => { recentPlays   = v; });
subscribe('playbackSpeed', v => { playbackSpeed = v; });
subscribe('crossfadeDur',  v => { crossfadeDur  = v; });
subscribe('sort',          () => { _recentFilterToastShown = false; });
subscribe('query',         () => { _recentFilterToastShown = false; });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Résout l'URL asset:// d'une piste si elle n'est pas encore connue.
 * @param {Track} t
 * @returns {Promise<boolean>}
 */
export async function ensureUrl(t) {
  if (t.url)  return true;
  if (!t.path) return false;
  try {
    t.url = convertFileSrc(t.path);
    return true;
  } catch(e) {
    console.warn('[ensureUrl]', e);
    return false;
  }
}

// ── setIcon ───────────────────────────────────────────────────────────────────
/**
 * Met à jour tous les boutons play/pause + icônes sidebar.
 * @param {boolean} playing
 * @returns {void}
 */
let _pressListenerEl = null; // element reference so replacement survives DOM updates

function _attachPressListener() {
  const btn = document.querySelector('.pcplay');
  if (!btn || btn === _pressListenerEl) return;
  btn.addEventListener('pointerdown', () => playPausePress(btn));
  _pressListenerEl = btn;
}

export function setIcon(playing) {
  invoke('taskbar_set_playing', { playing }).catch((e) => console.warn('[taskbar_set_playing]', e));
  // Contrôles médias système : état + position. Ignoré côté Rust avant la 1re piste.
  invoke('smtc_playback', { playing, positionSecs: audio.currentTime || 0 })
    .catch((e) => console.warn('[smtc_playback]', e));
  const ci = document.getElementById('cinema-ico-play');
  const cp = document.getElementById('cinema-ico-pause');
  if (ci) ci.style.display = playing ? 'none'  : 'block';
  if (cp) cp.style.display = playing ? 'block' : 'none';
  _DOM.pcplay?.classList.toggle('playing', playing);
  _DOM.pcplay?.setAttribute('aria-pressed', String(playing));
  _DOM.sbDot?.classList.toggle('playing', playing);
  _attachPressListener();
}

// ── Playback helpers (private) ───────────────────────────────────────────────

function _updateRecentPlays(trackId) {
  recentPlays = [trackId, ...recentPlays.filter(id => id !== trackId)].slice(0, 50);
  set('recentPlays', recentPlays);
}

// Runs after every successful audio.play(). ORDER IS FIXED — do not reorder.
function _postPlaySideEffects(track) {
  _updateRecentPlays(track.id);
  logPlay(track);
  // PERF-H5 FIX : ne pas émettre FILTER_CHANGED (→ renderLib() complet) à chaque lecture.
  // On invalide seulement le cache ; le re-rendu survient sur le prochain changement de vue.
  // La vue 'recent' se met à jour naturellement lors de la prochaine navigation.
  invalidateFilterCache();
  saveCfg();
}

// Starts immediate playback of a resolved off-filter track.
// INVARIANT: caller must call radioRefillQueue() BEFORE emit(TRACK_CHANGE).
function _playDirect(track, idx) {
  // R2-A FIX : même garde que playAt() — empêche double TRACK_CHANGE si crossfade
  // et radio auto-play se déclenchent simultanément.
  if (_playLock) return;
  _playLock = true;
  try {
    if (!track.url && track.path) track.url = convertFileSrc(track.path);
    curIdx = idx;
    set('curIdx', curIdx);
    clearCrossfadeTimers();
    // @ts-ignore — url guaranteed set by convertFileSrc above or by scan
    audio.src = track.url; ensureEQResumed();
    audio.play().catch((e) => {
      // R2-A + correctif-6 : échec audio.play() visible (pas silencieux)
      if (e?.name !== 'AbortError') toast(i18n('t_play_start_err', e?.message), 'error');
    });
    // radioRefillQueue() DOIT précéder _postPlaySideEffects() (qui émet FILTER_CHANGED)
    // et TRACK_CHANGE — sinon un callback UI peut lire la file radio avant son refill (§3).
    if (radioActive) radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e));
    _postPlaySideEffects(track);
    emit(EVENTS.TRACK_CHANGE, { track, idx: curIdx });
    setTimeout(() => scrollToCurrentTrack(), 50);
    if (rgEnabled) analyzeAndApplyRG();
  } finally {
    _playLock = false;
  }
}

// ── Playback core ─────────────────────────────────────────────────────────────

/**
 * Lance la lecture de la piste à l'index donné dans la vue courante filtrée.
 * Émet TRACK_CHANGE après démarrage effectif de la lecture.
 * @param {number} filteredIdx
 * @param {{ skipScroll?: boolean, keepQueue?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function playAt(filteredIdx, { skipScroll = false, keepQueue = false } = {}) {
  if (_playLock) return;
  _playLock = true;
  try {
    const fl = getFiltered();
    const t  = fl[filteredIdx];
    if (!t) return;

    curIdx = trackIdx(t.id);
    set('curIdx', curIdx);
    if (radioActive) radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e)); // DOIT précéder TRACK_CHANGE (règle critique)

    const ok = await ensureUrl(t);
    if (!ok) { toast(i18n('t_not_found'), 'error'); return; }
    // RACE-1 FIX : la piste peut avoir été supprimée pendant l'await ensureUrl
    if (!_trackIdxMap?.has(t.id)) return;

    if (!keepQueue) clearQueueOverride();
    clearCrossfadeTimers(); // DOIT précéder audio.src + audio.play() (évite volume=0 au démarrage)
    // @ts-ignore — url is guaranteed set by ensureUrl() above
    audio.src = t.url;
    if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
    ensureEQResumed();
    try { await audio.play(); } catch(e) {
      // @ts-ignore — e is unknown, access .name/.message safely via type assertion
      if (e.name === 'AbortError') return; // piste remplacée mid-play — le nouveau playAt émettra TRACK_CHANGE
      toast(i18n('t_play_start_err', e.message), 'error');
      return; // ne pas émettre TRACK_CHANGE pour une lecture qui n'a pas démarré
    }

    // RACE-4 FIX : émettre TRACK_CHANGE APRÈS audio.play() pour que les handlers
    // (updateBar, patchActiveTrack) voient l'audio déjà démarré.
    emit(EVENTS.TRACK_CHANGE, { track: t, idx: curIdx });
    _postPlaySideEffects(t);
    // Mettre à jour le titre de la fenêtre : "Titre — Artiste | LibreFlow"
    // @ts-ignore — filter(Boolean) narrows to string[] at runtime; join returns string
    const _wTitle = [t.name, t.artistFull || t.artist].filter(Boolean).join(' — ');
    invoke('win_set_title', { title: _wTitle ? `${_wTitle} | LibreFlow` : 'LibreFlow' }).catch((e) => console.warn('[win_set_title]', e));
    if (!skipScroll) setTimeout(() => scrollToCurrentTrack(), 50);
    if (rgEnabled) analyzeAndApplyRG();
  } finally {
    _playLock = false;
  }
}

/** Compare id to the currently-playing track via store (no closure on `curIdx`). */
export function isCurrentTrack(id) {
  const i = get('curIdx');
  return i >= 0 && get('tracks')[i]?.id === id;
}

/** @returns {void} */
export function togglePlay() {
  if (curIdx < 0) { if (getFiltered().length) playAt(0); return; }
  if (audio.paused) {
    ensureEQResumed();
    audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] togglePlay() failed:', e); });
  } else {
    // B3 FIX : annuler tout crossfade en cours au pause. Sans ça, cfFadeTimer
    // fire ~crossfadeDur plus tard et exécute audio.src=…/audio.play() → la
    // lecture reprend toute seule alors que l'utilisateur a mis en pause.
    // Pausing mid-crossfade promotes the next track: clearCrossfadeTimers() tears down
    // audioNext src + all DSP nodes (audioNextGain/audioNextRgGain/audioNextSource set
    // to null), so attempting to resume audioNext after pause is not recoverable.
    if (cfFadeTimer || cfNextTimer || _cfRafId) clearCrossfadeTimers();
    audio.pause();
  }
}

/** @returns {void} */
export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (repeat === 'one') {
    clearCrossfadeTimers(); // BUG-D1-2 FIX: clear lingering crossfade timers before replay
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] prev repeat:one play() failed:', e); }); return;
  }
  const tracks = get('tracks'); // Phase 4
  const fl = getFiltered();
  const t  = tracks[curIdx];
  // Bug-5 FIX: t peut être undefined si curIdx est hors-bornes après une suppression rapide
  // → filteredIdx(undefined) lèverait TypeError sur t.id.
  if (!t) return;
  const fi = filteredIdx(t); // P4 — O(1) via posMap

  // En tri "recent" : naviguer dans l'ordre stable de tracks[]
  if (get('sort') === 'recent' && get('view') === 'all') {
    if (get('query') && !_recentFilterToastShown) {
      _recentFilterToastShown = true;
      toast(i18n('t_recent_ignores_filter'), 'info');
    }
    const ni = curIdx - 1;
    if (ni >= 0) {
      const _tn = tracks[ni];
      const nfi = filteredIdx(_tn); // P4 — O(1) via posMap
      if (nfi >= 0) { playAt(nfi); return; }
      // Piste hors liste filtrée — lecture directe
      _playDirect(tracks[ni], ni);
    } else if (repeat === 'all') playAt(fl.length - 1);
    return;
  }
  // BUG-7 FIX : en shuffle, remonter dans l'historique recentPlays plutôt que fi-1
  // recentPlays[0] = piste actuelle, recentPlays[1] = piste précédemment jouée
  if (shuffle) {
    const prevId = recentPlays[1];
    if (prevId) {
      // @ts-ignore — has() guard ensures get() is defined; -1 fallback is number
      const prevTi = /** @type {number} */ (_trackIdxMap.has(prevId) ? _trackIdxMap.get(prevId) : -1);
      if (prevTi >= 0) {
        const _pt    = tracks[prevTi];
        const prevFi = filteredIdx(_pt);
        if (prevFi >= 0) { playAt(prevFi); return; }
        // Piste hors filtre actif — lecture directe (même pattern que sort=recent)
        _playDirect(_pt, prevTi);
        return;
      }
    }
    // Pas d'historique (première piste jouée en shuffle) : ne rien faire
    return;
  }
  if (fi < 0) return; // Piste hors filtre actif ou rien ne joue (curIdx < 0) — aucune navigation possible
  // BUG-D1-3 FIX: guard fl.length > 0 before wrap-around to avoid playAt(-1) on empty filtered list
  if (fi > 0) playAt(fi - 1); else if (repeat === 'all' && fl.length > 0) playAt(fl.length - 1);
}

/**
 * Retourne la prochaine piste sans modifier l'état (peek pur).
 * Respecte : file manuelle > radio > repeat:one > shuffle > séquentiel.
 * @returns {import('./types.js').Track | null}
 */
export function peekNext() {
  const tracks = get('tracks');
  if (!tracks?.length || curIdx < 0) return null;

  // File manuelle (priorité maximale)
  if (manualQueue.length) {
    const ni = /** @type {number} */ (manualQueue[0]); // peek, pas shift
    return tracks[ni] ?? null;
  }

  // Radio active → première de la file radio (Track objects)
  if (radioActive) {
    const rq = getRadioQueue();
    return rq?.[0] ?? null;
  }

  // Repeat:one → rejoue la piste courante
  if (repeat === 'one') return tracks[curIdx] ?? null;

  // Shuffle
  if (shuffle && shuffleQ.length) {
    const ni = /** @type {number} */ (shuffleQ[0]); // peek, pas shift
    return tracks[ni] ?? null;
  }
  // Bug-7 FIX: shuffle actif mais shuffleQ épuisé (pas encore rebuildé par buildQ()).
  // Pour ne pas signaler null (→ arrêt crossfade gapless), on préview la première piste
  // que buildQ() produirait : la piste courante est exclue, on retourne la première de
  // la liste filtrée différente de curIdx. Utilise _trackIdxMap (O(1)) — pas d'indexOf.
  if (shuffle && repeat !== 'none') {
    const fl = getFiltered();
    // @ts-ignore — _trackIdxMap.get() returns number; curIdx comparison is safe
    const fallback = fl.find(t => _trackIdxMap?.get(t.id) !== curIdx);
    if (fallback) return fallback;
  }

  // Séquentiel — cas spécial sort:recent (même logique que next())
  if (get('sort') === 'recent' && get('view') === 'all') {
    const ni = curIdx + 1;
    if (ni < tracks.length) {
      const _tn = tracks[ni];
      if (filteredIdx(_tn) >= 0) return _tn;
    }
    return (repeat === 'all' && tracks.length > 0) ? tracks[0] : null;
  }

  // Séquentiel standard via vue filtrée
  const fl = getFiltered();
  const t  = tracks[curIdx];
  if (!t) return null;
  const fi = filteredIdx(t);
  if (fi < 0) return null;
  if (fi + 1 < fl.length) return fl[fi + 1];
  return (repeat === 'all' && fl.length > 0) ? fl[0] : null;
}

// manual=true  → appel explicite (bouton, clavier, media key) : ignore repeat='one'
// manual=false → appel automatique depuis 'ended' : respecte repeat='one'
/**
 * @param {boolean} [manual]
 * @returns {void}
 */
export function next(manual = false) {
  if (repeat === 'one' && !manual) {
    clearCrossfadeTimers(); // BUG-D1-2 FIX: clear lingering crossfade timers before replay
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] next repeat:one play() failed:', e); }); return;
  }

  const tracks = get('tracks'); // Phase 4

  // ── File manuelle ─────────────────────────────────────────────────────────
  if (manualQueue.length) {
    const _wasLastInQueue = manualQueue.length === 1;
    // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
    const ni = /** @type {number} */ (manualQueue.shift());
    set('manualQueue', [...manualQueue]);
    if (_wasLastInQueue && !radioActive && !_queueEndedToastShown) {
      _queueEndedToastShown = true;
      setTimeout(() => toast(i18n('t_queue_ended'), 'info'), 400);
    }
    // Bug-2 FIX: l'index peut être hors-bornes si une piste a été supprimée sans
    // que adjustShuffleQAfterDelete() ait nettoyé la file manuelle.
    if (ni < 0 || ni >= tracks.length || !tracks[ni]) return;
    const _tq = tracks[ni];
    getFiltered(); // warm cache for filteredIdx O(1)
    const fi  = filteredIdx(_tq); // P4 — O(1)
    if (fi >= 0) { playAt(fi); return; }
    if (tracks[ni]) { _playDirect(tracks[ni], ni); return; }
  }

  // ── Radio active, file vide → recharger ──────────────────────────────────
  // BUG-HIGH FIX : radioRefillQueue() est async — consommer manualQueue dans .then()
  // garantit que la file est peuplée avant le test (invariant §2 : refill AVANT UI).
  if (radioActive) {
    radioRefillQueue()
      .then(() => {
        if (manualQueue.length) {
          // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
          const ni = /** @type {number} */ (manualQueue.shift());
          set('manualQueue', [...manualQueue]);
          // Bug-2b FIX (même patron que Bug-2): guard hors-bornes dans le chemin radio async
          if (ni < 0 || ni >= tracks.length || !tracks[ni]) return;
          const _tq2 = tracks[ni];
          getFiltered(); // warm cache for filteredIdx O(1)
          const fi   = filteredIdx(_tq2); // P4 — O(1)
          if (fi >= 0) { playAt(fi); return; }
          if (tracks[ni]) { _playDirect(tracks[ni], ni); }
        } else {
          // Queue encore vide après refill : le guard B34 (_radioRefillInProgress) a
          // court-circuité un refill concurrent — laisser ce refill se terminer.
          // Retry différé pour éviter un stall silencieux sans boucle synchrone infinie.
          console.warn('[radio] manualQueue vide après refill — retry dans 500 ms');
          setTimeout(() => { if (radioActive) next(); }, 500);
        }
      })
      .catch(e => console.warn('[radio] refill failed:', e));
    return; // sortir immédiatement — la suite s'exécute dans .then() après refill
  }

  // ── Shuffle ───────────────────────────────────────────────────────────────
  if (shuffle && shuffleQ.length) {
    // @ts-ignore — shuffleQ.length guard ensures shift() is defined
    const ni = /** @type {number} */ (shuffleQ.shift());
    const _ts = tracks[ni];
    getFiltered(); // warm cache for filteredIdx O(1)
    const fi  = filteredIdx(_ts); // P4 — O(1)
    if (fi >= 0) { playAt(fi); return; }
    if (tracks[ni]) {
      // B15 FIX : router via _playDirect (chemin canonique off-filter, comme
      // prev() et les autres branches) au lieu de dupliquer audio.src/play()
      // inline. buildQ() APRÈS — _playDirect a déjà mis curIdx = ni.
      _playDirect(tracks[ni], ni);
      if (!shuffleQ.length && repeat !== 'none') buildQ();
    }
    return;
  }

  // ── Séquentiel ────────────────────────────────────────────────────────────
  const fl = getFiltered();
  const t  = tracks[curIdx];
  const fi = filteredIdx(t); // P4 — O(1)

  // En tri "recent" : ordre stable de tracks[]
  if (get('sort') === 'recent' && get('view') === 'all') {
    if (get('query') && !_recentFilterToastShown) {
      _recentFilterToastShown = true;
      toast(i18n('t_recent_ignores_filter'), 'info');
    }
    const ni = curIdx + 1;
    if (ni < tracks.length) {
      const _tn = tracks[ni];
      const nfi = filteredIdx(_tn); // P4 — O(1) via posMap
      if (nfi >= 0) { playAt(nfi); return; }
      _playDirect(tracks[ni], ni);
    } else if (repeat === 'all') playAt(0);
    return;
  }

  if (fi < 0) return;
  if (fi < fl.length - 1) playAt(fi + 1); else if (repeat === 'all') playAt(0);
}

/**
 * Construit la file de lecture aléatoire depuis la vue filtrée courante.
 * @returns {void}
 */
export function buildQ() {
  const fl = getFiltered();
  const arr = fl
    .map(t => trackIdx(t.id))
    .filter(i => i >= 0 && i !== curIdx);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  shuffleQ = arr;
}

/** @returns {void} */
export function toggleShuffle() {
  shuffle = !shuffle;
  set('shuffle', shuffle);
  const shufBtn = document.getElementById('pc-shuf');
  shufBtn?.classList.toggle('on', shuffle);
  shufBtn?.setAttribute('aria-pressed', String(shuffle));
  document.getElementById('cinema-shuf')?.classList.toggle('on', shuffle);
  document.getElementById('cinema-shuf')?.setAttribute('aria-pressed', String(shuffle));
  if (shuffle) buildQ();
  toast(shuffle ? i18n('t_shuffle_on') : i18n('t_shuffle_off'));
  _allPlayerUI();
}

/** @returns {void} */
export function toggleRepeat() {
  const m = ['none', 'all', 'one'];
  // @ts-ignore — m[] is a string[] but values are valid RepeatMode literals
  repeat = m[(m.indexOf(repeat) + 1) % 3];
  set('repeat', repeat);
  const isOn = repeat !== 'none';
  // A11Y : aria-pressed tri-état → "false" (off) / "true" (all) / "mixed" (one) — convention WAI-ARIA tri-state.
  const ariaPressed = repeat === 'none' ? 'false' : repeat === 'all' ? 'true' : 'mixed';
  const lbl = { none: i18n('t_repeat_none'), all: i18n('t_repeat_all'), one: i18n('t_repeat_one') }[repeat];
  const repBtn = document.getElementById('pc-rep');
  repBtn?.classList.toggle('on', isOn);
  repBtn?.classList.toggle('rep-one', repeat === 'one');
  repBtn?.setAttribute('aria-pressed', ariaPressed);
  repBtn?.setAttribute('aria-label', lbl);
  const cinRep = document.getElementById('cinema-rep');
  cinRep?.classList.toggle('on',      isOn);
  cinRep?.classList.toggle('rep-one', repeat === 'one');
  cinRep?.setAttribute('aria-pressed', ariaPressed);
  cinRep?.setAttribute('aria-label', lbl);
  toast(lbl); // toast aria-live=polite — annonce dynamique du nouvel état (3 distincts)
  _allPlayerUI();
}

// toggleLike / likeat extracted to player-likes.js
export { toggleLike, likeat } from './player-likes.js';

// ── Vitesse ───────────────────────────────────────────────────────────────────
/**
 * @param {number} speed
 * @returns {void}
 */
export function setSpeed(speed) {
  playbackSpeed = speed;
  set('playbackSpeed', playbackSpeed);
  audio.playbackRate = speed;
  if (audioNext) audioNext.playbackRate = speed;
  const btn = document.getElementById('btn-speed');
  if (btn) {
    const lbl = SPEED_LBLS[SPEEDS.indexOf(speed)] || speed + '×';
    const sl = btn.querySelector('.speed-lbl');
    if (sl) sl.textContent = lbl; else btn.textContent = lbl;
    btn.classList.toggle('active', speed !== 1);
  }
  updateMediaSessionState();
  saveCfg();
  // A11Y-SPEED-LIVE: announce new speed to screen readers via aria-live region
  const liveEl = document.getElementById('np-speed-live');
  if (liveEl) liveEl.textContent = i18n('spd_label', speed);
}

// ── Crossfade ─────────────────────────────────────────────────────────────────
/**
 * @param {number} sec
 * @returns {void}
 */
export function setCrossfade(sec) {
  crossfadeDur = sec;
  set('crossfadeDur', crossfadeDur);
  const disp = document.getElementById('cf-val-disp');
  if (disp) disp.textContent = sec + 's';
  const slider = document.getElementById('cf-slider');
  if (slider) {
    // @ts-ignore — cf-slider is an input[type=range] with .value property
    slider.value = sec;
    slider.style.setProperty('--cf-pct', (sec / 12 * 100) + '%');
  }
  saveCfg();
}

/** Crée l'élément Audio pour le crossfade et hérite la vitesse courante. @returns {HTMLAudioElement} */
function _createAudioNextElement() {
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  if (playbackSpeed !== 1) el.playbackRate = playbackSpeed; // GAPLESS-1 FIX
  return el;
}

/** Connecte audioNext au graphe Web Audio (DSP-7). @returns {void} */
function _connectAudioNextToGraph() {
  if (!eqCtx || eqCtx.state === 'closed' || audioNextSource) return;
  try {
    // DSP-7 graph : audioNext → audioNextSource → audioNextRgGain → audioNextGain → eqNodes[0]
    audioNextSource = eqCtx.createMediaElementSource(/** @type {HTMLAudioElement} */ (audioNext));
    audioNextRgGain = eqCtx.createGain();
    audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.001); // neutre — init sans zipper §9
    audioNextGain   = eqCtx.createGain();
    audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.001);     // muet au départ — transition minimale §9
    // @ts-ignore — audioNextSource just assigned above, guaranteed non-null here
    audioNextSource.connect(audioNextRgGain);
    audioNextRgGain.connect(audioNextGain);
    audioNextGain.connect(eqNodes.length > 0 ? eqNodes[0] : eqCtx.destination);
  } catch(e) {
    // BUG-D1-10 FIX: catch InvalidStateError or other AudioNode creation failures
    console.warn('[crossfade initAudio]', e);
    if (audioNext) { audioNext.pause(); audioNext.src = ''; audioNext = null; }
    audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
  }
}

/** @returns {void} */
export function initCrossfadeAudio() {
  // BUG-D1-10 FIX: tear down stale/partial audioNext before re-init
  if (audioNext && audioNextSource) {
    if (eqCtx && eqCtx.state !== 'closed') return; // déjà câblé et valide
    // AudioContext fermé/invalide — reconstruire
    try { audioNextSource?.disconnect(); } catch {}
    try { audioNextGain?.disconnect(); } catch {}
    try { audioNextRgGain?.disconnect(); } catch {}
    audioNext.pause(); audioNext.src = '';
    audioNext = null; audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
  }
  if (audioNext && !audioNextSource) {
    audioNext.pause(); audioNext.src = '';
    audioNext = null;
  }

  audioNext = _createAudioNextElement();

  if (!eqCtx) initEQ();
  // ARCH-10: réagir aux suspensions/interruptions de l'AudioContext
  if (eqCtx && !eqCtx.onstatechange) {
    eqCtx.onstatechange = () => {
      if (eqCtx.state === 'suspended' || eqCtx.state === 'interrupted') ensureEQResumed();
    };
  }
  _connectAudioNextToGraph();
}

/** @returns {void} */
export function clearCrossfadeTimers() {
  if (_cfRafId)    { cancelAnimationFrame(_cfRafId); _cfRafId    = null; }
  if (cfFadeTimer) { clearTimeout(cfFadeTimer);      cfFadeTimer = null; }
  if (cfNextTimer) { clearTimeout(cfNextTimer);      cfNextTimer = null; }
  _cfGen++;      // invalide toutes les closures en vol
  _cfPending = false;
  cancelRgAnalysis();
  if (audioNextGain && eqCtx) {
    audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime);
    audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.01);
  }
  // DSP-7: reset du nœud RG dédié
  if (audioNextRgGain && eqCtx) {
    audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime);
    audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01);
  }
  // DSP-6: reset audioOutGain (fade-out source primaire)
  if (audioOutGain && eqCtx) {
    audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);
    // §9 : ramp court plutôt que .value= direct — le nœud reste connecté et peut
    // porter de l'audio si l'on interrompt un fondu en cours (évite un click).
    audioOutGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01);
  }
  if (!sleepFading) {
    // DSP-5 : restaurer audio.volume depuis le slider DOM (JAMAIS hardcoder 1.0)
    const vel = document.getElementById('vol');
    // @ts-ignore — vol is an input[type=range] with .value property
    setMasterGain(vel ? parseFloat(vel.value) : (masterGainNode ? masterGainNode.gain.value : 1));
  }
  if (audioNext) { audioNext.pause(); audioNext.src = ''; }
  try { audioNextSource?.disconnect(); } catch {}
  try { audioNextGain?.disconnect(); } catch {}
  try { audioNextRgGain?.disconnect(); } catch {}
  audioNextSource = null;
  audioNextGain   = null;
  audioNextRgGain = null;
  _gaplessNextIdx = -1;
}

// Swap gapless instantané : la piste suivante est déjà bufferisée
function _commitGapless() {
  // Guard: concurrent skip (media key / crossfade) can set _playLock while gapless swap fires.
  if (_playLock) { _gaplessNextIdx = -1; next(); return; }
  // Bug-6 FIX: si l'AudioContext a été fermé par l'OS entre le pré-buffer et l'event 'ended',
  // clearCrossfadeTimers() accèderait à eqCtx.currentTime sur un contexte 'closed' (InvalidStateError).
  // On abort proprement et on laisse next() reconstruire l'AudioContext via ensureEQResumed().
  if (eqCtx && eqCtx.state === 'closed') {
    _gaplessNextIdx = -1;
    audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
    if (audioNext) { audioNext.pause(); audioNext.src = ''; }
    next();
    return;
  }
  _playLock = true;
  try {
    const ni  = _gaplessNextIdx;
    _gaplessNextIdx = -1;
    const tracks = get('tracks'); // Phase 4
    const nt  = tracks[ni];
    if (!nt || !_trackIdxMap?.has(nt.id)) { clearCrossfadeTimers(); _playLock = false; next(); return; }
    const validIdx = trackIdx(nt);
    if (validIdx < 0) { clearCrossfadeTimers(); _playLock = false; next(); return; }

    curIdx = validIdx;
    set('curIdx', curIdx);
    // @ts-ignore — audioNext guaranteed by initCrossfadeAudio() in checkCrossfade gapless path
    const gSrc = audioNext.src; // même URL déjà en cache browser
    clearCrossfadeTimers();     // restaure audio.volume + audioNextGain=0
    audio.src = gSrc;
    if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
    ensureEQResumed();
    audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[gapless] play() failed:', e); });

    if (radioActive) radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e));
    _postPlaySideEffects(nt);
    emit(EVENTS.TRACK_CHANGE, { track: nt, idx: curIdx });
    setTimeout(() => scrollToCurrentTrack(), 50);
    if (rgEnabled) analyzeAndApplyRG();
  } finally {
    _playLock = false;
  }
}

// ── Helpers privés checkCrossfade (§16 : fonctions < 50 lignes) ──────────────

/** Pré-buffer gapless : charge audioNext avant la fin de la piste courante (crossfadeDur=0).
 * @param {number} remaining
 * @returns {void}
 */
function _handleGaplessPreBuffer(remaining) {
  if (remaining >= 3.0 || _gaplessNextIdx >= 0 || cfFadeTimer) return;
  const _gni = getNextIdx();
  if (_gni < 0 || _gni === curIdx) return;
  const tracks = get('tracks');
  const _gnt   = tracks[_gni];
  if (!_gnt) return;
  _gaplessNextIdx = _gni;
  initCrossfadeAudio();
  ensureUrl(_gnt).then(ok => {
    if (!ok || crossfadeDur || _gaplessNextIdx !== _gni) { _gaplessNextIdx = -1; return; }
    // @ts-ignore — url guaranteed set by ensureUrl(ok)
    if (audioNext) { audioNext.src = _gnt.url; audioNext.preload = 'auto'; }
  }).catch(e => { console.warn('[gapless] ensureUrl failed:', e); _gaplessNextIdx = -1; });
}

/** Reset des nœuds de gain après fin de transition crossfade. @returns {void} */
function _resetCfGains() {
  if (audioNextGain && eqCtx)   { audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime);   audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.01); }
  if (audioNextRgGain && eqCtx) { audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); }
  if (audioOutGain && eqCtx)    { audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);    audioOutGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); }
  // DSP-5 : restaurer le gain depuis le slider DOM — JAMAIS hardcoder 1.0
  // @ts-ignore — vol is an input[type=range] with .value property
  if (!sleepFading) { const _vel = document.getElementById('vol'); setMasterGain(_vel ? parseFloat(_vel.value) : (masterGainNode ? masterGainNode.gain.value : 1)); }
}

/** Callback de fin de fondu : swapper audio principal → audioNext. @returns {void} */
function _commitCrossfadeTransition(nextTrack, validNextIdx) {
  if (_cfRafId) { cancelAnimationFrame(_cfRafId); _cfRafId = null; }
  if (validNextIdx < 0) {
    audio.pause(); _resetCfGains();
    // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
    audioNext.pause(); audioNext.src = '';
    return;
  }
  // BUG-6 FIX : sauvegarder la position AVANT de pauser audioNext
  // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
  const _cfPos = audioNext.currentTime;
  audio.pause();
  curIdx = validNextIdx;
  set('curIdx', curIdx);
  // @ts-ignore — url guaranteed set by ensureUrl(ok)
  audio.src = nextTrack.url;
  if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
  if (_cfPos > 0.05) audio.currentTime = _cfPos;
  _resetCfGains();
  ensureEQResumed();
  audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[crossfade] play() failed after transition:', e); });
  // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
  audioNext.pause(); audioNext.src = '';
  if (rgEnabled) analyzeAndApplyRG();
  if (radioActive) radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e));
  _postPlaySideEffects(nextTrack);
  emit(EVENTS.TRACK_CHANGE, { track: nextTrack, idx: curIdx });
  setTimeout(() => scrollToCurrentTrack(), 50);
  if (queueOpen) renderQueue();
  if (shuffle && shuffleQ.length > 0 && shuffleQ[0] === validNextIdx) {
    shuffleQ.shift();
    if (!shuffleQ.length && repeat !== 'none') buildQ();
  }
}

/** Lance le setup crossfade (crossfadeDur > 0) : load audioNext + schedule fades.
 * @param {number} remaining
 * @returns {void}
 */
function _handleCrossfadeSetup(remaining) {
  if (remaining > crossfadeDur + 0.2) return;
  if (cfFadeTimer || _cfPending) return;
  const nextIdx   = getNextIdx();
  if (nextIdx < 0 || nextIdx === curIdx) return;
  const tracks    = get('tracks');
  const nextTrack = tracks[nextIdx];
  if (!nextTrack) return;

  initCrossfadeAudio();
  const _myCfGen = _cfGen;
  _cfPending = true;
  ensureUrl(nextTrack).then(ok => {
    _cfPending = false;
    if (!ok || cfFadeTimer || audio.paused || !audioNext) return;
    if (_cfGen !== _myCfGen) return; // CROSSFADE-RACE FIX

    // @ts-ignore — url guaranteed by ensureUrl(ok)
    audioNext.src = nextTrack.url;
    const _genAtStart = _cfGen;
    // Démarrer audioNext avec 80 ms de délai pour stabiliser le décodeur
    setTimeout(() => {
      if (_cfGen !== _genAtStart) return;
      ensureEQResumed();
      // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
      audioNext.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[crossfade] audioNext.play() failed:', e); });
    }, 80);

    const durationMs = crossfadeDur * 1000;
    // B1 FIX : != null pour accepter rgGain=0 ; cap 3.162 ≈ +10 dB max
    const rgGainVal = (rgEnabled && nextTrack.rgGain != null) ? Math.min(CFG.RG_GAIN_CAP, nextTrack.rgGain) : 1;

    if (audioNextRgGain && eqCtx) {
      audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioNextRgGain.gain.setValueAtTime(rgGainVal, eqCtx.currentTime); // snapshot instantané du niveau RG
    }
    if (audioNextGain && eqCtx) {
      audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioNextGain.gain.setValueAtTime(0, eqCtx.currentTime);
      audioNextGain.gain.setValueCurveAtTime(FADE_IN_CURVE, eqCtx.currentTime, crossfadeDur);
    }
    if (!sleepFading && audioOutGain && eqCtx) {
      audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioOutGain.gain.setValueAtTime(1.0, eqCtx.currentTime);
      audioOutGain.gain.setValueCurveAtTime(FADE_OUT_CURVE, eqCtx.currentTime, crossfadeDur);
    }

    cfFadeTimer = setTimeout(() => {
      cfFadeTimer = null;
      if (_cfGen !== _genAtStart) return; // M-05 : guard génération
      const validNextIdx = _trackIdxMap?.has(nextTrack.id) ? trackIdx(nextTrack) : -1;
      _commitCrossfadeTransition(nextTrack, validNextIdx);
    }, durationMs + 50); // +50 ms de marge pour les ramps AudioParam
  }).catch(e => { _cfPending = false; console.warn('[crossfade] setup failed:', e); });
}

// Appelé depuis timeupdate — dispatcher gapless / crossfade (§16 : < 15 lignes)
/** @returns {void} */
export function checkCrossfade() {
  if (curIdx < 0 || audio.paused) return;
  if (sleepFading) return; // le sleep fade gère son propre volume
  const remaining = audio.duration - audio.currentTime;
  if (isNaN(remaining) || remaining <= 0) return;
  if (!crossfadeDur) { _handleGaplessPreBuffer(remaining); return; }
  _handleCrossfadeSetup(remaining);
}

/** @returns {number} */
export function getNextIdx() {
  if (repeat === 'one') return -1;
  if (radioActive) {
    const rq = getRadioQueue();
    if (rq && rq.length > 0) return trackIdx(rq[0]);
    return -1;
  }
  if (shuffle && shuffleQ.length > 0) return shuffleQ[0];
  const tracks = get('tracks'); // Phase 4
  const fl     = getFiltered();
  // Bug-4 FIX: tracks[curIdx] peut être undefined si la bibliothèque a muté (suppression
  // rapide) avant que curIdx soit mis à jour → filteredIdx(undefined) lèverait TypeError.
  if (!tracks[curIdx]) return -1;
  const pos    = filteredIdx(tracks[curIdx]); // P4 — O(1) via posMap
  if (pos >= 0 && pos < fl.length - 1) return trackIdx(fl[pos + 1]);
  if (repeat === 'all' && fl.length > 0) return trackIdx(fl[0]);
  return -1;
}

/**
 * Vide la file de shuffle (appelé par dupes.js / selection.js après suppression).
 * @returns {void}
 */
export function resetShuffleQ() { shuffleQ = []; }

/**
 * Ajuste les indices de la file de shuffle après la suppression d'une piste à l'index `idx`.
 * Appelé par app.js lors d'une suppression de piste (ctxDeleteTrack / confirmClear).
 * @param {number} idx
 * @returns {void}
 */
export function adjustShuffleQAfterDelete(idx) {
  shuffleQ = shuffleQ.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
}

// ── setManualQueue (exposée pour radio.js et queue.js) ───────────────────────
/**
 * @param {number[]} arr
 * @returns {void}
 */
export function setManualQueue(arr) {
  // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
  manualQueue = arr;
  set('manualQueue', manualQueue);
  // Réinitialiser le flag QUEUE-END dès qu'une nouvelle file non-vide est posée
  if (arr.length > 0) _queueEndedToastShown = false;
}

// ── Audio event listeners ─────────────────────────────────────────────────────
audio.addEventListener('play', () => {
  setIcon(true);
  emit(EVENTS.PLAY_STATE, { playing: true });
  updateMediaSessionState();
  // Si l'utilisateur relance manuellement pendant le fade sleep → restaurer le volume
  if (sleepFading) {
    const _vel = document.getElementById('vol');
    // @ts-ignore — vol is an input[type=range] with .value property
    const _targetVol = _vel ? parseFloat(_vel.value) : 1;
    // DSP-5 : restaurer via masterGainNode si disponible
    setMasterGain(_targetVol);
    setSleepFading(false);
    cancelSleepTimer(true);
  }
  // Visualiseur
  if (!eqCtx) initEQ();
  initViz();
  // @ts-ignore — _pendingVizMode holds a valid viz mode string set by setBootVizState
  if (_pendingVizMode)     { setVizMode(_pendingVizMode);    _pendingVizMode    = null; }
  if (_pendingVizDisabled) { setVizEnabled(false);           _pendingVizDisabled = false; }
  startViz();
  // Smart EQ : notifier du genre de la piste courante
  if (curIdx >= 0 && get('tracks')?.[curIdx]) {
    const _genre = get('tracks')[curIdx].genre || null; // Phase 4
    // @ts-ignore — 'currentTrackGenre' is a runtime-only store key not declared in AppState types
    set('currentTrackGenre', _genre);
    if (eqAutoMode) { updateSmartEQGenre(_genre); startSmartEQ(); }
  }
});

audio.addEventListener('pause', () => {
  setIcon(false);
  emit(EVENTS.PLAY_STATE, { playing: false });
  saveCfgNow();
  updateMediaSessionState();
  stopViz();
});

audio.addEventListener('ended', () => {
  saveCfgNow();
  // Mode sleep "fin de piste" : arrêter ici sans avancer
  if (sleepEndOfTrack) {
    cancelSleepTimer(true);
    audio.pause(); audio.src = '';
    toast(i18n('t_sleep_end_track_done'));
    return;
  }
  // Gapless : piste suivante déjà bufferisée → swap instantané
  if (_gaplessNextIdx >= 0 && audioNext && audioNext.src &&
      audioNext.src !== location.href && audioNext.readyState >= 3) {
    _commitGapless(); return;
  }
  _gaplessNextIdx = -1;
  next();
});

audio.addEventListener('error', () => {
  if (!audio.src || audio.src === location.href || audio.src === window.location.href) return;
  const code = audio.error?.code;
  // 3 = MEDIA_ERR_DECODE (corrompu), 4 = MEDIA_ERR_SRC_NOT_SUPPORTED (introuvable)
  const msg = code === 3 ? i18n('t_decode_err')
            : code === 4 ? i18n('t_not_found')
            :               i18n('t_playback_err');
  toast(msg, 'error');
  console.warn('[audio:error] code', code, audio.error?.message ?? '', audio.src.slice(-60));
  if (audio.src !== _audioErrSrc) { _audioErrSrc = audio.src; _audioErrCount = 0; }
  _audioErrCount++;
  // Skipper au suivant une seule fois par src — évite la boucle infinie sur même fichier
  if (_audioErrCount === 1) {
    _consecErrCount++;
    if (_consecErrCount >= 10) {
      // AUDIO-2 : circuit-breaker — bibliothèque entièrement corrompue → stoppe
      _consecErrCount = 0;
      toast(i18n('t_consec_errors'), 'error');
      return;
    }
    // B8 FIX : ne skipper que si la source qui a échoué est toujours chargée.
    // Si l'utilisateur a cliqué une autre piste pendant les 350 ms (encore en
    // cours de chargement → audio.paused vrai), next() la sauterait à tort.
    const _failedSrc = audio.src;
    setTimeout(() => { if (audio.paused && audio.src === _failedSrc) next(); }, 350);
  } else console.warn('[audio:error] erreur répétée sur la même src — pas de skip supplémentaire');
});

audio.addEventListener('playing', () => { _consecErrCount = 0; }); // AUDIO-2 : reset sur lecture réussie

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  checkCrossfade();
  updateMiniProgress();
  updateMiniOverlayProgress();
  const p   = audio.currentTime / audio.duration;
  const cur = fmt(audio.currentTime);
  const dur = fmt(audio.duration);
  if (_DOM.pfill) _DOM.pfill.style.transform = 'scaleX(' + p + ')';
  if (_DOM.tc) _DOM.tc.textContent = cur;
  if (_DOM.td) _DOM.td.textContent = dur;
  // A11Y : mettre à jour le slider ARIA (#pbar role=slider)
  if (pbar) {
    const pNow = Math.round(p * 100);
    // @ts-ignore — pNow is a number; setAttribute coerces to string at runtime
    pbar.setAttribute('aria-valuenow', pNow);
    pbar.setAttribute('aria-valuetext', `${cur} / ${dur}`);
  }
  updateCinemaProgress(p, cur, dur);
  // Sauvegarde de position throttlée — évite l'IDB flood à 60fps
  const now = Date.now();
  if (now - _lastPosSave > 5000) { _lastPosSave = now; saveCfg(); }
});
