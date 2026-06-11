// LibreFlow — Localisation strings
//
// LANGS is the single source of truth for all UI text.
// i18n(key, ...args) lives in app.js because it reads the app-level `lang` var.
// Import LANGS here when you need direct dict access (e.g. language pickers).

import { toast }        from './ui.js';
import { emit, EVENTS } from './bus.js';
import { applyTheme } from './settings.js';
import { setCrossfade } from './player.js';
import { updateStats } from './renderer.js';
import { get } from './store.js';
import { fr }  from './i18n.fr.js';
import { en }  from './i18n.en.js';

export const LANGS = { fr, en }

// ── Runtime i18n state ───────────────────────────────────────
// `lang` est la locale active. initLang() l'initialise depuis la config au
// démarrage (sans effets de bord). setLang() est réservé aux changements
// utilisateur (sauvegarde + rafraîchissement de l'UI).

let lang = 'fr';

/** Initialise la locale au démarrage, sans side-effects. Appelé depuis boot(). */
export function initLang(l) { lang = l; }

/** Retourne la locale active ('fr' | 'en'). */
export function getLang() { return lang; }

/** Change la locale en live et rafraîchit l'UI. Persister via saveCfg() côté appelant. */
export function setLang(l) {
  if (!LANGS[l]) return;
  lang = l;
  applyLang();
}

/** Traduit une clé. Retourne la valeur FR en fallback. */
export function i18n(key, ...args) {
  const dict = LANGS[lang] || LANGS.fr;
  const val  = dict[key] ?? LANGS.fr[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

/** Applique tous les textes traduits à l'UI.
 *  Lit window.sort, window.displayMode, window.crossfadeDur pour éviter
 *  une dépendance circulaire avec app.js. */
export function applyLang() {
  // ── BCP 47 : mettre à jour l'attribut lang du document ─────
  document.documentElement.lang = lang;

  const setText = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    if (el) el.textContent = i18n(key);
  };
  const setHtml = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    // SECURITY: keys passed to setHtml must be purely static HTML from the i18n bundle.
    // Never use with keys that interpolate user data (t.name, artist, path, etc.).
    if (el) el.innerHTML = i18n(key);
  };
  const setAttrEl = (id, attr, key) => {
    const el = document.getElementById(id);
    if (el) el[attr] = i18n(key);
  };
  const setBtnText = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    if (!el) return;
    /** @type {Text | null} */ let last = null;
    el.childNodes.forEach(n => { if (n.nodeType === 3) last = /** @type {Text} */ (n); });
    if (last) last.textContent = ' ' + i18n(key);
    else el.appendChild(document.createTextNode(' ' + i18n(key)));
  };

  // ── data-i18n / data-i18n-title elements ───────────────────
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n(el.dataset.i18n);
  });
  // SECURITY: data-i18n-html keys must be purely static HTML from the i18n bundle.
  // Never use this attribute with keys that interpolate user data (t.name, artist, path, etc.).
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = i18n(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = i18n(el.dataset.i18nTitle);
  });
  // ── data-i18n-aria : aria-label traduits ───────────────────
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', i18n(el.dataset.i18nAria));
  });
  // ── data-aria-i18n : alias (même effet, deux attributs pour raison historique) ──
  document.querySelectorAll('[data-aria-i18n]').forEach(el => {
    el.setAttribute('aria-label', i18n(el.dataset.ariaI18n));
  });

  // Stats
  updateStats();

  // Sort label + sort button aria-label (boot-time; nextSort() keeps it in sync on cycle)
  const SLBLS_I18N = { az: 'sort_az', za: 'sort_za', artist: 'sort_artist', album: 'sort_album', recent: 'sort_recent' };
  const _sortKey = SLBLS_I18N[get('sort')] || 'sort_az';
  setText('sort-lbl', _sortKey, true);
  const _sortBtn = document.getElementById('main-sort-btn');
  if (_sortBtn) _sortBtn.setAttribute('aria-label', `${i18n('pl_sort_label')}: ${i18n(_sortKey)}`);

  // Placeholders & titles
  setAttrEl('srch',     'placeholder', i18n('srch_ph'));
  setAttrEl('tbt-min',  'title',       i18n('tb_minimize'));
  setAttrEl('tbt-max',  'title',       i18n('tb_maximize'));
  setAttrEl('pcplay',   'title',       i18n('pc_play'));
  setAttrEl('pc-shuf',  'title',       i18n('pc_shuffle'));
  setAttrEl('pc-rep',   'title',       i18n('pc_repeat'));
  // Sleep menu inputs
  setAttrEl('sleep-custom-input', 'placeholder', i18n('sleep_ph'));

  // Scan view
  setText('.sh',  'scan_title');
  setText('.ss',  'scan_sub');

  // Drag overlay
  setText('.drago-msg', 'drag_hint');

  // Welcome screen
  setText('.wh1',  'wlc_title');
  setText('.wsub', 'wlc_sub');
  setBtnText('.wbtn-scan', 'wlc_btn');
  setBtnText('.wbtn-m3u', 'wlc_btn_m3u');
  setText('.whint', 'wlc_hint');
  const feats = document.querySelectorAll('.wf');
  const featKeys = ['wlc_feat1', 'wlc_feat2', 'wlc_feat3', 'wlc_feat4'];
  feats.forEach((f, i) => {
    const wft = f.querySelector('.wf-t'); if (wft) wft.textContent = i18n(featKeys[i] + '_t');
    const wfd = f.querySelector('.wf-d'); if (wfd) wfd.textContent = i18n(featKeys[i] + '_d');
  });

  // Sidebar buttons
  setBtnText('.btn-scan',  'btn_scan');
  setBtnText('.btn-clear', 'btn_clear');

  // Clear modal
  setText('#modal .modal-h', 'clear_h');
  setHtml('#modal .modal-s', 'clear_body');

  // Modal cancel buttons
  document.querySelectorAll('.mbtn.cancel').forEach(b => b.textContent = i18n('pl_cancel'));

  // Playlist modal
  setAttrEl('pl-modal-inp', 'placeholder', i18n('pl_name_ph'));
  setText('pl-modal-title', 'pl_modal_h', true);

  // Context menu strings
  setText('ctx-add-lbl',    'pl_add_to', true);
  setText('ctx-remove-lbl', 'pl_remove', true);
  const ctxNewPl = document.getElementById('ctx-new-pl-item');
  if (ctxNewPl) {
    /** @type {Text | null} */ let last = null;
    ctxNewPl.childNodes.forEach(n => { if (n.nodeType === 3) last = /** @type {Text} */ (n); });
    if (last) last.textContent = ' ' + i18n('ctx_new_pl');
  }

  // Lang toggle highlight
  const lf = document.getElementById('lang-fr');
  const le = document.getElementById('lang-en');
  if (lf) lf.classList.toggle('on', lang === 'fr');
  if (le) le.classList.toggle('on', lang === 'en');

  // Mode buttons highlight
  const md = document.getElementById('mode-dark-btn');
  const ml = document.getElementById('mode-light-btn');
  if (md) md.style.background = get('displayMode') === 'dark'  ? 'var(--gd)' : '';
  if (ml) ml.style.background = get('displayMode') === 'light' ? 'var(--gd)' : '';

  // Re-render lib if visible
  const vlib = document.getElementById('vlib');
  if (vlib && vlib.classList.contains('on')) emit(EVENTS.RENDER_LIB, {});

  // Apply theme and crossfade
  applyTheme();
  setCrossfade(get('crossfadeDur') || 0);
}
