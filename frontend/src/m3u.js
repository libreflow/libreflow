// LibreFlow — m3u.js
// Import et export de playlists au format M3U/M3U8.
// Extrait de app.js.
//
// Dépendances :
//   window : view, curPlId, playlists, tracks, _trackIdxMap (getters)
//            getFiltered, importPaths, savePlaylists, renderPlNav,
//            setupPlNavDrop, setView, toast
//
// Exports publics :
//   exportM3U, exportXSPF, importM3U

import { i18n } from './i18n.js';
import { get, set, notify }  from './store.js'; // Phase 4
import { _trackIdxMap, getFiltered } from './search.js';
import { toast } from './ui.js';
import { setView } from './views.js';
import { importPaths } from './watchfolder.js';
import { savePlaylists, renderPlNav, setupPlNavDrop } from './playlists.js';

// ── Export M3U ───────────────────────────────────────────────
// Exports publics :
//   exportM3U, exportXSPF, importM3U

export function exportM3U() {
  const view      = get('view');
  const curPlId   = get('curPlId');
  const playlists = get('playlists');
  const tracks    = get('tracks'); // Phase 4

  const fl = view === 'playlist' && curPlId
    ? (playlists.find(p => p.id === curPlId)?.trackIds
        .map(id => (_trackIdxMap.has(id) ? tracks[_trackIdxMap.get(id)] : undefined))
        .filter(Boolean) || [])
    : getFiltered();

  if (!fl.length) { toast(i18n('t_m3u_no_export'), 'warning'); return; }

  const lines = ['#EXTM3U'];
  for (const t of fl) {
    if (!t.path) continue;
    const dur    = Math.round(t.duration) || 0;
    const artist = t.artistFull || t.artist || i18n('unknown_artist');
    lines.push('#EXTINF:' + dur + ',' + artist + ' - ' + t.name);
    lines.push(t.path.replace(/\\/g, '/'));
  }
  const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  const pl     = playlists.find(p => p.id === curPlId);
  const plName = (view === 'playlist' && pl) ? pl.name : 'libreflow';
  a.download = plName + '.m3u';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(i18n('t_m3u_exported'), 'success');
}

// ── Export XSPF ──────────────────────────────────────────────

/** Exporte la vue courante (ou playlist active) en XSPF (XML Shareable Playlist Format v1).
 *  Spéc : https://xspf.org/xspf-v1.html
 *  Compatible VLC, foobar2000, Strawberry, Clementine. */
export function exportXSPF() {
  const view      = get('view');
  const curPlId   = get('curPlId');
  const playlists = get('playlists');
  const tracks    = get('tracks');

  const fl = view === 'playlist' && curPlId
    ? (playlists.find(p => p.id === curPlId)?.trackIds
        .map(id => (_trackIdxMap.has(id) ? tracks[_trackIdxMap.get(id)] : undefined))
        .filter(Boolean) || [])
    : getFiltered();

  if (!fl.length) { toast(i18n('t_m3u_no_export'), 'warning'); return; }

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pl     = playlists.find(p => p.id === curPlId);
  const plName = (view === 'playlist' && pl) ? pl.name : 'LibreFlow';

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<playlist version="1" xmlns="http://xspf.org/ns/0/" xmlns:vlc="http://www.videolan.org/vlc/playlist/ns/0/">`,
    `  <title>${esc(plName)}</title>`,
    `  <trackList>`,
  ];

  for (const t of fl) {
    if (!t.path) continue;
    const artist = t.artistFull || t.artist || '';
    const dur    = isFinite(t.duration) && t.duration > 0 ? Math.round(t.duration * 1000) : 0;
    // Convertir chemin Windows / Unix en URI file://
    const uri = 'file:///' + t.path.replace(/\\/g, '/').replace(/^\//, '');
    lines.push('    <track>');
    lines.push(`      <location>${esc(uri)}</location>`);
    lines.push(`      <title>${esc(t.name)}</title>`);
    if (artist) lines.push(`      <creator>${esc(artist)}</creator>`);
    if (t.album) lines.push(`      <album>${esc(t.album)}</album>`);
    if (dur > 0) lines.push(`      <duration>${dur}</duration>`);
    lines.push('    </track>');
  }

  lines.push('  </trackList>');
  lines.push('</playlist>');

  const blob  = new Blob([lines.join('\n')], { type: 'application/xspf+xml' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url;
  a.download = plName + '.xspf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(i18n('t_xspf_exported'), 'success');
}

// ── Import M3U ───────────────────────────────────────────────

export async function importM3U() {
  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = '.m3u,.m3u8';
  // BUG FIX : attacher au DOM avant .click() (requis par certains navigateurs)
  input.style.display = 'none';
  document.body.appendChild(input);

  input.onchange = async function(e) {
    try {
      const file = e.target.files[0];
      if (!file) return;
      // B18 FIX : retirer un BOM UTF-8 en tête — sinon la 1re ligne (et le chemin
      // de la 1re piste si le fichier n'a pas de header) commence par le caractère BOM.
      const text = (await file.text()).replace(/^﻿/, '');

      // Parser M3U : extraire chemins + métadonnées EXTINF
      const lines   = text.split(/\r?\n/);
      const entries = [];
      let pendingInfo = null;
      for (const raw of lines) {
        const l = raw.trim();
        if (!l) continue;
        if (l.startsWith('#EXTINF:')) {
          const m = l.match(/^#EXTINF:(-?\d+),(.*)$/);
          if (m) {
            const dur  = parseInt(m[1]);
            const info = m[2];
            const dash = info.indexOf(' - ');
            pendingInfo = dash > 0
              ? { duration: dur, artist: info.slice(0, dash).trim(), title: info.slice(dash + 3).trim() }
              : { duration: dur, title: info.trim() };
          }
          continue;
        }
        if (l.startsWith('#')) continue;
        entries.push({ path: l, ...pendingInfo });
        pendingInfo = null;
      }

      if (!entries.length) { toast(i18n('t_m3u_invalid'), 'warning'); return; }

      // Rejeter les chemins contenant des traversals de répertoire (..)
      const safeEntries = entries.filter(e => {
        const segs = e.path.replace(/\\/g, '/').split('/');
        return !segs.some(s => s === '..' || s === '.');
      });
      if (!safeEntries.length) { toast(i18n('t_m3u_invalid'), 'warning'); return; }

      const tracks       = get('tracks'); // Phase 4
      // BUG FIX : filtrer les pistes sans chemin avant le Map — t.path null → TypeError .replace()
      const tracksWithPath = tracks.filter(t => t.path);
      const byPath = new Map(tracksWithPath.map(t => [t.path.replace(/\\/g, '/'), t]));
      const byName = new Map(tracksWithPath.map(t => [t.path.replace(/\\/g, '/').split('/').pop().toLowerCase(), t]));

      const matchedIds = [];
      const newPaths   = [];

      for (const entry of safeEntries) {
        const normalized = entry.path.replace(/\\/g, '/');
        const basename   = normalized.split('/').pop().toLowerCase();
        const found = byPath.get(normalized) || byName.get(basename);
        if (found) {
          matchedIds.push(found.id);
        } else {
          newPaths.push(entry.path);
        }
      }

      // Importer les fichiers manquants si possible
      let importedCount = 0;
      if (newPaths.length) {
        const AUDIO_EXTS = new Set(['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wav', 'wma', 'aiff', 'ape', 'alac']);
        const validNew = newPaths.filter(p => AUDIO_EXTS.has(p.split('.').pop().toLowerCase()));
        if (validNew.length) {
          importedCount = await importPaths(validNew);
          const tracksNow = get('tracks'); // Phase 4 — relire après importPaths
          // AUDIT-2026-05-22 (M-10) : indexer tracksNow par chemin normalise une
          // seule fois (O(n)) plutot qu'un .find() par fichier importe (O(n×m)).
          const byNormPath = new Map();
          for (const tk of tracksNow) {
            if (tk.path) byNormPath.set(tk.path.replace(/\\/g, '/'), tk);
          }
          for (const p of validNew) {
            const t = byNormPath.get(p.replace(/\\/g, '/'));
            if (t && !matchedIds.includes(t.id)) matchedIds.push(t.id);
          }
        }
      }

      if (!matchedIds.length) { toast(i18n('t_m3u_no_tracks'), 'warning'); return; }

      const plName = file.name.replace(/\.m3u8?$/i, '').replace(/[-_]+/g, ' ').trim() || 'Playlist importée';
      // B17 FIX : suffixe aléatoire — 2 imports M3U dans la même milliseconde
      // produiraient le même id 'pl_<ts>' → le 2e put écraserait le 1er en IDB.
      const newPl  = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: plName, trackIds: matchedIds };
      const playlists = get('playlists');
      playlists.push(newPl);
      // AUDIT-2026-05-22 : set('playlists', playlists) est un no-op (meme reference
      // → guard `=== val` dans store.set). Notifier explicitement les subscribers
      // apres le push in-place, sans dependre de savePlaylists() pour le faire.
      notify('playlists');
      await savePlaylists();
      renderPlNav();
      setupPlNavDrop();

      const skipped = safeEntries.length - matchedIds.length;
      toast(i18n('t_m3u_imported', plName, matchedIds.length, importedCount, skipped), 'success');

      setView('playlist', document.getElementById('ni-pl-' + newPl.id), newPl.id);
    } catch (err) {
      toast(i18n('t_m3u_import_error') || 'Erreur lors de l\'import M3U', 'error');
      console.warn('[m3u] importM3U error:', err);
    } finally {
      input.remove();
    }
  };
  input.click();
}
