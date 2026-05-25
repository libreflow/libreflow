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
// En Tauri 2, `withGlobalTauri` n'expose QUE les APIs core (app, core, event,
// path, window…). Les plugins doivent passer par leurs wrappers npm officiels.

import { check }      from '@tauri-apps/plugin-updater';
import { relaunch }   from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

import { i18n }                   from './i18n.js';
import { toast, toastWithAction } from './ui.js';

/**
 * Affiche la version courante de l'application dans le panneau « À propos ».
 * Silencieux en cas d'erreur — la valeur statique du HTML sert de fallback.
 */
export async function initAppVersion() {
  try {
    const version = await getVersion();
    document.querySelectorAll('[data-i18n="set_app_version"]').forEach(el => {
      el.textContent = `v${version}`;
    });
  } catch {
    // Silencieux — fallback sur la valeur statique du HTML
  }
}

/**
 * Vérifie si une mise à jour est disponible.
 * Affiche un toast avec un bouton "Installer" si une nouvelle version est trouvée.
 * Silencieux en cas d'erreur (endpoint non configuré, pas de réseau, etc.).
 */
export async function checkForUpdate() {
  try {
    const update = await check();
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
    const update = await check();
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
  } catch (e) {
    toast(i18n('t_update_error', String(e)), 'error', 4000);
  } finally {
    if (btn) { btn.disabled = false; if (span) span.textContent = i18n('t_update_check_btn'); }
  }
}

// ── Téléchargement + installation avec progress ──────────────────────────────

async function _installUpdate(update) {
  let downloaded  = 0;
  let total       = 0;

  // Toast vivant — 'loading' (120 000 ms) garantit l'affichage pendant tout
  // le téléchargement, .update() rafraîchit le texte (progress %).
  const t = toast(i18n('t_update_downloading'), 'loading');

  try {
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

    // Relaunch explicite requis — le plugin ne relance pas automatiquement
    await relaunch();
  } catch (e) {
    toast(i18n('t_update_error', String(e)), 'error');
  }
}
