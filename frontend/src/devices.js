// LibreFlow — devices.js
// Détection de lecteurs USB (polling) et import de musique depuis un périphérique externe.
//
// Flux :
//   1. initDevices()         — lance le polling toutes les 6 secondes
//   2. _poll()               — compare la liste des lecteurs avec la précédente
//   3. _onUsbConnected()     — toast de notification
//   4. openUsbImportModal()  — affiche le modal avec la liste des lecteurs amovibles
//   5. importFromDrive()     — open_folder_at(path) → importPaths() pipeline existant
//
// Exports :
//   initDevices()
//   openUsbImportModal()
//   closeUsbImportModal()
//   importFromDrive(drivePath)

import { invoke }                       from './ipc.js';
import { toast, esc }                   from './ui.js';
import { importPaths }                  from './watchfolder.js';
import { detectNewAudioCds }            from './cdaudio_pure.js';
import { openCdModal, cleanupCdCache }  from './cdaudio.js';

// ── État module ───────────────────────────────────────────────────────────────

/** @type {Array<{path:string,label:string,kind:string}>} */
let _lastDrives = [];
let _pollTimer  = null;
let _polling    = false;
let _usbModalPrevFocus = null;
const POLL_INTERVAL_MS = 6000; // 6 secondes

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Démarre le polling de détection USB.
 * À appeler une fois au boot (après la première renderLib).
 * Idempotent : un second appel remplace l'interval précédent.
 */
export function initDevices() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _poll(); // premier poll immédiat
  _pollTimer = setInterval(_poll, POLL_INTERVAL_MS);
}

/** Stoppe le polling. Utile pour HMR / teardown. */
export function stopDevices() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/** Affiche le modal d'import USB avec la liste des lecteurs amovibles courants. */
export async function openUsbImportModal() {
  let drives = [];
  try { drives = await invoke('list_drives'); }
  catch (e) { console.warn('[devices] list_drives failed:', e); }

  _renderDrivesList(drives.filter(d => d.kind === 'removable' || d.kind === 'unknown'));

  const bg = document.getElementById('usb-modal-bg');
  if (!bg) return;
  _usbModalPrevFocus = document.activeElement;
  bg.classList.add('on');
  // A11Y : focus sur le premier bouton actif (drive ou close).
  requestAnimationFrame(() => {
    const first = bg.querySelector('#usb-modal button:not([disabled])');
    first?.focus();
  });
}

/** Ferme le modal d'import USB. */
export function closeUsbImportModal() {
  const bg = document.getElementById('usb-modal-bg');
  if (!bg) return;
  bg.classList.remove('on');
  // A11Y : restaurer le focus sur l'élément déclencheur.
  if (_usbModalPrevFocus && typeof _usbModalPrevFocus.focus === 'function') {
    _usbModalPrevFocus.focus();
  }
  _usbModalPrevFocus = null;
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function _poll() {
  if (_polling) return; // tick précédent encore en cours (list_drives lent)
  _polling = true;
  try {
    let drives;
    try { drives = await invoke('list_drives'); }
    catch { return; } // IPC indisponible (app en cours de boot, etc.)

    const newRemovable = _detectNewRemovable(_lastDrives, drives);
    for (const d of newRemovable) _onUsbConnected(d);

    // CD audio : insertion depuis le dernier poll
    const newCds = detectNewAudioCds(_lastDrives, drives);
    for (const cd of newCds) _onAudioCdInserted(cd);

    // CD audio : éjection (présent au poll précédent, absent maintenant)
    const currAudioPaths = new Set(drives.filter(d => d.audio_cd).map(d => d.path));
    for (const prev of _lastDrives) {
      if (prev.audio_cd && !currAudioPaths.has(prev.path)) {
        cleanupCdCache(prev.path).catch(e => console.warn('[devices] cleanup failed:', e));
      }
    }

    _lastDrives = drives;
  } finally {
    _polling = false;
  }
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

function _onAudioCdInserted(drive) {
  toast(
    `CD Audio détecté (${drive.track_count} pistes) — Lire ou extraire ?`,
    'info'
  );
  openCdModal(drive.path);
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
