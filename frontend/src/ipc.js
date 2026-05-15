// @ts-check
// LibreFlow — IPC helpers (Tauri v2 withGlobalTauri)
// OPT-1.1: Event-based instead of polling

/** @import { Track } from './types.js' */
import { CFG } from './cfg.js';

/**
 * @typedef {{ title?: string, artist?: string, album?: string, genre?: string, year?: number, track?: number, cover_base64?: string, cover_mime?: string, bitrate?: number, sample_rate?: number, channels?: number, bit_depth?: number, duration_secs?: number, file_size?: number }} TrackTags
 * @typedef {{ bitrate?: number, sample_rate?: number, channels?: number, bit_depth?: number }} AudioProps
 * @typedef {{ folder: string, files: string[] }} OpenFolderResult
 */

/** @type {Promise<void> | null} */
let _tauriReady = null;

function _waitTauriReady() {
  if (_tauriReady) return _tauriReady;
  return (_tauriReady = new Promise(res => {
    // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
    if (window.__TAURI__) { res(); return; }
    const handler = () => {
      window.removeEventListener('tauri://init', handler);
      res();
    };
    window.addEventListener('tauri://init', handler);
    setTimeout(res, 5000);
  }));
}

/** @overload @param {'read_tags'} cmd @param {{ path: string }} args @returns {Promise<TrackTags>} */
/** @overload @param {'open_folder'} cmd @returns {Promise<OpenFolderResult | null>} */
/** @overload @param {'check_paths'} cmd @param {{ paths: string[] }} args @returns {Promise<string[]>} */
/** @overload @param {'read_audio_props'} cmd @param {{ path: string }} args @returns {Promise<AudioProps>} */
/** @overload @param {'write_tags'} cmd @param {{ data: { path: string, title: string, artist: string, album: string, genre: string, year: number|null, track_number: number|null } }} args @returns {Promise<void>} */
/** @overload @param {'write_cover'} cmd @param {{ data: { audio_path: string, image_path: string } }} args @returns {Promise<void>} */
/** @overload @param {'write_replaygain_tags'} cmd @param {{ data: { path: string, gain_db: number, peak: number } }} args @returns {Promise<void>} */
/** @overload @param {'notify_track'} cmd @param {{ data: { title: string, artist: string, art?: string|null } }} args @returns {Promise<void>} */
/** @overload @param {'win_set_title'} cmd @param {{ title: string }} args @returns {Promise<void>} */
/** @overload @param {'taskbar_set_playing'} cmd @param {{ playing: boolean }} args @returns {Promise<void>} */
/** @overload @param {'taskbar_set_has_tracks'} cmd @param {{ hasTracks: boolean }} args @returns {Promise<void>} */
/** @overload @param {'mini_update'} cmd @param {{ data: Record<string, unknown> }} args @returns {Promise<void>} */
/** @overload @param {'mini_progress'} cmd @param {{ data: Record<string, unknown> }} args @returns {Promise<void>} */
/** @overload @param {'allow_asset_dir'} cmd @param {{ path: string }} args @returns {Promise<void>} */
/** @overload @param {'watch_folder_start'} cmd @param {{ path: string }} args @returns {Promise<void>} */
/** @overload @param {'pick_audio_file'} cmd @returns {Promise<string | null>} */
/** @overload @param {'pick_image'} cmd @returns {Promise<string | null>} */
/** @overload @param {'win_close'|'win_minimize'|'win_maximize'|'mini_toggle'|'mini_close'|'watch_folder_stop'|'open_devtools'} cmd @returns {Promise<void>} */
/**
 * @param {string} cmd
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<unknown>}
 */
async function invoke(cmd, args) {
  await _waitTauriReady();
  let _timerId;
  // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
  return Promise.race([
    window.__TAURI__.core.invoke(cmd, args).finally(() => clearTimeout(_timerId)),
    new Promise((_, fail) => {
      _timerId = setTimeout(
        () => {
          console.warn('[ipc] timeout:', cmd);
          fail(new Error(`[ipc] ${cmd} timed out after ${CFG.IPC_TIMEOUT_MS}ms`));
        },
        CFG.IPC_TIMEOUT_MS
      );
    }),
  ]);
}

/**
 * @param {string} event
 * @param {(payload: unknown) => void} handler
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<() => void>}
 */
async function listen(event, handler, options) {
  await _waitTauriReady();
  // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
  return options
    // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
    ? window.__TAURI__.event.listen(event, handler, options)
    // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
    : window.__TAURI__.event.listen(event, handler);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function convertFileSrc(filePath) {
  // Normalise les backslashes Windows en slashes avant toute conversion.
  // Tauri convertFileSrc encode \ en %5C au lieu de / → 404 sur asset.localhost.
  const normalized = filePath.replace(/\\/g, '/');
  // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
  if (window.__TAURI__?.core?.convertFileSrc) {
    // @ts-ignore — __TAURI__ injected at runtime by Tauri, not in Window type
    return window.__TAURI__.core.convertFileSrc(normalized);
  }
  const encoded = encodeURIComponent(normalized)
    .replace(/%3A/gi, ':')
    .replace(/%2F/g, '/');
  return `asset://localhost/${encoded}`;
}

/**
 * @param {string} cmd
 * @param {Record<string, unknown>} [args]
 * @param {number} [maxRetries]
 * @returns {Promise<unknown>}
 */
async function invokeRetry(cmd, args, maxRetries = 3) {
  let delay = 200;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // @ts-ignore — invokeRetry passes generic string cmd, overloads handle specific commands
      return await invoke(cmd, args);
    } catch (err) {
      if (attempt === maxRetries - 1) {
        const argsSnippet = args ? JSON.stringify(args).slice(0, 120) : '(none)';
        const detail = `[ipc] ${cmd} failed after ${maxRetries} retries: ${err?.message ?? err}`;
        console.warn(detail, '| args:', argsSnippet);
        throw Object.assign(new Error(detail), { cause: err });
      }
      const jitter = delay * (0.8 + Math.random() * 0.4);
      await new Promise(r => setTimeout(r, jitter));
      delay *= 2;
    }
  }
}

export { invoke, invokeRetry, listen, convertFileSrc };
