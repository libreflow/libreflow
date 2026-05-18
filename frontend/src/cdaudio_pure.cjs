// cdaudio_pure.cjs — CJS mirror of cdaudio_pure.js for the zero-dep test suite.
// Source of truth is cdaudio_pure.js (ESM). Keep in sync manually — small file.

'use strict';

const FORBIDDEN_PATH_CHARS = /[\\/:*?"<>|]/g;

function formatTrackLabel(idx) {
  return `Track ${String(idx).padStart(2, '0')}`;
}

function detectNewAudioCds(previous, current) {
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

function buildEphemeralCdTrack(drive, tocTrack, tempPath) {
  return {
    id:        `cd:${drive.path}:${tocTrack.idx}`,
    path:      tempPath,
    name:      formatTrackLabel(tocTrack.idx),
    artist:    'CD Audio',
    album:     drive.label && drive.label.length > 0 ? drive.label : 'CD inconnu',
    duration:  tocTrack.duration_sec,
    ext:       'flac',
    dateAdded: Date.now(),
    metaDone:  true,
    _isEphemeralCd: true,
    _cdDrive:       drive.path,
  };
}

function cleanupEphemeralForDrive(tracks, drivePath) {
  return tracks.filter(t => !(t._isEphemeralCd && t._cdDrive === drivePath));
}

function _sanitizeForPath(s) {
  return String(s || '')
    .replace(FORBIDDEN_PATH_CHARS, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'unnamed';
}

function extractDestPath(baseDir, label, trackIdx, dateStr) {
  const safe = _sanitizeForPath(label);
  const dir  = `${baseDir}\\CD_${safe}_${dateStr}`;
  const file = `${formatTrackLabel(trackIdx)}.flac`;
  return `${dir}\\${file}`;
}

function calculateRipPercent(sectorCurrent, sectorTotal) {
  if (!sectorTotal || sectorTotal <= 0) return 0;
  return Math.floor((sectorCurrent / sectorTotal) * 100);
}

module.exports = {
  formatTrackLabel,
  detectNewAudioCds,
  buildEphemeralCdTrack,
  cleanupEphemeralForDrive,
  extractDestPath,
  calculateRipPercent,
};
