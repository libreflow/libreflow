// cdaudio.js — CD Audio orchestration (Lire / Extraire).
//
// Flux PLAY :
//   1. cd_read_toc(drive) → TOC
//   2. cd_rip_track(track N) → temp FLAC dans cd-cache/
//   3. push ephemeral track (_isEphemeralCd) + playAt(idx)
//   4. prefetch track suivant à T-5s avant la fin
//
// Flux EXTRACT :
//   1. cd_read_toc(drive)
//   2. rip all → watchPath/CD_<label>_<date>/Track 0X.flac
//   3. importPaths([...]) — réutilise scan/tag flow
//
// Conventions LibreFlow respectées :
//   - Tous les appels Tauri passent par ./ipc.js (invoke / listen / convertFileSrc)
//   - tracks[] mutations → rebuildTrackIdxMap() OBLIGATOIRE
//   - audio.volume jamais touché ici (cf. CLAUDE.md §2)

import { invoke, listen, convertFileSrc }     from './ipc.js';
import { toast }                              from './ui.js';
import { get, notify }                        from './store.js';
import { rebuildTrackIdxMap,
         invalidateFilterCache }              from './search.js';
import { VIRT }                               from './virt.js';
import { getWatchPath, importPaths }          from './watchfolder.js';
import {
  detectNewAudioCds,
  buildEphemeralCdTrack,
  cleanupEphemeralForDrive,
  extractDestPath,
  calculateRipPercent,
} from './cdaudio_pure.js';

export { detectNewAudioCds };

// ── État module ───────────────────────────────────────────────────────────────

let _currentRipId     = null;
let _currentDrive     = null;
let _progressUnlisten = null;
let _prefetchTimer    = null;
let _prefetchAudioListener = null;

// ── API publique ──────────────────────────────────────────────────────────────

export async function openCdModal(drivePath) {
  let toc;
  try { toc = await invoke('cd_read_toc', { drive: drivePath }); }
  catch (e) {
    console.warn('[cdaudio] cd_read_toc failed:', e);
    toast(`CD illisible : ${e}`, 'error');
    return;
  }

  _currentDrive = drivePath;

  const labelEl = document.getElementById('cd-label');
  const countEl = document.getElementById('cd-track-count');
  const durEl   = document.getElementById('cd-duration');
  if (labelEl) labelEl.textContent = drivePath;
  if (countEl) countEl.textContent = String(toc.tracks.length);
  if (durEl)   durEl.textContent   = _formatDuration(toc.total_duration_sec);

  _resetProgressUi();
  const bg = document.getElementById('cd-modal-bg');
  if (bg) {
    bg.classList.add('on');
    bg._toc = toc;
  }
}

export function closeCdModal() {
  const bg = document.getElementById('cd-modal-bg');
  if (!bg) return;
  bg.classList.remove('on');
  bg._toc = null;
  _resetProgressUi();
}

export async function playCdTrack(drivePath, idx) {
  const bg  = document.getElementById('cd-modal-bg');
  const toc = bg?._toc;
  if (!toc) { toast('TOC perdu — réessayer', 'error'); return; }
  const tocTrack = toc.tracks.find(t => t.idx === idx) || toc.tracks[0];
  if (!tocTrack) return;

  const rip_id  = crypto.randomUUID();
  const tempPath = await _tempPathForRip(rip_id);
  _showProgressUi();
  await _subscribeProgress(rip_id);

  try {
    _currentRipId = rip_id;
    await invoke('cd_rip_track', {
      drive: drivePath, track_idx: tocTrack.idx, dest_path: tempPath, rip_id,
    });
  } catch (e) {
    _unsubscribeProgress();
    if (String(e) === 'cancelled') { _resetProgressUi(); return; }
    toast(`Erreur de rip : ${e}`, 'error');
    _resetProgressUi();
    return;
  } finally {
    _currentRipId = null;
  }

  _unsubscribeProgress();

  // Inject ephemeral track + play
  const eph = buildEphemeralCdTrack(
    { path: drivePath, label: drivePath },
    tocTrack,
    tempPath,
  );
  // Tauri custom scheme URL pour <audio src>
  eph.url = convertFileSrc(tempPath);

  const tracks = get('tracks');
  tracks.push(eph);
  rebuildTrackIdxMap();
  invalidateFilterCache();
  if (VIRT) VIRT._lastListSig = '';
  notify('tracks');

  const newIdx = tracks.length - 1;
  if (typeof window.playAt === 'function') window.playAt(newIdx);

  closeCdModal();

  // Prefetch du track suivant à T-5s
  _schedulePrefetch(drivePath, tocTrack.idx + 1, toc.tracks.length);
}

export async function extractCd(drivePath) {
  const bg  = document.getElementById('cd-modal-bg');
  const toc = bg?._toc;
  if (!toc) { toast('TOC perdu — réessayer', 'error'); return; }

  const watchPath = getWatchPath();
  if (!watchPath) {
    toast('Aucun dossier de surveillance configuré', 'error');
    return;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const label   = drivePath.replace(/[:\\]/g, '');

  _showProgressUi();
  const written = [];

  for (const tocTrack of toc.tracks) {
    const rip_id = crypto.randomUUID();
    const dest   = extractDestPath(watchPath, label, tocTrack.idx, dateStr);
    _setProgressText(`Extraction : ${tocTrack.idx} / ${toc.tracks.length}`);
    await _subscribeProgress(rip_id);

    try {
      _currentRipId = rip_id;
      await invoke('cd_rip_track', {
        drive: drivePath, track_idx: tocTrack.idx, dest_path: dest, rip_id,
      });
      written.push(dest);
    } catch (e) {
      _unsubscribeProgress();
      if (String(e) === 'cancelled') {
        toast('Extraction annulée', 'info');
        _resetProgressUi();
        return;
      }
      toast(`Erreur sur track ${tocTrack.idx} : ${e}`, 'error');
    } finally {
      _currentRipId = null;
      _unsubscribeProgress();
    }
  }

  if (written.length) {
    await importPaths(written);
    toast(`${written.length} piste(s) extraite(s) et ajoutée(s)`, 'success');
  }

  _resetProgressUi();
  closeCdModal();
}

export async function cancelCurrentRip() {
  if (!_currentRipId) return;
  try { await invoke('cd_cancel_rip', { rip_id: _currentRipId }); }
  catch (e) { console.warn('[cdaudio] cancel failed:', e); }
}

export async function cleanupCdCache(drivePath) {
  // Purge ephemeral tracks bound to this drive
  if (drivePath) {
    const tracks   = get('tracks');
    const filtered = cleanupEphemeralForDrive(tracks, drivePath);
    if (filtered.length !== tracks.length) {
      tracks.length = 0;
      tracks.push(...filtered);
      rebuildTrackIdxMap();
      invalidateFilterCache();
      if (VIRT) VIRT._lastListSig = '';
      notify('tracks');
    }
  }
  // Best-effort purge du cache disque
  try { await invoke('cd_purge_cache'); }
  catch (e) { console.warn('[cdaudio] cd_purge_cache failed:', e); }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

async function _tempPathForRip(rip_id) {
  const dir = await invoke('cd_cache_dir');
  return `${dir}\\${rip_id}.flac`;
}

async function _subscribeProgress(rip_id) {
  _unsubscribeProgress();
  _progressUnlisten = await listen('cd-rip-progress', (event) => {
    const p = event.payload;
    if (!p || p.rip_id !== rip_id) return;
    const percent = calculateRipPercent(p.sector_current, p.sector_total);
    _setProgressFill(percent);
  });
}

function _unsubscribeProgress() {
  if (_progressUnlisten) { _progressUnlisten(); _progressUnlisten = null; }
}

function _showProgressUi() {
  const el = document.getElementById('cd-progress');
  const ac = document.getElementById('cd-actions');
  if (el) el.hidden = false;
  if (ac) ac.hidden = true;
  _setProgressFill(0);
}

function _resetProgressUi() {
  const el = document.getElementById('cd-progress');
  const ac = document.getElementById('cd-actions');
  if (el) el.hidden = true;
  if (ac) ac.hidden = false;
  _setProgressFill(0);
  _setProgressText('');
}

function _setProgressFill(percent) {
  const fill = document.getElementById('cd-progress-fill');
  if (fill) fill.style.width = `${percent}%`;
}

function _setProgressText(t) {
  const el = document.getElementById('cd-progress-text');
  if (el) el.textContent = t;
}

function _formatDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _schedulePrefetch(drivePath, nextIdx, totalTracks) {
  // Cleanup d'un éventuel listener précédent
  if (_prefetchAudioListener) {
    const { audio, fn } = _prefetchAudioListener;
    audio.removeEventListener('timeupdate', fn);
    _prefetchAudioListener = null;
  }
  if (_prefetchTimer) { clearTimeout(_prefetchTimer); _prefetchTimer = null; }
  if (nextIdx > totalTracks) return;

  const audio = document.getElementById('audio');
  if (!audio) return;

  const onTime = async () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    if (audio.duration - audio.currentTime >= 5) return;
    audio.removeEventListener('timeupdate', onTime);
    _prefetchAudioListener = null;
    try {
      const rip_id   = crypto.randomUUID();
      const tempPath = await _tempPathForRip(rip_id);
      await invoke('cd_rip_track', {
        drive: drivePath, track_idx: nextIdx, dest_path: tempPath, rip_id,
      });
    } catch (e) {
      console.warn('[cdaudio] prefetch failed:', e);
    }
  };
  audio.addEventListener('timeupdate', onTime);
  _prefetchAudioListener = { audio, fn: onTime };
}
