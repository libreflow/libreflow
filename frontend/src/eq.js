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
//   toggleEQ, closeEQ, setEQBand, applyEQPreset, getActiveEqPreset, applyEQGains
//   setEQAutoMode, toggleEQAutoMode, applyGenreEQ
//   startSmartEQ, stopSmartEQ, updateSmartEQLoudness, updateSmartEQGenre
//   loadEQProfiles, getEQProfiles
//   renderEQBands, filterEQPresets, toggleEQAB
//   setMasterGain

import { get, set } from './store.js';
import { emit, EVENTS } from './bus.js';
import { i18n } from './i18n.js';

// ── Fréquences Bark (10 bandes) ──────────────────────────────────────────────
const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_BAND_COUNT = 10;

// ── Noeuds exportés (live bindings) ──────────────────────────────────────────
/** @type {AudioContext | null} */
export let eqCtx        = null;
/** @type {MediaElementAudioSourceNode | null} */
export let eqSource     = null;
/** @type {BiquadFilterNode[]} */
export let eqNodes      = [];
/** @type {AnalyserNode | null} */
export let eqAnalyser   = null;
/** @type {GainNode | null} */
export let audioOutGain = null;
/** @type {GainNode | null} */
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
let _eqInitFailed   = false;  // B30 — true si new AudioContext() a échoué : court-circuite les retries

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
let _preBypassGains = null;      // gains sauvegardés avant bypass (power off) — restaurés au ré-enable

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
  // B30 FIX : _eqInitFailed court-circuite les retries — sans ça, un échec de
  // `new AudioContext()` laisse eqCtx=null sans flag et chaque setEQBand /
  // applyEQPreset / toggleEQAB re-tente (et re-échoue) indéfiniment.
  if (_eqInitialized || _eqInitFailed) return;   // R6 — singleton : createMediaElementSource ne doit être appelé qu'une fois

  const audio = document.getElementById('audio');
  if (!audio) { console.warn('[eq] <audio> introuvable'); return; }

  try {
    // @ts-ignore — webkitAudioContext est non-standard (Safari/WebKit) mais présent dans Tauri WebView
    eqCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('[eq] AudioContext non disponible', e);
    _eqInitFailed = true;
    return;
  }

  eqCtx.onstatechange = () => {
    if (eqCtx.state === 'suspended' || eqCtx.state === 'interrupted') {
      ensureEQResumed();
    }
  };

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
  _attachEqCurveResizeObserver(); // R-M7 : redessine la courbe au resize du wrap
  _syncEQUI();
}

// ── ensureEQResumed ───────────────────────────────────────────────────────────
/** Relance l'AudioContext si suspendu ou interrompu (autoplay policy, OS interrupt). */
export function ensureEQResumed() {
  if (eqCtx && (eqCtx.state === 'suspended' || eqCtx.state === 'interrupted')) {
    eqCtx.resume().catch(e => console.warn('[eq:resume]', e));
  }
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
    // Fallback avant initEQ() — lire depuis le slider DOM (R1 : jamais hardcoder audio.volume)
    const _audio = document.getElementById('audio');
    const _volEl = document.getElementById('vol');
    if (_audio && _volEl) _audio.volume = parseFloat(_volEl.value);
  }
}

// ── Focus trap EQ (FOCUS-1) ───────────────────────────────────────────────────
const _EQ_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
let _eqFocusTrap = null;

function _setupEQFocusTrap(panel) {
  if (_eqFocusTrap) panel.removeEventListener('keydown', _eqFocusTrap);
  _eqFocusTrap = (e) => {
    if (e.code !== 'Tab') return;
    const focusable = [...panel.querySelectorAll(_EQ_FOCUSABLE)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  panel.addEventListener('keydown', _eqFocusTrap);
}

// ── toggleEQ / closeEQ ───────────────────────────────────────────────────────
export function toggleEQ() {
  const panel = document.getElementById('eq-panel');
  if (!panel) return;
  eqOpen = !eqOpen;
  panel.classList.toggle('open', eqOpen);
  // Parité avec la file d'attente : pousser #main (padding-right) au lieu de le
  // recouvrir. La règle CSS #app.panel-eq-open #main existait mais la classe
  // n'était jamais posée — le panneau EQ chevauchait la bibliothèque.
  document.getElementById('app')?.classList.toggle('panel-eq-open', eqOpen);
  // A11Y : aria-expanded reflète l'ouverture du panneau ; .active = repère visuel
  // d'ouverture (cohérent avec #btn-queue). L'état ACTIVÉ de l'EQ vit désormais
  // sur le bouton power du panneau (.eq-power), plus sur #btn-eq (levée de l'ambiguïté).
  const _eqBtn = document.getElementById('btn-eq');
  if (_eqBtn) {
    _eqBtn.setAttribute('aria-expanded', eqOpen ? 'true' : 'false');
    _eqBtn.classList.toggle('active', eqOpen);
  }
  if (eqOpen) {
    if (!eqCtx) initEQ();
    renderEQBands();
    _drawEQCurve();
    _syncEQUI();
    // FOCUS-1 FIX : activer le trap quand le panneau est ouvert
    _setupEQFocusTrap(panel);
  }
}

export function closeEQ() {
  if (!eqOpen) return;
  eqOpen = false;
  const panel = document.getElementById('eq-panel');
  if (panel) panel.classList.remove('open');
  const _eqBtn = document.getElementById('btn-eq');
  _eqBtn?.setAttribute('aria-expanded', 'false'); // A11Y
  _eqBtn?.classList.remove('active');              // repère d'ouverture
  document.getElementById('app')?.classList.remove('panel-eq-open'); // libère le push de #main
}

// ── setEQBand ─────────────────────────────────────────────────────────────────
/** Modifie le gain de la bande `idx` (0-9) à la valeur `db` (en dB). */
export function setEQBand(idx, db) {
  if (isNaN(db) || !isFinite(db)) return;
  if (!eqCtx) initEQ();
  if (!eqNodes[idx]) return;
  const val = Math.max(-12, Math.min(12, db));
  eqNodes[idx].gain.setTargetAtTime(val, eqCtx.currentTime, 0.01);
  // Mettre à jour l'affichage du slider. Le libellé visible n'affiche plus « dB »
  // (l'échelle l'implique, ça évite le retour à la ligne) ; aria-valuetext le garde.
  const num = (val >= 0 ? '+' : '') + val.toFixed(1);
  const slider = document.querySelector(`#eq-bands [data-band="${idx}"]`);
  if (slider) {
    slider.value = val;
    slider.setAttribute('aria-valuetext', num + ' dB');
  }
  const label = document.querySelector(`#eq-bands [data-band-label="${idx}"]`);
  if (label) {
    label.textContent = num;
    label.classList.toggle('eq-val--boost', val > 0);
    label.classList.toggle('eq-val--cut',   val < 0);
    label.classList.toggle('eq-val--flat',  val === 0);
  }
  // Une édition manuelle rend le réglage « personnalisé » : on désélectionne le
  // preset actif et on met à jour l'indicateur (sinon le footer mentait encore).
  if (_activePreset !== 'custom') {
    _activePreset = 'custom';
    _updatePresetBtns('custom');
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

// ── Animation spring sliders ──────────────────────────────────────────────────
let _animFrame = 0;

/** Approximation de --spring-soft : cubic-bezier(.34,1.2,.64,1) */
function _easeSpringSoft(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = 1 - t;
  return 1 - u * u * u * (1 + 2.2 * t);
}

/**
 * Anime visuellement les sliders de leur position courante vers targetGains.
 * Audio : géré en amont via setTargetAtTime (_applyGains).
 * Visual : rAF 220ms avec spring-soft — ne touche pas au graphe audio.
 */
function _animateSlidersTo(targetGains) {
  cancelAnimationFrame(_animFrame);
  const DUR    = 220; // --dur-mid
  const tStart = performance.now();
  const bands  = document.querySelectorAll('#eq-bands .eq-band');
  if (!bands.length) { renderEQBands(); _drawEQCurve(); return; }

  const sliders = Array.from(bands, band => band.querySelector('.eq-slider'));
  const labels  = Array.from(bands, band => band.querySelector('.eq-val'));
  const from = Array.from(bands, band => {
    const s = band.querySelector('.eq-slider');
    return s ? parseFloat(s.value) || 0 : 0;
  });

  function tick(now) {
    const t = Math.min((now - tStart) / DUR, 1);
    const e = _easeSpringSoft(t);
    bands.forEach((band, i) => {
      const v      = from[i] + (targetGains[i] - from[i]) * e;
      const slider = sliders[i];
      const label  = labels[i];
      if (slider) slider.value = v;
      if (label) {
        const cls = v > 0.05 ? 'eq-val--boost' : v < -0.05 ? 'eq-val--cut' : 'eq-val--flat';
        label.textContent = (v >= 0 ? '+' : '') + v.toFixed(1); // sans « dB » (cf. #11)
        label.className   = `eq-val ${cls}`;
      }
    });
    _drawEQCurve();
    if (t < 1) _animFrame = requestAnimationFrame(tick);
  }
  _animFrame = requestAnimationFrame(tick);
}

// ── applyEQPreset ─────────────────────────────────────────────────────────────
export function applyEQPreset(presetName) {
  if (!eqCtx) initEQ();
  const gains = EQ_PRESETS[presetName] ?? EQ_PRESETS.flat;
  _activePreset = presetName;
  _applyGains(gains);              // audio : setTargetAtTime (sans click)
  _updatePresetBtns(presetName);
  _animateSlidersTo(gains);        // visuel : spring 220ms
  // Les gains du preset priment sur une éventuelle sauvegarde de bypass, et on
  // active sans repasser par _setEQEnabled (qui ré-appliquerait des gains).
  _preBypassGains = null;
  if (!eqEnabled) { eqEnabled = true; _updatePowerBtn(); }
}

export function getActiveEqPreset() {
  return _activePreset;
}

/** Applique un tableau de 10 gains (en dB) depuis un profil par appareil.
 *  Active l'EQ si nécessaire et marque le preset comme 'custom'. */
export function applyEQGains(bands) {
  if (!Array.isArray(bands) || bands.length !== EQ_BAND_COUNT) return;
  if (!eqCtx) initEQ();
  _activePreset = 'custom';
  _applyGains(bands);
  _updatePresetBtns('custom'); // aucun preset bouton actif
  _animateSlidersTo(bands);
  _preBypassGains = null;
  if (!eqEnabled) { eqEnabled = true; _updatePowerBtn(); }
}

// ── toggleEQ enabled (bypass) ─────────────────────────────────────────────────
function _setEQEnabled(val) {
  eqEnabled = !!val;
  _updatePowerBtn();
  // Cohérence visuelle du bypass : .eq-off grise + neutralise les bandes/courbe
  // (cf. _drawEQCurve qui lit les noeuds aplatis) → ce qu'on voit = ce qu'on entend.
  document.getElementById('eq-panel')?.classList.toggle('eq-off', !eqEnabled);
  const zeros = new Array(EQ_BAND_COUNT).fill(0);
  if (!eqEnabled) {
    // Bypass : mémoriser les gains courants (custom inclus) puis aplatir (audio + visuel).
    _preBypassGains = eqNodes.length ? eqNodes.map(n => n.gain.value) : null;
    _applyGains(zeros);
    _animateSlidersTo(zeros);
  } else if (_preBypassGains) {
    // Ré-enable : restaurer exactement ce qui était là avant le bypass.
    _applyGains(_preBypassGains);
    _animateSlidersTo(_preBypassGains);
    _preBypassGains = null;
  } else {
    const gains = EQ_PRESETS[_activePreset] ?? EQ_PRESETS.flat;
    _applyGains(gains);
    _animateSlidersTo(gains);
  }
}

/** Reflète l'état ACTIVÉ/bypass sur le bouton power du panneau (.eq-power). */
function _updatePowerBtn() {
  const btn = document.querySelector('#eq-panel .eq-power');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(eqEnabled));
  btn.classList.toggle('eq-power--off', !eqEnabled);
  const lbl = btn.querySelector('.eq-tool-label');
  if (lbl) lbl.textContent = i18n(eqEnabled ? 'eq_on' : 'eq_off');
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
}

export function stopSmartEQ() {
  _smartRunning = false;
}

export function updateSmartEQGenre(genre) {
  _smartGenre = genre || '';
  if (_smartRunning && eqAutoMode) {
    applyGenreEQ(_smartGenre);
  }
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

// ── setEQAutoMode / toggleEQAutoMode ─────────────────────────────────────────
export function setEQAutoMode(val) {
  eqAutoMode = !!val;
  // Refléter l'état AUTO dans l'UI : presets/catégories grisés, bandes en lecture
  // seule (teinte art-color), bouton AUTO pressé. (Les éléments peuvent ne pas
  // exister au boot → querySelector null-safe.)
  document.getElementById('eq-presets')?.classList.toggle('eq-presets--disabled', eqAutoMode);
  document.getElementById('eq-cats')?.classList.toggle('eq-cats--disabled', eqAutoMode);
  document.getElementById('eq-bands')?.classList.toggle('eq-bands--auto', eqAutoMode);
  const btn = document.querySelector('#eq-panel .eq-auto-btn');
  if (btn) { btn.setAttribute('aria-pressed', String(eqAutoMode)); btn.classList.toggle('active', eqAutoMode); }
  if (eqAutoMode) {
    startSmartEQ();
    const t = get('tracks')?.[get('curIdx')];
    if (t?.genre) applyGenreEQ(t.genre); // applique tout de suite le preset du genre courant
  } else {
    stopSmartEQ();
  }
}

export function toggleEQAutoMode() {
  setEQAutoMode(!eqAutoMode);
}

// ── A/B comparison ────────────────────────────────────────────────────────────
export function toggleEQAB() {
  if (!eqCtx) initEQ();
  _abMode = !_abMode;
  if (_abMode) {
    // Mode A : sauvegarde gains courants, applique flat
    _abSavedGains = eqNodes.map(n => n.gain.value);
    _applyGains(EQ_PRESETS.flat);
  } else {
    // Mode B : restaure gains sauvegardés
    if (_abSavedGains) _applyGains(_abSavedGains);
    _abSavedGains = null;
  }
  const btn = document.querySelector('#eq-panel .eq-ab-btn');
  if (btn) { btn.setAttribute('aria-pressed', String(_abMode)); btn.classList.toggle('active', _abMode); }
  _drawEQCurve();
}

// ── toggleEQEnabled — bypass on/off (bouton power du panneau) ──────────────────
/** Active/désactive l'EQ (bypass). Sauvegarde/restaure les gains courants. */
export function toggleEQEnabled() {
  if (!eqCtx) initEQ();
  _setEQEnabled(!eqEnabled);
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
    // « Tous » montre tout ; une catégorie précise ne montre que SES presets
    // (on ne réinjecte plus les presets « all » partout → moins de bruit).
    btn.style.display = (cat === 'all' || bcat === cat) ? '' : 'none';
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

  const resetHint = i18n('eq_band_reset_hint');
  let html = '';
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const g   = gains[i];
    const v   = g.toFixed(1);
    const num = (g >= 0 ? '+' : '') + v;   // libellé visible — sans « dB » (1 ligne)
    const aria = num + ' dB';              // aria-valuetext — garde l'unité pour le SR
    const mod = g > 0 ? 'eq-val--boost' : g < 0 ? 'eq-val--cut' : 'eq-val--flat';
    html += `<div class="eq-band">
  <span class="eq-val ${mod}" data-band-label="${i}">${num}</span>
  <div class="eq-slider-wrap">
    <input type="range" class="eq-slider" orient="vertical"
      data-band="${i}" data-input-action="eq-band-input"
      min="-12" max="12" step="0.5" value="${v}"
      aria-orientation="vertical" title="${LABELS[i]} Hz — ${resetHint}"
      aria-label="${LABELS[i]} Hz" aria-valuetext="${aria}">
  </div>
  <span class="eq-freq">${LABELS[i]}</span>
</div>`;
  }
  container.innerHTML = html;

  // P4 : double-clic sur slider → reset cette bande à 0 dB avec spring animation
  container._eqDblClick && container.removeEventListener('dblclick', container._eqDblClick);
  container._eqDblClick = (e) => {
    const slider = e.target.closest('.eq-slider');
    if (slider) _resetBand(parseInt(slider.dataset.band, 10), slider);
  };
  container.addEventListener('dblclick', container._eqDblClick);

  // WCAG 2.5.7 + découvrabilité : alternative clavier au double-clic — Suppr /
  // Retour arrière / 0 sur un slider focalisé réinitialise cette bande à 0 dB.
  container._eqKeyDown && container.removeEventListener('keydown', container._eqKeyDown);
  container._eqKeyDown = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace' && e.key !== '0') return;
    const slider = e.target.closest('.eq-slider');
    if (!slider) return;
    e.preventDefault();
    _resetBand(parseInt(slider.dataset.band, 10), slider);
  };
  container.addEventListener('keydown', container._eqKeyDown);
}

/** Réinitialise une bande à 0 dB (audio sans glitch + spring visuel + flash). */
function _resetBand(idx, slider) {
  if (isNaN(idx) || !eqCtx || !eqNodes[idx]) return;
  eqNodes[idx].gain.setTargetAtTime(0, eqCtx.currentTime, 0.01);
  const targetGains = eqNodes.map(n => n.gain.value);
  targetGains[idx] = 0;
  _animateSlidersTo(targetGains);
  if (_activePreset !== 'custom') { _activePreset = 'custom'; _updatePresetBtns('custom'); }
  const wrap = slider?.closest('.eq-slider-wrap');
  if (wrap) {
    wrap.classList.remove('eq-band-reset');
    void wrap.offsetWidth; // force reflow pour relancer l'animation
    wrap.classList.add('eq-band-reset');
  }
}

// ── _getArtRgb — couleur d'accent dynamique depuis --art-color ───────────────
function _getArtRgb() {
  const styles = getComputedStyle(document.documentElement);
  for (const prop of ['--art-color', '--g']) {
    const raw = styles.getPropertyValue(prop).trim();
    if (!raw) continue;
    const m = raw.match(/\d+/g);
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  }
  return [99, 102, 241]; // fallback indigo
}

// ── _updateCurveHeight — hauteur adaptative canvas (P1) ──────────────────────
/**
 * Active/désactive .eq-curve-active sur #eq-panel selon que les gains sont plats.
 * Expert flat → 80px  |  Expert actif → 160px  (défini en CSS).
 */
function _updateCurveHeight() {
  const panel = document.getElementById('eq-panel');
  if (!panel) return;
  const active = eqNodes.length
    ? eqNodes.some(n => Math.abs(n.gain.value) > 0.05)
    : false;
  panel.classList.toggle('eq-curve-active', active);
}

// ── _attachEqCurveResizeObserver — R-M7 ──────────────────────────────────────
/**
 * Observe #eq-curve-wrap : redessine la courbe quand le wrap change de taille
 * (resize fenêtre, passage Simple/Expert, panneau qui se réajuste).
 * Sans ça, le canvas garde le fallback hardcodé 260×116 jusqu'au prochain
 * événement EQ. Callback debouncé via rAF — aucune allocation dans la boucle.
 */
let _eqResizeObserver = null;
function _attachEqCurveResizeObserver() {
  if (_eqResizeObserver || typeof ResizeObserver === 'undefined') return;
  const wrap = document.getElementById('eq-curve-wrap');
  if (!wrap) return;
  let _eqRoRaf = null;
  _eqResizeObserver = new ResizeObserver(() => {
    if (_eqRoRaf) cancelAnimationFrame(_eqRoRaf);
    _eqRoRaf = requestAnimationFrame(() => {
      _eqRoRaf = null;
      _drawEQCurve();
    });
  });
  _eqResizeObserver.observe(wrap);
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
  if (!ctx) return;
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

  // Remplissage gradient sous la courbe — couleur suit --art-color
  const [ar, ag, ab] = _getArtRgb();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   `rgba(${ar},${ag},${ab},0.35)`);
  grad.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.12)`);
  grad.addColorStop(1,   `rgba(${ar},${ag},${ab},0.02)`);

  ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.9)`;
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

  _updateCurveHeight(); // P1 — hauteur adaptative selon gains actifs

  // A11Y : alternative textuelle pour SR — résume la courbe (graves/médiums/aigus moyens).
  // Mise à jour à chaque redraw (drag d'une bande, preset, profil device, etc.).
  if (!wrap.getAttribute('role')) wrap.setAttribute('role', 'img');
  const _avg = (a, b) => {
    let s = 0; for (let i = a; i <= b; i++) s += gains[i] || 0;
    return s / (b - a + 1);
  };
  const _fmt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
  const bass = _avg(0, 2);   // 32–125 Hz
  const mids = _avg(3, 6);   // 250–2000 Hz
  const treb = _avg(7, 9);   // 4 k–16 k Hz
  wrap.setAttribute(
    'aria-label',
    `Courbe EQ : graves ${_fmt(bass)}, médiums ${_fmt(mids)}, aigus ${_fmt(treb)}`
  );
}

// ── _updatePresetBtns ─────────────────────────────────────────────────────────
function _updatePresetBtns(active) {
  document.querySelectorAll('#eq-presets .eq-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === active);
  });
  // Sync le label preset dans le footer
  const footerLabel = document.getElementById('eq-preset-label');
  if (footerLabel) {
    const activeBtn = document.querySelector(`#eq-presets .eq-preset[data-preset="${active}"]`);
    footerLabel.textContent = activeBtn ? activeBtn.textContent.trim()
                            : active === 'custom' ? i18n('eq_custom') : active;
  }
}

// ── Mode Simple / Expert ──────────────────────────────────────────────────────
export let eqExpert = false;

export function setEQExpert(val) {
  eqExpert = !!val;
  const panel = document.getElementById('eq-panel');
  if (panel) panel.classList.toggle('eq-expert', eqExpert);
  // P7 : largeur Expert 400px — classe sur #app pour le padding-right de #main
  document.getElementById('app')?.classList.toggle('eq-expert-mode', eqExpert);
  document.querySelectorAll('.eq-mode-btn').forEach(btn => {
    const isExpert = btn.dataset.mode === 'expert';
    btn.classList.toggle('active', isExpert === eqExpert);
    btn.setAttribute('aria-pressed', String(isExpert === eqExpert));
  });
  // En passant en Expert, s'assurer que les bandes sont rendues
  if (eqExpert) { renderEQBands(); }
  _drawEQCurve();          // redessine (appelle _updateCurveHeight en fin)
}

export function toggleEQExpert() { setEQExpert(!eqExpert); }

// ── _syncEQUI ─────────────────────────────────────────────────────────────────
function _syncEQUI() {
  _updatePresetBtns(_activePreset);
  _updatePowerBtn();
  // Refléter AUTO si restauré depuis cfg avant l'ouverture du panneau.
  const autoBtn = document.querySelector('#eq-panel .eq-auto-btn');
  if (autoBtn) { autoBtn.setAttribute('aria-pressed', String(eqAutoMode)); autoBtn.classList.toggle('active', eqAutoMode); }
  document.getElementById('eq-presets')?.classList.toggle('eq-presets--disabled', eqAutoMode);
  document.getElementById('eq-cats')?.classList.toggle('eq-cats--disabled', eqAutoMode);
  document.getElementById('eq-bands')?.classList.toggle('eq-bands--auto', eqAutoMode);
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
