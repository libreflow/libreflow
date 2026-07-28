// LibreFlow — cinema-loop.js
// Boucle rAF MAÎTRE du mode cinéma (spec 2026-07-04 §2.1). Propriétaire unique du
// rAF : cinema-bg.js et cinema-viz.js sont des renderers passifs (drawFrame).
// Par frame : dt clampé → snapshot FFT partagé → beat unique → drawBg → drawViz.
// Politique de cadence centralisée : 60fps focalisé (waves/starfield/spectrum),
// 30fps ambient/amoled ou sans focus, sommeil quand tout est statique en pause.
import { createBeatDetector } from './cinema-beat.js';
import { prefersReducedMotion } from './motion.js';

const DT_MAX_MS = 100; // clamp — absorbe les reprises d'onglet sans téléporter les phases

let _deps = null, _raf = null, _gen = 0, _last = 0, _frame = 0;
let _fftBuf = null;
let _hasFocus = (typeof document !== 'undefined') ? document.hasFocus() : true;
const _beatDet = createBeatDetector({ history: 43, threshold: 1.35, cooldownMs: 650 });

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { _hasFocus = true; });
  window.addEventListener('blur',  () => { _hasFocus = false; });
}

/** Cadence pure : 1 = 60fps, 2 = 30fps (skip 1 frame/2). */
export function loopCadence(mode, hasFocus) {
  if (!hasFocus) return 2;
  if (mode === 'ambient' || mode === 'amoled') return 2; // drift 15-30s — 30fps invisible
  return 1;
}

/** Énergie basses (10% premiers bins, moyenne des carrés) — même formule que l'ex-_detectBeat. */
export function computeBassEnergy(fft) {
  const end = Math.max(1, Math.floor(fft.length * 0.10));
  let e = 0;
  for (let i = 0; i < end; i++) e += fft[i] * fft[i];
  return e / end;
}

export function initCinemaLoop(deps) { _deps = deps; }

function _tick(now) {
  const myGen = _gen;
  if (!_deps || !_deps.getCinemaOpen() || document.hidden) { _raf = null; return; }
  if (loopCadence(_deps.getBgMode(), _hasFocus) === 2 && (_frame++ % 2 !== 0)) {
    _raf = requestAnimationFrame(_tick); return;
  }
  const dt = Math.min(DT_MAX_MS, now - _last);
  _last = now;
  // ── Snapshot FFT partagé : UNE lecture par frame pour bg+viz+vol-vis ──
  const analyser = _deps.getAnalyser();
  let fft = null, beat = false;
  if (analyser) {
    if (!_fftBuf || _fftBuf.length !== analyser.frequencyBinCount) _fftBuf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(_fftBuf);
    fft = _fftBuf;
    beat = !prefersReducedMotion() && _beatDet.sample(computeBassEnergy(fft), now);
  }
  const bgActive  = _deps.drawBg(dt, fft, beat);
  const vizActive = _deps.drawViz(dt, fft, beat);
  if (myGen !== _gen) return; // stopCinemaLoop() appelé pendant le draw
  // Sommeil : reduced-motion = 1 frame puis stop ; pause + tout convergé = stop.
  if (prefersReducedMotion()) { _raf = null; return; }
  if (!_deps.getIsPlaying() && !bgActive && !vizActive) { _raf = null; return; }
  _raf = requestAnimationFrame(_tick);
}

export function startCinemaLoop() {
  if (_raf) return;
  _gen++; _last = performance.now(); _frame = 0;
  _raf = requestAnimationFrame(_tick);
}

export function stopCinemaLoop() {
  _gen++;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}

/** Réveil après sommeil (play/resize/mode/piste/visibilitychange) — no-op si déjà actif. */
export function wakeCinemaLoop() {
  if (!_deps || !_deps.getCinemaOpen() || _raf) return;
  _last = performance.now();
  _raf = requestAnimationFrame(_tick);
}
