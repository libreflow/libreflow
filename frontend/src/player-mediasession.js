// player-mediasession.js — navigator.mediaSession wiring.
// Call initMediaSession(audio, { prev, next, toggleLike, ensureEQResumed }) from app.js boot.
/** @import { Track } from './types.js' */

let _audio = /** @type {HTMLAudioElement|null} */ (null);

/**
 * @param {HTMLAudioElement} audio
 * @param {{ prev: () => void, next: (force?: boolean) => void, toggleLike: () => void, ensureEQResumed?: () => void }} callbacks
 */
export function initMediaSession(audio, { prev, next, toggleLike, ensureEQResumed }) {
  _audio = audio;
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',          () => { if (ensureEQResumed) ensureEQResumed(); audio.play().catch(() => {}); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('pause',         () => { audio.pause(); updateMediaSessionState(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack',     () => next(true));
  navigator.mediaSession.setActionHandler('seekto',        e => { if (e.seekTime !== undefined && !isNaN(audio.duration)) audio.currentTime = e.seekTime; });
  // Bug-1 FIX: guard isNaN(audio.duration) for seekbackward/seekforward
  navigator.mediaSession.setActionHandler('seekbackward',  e => { if (!audio.duration || isNaN(audio.duration)) return; audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); });
  navigator.mediaSession.setActionHandler('seekforward',   e => { if (!audio.duration || isNaN(audio.duration)) return; audio.currentTime = Math.min(audio.duration, audio.currentTime + (e.seekOffset || 10)); });
  // @ts-ignore — 'togglefavorite' is a non-standard Media Session action (try/catch handles runtime errors)
  try { navigator.mediaSession.setActionHandler('togglefavorite', () => toggleLike()); } catch(_) {}
}

/** @param {Track} t */
export function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  const artSrc  = t._b64 || (t.art && !t.art.startsWith('blob:') ? t.art : null);
  // AUDIO-5: detect real MIME from data: URI or URL extension (FLAC/WAV often embed PNG artwork)
  const artMime = artSrc && artSrc.startsWith('data:') ? artSrc.slice(5, artSrc.indexOf(';'))
    : artSrc && /\.png($|\?)/i.test(artSrc) ? 'image/png'
    : artSrc && /\.webp($|\?)/i.test(artSrc) ? 'image/webp'
    : 'image/jpeg';
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  t.name,
    artist: t.artistFull || t.artist || '',
    album:  t.album || '',
    artwork: artSrc ? [
      { src: artSrc, sizes: '96x96',   type: artMime },
      { src: artSrc, sizes: '128x128', type: artMime },
      { src: artSrc, sizes: '256x256', type: artMime },
      { src: artSrc, sizes: '512x512', type: artMime },
    ] : [],
  });
}

export function updateMediaSessionState() {
  const audio = _audio;
  if (!audio || !('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  if (!isNaN(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration:     audio.duration,
        playbackRate: audio.playbackRate || 1,
        position:     Math.min(audio.currentTime, audio.duration),
      });
    } catch(e) { console.warn('[mediaSession]', e); }
  }
}
