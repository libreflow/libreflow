// @ts-check
/** player.js — Moteur de lecture. Émet EVENTS.TRACK_CHANGE et EVENTS.PLAY_STATE. */
/** @import { Track } from './types.js' */
import { emit, EVENTS }                           from './bus.js';
import { get, set, subscribe }                    from './store.js';
import { i18n }                                   from './i18n.js';
import { invoke, convertFileSrc }                 from './ipc.js';
import { fmt }                                    from './utils.js';
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
/** @type {string | null} */
let _pendingVizMode     = null; // boot viz state
let _pendingVizDisabled = false;
/** Transmet la config viz depuis app.js boot sans window.*. */
export function setBootVizState(mode, disabled) {
  _pendingVizMode     = mode ?? null;
  _pendingVizDisabled = !!disabled;
}
// ── Audio element / cached DOM refs ──────────────────────────────────────────
export const audio = /** @type {HTMLAudioElement} */ (document.getElementById('audio'));
audio.crossOrigin = 'anonymous';
const _DOM = { // cached at module init — avoids getElementById at 60fps in timeupdate
  pfill:      document.getElementById('pfill'),
  tc:         document.getElementById('tc'),
  td:         document.getElementById('td'),
  rvProgFill: null, // lazy-init à la première vue radio
  pcplay:     document.querySelector('.pcplay'),
  sbDot:      document.querySelector('.sb-dot'),
};

/** Invalide le cache rvProgFill quand renderRadioView() rebuild l'innerHTML. */
export function clearRvProgFill() { _DOM.rvProgFill = null; }
let curIdx        = get('curIdx');        // playback state (initialized from store)
let shuffle       = get('shuffle');       // false
/** @type {number[]} */
let shuffleQ      = [];
let repeat        = get('repeat');        // 'none'
let manualQueue   = get('manualQueue');   // []
let recentPlays   = (get('recentPlays') || []).slice(0, 50);   // []
let playbackSpeed = get('playbackSpeed'); // 1
let crossfadeDur  = get('crossfadeDur');  // 0
/** @type {ReturnType<typeof setTimeout> | null} */ let cfFadeTimer = null; // crossfade internals
/** @type {ReturnType<typeof setTimeout> | null} */ let cfNextTimer = null;
let _cfRafId    = null; // rAF id anti-race
let _cfGen      = 0;    // token incrémenté à chaque clearCrossfadeTimers()
let _cfPending  = false; // guard anti-race pour l'await ensureUrl
/** @type {HTMLAudioElement | null} */
export let audioNext = null;
/** @type {MediaElementAudioSourceNode | null} */ let audioNextSource = null;
/** @type {GainNode | null} */ let audioNextGain   = null; // fade-in 0→1
/** @type {GainNode | null} */ let audioNextRgGain = null; // DSP-7: RG indépendant
let _gaplessNextIdx        = -1;
const CURVE_LEN      = 128; // crossfade curves — precomputed (avoids reallocation)
const FADE_IN_CURVE  = new Float32Array(CURVE_LEN + 1);
const FADE_OUT_CURVE = new Float32Array(CURVE_LEN + 1);
for (let _i = 0; _i <= CURVE_LEN; _i++) {
  FADE_IN_CURVE[_i]  = Math.sin((_i / CURVE_LEN) * Math.PI / 2); // 0→1 cosinus pur
  FADE_OUT_CURVE[_i] = Math.cos((_i / CURVE_LEN) * Math.PI / 2); // 1→0 cosinus pur
}
let _playLock              = false; // session flags
let _audioErrSrc           = '';
let _audioErrCount         = 0;
let _consecErrCount        = 0;  // AUDIO-2: circuit-breaker, reset on 'playing', stops at 10
let _lastPosSave           = 0;
let _queueEndedToastShown  = false;
let _recentFilterToastShown= false;
subscribe('curIdx',        v => { curIdx        = v; }); // store subscriptions — keep locals in sync
subscribe('shuffle',       v => { shuffle       = v; });
subscribe('repeat',        v => { repeat        = v; });
subscribe('manualQueue',   v => { manualQueue   = v; });
subscribe('recentPlays',   v => { recentPlays   = v; });
subscribe('playbackSpeed', v => { playbackSpeed = v; });
subscribe('crossfadeDur',  v => { crossfadeDur  = v; });
subscribe('sort',          () => { _recentFilterToastShown = false; });
subscribe('query',         () => { _recentFilterToastShown = false; });
/** @param {Track} t @returns {Promise<boolean>} */
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
let _pressListenerEl = null; // element reference so replacement survives DOM updates
function _attachPressListener() {
  const btn = document.querySelector('.pcplay');
  if (!btn || btn === _pressListenerEl) return;
  btn.addEventListener('pointerdown', () => playPausePress(btn));
  _pressListenerEl = btn;
}

export function setIcon(playing) {
  invoke('taskbar_set_playing', { playing }).catch((e) => console.warn('[taskbar_set_playing]', e));
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

function _updateRecentPlays(trackId) {
  recentPlays = [trackId, ...recentPlays.filter(id => id !== trackId)].slice(0, 50);
  set('recentPlays', recentPlays);
}
function _postPlaySideEffects(track) { // ORDER IS FIXED — do not reorder
  _updateRecentPlays(track.id);
  logPlay(track);
  invalidateFilterCache(); // PERF-H5: invalidate without emitting FILTER_CHANGED on every play
  saveCfg();
}

function _playDirect(track, idx) { // off-filter tracks; radioRefillQueue() MUST precede emit(TRACK_CHANGE)
  if (_playLock) return; // R2-A: prevent double TRACK_CHANGE during concurrent crossfade+radio
  _playLock = true;
  try {
    if (!track.url && track.path) track.url = convertFileSrc(track.path);
    curIdx = idx;
    set('curIdx', curIdx);
    clearCrossfadeTimers();
    audio.src = track.url; ensureEQResumed(); // @ts-ignore — url guaranteed set by convertFileSrc
    audio.play().catch((e) => {
      if (e?.name !== 'AbortError') toast(i18n('t_play_start_err', e?.message), 'error');
    });
    _postPlaySideEffects(track);
    const _afterRefill = () => {
      emit(EVENTS.TRACK_CHANGE, { track, idx: curIdx });
      setTimeout(() => scrollToCurrentTrack(), 50);
      if (rgEnabled) analyzeAndApplyRG();
    };
    if (radioActive) {
      radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e)).then(_afterRefill);
    } else {
      _afterRefill();
    }
  } finally {
    _playLock = false;
  }
}

/** @param {number} filteredIdx @param {{ skipScroll?: boolean, keepQueue?: boolean }} [opts] */
export async function playAt(filteredIdx, { skipScroll = false, keepQueue = false } = {}) {
  if (_playLock) return;
  _playLock = true;
  try {
    const fl = getFiltered();
    const t  = fl[filteredIdx];
    if (!t) return;

    curIdx = trackIdx(t.id);
    set('curIdx', curIdx);
    if (radioActive) radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e)); // MUST precede TRACK_CHANGE
    const ok = await ensureUrl(t);
    if (!ok) { toast(i18n('t_not_found'), 'error'); return; }
    if (!_trackIdxMap?.has(t.id)) return; // RACE-1: track deleted during await
    if (!keepQueue) clearQueueOverride();
    clearCrossfadeTimers(); // MUST precede audio.src (avoids volume=0 on start)
    audio.src = t.url; // @ts-ignore — url guaranteed by ensureUrl()
    if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
    ensureEQResumed();
    try { await audio.play(); } catch(e) {
      if (e.name === 'AbortError') return; // track replaced mid-play — new playAt will emit TRACK_CHANGE
      toast(i18n('t_play_start_err', e.message), 'error');
      return;
    }

    emit(EVENTS.TRACK_CHANGE, { track: t, idx: curIdx }); // RACE-4: after audio.play()
    _postPlaySideEffects(t);
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
export function togglePlay() {
  if (curIdx < 0) { if (getFiltered().length) playAt(0); return; }
  if (audio.paused) {
    ensureEQResumed();
    audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] togglePlay() failed:', e); });
  } else {
    if (cfFadeTimer || cfNextTimer || _cfRafId) clearCrossfadeTimers(); // B3: cancel crossfade
    audio.pause();
  }
}
export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (repeat === 'one') {
    clearCrossfadeTimers();
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] prev repeat:one play() failed:', e); }); return;
  }
  const tracks = get('tracks');
  const fl = getFiltered();
  const t  = tracks[curIdx];
  if (!t) return; // Bug-5: curIdx can be out-of-bounds after rapid deletion
  const fi = filteredIdx(t);
  if (get('sort') === 'recent' && get('view') === 'all') {
    if (get('query') && !_recentFilterToastShown) { _recentFilterToastShown = true; toast(i18n('t_recent_ignores_filter'), 'info'); }
    const ni = curIdx - 1;
    if (ni >= 0) {
      const _tn = tracks[ni];
      const nfi = filteredIdx(_tn);
      if (nfi >= 0) { playAt(nfi); return; }
      _playDirect(tracks[ni], ni);
    } else if (repeat === 'all') playAt(fl.length - 1);
    return;
  }
  if (shuffle) { // BUG-7: navigate via recentPlays history, not fi-1
    const prevId = recentPlays[1];
    if (prevId) {
      // @ts-ignore — has() guard ensures get() is defined; -1 fallback is number
      const prevTi = /** @type {number} */ (_trackIdxMap.has(prevId) ? _trackIdxMap.get(prevId) : -1);
      if (prevTi >= 0) {
        const _pt    = tracks[prevTi];
        const prevFi = filteredIdx(_pt);
        if (prevFi >= 0) { playAt(prevFi); return; }
        _playDirect(_pt, prevTi);
        return;
      }
    }
    return;
  }
  if (fi < 0) return;
  if (fi > 0) playAt(fi - 1); else if (repeat === 'all' && fl.length > 0) playAt(fl.length - 1); // BUG-D1-3
}

/** Peek next track without mutating state. Priority: manual queue > radio > repeat:one > shuffle > sequential. @returns {import('./types.js').Track | null} */
export function peekNext() {
  const tracks = get('tracks');
  if (!tracks?.length || curIdx < 0) return null;
  if (manualQueue.length) { return tracks[/** @type {number} */ (manualQueue[0])] ?? null; }
  if (radioActive) { const rq = getRadioQueue(); return rq?.[0] ?? null; }
  if (repeat === 'one') return tracks[curIdx] ?? null;
  if (shuffle && shuffleQ.length) { return tracks[/** @type {number} */ (shuffleQ[0])] ?? null; }
  if (shuffle && repeat !== 'none') { // Bug-7: shuffleQ exhausted — preview next track to avoid null→gapless stop
    const fl = getFiltered();
    // @ts-ignore — _trackIdxMap.get() returns number; curIdx comparison is safe
    const fallback = fl.find(t => _trackIdxMap?.get(t.id) !== curIdx);
    if (fallback) return fallback;
  }
  if (get('sort') === 'recent' && get('view') === 'all') {
    const ni = curIdx + 1;
    if (ni < tracks.length) {
      const _tn = tracks[ni];
      if (filteredIdx(_tn) >= 0) return _tn;
    }
    return (repeat === 'all' && tracks.length > 0) ? tracks[0] : null;
  }
  const fl = getFiltered();
  const t  = tracks[curIdx];
  if (!t) return null;
  const fi = filteredIdx(t);
  if (fi < 0) return null;
  if (fi + 1 < fl.length) return fl[fi + 1];
  return (repeat === 'all' && fl.length > 0) ? fl[0] : null;
}

export function next(manual = false) { // manual=true: explicit (ignores repeat:one). false: from 'ended'.
  if (repeat === 'one' && !manual) {
    clearCrossfadeTimers();
    audio.currentTime = 0; ensureEQResumed(); audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[player] next repeat:one play() failed:', e); }); return;
  }
  const tracks = get('tracks');
  if (manualQueue.length) {
    const _wasLastInQueue = manualQueue.length === 1;
    // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
    const ni = /** @type {number} */ (manualQueue.shift());
    set('manualQueue', [...manualQueue]);
    if (_wasLastInQueue && !radioActive && !_queueEndedToastShown) {
      _queueEndedToastShown = true;
      setTimeout(() => toast(i18n('t_queue_ended'), 'info'), 400);
    }
    if (ni < 0 || ni >= tracks.length || !tracks[ni]) return; // Bug-2: bounds guard after deletion
    const _tq = tracks[ni];
    getFiltered(); // warm cache for filteredIdx O(1)
    const fi  = filteredIdx(_tq);
    if (fi >= 0) { playAt(fi); return; }
    if (tracks[ni]) { _playDirect(tracks[ni], ni); return; }
  }

  if (radioActive) {
    radioRefillQueue() // BUG-HIGH: async — consume manualQueue in .then() (refill BEFORE UI, §2)
      .then(() => {
        if (manualQueue.length) {
          // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
          const ni = /** @type {number} */ (manualQueue.shift());
          set('manualQueue', [...manualQueue]);
          if (ni < 0 || ni >= tracks.length || !tracks[ni]) return; // Bug-2b: bounds guard
          const _tq2 = tracks[ni];
          getFiltered();
          const fi   = filteredIdx(_tq2);
          if (fi >= 0) { playAt(fi); return; }
          if (tracks[ni]) { _playDirect(tracks[ni], ni); }
        } else {
          console.warn('[radio] manualQueue vide après refill — retry dans 500 ms');
          setTimeout(() => { if (radioActive) next(); }, 500);
        }
      })
      .catch(e => console.warn('[radio] refill failed:', e));
    return;
  }

  if (shuffle && shuffleQ.length) {
    // @ts-ignore — shuffleQ.length guard ensures shift() is defined
    const ni = /** @type {number} */ (shuffleQ.shift());
    const _ts = tracks[ni];
    getFiltered();
    const fi  = filteredIdx(_ts);
    if (fi >= 0) { playAt(fi); return; }
    if (tracks[ni]) {
      _playDirect(tracks[ni], ni); // B15: canonical off-filter path, buildQ() after
      if (!shuffleQ.length && repeat !== 'none') buildQ();
    }
    return;
  }

  const fl = getFiltered();
  const t  = tracks[curIdx];
  const fi = filteredIdx(t);
  if (get('sort') === 'recent' && get('view') === 'all') {
    if (get('query') && !_recentFilterToastShown) { _recentFilterToastShown = true; toast(i18n('t_recent_ignores_filter'), 'info'); }
    const ni = curIdx + 1;
    if (ni < tracks.length) {
      const _tn = tracks[ni];
      const nfi = filteredIdx(_tn);
      if (nfi >= 0) { playAt(nfi); return; }
      _playDirect(tracks[ni], ni);
    } else if (repeat === 'all') playAt(0);
    return;
  }
  if (fi < 0) return;
  if (fi < fl.length - 1) playAt(fi + 1); else if (repeat === 'all') playAt(0);
}

/** Builds shuffle queue from current filtered view. */
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
export function toggleRepeat() {
  const m = ['none', 'all', 'one'];
  // @ts-ignore — m[] is a string[] but values are valid RepeatMode literals
  repeat = m[(m.indexOf(repeat) + 1) % 3];
  set('repeat', repeat);
  const isOn = repeat !== 'none';
  const ariaPressed = repeat === 'none' ? 'false' : repeat === 'all' ? 'true' : 'mixed'; // A11Y: WAI-ARIA tri-state
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
export { toggleLike, likeat } from './player-likes.js';
/** @param {number} speed */
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
  const liveEl = document.getElementById('np-speed-live'); // A11Y: aria-live speed announcement
  if (liveEl) liveEl.textContent = i18n('spd_label', speed);
}
export function setCrossfade(sec) {
  crossfadeDur = sec;
  set('crossfadeDur', crossfadeDur);
  const disp = document.getElementById('cf-val-disp');
  if (disp) disp.textContent = sec + 's';
  const slider = document.getElementById('cf-slider');
  if (slider) {
    /** @type {any} */ (slider).value = sec;
    slider.style.setProperty('--cf-pct', (sec / 12 * 100) + '%');
  }
  saveCfg();
}

/** @returns {HTMLAudioElement} Crée l'élément Audio pour le crossfade et hérite la vitesse courante. */
function _createAudioNextElement() {
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  if (playbackSpeed !== 1) el.playbackRate = playbackSpeed; // GAPLESS-1 FIX
  return el;
}
function _connectAudioNextToGraph() { // DSP-7: audioNext → src → RgGain → Gain → eqNodes[0]
  if (!eqCtx || eqCtx.state === 'closed' || audioNextSource) return;
  try {
    audioNextSource = eqCtx.createMediaElementSource(/** @type {HTMLAudioElement} */ (audioNext));
    audioNextRgGain = eqCtx.createGain();
    audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.001);
    audioNextGain   = eqCtx.createGain();
    audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.001);
    // @ts-ignore — audioNextSource just assigned above, guaranteed non-null here
    audioNextSource.connect(audioNextRgGain);
    audioNextRgGain.connect(audioNextGain);
    audioNextGain.connect(eqNodes.length > 0 ? eqNodes[0] : eqCtx.destination);
  } catch(e) {
    console.warn('[crossfade initAudio]', e); // BUG-D1-10: catch InvalidStateError
    if (audioNext) { audioNext.pause(); audioNext.src = ''; audioNext = null; }
    audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
  }
}

export function initCrossfadeAudio() { // BUG-D1-10: tear down stale/partial audioNext before re-init
  if (audioNext && audioNextSource) {
    if (eqCtx && eqCtx.state !== 'closed') return;
    try { audioNextSource?.disconnect(); } catch {}
    try { audioNextGain?.disconnect(); } catch {}
    try { audioNextRgGain?.disconnect(); } catch {}
    audioNext.pause(); audioNext.src = '';
    audioNext = null; audioNextSource = null; audioNextGain = null; audioNextRgGain = null;
  }
  if (audioNext && !audioNextSource) { audioNext.pause(); audioNext.src = ''; audioNext = null; }
  audioNext = _createAudioNextElement();
  if (!eqCtx) initEQ();
  if (eqCtx && !eqCtx.onstatechange) { // ARCH-10: handle AudioContext suspensions
    eqCtx.onstatechange = () => {
      if (eqCtx.state === 'suspended' || eqCtx.state === 'interrupted') ensureEQResumed();
    };
  }
  _connectAudioNextToGraph();
}

export function clearCrossfadeTimers() {
  if (_cfRafId)    { cancelAnimationFrame(_cfRafId); _cfRafId    = null; }
  if (cfFadeTimer) { clearTimeout(cfFadeTimer);      cfFadeTimer = null; }
  if (cfNextTimer) { clearTimeout(cfNextTimer);      cfNextTimer = null; }
  _cfGen++; _cfPending = false; // invalidate in-flight closures
  cancelRgAnalysis();
  if (audioNextGain && eqCtx) { audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.01); }       // DSP-7
  if (audioNextRgGain && eqCtx) { audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); } // DSP-7
  if (audioOutGain && eqCtx) { audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime); audioOutGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); }          // DSP-6 §9
  if (!sleepFading) {
    const vel = document.getElementById('vol'); // DSP-5: restore from DOM slider, never hardcode 1.0
    setMasterGain(vel ? parseFloat(/** @type {any} */ (vel).value) : 1.0);
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

function _commitGapless() { // gapless swap: next track already buffered in audioNext
  if (_playLock) { _gaplessNextIdx = -1; next(); return; } // guard: concurrent skip
  if (eqCtx && eqCtx.state === 'closed') { // Bug-6: AudioContext closed by OS — abort, let next() rebuild
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
    const tracks = get('tracks');
    const nt  = tracks[ni];
    if (!nt || !_trackIdxMap?.has(nt.id)) { clearCrossfadeTimers(); Promise.resolve().then(() => next()); return; }
    const validIdx = trackIdx(nt);
    if (validIdx < 0) { clearCrossfadeTimers(); Promise.resolve().then(() => next()); return; }

    curIdx = validIdx;
    set('curIdx', curIdx);
    const gSrc = audioNext.src; // @ts-ignore — audioNext guaranteed; same URL already in browser cache
    clearCrossfadeTimers();
    audio.src = gSrc;
    if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
    ensureEQResumed();
    audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[gapless] play() failed:', e); });
    _postPlaySideEffects(nt);
    const _afterRefill = () => {
      emit(EVENTS.TRACK_CHANGE, { track: nt, idx: curIdx });
      setTimeout(() => scrollToCurrentTrack(), 50);
      if (rgEnabled) analyzeAndApplyRG();
    };
    if (radioActive) {
      radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e)).then(_afterRefill);
    } else {
      _afterRefill();
    }
  } finally {
    _playLock = false;
  }
}

/** Gapless pre-buffer: loads audioNext within 3s of end (crossfadeDur=0). @param {number} remaining */
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

/** Reset gain nodes after crossfade transition (DSP-5/6/7). */
function _resetCfGains() {
  if (audioNextGain && eqCtx)   { audioNextGain.gain.cancelScheduledValues(eqCtx.currentTime);   audioNextGain.gain.setTargetAtTime(0, eqCtx.currentTime, 0.01); }
  if (audioNextRgGain && eqCtx) { audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime); audioNextRgGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); }
  if (audioOutGain && eqCtx)    { audioOutGain.gain.cancelScheduledValues(eqCtx.currentTime);    audioOutGain.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.01); }
  if (!sleepFading) { const _vel = document.getElementById('vol'); setMasterGain(_vel ? parseFloat(/** @type {any} */ (_vel).value) : (masterGainNode ? masterGainNode.gain.value : 1)); } // DSP-5
}
/** Swap primary audio → audioNext after fade completes. */
function _commitCrossfadeTransition(nextTrack, validNextIdx) {
  if (_cfRafId) { cancelAnimationFrame(_cfRafId); _cfRafId = null; }
  if (validNextIdx < 0) {
    audio.pause(); _resetCfGains();
    audioNext.pause(); audioNext.src = ''; // @ts-ignore — audioNext guaranteed
    return;
  }
  // @ts-ignore — audioNext guaranteed; BUG-6: save currentTime BEFORE pausing audio
  const _cfPos = audioNext.currentTime;
  audio.pause();
  curIdx = validNextIdx;
  set('curIdx', curIdx);
  audio.src = nextTrack.url; // @ts-ignore — url guaranteed set by ensureUrl(ok)
  if (playbackSpeed !== 1) audio.playbackRate = playbackSpeed;
  if (_cfPos > 0.05) audio.currentTime = _cfPos;
  _resetCfGains();
  ensureEQResumed();
  audio.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[crossfade] play() failed after transition:', e); });
  audioNext.pause(); audioNext.src = ''; // @ts-ignore — audioNext guaranteed
  if (rgEnabled) analyzeAndApplyRG();
  _postPlaySideEffects(nextTrack);
  const _afterRefill = () => {
    emit(EVENTS.TRACK_CHANGE, { track: nextTrack, idx: curIdx });
    setTimeout(() => scrollToCurrentTrack(), 50);
    if (queueOpen) renderQueue();
    if (shuffle && shuffleQ.length > 0 && shuffleQ[0] === validNextIdx) {
      shuffleQ.shift();
      if (!shuffleQ.length && repeat !== 'none') buildQ();
    }
  };
  if (radioActive) {
    radioRefillQueue().catch(e => console.warn('[radio] refill failed:', e)).then(_afterRefill);
  } else {
    _afterRefill();
  }
}

/** Load audioNext + schedule gain ramps for crossfade (crossfadeDur > 0). @param {number} remaining */
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
    if (_cfGen !== _myCfGen) return; // CROSSFADE-RACE: stale generation
    // @ts-ignore — url guaranteed by ensureUrl(ok)
    audioNext.src = nextTrack.url;
    const _genAtStart = _cfGen;
    setTimeout(() => { // 80ms delay to stabilise decoder
      if (_cfGen !== _genAtStart) return;
      ensureEQResumed();
      // @ts-ignore — audioNext guaranteed by initCrossfadeAudio()
      audioNext.play().catch(e => { if (e?.name !== 'AbortError') console.warn('[crossfade] audioNext.play() failed:', e); });
    }, 80);

    const durationMs = crossfadeDur * 1000;
    const rgGainVal = (rgEnabled && nextTrack.rgGain != null) ? Math.min(CFG.RG_GAIN_CAP, nextTrack.rgGain) : 1; // B1: != null accepts rgGain=0
    if (audioNextRgGain && eqCtx) {
      audioNextRgGain.gain.cancelScheduledValues(eqCtx.currentTime);
      audioNextRgGain.gain.setValueAtTime(rgGainVal, eqCtx.currentTime);
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
      if (_cfGen !== _genAtStart) return; // M-05: generation guard
      const validNextIdx = _trackIdxMap?.has(nextTrack.id) ? trackIdx(nextTrack) : -1;
      _commitCrossfadeTransition(nextTrack, validNextIdx);
    }, durationMs + 50); // +50ms margin for AudioParam ramps
  }).catch(e => { _cfPending = false; console.warn('[crossfade] setup failed:', e); });
}

export function checkCrossfade() { // called from timeupdate
  if (curIdx < 0 || audio.paused) return;
  if (sleepFading) return;
  const remaining = audio.duration - audio.currentTime;
  if (isNaN(remaining) || remaining <= 0) return;
  if (!crossfadeDur) { _handleGaplessPreBuffer(remaining); return; }
  _handleCrossfadeSetup(remaining);
}
export function getNextIdx() {
  if (repeat === 'one') return -1;
  if (radioActive) {
    const rq = getRadioQueue();
    if (rq && rq.length > 0) return trackIdx(rq[0]);
    return -1;
  }
  if (shuffle && shuffleQ.length > 0) return shuffleQ[0];
  const tracks = get('tracks');
  const fl     = getFiltered();
  if (!tracks[curIdx]) return -1; // Bug-4: curIdx may be out-of-bounds after rapid deletion
  const pos    = filteredIdx(tracks[curIdx]);
  if (pos >= 0 && pos < fl.length - 1) return trackIdx(fl[pos + 1]);
  if (repeat === 'all' && fl.length > 0) return trackIdx(fl[0]);
  return -1;
}

/** Clears shuffle queue (called after track deletion). */
export function resetShuffleQ() { shuffleQ = []; }
/** @param {number} idx — Adjusts shuffle queue indices after deletion. */
export function adjustShuffleQAfterDelete(idx) {
  shuffleQ = shuffleQ.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
}
/** @param {number[]} arr */
export function setManualQueue(arr) {
  // @ts-ignore — manualQueue stores numeric indices; store type says Track[] but runtime is number[]
  manualQueue = arr;
  set('manualQueue', manualQueue);
  if (arr.length > 0) _queueEndedToastShown = false;
}

audio.addEventListener('play', () => {
  setIcon(true);
  emit(EVENTS.PLAY_STATE, { playing: true });
  updateMediaSessionState();
  if (sleepFading) { // manual resume during sleep fade — restore volume (DSP-5)
    const _vel = document.getElementById('vol');
    setMasterGain(_vel ? parseFloat(/** @type {any} */ (_vel).value) : 1); // @ts-ignore value prop
    setSleepFading(false);
    cancelSleepTimer(true);
  }
  if (!eqCtx) initEQ();
  initViz();
  if (_pendingVizMode)     { setVizMode(/** @type {any} */ (_pendingVizMode));    _pendingVizMode    = null; } // @ts-ignore valid viz mode
  if (_pendingVizDisabled) { setVizEnabled(false);           _pendingVizDisabled = false; }
  startViz();
  if (curIdx >= 0 && get('tracks')?.[curIdx]) {
    const _genre = get('tracks')[curIdx].genre || null;
    set(/** @type {any} */ ('currentTrackGenre'), _genre); // runtime-only store key
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
  if (sleepEndOfTrack) { cancelSleepTimer(true); audio.pause(); audio.src = ''; toast(i18n('t_sleep_end_track_done')); return; }
  if (_gaplessNextIdx >= 0 && audioNext && audioNext.src && audioNext.src !== location.href && audioNext.readyState >= 3) {
    _commitGapless(); return;
  }
  _gaplessNextIdx = -1;
  next();
});
audio.addEventListener('error', () => {
  if (!audio.src || audio.src === location.href || audio.src === window.location.href) return;
  const code = audio.error?.code; // 3=MEDIA_ERR_DECODE, 4=MEDIA_ERR_SRC_NOT_SUPPORTED
  const msg = code === 3 ? i18n('t_decode_err') : code === 4 ? i18n('t_not_found') : i18n('t_playback_err');
  toast(msg, 'error');
  console.warn('[audio:error] code', code, audio.error?.message ?? '', audio.src.slice(-60));
  if (audio.src !== _audioErrSrc) { _audioErrSrc = audio.src; _audioErrCount = 0; }
  _audioErrCount++;
  if (_audioErrCount === 1) { // skip once per src to avoid infinite loop
    _consecErrCount++;
    if (_consecErrCount >= 10) { // AUDIO-2: circuit-breaker
      _consecErrCount = 0;
      toast(i18n('t_consec_errors'), 'error');
      return;
    }
    const _failedSrc = audio.src;
    setTimeout(() => { if (audio.paused && audio.src === _failedSrc) next(); }, 350); // B8: guard racing clicks
  } else console.warn('[audio:error] repeated error on same src — skipping');
});
audio.addEventListener('playing', () => { _consecErrCount = 0; }); // AUDIO-2: reset on successful playback
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
  { // A11Y: update ARIA slider (#pbar role=slider)
    const _pbar = document.getElementById('pbar');
    if (_pbar) {
      const pNow = Math.round(p * 100);
      _pbar.setAttribute('aria-valuenow', String(pNow));
      _pbar.setAttribute('aria-valuetext', `${cur} / ${dur}`);
    }
  }
  updateCinemaProgress(p, cur, dur);
  const now = Date.now();
  if (now - _lastPosSave > 5000) { _lastPosSave = now; saveCfg(); } // throttled — avoids IDB flood at 60fps
});
