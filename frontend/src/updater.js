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

import { Channel }          from '@tauri-apps/api/core';
import { invoke }           from './ipc.js';
import { i18n }             from './i18n.js';
import { toast, toastWithAction } from './ui.js';

/**
 * Vérifie si une mise à jour est disponible.
 * Affiche un toast avec un bouton "Installer" si une nouvelle version est trouvée.
 * Silencieux en cas d'erreur (endpoint non configuré, pas de réseau, etc.).
 */
export async function checkForUpdate() {
  try {
    const update = await invoke('plugin:updater|check');
    if (!update?.available) return;

    const version = update.version ?? '?';
    toastWithAction(
      i18n('t_update_available', version),
      'info',
      i18n('t_update_install'),
      () => _installUpdate(update),
      0   // durée = infinie jusqu'à action utilisateur
    );
  } catch {
    // Silencieux — endpoint non configuré, pas de réseau, clé invalide, etc.
  }
}

// ── Téléchargement + installation avec progress ──────────────────────────────

async function _installUpdate(update) {
  let downloaded  = 0;
  let total       = 0;

  // Toast vivant — utilise la méthode .update() ajoutée en P2-3
  // BUG FIX : 'loading' (120 000 ms) au lieu de 'info' + 0 (3 e arg ignoré → 3 000 ms).
  // toast() ne prend que 2 params — la durée longue garantit l'affichage pendant tout le dl.
  const t = toast(i18n('t_update_downloading'), 'loading');

  try {
    const channel = new Channel();
    channel.onmessage = (event) => {
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
    };

    await invoke('plugin:updater|download_and_install', {
      url:       update.url,
      signature: update.signature,
      version:   update.version,
      headers:   update.headers ?? {},
      bytes:     null,
      timeout:   null,
      proxy:     null,
      onEvent:   channel,
    });

    // Le plugin déclenche un relaunch automatique — on ne devrait pas arriver ici
  } catch (e) {
    toast(i18n('t_update_error', String(e)), 'error');
  }
}
