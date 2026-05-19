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
import { VIRT }                                   from './virt.js';
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
};

/**
 * Invalide le cache rvProgFill quand renderRadioView() rebuide l'innerHTML.
 * @returns {void}
 */
export function clearRvProgFill() { _DOM.rvProgFill = null; }

// ── Seek bar ──────────────────────────────────────────────────────────────────
const pbar  = document.getElementById('pbar');
const pfill = document.getElementById('pfill');
let seeking   = false;
/** @type {DOMRect | null} */
let _seekRect = null;

const _seekTip = document.getElementById('seek-tip');

// FIX seek-tip : clamp la position pour éviter que le tooltip sorte du pbar.
// translateX(-50%) centre le tip sur le curseur. Sans clamp, aux bords (< 50% tip width
// ou > pbarW - 50% tip width), le tip débordait hors des limites visuelles.
/**
 * @param {number} ratio
 * @param {number} pbarW
 * @returns {string}
 */
function _clampSeekTipLeft(ratio, pbarW) {
  if (!_seekTip || !pbarW) return (ratio * 100).toFixed(1) + '%';
  const tipHalfW = (_seekTip.offsetWidth || 36) / 2;
  const minPx    = tipHalfW;
  const maxPx    = pbarW - tipHalfW;
  const posPx    = Math.max(minPx, Math.min(maxPx, ratio * pbarW));
  return (posPx / pbarW * 100).toFixed(1) + '%';
}

/** @param {number} ratio */
function _applySeekRatio(ratio) {
  ratio = Math.max(0, Math.min(1, ratio));
  audio.currentTime = ratio * audio.duration;
  if (pfill) pfill.style.transform = `scaleX(${ratio})`;
  // P2-1 : seek-tip pendant le drag
  if (_seekTip) {
    _seekTip.textContent = fmt(ratio * audio.duration);
    _seekTip.style.left  = _clampSeekTipLeft(ratio, _seekRect?.width || pbar?.clientWidth || 0);
    _seekTip.classList.add('on');
  }
}

if (pbar) {
  // Click ou drag sur la barre de progression → seek
  pbar.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    e.preventDefault();
    pbar.setPointerCapture(e.pointerId); // garde les événements même hors du pbar
    seeking   = true;
    _seekRect = pbar.getBoundingClientRect();
    _applySeekRatio((e.clientX - _seekRect.left) / _seekRect.width);
  });

  pbar.addEventListener('pointermove', (e) => {
    if (!seeking || !_seekRect || !audio.duration) return;
    _applySeekRatio((e.clientX - _seekRect.left) / _seekRect.width);
  });

  const _endSeek = () => {
    seeking = false;
    _seekRect = null;
    _seekTip?.classList.remove('on');
  };
  pbar.addEventListener('pointerup',     _endSeek);
  pbar.addEventListener('pointercancel', _endSeek); // stylet retiré, touch interrompue
  // AUDIO-4 FIX : fenêtre perd le focus (glisser hors WebView) → reset seeking
  window.addEventListener('blur', _endSeek);

  // P1-1 : seek-tip au survol sans drag
  pbar.addEventListener('mousemove', (e) => {
    if (seeking || !audio.duration || !_seekTip) return;
    const rect = pbar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _seekTip.textContent = fmt(frac * audio.duration);
    _seekTip.style.left  = _clampSeekTipLeft(frac, rect.width); // FIX : clamp aux bords comme le drag
    _seekTip.classList.add('on');
  });
  pbar.addEventListener('mouseleave', () => {
    if (!seeking) _seekTip?.classList.remove('on');
  });

  pbar.addEventListener('keydown', (e) => {
    const dur = audio.duration;
    if (!dur) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      audio.currentTime = Math.min(dur, audio.currentTime + step);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      audio.currentTime = Math.max(0, audio.currentTime - step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      audio.currentTime = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      audio.currentTime = dur;
    }
  });
}

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
    console.error('[ensureUrl]', e);
    return false;
  }
}

// ── setIcon ───────────────────────────────────────────────────────────────────
/**
 * Met à jour tous les boutons play/pause + icônes sidebar.
 * @param {boolean} playing
 * @returns {void}
 */
export function setIcon(playing) {
  invoke('taskbar_set_playing', { playing }).catch(() => {});
  // @ts-ignore — audio element guaranteed present in LibreFlow DOM (index.html)
  document.getElementById('ico-play').style.display  = playing ? 'none' : '';
  // @ts-ignore — audio element guaranteed present in LibreFlow DOM (index.html)
  document.getElementById('ico-pause').style.display = playing ? ''     : 'none';
  const ci = document.getElementById('cinema-ico-play');
  const cp = document.getElementById('cinema-ico-pause');
  if (ci) ci.style.display = playing ? 'none'  : 'block';
  if (cp) cp.style.display = playing ? 'block' : 'none';
  document.querySelector('.pcplay')?.classList.toggle('playing', playing);
  document.querySelector('.pcplay')?.setAttribute('aria-pressed', String(playing));
  document.querySelector('.sb-dot')?.classList.toggle('playing', playing);
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
  invalidateFilterCache();
  emit(EVENTS.FILTER_CHANGED, {});
  saveCfg();
}

// Starts immediate playback of a resolved off-filter track.
// INVARIANT: caller must call radioRefillQueue() BEFORE emit(TRACK_CHANGE).
function _playDirect(track, idx) {
  if (!track.url && track.path) track.url = convertFileSrc(track.path);
  curIdx = idx;
  set('curIdx', curIdx);
  clearCrossfadeTimers();
  // @ts-ignore — url guaranteed set by convertFileSrc above or by scan
  audio.src = track.url; ensureEQResumed(); audio.play().catch(() => {});
  _postPlaySideEffects(track);
  if (radioActive) radioRefillQueue(); // DOIT précéder TRACK_CHANGE (règle critique)
  emit(EVENTS.TRACK_CHANGE, { track, idx: curIdx });
  setTimeout(() => scrollToCurrentTrack(), 50);
  if (rgEnabled) analyzeAndApplyRG();
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

    // INP-1 : mise à jour visuelle synchrone avant le premier await
    curIdx = trackIdx(t.id);
    set('curIdx', curIdx);
    if (radioActive) radioRefillQueue(); // DOIT précéder TRACK_CHANGE (règle critique)
    emit(EVENTS.TRACK_CHANGE, { track: t, idx: curIdx });

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
      if (e.name !== 'AbortError') toast(i18n('t_play_start_err', e.message), 'error');
    }

    _postPlaySideEffects(t);
    // Mettre à jour le titre de la fenêtre : "Titre — Artiste | LibreFlow"
    // @ts-ignore — filter(Boolean) narrows to string[] at runtime; join returns string
    const _wTitle = [t.name, t.artistFull || t.artist].filter(Boolean).join(' — ');
    invoke('win_set_title', { title: _wTitle ? `${_wTitle} | LibreFlow` : 'LibreFlow' }).catch(() => {});
    if (!skipScroll) setTimeout(() => scrollToCurrentTrack(), 50);
    if (rgEnabled) analyzeAndApplyRG();
  } finally {
    _playLock = false;
  }
}

// BUG-D1-8 FIX: track whether audioNext was mid-crossfade when paused so we can resume it
let _crossfadeWasActive = false;

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
    audio.play().catch(() => {});
    // BUG-D1-8 FIX: resume audioNext if it was paused mid-crossfade
    if (_crossfadeWasActive && audioNext && audioNext.src && audioNext.src !== location.href) {
      audioNext.play().catch(() => {});
    }
    _crossfadeWasActive = false;
  } else {
    // BUG-D1-8 FIX: pause audioNext if crossfade is active so fade-in doesn't continue silently
    const cfActive = !!(cfFadeTimer || cfNextTimer || _cfRafId);
    if (cfActive && audioNext && !audioNext.paused) {
      audioNext.pause();
      _crossfadeWasActive = true;
    } else {
      _crossfadeWasActive = false;
    }
    audio.pause();
  }
}

/** @returns {void} */
export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (repeat === 'one') {
    clearCrossfadeTimers(); // BUG-D1-2 FIX: clear lingering crossfade timers before replay
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(() => {}); return;
  }
  const tracks = get('tracks'); // Phase 4
  const fl = getFiltered();
  const t  = tracks[curIdx];
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
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(() => {}); return;
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
    const _tq = tracks[ni];
    getFiltered(); // warm cache for filteredIdx O(1)
    const fi  = filteredIdx(_tq); // P4 — O(1)
    if (fi >= 0) { playAt(fi); return; }
    if (tracks[ni]) { _playDirect(tracks[ni], ni); return; }
  }

  // ── Radio active, file vide → recharger ──────────────────────────────────
  if (radioActive) {
    radioRefillQueue();
    if (manualQueue.length) {
      // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
      const ni = /** @type {number} */ (manualQueue.shift());
      set('manualQueue', [...manualQueue]);
      const _tq2 = tracks[ni];
      getFiltered(); // warm cache for filteredIdx O(1)
      const fi   = filteredIdx(_tq2); // P4 — O(1)
      if (fi >= 0) { playAt(fi); return; }
      if (tracks[ni]) { _playDirect(tracks[ni], ni); return; }
    }
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
      curIdx = ni; set('curIdx', curIdx);
      if (!shuffleQ.length && repeat !== 'none') buildQ(); // buildQ() APRÈS mise à jour de curIdx
      clearCrossfadeTimers();
      if (!tracks[ni].url && tracks[ni].path) tracks[ni].url = convertFileSrc(tracks[ni].path);
      // @ts-ignore — url guaranteed set by convertFileSrc above
      audio.src = tracks[ni].url; ensureEQResumed(); audio.play().catch(() => {});
      _postPlaySideEffects(tracks[ni]);
      if (radioActive) radioRefillQueue(); // DOIT précéder TRACK_CHANGE (règle critique)
      emit(EVENTS.TRACK_CHANGE, { track: tracks[ni], idx: curIdx });
      setTimeout(() => scrollToCurrentTrack(), 50);
      if (rgEnabled) analyzeAndApplyRG();
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

/** @returns {void} */
export function toggleLike() {
  if (curIdx < 0) return;
  const liked  = get('liked'); // Phase 4
  const tracks = get('tracks'); // Phase 4
  const trackId = tracks[curIdx]?.id;
  if (!trackId) return;
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked); // notifier les subscribers (mutation in-place sinon invisible)
  const isLiked = liked.has(trackId);
  const btns = [
    document.getElementById('pl-lk'),
    document.getElementById('cinema-lk'),
  ].filter(Boolean);
  btns.forEach(btn => {
    if (!btn) return; // filter(Boolean) guarantees non-null at runtime; guard for TS
    btn.classList.toggle('on', isLiked);
    btn.setAttribute('aria-pressed', String(isLiked));
    btn.classList.remove('popping');
    // @ts-ignore — btn is HTMLElement at runtime, Element type lacks offsetWidth
    void btn.offsetWidth;
    btn.classList.add('popping');
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
  });
  // NowPlaying panel like button — classe 'active' (pas 'on'), SVG fill aussi
  const npBtn = document.querySelector('.np-lk');
  if (npBtn) {
    npBtn.classList.toggle('active', isLiked);
    npBtn.setAttribute('aria-pressed', String(isLiked));
    const svg = npBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
    npBtn.classList.remove('popping');
    // @ts-ignore — npBtn is HTMLElement at runtime, Element type lacks offsetWidth
    void npBtn.offsetWidth;
    npBtn.classList.add('popping');
    npBtn.addEventListener('animationend', () => npBtn.classList.remove('popping'), { once: true });
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); // Jalon 4
  if (get('view') === 'liked') emit(EVENTS.RENDER_LIB, {}); // Jalon 4
  saveCfgNow();
  _allPlayerUI();
}

/**
 * @param {Event} e
 * @param {string} trackId
 * @param {Element | null} [el]
 * @returns {void}
 */
export function likeat(e, trackId, el) {
  e.stopPropagation();
  if (!trackId) return;
  const liked = get('liked'); // Phase 4
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked); // notifier les subscribers (mutation in-place sinon invisible)
  // MEM-4 FIX: e.currentTarget est `document` dans un listener délégué → utiliser el si fourni
  // @ts-ignore — Element vs Document comparison intentional (delegated listener guard)
  const btn = el instanceof Element ? el : (e.currentTarget instanceof Element && e.currentTarget !== document ? e.currentTarget : null);
  if (btn) {
    btn.classList.remove('popping');
    // @ts-ignore — btn is HTMLElement at runtime, Element type lacks offsetWidth
    void btn.offsetWidth;
    btn.classList.add('popping');
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
    btn.setAttribute('aria-pressed', String(liked.has(trackId))); // A11Y: aria-pressed reflect
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); // Jalon 4
  if (VIRT) VIRT._lastListSig = '';
  const tlist = document.getElementById('tlist');
  const savedScroll = tlist ? tlist.scrollTop : 0;
  emit(EVENTS.RENDER_LIB, {}); // Jalon 4
  if (tlist && get('view') === 'liked') requestAnimationFrame(() => { tlist.scrollTop = savedScroll; });
  saveCfg();
}

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

/** @returns {void} */
export function initCrossfadeAudio() {
  // BUG-D1-10 FIX: if audioNext exists but is in a non-ended state (e.g. was already playing
  // mid-crossfade before clearCrossfadeTimers was called and immediately re-called), tear it
  // down cleanly rather than trying to re-use a potentially stale MediaElementSource.
  if (audioNext && audioNextSource) {
    // Already fully wired — skip re-init only if the AudioContext is still valid
    if (eqCtx && eqCtx.state !== 'closed') return;
    // AudioContext is closed/invalid — fall through to rebuild below
    try { audioNextSource?.disconnect(); } catch {}
    try { audioNextGain?.disconnect(); } catch {}
    try { audioNextRgGain?.disconnect(); } catch {}
    audioNext.pause(); audioNext.src = '';
    audioNext = null; audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
  }

  // BUG-D1-10 FIX: if audioNext exists but source was never created (partial init), reset it
  if (audioNext && !audioNextSource) {
    audioNext.pause(); audioNext.src = '';
    audioNext = null;
  }

  audioNext = new Audio();
  audioNext.crossOrigin = 'anonymous';
  audioNext.preload = 'auto';
  // GAPLESS-1 FIX : hériter la vitesse courante
  if (playbackSpeed !== 1) audioNext.playbackRate = playbackSpeed;

  // Connecter audioNext au graph Web Audio (EQ + RG)
  // DSP-7 graph : audioNext → audioNextSource → audioNextRgGain → audioNextGain → eqNodes[0]
  //   audioNextRgGain : compensation ReplayGain (valeur stable, définie au lancement du CF)
  //   audioNextGain   : fondu 0→1 pur (forme cosinus)
  if (!eqCtx) initEQ();
  // ARCH-10: réagir aux suspensions/interruptions de l'AudioContext (tab cachée, sleep OS,
  // politique autoplay) — évite le silence silencieux sans intervention de l'utilisateur.
  if (eqCtx && !eqCtx.onstatechange) {
    eqCtx.onstatechange = () => {
      if (eqCtx.state === 'suspended' || eqCtx.state === 'interrupted') {
        ensureEQResumed();
      }
    };
  }
  if (eqCtx && eqCtx.state !== 'closed' && !audioNextSource) {
    try {
      audioNextSource = eqCtx.createMediaElementSource(audioNext);
      audioNextRgGain = eqCtx.createGain();
      audioNextRgGain.gain.value = 1.0; // neutre par défaut
      audioNextGain   = eqCtx.createGain();
      audioNextGain.gain.value = 0;     // muet au départ — sera 0→1 pendant le fondu
      // @ts-ignore — audioNextSource just assigned above, guaranteed non-null here
      audioNextSource.connect(audioNextRgGain);
      audioNextRgGain.connect(audioNextGain);
      if (eqNodes.length > 0) {
        audioNextGain.connect(eqNodes[0]);
      } else {
        audioNextGain.connect(eqCtx.destination);
      }
    } catch(e) {
      // BUG-D1-10 FIX: catch InvalidStateError or other AudioNode creation failures
      console.warn('[crossfade initAudio]', e);
      // Tear down the partially-created element to avoid leaking a source-less Audio node
      if (audioNext) { audioNext.pause(); audioNext.src = ''; audioNext = null; }
      audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
    }
  }
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
    audioNextGain.gain.value = 0;
  }
  // DSP-7: reset du nœud RG dédié
  if (audioNextRgGain && eqCtx) {
    audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime);
    audioNextRgGain.gain.value = 1.0;
  }
  // DSP-6: reset audioOutGain (fade-out source primaire)
  if (audioOutGain && eqCtx) {
    audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);
    audioOutGain.gain.value = 1.0;
  }
  if (!sleepFading) {
    // DSP-5 : restaurer audio.volume depuis le slider DOM (JAMAIS hardcoder 1.0)
    const vel = document.getElementById('vol');
    // @ts-ignore — vol is an input[type=range] with .value property
    setMasterGain(vel ? parseFloat(vel.value) : (masterGainNode ? masterGainNode.gain.value : 1));
  }
  if (audioNextGain && !eqCtx) audioNextGain.gain.value = 0;
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
  const ni  = _gaplessNextIdx;
  _gaplessNextIdx = -1;
  const tracks = get('tracks'); // Phase 4
  const nt  = tracks[ni];
  if (!nt || !_trackIdxMap?.has(nt.id)) { clearCrossfadeTimers(); next(); return; }
  const validIdx = trackIdx(nt);
  if (validIdx < 0) { clearCrossfadeTimers(); next(); return; }

  curIdx = validIdx;
  set('curIdx', curIdx);
  // @ts-ignore — audioNext guaranteed by initCrossfadeAudio() in checkCrossfade gapless path
  const gSrc = audioNext.src; // même URL déjà en cache browser
  clearCrossfadeTimers();     // restaure audio.volume + audioNextGain=0
  audio.src = gSrc;
  if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
  ensureEQResumed();
  audio.play().catch(() => {});

  _postPlaySideEffects(nt);
  if (radioActive) radioRefillQueue();
  emit(EVENTS.TRACK_CHANGE, { track: nt, idx: curIdx });
  setTimeout(() => scrollToCurrentTrack(), 50);
  if (rgEnabled) analyzeAndApplyRG();
}

// Appelé depuis timeupdate — gère le pré-buffer gapless ET le lancement du crossfade
/** @returns {void} */
export function checkCrossfade() {
  if (curIdx < 0 || audio.paused) return;
  if (sleepFading) return; // le sleep fade gère son propre volume
  const remaining = audio.duration - audio.currentTime;
  if (isNaN(remaining) || remaining <= 0) return;

  // ── Gapless pre-buffer (crossfadeDur=0) ──────────────────────────────────
  if (!crossfadeDur && remaining < 3.0 && _gaplessNextIdx < 0 && !cfFadeTimer) {
    const _gni = getNextIdx();
    if (_gni >= 0 && _gni !== curIdx) {
      const tracks = get('tracks'); // Phase 4
      const _gnt = tracks[_gni];
      if (_gnt) {
        _gaplessNextIdx = _gni;
        initCrossfadeAudio();
        ensureUrl(_gnt).then(ok => {
          if (!ok || crossfadeDur || _gaplessNextIdx !== _gni) { _gaplessNextIdx = -1; return; }
          // @ts-ignore — url guaranteed set by ensureUrl(ok) above
          if (audioNext) { audioNext.src = _gnt.url; audioNext.preload = 'auto'; }
        }).catch(() => { _gaplessNextIdx = -1; }); // évite _commitGapless sur src invalide
      }
    }
  }

  // ── Crossfade (crossfadeDur > 0) ─────────────────────────────────────────
  if (!crossfadeDur || remaining > crossfadeDur + 0.2) return;
  if (cfFadeTimer || _cfPending) return; // guard étendu — protège pendant l'await ensureUrl

  const nextIdx = getNextIdx();
  if (nextIdx < 0 || nextIdx === curIdx) return;
  const tracks    = get('tracks'); // Phase 4
  const nextTrack = tracks[nextIdx];
  if (!nextTrack) return;

  initCrossfadeAudio();

  const _myCfGen = _cfGen; // capturer avant tout await / setTimeout
  _cfPending = true;
  ensureUrl(nextTrack).then(ok => {
    _cfPending = false;
    if (!ok || cfFadeTimer || audio.paused) return;
    // CROSSFADE-RACE FIX : vérifier que clearCrossfadeTimers() n'a pas été appelé
    if (_cfGen !== _myCfGen) return;

    // @ts-ignore — audioNext guaranteed by initCrossfadeAudio(); url guaranteed by ensureUrl(ok)
    audioNext.src = nextTrack.url;
    if (audioNextGain) audioNextGain.gain.value = 0;

    const startDelay = 80;
    const _genAtStart = _cfGen;
    setTimeout(() => {
      if (_cfGen !== _genAtStart) return;
      // R-4 : eqCtx peut être suspendu après sleep OS → reprendre avant audioNext.play()
      ensureEQResumed();
      // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
      audioNext.play().catch(() => {});
    }, startDelay);

    const durationMs = crossfadeDur * 1000;
    // B1 FIX : != null pour accepter rgGain=0 (niveau cible atteint) ; cap 3.162 ≈ +10 dB max
    const rgGainVal  = (rgEnabled && nextTrack.rgGain != null) ? Math.min(CFG.RG_GAIN_CAP, nextTrack.rgGain) : 1;

    // DSP-7: appliquer la compensation RG sur le nœud dédié (stable, indépendant du fondu)
    if (audioNextRgGain && eqCtx) {
      audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioNextRgGain.gain.setValueAtTime(rgGainVal, eqCtx.currentTime);
    }

    // ── Fade-in via AudioParam (equal-power, 0→1 pur — RG géré par audioNextRgGain) ─
    if (audioNextGain && eqCtx) {
      audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioNextGain.gain.setValueAtTime(0, eqCtx.currentTime);
      audioNextGain.gain.setValueCurveAtTime(FADE_IN_CURVE, eqCtx.currentTime, crossfadeDur);
    }

    // ── DSP-6 : Fade-out via audioOutGain (sample-accurate, AudioParam) ────
    // Remplace le rAF audio.volume loop — plus propre, synchronisé avec le fade-in.
    // Skippé si sleepFading (le masterGainNode gère déjà la baisse de volume globale).
    if (!sleepFading && audioOutGain && eqCtx) {
      audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioOutGain.gain.setValueAtTime(1.0, eqCtx.currentTime);
      audioOutGain.gain.setValueCurveAtTime(FADE_OUT_CURVE, eqCtx.currentTime, crossfadeDur);
    }

    // ── Transition finale ─────────────────────────────────────────────────
    cfFadeTimer = setTimeout(() => {
      cfFadeTimer = null;
      if (_cfRafId) { cancelAnimationFrame(_cfRafId); _cfRafId = null; }

      // BUG FIX : revalider la piste — elle peut avoir été supprimée pendant le fondu
      const validNextIdx = _trackIdxMap?.has(nextTrack.id)
        ? trackIdx(nextTrack) : -1;

      // Helper local : reset des nœuds de gain après transition
      function _resetGains() {
        if (audioNextGain && eqCtx) { audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextGain.gain.value = 0; }
        if (audioNextRgGain && eqCtx) { audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextRgGain.gain.value = 1.0; }
        // DSP-6 : restaurer audioOutGain à 1.0 pour la nouvelle piste principale
        if (audioOutGain && eqCtx) { audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime); audioOutGain.gain.value = 1.0; }
        // DSP-5 : restaurer audio.volume depuis le slider DOM (JAMAIS hardcoder 1.0)
        // @ts-ignore — vol is an input[type=range] with .value property
        if (!sleepFading) { const _vel = document.getElementById('vol'); setMasterGain(_vel ? parseFloat(_vel.value) : (masterGainNode ? masterGainNode.gain.value : 1)); }
      }

      if (validNextIdx < 0) {
        audio.pause();
        _resetGains();
        // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
        audioNext.pause(); audioNext.src = '';
        return;
      }

      // BUG-6 FIX : sauvegarder la position AVANT de pauser audioNext (évite reset à 0)
      // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
      const _cfPos = audioNext.currentTime;
      audio.pause();
      curIdx = validNextIdx;
      set('curIdx', curIdx);
      // @ts-ignore — url guaranteed set by ensureUrl(ok) above
      audio.src = nextTrack.url;
      if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
      // Continuer depuis la position du fondu (ne pas repartir de 0)
      if (_cfPos > 0.05) audio.currentTime = _cfPos;
      _resetGains();
      ensureEQResumed(); audio.play().catch(() => {});
      // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
      audioNext.pause(); audioNext.src = '';

      if (rgEnabled) analyzeAndApplyRG();
      _postPlaySideEffects(nextTrack);
      if (radioActive) radioRefillQueue(); // DOIT précéder TRACK_CHANGE (règle critique)
      emit(EVENTS.TRACK_CHANGE, { track: nextTrack, idx: curIdx });
      setTimeout(() => scrollToCurrentTrack(), 50);
      if (queueOpen) renderQueue();
      // Avancer shuffleQ si la piste suivante en est issue
      if (shuffle && shuffleQ.length > 0 && shuffleQ[0] === validNextIdx) {
        shuffleQ.shift();
        if (!shuffleQ.length && repeat !== 'none') buildQ();
      }
    }, durationMs + 50); // +50 ms de marge pour les ramps AudioParam
  }).catch(() => { _cfPending = false; });
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

// ── MediaSession ──────────────────────────────────────────────────────────────
/**
 * @param {Track} t
 * @returns {void}
 */
export function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  const artSrc  = t._b64 || (t.art && !t.art.startsWith('blob:') ? t.art : null);
  // AUDIO-5 : détecter le vrai MIME depuis le data: URI ou l'extension de l'URL
  // (FLAC/WAV embarquent souvent une pochette PNG → 'image/jpeg' hardcodé = rendu cassé)
  const artMime = artSrc && artSrc.startsWith('data:')
    ? artSrc.slice(5, artSrc.indexOf(';'))
    : artSrc && /\.png($|\?)/i.test(artSrc) ? 'image/png'
    : artSrc && /\.webp($|\?)/i.test(artSrc) ? 'image/webp'
    : 'image/jpeg';
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  t.name,
    artist: t.artistFull || t.artist || '',
    album:  t.album || '',
    artwork: artSrc ? [
      { src: artSrc, sizes: '96x96',   type: artMime },
      { src: artSrc, sizes: '128x128', type: artMime },
      { src: artSrc, sizes: '256x256', type: artMime },
      { src: artSrc, sizes: '512x512', type: artMime },
    ] : [],
  });
}

/** @returns {void} */
export function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',          () => { ensureEQResumed(); audio.play().catch(() => {}); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('pause',         () => { audio.pause(); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack',     () => next(true));
  navigator.mediaSession.setActionHandler('seekto',        e  => { if (e.seekTime !== undefined && !isNaN(audio.duration)) audio.currentTime = e.seekTime; });
  navigator.mediaSession.setActionHandler('seekbackward',  e  => { audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); });
  navigator.mediaSession.setActionHandler('seekforward',   e  => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (e.seekOffset || 10)); });
  // @ts-ignore — 'togglefavorite' is a non-standard Media Session action (try/catch handles runtime errors)
  try { navigator.mediaSession.setActionHandler('togglefavorite', () => toggleLike()); } catch(_) {}
}

/** @returns {void} */
export function updateMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  if (!isNaN(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration:     audio.duration,
        playbackRate: audio.playbackRate || 1,
        position:     Math.min(audio.currentTime, audio.duration),
      });
    } catch(e) {}
  }
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
    setTimeout(() => { if (audio.paused) next(); }, 350);
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
