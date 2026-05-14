// LibreFlow — miniplayer.js
// Fenêtre mini-player séparée (alwaysOnTop) : mise à jour état & progression.
// Extrait de app.js.
//
// Remaining window.* : window._miniPos (var boot temporaire), window.Notification (DOM API).
//
// Exports publics :
//   toggleMiniPlayer, updateMiniPlayer, updateMiniProgress, resetMiniProgressThrottle

import { invoke }                from './ipc.js';
import { fmt }                   from './utils.js';
import { get, subscribe }        from './store.js';
import { audio }                 from './player.js';
import { radioActive }           from './radio.js';

// Position du mini-player (remplace window._miniPos du BOOT-2)
let _miniPos = null;
/** Appelé depuis app.js boot() et le handler de changement de position. */
export function setMiniPos(pos) { _miniPos = pos; }
/** Appelé depuis app.js saveCfg() pour persister la position. */
export function getMiniPos()    { return _miniPos; }


// ── État interne ──────────────────────────────────────────────
// BUG FIX F3 : throttle à 1 appel/sec max + guard si le mini n'est pas ouvert.
let _lastMiniProgressTime = 0;
let _miniOpen  = false; // true = fenêtre mini visible
let _lastTitle = '';    // dernière piste notifiée (évite doublon sur updateMiniPlayer répétés)

// Quand la fenêtre principale reprend le focus, le mini est déjà fermé côté Rust
window.addEventListener('focus', () => {
  _miniOpen = false;
  // Retirer l'état actif du bouton toolbar
  const btn = document.getElementById('tbt-mini');
  if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
});

// Bug #6 fix : synchroniser le mini-player sur les mutations du store et de l'audio.
// Sans ça, les changements de volume, like et vitesse dans la fenêtre principale
// ne se reflétaient pas dans le mini jusqu'au prochain changement de piste.
// Guard _miniOpen dans updateMiniPlayer() → no-op si le mini est fermé.
subscribe('currentArtColor',  () => { updateMiniPlayer(); });
subscribe('liked',            () => { updateMiniPlayer(); }); // liked ♥ changé
subscribe('playbackSpeed',    () => { updateMiniPlayer(); }); // vitesse modifiée
// Volume : audio.volume n'est pas dans le store → écouter l'événement DOM 'volumechange'.
// Différer au prochain tick : player.js ↔ miniplayer.js forment une dépendance circulaire,
// `audio` n'est pas encore initialisé au moment où ce code de module s'exécute.
setTimeout(() => { if (audio) audio.addEventListener('volumechange', () => { updateMiniPlayer(); }); }, 0);

// ── Contrôle fenêtre ──────────────────────────────────────────

export async function toggleMiniPlayer() {
  // Ordre : peupler le mutex Rust (await) → ouvrir la fenêtre mini → minimiser main.
  // IMPORTANT : await updateMiniPlayer() avant mini_toggle pour garantir que le
  // mutex Rust est peuplé avant que mini.html charge et appelle mini_get_state.
  // Sans await : race condition (mini_update IPC pas encore fini quand le mini charge).
  _miniOpen = !_miniOpen;
  // Marquer le bouton toolbar comme actif
  const tbtMini = document.getElementById('tbt-mini');
  if (tbtMini) { tbtMini.classList.add('on'); tbtMini.setAttribute('aria-pressed', 'true'); }
  await updateMiniPlayer();
  invoke('mini_toggle')
    .then(() => invoke('win_minimize').catch(() => {}))
    .catch(() => {
      _miniOpen = false;
      document.getElementById('tbt-mini')?.classList.remove('on');
      document.getElementById('tbt-mini')?.setAttribute('aria-pressed', 'false');
    });
}

export async function openMiniAndMinimize() {
  _miniOpen = true;
  const tbtMini = document.getElementById('tbt-mini');
  if (tbtMini) { tbtMini.classList.add('on'); tbtMini.setAttribute('aria-pressed', 'true'); }
  await updateMiniPlayer();
  invoke('win_minimize').catch(() => {
    _miniOpen = false;
    if (tbtMini) { tbtMini.classList.remove('on'); tbtMini.setAttribute('aria-pressed', 'false'); }
  });
}

// ── Mise à jour état complet ──────────────────────────────────

export async function updateMiniPlayer() {
  if (!_miniOpen) return; // guard cohérent avec updateMiniProgress
  const curIdx = get('curIdx');
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  const liked  = get('liked');
  const base = {
    theme: get('theme'),
    dynColor: get('dynColor') !== false,
    artColor: get('currentArtColor') ?? null,
    shuffle: get('shuffle'), repeat: get('repeat'),
    radioActive: !!radioActive,
    playing: !audio.paused,
    progress: audio.duration ? (audio.currentTime / audio.duration * 100) : 0,
    time: fmt(audio.currentTime),
    duration: audio.duration ? fmt(audio.duration) : '',
    volume:  audio.volume,                  // indicateur volume mini.html
    miniPos: _miniPos,                       // restauration position (premier applyState)
  };
  if (curIdx < 0) {
    await invoke('mini_update', { data: { ...base, title:'–', artist:'–', art:null, liked:false } }).catch(() => {});
    return;
  }
  const t = tracks[curIdx];
  // Guard : curIdx peut être un index persisté devenu invalide (ex. bibliothèque plus petite au redémarrage)
  if (!t) { await invoke('mini_update', { data: { ...base, title:'–', artist:'–', art:null, liked:false } }).catch(() => {}); return; }
  // BUG 3 FIX : convertir blob: en base64 pour cross-window (les blob: URLs
  // ne sont pas accessibles depuis une autre WebView Tauri)
  let artForMini = null;
  if (t._b64) {
    artForMini = t._b64;
  } else if (t.art && t.art.startsWith('data:')) {
    artForMini = t.art;
  } else if (t.art && !t.art.startsWith('blob:')) {
    artForMini = t.art; // asset:// URLs → OK cross-window
  } else if (t.art && t.art.startsWith('blob:')) {
    // Convertir blob: en base64 à la volée
    try {
      const resp = await fetch(t.art);
      const buf  = await resp.arrayBuffer();
      // BUG FIX F4 : btoa(String.fromCharCode(...new Uint8Array(buf))) provoque un
      // "Maximum call stack size exceeded" pour les pochettes > ~250 Ko car le spread
      // operator passe chaque octet comme argument de fonction (limite ~65 000 args).
      // Solution : encoder par chunks de 8 192 octets.
      const u8 = new Uint8Array(buf);
      // Détecter le MIME réel depuis les magic bytes (PNG: 89 50 4E 47, sinon JPEG)
      const isPNG = u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47;
      const mime  = isPNG ? 'image/png' : 'image/jpeg';
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < u8.length; i += CHUNK) {
        binary += String.fromCharCode(...u8.subarray(i, i + CHUNK));
      }
      artForMini = `data:${mime};base64,${btoa(binary)}`;
      t._b64 = artForMini;
    } catch(e) { console.warn('[miniplayer] art base64 conversion failed:', e); artForMini = null; }
  }
  // await garantit que le mutex Rust est écrit avant que toggleMiniPlayer continue
  await invoke('mini_update', { data: { ...base,
    title:  t.name,
    artist: t.artistFull || t.artist || '–',
    album:  t.album || '',
    art:    artForMini,
    liked:  liked.has(t.id),
  } }).catch(() => {});

  // ── Notification système (Windows toast) ──────────────────
  // Déclenche uniquement quand la piste change, pas à chaque updateMiniPlayer
  if (t.name && t.name !== _lastTitle) {
    _lastTitle = t.name;
    _notifyTrack(t.name, t.artistFull || t.artist || '', artForMini);
  }
}

async function _notifyTrack(title, artist, icon) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    new Notification(title, {
      body:   artist,
      icon:   icon || undefined,
      silent: true,   // pas de son système (l'audio est déjà dans l'app)
      tag:    'libreflow-track', // remplace la notif précédente au lieu d'empiler
    });
  } catch { /* Notification API non dispo ou refusée → silencieux */ }
}

// ── Reset throttle ────────────────────────────────────────────
// Appeler après un seek manuel pour que le prochain timeupdate
// passe immédiatement sans attendre les 900ms.
export function resetMiniProgressThrottle() {
  _lastMiniProgressTime = 0;
}

// ── Mise à jour progression (throttled) ──────────────────────

export function updateMiniProgress() {
  if (!_miniOpen) return; // BUG FIX : ne pas invoquer IPC si le mini est fermé
  const curIdx = get('curIdx');
  if (curIdx < 0 || !audio.duration) return;
  const now = Date.now();
  if (now - _lastMiniProgressTime < 250) return; // ~4/sec — assez fluide, léger sur IPC
  _lastMiniProgressTime = now;
  invoke('mini_progress', { data: {
    progress: audio.currentTime / audio.duration * 100,
    time: fmt(audio.currentTime),
  } }).catch(() => {});
}
