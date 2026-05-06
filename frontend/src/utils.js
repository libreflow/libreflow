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
//   mainArtist(raw)  Extract primary artist, stripping feat./collab suffixes

/** Escape a string for safe insertion into HTML. */
export function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
