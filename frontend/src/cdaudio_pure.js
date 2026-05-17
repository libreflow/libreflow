// cdaudio_pure.js — Pure helpers for CD audio import.
// No IPC, no DOM, no IDB — all logic that can be unit-tested.

const FORBIDDEN_PATH_CHARS = /[\\/:*?"<>|]/g;

export function formatTrackLabel(idx) {
  return `Track ${String(idx).padStart(2, '0')}`;
}

export function detectNewAudioCds(previous, current) {
  const prevAudioCds = new Set();
  for (const d of previous) {
    if (d.audio_cd) prevAudioCds.add(d.path);
  }
  const out = [];
  for (const d of current) {
    if (d.audio_cd && !prevAudioCds.has(d.path)) out.push(d);
  }
  return out;
}

export function buildEphemeralCdTrack(drive, tocTrack, tempPath) {
  return {
    id:    `cd:${drive.path}:${tocTrack.idx}`,
    path:  tempPath,
    title: formatTrackLabel(tocTrack.idx),
    artist: 'CD Audio',
    album:  drive.label && drive.label.length > 0 ? drive.label : 'CD inconnu',
    dur:    tocTrack.duration_sec,
    _isEphemeralCd: true,
    _cdDrive:       drive.path,
  };
}

export function cleanupEphemeralForDrive(tracks, drivePath) {
  return tracks.filter(t => !(t._isEphemeralCd && t._cdDrive === drivePath));
}

function _sanitizeForPath(s) {
  return String(s || '')
    .replace(FORBIDDEN_PATH_CHARS, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'unnamed';
}

export function extractDestPath(baseDir, label, trackIdx, dateStr) {
  const safe = _sanitizeForPath(label);
  const dir  = `${baseDir}\\CD_${safe}_${dateStr}`;
  const file = `${formatTrackLabel(trackIdx)}.flac`;
  return `${dir}\\${file}`;
}

export function calculateRipPercent(sectorCurrent, sectorTotal) {
  if (!sectorTotal || sectorTotal <= 0) return 0;
  return Math.floor((sectorCurrent / sectorTotal) * 100);
}
