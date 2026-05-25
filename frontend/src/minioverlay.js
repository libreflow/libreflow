// LibreFlow — minioverlay.js
// Mini-player overlay flottant in-page (coin bas-droit, draggable).
// Distinct du mini-player Tauri fenêtre séparée (miniplayer.js).
//
// Remaining window.* : window.innerWidth/Height (DOM).
//
// Exports publics :
//   miniOvOpen, toggleMiniOverlay, syncMiniOverlay,
//   updateMiniOverlayProgress, initMiniOverlayDrag

import { get }   from './store.js';
import { audio } from './player.js';

const SVG_PLAY  = `<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21" fill="currentColor"/></svg>`;
const SVG_PAUSE = `<svg viewBox="0 0 24 24"><rect x="5.5" y="4" width="4" height="16" rx="1.5" fill="currentColor"/><rect x="14.5" y="4" width="4" height="16" rx="1.5" fill="currentColor"/></svg>`;

// ── État ──────────────────────────────────────────────────────────
export let miniOvOpen = false;

// ── Toggle ────────────────────────────────────────────────────────
export function toggleMiniOverlay() {
  miniOvOpen = !miniOvOpen;
  const el = document.getElementById('mp-ov');
  if (!el) return;
  if (miniOvOpen) {
    el.classList.remove('closing');
    el.classList.add('on');
    syncMiniOverlay();
  } else {
    // P3-5 : animation de sortie avant display:none
    el.classList.add('closing');
    el.addEventListener('animationend', () => {
      el.classList.remove('on', 'closing');
    }, { once: true });
  }
}

// ── Sync état complet (piste + play/pause) ────────────────────────
export function syncMiniOverlay() {
  if (!miniOvOpen) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3

  // Icône play/pause
  const playBtn = document.getElementById('mp-ov-play');
  if (playBtn) playBtn.innerHTML = (audio && !audio.paused) ? SVG_PAUSE : SVG_PLAY;

  const titleEl  = document.getElementById('mp-ov-title');
  const artistEl = document.getElementById('mp-ov-artist');
  const img      = document.getElementById('mp-ov-img');
  const em       = document.getElementById('mp-ov-em');

  // Sync like button
  const likeBtn = document.getElementById('mp-ov-like');

  if (curIdx < 0 || !tracks || !tracks[curIdx]) {
    if (titleEl)  titleEl.textContent  = '–';
    if (artistEl) artistEl.textContent = '–';
    if (img) img.style.display = 'none';
    if (em)  em.style.display  = '';
    if (likeBtn) { likeBtn.classList.remove('on'); likeBtn.setAttribute('aria-pressed', 'false'); }
    return;
  }

  const t = tracks[curIdx];
  if (titleEl)  titleEl.textContent  = t.name  || '–';
  if (artistEl) artistEl.textContent = t.artistFull || t.artist || '–';

  if (img && em) {
    if (t.art) {
      img.src = t.art;
      img.style.display = 'block';
      em.style.display  = 'none';
    } else {
      img.style.display = 'none';
      em.style.display  = '';
    }
  }

  if (likeBtn) {
    const liked = get('liked');
    const isLiked = !!(liked && t.id && liked.has(t.id));
    likeBtn.classList.toggle('on', isLiked);
    likeBtn.setAttribute('aria-pressed', String(isLiked));
  }
}

// ── Mise à jour progression (throttled 250ms) ─────────────────────
let _lastOvProg = 0;
export function updateMiniOverlayProgress() {
  if (!miniOvOpen) return;
  const now = Date.now();
  if (now - _lastOvProg < 250) return;
  _lastOvProg = now;
  if (!audio || !audio.duration) return;
  const fill = document.getElementById('mp-ov-fill');
  if (fill) fill.style.width = (audio.currentTime / audio.duration * 100).toFixed(1) + '%';
}

// ── R-M6 : re-clamp au resize ──────────────────────────────────────
/**
 * Appelé par le listener `resize` centralisé d'app.js.
 * Après un drag, l'overlay passe en positionnement `left/top` absolu : si la
 * fenêtre rétrécit, il peut se retrouver hors écran et inatteignable. On
 * re-clampe `left/top` aux bornes du viewport. No-op si fermé ou si l'overlay
 * est encore ancré en `right/bottom` (jamais déplacé).
 */
export function reclampMiniOverlay() {
  if (!miniOvOpen) return;
  const el = document.getElementById('mp-ov');
  if (!el || !el.style.left) return; // pas encore déplacé → ancrage CSS right/bottom
  const maxX = Math.max(0, window.innerWidth  - el.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
  const x = Math.min(parseFloat(el.style.left) || 0, maxX);
  const y = Math.min(parseFloat(el.style.top)  || 0, maxY);
  el.style.left = Math.max(0, x) + 'px';
  el.style.top  = Math.max(0, y) + 'px';
}

// ── Drag (pointerdown — support souris + touch) ────────────────────
export function initMiniOverlayDrag() {
  const el = document.getElementById('mp-ov');
  if (!el) return;
  let ox = 0, oy = 0, sx = 0, sy = 0;

  function onMove(e) {
    const nx = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ox + e.clientX - sx));
    const ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + e.clientY - sy));
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';
  }

  function onUp(e) {
    el.classList.remove('dragging');
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup',   onUp);
    el.releasePointerCapture(e.pointerId);
  }

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const rect = el.getBoundingClientRect();
    ox = rect.left; oy = rect.top;
    sx = e.clientX; sy = e.clientY;
    // Passer de right/bottom à left/top pour que le drag fonctionne
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
    el.style.left   = ox + 'px';
    el.style.top    = oy + 'px';
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup',   onUp);
  });
}