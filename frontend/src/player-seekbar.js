// @ts-check
/**
 * player-seekbar.js — Seek bar event handling.
 *
 * Extracted from player.js (Task 1 of player-split plan).
 * Owns: pbar DOM refs, seek state, seek-tip tooltip, pointer/mouse/keyboard listeners.
 *
 * Imports `audio` from player.js (not circular — player.js does NOT import seekbar).
 */

import { fmt }   from './utils.js';
import { audio } from './player.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const pbar     = document.getElementById('pbar');
const pfill    = document.getElementById('pfill');
const _seekTip = document.getElementById('seek-tip');

// ── Seek state ────────────────────────────────────────────────────────────────
let seeking = false;
/** @type {DOMRect | null} */
let _seekRect = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  // Bug-3 FIX: guard contre audio.duration NaN ou 0 (fichier non chargé / vidé mid-drag)
  if (!audio.duration || isNaN(audio.duration)) return;
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

// ── Event listeners ───────────────────────────────────────────────────────────

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

  const _endSeek = () => { seeking = false; _seekRect = null; _seekTip?.classList.remove('on'); };
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
  pbar.addEventListener('mouseleave', () => { if (!seeking) _seekTip?.classList.remove('on'); });

  pbar.addEventListener('keydown', (e) => {
    const dur = audio.duration;
    if (!dur) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.min(dur, audio.currentTime + step); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.max(0, audio.currentTime - step); }
    else if (e.key === 'Home') { e.preventDefault(); audio.currentTime = 0; }
    else if (e.key === 'End')  { e.preventDefault(); audio.currentTime = dur; }
  });
}
