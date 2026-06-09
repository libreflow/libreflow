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
import { saveTrack }                         from './library.js';
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
    // Recâbler : déconnecter eqSource → audioOutGain, puis eqSource → rgGainNode → audioOutGain
    if (!audioOutGain) { console.warn('[replaygain] audioOutGain not ready — initRG aborted'); return; }
    rgGainNode = eqCtx.createGain();
    rgGainNode.gain.setTargetAtTime(1.0, eqCtx.currentTime, 0.02);
    try { eqSource.disconnect(audioOutGain); } catch(e) { console.warn('[replaygain:disconnect]', e); }
    eqSource.connect(rgGainNode);
    rgGainNode.connect(audioOutGain);
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
  }
  saveCfg();
}

export function setRGTarget(lufs) {
  const _v = parseFloat(lufs);
  if (!isFinite(_v)) return;
  rgTargetLUFS = _v;
  const lbl = document.getElementById('rg-target-lbl');
  if (lbl) lbl.textContent = _v + ' LUFS';
  if (rgEnabled) analyzeAndApplyRG();
  saveCfg();
}

// ── Analyse ───────────────────────────────────────────────────

export async function analyzeAndApplyRG() {
  const _curIdx = get('curIdx');
  if (!rgEnabled || _curIdx < 0) return;
  const t = get('tracks')[_curIdx]; // Phase 4 — store alimenté depuis Jalon 3
  if (!t) return;
  // Cache hit — pas besoin de recalculer
  if (t.rgGain !== undefined && Number.isFinite(t.rgGain)) { initRG(); applyRGGain(t.rgGain); return; }

  // Générer un ID unique pour cette analyse ; si curIdx change pendant l'await, on abandonne
  const myId = ++_rgAnalysisId;

  try {
    if (!t.path) return;

    // Estimer la taille depuis la durée (évite une lecture inutile côté Rust).
    // Estimation conservative : ~320 kbit/s moyen → 40 Ko/s.
    const estimatedSize = t.duration > 0 ? t.duration * 40_000 : Infinity;
    if (estimatedSize > RG_MAX_BYTES) {
      // Fichier probablement trop grand pour analyse offline — appliquer gain neutre.
      t.rgGain = 1.0;
      applyRGGain(1.0);
      return;
    }

    // Lecture via IPC Rust (§15 — fetch() banni).
    // read_audio_bytes valide le chemin, applique is_safe_dir et plafonne à RG_MAX_BYTES.
    /** @type {number[]} */
    const bytes = /** @type {number[]} */ (await invoke('read_audio_bytes', { path: t.path }));
    if (_rgAnalysisId !== myId) return; // piste changée pendant la lecture
    let arrayBuf = new Uint8Array(bytes).buffer;
    if (_rgAnalysisId !== myId) return;

    // CORRUPT-2 : t.duration peut être NaN (tag manquant) → OfflineAudioContext(1, NaN) → RangeError
    const _dur = isFinite(t.duration) && t.duration > 0 ? t.duration : 30;
    const offline = new OfflineAudioContext(2, Math.round(44100 * Math.min(30, _dur)), 44100);
    let srcBuf    = await offline.decodeAudioData(arrayBuf);
    arrayBuf = null; // MEM-2 — libère ~30 MB avant le rendu offline (GC ne peut pas le faire avant)
    if (_rgAnalysisId !== myId) { srcBuf = null; return; }

    const nch = Math.min(srcBuf.numberOfChannels, 2); // cap at 2 — BS.1770 uses L+R only

    const src = offline.createBufferSource();
    src.buffer = srcBuf;

    // ── K-weighting ITU-R BS.1770-4 ─────────────────────────────────────────
    // Deux filtres en série pour pondérer les fréquences selon la sensibilité auditive :
    // 1. Pre-filter  — high-shelf +4 dB à 1500 Hz  (accentue les aigus)
    // 2. RLB filter  — high-pass  à 38 Hz, Q=0.5   (élimine les infra-basses)
    // Sans ces filtres, le RMS brut sur-pénalise les pistes à basses dominantes
    // et sous-pénalise les pistes sibilantes → normalisation perceptuelle incorrecte.
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
    src.disconnect(); // release node from graph
    src.buffer = null; // release AudioBuffer reference from source node
    if (_rgAnalysisId !== myId) { srcBuf = null; return; }

    // LUFS-K (ungated) = -0.691 + 10·log10(mean_square)
    // Formule BS.1770 : l'offset -0.691 compense la pondération fréquentielle K.
    // Équivalent à 20·log10(rms) - 0.691 ; légèrement différent du RMS brut.
    let sumSq = 0;
    for (let ch = 0; ch < nch; ch++) {
      const chData = rendered.getChannelData(ch);
      for (let i = 0; i < chData.length; i++) sumSq += chData[i] * chData[i];
    }
    const meanSq = sumSq / (rendered.length * nch);
    const lufs     = meanSq > 0 ? -0.691 + 10 * Math.log10(meanSq) : -70;
    const gainDB   = rgTargetLUFS - lufs;
    t.rgGain       = Math.max(0.1, Math.min(3.162, Math.pow(10, gainDB / 20))); // max +10 dB — évite le clipping sur les pistes très faibles
    t.rgGainDB     = 20 * Math.log10(t.rgGain); // recompute from clamped gain to stay consistent
    // F-7 — Peak depuis les données originales décodées (avant K-weighting)
    // srcBuf contient le PCM brut ; le K-weighting est appliqué via les nœuds filtres, pas via decodeAudioData.
    // B32 FIX : balayer TOUS les canaux (cap 2) — un peak calculé sur le canal 0
    // seul sous-estime REPLAYGAIN_TRACK_PEAK si le canal droit est plus fort.
    let _peak = 0;
    try {
      for (let ch = 0; ch < nch; ch++) {
        const _pcm = srcBuf.getChannelData(ch);
        for (let i = 0; i < _pcm.length; i++) { const a = Math.abs(_pcm[i]); if (a > _peak) _peak = a; }
      }
      t.rgPeak = Math.min(1.0, _peak);
    } finally {
      srcBuf = null; // allow GC of the 30 MB AudioBuffer
    }
    applyRGGain(t.rgGain);
    saveTrack(t); // persister en IDB pour ne pas recalculer au prochain démarrage
  } catch(e) {
    // AUDIO-1 FIX : format non décodable — appliquer gain neutre explicitement.
    // Sans ça, rgGainNode conserve le gain du titre précédent (risque de saturation soudaine).
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
    const _g = Number.isFinite(gain) ? Math.max(0.01, gain) : 1.0;
    rgGainNode.gain.setTargetAtTime(_g, eqCtx.currentTime, 0.1);
  }
}
