// @ts-nocheck
// frontend/src/boot-ui.js
// Boot-time UI initialisation helpers extracted from app.js.
// These functions must NOT import from app.js (no circular deps).
import { get, set }                               from './store.js';
import { invoke }                                 from './ipc.js';
import { saveCfg }                                from './cfgsave.js';
import { applyLang, i18n }                        from './i18n.js';
import { setMode, getDisplayMode }                from './settings.js';
import { updateVolSlider, setupMarquee }          from './playerbar.js';
import { setSpeed }                               from './player.js';
import { rgEnabled, rgTargetLUFS }               from './replaygain.js';
import { updateWatchUI, getWatchPath, stopWatchFolder, startWatchNative } from './watchfolder.js';
import { checkForUpdateManual }                   from './updater.js';
import { toast }                                  from './ui.js';
import { normalizePathKey, extractAudioFileArg }  from './utils.js';
import { addToQueueNext }                         from './queue.js';
import { next }                                   from './player.js';

let _bootUIApplied = false; // BUG-AUDIT HIGH : garde anti-double-appel

/** Câble les contrôles cfg (autoUpdate, autostart, cdCopyrightAck, lastSettingsTab, watchChk, checkUpdateBtn). */
export function _applyBootUICfgControls(cfgObj) {
  const autoUpdateChk = document.getElementById('auto-update-chk');
  if (autoUpdateChk) {
    const autoUpdate = cfgObj?.autoUpdate !== false;
    set('autoUpdate', autoUpdate);
    autoUpdateChk.checked = autoUpdate;
    autoUpdateChk.addEventListener('change', () => {
      set('autoUpdate', autoUpdateChk.checked);
      saveCfg();
    });
  }
  // Plugin autostart — l'état vit dans l'OS (registre), pas dans cfg : lecture live
  const autostartChk = document.getElementById('autostart-chk');
  if (autostartChk) {
    invoke('plugin:autostart|is_enabled', undefined, { timeout: 3000 })
      .then((on) => { autostartChk.checked = !!on; })
      .catch(e => console.warn('[app:autostart] is_enabled failed:', e));
    autostartChk.addEventListener('change', async () => {
      try {
        await invoke(autostartChk.checked ? 'plugin:autostart|enable' : 'plugin:autostart|disable', undefined, { timeout: 3000 });
      } catch (e) {
        console.warn('[app:autostart] toggle failed:', e);
        autostartChk.checked = !autostartChk.checked; // revert UI — l'OS n'a pas appliqué
        toast(i18n('t_autostart_err') || 'Impossible de modifier le démarrage automatique', 'error');
      }
    });
  }
  // CONFORMITÉ-CD : restaurer l'opt-in copyright CD au boot
  set('cdCopyrightAck', cfgObj?.cdCopyrightAck === true);
  // UX-Ergo : restaurer le dernier onglet settings ouvert
  set('lastSettingsTab', cfgObj?.lastSettingsTab || 'appearance');
  const watchChk = document.getElementById('watch-folder-chk');
  if (watchChk) watchChk.addEventListener('change', async () => {
    if (watchChk.checked) {
      if (getWatchPath()) { await startWatchNative(); }
      else { watchChk.checked = false; }
    } else {
      stopWatchFolder(true, true);
    }
    saveCfg();
  });
  const checkUpdateBtn = document.getElementById('check-update-btn');
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener('click', () => checkForUpdateManual(checkUpdateBtn));
  }
}

/** Synchronise les contrôles de lecture (shuffle, repeat, volume, speed, RG) avec l'état restauré. */
export function _applyBootUIPlaybackControls() {
  const shuffle = get('shuffle');
  const repeat  = get('repeat');
  const playbackSpeed = get('playbackSpeed') ?? 1;
  document.getElementById('pc-shuf')?.classList.toggle('on', shuffle);
  document.getElementById('pc-shuf')?.setAttribute('aria-pressed', String(shuffle));
  document.getElementById('pc-rep')?.classList.toggle('on', repeat !== 'none');
  document.getElementById('pc-rep')?.setAttribute('aria-pressed', String(repeat !== 'none'));
  updateWatchUI();
  setTimeout(updateVolSlider, 100);
  if (playbackSpeed !== 1) setSpeed(playbackSpeed);
  const rgChk = document.getElementById('rg-enabled');
  if (rgChk) rgChk.checked = rgEnabled;
  const rgSlider = document.getElementById('rg-target');
  if (rgSlider) rgSlider.value = rgTargetLUFS;
  const rgLbl = document.getElementById('rg-target-lbl');
  if (rgLbl) rgLbl.textContent = rgTargetLUFS + ' LUFS';
}

export function _applyBootUI(cfgObj) {
  if (_bootUIApplied) return;
  _bootUIApplied = true;
  applyLang();
  setMode(getDisplayMode());
  _applyBootUIPlaybackControls();
  _applyBootUICfgControls(cfgObj);
}

/**
 * Joue une piste de la bibliothèque à partir d'un chemin de fichier
 * (plugin single-instance / cli — association de fichiers Windows).
 * @param {string|null} rawPath
 */
export function _playFileArg(rawPath) {
  if (!rawPath) return;
  const key = normalizePathKey(rawPath);
  const t = (get('tracks') || []).find(tr => tr.path && normalizePathKey(tr.path) === key);
  if (!t) {
    toast(i18n('t_file_not_in_lib') || 'Ce fichier n\'est pas dans la bibliothèque — importez son dossier d\'abord', 'info');
    return;
  }
  if (addToQueueNext(t.id)) next(true);
}
