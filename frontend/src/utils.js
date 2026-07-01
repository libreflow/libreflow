// LibreFlow — Pure utility functions
//
// No DOM side-effects, no app state. Safe to import from any module.
//
// Exports:
//   esc(s)           Escape HTML special characters
//   fmt(s)           Format seconds as M:SS (e.g. "3:45")
//   fmtd(s)          Like fmt(), but returns '' for invalid/falsy values
//   extEmoji(ext)    SVG music-note icon for audio file entries
//   fmtDuration(s)   Format seconds as "Xh Ym", "Xm", or "Xs"
//   normTag(s)       Normalize a metadata tag string (trim, NFC, collapse spaces)
//   mainArtist(raw)              Extract primary artist, stripping feat./collab suffixes
//   moveByOne(a,i,d)             Move array item one step (single-pointer reorder, WCAG 2.2 SC 2.5.7)
//   normalizePathKey(p)          Normalize path to a case-insensitive lookup key
//   extractAudioFileArg(argv)    Find first safe audio path in an argv array
//   trackCopyText(t, i18n)       Format track for clipboard ("Artist — Title" or "Title")
//   smtcMetaFromTrack(t, dur)    Build capped, safe SMTC metadata object

/** Escape a string for safe insertion into HTML. */
export function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format seconds as M:SS (returns "–:––" for invalid input). */
export function fmt(s) {
  if (!s || isNaN(s)) return '–:––';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Like fmt(), but returns an empty string for falsy / non-finite values. */
export function fmtd(s) {
  if (!s || !isFinite(s)) return '';
  return fmt(s);
}

/** Returns a uniform SVG music-note icon for any audio file extension. */
export function extEmoji(e) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
}

/** Format a duration in seconds as a human-readable string ("Xh Ym", "Xm", or "Xs"). */
export function fmtDuration(secs) {
  if (!secs || secs < 60) return `${Math.round(secs || 0)}s`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Normalize a metadata tag string: trim, collapse whitespace, strip zero-width
 *  chars and soft hyphens, apply Unicode NFC normalization. */
export function normTag(s) {
  if (!s) return '';
  return s
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '') // zero-width / soft-hyphen / BOM
    .replace(/\s+/g, ' ')   // collapse whitespace
    .normalize('NFC')        // Unicode canonical form
    .trim();
}

/** Valide une année entre 1900 et 2100. Retourne l'entier si valide, null sinon.
 *  Note : les faux-1970 (TDRC="1970-01-01T00:00:00") sont filtrés en amont dans tags.js. */
export function validYear(y) {
  const n = Number(y);
  return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null;
}

/** Retourne true si le chemin est safe (pas de .. ni de segments ., pas d'octets
 *  de contrôle, longueur raisonnable). Filtre défensif côté JS — Rust reste la garde finale. */
export function isSafePath(p) {
  if (typeof p !== 'string' || !p.length || p.length > 4096) return false;
  if (p.includes('\0')) return false;
  if (/[\x00-\x1f]/.test(p)) return false;
  const segs = p.replace(/\\/g, '/').split('/');
  if (segs.some(s => s === '..' || s === '.')) return false;
  return true;
}

/** Extract the primary artist from a raw tag, stripping feat./collab suffixes. */
export function mainArtist(raw) {
  if (!raw) return '';
  let s = normTag(raw);
  s = s
    .replace(/\s*[(/]\s*(?:feat\.?|ft\.?|featuring|avec|with|vs\.?)\s+.*/i, '')
    .replace(/\s*,\s*(?:feat\.?|ft\.?|featuring)\s+.*/i, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring|avec|with)\s+.*/i, '')
    .replace(/\s*\/\s*.+$/, '')
    .replace(/\s*,\s*.+$/, '')
    .trim();
  return s || normTag(raw);
}

/** Normalize a file path to a case-insensitive lookup key (backslashes → slashes, lowercase). */
export function normalizePathKey(p) {
  if (p == null) return '';
  return String(p).replace(/\\/g, '/').toLowerCase();
}

const _AUDIO_EXTS = new Set([
  'mp3', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'wav', 'wma', 'ape', 'mka', 'mp4', 'webm',
]);

/**
 * Find the first audio file path in an argv array.
 * Skips --flags and non-audio extensions.
 * Fail-closed: returns null immediately if any non-flag argument fails isSafePath(),
 * aborting the entire search (not just skipping the bad entry).
 *
 * @param {string[] | null} argv
 * @returns {string | null}
 */
export function extractAudioFileArg(argv) {
  if (!argv || !argv.length) return null;
  for (const arg of argv) {
    if (!arg || typeof arg !== 'string' || arg.startsWith('--')) continue;
    const ext = arg.split('.').pop()?.toLowerCase() || '';
    if (!_AUDIO_EXTS.has(ext)) continue;
    if (!isSafePath(arg)) return null;
    return arg;
  }
  return null;
}

/**
 * Format a track for clipboard copy: "Artist — Title" or just "Title" when artist is unknown.
 *
 * @param {{ name?: string, artist?: string } | null} track
 * @param {string} unknownArtistI18n  - i18n value of "Unknown Artist" in the current locale
 * @returns {string}
 */
export function trackCopyText(track, unknownArtistI18n) {
  if (!track || !track.name) return '';
  const a = track.artist;
  if (!a || a === unknownArtistI18n || a === 'Unknown Artist') return track.name;
  return `${a} — ${track.name}`;
}

/**
 * Build a safe SMTC metadata object from a track, capping field lengths and validating the path.
 *
 * @param {{ name?: string, artist?: string, artistFull?: string, album?: string, path?: string } | null} track
 * @param {number} durationSecs
 * @returns {{ title: string, artist: string, album: string, path: string|null, durationSecs: number|null } | null}
 */
export function smtcMetaFromTrack(track, durationSecs) {
  if (!track) return null;
  const cap = (s, n) => String(s || '').slice(0, n);
  const rawPath = track.path || null;
  return {
    title:       cap(track.name, 256),
    artist:      cap(track.artistFull || track.artist, 256),
    album:       cap(track.album, 256),
    path:        rawPath && isSafePath(rawPath) ? rawPath : null,
    durationSecs: (typeof durationSecs === 'number' && isFinite(durationSecs) && durationSecs >= 0)
                  ? durationSecs : null,
  };
}

/**
 * Déplace l'élément à `index` d'un cran dans la direction `dir`
 * (-1 = vers le haut/avant, +1 = vers le bas/arrière). Mute `arr` en place.
 * Alternative non-drag à la réorganisation par glisser-déposer (WCAG 2.2 SC 2.5.7).
 * @param {Array}  arr   tableau à réordonner (muté in place)
 * @param {number} index position courante de l'élément
 * @param {-1|1}   dir   sens du déplacement
 * @returns {number} le nouvel index, ou -1 si déplacement impossible (hors bornes / butée)
 */
export function moveByOne(arr, index, dir) {
  if (!Array.isArray(arr)) return -1;
  const to = index + dir;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return -1;
  const [item] = arr.splice(index, 1);
  arr.splice(to, 0, item);
  return to;
}
