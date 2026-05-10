// LibreFlow — updater.js
// Vérification des mises à jour via tauri-plugin-updater (Tauri v2).
//
// Usage :
//   import { checkForUpdate } from './updater.js';
//   checkForUpdate();  // appelé au boot (app.js) avec délai de 10s
//
// Pré-requis côté build :
//   1. `plugins.updater.pubkey`     dans tauri.conf.json  (clé publique générée)
//   2. `plugins.updater.endpoints`  dans tauri.conf.json  (URL GitHub Releases)
//   3. Variable d'env TAURI_SIGNING_PRIVATE_KEY au moment du build
//      → GitHub Actions secret : Settings > Secrets > TAURI_SIGNING_PRIVATE_KEY
//
// Note : les plugins sont accessibles via window.__TAURI__ (withGlobalTauri: true).
// Aucune dépendance npm (@tauri-apps/plugin-updater / plugin-process) requise.

import { i18n }             from './i18n.js';
import { toast, toastWithAction } from './ui.js';

/**
 * Vérifie si une mise à jour est disponible.
 * Affiche un toast avec un bouton "Installer" si une nouvelle version est trouvée.
 * Silencieux en cas d'erreur (endpoint non configuré, pas de réseau, etc.).
 *
 * BUG-9 FIXED : migration de invoke('plugin:updater|check') vers
 *               window.__TAURI__.updater.check() (API officielle).
 */
export async function checkForUpdate() {
  try {
    const update = await window.__TAURI__.updater.check();
    if (!update) return;

    const version = update.version ?? '?';
    toastWithAction(
      i18n('t_update_available', version),
      'info',
      i18n('t_update_install'),
      () => _installUpdate(update),
      0
    );
  } catch {
    // Silencieux — endpoint non configuré, pas de réseau, clé invalide, etc.
  }
}

export async function checkForUpdateManual(btn) {
  const span = btn?.querySelector('span') ?? btn;
  if (btn) { btn.disabled = true; if (span) span.textContent = i18n('t_update_checking'); }
  try {
    const update = await window.__TAURI__.updater.check();
    if (!update) {
      toast(i18n('t_update_uptodate'), 'success', 3000);
    } else {
      const version = update.version ?? '?';
      toastWithAction(
        i18n('t_update_available', version),
        'info',
        i18n('t_update_install'),
        () => _installUpdate(update),
        0
      );
    }
  } catch {
    toast(i18n('t_update_error', '?'), 'error', 4000);
  } finally {
    if (btn) { btn.disabled = false; if (span) span.textContent = i18n('t_update_check_btn'); }
  }
}

// ── Téléchargement + installation avec progress ──────────────────────────────

/**
 * BUG-10 FIXED : suppression des arguments non documentés (bytes, timeout, proxy,
 *                onEvent) — utilisation de update.downloadAndInstall(onEvent).
 * BUG-11 FIXED : ajout de window.__TAURI__.process.relaunch() après installation
 *                (le plugin ne relance pas automatiquement).
 */
async function _installUpdate(update) {
  let downloaded  = 0;
  let total       = 0;

  // Toast vivant — utilise la méthode .update() ajoutée en P2-3
  // 'loading' (120 000 ms) garantit l'affichage pendant tout le téléchargement.
  const t = toast(i18n('t_update_downloading'), 'loading');

  try {
    // API officielle : downloadAndInstall(onEvent) sans arguments parasites
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data?.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data?.chunkLength ?? 0;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          t?.update?.(i18n('t_update_progress', pct));
        }
      } else if (event.event === 'Finished') {
        t?.update?.(i18n('t_update_installing'));
      }
    });

    // Relaunch explicite requis — le plugin n'effectue pas de redémarrage automatique
    await window.__TAURI__.process.relaunch();
  } catch (e) {
    toast(i18n('t_update_error', String(e)), 'error');
  }
}
