// LibreFlow — Sleep timer
//
// Fades out audio and pauses playback after a configurable delay.
// Remaining window.* : toast (app.js, pas encore extrait).
//
// Exports (state — live bindings):
//   sleepFading      True while volume is being faded out (read by crossfade in app.js)
// Exports (functions):
//   setSleepFading(val)    Setter for sleepFading (app.js writes it on manual play resume)
//   toggleSleepMenu, setSleepTimer, cancelSleepTimer

import { CFG }                              from './cfg.js';
import { i18n }                             from './i18n.js';
import { audio, audioNext, clearCrossfadeTimers } from './player.js';
import { radioActive, stopRadioSilent }     from './radio.js';
import { toast }                                        from './ui.js';
import { masterGainNode, eqCtx, setMasterGain }        from './eq.js';

export let sleepTimerEnd  = 0;    // timestamp (ms) when sleep fires; 0 = inactive
export let sleepTickTimer = null; // setInterval handle
export let sleepFading    = false; // true once fade-out has started
export let sleepEndOfTrack = false; // true = stop after current track ends (no timer)
let _sleepWarnedMin       = false; // guard for 1-min warning toast
let _sleepWarned5Min      = false; // guard for 5-min warning (a11y annonce SR)

/** Allow app.js to reset sleepFading (e.g. when the user resumes playback manually). */
export function setSleepFading(val) { sleepFading = val; }

export function toggleSleepMenu() {
  const menu = document.getElementById('sleep-menu');
  if (!menu) return;
  menu.classList.toggle('on');
  if (menu.classList.contains('on')) {
    // Close on outside click
    setTimeout(() => { document.removeEventListener('click', _sleepOutside); document.addEventListener('click', _sleepOutside, { once: true }); }, 0);
  }
}

function _sleepOutside(e) {
  const menu = document.getElementById('sleep-menu');
  const ind  = document.getElementById('sleep-indicator');
  // BUG-11 FIX : null-check sur ind (optional chaining — évite TypeError si absent du DOM)
  if (menu && !menu.contains(e.target) && !ind?.contains(e.target)) menu.classList.remove('on');
}

export function setSleepTimer(minutes) {
  document.getElementById('sleep-menu')?.classList.remove('on');
  cancelSleepTimer(true); // cancel any previous timer silently
  sleepTimerEnd    = Date.now() + minutes * 60 * 1000;
  sleepFading      = false;
  sleepEndOfTrack  = false;
  _sleepWarnedMin  = false;
  _sleepWarned5Min = false;

  const indicator = document.getElementById('sleep-indicator');
  if (indicator) { indicator.style.display = 'flex'; indicator.classList.add('active'); }
  document.getElementById('sleep-opt-cancel')?.classList.add('on');

  // Clear active state on all option buttons
  document.querySelectorAll('.sleep-opt').forEach(b => b.classList.remove('active'));

  _updateSleepCountdown();
  sleepTickTimer = setInterval(_sleepTick, 1000);
  const endDate  = new Date(sleepTimerEnd);
  const hh = String(endDate.getHours()).padStart(2, '0');
  const mm = String(endDate.getMinutes()).padStart(2, '0');
  toast(i18n('t_sleep_set', minutes) + ` (${hh}:${mm})`);
}

export function setSleepEndOfTrack() {
  document.getElementById('sleep-menu')?.classList.remove('on');
  cancelSleepTimer(true);
  sleepEndOfTrack = true;
  sleepFading     = false;

  const indicator = document.getElementById('sleep-indicator');
  if (indicator) { indicator.style.display = 'flex'; indicator.classList.add('active'); }
  document.getElementById('sleep-opt-cancel')?.classList.add('on');

  const el = document.getElementById('sleep-countdown');
  if (el) el.textContent = '⏹';
  toast(i18n('t_sleep_end_track'));
}

export function setSleepCustom() {
  const inp = document.getElementById('sleep-custom-input');
  if (!inp) return;
  const v = parseInt(inp.value, 10);
  if (!Number.isInteger(v) || v < 1 || v > 999) {
    inp.classList.add('shake');
    setTimeout(() => inp.classList.remove('shake'), 400);
    return;
  }
  inp.value = '';
  setSleepTimer(v);
}

export function cancelSleepTimer(silent) {
  if (sleepTickTimer) { clearInterval(sleepTickTimer); sleepTickTimer = null; }
  sleepTimerEnd = 0; sleepFading = false; sleepEndOfTrack = false;
  _sleepWarnedMin = false; _sleepWarned5Min = false;
  // Restore volume to the user's set level (read slider — never hardcode = 1)
  const _vel = document.getElementById('vol');
  const _targetVol = _vel ? parseFloat(_vel.value) : audio.volume;
  // DSP-5 : restaurer via masterGainNode (graph) ; sinon fallback HTML
  if (masterGainNode && eqCtx) {
    masterGainNode.gain.setTargetAtTime(_targetVol, eqCtx.currentTime, 0.05);
  } else {
    // M-04 : toujours restaurer le volume cible (la garde `< _targetVol` skippait
    // la restauration quand le fade-out l'avait déjà fait descendre puis remonter).
    setMasterGain(_targetVol);
  }
  const indicator = document.getElementById('sleep-indicator');
  if (indicator) { indicator.style.display = 'none'; indicator.classList.remove('active'); }
  document.getElementById('sleep-opt-cancel')?.classList.remove('on');
  document.getElementById('sleep-menu')?.classList.remove('on');
  if (!silent) toast(i18n('t_sleep_cancel'));
}

function _sleepTick() {
  const remaining = sleepTimerEnd - Date.now();
  if (remaining <= 0) {
    // Time's up: pause everything
    clearInterval(sleepTickTimer); sleepTickTimer = null;
    // BUG FIX: cancel crossfade before pausing — otherwise cfFadeTimer/cfNextTimer
    // keep running in the background after shutdown
    clearCrossfadeTimers();
    audio.pause();
    if (audioNext) { audioNext.pause(); }
    if (radioActive) stopRadioSilent(); // prevent auto-resume — variante synchrone, pas de dialog
    cancelSleepTimer(true);
    toast(i18n('t_sleep_done'));
    return;
  }
  // A11Y : annonces SR à T-5min (info) puis T-1min (warning) — pas plus, sinon trop bavard
  if (remaining <= 5 * 60000 && !_sleepWarned5Min && remaining > 60000) {
    _sleepWarned5Min = true;
    toast(i18n('t_sleep_warn_5min') || '5 minutes avant la mise en pause');
  }
  // Warning toast at 1 minute remaining (guard: only once)
  if (remaining <= 60000 && !_sleepWarnedMin) {
    _sleepWarnedMin = true;
    toast(i18n('t_sleep_warn_1min'), 'warning'); // type=warning → role=alert pour annonce assertive
  }
  // Start fade-out during the last N seconds
  if (remaining <= CFG.SLEEP_FADE_SECS * 1000 && !sleepFading) {
    sleepFading = true;
    // BUG FIX : annuler tout crossfade en cours dès que le sleep fade démarre.
    // Sans ça, audioNextGain continue de monter (fade-in de la piste suivante)
    // pendant que le sleep tente d'éteindre l'audio — les deux s'opposent.
    clearCrossfadeTimers();
  }
  if (sleepFading) {
    const ratio = Math.max(0, remaining / (CFG.SLEEP_FADE_SECS * 1000));
    // B9 FIX : multiplier le ratio par la valeur du slider #vol dans LES DEUX
    // branches. Avant, la branche masterGainNode écrivait le ratio brut 0..1 →
    // slider à 50 % : le fade montait d'abord le volume à 100 % avant de le
    // descendre (saut de volume audible). La branche fallback, elle, multipliait.
    const _volEl  = document.getElementById('vol');
    const _maxVol = _volEl ? parseFloat(_volEl.value) : 1;
    const vol     = ratio * _maxVol;
    // DSP-5 : fade via masterGainNode (sample-accurate) ; fallback audio.volume
    if (masterGainNode && eqCtx) {
      masterGainNode.gain.setTargetAtTime(vol, eqCtx.currentTime, 0.02);
    } else {
      setMasterGain(vol);
    }
  }
  _updateSleepCountdown();
}

function _updateSleepCountdown() {
  const remaining = Math.max(0, sleepTimerEnd - Date.now());
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const el = document.getElementById('sleep-countdown');
  if (el) el.textContent = m > 0 ? `${m}m` : `${s}s`;
}
