# Import USB / Disque externe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect USB drives automatically (polling), show a toast, and let users import music from a selected drive via a modal — reusing the existing scan pipeline entirely.

**Architecture:** A new Rust command `list_drives` returns mounted volumes with their type (fixed/removable/network). A companion `open_folder_at(start_path)` opens the OS folder picker pre-navigated to a specified path, then runs the existing audio scan — returning the same `OpenFolderResult` struct as `open_folder`. A new `devices.js` module polls every 6 seconds, detects new removable drives, shows a toast, and manages an import modal. When the user picks a folder from the USB, `importPaths()` (from `watchfolder.js`) handles the full scan+import pipeline exactly as it does for a regular folder scan.

**Tech Stack:** `windows` crate (existing, add `Win32_Storage_FileSystem` feature for Windows drive detection), `std::fs::read_dir` for macOS/Linux, Tauri IPC, existing `importPaths()` from `watchfolder.js`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/Cargo.toml` | Add `Win32_Storage_FileSystem` to windows crate features |
| Modify | `src-tauri/src/commands.rs` | `list_drives` + `open_folder_at` commands |
| Modify | `src-tauri/src/main.rs` | Register 2 new commands |
| Create | `frontend/src/devices.js` | Polling, USB detection toast, modal render + import trigger |
| Modify | `frontend/tests/core.test.cjs` | 5 devices pure-logic tests |
| Modify | `frontend/index.html` | `#usb-modal-bg` modal + trigger button in `#set-page-library` |
| Modify | `frontend/src/style.css` | USB modal + drive list styles |
| Modify | `frontend/src/handlers.js` | `usb-scan` + `usb-cancel` + `usb-refresh` actions |
| Modify | `frontend/src/app.js` | `initDevices()` call in boot sequence |

---

## Task 1: Rust list_drives + open_folder_at commands

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add Win32_Storage_FileSystem to windows crate in Cargo.toml**

In `src-tauri/Cargo.toml`, find the `[target.'cfg(windows)'.dependencies]` block. Add `"Win32_Storage_FileSystem"` to the windows features list:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Graphics_Gdi",
    "Win32_System_Com",
    "Win32_System_Threading",
    "Win32_UI_Controls",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Storage_FileSystem",
] }
```

- [ ] **Step 2: Add DriveInfo struct and list_drives command to commands.rs**

In `src-tauri/src/commands.rs`, after the existing structs section (near the top, after `OrganizeResult`), add:

```rust
// ── Types : détection de lecteurs ─────────────────────────────────────────────

/// Informations sur un volume monté.
#[derive(Serialize, Clone)]
pub struct DriveInfo {
    /// Chemin racine du volume (ex: "C:\\", "/Volumes/USB")
    pub path:  String,
    /// Label du volume (ex: "USB DRIVE", "Macintosh HD")
    pub label: String,
    /// Type de lecteur : "fixed" | "removable" | "network" | "cdrom" | "unknown"
    pub kind:  String,
}
```

Then at the end of the file (after `import_backup`), add the cross-platform `list_drives` command:

```rust
// ── Commande : liste des volumes montés ───────────────────────────────────────

/// Retourne la liste des volumes montés sur le système.
/// Utilisé par devices.js pour la détection USB (polling).
#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    _list_drives_impl()
}

#[cfg(target_os = "windows")]
fn _list_drives_impl() -> Vec<DriveInfo> {
    use windows::Win32::Storage::FileSystem::{
        GetLogicalDriveStringsW, GetDriveTypeW,
    };
    use windows::core::HSTRING;

    let mut buf = vec![0u16; 256];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
    if len == 0 { return vec![]; }

    let mut drives = vec![];
    let raw = &buf[..len];

    for segment in raw.split(|&c| c == 0) {
        if segment.is_empty() { continue; }
        let drive_str = String::from_utf16_lossy(segment).to_string();
        let hstr = HSTRING::from(drive_str.as_str());
        let dtype = unsafe { GetDriveTypeW(&hstr) };

        let kind = match dtype.0 {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            _ => "unknown",
        };

        // Label = lettre de lecteur sans le backslash final (ex: "C:")
        let label = drive_str.trim_end_matches('\\').to_string();

        drives.push(DriveInfo {
            path:  drive_str,
            label,
            kind:  kind.to_string(),
        });
    }
    drives
}

#[cfg(target_os = "macos")]
fn _list_drives_impl() -> Vec<DriveInfo> {
    let Ok(dir) = std::fs::read_dir("/Volumes") else { return vec![]; };
    dir.flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() { return None; }
            let label = p.file_name()?.to_string_lossy().to_string();
            if label.starts_with('.') { return None; } // skip hidden (Preboot, etc.)
            Some(DriveInfo {
                path:  p.to_string_lossy().to_string(),
                label,
                kind:  "unknown".to_string(),
            })
        })
        .collect()
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn _list_drives_impl() -> Vec<DriveInfo> {
    const PSEUDO_FS: &[&str] = &[
        "proc", "sysfs", "devtmpfs", "tmpfs", "cgroup", "cgroup2",
        "debugfs", "securityfs", "pstore", "bpf", "tracefs",
        "hugetlbfs", "mqueue", "fusectl", "devpts", "efivarfs", "overlay",
    ];
    let Ok(content) = std::fs::read_to_string("/proc/mounts") else { return vec![]; };
    content.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 { return None; }
            let mountpoint = parts[1];
            let fstype     = parts[2];
            if PSEUDO_FS.contains(&fstype) { return None; }
            let label = mountpoint.split('/').last().unwrap_or(mountpoint).to_string();
            Some(DriveInfo {
                path:  mountpoint.to_string(),
                label: if label.is_empty() { "/".to_string() } else { label },
                kind:  "unknown".to_string(),
            })
        })
        .collect()
}
```

- [ ] **Step 3: Add open_folder_at command to commands.rs**

In `src-tauri/src/commands.rs`, after `list_drives`, add:

```rust
// ── Commande : ouvrir un dossier à un chemin de départ spécifique ─────────────

/// Ouvre un dialog de sélection de dossier pré-navigué à start_path,
/// scanne les fichiers audio et retourne { folder, files }.
/// Identique à open_folder mais avec un répertoire de départ (pour USB).
/// N'applique pas is_safe_dir — le chemin vient d'un dialog utilisateur.
#[tauri::command]
pub fn open_folder_at(
    app: AppHandle,
    start_path: String,
) -> Result<Option<OpenFolderResult>, String> {
    let Some(folder_path) = app
        .dialog()
        .file()
        .set_directory(&start_path)
        .blocking_pick_folder()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let folder_str = folder_path.to_string();
    let canon = fs::canonicalize(&folder_str)
        .map_err(|e| format!("open_folder_at: canonicalize échoué — {e}"))?;

    let raw_paths = scan_dir(&canon);
    let files: Vec<String> = raw_paths
        .into_par_iter()
        .filter_map(|p| p.to_str().map(String::from))
        .collect();

    Ok(Some(OpenFolderResult { folder: folder_str, files }))
}
```

- [ ] **Step 4: Register both commands in main.rs**

In `src-tauri/src/main.rs`, in the `invoke_handler` block (after `commands::import_backup,`), add:

```rust
            commands::list_drives,
            commands::open_folder_at,
```

- [ ] **Step 5: Build to verify compilation**

```bash
cd src-tauri && cargo build 2>&1 | tail -15
```

Expected: `Finished`. No errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(devices): add list_drives + open_folder_at Rust commands (cross-platform)"
```

---

## Task 2: devices.js module + tests

**Files:**
- Create: `frontend/src/devices.js`
- Modify: `frontend/tests/core.test.cjs`
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Write the failing tests**

Append to the bottom of `frontend/tests/core.test.cjs`:

```javascript
// ─── devices.js — pure logic ──────────────────────────────────────────────────
{
  const assert = require('assert');

  // Réplique de la logique pure (sans IPC/DOM/timer)
  function detectNewRemovable(previous, current) {
    const prevPaths = new Set(previous.map(d => d.path));
    return current.filter(d => d.kind === 'removable' && !prevPaths.has(d.path));
  }

  // 1. New removable drive detected
  const newDrives = detectNewRemovable(
    [{ path: 'C:\\', kind: 'fixed' }],
    [{ path: 'C:\\', kind: 'fixed' }, { path: 'E:\\', kind: 'removable' }]
  );
  assert.strictEqual(newDrives.length, 1, '1. new removable detected');
  assert.strictEqual(newDrives[0].path, 'E:\\', '1. correct drive path');

  // 2. Fixed drive not reported as new removable
  const noRemovable = detectNewRemovable(
    [{ path: 'C:\\', kind: 'fixed' }],
    [{ path: 'C:\\', kind: 'fixed' }, { path: 'D:\\', kind: 'fixed' }]
  );
  assert.strictEqual(noRemovable.length, 0, '2. fixed drives ignored');

  // 3. Already known removable not re-detected
  const knownRemovable = [{ path: 'E:\\', kind: 'removable' }];
  const noDup = detectNewRemovable(knownRemovable, knownRemovable);
  assert.strictEqual(noDup.length, 0, '3. known removable not re-detected');

  // 4. From empty previous
  const fromNone = detectNewRemovable([], [{ path: 'E:\\', kind: 'removable' }]);
  assert.strictEqual(fromNone.length, 1, '4. from empty previous');

  // 5. Disconnected drive not reported as new
  const fromFull = detectNewRemovable([{ path: 'E:\\', kind: 'removable' }], []);
  assert.strictEqual(fromFull.length, 0, '5. disconnected drive not false-positive');

  console.log('devices.js — logic: 5/5 OK');
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass including `devices.js — logic: 5/5 OK`.

- [ ] **Step 3: Create frontend/src/devices.js**

```javascript
// LibreFlow — devices.js
// Détection de lecteurs USB (polling) et import de musique depuis un périphérique externe.
//
// Flux :
//   1. initDevices()         — lance le polling toutes les 6 secondes
//   2. _poll()               — compare la liste des lecteurs avec la précédente
//   3. _onUsbConnected()     — toast + garde trace du lecteur pour le modal
//   4. openUsbImportModal()  — affiche le modal avec la liste des lecteurs amovibles
//   5. importFromDrive()     — open_folder_at(path) → importPaths() pipeline existant
//
// Exports :
//   initDevices()
//   openUsbImportModal()
//   closeUsbImportModal()

import { invoke }        from './ipc.js';
import { toast, esc }   from './ui.js';
import { importPaths }  from './watchfolder.js';

// ── État module ───────────────────────────────────────────────────────────────

/** @type {Array<{path:string,label:string,kind:string}>} */
let _lastDrives = [];
let _pollTimer  = null;
const POLL_INTERVAL_MS = 6000; // 6 secondes

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Démarre le polling de détection USB.
 * À appeler une fois au boot (après la première renderLib).
 */
export function initDevices() {
  _poll(); // premier poll immédiat
  _pollTimer = setInterval(_poll, POLL_INTERVAL_MS);
}

/** Affiche le modal d'import USB avec la liste des lecteurs amovibles courants. */
export async function openUsbImportModal() {
  let drives = [];
  try { drives = await invoke('list_drives'); }
  catch (e) { console.warn('[devices] list_drives failed:', e); }

  _renderDrivesList(drives.filter(d => d.kind === 'removable' || d.kind === 'unknown'));

  const bg = document.getElementById('usb-modal-bg');
  if (bg) bg.classList.add('on');
}

/** Ferme le modal d'import USB. */
export function closeUsbImportModal() {
  const bg = document.getElementById('usb-modal-bg');
  if (!bg) return;
  bg.classList.remove('on');
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function _poll() {
  let drives;
  try { drives = await invoke('list_drives'); }
  catch { return; } // IPC indisponible (app en cours de boot, etc.)

  const newRemovable = _detectNewRemovable(_lastDrives, drives);
  for (const d of newRemovable) _onUsbConnected(d);
  _lastDrives = drives;
}

/** Détecte les lecteurs amovibles apparus depuis le dernier poll. */
function _detectNewRemovable(previous, current) {
  const prevPaths = new Set(previous.map(d => d.path));
  return current.filter(d => d.kind === 'removable' && !prevPaths.has(d.path));
}

function _onUsbConnected(drive) {
  toast(
    `Disque USB détecté (${drive.label || drive.path}) — Importer de la musique ?`,
    'info'
  );
}

// ── Import depuis un lecteur ──────────────────────────────────────────────────

/**
 * Ouvre un dialog de sélection de dossier pré-navigué au chemin du lecteur,
 * puis lance le pipeline d'import existant (importPaths de watchfolder.js).
 * @param {string} drivePath — chemin racine du lecteur (ex: "E:\\", "/Volumes/USB")
 */
export async function importFromDrive(drivePath) {
  let result;
  try {
    result = await invoke('open_folder_at', { start_path: drivePath }, { timeout: 0 });
  } catch (e) {
    toast(`Erreur d'accès au lecteur : ${e}`, 'error');
    return;
  }

  if (!result) {
    // Utilisateur a annulé le dialog
    return;
  }

  closeUsbImportModal();

  const { files } = result;
  if (!files || !files.length) {
    toast('Aucun fichier audio trouvé dans ce dossier', 'info');
    return;
  }

  const added = await importPaths(files);
  if (added > 0) {
    toast(`${added} piste(s) importée(s) depuis le lecteur USB`, 'success');
  } else {
    toast('Aucune nouvelle piste trouvée (déjà dans la bibliothèque ?)', 'info');
  }
}

// ── Rendu du modal ────────────────────────────────────────────────────────────

function _renderDrivesList(drives) {
  const list = document.getElementById('usb-drives-list');
  if (!list) return;

  if (!drives.length) {
    list.innerHTML = '<div class="usb-drives-empty">Aucun disque amovible détecté</div>';
    return;
  }

  list.innerHTML = drives.map(d => `
    <div class="usb-drive-row">
      <div class="usb-drive-info">
        <span class="usb-drive-label">${esc(d.label || d.path)}</span>
        <span class="usb-drive-path">${esc(d.path)}</span>
      </div>
      <button class="mbtn" style="font-size:11px;padding:5px 12px"
        data-action="usb-scan"
        data-path="${esc(d.path)}">
        Choisir un dossier
      </button>
    </div>
  `).join('');
}
```

- [ ] **Step 4: Wire initDevices() in app.js**

Read `frontend/src/app.js`. Find the import block at the top. After the `import { initDeviceEQ }` line (or any recent Phase 1b import), add:

```javascript
import { initDevices } from './devices.js';
```

Then in the boot sequence (search for `initDeviceEQ(cfg.eqDeviceProfiles ?? {})`), add immediately after it:

```javascript
  initDevices(); // démarrer le polling USB
```

- [ ] **Step 5: Run tests**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass (255 OK + eqdevice 9/9 + organize 9/9 + backup 9/9 + devices 5/5).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/devices.js frontend/tests/core.test.cjs frontend/src/app.js
git commit -m "feat(devices): add devices.js (USB polling + import modal) + 5 tests"
```

---

## Task 3: USB modal HTML + CSS + handlers

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/handlers.js`

- [ ] **Step 1: Add USB modal to index.html**

Read `frontend/index.html`. Find the `#organize-modal-bg` block (added in Phase 1b). **After** its closing `</div>`, insert:

```html
<!-- USB IMPORT MODAL — import depuis un disque externe -->
<div id="usb-modal-bg" data-backdrop-action="usb-cancel">
  <div id="usb-modal" role="dialog" aria-modal="true" aria-labelledby="usb-modal-title">
    <div class="modal-h" id="usb-modal-title">Importer depuis un disque</div>
    <div class="modal-s">Sélectionnez un disque, puis choisissez un dossier à importer.</div>
    <div id="usb-drives-list" class="usb-drives-list">
      <!-- Injecté dynamiquement par _renderDrivesList() -->
    </div>
    <div class="modal-btns">
      <button class="mbtn cancel" data-action="usb-cancel">Fermer</button>
      <button class="mbtn" data-action="usb-refresh">↻ Actualiser</button>
    </div>
  </div>
</div>
```

Also in `#set-page-library`, after the "Sauvegarde & Portabilité" section (added in Phase 2), insert a trigger section before "Réinitialisation":

```html
      <div class="set-section">
        <div class="set-section-lbl">Import USB</div>
        <div class="set-row">
          <div>
            <div class="set-row-label">Importer depuis un disque externe</div>
            <div class="set-row-sub">Détecte les clés USB et disques externes, importe la musique via le pipeline existant.</div>
          </div>
          <button class="mbtn" data-action="usb-open-modal">
            Importer depuis USB
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Add CSS in style.css**

In `frontend/src/style.css`, immediately before the `/* ── Thème clair */` line (or `html[data-mode="light"]` block), add:

```css
/* ── USB import modal ────────────────────────────────────────────────────── */
#usb-modal-bg {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: calc(var(--z-modal) + 150);
  display: flex;
  align-items: center;
  justify-content: center;
  visibility: hidden; opacity: 0; pointer-events: none;
  transition: opacity var(--dur-fast), visibility var(--dur-fast);
}
#usb-modal-bg.on { visibility: visible; opacity: 1; pointer-events: auto; }
#usb-modal {
  background: var(--bg2, #1e1e2e);
  border-radius: 12px;
  padding: 24px;
  width: min(480px, 90vw);
  max-height: 70vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.usb-drives-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}
.usb-drive-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.usb-drive-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.usb-drive-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usb-drive-path {
  font-size: 11px;
  color: var(--t3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usb-drives-empty {
  font-size: 13px;
  color: var(--t3);
  text-align: center;
  padding: 16px 0;
  font-style: italic;
}
```

Inside the light-mode block (`html[data-mode="light"]`), add after the existing organize overrides:

```css
html[data-mode="light"] #usb-modal { background: var(--bg2, #f5f5f8); }
html[data-mode="light"] .usb-drive-row { border-color: rgba(0,0,0,0.06); }
```

- [ ] **Step 3: Add handlers in handlers.js**

Read `frontend/src/handlers.js`. Find the import block. After the `import { exportBackup, importBackup }` line (added in Phase 2), add:

```javascript
import { openUsbImportModal, closeUsbImportModal,
         importFromDrive }                             from './devices.js';
```

In the `_ACTIONS` registry, after the `backup-import` handler, add:

```javascript
'usb-open-modal': async () => {
  await openUsbImportModal();
},

'usb-scan': async (btn) => {
  const path = btn.dataset.path || '';
  if (!path) return;
  await importFromDrive(path);
},

'usb-cancel': () => {
  closeUsbImportModal();
},

'usb-refresh': async () => {
  await openUsbImportModal(); // re-renders the list
},
```

- [ ] **Step 4: Run tests and Vite build**

```bash
cd frontend && node tests/core.test.cjs
```

Expected: all sections pass.

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/handlers.js
git commit -m "feat(devices): add USB import modal + drive list UI + handlers"
```

---

## Self-review checklist

- [x] **Spec coverage:** USB detection ✓ | toast on connect ✓ | no auto-scan ✓ | import via existing pipeline ✓ | modal with drive list ✓ | no special USB code in scan (reuses importPaths) ✓
- [x] **No placeholders:** all steps have complete code
- [x] **Cross-platform:** Windows (`GetLogicalDriveStringsW`), macOS (`/Volumes`), Linux (`/proc/mounts`) ✓
- [x] **Existing pipeline:** `importPaths()` from `watchfolder.js` reused as-is — no duplication ✓
- [x] **No circular imports:** devices.js → ipc.js, ui.js, watchfolder.js — no cycle ✓
- [x] **XSS safe:** all drive labels/paths rendered via `esc()` in `_renderDrivesList` ✓
- [x] **Modal pattern:** same `visibility/opacity` toggle as organize modal ✓
- [x] **Backdrop close:** `data-backdrop-action="usb-cancel"` handled by existing `_handleBackdropClick` ✓
- [x] **Type consistency:** `DriveInfo { path, label, kind }` used in both list_drives and devices.js ✓
