// LibreFlow — backup.js
// Export et import de la bibliothèque au format .libreflow (ZIP).
//
// Flux export :
//   1. exportBackup()     — sérialise IDB → invoke export_backup (Rust) → dialog save
//
// Flux import :
//   2. importBackup()     — invoke import_backup (Rust) → dialog pick → IDB restore
//
// Stratégie de merge : les enregistrements existants sont conservés,
// les nouveaux sont ajoutés. La config locale n'est jamais remplacée.
//
// Exports :
//   exportBackup(includeFiles?)
//   importBackup()

import { dall, dget, dput }                          from './db.js';
import { invoke }                                     from './ipc.js';
import { toast }                                      from './ui.js';
import { get, set, notify }                          from './store.js';
import { rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { VIRT }                                      from './virt.js';
import { updateStats }                               from './renderer.js';

// Version du format .libreflow (incrémentée si schéma incompatible)
const BACKUP_FORMAT_VERSION = 1;

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Sérialise tous les stores IDB et exporte via la commande Rust export_backup.
 * Ouvre un dialog de sauvegarde côté Rust.
 * @param {boolean} [includeFiles=false] — non utilisé (métadonnées uniquement pour l'instant)
 */
export async function exportBackup(includeFiles = false) {
  const btn = document.getElementById('backup-export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Export en cours…'; }

  try {
    // Lire tous les stores IDB en parallèle
    const [tracks, playlists, playlog, imports, cfg] = await Promise.all([
      dall('tracks'),
      dall('playlists'),
      dall('playlog'),
      dall('imports').catch(() => []),
      dget('cfg', 'state').catch(() => ({})),
    ]);

    const manifest = {
      version:        BACKUP_FORMAT_VERSION,
      app_version:    '1.1.0',
      date:           new Date().toISOString(),
      track_count:    (tracks ?? []).length,
      includes_files: false,
    };

    const result = await invoke('export_backup', {
      payload: {
        manifest:  JSON.stringify(manifest),
        library:   JSON.stringify(tracks  ?? []),
        playlists: JSON.stringify(playlists ?? []),
        playlog:   JSON.stringify(playlog ?? []),
        imports:   JSON.stringify(imports ?? []),
        config:    JSON.stringify(cfg     ?? {}),
      },
    });

    if (result) {
      toast(`Bibliothèque exportée — ${(tracks ?? []).length} piste(s)`, 'success');
    } else {
      toast('Export annulé', 'info');
    }
  } catch (e) {
    console.error('[backup] Export failed:', e);
    toast(`Erreur d'export : ${e}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Exporter'; }
  }
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Ouvre un file picker .libreflow via Rust, puis restaure les données dans IDB.
 * Stratégie de merge : les enregistrements locaux sont conservés.
 */
export async function importBackup() {
  const btn = document.getElementById('backup-import-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Restauration…'; }

  try {
    const payload = await invoke('import_backup', {});
    if (!payload) {
      toast('Import annulé', 'info');
      return;
    }

    // Vérification de compatibilité du format
    let manifest;
    try { manifest = JSON.parse(payload.manifest); }
    catch { toast('Fichier .libreflow invalide (manifest corrompu)', 'error'); return; }

    if (typeof manifest.version !== 'number' || manifest.version > BACKUP_FORMAT_VERSION) {
      toast(`Format non supporté (version ${manifest.version}). Mettez LibreFlow à jour.`, 'error');
      return;
    }

    // Parsing
    const backupTracks    = _safeJsonParse(payload.library,   []);
    const backupPlaylists = _safeJsonParse(payload.playlists, []);
    const backupPlaylog   = _safeJsonParse(payload.playlog,   []);
    const backupImports   = _safeJsonParse(payload.imports,   []);

    // ── Merge tracks ──────────────────────────────────────────────────────────
    // INVARIANT : toute mutation de tracks[] → rebuildTrackIdxMap() obligatoire
    const currentTracks = get('tracks') ?? [];
    const existingIds   = new Set(currentTracks.map(t => t.id));
    const newTracks     = [...currentTracks];

    for (const t of backupTracks) {
      if (!existingIds.has(t.id)) {
        newTracks.push(t);
        existingIds.add(t.id); // évite les doublons si le backup contient des ids dupliqués
        // Fire-and-forget IDB (cohérent avec le pattern importPaths)
        dput('tracks', t).catch(e => console.warn('[backup] track IDB write:', t.id, e));
      }
    }

    set('tracks', newTracks);
    rebuildTrackIdxMap();
    invalidateFilterCache();
    notify('tracks');
    if (VIRT) VIRT._lastListSig = '';
    updateStats();

    // ── Playlists : merge par id ──────────────────────────────────────────────
    const currentPlaylists = get('playlists') ?? [];
    const existingPlIds    = new Set(currentPlaylists.map(p => p.id));
    const newPlaylists     = [...currentPlaylists];
    for (const p of backupPlaylists) {
      if (!existingPlIds.has(p.id)) {
        newPlaylists.push(p);
        existingPlIds.add(p.id); // évite les doublons si le backup contient des ids dupliqués
        dput('playlists', p).catch(e => console.warn('[backup] playlist IDB write:', p.id, e));
      }
    }
    if (newPlaylists.length > currentPlaylists.length) {
      set('playlists', newPlaylists);
      notify('playlists');
    }

    // ── Playlog : merge par ts — local conservé en priorité (put() est upsert sur keyPath 'ts')
    const existingPlaylog = await dall('playlog').catch(() => []);
    const existingTs = new Set();
    for (const l of existingPlaylog) existingTs.add(l.ts);
    for (const l of backupPlaylog) {
      if (!existingTs.has(l.ts)) {
        dput('playlog', l).catch(e => console.warn('[backup] playlog IDB write:', e));
      }
    }

    // ── Imports history : merge par id ────────────────────────────────────────
    for (const i of backupImports) {
      dput('imports', i).catch(e => console.warn('[backup] imports IDB write:', e));
    }

    const added = newTracks.length - currentTracks.length;
    toast(
      `Restauration terminée — ${added} nouvelle(s) piste(s) ajoutée(s) / ${manifest.track_count ?? backupTracks.length} dans la sauvegarde`,
      'success'
    );
  } catch (e) {
    console.error('[backup] Import failed:', e);
    toast(`Erreur d'import : ${e}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Restaurer'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _safeJsonParse(str, fallback) {
  try { return JSON.parse(str) ?? fallback; }
  catch { return fallback; }
}
