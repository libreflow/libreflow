// LibreFlow — waveform.js
// Barre de progression waveform sous la seekbar.
// Décode l'audio en arrière-plan via OfflineAudioContext et dessine les peaks.
//
// Usage:
//   import { initWaveform, wfLoad, wfUpdate, wfClear } from './waveform.js';
//   initWaveform(audioElement); // une seule fois au boot
//   wfLoad(track.id, track.url); // à chaque changement de piste
//   wfUpdate(progress);          // à chaque timeupdate (0..1)
//   wfClear();                   // à l'arrêt / réinitialisation

let _instance = null;

export function initWaveform(audioEl) {
  _instance = _createWaveform(audioEl);
}
export function wfLoad(id, url) { _instance?.load(id, url); }
export function wfUpdate(p)     { _instance?.update(p); }
export function wfClear()       { _instance?.clear(); }

function _createWaveform(audio) {
  const pbar = document.getElementById('pbar');
  if (!pbar) return null;

  const canvas = document.createElement('canvas');
  canvas.id = 'pbar-wave';
  pbar.insertBefore(canvas, pbar.firstChild);
  const ctx = canvas.getContext('2d');

  let peaks      = null;   // Float32Array normalisée
  let loadingId  = null;   // track id en cours de décodage
  let progress   = 0;      // 0..1
  let accentHex  = '#3b82f6';
  let rafId      = null;
  let hoverRatio = -1;     // -1 = pas en survol
  let _wfW = 0, _wfH = 0, _wfDpr = 1; // P5 — cache ResizeObserver

  // ── Cache couleur accent — lit --g une seule fois par changement de thème ──
  function _refreshAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--g').trim();
    if (v) accentHex = v;
  }
  new MutationObserver(_refreshAccent).observe(document.documentElement, {
    attributeFilter: ['data-mode', 'data-theme'],
  });
  requestAnimationFrame(_refreshAccent);

  // MEMORY : limite de taille avant de charger le fichier en mémoire
  const WF_MAX_BYTES = 8 * 1024 * 1024; // 8 Mo — skip waveform pour les FLAC/WAV lourds
  async function decode(url, N = 300) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.status);
      const contentLen = parseInt(resp.headers.get('content-length') || '0', 10);
      if (contentLen > WF_MAX_BYTES) {
        resp.body?.cancel().catch(() => {});
        return null;
      }
      const arr  = await resp.arrayBuffer();
      const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
      let buf;
      try {
        buf = await actx.decodeAudioData(arr);
      } finally {
        actx.close(); // fermer dans tous les cas — évite le leak si decodeAudioData throw
      }
      const data = buf.getChannelData(0);
      // Clamp N to data.length to avoid step=0 on very short clips
      const _N   = Math.min(N, data.length);
      const step = Math.max(1, Math.floor(data.length / _N));
      const out  = new Float32Array(_N);
      for (let i = 0; i < _N; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) { const v = Math.abs(data[i * step + j]); if (v > max) max = v; }
        out[i] = max;
      }
      let mx = 0.001;
      for (let i = 0; i < N; i++) { if (out[i] > mx) mx = out[i]; }
      for (let i = 0; i < N; i++) out[i] /= mx;
      return out;
    } catch { return null; }
  }

  function draw() {
    const W = _wfW, H = _wfH;
    if (!W || !H || !peaks) return;
    ctx.clearRect(0, 0, W, H);
    const N    = peaks.length;
    const bw   = W / N;
    const gap  = Math.max(0.8, bw * 0.18);
    const splitX = W * progress;
    const accent    = accentHex || '#3b82f6';
    const isLight   = document.documentElement.dataset.mode === 'light';
    const unplCol   = isLight ? '#000000' : '#ffffff';
    const unplAlpha = isLight ? 0.18 : 0.22;

    for (let i = 0; i < N; i++) {
      const x  = i * bw;
      const bh = Math.max(1.5, peaks[i] * H * 0.88);
      const y  = (H - bh) / 2;
      const w  = bw - gap;
      if (x + w <= splitX) {
        ctx.fillStyle = accent; ctx.globalAlpha = 0.9;
      } else if (x >= splitX) {
        ctx.fillStyle = unplCol; ctx.globalAlpha = unplAlpha;
      } else {
        const ratio = (splitX - x) / w;
        ctx.fillStyle = accent; ctx.globalAlpha = 0.9;
        ctx.fillRect(x, y, w * ratio, bh);
        ctx.fillStyle = unplCol; ctx.globalAlpha = unplAlpha;
        ctx.fillRect(x + w * ratio, y, w * (1 - ratio), bh);
        continue;
      }
      ctx.fillRect(x, y, w, bh);
    }
    if (hoverRatio >= 0) {
      const hx = Math.round(hoverRatio * W);
      ctx.fillStyle = isLight ? '#000' : '#fff';
      ctx.globalAlpha = isLight ? 0.5 : 0.75;
      ctx.fillRect(hx - 0.5, 0, 1.5, H);
    }
    ctx.globalAlpha = 1;
  }

  const _seekTip = pbar.querySelector('#seek-tip');
  function _showTip(e, ratio) {
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0 || !_seekTip) return;
    const t = ratio * audio.duration;
    const m = Math.floor(t / 60), s = String(Math.floor(t % 60)).padStart(2, '0');
    _seekTip.textContent = `${m}:${s}`;
    _seekTip.style.left = (ratio * 100) + '%';
    _seekTip.classList.add('on');
  }
  function _hideTip() { if (_seekTip) _seekTip.classList.remove('on'); }

  pbar.addEventListener('mousemove', e => {
    const r = pbar.getBoundingClientRect();
    hoverRatio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    _showTip(e, hoverRatio);
    if (peaks) { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }
  });
  pbar.addEventListener('mouseleave', () => {
    hoverRatio = -1;
    _hideTip();
    if (peaks) { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }
  });

  function update(ratio) {
    progress = ratio;
    if (peaks) { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }
  }

  async function load(id, url) {
    if (loadingId === id) return;
    loadingId = id;
    peaks     = null;
    progress  = 0;
    cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove('wf-ready');
    pbar.classList.remove('wf-on');
    canvas.classList.add('wf-loading');          // shimmer CSS pendant le décodage
    const p = await decode(url);
    if (loadingId !== id) return;
    canvas.classList.remove('wf-loading');
    peaks = p;
    if (peaks) {
      canvas.classList.add('wf-ready');          // fade-in CSS opacity 0 → 1
      pbar.classList.add('wf-on');               // masque le pfill plat
      cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw);
    }
  }

  function clear() {
    peaks     = null;
    loadingId = null;
    progress  = 0;
    cancelAnimationFrame(rafId);
    canvas.classList.remove('wf-loading', 'wf-ready');
    pbar.classList.remove('wf-on');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // P7 : ResizeObserver — met à jour le cache dimensions (jamais de reflow dans draw())
  function _resizeCanvas() {
    const dpr = devicePixelRatio || 1;
    const w   = Math.round(canvas.offsetWidth  * dpr);
    const h   = Math.round(canvas.offsetHeight * dpr);
    if (w === _wfW && h === _wfH) return;
    _wfW = w; _wfH = h; _wfDpr = dpr;
    canvas.width  = w;
    canvas.height = h;
  }
  new ResizeObserver(() => {
    _resizeCanvas();
    if (peaks) { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }
  }).observe(canvas);
  _resizeCanvas();

  return { update, load, clear };
}
