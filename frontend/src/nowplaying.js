// LibreFlow — nowplaying.js
// Now Playing full-page view (#vnp) — Phase 2 Ambient UI Redesign.
// Vue pleine page intégrée dans #main (remplace l'ancien drawer latéral).

import { updateAmbient }   from './ambient.js';
import { _showViewRaw }    from './views.js';
import { invoke }          from './ipc.js';
import { on, EVENTS }      from './bus.js';
import { get, set, subscribe } from './store.js';
import { esc }             from './utils.js';
import { closeQueue }      from './queue.js';
import { closeEQ }         from './eq.js';
import { clearSelection }  from './selection.js';
import { renderAmbientFrame }                               from './ambientRenderer.js';
import { sampleArtColors, boostSat, rgbToHsl, hslToRgb }  from './artcolor.js';
import { saveCfg }                                          from './cfgsave.js';

export let nowPlayingOpen = false;
let _prevView    = 'all';
let _fullscreen  = false;

// ── NowPlaying background mode state ────────────────────────────────────────
const NP_BG_MODES = ['blur', 'ambient', 'amoled'];
let _npBgMode  = 'blur';
let _npColors  = null;   // { cT, cL, cR } from art sampling
let _npArtRGB  = '120,80,160'; // "r,g,b" fallback for AMOLED halo
let _npAnimRaf = null;
let _npAnimGen = 0;
let _npAnimT   = 0;
let _npFrameCnt = 0;

const _techInfoCache = new Map(); // path → AudioProps

const _EXPAND_ICON   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const _COMPRESS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

// ── Formatters (pure — also tested in core.test.cjs section 10) ──────────────

export function formatCodec(ext) {
  if (!ext) return '–';
  const upper = ext.toUpperCase();
  const MAP = {
    MP3: 'MP3', FLAC: 'FLAC', M4A: 'AAC/ALAC',
    OGG: 'OGG Vorbis', OPUS: 'Opus', WAV: 'WAV',
    AIFF: 'AIFF', AIF: 'AIFF', APE: 'APE', WMA: 'WMA',
  };
  return MAP[upper] || upper;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '–';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

export function formatBitDepth(bitDepth, sampleRate) {
  const parts = [];
  if (bitDepth)   parts.push(bitDepth + ' bit');
  if (sampleRate) parts.push((sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1) + ' kHz');
  return parts.join(' / ') || '–';
}

export function formatBitrate(bitrate) {
  if (!bitrate) return '–';
  return bitrate + ' kbps';
}

function _buildNpColors() {
  const img = document.getElementById('vnp-art-img');
  if (img && img.naturalWidth) {
    const colors = sampleArtColors(img, 64);
    if (colors) {
      _npColors = colors;
      _npArtRGB = colors.cT.join(',');
      return;
    }
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--art-color').trim();
  const m = raw.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    const cT = boostSat(+m[1], +m[2], +m[3]);
    const [h, s, l] = rgbToHsl(...cT);
    _npColors = {
      cT,
      cL: hslToRgb((h + 38) % 360, Math.min(1, s), l),
      cR: hslToRgb((h - 32 + 360) % 360, Math.min(1, s), l),
    };
    _npArtRGB = cT.join(',');
  } else {
    _npColors = null;
  }
}

function _stopNpAnim() {
  _npAnimGen++;
  if (_npAnimRaf) { cancelAnimationFrame(_npAnimRaf); _npAnimRaf = null; }
}

function _startNpAnim(canvas, ctx) {
  const myGen = _npAnimGen;
  let last = performance.now();
  function loop(now) {
    if (myGen !== _npAnimGen) return;
    if (!nowPlayingOpen || document.hidden ||
        (_npBgMode !== 'ambient' && _npBgMode !== 'amoled')) {
      last = now;
      _npAnimRaf = null;
      return;
    }
    if (_npBgMode === 'ambient' && _npFrameCnt++ % 2 !== 0) {
      _npAnimRaf = requestAnimationFrame(loop);
      return;
    }
    _npAnimT += now - last;
    last = now;
    renderAmbientFrame(_npAnimT, canvas, ctx, _npBgMode, _npArtRGB, _npColors);
    _npAnimRaf = requestAnimationFrame(loop);
  }
  _npAnimRaf = requestAnimationFrame(loop);
}

function _applyNpBg() {
  const vnp = document.getElementById('vnp');
  if (!vnp) return;

  _stopNpAnim();

  NP_BG_MODES.forEach(m => vnp.classList.remove('vnp-bg-' + m));
  vnp.classList.add('vnp-bg-' + _npBgMode);

  if (_npBgMode === 'blur') return;

  _buildNpColors();

  const canvas = document.getElementById('vnp-canvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round((window.innerWidth  || 1280) * dpr);
  canvas.height = Math.round((window.innerHeight || 800)  * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  _npFrameCnt = 0;
  _startNpAnim(canvas, ctx);
}

export function cycleNpBg() {
  const cur = NP_BG_MODES.indexOf(_npBgMode);
  _npBgMode = NP_BG_MODES[(cur + 1) % NP_BG_MODES.length];
  set('npBg', _npBgMode);
  saveCfg();
  _applyNpBg();
}

export function initNpBg(mode) {
  if (NP_BG_MODES.includes(mode)) { _npBgMode = mode; set('npBg', mode); }
}

// ── IPC (lazy, cached) ────────────────────────────────────────────────────────

async function _loadTechInfo(path) {
  if (_techInfoCache.has(path)) return _techInfoCache.get(path);
  try {
    const info = await invoke('read_audio_props', { path });
    _techInfoCache.set(path, info);
    return info;
  } catch(e) { console.warn('[nowplaying] read_audio_props IPC failed for', path, ':', e); return null; }
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderNowPlaying(t, info) {
  const vnp = document.getElementById('vnp');
  if (!vnp) return;

  const artH = t.art
    ? `<img id="vnp-art-img" src="${esc(t.art)}" class="vnp-art" alt="">`
    : `<div class="vnp-art vnp-art-ph"></div>`;

  const bgStyle = t.art ? ` style="background-image:url('${esc(t.art)}')"` : '';

  const codec    = formatCodec(t.ext);
  const bitrate  = formatBitrate(info?.bitrate ?? t.bitrate ?? null);
  const quality  = formatBitDepth(info?.bit_depth ?? t.bitDepth ?? null, info?.sample_rate ?? t.sampleRate ?? null);

  const isLiked = get('liked')?.has(t.id) ?? false;

  vnp.innerHTML = `
    <div class="vnp-bg" aria-hidden="true"${bgStyle}></div>
    <canvas id="vnp-canvas" aria-hidden="true"></canvas>
    <button id="vnp-bg-btn" class="vnp-bg-btn" data-action="cycle-np-bg" aria-label="Changer l'arrière-plan" title="Changer l'arrière-plan">⬡</button>
    <button class="vnp-back" data-action="close-now-playing" aria-label="Retour">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
    <button class="vnp-full-btn" data-action="toggle-np-full" aria-label="Plein écran" aria-pressed="${_fullscreen}">
      ${_fullscreen ? _COMPRESS_ICON : _EXPAND_ICON}
    </button>
    <div class="vnp-art-wrap">${artH}</div>
    <div class="vnp-bottom">
      <div class="vnp-info">
        <div class="vnp-title">${esc(t.name || '–')}</div>
        <div class="vnp-artist">${esc(t.artist || '–')}</div>
        ${t.album ? `<div class="vnp-album">${esc(t.album)}</div>` : ''}
        <button class="vnp-lk${isLiked ? ' active' : ''}" data-action="toggle-like"
                aria-label="Favori" aria-pressed="${isLiked}">
          <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
            <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.35l-.77-.77a5.4 5.4 0 0 0-7.65 7.65l.77.77L12 20.77l7.65-7.77.77-.77a5.4 5.4 0 0 0 0-7.65z"/>
          </svg>
        </button>
      </div>
      <div class="vnp-tech">
        <span class="vnp-badge">${esc(codec)}</span>
        ${bitrate !== '–' ? `<span class="vnp-badge">${esc(bitrate)}</span>` : ''}
        ${quality !== '–' ? `<span class="vnp-badge">${esc(quality)}</span>` : ''}
      </div>
      <div class="vnp-links">
        ${t.album  ? `<button class="vnp-link" data-action="np-drill-album" data-album-key="${esc(t.album)}" data-album-name="${esc(t.album)}">→ Album</button>` : ''}
        ${t.artist ? `<button class="vnp-link" data-action="np-drill-artist" data-artist-key="${esc(t.artist)}" data-artist-name="${esc(t.artist)}">→ Artiste</button>` : ''}
      </div>
    </div>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function openNowPlaying() {
  _prevView = get('view') || 'all';
  closeQueue();
  closeEQ();
  clearSelection();
  _showViewRaw('now-playing');
  set('view', 'now-playing');
  nowPlayingOpen = true;
  const tracks = get('tracks') || [];
  const t = tracks[get('curIdx') ?? -1];
  if (!t) return;
  _renderNowPlaying(t, null);
  const vnp = document.getElementById('vnp');
  if (vnp) { updateAmbient(vnp); _applyNpBg(); }
  const info = await _loadTechInfo(t.path);
  // La piste courante a pu changer pendant l'await (skip rapide) — ne pas
  // peindre des infos techniques périmées sur la nouvelle pochette.
  if (nowPlayingOpen && (get('tracks') || [])[get('curIdx')]?.id === t.id) {
    _renderNowPlaying(t, info);
    const vnp2 = document.getElementById('vnp');
    if (vnp2) { updateAmbient(vnp2); _applyNpBg(); }
  }
}

export function closeNowPlaying() {
  if (!nowPlayingOpen) return;
  nowPlayingOpen = false;
  _stopNpAnim();
  if (_fullscreen) {
    _fullscreen = false;
    document.getElementById('app')?.classList.remove('np-full');
  }
  _showViewRaw(_prevView);
  set('view', _prevView);
}

export function toggleNowPlayingFullscreen() {
  _fullscreen = !_fullscreen;
  document.getElementById('app')?.classList.toggle('np-full', _fullscreen);
  const btn = document.querySelector('#vnp .vnp-full-btn');
  if (btn) {
    btn.innerHTML = _fullscreen ? _COMPRESS_ICON : _EXPAND_ICON;
    btn.setAttribute('aria-pressed', _fullscreen);
  }
}

export function toggleNowPlaying() {
  if (nowPlayingOpen) closeNowPlaying(); else openNowPlaying();
}

/**
 * R-H4 : appelé par le listener `resize` centralisé d'app.js.
 * Le canvas plein écran `#vnp-canvas` n'est dimensionné que dans `_applyNpBg()`
 * (jamais sur resize) — sans ce ré-appel, agrandir la fenêtre avec Now Playing
 * ouvert laisse le fond animé étiré/flou. No-op si la vue est fermée.
 */
export function onResizeNowPlaying() {
  if (!nowPlayingOpen) return;
  _applyNpBg();
}

export function updateNowPlaying(track) {
  if (!nowPlayingOpen || !track) return;
  _renderNowPlaying(track, _techInfoCache.get(track.path) ?? null);
  const vnp = document.getElementById('vnp');
  if (vnp) { updateAmbient(vnp); _applyNpBg(); }
  _loadTechInfo(track.path).then(info => {
    // Revérifier que `track` est toujours la piste courante après l'await async.
    if (nowPlayingOpen && (get('tracks') || [])[get('curIdx')]?.id === track.id) {
      _renderNowPlaying(track, info);
      const vnp2 = document.getElementById('vnp');
      if (vnp2) { updateAmbient(vnp2); _applyNpBg(); }
    }
  });
}

// Patch just the like button without re-rendering the whole view.
function _patchLikeBtn() {
  const tracks = get('tracks') || [];
  const t = tracks[get('curIdx') ?? -1];
  if (!t) return;
  const btn = document.querySelector('#vnp .vnp-lk');
  if (!btn) return;
  const isLiked = get('liked')?.has(t.id) ?? false;
  btn.classList.toggle('active', isLiked);
  btn.setAttribute('aria-pressed', String(isLiked));
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
}

subscribe('liked', () => { if (nowPlayingOpen) _patchLikeBtn(); });

// Track change — update if open, do NOT auto-open (full-page view, user-initiated only)
on(EVENTS.TRACK_CHANGE, ({ track }) => {
  if (nowPlayingOpen) updateNowPlaying(track);
  // Do NOT auto-open NP view on track change — it's a full-page view now
});

