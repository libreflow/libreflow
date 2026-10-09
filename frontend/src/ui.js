// LibreFlow — ui.js
// Utilitaires UI purs : toasts, modal de confirmation, modal de saisie, ripple.
//
// Les modales confirm/prompt sont déléguées au Web Component Lit <lf-modal>
// (frontend/src/components/lf-modal.js), sur le même modèle que <lf-toast-stack>.
//
// AUCUNE dépendance vers d'autres modules LibreFlow — i18n.js importe toast depuis
// ui.js, donc tout import de i18n.js ici créerait un cycle bidirectionnel.
// Les libellés localisés sont résolus paresseusement par lf-modal via les
// attributs data-i18n (comme le reste du markup statique), et les appelants
// peuvent toujours surcharger okLabel/cancelLabel.
//
// Exports publics :
//   toast(msg, type)                                    — notification temporaire
//   toastWithAction(msg, type, label, onAction, dur)    — toast avec bouton undo
//   confirmAction(title, body, okLabel, okStyle)        — modal confirm → Promise<boolean>
//   promptAction(title, defaultVal, okLabel, cancelLabel) — saisie texte → Promise<string|null>
//   initRipple()                                         — effet ripple global boutons
// ─────────────────────────────────────────────────────────────────────────────
// ── Lit Web Component delegation ──────────────────────────────────────────────
import './components/lf-toast-stack.js';
import './components/lf-modal.js';

let _stack = null;

/** Trouve ou crée le singleton <lf-toast-stack> attaché à document.body. */
function _getStack() {
  if (_stack && _stack.isConnected) return _stack;
  _stack = document.querySelector('lf-toast-stack');
  if (!_stack) {
    _stack = document.createElement('lf-toast-stack');
    document.body.appendChild(_stack);
  }
  return _stack;
}

let _modal = null;

/** Trouve ou crée le singleton <lf-modal> attaché à document.body. */
function _getModal() {
  if (_modal && _modal.isConnected) return _modal;
  _modal = document.querySelector('lf-modal');
  if (!_modal) {
    _modal = document.createElement('lf-modal');
    document.body.appendChild(_modal);
  }
  return _modal;
}

/** Résout un libellé i18n par clé via le dictionnaire DOM standard. */
function _lbl(key, fallback) {
  const el = document.querySelector(`[data-i18n="${key}"]`);
  return (el && el.textContent.trim()) || fallback;
}

// ── Toast ────────────────────────────────────────────────────────────────────

/**
 * Affiche une notification temporaire.
 * @param {string} m    Message
 * @param {string} type 'info' | 'success' | 'error' | 'warning' | 'loading'
 * @returns {Function & { update: Function }} Fonction remove() — ferme le toast manuellement.
 *          La fonction expose aussi remove.update(newMsg) pour modifier le message.
 */
export function toast(m, type = 'info') {
  const stack = _getStack();
  const handle = stack.push({ message: m, type });
  const remove = () => handle.remove();
  remove.update = (newMsg) => handle.update(newMsg);
  return remove;
}

/**
 * Toast avec bouton d'action intégré (ex : "Annuler" après suppression).
 * @param {string}   m        Message principal
 * @param {string}   type     Type
 * @param {string}   label    Label du bouton action
 * @param {Function} onAction Callback exécuté au clic
 * @param {number}   [dur]    Durée ms (défaut = durée par type)
 * @returns {Function & { update: Function }}
 */
export function toastWithAction(m, type = 'info', label, onAction, dur) {
  const stack = _getStack();
  const handle = stack.push({
    message: m,
    type,
    duration: dur,
    action: { label, onClick: onAction }
  });
  const remove = () => handle.remove();
  remove.update = (newMsg) => handle.update(newMsg);
  return remove;
}

// ── Modales (déléguées à <lf-modal>) ──────────────────────────────────────────

/**
 * Affiche la modal de confirmation et retourne une Promise<boolean>.
 * @param {string} title    Titre de la modal
 * @param {string} body     Corps HTML (trusted — utiliser esc() pour du contenu utilisateur)
 * @param {string} [okLabel]  Label du bouton de confirmation (défaut = i18n btn_confirm)
 * @param {string} [okStyle]  Style du bouton ('danger' | 'primary' | ...)
 * @returns {Promise<boolean>}
 */
export function confirmAction(title, body, okLabel, okStyle = 'danger') {
  return _getModal().confirm({
    title,
    bodyHTML: body,
    okLabel: okLabel || _lbl('btn_confirm', 'Confirmer'),
    okStyle
  });
}

/**
 * Modal de saisie texte (remplace window.prompt — incompatible Tauri v2).
 * @param {string} title        — Titre de la modal
 * @param {string} [defaultVal] — Valeur pré-remplie
 * @param {string} [okLabel]    — Libellé bouton confirmer (défaut = i18n btn_confirm)
 * @param {string} [cancelLabel] — Libellé bouton annuler (défaut = i18n btn_cancel)
 * @returns {Promise<string|null>} — Valeur saisie, ou null si annulé
 */
export function promptAction(title, defaultVal = '', okLabel, cancelLabel) {
  return _getModal().prompt({
    title,
    defaultValue: defaultVal,
    okLabel: okLabel || _lbl('btn_confirm', 'OK'),
    cancelLabel: cancelLabel || _lbl('btn_cancel', 'Annuler')
  });
}

// ── Ripple ────────────────────────────────────────────────────────────────────

const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc, .tb-icon-btn';

export function initRipple() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target.closest(_RIPPLE_SEL);
      if (!el || el.classList.contains('tr-skel')) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const r = document.createElement('span');
      r.className = 'rpl';
      r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;`;
      el.appendChild(r);
      r.addEventListener('animationend', () => r.remove(), { once: true });
    },
    { passive: true }
  );
}
