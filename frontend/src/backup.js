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

import { dall, dget, DB }                            from './db.js';
import { invoke }                                     from './ipc.js';
import { toast }                                      from './ui.js';
import { get, set, notify }                          from './store.js';
import { rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { VIRT }                                      from './virt.js';
import { updateStats }                               from './renderer.js';

// Version du format .libreflow (incrémentée si schéma incompatible)
const BACKUP_FORMAT_VERSION = 1;

/**
 * Écrit tout un lot dans un store via UNE seule transaction IDB (vs N dput).
 * Non bloquant en cas d'échec : log + continue, conservant la tolérance
 * fire-and-forget de l'ancien restore.
 */
async function _batchPut(storeName, records) {
  if (!DB || !records || !records.length) return;
  try {
    const tx = DB.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const rec of records) store.put(rec);
    await new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = () => fail(tx.error); });
  } catch (e) {
    console.warn(`[backup] batch IDB write (${storeName}) failed:`, e);
  }
}

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
    // INVARIANT : toute mutation de tracks[] → rebuildTrackIdxMap() AVANT notify()
    const currentTracks = get('tracks') ?? [];
    const existingIds   = new Set(currentTracks.map(t => t.id));
    const addedTracks   = [];

    for (const t of backupTracks) {
      if (!existingIds.has(t.id)) {
        addedTracks.push(t);
        existingIds.add(t.id); // évite les doublons si le backup contient des ids dupliqués
      }
    }

    if (addedTracks.length) {
      // Une seule transaction IDB pour tout le lot (vs un dput par piste).
      await _batchPut('tracks', addedTracks);
      // Mutation in-place du tableau du store : pas de set() (qui notifierait
      // AVANT rebuildTrackIdxMap, exposant un _trackIdxMap stale aux subscribers).
      get('tracks').push(...addedTracks);
      rebuildTrackIdxMap();
      invalidateFilterCache();
      if (VIRT) VIRT._lastListSig = '';
      notify('tracks');
    }
    updateStats();

    // ── Playlists : merge par id ──────────────────────────────────────────────
    const currentPlaylists = get('playlists') ?? [];
    const existingPlIds    = new Set(currentPlaylists.map(p => p.id));
    const newPlaylists     = [...currentPlaylists];
    const addedPlaylists   = [];
    for (const p of backupPlaylists) {
      if (!existingPlIds.has(p.id)) {
        newPlaylists.push(p);
        addedPlaylists.push(p);
        existingPlIds.add(p.id); // évite les doublons si le backup contient des ids dupliqués
      }
    }
    if (addedPlaylists.length) {
      await _batchPut('playlists', addedPlaylists);
      set('playlists', newPlaylists);
      notify('playlists');
    }

    // ── Playlog : merge par ts — local conservé en priorité (put() est upsert sur keyPath 'ts')
    const existingPlaylog = await dall('playlog').catch(() => []);
    const existingTs = new Set();
    for (const l of existingPlaylog) existingTs.add(l.ts);
    await _batchPut('playlog', backupPlaylog.filter(l => !existingTs.has(l.ts)));

    // ── Imports history : merge par id (put = upsert sur keyPath 'id') ─────────
    await _batchPut('imports', backupImports);

    const added = addedTracks.length;
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
