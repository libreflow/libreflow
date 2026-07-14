// LibreFlow — replaygain.js
// ReplayGain : analyse de volume et normalisation automatique.
// Extrait de app.js.
//
// Aucun import depuis app.js (ARCH-1 — deps circulaires brisées).
//
// Exports publics :
//   rgEnabled     (live bool — lu dans app.js crossfade + playback handlers)
//   rgTargetLUFS  (live number — lu dans app.js saveCfg + boot UI sync)
//   initRgState   (boot restore — définit les deux valeurs sans side-effect)
//   initRG, setReplayGain, setRGTarget, analyzeAndApplyRG, applyRGGain

import { eqCtx, eqSource, eqNodes, audioOutGain, initEQ } from './eq.js';
import { CFG }                               from './cfg.js';
import { get }                               from './store.js';
import { emit, EVENTS }                       from './bus.js';
import { saveCfg } from './cfgsave.js';
import { invoke } from './ipc.js';

// ── État (exporté comme live bindings) ────────────────────────
export let rgEnabled    = true;
export let rgTargetLUFS = -14;

// ── État interne ──────────────────────────────────────────────
let rgGainNode   = null;
let _rgAnalysisId = 0;

const RG_MAX_BYTES = CFG.RG_MAX_FILE_BYTES; // 30 Mo max pour l'analyse RG

// ── Boot / restauration ───────────────────────────────────────

/** Annule toute analyse RG en cours (appelé par clearCrossfadeTimers). */
export function cancelRgAnalysis() { _rgAnalysisId++; }

/** Restaure l'état RG depuis le cfg persisté — aucun side-effect DOM. */
export function initRgState(enabled, lufs) {
  rgEnabled    = !!enabled;
  rgTargetLUFS = lufs ?? -14;
}

// ── Initialisation nœud Web Audio ────────────────────────────

export function initRG() {
  if (rgGainNode) return;
  try {
    // Toujours initialiser l'EQ d'abord (il crée le MediaElementSource unique)
    if (!eqCtx) initEQ();
    if (!eqCtx) return; // EQ init failed
    // Créer le nœud de gain RG et l'insérer entre eqSource et audioOutGain (DSP-6)
    // Chaîne : eqSource → rgGainNode → audioOutGain → eqNodes[0..9]
    // audioOutGain est déjà connecté à eqNodes[0] par initEQ() — on ne touche pas à ça.
    rgGainNode = eqCtx.createGain();
    rgGainNode.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.02);
    // Recâbler : déconnecter eqSource → audioOutGain, puis eqSource → rgGainNode → audioOutGain
    try { eqSource.disconnect(audioOutGain ?? eqNodes[0]); } catch(e) { console.warn('[replaygain:disconnect]', e); }
    eqSource.connect(rgGainNode);
    rgGainNode.connect(audioOutGain ?? eqNodes[0]);
  } catch(e) { console.warn('[RG init]', e); }
}

// ── Contrôle utilisateur ──────────────────────────────────────

export function setReplayGain(enabled) {
  rgEnabled = enabled;
  if (enabled) {
    initRG();
    analyzeAndApplyRG();
  } else {
    if (rgGainNode && eqCtx) rgGainNode.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.1);
    else if (rgGainNode)     rgGainNode.gain.setValueAtTime(1.0, rgGainNode.context.currentTime);
  }
  saveCfg();
}

export function setRGTarget(lufs) {
  rgTargetLUFS = lufs;
  const lbl = document.getElementById('rg-target-lbl');
  if (lbl) lbl.textContent = lufs + ' LUFS';
  if (rgEnabled) analyzeAndApplyRG();
  saveCfg();
}

// ── Analyse ───────────────────────────────────────────────────

export async function analyzeAndApplyRG() {
  const _curIdx = get('curIdx');
  if (!rgEnabled || _curIdx < 0) return;
  const t = get('tracks')[_curIdx];
  if (!t) return;
  if (t.rgGain !== undefined && Number.isFinite(t.rgGain)) { initRG(); applyRGGain(t.rgGain); return; }

  const myId = ++_rgAnalysisId;

  try {
    if (!t.path) return;

    const estimatedSize = t.duration > 0 ? t.duration * 40_000 : Infinity;
    if (estimatedSize > RG_MAX_BYTES) {
      t.rgGain = 1.0;
      applyRGGain(1.0);
      return;
    }

    /** @type {number[]} */
    const bytes = /** @type {number[]} */ (await invoke('read_audio_bytes', { path: t.path }));
    if (_rgAnalysisId !== myId) return;
    let arrayBuf = new Uint8Array(bytes).buffer;
    if (_rgAnalysisId !== myId) return;

    const _dur = isFinite(t.duration) && t.duration > 0 ? t.duration : 30;
    const _probeCtx = new OfflineAudioContext(2, Math.round(44100 * Math.min(CFG.RG_ANALYSIS_SECS, _dur)), 44100);
    let srcBuf      = await _probeCtx.decodeAudioData(arrayBuf);
    arrayBuf = null;
    const nChannels = srcBuf.numberOfChannels > 1 ? 2 : 1;
    const offline   = new OfflineAudioContext(nChannels, Math.round(44100 * Math.min(CFG.RG_ANALYSIS_SECS, _dur)), 44100);
    if (_rgAnalysisId !== myId) { srcBuf = null; return; }

    const nch = nChannels;

    const src = offline.createBufferSource();
    src.buffer = srcBuf;

    const preFilter = offline.createBiquadFilter();
    preFilter.type = 'highshelf';
    preFilter.frequency.setValueAtTime(1500, offline.currentTime);
    preFilter.gain.setValueAtTime(4.0, offline.currentTime);

    const rlbFilter = offline.createBiquadFilter();
    rlbFilter.type = 'highpass';
    rlbFilter.frequency.setValueAtTime(38, offline.currentTime);
    rlbFilter.Q.setValueAtTime(0.5, offline.currentTime);

    src.connect(preFilter);
    preFilter.connect(rlbFilter);
    rlbFilter.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    src.disconnect();
    src.buffer = null;
    if (_rgAnalysisId !== myId) { srcBuf = null; return; }

    let sumSq = 0;
    for (let ch = 0; ch < nch; ch++) {
      const chData = rendered.getChannelData(ch);
      for (let i = 0; i < chData.length; i++) sumSq += chData[i] * chData[i];
    }
    const meanSq = sumSq / (rendered.length * nch);
    const lufs     = meanSq > 0 ? -0.691 + 10 * Math.log10(meanSq) : -70;
    const gainDB   = rgTargetLUFS - lufs;
    t.rgGain       = Math.max(0.1, Math.min(3.162, Math.pow(10, gainDB / 20)));
    t.rgGainDB     = 20 * Math.log10(t.rgGain);
    let _peak = 0;
    try {
      for (let ch = 0; ch < nch; ch++) {
        const _pcm = srcBuf.getChannelData(ch);
        for (let i = 0; i < _pcm.length; i++) { const a = Math.abs(_pcm[i]); if (a > _peak) _peak = a; }
      }
      t.rgPeak = Math.min(1.0, _peak);
    } finally {
      srcBuf = null;
    }
    applyRGGain(t.rgGain);
    emit(EVENTS.TRACK_SAVE_REQUEST, { track: t });
  } catch(e) {
    console.warn('[replaygain] analyzeAndApplyRG failed (format non décodable ou interrompu):', e);
    if (_rgAnalysisId === myId) {
      t.rgGain = 1.0;
      applyRGGain(1.0);
    }
  }
}

export function applyRGGain(gain) {
  if (!rgGainNode) initRG();
  if (rgGainNode && eqCtx) {
    rgGainNode.gain.setTargetAtTime(gain, eqCtx.currentTime, 0.1);
  }
}
