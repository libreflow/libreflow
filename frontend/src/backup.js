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

import { dall, dget, DB }                            from './db.js';
import { invoke }                                     from './ipc.js';
import { toast }                                      from './ui.js';
import { get, set, notify }                          from './store.js';
import { rebuildTrackIdxMap, invalidateFilterCache } from './search.js';
import { VIRT }                                      from './virt.js';
import { i18n }                                       from './i18n.js';
import { fmtArtists, mainArtist, validYear }          from './utils.js';

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
 */
export async function exportBackup() {
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

    // UX FIX (2026-09-01) : le compte de pistes n'est connu qu'après cette lecture IDB —
    // on affiche un texte contextualisé pendant la phase la plus longue (stringify +
    // écriture ZIP côté Rust) plutôt qu'un texte générique statique. Pas de vraie barre
    // de progression segmentée : l'écriture ZIP elle-même n'a que 6 entrées JSON qui
    // s'enchaînent en quelques ms chacune (pas de boucle fichier par fichier comme le
    // scan watchfolder) — une barre y sauterait de 0 à 100% instantanément, ce serait
    // du théâtre plutôt qu'une info utile.
    if (btn) btn.textContent = `Export de ${(tracks ?? []).length} piste(s)…`;

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

    // UX FIX (2026-09-01) : même principe que exportBackup() — le manifest donne le
    // compte de pistes AVANT la phase potentiellement longue (merge + IDB batch write
    // + rebuildTrackIdxMap sur tracks[]), donc on contextualise le texte du bouton ici
    // plutôt que de garder "Restauration…" statique jusqu'à la fin.
    if (btn && typeof manifest.track_count === 'number') {
      btn.textContent = `Restauration de ${manifest.track_count} piste(s)…`;
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
    const addedTracks   = []; // records IDB bruts (persistés tels quels)
    const addedRuntime  = []; // objets Track hydratés (poussés dans tracks[])

    for (const r of backupTracks) {
      if (!existingIds.has(r.id)) {
        addedTracks.push(r);
        existingIds.add(r.id); // évite les doublons si le backup contient des ids dupliqués
        // BUG FIX : hydrater le record brut en objet Track runtime — même mapping
        // que le boot (app.js) : sans _hasArt/_artMime (préfixés _) posés ici,
        // getArtUrl() (artLoader.js) ne charge jamais l'artwork restaurée
        // (elle lit t._hasArt, pas t.artBuf/r.artMime du record IDB brut).
        const artistFull = fmtArtists(r.artistFull || r.artist) || i18n('unknown_artist');
        const artist     = mainArtist(artistFull) || artistFull;
        addedRuntime.push({
          id: r.id, name: r.name,
          artist, artistFull,
          album: r.album,
          ext: r.ext, path: r.path, duration: r.duration,
          dateAdded: r.dateAdded,
          art:      null,
          _hasArt:  !!(r.artBuf || r.artB64),
          _artBuf:  null,
          _artMime: r.artMime || null,
          artColor: r.artColor || null,
          url: null, file: null,
          genre: r.genre || null,
          year:  validYear(r.year),
          track: r.track || null,
          metaDone: true,
          noArt:      r.noArt     || false,
          rgGain:     r.rgGain    != null ? r.rgGain    : undefined,
          bitrate:    r.bitrate    != null ? r.bitrate    : null,
          sampleRate: r.sampleRate != null ? r.sampleRate : null,
          channels:   r.channels   != null ? r.channels   : null,
          bitDepth:   r.bitDepth   != null ? r.bitDepth   : null,
        });
      }
    }

    if (addedTracks.length) {
      // Une seule transaction IDB pour tout le lot (vs un dput par piste).
      // Persister les records BRUTS (schéma IDB : artBuf/artMime), pas les objets hydratés.
      await _batchPut('tracks', addedTracks);
      // Mutation in-place du tableau du store : pas de set() (qui notifierait
      // AVANT rebuildTrackIdxMap, exposant un _trackIdxMap stale aux subscribers).
      get('tracks').push(...addedRuntime);
      rebuildTrackIdxMap();
      invalidateFilterCache();
      if (VIRT) VIRT._lastListSig = '';
      notify('tracks');
    }

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
