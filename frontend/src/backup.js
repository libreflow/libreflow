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
//   exportBackup()
//   importBackup()

import { dall, dget, DB } from './db.js';
import { invoke } from './ipc.js';
import { toast } from './ui.js';
import { i18n } from './i18n.js';
import { get, set, notify } from './store.js';
import { rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { VIRT } from './virt.js';

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
    await new Promise((ok, fail) => {
      tx.oncomplete = ok;
      tx.onerror = () => fail(tx.error);
    });
  } catch (e) {
    console.warn(`[backup] batch IDB write (${storeName}) failed:`, e);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Sérialise tous les stores IDB et exporte via la commande Rust export_backup.
 * Ouvre un dialog de sauvegarde côté Rust.
 */
export async function exportBackup() {
  const btn = document.getElementById('backup-export-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = i18n('bk_exporting');
  }

  try {
    // Lire tous les stores IDB en parallèle
    const [tracks, playlists, playlog, imports, cfg, artwork] = await Promise.all([
      dall('tracks'),
      dall('playlists'),
      dall('playlog'),
      dall('imports').catch(() => []),
      dget('cfg', 'state').catch(() => ({})),
      // PERF-LH v6 : pochettes dans le store dédié — réintégrées au format
      // d'export historique (artBuf inline) pour garder le format compatible.
      dall('artwork').catch(() => [])
    ]);
    const artById = new Map((artwork ?? []).map((a) => [a.id, a]));
    for (const t of tracks ?? []) {
      const a = artById.get(t.id);
      if (a) {
        t.artBuf = a.buf || null;
        t.artB64 = a.b64 || null;
        t.artMime = a.mime || null;
      }
    }

    const manifest = {
      version: BACKUP_FORMAT_VERSION,
      app_version: '1.1.0',
      date: new Date().toISOString(),
      track_count: (tracks ?? []).length,
      includes_files: false
    };

    const result = await invoke('export_backup', {
      payload: {
        manifest: JSON.stringify(manifest),
        library: JSON.stringify(tracks ?? []),
        playlists: JSON.stringify(playlists ?? []),
        playlog: JSON.stringify(playlog ?? []),
        imports: JSON.stringify(imports ?? []),
        config: JSON.stringify(cfg ?? {})
      }
    });

    if (result) {
      toast(i18n('bk_exported', (tracks ?? []).length), 'success');
    } else {
      toast(i18n('bk_export_cancelled'), 'info');
    }
  } catch (e) {
    console.error('[backup] Export failed:', e);
    toast(i18n('bk_export_error', e), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = i18n('set_backup_export_btn');
    }
  }
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Ouvre un file picker .libreflow via Rust, puis restaure les données dans IDB.
 * Stratégie de merge : les enregistrements locaux sont conservés.
 */
export async function importBackup() {
  const btn = document.getElementById('backup-import-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = i18n('bk_importing');
  }

  try {
    const payload = await invoke('import_backup', {});
    if (!payload) {
      toast(i18n('bk_import_cancelled'), 'info');
      return;
    }

    // Vérification de compatibilité du format
    let manifest;
    try {
      manifest = JSON.parse(payload.manifest);
    } catch {
      toast(i18n('bk_invalid_file'), 'error');
      return;
    }

    if (typeof manifest.version !== 'number' || manifest.version > BACKUP_FORMAT_VERSION) {
      toast(i18n('bk_unsupported_format', manifest.version), 'error');
      return;
    }

    // Parsing
    const backupTracks = _safeJsonParse(payload.library, []);
    const backupPlaylists = _safeJsonParse(payload.playlists, []);
    const backupPlaylog = _safeJsonParse(payload.playlog, []);
    const backupImports = _safeJsonParse(payload.imports, []);

    // ── Merge tracks ──────────────────────────────────────────────────────────
    // INVARIANT : toute mutation de tracks[] → rebuildTrackIdxMap() AVANT notify()
    const currentTracks = get('tracks') ?? [];
    const existingIds = new Set(currentTracks.map((t) => t.id));
    const addedTracks = [];

    for (const t of backupTracks) {
      if (!existingIds.has(t.id)) {
        addedTracks.push(t);
        existingIds.add(t.id); // évite les doublons si le backup contient des ids dupliqués
      }
    }

    // PERF-LH v6 : les backups anciens (v1) et récents portent l'artwork inline
    // (artBuf/artB64) — l'extraire vers le store artwork dédié, stripper le record.
    const addedArtwork = [];
    for (const t of addedTracks) {
      if (t.artBuf || t.artB64) {
        addedArtwork.push({ id: t.id, buf: t.artBuf || null, b64: t.artB64 || null, mime: t.artMime || null });
        delete t.artBuf;
        delete t.artB64;
        delete t.artMime;
      }
    }
    if (addedTracks.length) {
      // Une seule transaction IDB pour tout le lot (vs un dput par piste).
      await _batchPut('tracks', addedTracks);
      if (addedArtwork.length) await _batchPut('artwork', addedArtwork);
      // Mutation in-place du tableau du store : pas de set() (qui notifierait
      // AVANT rebuildTrackIdxMap, exposant un _trackIdxMap stale aux subscribers).
      get('tracks').push(...addedTracks);
      rebuildTrackIdxMap();
      invalidateFilterCache();
      if (VIRT) VIRT._lastListSig = '';
      notify('tracks');
    }

    // ── Playlists : merge par id ──────────────────────────────────────────────
    const currentPlaylists = get('playlists') ?? [];
    const existingPlIds = new Set(currentPlaylists.map((p) => p.id));
    const newPlaylists = [...currentPlaylists];
    const addedPlaylists = [];
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
    await _batchPut(
      'playlog',
      backupPlaylog.filter((l) => !existingTs.has(l.ts))
    );

    // ── Imports history : merge par id (put = upsert sur keyPath 'id') ─────────
    await _batchPut('imports', backupImports);

    const added = addedTracks.length;
    toast(i18n('bk_restored', added, manifest.track_count ?? backupTracks.length), 'success');
  } catch (e) {
    console.error('[backup] Import failed:', e);
    toast(i18n('bk_import_error', e), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = i18n('set_backup_import_btn');
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str) ?? fallback;
  } catch {
    return fallback;
  }
}
