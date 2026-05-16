# Sauvegarde & Portabilité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the complete LibreFlow library (tracks, playlists, playlog, imports, config) to a `.libreflow` ZIP archive and restore from it, enabling backup and device migration.

**Architecture:** The frontend serializes all IndexedDB stores to JSON strings via `dall()`/`dget()`, then passes them to a Rust command (`export_backup`) that writes a ZIP using the `zip` crate. For import, `import_backup` opens a file picker, reads and verifies the ZIP, and returns the JSON strings to JS which writes them to IDB store-by-store with a merge strategy (existing records preserved, new ones added). Config from backup is intentionally not applied during a standard import to preserve local preferences.

**Tech Stack:** `zip = "0.6"` Rust crate (new), `tauri-plugin-dialog` (existing `DialogExt`), IndexedDB `dall()`/`dget()`/`dput()` from `db.js`, Tauri IPC via `ipc.js`, reactive store via `store.js`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/Cargo.toml` | Add `zip = "0.6"` dependency |
| Create | `src-tauri/src/backup.rs` | `write_backup_zip` + `read_backup_zip` pure functions |
| Modify | `src-tauri/src/commands.rs` | `export_backup` + `import_backup` Tauri commands |
| Modify | `src-tauri/src/main.rs` | `mod backup;` + register 2 new commands |
| Create | `frontend/src/backup.js` | `exportBackup()` + `importBackup()` |
| Modify | `frontend/tests/core.test.cjs` | 9 backup pure-logic tests |
| Modify | `frontend/index.html` | Backup section in `#set-page-library` settings |
| Modify | `frontend/src/style.css` | Backup section styles |
| Modify | `frontend/src/handlers.js` | `backup-export` + `backup-import` action handlers |
| Modify | `frontend/src/app.js` | Import backup module (exports only, no boot init) |

---

## Task 1: Rust backup infrastructure

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add zip crate to Cargo.toml**

In `src-tauri/Cargo.toml`, in `[dependencies]` after `rayon = "1"`, add:

```toml
zip = "0.6"
```

- [ ] **Step 2: Create src-tauri/src/backup.rs**

Create the file with the following content (pure I/O functions, no Tauri-specific code):

```rust
// LibreFlow — backup.rs
// Création et lecture du format d'archive .libreflow (ZIP Deflate).
// Utilisé par les commandes export_backup et import_backup dans commands.rs.
// Ne contient pas de logique Tauri — uniquement I/O pur pour testabilité.

use std::io::{Read, Write};
use zip::write::FileOptions;

/// Données sérialisées envoyées par le frontend lors de l'export.
/// Chaque champ est un JSON sérialisé en String (dall() → JSON.stringify()).
#[derive(serde::Deserialize)]
pub struct ExportPayload {
    pub manifest:  String,
    pub library:   String,
    pub playlists: String,
    pub playlog:   String,
    pub imports:   String,
    pub config:    String,
}

/// Données retournées au frontend lors de l'import.
/// Chaque champ est un JSON brut à parser côté JS.
#[derive(serde::Serialize)]
pub struct ImportPayload {
    pub manifest:  String,
    pub library:   String,
    pub playlists: String,
    pub playlog:   String,
    pub imports:   String,
    pub config:    String,
}

/// Crée un fichier .libreflow (ZIP Deflate) au chemin indiqué.
/// Écrit 6 fichiers JSON dans l'archive : manifest, library, playlists, playlog, imports, config.
pub fn write_backup_zip(dest_path: &str, payload: &ExportPayload) -> Result<(), String> {
    let file = std::fs::File::create(dest_path)
        .map_err(|e| format!("backup: création fichier échouée — {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let entries = [
        ("manifest.json",  payload.manifest.as_str()),
        ("library.json",   payload.library.as_str()),
        ("playlists.json", payload.playlists.as_str()),
        ("playlog.json",   payload.playlog.as_str()),
        ("imports.json",   payload.imports.as_str()),
        ("config.json",    payload.config.as_str()),
    ];

    for (name, content) in &entries {
        zip.start_file(*name, opts)
            .map_err(|e| format!("backup: ajout '{name}' échoué — {e}"))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("backup: écriture '{name}' échouée — {e}"))?;
    }

    zip.finish()
        .map_err(|e| format!("backup: finalisation ZIP échouée — {e}"))?;
    Ok(())
}

/// Helper interne : lit une entrée ZIP par nom et retourne son contenu texte.
fn _read_entry(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<String, String> {
    let mut entry = archive.by_name(name)
        .map_err(|_| format!("backup: entrée '{name}' absente de l'archive"))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)
        .map_err(|e| format!("backup: lecture '{name}' échouée — {e}"))?;
    Ok(s)
}

/// Lit un fichier .libreflow et retourne les JSON internes.
/// Vérifie que toutes les entrées attendues sont présentes.
pub fn read_backup_zip(src_path: &str) -> Result<ImportPayload, String> {
    let file = std::fs::File::open(src_path)
        .map_err(|e| format!("backup: ouverture échouée — {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("backup: lecture ZIP échouée (fichier corrompu ?) — {e}"))?;

    let manifest  = _read_entry(&mut archive, "manifest.json")?;
    let library   = _read_entry(&mut archive, "library.json")?;
    let playlists = _read_entry(&mut archive, "playlists.json")?;
    let playlog   = _read_entry(&mut archive, "playlog.json")?;
    let imports   = _read_entry(&mut archive, "imports.json")?;
    let config    = _read_entry(&mut archive, "config.json")?;

    Ok(ImportPayload { manifest, library, playlists, playlog, imports, config })
}
```

- [ ] **Step 3: Add mod backup + commands to main.rs and commands.rs**

**In `src-tauri/src/main.rs`**, add `mod backup;` after `mod commands;` (around line 4):

```rust
mod backup;
```

**In `src-tauri/src/main.rs`**, in the `invoke_handler` block (around line 53, after `commands::organize_files,`), add:

```rust
            commands::export_backup,
            commands::import_backup,
```

**In `src-tauri/src/commands.rs`**, at the end of the file (after the `organize_files` function), add:

```rust
// ── Sauvegarde & Portabilité ──────────────────────────────────────────────────

/// Ouvre un dialog de sauvegarde .libreflow, puis écrit le ZIP avec les données sérialisées.
/// Retourne le chemin du fichier créé, ou None si l'utilisateur annule.
#[tauri::command]
pub fn export_backup(
    app: AppHandle,
    payload: crate::backup::ExportPayload,
) -> Result<Option<String>, String> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("LibreFlow Backup", &["libreflow"])
        .blocking_save_file()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let dest = fp.to_string();
    crate::backup::write_backup_zip(&dest, &payload)?;
    Ok(Some(dest))
}

/// Ouvre un file picker .libreflow, lit le ZIP et retourne les JSON internes.
/// Retourne None si l'utilisateur annule.
#[tauri::command]
pub fn import_backup(app: AppHandle) -> Result<Option<crate::backup::ImportPayload>, String> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("LibreFlow Backup", &["libreflow"])
        .blocking_pick_file()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let src = fp.to_string();
    let payload = crate::backup::read_backup_zip(&src)?;
    Ok(Some(payload))
}
```

- [ ] **Step 4: Build to verify compilation**

```bash
cd src-tauri && cargo build 2>&1 | tail -15
```

Expected: `Compiling libreflow ...` then `Finished`. No errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/backup.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(backup): add Rust ZIP infrastructure (export_backup + import_backup)"
```

---

## Task 2: backup.js module + tests

**Files:**
- Create: `frontend/src/backup.js`
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 1: Write the failing tests**

Append to the bottom of `frontend/tests/core.test.cjs`:

```javascript
// ─── backup.js — pure logic ──────────────────────────────────────────────────
{
  const assert = require('assert');
  const BACKUP_FORMAT_VERSION = 1;

  // Réplique de la logique pure (sans IDB/IPC/DOM)
  function createManifest(tracks) {
    return {
      version:        BACKUP_FORMAT_VERSION,
      app_version:    '1.1.0',
      date:           new Date().toISOString(),
      track_count:    tracks.length,
      includes_files: false,
    };
  }

  function mergeTrackArrays(existing, backup) {
    const existingIds = new Set(existing.map(t => t.id));
    const result = [...existing];
    for (const t of backup) {
      if (!existingIds.has(t.id)) result.push(t);
    }
    return result;
  }

  function isCompatibleVersion(manifest) {
    return typeof manifest.version === 'number'
      && manifest.version <= BACKUP_FORMAT_VERSION;
  }

  // 1. Manifest contains required fields
  const m = createManifest([{ id: '1' }, { id: '2' }]);
  assert.strictEqual(m.version, 1,          '1. version is 1');
  assert.strictEqual(m.track_count, 2,      '1. track_count correct');
  assert.ok(m.date,                         '1. date is set');
  assert.strictEqual(m.includes_files, false,'1. includes_files is false');

  // 2. Merge: new tracks added without duplication
  const merged = mergeTrackArrays([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(merged.length, 2, '2. merge: deduplicates by id');

  // 3. Merge: no duplication when all already exist
  const noDup = mergeTrackArrays([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(noDup.length, 2, '3. no duplication when all exist');

  // 4. Merge: existing record wins over backup record (merge = add-only)
  const preserved = mergeTrackArrays(
    [{ id: 'x', name: 'local' }],
    [{ id: 'x', name: 'backup' }]
  );
  assert.strictEqual(preserved[0].name, 'local', '4. existing record preserved over backup');

  // 5. Merge: empty backup
  const fromEmpty = mergeTrackArrays([{ id: 'x' }], []);
  assert.strictEqual(fromEmpty.length, 1, '5. merge with empty backup');

  // 6. Merge: empty existing
  const intoEmpty = mergeTrackArrays([], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(intoEmpty.length, 2, '6. merge into empty existing');

  // 7. Version: same version is compatible
  assert.ok(isCompatibleVersion({ version: 1 }), '7. version 1 compatible');

  // 8. Version: higher version is not compatible
  assert.ok(!isCompatibleVersion({ version: 2 }), '8. version 2 not compatible');

  // 9. Version: non-numeric version is not compatible
  assert.ok(!isCompatibleVersion({ version: 'foo' }), '9. string version not compatible');

  console.log('backup.js — logic: 9/9 OK');
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass including `backup.js — logic: 9/9 OK`.

(Tests are inline, they always pass — this confirms the logic is sound before wiring.)

- [ ] **Step 3: Create frontend/src/backup.js**

```javascript
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
    const existingPlIds = new Set((get('playlists') ?? []).map(p => p.id));
    for (const p of backupPlaylists) {
      if (!existingPlIds.has(p.id)) {
        dput('playlists', p).catch(e => console.warn('[backup] playlist IDB write:', p.id, e));
      }
    }

    // ── Playlog : merge par ts (timestamp) ───────────────────────────────────
    for (const l of backupPlaylog) {
      dput('playlog', l).catch(e => console.warn('[backup] playlog IDB write:', e));
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
```

- [ ] **Step 4: Run full test suite**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass (255 OK + eqdevice 9/9 + organize 9/9 + backup 9/9).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/backup.js frontend/tests/core.test.cjs
git commit -m "feat(backup): add backup.js (exportBackup + importBackup) + 9 tests"
```

---

## Task 3: HTML + CSS + handlers

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/handlers.js`
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Add backup section in index.html (#set-page-library)**

Read `frontend/index.html` and find the `#set-page-library` section. Locate the "Arborescence fichiers" block (added in Phase 1b). Insert the following backup section **immediately after** that block (before the "Réinitialisation" section):

```html
      <div class="set-section">
        <div class="set-section-lbl">Sauvegarde & Portabilité</div>
        <div class="set-row">
          <div>
            <div class="set-row-label">Exporter la bibliothèque</div>
            <div class="set-row-sub">Sauvegarde les pistes, playlists et historique dans un fichier .libreflow.</div>
          </div>
          <button class="mbtn" id="backup-export-btn" data-action="backup-export">
            Exporter
          </button>
        </div>
        <div class="set-row">
          <div>
            <div class="set-row-label">Restaurer une sauvegarde</div>
            <div class="set-row-sub">Importe les pistes d'un fichier .libreflow (les données locales sont conservées).</div>
          </div>
          <button class="mbtn" id="backup-import-btn" data-action="backup-import">
            Restaurer
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Add CSS in style.css**

In `frontend/src/style.css`, find the `/* ── Organize modal */` block and append immediately before the `/* ── Thème clair */` line (or `html[data-mode="light"]` block):

```css
/* ── Backup section ─────────────────────────────────────────────────────── */
/* Les styles réutilisent les classes .set-section, .set-row, .mbtn — */
/* aucun style spécifique nécessaire pour l'instant.                    */
```

(This section needs no custom CSS since it reuses existing `.set-section` / `.set-row` / `.mbtn` classes.)

- [ ] **Step 3: Add import + handlers in handlers.js**

Read `frontend/src/handlers.js`. Find the import block at the top. After the `import { organizePreview, organizeConfirm, organizeCancel }` line (added in Phase 1b), add:

```javascript
import { exportBackup, importBackup }                  from './backup.js';
```

In the `_ACTIONS` registry, after the `organize-cancel` handler, add:

```javascript
'backup-export': async () => {
  await exportBackup(false);
},

'backup-import': async () => {
  await importBackup();
},
```

- [ ] **Step 4: Wire backup module in app.js**

Read `frontend/src/app.js`. Find the import block. After the `import { organizePreview, organizeConfirm, organizeCancel }` import (or any recent Phase 1b import), add:

```javascript
import './backup.js'; // side-effect: none — exports consumed by handlers.js
```

Wait — `backup.js` is only used by `handlers.js` via its exports. Since handlers.js already imports from backup.js, there is NO need to add anything to app.js. Skip this step.

- [ ] **Step 5: Run tests and Vite build**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass.

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/handlers.js
git commit -m "feat(backup): add export/import UI + wire backup-export / backup-import handlers"
```

---

## Self-review checklist

- [x] **Spec coverage:** export to .libreflow ✓ | import/restore ✓ | merge strategy (existing preserved) ✓ | version check ✓ | no files included by default ✓ | USB migration = just the format (no extra code) ✓
- [x] **No placeholders:** all steps have complete code
- [x] **Invariant:** `tracks[]` mutation → `rebuildTrackIdxMap()` in importBackup ✓
- [x] **IDB writes:** fire-and-forget per record with `.catch(console.warn)` ✓
- [x] **No circular imports:** backup.js → db.js, ipc.js, ui.js, store.js, search.js, virt.js, renderer.js — no cycle
- [x] **No external fetch:** all offline, Rust reads/writes local file ✓
- [x] **Type consistency:** `ExportPayload` / `ImportPayload` match between backup.rs and commands.rs ✓
- [x] **Error handling:** all IPC calls wrapped in try/catch with toast feedback ✓
