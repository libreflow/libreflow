/**
 * settings.js — Jalon 5
 * Gestion du panneau Settings, thèmes, dynColor, mode (dark/light),
 * couleur dynamique pochette, raccourcis clavier, et sync des boutons viz.
 *
 * Dépendances : store.js, eq.js, queue.js, i18n.js, cinema.js, viz.js
 * ARCH-1 : saveCfg depuis cfgsave.js, _allPlayerUI depuis allplayerui.js (deps circulaires brisées).
 */

import { get, set }                                      from './store.js';
import { eqOpen, closeEQ }                               from './eq.js';
import { queueOpen, closeQueue }                         from './queue.js';
import { getLang, i18n }                                 from './i18n.js';
import { syncCinemaBgSettings, updateCinArtColor }       from './cinema.js';
import { updateVizColor, getVizMode, getVizEnabled }     from './viz.js';
import { saveCfg }       from './cfgsave.js';
import { _allPlayerUI } from './allplayerui.js';

// ── État local ────────────────────────────────────────────────────────────────
let _theme          = 'blue';
let _dynColor       = true;
let _displayMode    = 'dark';
let _vinylSpin      = false;
let _shortcutsOpen  = false;
let _currentArtColor = null;

// A11Y-05: focus management + focus trap pour le panneau settings
let _settingsTrigger   = null; // élément qui a ouvert le panneau (restauré au close)
let _settingsFocusTrap = null; // handler Tab trap dans #settings-box

/** Sélecteur d'éléments focusables pertinents dans le panneau settings. */
const _FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _setupSettingsFocusTrap(box) {
  if (_settingsFocusTrap) box.removeEventListener('keydown', _settingsFocusTrap);
  _settingsFocusTrap = (e) => {
    if (e.code !== 'Tab') return;
    const focusable = [...box.querySelectorAll(_FOCUSABLE)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  box.addEventListener('keydown', _settingsFocusTrap);
}

// Art-blur background
const _artBlurImg = document.getElementById('art-blur-img');
let _artBlurPrev  = null;
let _artBlurTimer = null;

// ── Initialisation depuis boot() ──────────────────────────────────────────────
/**
 * Appelé depuis app.js boot() après chargement de la config.
 * Permet à settings.js d'owneriser theme/dynColor/displayMode.
 */
export function initSettingsVars({ theme, dynColor, displayMode, vinylSpin = false }) {
  _theme       = theme;
  _dynColor    = dynColor;
  _displayMode = displayMode;
  _vinylSpin   = vinylSpin;
  document.documentElement.classList.toggle('vinyl-spin', _vinylSpin);
}

// ── Getters (utilisés par _doSaveCfg dans app.js) ────────────────────────────
export function getTheme()        { return _theme; }
export function getDynColor()     { return _dynColor; }
export function getDisplayMode()  { return _displayMode; }
export function getVinylSpin()    { return _vinylSpin; }
export function isShortcutsOpen() { return _shortcutsOpen; }

// ══ SETTINGS PANEL ═══════════════════════════════════════════════════════════

/** Bascule sur un onglet du panneau settings (tab bar). */
export function switchSetTab(tab) {
  document.querySelectorAll('.set-page').forEach(p => p.classList.remove('on'));
  const page = document.getElementById('set-page-' + tab);
  if (page) page.classList.add('on');
  document.querySelectorAll('.set-tab-btn').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle('on', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

export function openSettings() {
  if (eqOpen)    closeEQ();
  if (queueOpen) closeQueue();
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  // A11Y-05: sauvegarder l'élément qui a déclenché l'ouverture pour le restaurer à la fermeture
  _settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel.classList.remove('closing');
  panel.classList.add('on');
  document.getElementById('tbt-settings')?.classList.add('active');
  switchSetTab('appearance');
  document.getElementById('lang-fr')?.classList.toggle('on', getLang() === 'fr');
  document.getElementById('lang-en')?.classList.toggle('on', getLang() === 'en');
  // Sync dynColor buttons
  const _dynOn  = document.getElementById('dyn-on-btn');
  const _dynOff = document.getElementById('dyn-off-btn');
  if (_dynOn)  { _dynOn.classList.toggle('on',  _dynColor);  _dynOn.setAttribute('aria-pressed',  String(_dynColor)); }
  if (_dynOff) { _dynOff.classList.toggle('on', !_dynColor); _dynOff.setAttribute('aria-pressed', String(!_dynColor)); }
  // Sync vinyl spin buttons
  const _vOn  = document.getElementById('vinyl-on-btn');
  const _vOff = document.getElementById('vinyl-off-btn');
  if (_vOn)  { _vOn.classList.toggle('on',  _vinylSpin);  _vOn.setAttribute('aria-pressed',  String(_vinylSpin)); }
  if (_vOff) { _vOff.classList.toggle('on', !_vinylSpin); _vOff.setAttribute('aria-pressed', String(!_vinylSpin)); }
  syncCinemaBgSettings();
  _syncVizBtns();
  // A11Y-05: mettre en place le piège de focus et déplacer le focus sur le bouton Fermer
  const box = document.getElementById('settings-box');
  if (box) _setupSettingsFocusTrap(box);
  setTimeout(() => {
    document.querySelector('#settings-box .set-close')?.focus();
  }, 50);
}

export function closeSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  // A11Y-05: supprimer le piège de focus avant l'animation
  const box = document.getElementById('settings-box');
  if (_settingsFocusTrap && box) {
    box.removeEventListener('keydown', _settingsFocusTrap);
    _settingsFocusTrap = null;
  }
  panel.classList.add('closing');
  // BUG-M3 FIX : animationend peut ne jamais se déclencher si l'animation est désactivée
  // (prefers-reduced-motion, GPU désactivé, transition CSS absente) → fallback 400ms
  let _closeHandled = false;
  const _onClose = () => {
    if (_closeHandled) return;
    _closeHandled = true;
    panel.classList.remove('on', 'closing');
    // A11Y-05: restaurer le focus à l'élément déclencheur après la fermeture de l'animation
    if (_settingsTrigger) {
      _settingsTrigger.focus();
      _settingsTrigger = null;
    }
  };
  panel.addEventListener('animationend', _onClose, { once: true });
  setTimeout(_onClose, 400); // fallback si animationend ne se déclenche jamais
  document.getElementById('tbt-settings')?.classList.remove('active');
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.getElementById('settings-panel')?.classList.contains('on')) {
    e.stopImmediatePropagation();
    closeSettings();
  }
});

// ══ THEMES ════════════════════════════════════════════════════════════════════
export const THEMES = ['green', 'blue', 'purple', 'red', 'orange', 'pink', 'cyan'];

export const THEME_COLORS = {
  green: '#1db954', blue: '#3b82f6', purple: '#a855f7',
  red: '#ef4444', orange: '#f97316', pink: '#ec4899', cyan: '#06b6d4',
};

// BUG FIX: --g-rgb était jamais défini → tous les rgba(var(--g-rgb,...)) tombaient sur le vert
export const THEME_RGB = {
  green: '29,185,84', blue: '59,130,246', purple: '168,85,247',
  red: '239,68,68', orange: '249,115,22', pink: '236,72,153', cyan: '6,182,212',
};

function _applyThemeVars(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.setProperty('--g-rgb', THEME_RGB[t] || '59,130,246');
  const artWrap = document.getElementById('pl-art');
  if (artWrap) artWrap.style.setProperty('--ring-color', THEME_COLORS[t] || '#3b82f6');
}

export function setTheme(t) {
  _theme = t;
  _applyThemeVars(t);
  document.querySelectorAll('.theme-swatch').forEach(s => {
    const on = s.dataset.theme === t;
    s.classList.toggle('on', on);
    s.setAttribute('aria-pressed', String(on));
  });
  _allPlayerUI();
  saveCfg();
}

function _applyDynColorUI() {
  const onBtn  = document.getElementById('dyn-on-btn');
  const offBtn = document.getElementById('dyn-off-btn');
  if (onBtn)  { onBtn.classList.toggle('on',  !!_dynColor);  onBtn.setAttribute('aria-pressed', String(!!_dynColor)); }
  if (offBtn) { offBtn.classList.toggle('on', !_dynColor);  offBtn.setAttribute('aria-pressed', String(!_dynColor)); }
  if (!_dynColor) {
    document.documentElement.style.removeProperty('--g');
    document.documentElement.style.removeProperty('--g-rgb');
    document.documentElement.style.removeProperty('--gd');
    document.documentElement.style.removeProperty('--gg');
  } else if (_currentArtColor) {
    applyArtColor(_currentArtColor);
  }
}

export function setVinylSpin(v) {
  _vinylSpin = !!v;
  document.documentElement.classList.toggle('vinyl-spin', _vinylSpin);
  const onBtn  = document.getElementById('vinyl-on-btn');
  const offBtn = document.getElementById('vinyl-off-btn');
  if (onBtn)  { onBtn.classList.toggle('on',  _vinylSpin);  onBtn.setAttribute('aria-pressed', String(_vinylSpin)); }
  if (offBtn) { offBtn.classList.toggle('on', !_vinylSpin); offBtn.setAttribute('aria-pressed', String(!_vinylSpin)); }
  saveCfg();
}

export function setDynColor(v) {
  _dynColor = !!v;
  _applyDynColorUI();
  saveCfg();
}

export function applyTheme() {
  _applyThemeVars(_theme);
  document.querySelectorAll('.theme-swatch').forEach(s => {
    const on = s.dataset.theme === _theme;
    s.classList.toggle('on', on);
    s.setAttribute('aria-pressed', String(on));
  });
  _applyDynColorUI();
}

// ══ COULEUR DYNAMIQUE ════════════════════════════════════════════════════════

export function applyArtColor(color) {
  if (!color) { clearArtColor(); return; }
  _currentArtColor = color;
  set('currentArtColor', color); // sync store → miniplayer.js peut lire la valeur via get()
  document.documentElement.style.setProperty('--art-color', color);
  const _m = color.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (_m) {
    const [, r, g_, b] = _m;
    document.documentElement.style.setProperty('--art-color-rgb', `${r},${g_},${b}`);
    if (_dynColor) {
      document.documentElement.style.setProperty('--g',   color);
      document.documentElement.style.setProperty('--g-rgb', `${r},${g_},${b}`);
      document.documentElement.style.setProperty('--gd',  `rgba(${r},${g_},${b},.14)`);
      document.documentElement.style.setProperty('--gg',  `rgba(${r},${g_},${b},.28)`);
    }
  }
  updateVizColor(color);
  updateCinArtColor(color);
  const artWrap = document.getElementById('pl-art');
  if (artWrap) {
    artWrap.classList.add('pl-art-glow', 'glow-on');
    artWrap.style.setProperty('--ring-color', THEME_COLORS[_theme] || '#3b82f6');
  }
}

export function clearArtColor() {
  _currentArtColor = null;
  set('currentArtColor', null); // sync store → miniplayer.js voit null
  document.documentElement.style.setProperty('--art-color', 'transparent');
  document.documentElement.style.removeProperty('--g');
  document.documentElement.style.removeProperty('--g-rgb');
  document.documentElement.style.removeProperty('--gd');
  document.documentElement.style.removeProperty('--gg');
  updateVizColor(null);
  updateCinArtColor(null);
  const artWrap = document.getElementById('pl-art');
  if (artWrap) artWrap.classList.remove('glow-on');
}

// ══ ANIMATION POCHETTE ═══════════════════════════════════════════════════════

const _artBlurImgEl = _artBlurImg; // alias lisible

export function _updateArtBlur(src) {
  if (!_artBlurImgEl || src === _artBlurPrev) return;
  _artBlurPrev = src;
  if (!src) {
    _artBlurImgEl.classList.remove('ab-on');
    return;
  }
  _artBlurImgEl.classList.remove('ab-on');
  const expectedSrc = src;
  clearTimeout(_artBlurTimer);
  _artBlurTimer = setTimeout(() => {
    if (_artBlurPrev !== expectedSrc) return;
    _artBlurImgEl.src = src;
    _artBlurImgEl.onload = () => {
      if (_artBlurPrev === expectedSrc) _artBlurImgEl.classList.add('ab-on');
    };
  }, 200);
}

export function animateArtChange() {
  const img = document.getElementById('pl-img');
  if (!img) return;
  img.classList.remove('art-change');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    img.classList.add('art-change');
    img.addEventListener('animationend', () => img.classList.remove('art-change'), { once: true });
  }));
}

// ══ PANEL RACCOURCIS ═════════════════════════════════════════════════════════

export function closeShortcuts() {
  _shortcutsOpen = false;
  document.getElementById('shortcuts-panel')?.classList.remove('open');
}

export function toggleShortcuts() {
  _shortcutsOpen = !_shortcutsOpen;
  if (_shortcutsOpen) {
    if (eqOpen)    closeEQ();
    if (queueOpen) closeQueue();
  }
  document.getElementById('shortcuts-panel')?.classList.toggle('open', _shortcutsOpen);
}

// ══ THÈME CLAIR / SOMBRE ════════════════════════════════════════════════════

export function setMode(mode) {
  _displayMode = mode;
  set('displayMode', mode);
  document.documentElement.setAttribute('data-mode', mode);
  const icoDark  = document.getElementById('ico-mode-dark');
  const icoLight = document.getElementById('ico-mode-light');
  if (icoDark)  icoDark.style.display  = mode === 'dark'  ? '' : 'none';
  if (icoLight) icoLight.style.display = mode === 'light' ? '' : 'none';
  ['mode-dark-btn', 'mode-light-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    const isActive = (id === 'mode-dark-btn') ? mode === 'dark' : mode === 'light';
    b.classList.toggle('on', isActive);
    b.setAttribute('aria-pressed', String(isActive));
  });
  // Toolbar toggle button — reflète le mode actif pour les lecteurs d'écran
  const modeBtn = document.getElementById('mode-toggle-btn');
  if (modeBtn) modeBtn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
  saveCfg();
}

export function toggleMode() {
  setMode(_displayMode === 'dark' ? 'light' : 'dark');
}

// ══ SYNC BOUTONS VIZ ════════════════════════════════════════════════════════

export function _syncVizBtns(save = false) {
  const mode    = getVizMode();
  const enabled = getVizEnabled();
  const ids = { bars: 'set-viz-bars', oscilloscope: 'set-viz-oscilloscope', circle: 'set-viz-circle' };
  Object.entries(ids).forEach(([m, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const active = m === mode;
    btn.classList.toggle('on', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const toggleBtn = document.getElementById('set-viz-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('on', enabled);
    toggleBtn.setAttribute('aria-pressed', String(enabled));
    const span = toggleBtn.querySelector('span');
    if (span) span.setAttribute('data-i18n', enabled ? 'set_viz_on' : 'set_viz_off');
    if (span) span.textContent = i18n(enabled ? 'set_viz_on' : 'set_viz_off');
  }
  const shapeGroup = document.getElementById('set-viz-shape-group');
  if (shapeGroup) shapeGroup.style.opacity = enabled ? '' : '0.35';
  if (save) saveCfg();
}
