// eq.js — Pipeline Web Audio : EQ 10 bandes, SmartEQ, presets, A/B, courbe
//
// Architecture du graphe (après initEQ()) :
//   audio (HTMLAudioElement)
//     → eqSource (MediaElementSource) [singleton via audio._src]
//     → [rgGainNode (replaygain.js — câblé si initRG() appelé)]
//     → audioOutGain (GainNode — point d'injection ReplayGain)
//     → eqNodes[0..9] (BiquadFilterNode × 10)
//     → eqAnalyser (AnalyserNode)
//     → eqLimiter (DynamicsCompressorNode — protection écrêtage)
//     → masterGainNode (GainNode — volume principal)
//     → destination
//
// Exports :
//   eqCtx, eqSource, eqNodes, eqEnabled, eqOpen, eqAutoMode
//   eqAnalyser, audioOutGain, masterGainNode
//   initEQ, ensureEQResumed, initBootEQ
//   toggleEQ, closeEQ, setEQBand, applyEQPreset, getActiveEqPreset
//   setEQAutoMode, toggleEQAutoMode, applyGenreEQ
//   startSmartEQ, stopSmartEQ, updateSmartEQLoudness, updateSmartEQGenre
//   loadEQProfiles, getEQProfiles
//   renderEQBands, filterEQPresets, toggleEQAB
//   setMasterGain

import { get, set } from './store.js';
import { emit, EVENTS } from './bus.js';

// ── Fréquences Bark (10 bandes) ──────────────────────────────────────────────
const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_BAND_COUNT = 10;

// ── Noeuds exportés (live bindings) ──────────────────────────────────────────
export let eqCtx        = null;
export let eqSource     = null;
export let eqNodes      = [];
export let eqAnalyser   = null;
export let audioOutGain = null;
export let masterGainNode = null;
export let eqEnabled    = false;
export let eqOpen       = false;
export let eqAutoMode   = false;

// Noeud limiter interne (non exporté)
let eqLimiter = null;

// ── État boot (avant initEQ()) ────────────────────────────────────────────────
let _bootGains      = null;   // Float32Array ou null
let _bootEnabled    = false;
let _bootPreset     = null;
let _eqInitialized  = false;  // R6 — singleton guard : empêche createMediaElementSource × N

// ── Presets ───────────────────────────────────────────────────────────────────
// Gains en dB pour [32,64,125,250,500,1k,2k,4k,8k,16k]
const EQ_PRESETS = Object.freeze({
  flat:        [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  bass:        [ 6,  5,  4,  2,  0,  0,  0,  0,  0,  0],
  treble:      [ 0,  0,  0,  0,  0,  0,  2,  3,  5,  6],
  vocal:       [-2, -2,  0,  3,  4,  4,  3,  2, -1, -2],
  rock:        [ 4,  3,  2,  0, -1, -1,  0,  2,  3,  4],
  pop:         [-1,  0,  2,  3,  2,  0,  2,  3,  2,  0],
  jazz:        [ 3,  2,  1,  2,  0, -1, -1,  0,  2,  3],
  classical:   [ 3,  2,  0,  0,  0,  0,  0,  2,  3,  4],
  electronic:  [ 4,  4,  2,  0, -1,  0,  1,  2,  3,  4],
  rap:         [ 5,  4,  3,  1,  0,  0,  1,  2,  2,  1],
  rnb:         [ 4,  4,  2,  1,  0, -1,  0,  2,  3,  2],
  soul:        [ 3,  3,  2,  2,  0, -1,  0,  1,  2,  2],
  blues:       [ 4,  3,  2,  0, -1, -1,  1,  3,  3,  2],
  country:     [ 2,  2,  1,  0, -1,  0,  1,  2,  3,  3],
  reggae:      [ 4,  3,  0, -1,  2,  2,  0, -1,  0,  2],
  phonk:       [ 6,  6,  4,  2,  0, -1, -1,  0,  1,  2],
  trap:        [ 6,  5,  4,  2, -1, -1,  0,  1,  2,  2],
  drill:       [ 5,  5,  3,  1,  0, -1,  0,  1,  2,  2],
  hardstyle:   [ 6,  5,  3,  1, -1, -1,  0,  2,  3,  4],
  ambient:     [ 2,  2,  1,  0,  0,  0,  1,  2,  3,  4],
  lofi:        [ 4,  3,  2,  1,  0, -1, -2, -2, -3, -4],
  afrobeats:   [ 4,  4,  2,  1,  0,  0,  1,  2,  3,  2],
});

// Mapping genre (normalisé) → preset EQ
const GENRE_TO_PRESET = Object.freeze({
  'rock':           'rock',
  'alternative rock':'rock',
  'pop':            'pop',
  'jazz':           'jazz',
  'classical':      'classical',
  'electronic':     'electronic',
  'hip-hop':        'rap',
  'r&b/soul':       'rnb',
  'soul':           'soul',
  'blues':          'blues',
  'country':        'country',
  'reggae':         'reggae',
  'metal':          'rock',
  'funk':           'rnb',
  'latin':          'afrobeats',
  'indie':          'rock',
  'punk':           'rock',
  'chanson':        'vocal',
  'variete':        'pop',
});

// ── Preset actif + A/B ────────────────────────────────────────────────────────
let _activePreset  = 'flat';
let _abMode        = false;      // true = affiche preset A (flat), false = preset courant
let _abSavedGains  = null;       // gains sauvegardés avant mode A/B

// ── Profiles utilisateur ──────────────────────────────────────────────────────
let _eqProfiles = {};

// ── Smart EQ ──────────────────────────────────────────────────────────────────
let _smartGenre    = '';
let _smartLoudness = 0;

// ── Boot config (sauvegardé AVANT initEQ()) ───────────────────────────────────
/** Appelé au boot par app.js AVANT que l'AudioContext existe.
 *  Stocke la config pour l'appliquer dans initEQ(). */
export function initBootEQ(gains, enabled, preset) {
  _bootGains   = gains   ?? null;
  _bootEnabled = !!enabled;
  _bootPreset  = preset  ?? null;
}

// ── initEQ() — singleton lazy ─────────────────────────────────────────────────
/** Initialise le pipeline Web Audio. Appel idempotent (singleton).
 *  N'accepte aucun argument — lit la config via _bootGains / _bootEnabled. */
export function initEQ() {
  if (_eqInitialized) return;   // R6 — singleton : createMediaElementSource ne doit être appelé qu'une fois

  const audio = document.getElementById('audio');
  if (!audio) { console.warn('[eq] <audio> introuvable'); return; }

  try {
    eqCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('[eq] AudioContext non disponible', e);
    return;
  }

  // ── Singleton MediaElementSource ──────────────────────────────────────────
  if (!audio._src) {
    eqSource = eqCtx.createMediaElementSource(audio);
    audio._src = eqSource;
  } else {
    eqSource = audio._src;
  }

  // ── audioOutGain : point d'injection pour ReplayGain ──────────────────────
  audioOutGain = eqCtx.createGain();
  audioOutGain.gain.value = 1.0;

  // ── 10 biquad filters ─────────────────────────────────────────────────────
  eqNodes = EQ_FREQS.map((freq, i) => {
    const f = eqCtx.createBiquadFilter();
    if (i === 0)               f.type = 'lowshelf';
    else if (i === EQ_BAND_COUNT - 1) f.type = 'highshelf';
    else                       f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value         = 1.4;
    f.gain.value      = 0;
    return f;
  });

  // ── AnalyserNode ──────────────────────────────────────────────────────────
  eqAnalyser = eqCtx.createAnalyser();
  eqAnalyser.fftSize = 2048;
  eqAnalyser.smoothingTimeConstant = 0.8;

  // ── Limiter (DynamicsCompressor) ──────────────────────────────────────────
  eqLimiter = eqCtx.createDynamicsCompressor();
  eqLimiter.threshold.value = -1;
  eqLimiter.knee.value      =  0;
  eqLimiter.ratio.value     = 20;
  eqLimiter.attack.value    =  0.003;
  eqLimiter.release.value   =  0.25;

  // ── masterGainNode ────────────────────────────────────────────────────────
  masterGainNode = eqCtx.createGain();
  // Lire le volume depuis le slider DOM (JAMAIS hardcoder 1.0)
  const _volEl = document.getElementById('vol');
  masterGainNode.gain.value = _volEl ? parseFloat(_volEl.value) : 1;

  // ── Câblage du graphe ─────────────────────────────────────────────────────
  // eqSource → audioOutGain → eqNodes[0..9] → eqAnalyser → eqLimiter → masterGainNode → destination
  eqSource.connect(audioOutGain);
  audioOutGain.connect(eqNodes[0]);
  for (let i = 0; i < eqNodes.length - 1; i++) {
    eqNodes[i].connect(eqNodes[i + 1]);
  }
  eqNodes[eqNodes.length - 1].connect(eqAnalyser);
  eqAnalyser.connect(eqLimiter);
  eqLimiter.connect(masterGainNode);
  masterGainNode.connect(eqCtx.destination);

  // R6 — marquer comme initialisé une fois le graphe entièrement câblé
  _eqInitialized = true;

  // ── Appliquer la config boot ──────────────────────────────────────────────
  if (_bootPreset && EQ_PRESETS[_bootPreset]) {
    _activePreset = _bootPreset;
    _applyGains(EQ_PRESETS[_bootPreset], true);
  } else if (_bootGains && _bootGains.length === EQ_BAND_COUNT) {
    _applyGains(Array.from(_bootGains), true);
  }

  eqEnabled = _bootEnabled;
  if (!eqEnabled) {
    // Bypass : remettre toutes les bandes à 0
    _applyGains(new Array(EQ_BAND_COUNT).fill(0), true);
  }

  renderEQBands();
  _drawEQCurve();
  _syncEQUI();
}

// ── ensureEQResumed ───────────────────────────────────────────────────────────
/** Relance l'AudioContext si suspendu (autoplay policy). */
export function ensureEQResumed() {
  if (eqCtx?.state === 'suspended') eqCtx.resume();
}

// ── setMasterGain ─────────────────────────────────────────────────────────────
/** Met à jour le gain principal.
 *  Si EQ non encore initialisé, met audio.volume comme fallback. */
export function setMasterGain(v, immediate = false) {
  const val = Math.max(0, Math.min(1, v));
  if (masterGainNode && eqCtx) {
    if (immediate) {
      masterGainNode.gain.value = val;
    } else {
      masterGainNode.gain.setTargetAtTime(val, eqCtx.currentTime, 0.01);
    }
  } else {
    // Fallback avant initEQ()
    const audio = document.getElementById('audio');
    if (audio) audio.volume = val;
  }
}

// ── toggleEQ / closeEQ ───────────────────────────────────────────────────────
export function toggleEQ() {
  const panel = document.getElementById('eq-panel');
  if (!panel) return;
  eqOpen = !eqOpen;
  panel.classList.toggle('open', eqOpen);
  if (eqOpen) {
    if (!eqCtx) initEQ();
    renderEQBands();
    _drawEQCurve();
    _syncEQUI();
  }
}

export function closeEQ() {
  if (!eqOpen) return;
  eqOpen = false;
  const panel = document.getElementById('eq-panel');
  if (panel) panel.classList.remove('open');
}

// ── setEQBand ─────────────────────────────────────────────────────────────────
/** Modifie le gain de la bande `idx` (0-9) à la valeur `db` (en dB). */
export function setEQBand(idx, db) {
  if (!eqCtx) initEQ();
  if (!eqNodes[idx]) return;
  const val = Math.max(-12, Math.min(12, db));
  eqNodes[idx].gain.setTargetAtTime(val, eqCtx.currentTime, 0.01);
  // Mettre à jour l'affichage du slider
  const slider = document.querySelector(`#eq-bands [data-band="${idx}"]`);
  if (slider) slider.value = val;
  const label = document.querySelector(`#eq-bands [data-band-label="${idx}"]`);
  if (label) {
    label.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
    label.classList.toggle('eq-val--boost', val > 0);
    label.classList.toggle('eq-val--cut',   val < 0);
    label.classList.toggle('eq-val--flat',  val === 0);
  }
  _drawEQCurve();
}

// ── _applyGains ───────────────────────────────────────────────────────────────
/** Applique un tableau de 10 gains aux noeuds EQ (sans interpolation si immediate). */
function _applyGains(gains, immediate = false) {
  if (!eqCtx || !eqNodes.length) return;
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const val = gains[i] ?? 0;
    if (immediate) {
      eqNodes[i].gain.value = val;
    } else {
      eqNodes[i].gain.setTargetAtTime(val, eqCtx.currentTime, 0.02);
    }
  }
}

// ── applyEQPreset ─────────────────────────────────────────────────────────────
export function applyEQPreset(presetName) {
  if (!eqCtx) initEQ();
  const gains = EQ_PRESETS[presetName] ?? EQ_PRESETS.flat;
  _activePreset = presetName;
  _applyGains(gains);
  _updatePresetBtns(presetName);
  renderEQBands();
  _drawEQCurve();
  if (!eqEnabled) _setEQEnabled(true);
}

export function getActiveEqPreset() {
  return _activePreset;
}

// ── toggleEQ enabled (bypass) ─────────────────────────────────────────────────
function _setEQEnabled(val) {
  eqEnabled = !!val;
  const btn = document.getElementById('btn-eq');
  if (btn) {
    btn.setAttribute('aria-pressed', String(eqEnabled));
    btn.classList.toggle('active', eqEnabled);
  }
  if (!eqEnabled) {
    _applyGains(new Array(EQ_BAND_COUNT).fill(0));
  } else {
    const gains = EQ_PRESETS[_activePreset] ?? EQ_PRESETS.flat;
    _applyGains(gains);
  }
}

// ── applyGenreEQ ─────────────────────────────────────────────────────────────
/** Applique le preset correspondant au genre donné (clé normalisée). */
export function applyGenreEQ(genre) {
  if (!genre) return;
  const preset = GENRE_TO_PRESET[genre.toLowerCase()] ?? null;
  if (preset) applyEQPreset(preset);
}

// ── Smart EQ ──────────────────────────────────────────────────────────────────
let _smartRunning = false;

export function startSmartEQ() {
  _smartRunning = true;
  _updateSmartStatus();
}

export function stopSmartEQ() {
  _smartRunning = false;
  _updateSmartStatus();
}

export function updateSmartEQGenre(genre) {
  _smartGenre = genre || '';
  if (_smartRunning && eqAutoMode) {
    applyGenreEQ(_smartGenre);
  }
  _updateSmartStatus();
}

export function updateSmartEQLoudness(lufs) {
  _smartLoudness = lufs ?? 0;
  // Compensation loudness légère (±2 dB max), multipliée par le volume courant du slider
  if (masterGainNode && eqCtx) {
    const target   = -14; // LUFS cible
    const delta    = Math.max(-2, Math.min(2, target - _smartLoudness));
    const compGain = Math.pow(10, delta / 20);
    const _volEl   = document.getElementById('vol');
    const volGain  = _volEl ? Math.max(0, Math.min(1, parseFloat(_volEl.value))) : 1;
    masterGainNode.gain.setTargetAtTime(volGain * compGain, eqCtx.currentTime, 0.3);
  }
}

function _updateSmartStatus() {
  const badge = document.getElementById('eq-detect-badge');
  const wrap  = document.getElementById('eq-status-wrap');
  if (!badge || !wrap) return;
  if (_smartRunning && eqAutoMode && _smartGenre) {
    badge.textContent = _smartGenre;
    wrap.classList.add('on');
  } else {
    badge.textContent = '';
    wrap.classList.remove('on');
  }
}

// ── setEQAutoMode / toggleEQAutoMode ─────────────────────────────────────────
export function setEQAutoMode(val) {
  eqAutoMode = !!val;
  const btn = document.getElementById('eq-auto-btn');
  if (btn) btn.setAttribute('aria-pressed', String(eqAutoMode));
  if (!eqAutoMode) stopSmartEQ();
  _updateSmartStatus();
}

export function toggleEQAutoMode() {
  setEQAutoMode(!eqAutoMode);
}

// ── A/B comparison ────────────────────────────────────────────────────────────
export function toggleEQAB() {
  _abMode = !_abMode;
  const btn = document.getElementById('eq-ab-btn');
  if (_abMode) {
    // Mode A : sauvegarde gains courants, applique flat
    _abSavedGains = eqNodes.map(n => n.gain.value);
    _applyGains(EQ_PRESETS.flat);
    if (btn) { btn.dataset.state = 'a'; btn.setAttribute('aria-pressed', 'true'); }
  } else {
    // Mode B : restaure gains sauvegardés
    if (_abSavedGains) _applyGains(_abSavedGains);
    if (btn) { btn.dataset.state = 'b'; btn.setAttribute('aria-pressed', 'false'); }
    _abSavedGains = null;
  }
  _drawEQCurve();
}

// ── Profiles utilisateur ──────────────────────────────────────────────────────
export function loadEQProfiles(profiles) {
  if (profiles && typeof profiles === 'object') {
    _eqProfiles = { ...profiles };
  }
}

export function getEQProfiles() {
  return { ..._eqProfiles };
}

// ── filterEQPresets (catégorie) ───────────────────────────────────────────────
/** Filtre les boutons de presets par catégorie. */
export function filterEQPresets(cat) {
  const container = document.getElementById('eq-presets');
  if (!container) return;
  const btns = container.querySelectorAll('.eq-preset');
  btns.forEach(btn => {
    const bcat = btn.dataset.cat || 'all';
    btn.style.display = (cat === 'all' || bcat === cat || bcat === 'all') ? '' : 'none';
  });
  // Marquer le bouton de catégorie actif
  const catBtns = document.querySelectorAll('#eq-cats .eq-cat');
  catBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
    b.setAttribute('aria-selected', String(b.dataset.cat === cat));
  });
}

// ── renderEQBands ─────────────────────────────────────────────────────────────
/** Génère les 10 sliders EQ dans #eq-bands. */
export function renderEQBands() {
  const container = document.getElementById('eq-bands');
  if (!container) return;

  const LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  const gains = eqNodes.length
    ? eqNodes.map(n => n.gain.value)
    : new Array(EQ_BAND_COUNT).fill(0);

  let html = '';
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const g   = gains[i];
    const v   = g.toFixed(1);
    const lbl = (g >= 0 ? '+' : '') + v + ' dB';
    const mod = g > 0 ? 'eq-val--boost' : g < 0 ? 'eq-val--cut' : 'eq-val--flat';
    html += `<div class="eq-band">
  <span class="eq-val ${mod}" data-band-label="${i}">${lbl}</span>
  <div class="eq-slider-wrap">
    <input type="range" class="eq-slider" orient="vertical"
      data-band="${i}" data-input-action="eq-band-input"
      min="-12" max="12" step="0.5" value="${v}"
      aria-label="${LABELS[i]} Hz" aria-valuetext="${lbl}">
  </div>
  <span class="eq-freq">${LABELS[i]}</span>
</div>`;
  }
  container.innerHTML = html;
}

// ── _drawEQCurve ──────────────────────────────────────────────────────────────
/** Dessine la courbe de réponse en fréquence sur le canvas #eq-curve-wrap. */
function _drawEQCurve() {
  const wrap = document.getElementById('eq-curve-wrap');
  if (!wrap || !eqCtx) return;

  // Créer le canvas s'il n'existe pas encore
  let canvas = wrap.querySelector('.eq-curve-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'eq-curve-canvas';
    wrap.appendChild(canvas);
  }

  const W  = wrap.offsetWidth  || 260;
  const H  = wrap.offsetHeight || 116;
  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Fond transparent (géré par CSS)
  const gains = eqNodes.length
    ? eqNodes.map(n => n.gain.value)
    : new Array(EQ_BAND_COUNT).fill(0);

  // Grille horizontale (0 dB ligne centrale)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  [-12, -6, 0, 6, 12].forEach(db => {
    const y = H / 2 - (db / 12) * (H / 2 - 8);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  // Courbe EQ interpolée
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const freqAt = x => Math.pow(10, logMin + (x / W) * (logMax - logMin));

  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const freq = freqAt(x);
    let db = 0;
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      // Approx Gaussian bell pour chaque bande
      const f0     = EQ_FREQS[i];
      const sigma  = 0.5; // largeur en octaves (log)
      const dist   = Math.log2(freq / f0);
      db += gains[i] * Math.exp(-0.5 * (dist / sigma) ** 2);
    }
    const y = H / 2 - (db / 12) * (H / 2 - 8);
    if (x === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }

  // Remplissage gradient sous la courbe
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   'rgba(99,102,241,0.35)');
  grad.addColorStop(0.5, 'rgba(99,102,241,0.12)');
  grad.addColorStop(1,   'rgba(99,102,241,0.02)');

  ctx.strokeStyle = 'rgba(129,140,248,0.9)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Fill
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Ligne centrale 0 dB (plus visible)
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();
}

// ── _updatePresetBtns ─────────────────────────────────────────────────────────
function _updatePresetBtns(active) {
  document.querySelectorAll('#eq-presets .eq-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === active);
  });
}

// ── _syncEQUI ─────────────────────────────────────────────────────────────────
function _syncEQUI() {
  _updatePresetBtns(_activePreset);
  const abBtn = document.getElementById('eq-ab-btn');
  if (abBtn) {
    abBtn.dataset.state = _abMode ? 'a' : 'b';
    abBtn.setAttribute('aria-pressed', String(_abMode));
  }
  const autoBtn = document.getElementById('eq-auto-btn');
  if (autoBtn) autoBtn.setAttribute('aria-pressed', String(eqAutoMode));
  _updateSmartStatus();
}

// ── Handler input slider (wired via data-input-action="eq-band-input") ────────
// Exposé sur window pour que handlers.js puisse le brancher si nécessaire
export function handleEQBandInput(e) {
  const idx = parseInt(e.target.dataset.band, 10);
  if (isNaN(idx)) return;
  setEQBand(idx, parseFloat(e.target.value));
}

// ── Wiring handlers #eq-bands (délégation locale) ────────────────────────────
// Les sliders EQ sont régénérés par renderEQBands() → on délègue depuis le conteneur.
if (typeof document !== 'undefined') {
  document.addEventListener('input', e => {
    if (e.target.closest('#eq-bands') && e.target.dataset.inputAction === 'eq-band-input') {
      handleEQBandInput(e);
    }
  });
}
