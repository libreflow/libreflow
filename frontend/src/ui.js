// LibreFlow — ui.js
// Utilitaires UI purs : toasts, modal de confirmation.
// Extrait de app.js (Phase 6).
//
// AUCUNE dépendance vers d'autres modules LibreFlow — i18n.js importe toast depuis
// ui.js, donc tout import de i18n.js ici créerait un cycle bidirectionnel.
// Pour les libellés localisés, les appelants passent des chaînes déjà traduites.
//
// Exports publics :
//   toast(msg, type)                                    — notification temporaire
//   toastWithAction(msg, type, label, onAction, dur)    — toast avec bouton undo
//   confirmAction(title, body, okLabel, okStyle)        — modal confirm → Promise<boolean>
//   resolveConfirm(result)                              — résout la modal depuis handlers.js
//   promptAction(title, defaultVal, okLabel, cancelLabel) — saisie texte → Promise<string|null>

// ── Utilitaire sécurité ───────────────────────────────────────────────────

/** Escape HTML special characters including quotes. Use for any user-provided content in HTML attributes or text nodes. */
export function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Lit Web Component delegation ─────────────────────────────────────────
// Phase 0 Lit : les constantes _TOAST_ICONS et _TOAST_DUR vivent désormais
// dans frontend/src/components/lf-toast-stack.{js,logic.js}. ui.js délègue.

import './components/lf-toast-stack.js';

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

// ── Toast ─────────────────────────────────────────────────────────────────

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
    action: { label, onClick: onAction },
  });
  const remove = () => handle.remove();
  remove.update = (newMsg) => handle.update(newMsg);
  return remove;
}

// ── Focus trap ────────────────────────────────────────────────────────────

/**
 * Confine le focus Tab à l'intérieur d'un conteneur modal.
 * @param {HTMLElement} containerEl
 * @returns {Function} Fonction de cleanup pour retirer le listener
 */
function _trapFocus(containerEl) {
  const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const els = [...containerEl.querySelectorAll(focusable)].filter(el => !el.disabled && el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  containerEl.addEventListener('keydown', handler);
  return () => containerEl.removeEventListener('keydown', handler);
}

// ── Confirm modal ─────────────────────────────────────────────────────────

/** Callback interne résolvant la Promise en cours. */
let _confirmResolve = () => {};
/** Cleanup du focus trap de la modal confirm. */
let _confirmTrapCleanup = () => {};

/**
 * Affiche la modal de confirmation et retourne une Promise<boolean>.
 * @param {string} title    Titre de la modal
 * @param {string} body     Corps HTML
 * @param {string} okLabel  Label du bouton de confirmation
 * @param {string} okStyle  Classe CSS du bouton ('danger' | 'primary' | ...)
 * @returns {Promise<boolean>}
 */
export function confirmAction(title, body, okLabel = 'Confirmer', okStyle = 'danger') {
  return new Promise(resolve => {
    const bg    = document.getElementById('confirm-modal-bg');
    const elT   = document.getElementById('confirm-modal-title');
    const elB   = document.getElementById('confirm-modal-body');
    const okBtn = document.getElementById('confirm-modal-ok');
    if (!bg || !elT || !elB || !okBtn) { resolve(false); return; }
    elT.textContent   = title;
    // body is trusted HTML — callers must use esc() for user-provided content
    elB.innerHTML     = body;
    okBtn.textContent = okLabel;
    okBtn.className   = `mbtn ${okStyle}`;
    const _prevFocus  = document.activeElement;
    _confirmResolve = (result) => {
      bg.classList.remove('on');
      _confirmResolve = () => {};
      _confirmTrapCleanup();
      _confirmTrapCleanup = () => {};
      _prevFocus?.focus();
      resolve(result);
    };
    bg.classList.add('on');
    _confirmTrapCleanup = _trapFocus(document.getElementById('confirm-modal'));
    setTimeout(() => okBtn.focus(), 50);
  });
}

/**
 * Résout la modal de confirmation depuis l'extérieur (handlers.js).
 * @param {boolean} result
 */
export function resolveConfirm(result) {
  _confirmResolve(result);
}


/**
 * Modal de saisie texte (remplace window.prompt — incompatible Tauri v2).
 * @param {string} title        — Titre de la modal
 * @param {string} defaultVal   — Valeur pré-remplie
 * @param {string} okLabel      — Libellé bouton confirmer
 * @param {string} cancelLabel  — Libellé bouton annuler (le caller passe i18n('btn_cancel'))
 * @returns {Promise<string|null>} — Valeur saisie, ou null si annulé
 */
export function promptAction(title, defaultVal = '', okLabel = 'OK', cancelLabel = 'Annuler') {
  return new Promise(resolve => {
    const _prevFocus = document.activeElement;
    const bg = document.createElement('div');
    bg.className = 'prompt-bg prompt-modal-bg';
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.innerHTML = `
      <div class="modal prompt-modal">
        <div class="modal-title"></div>
        <input class="prompt-input" type="text" />
        <div class="modal-actions">
          <button class="mbtn secondary prompt-cancel"></button>
          <button class="mbtn primary prompt-ok"></button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const input     = bg.querySelector('.prompt-input');
    const okBtn     = bg.querySelector('.prompt-ok');
    const cancelBtn = bg.querySelector('.prompt-cancel');
    bg.querySelector('.modal-title').textContent = title;
    okBtn.textContent     = okLabel;
    cancelBtn.textContent = cancelLabel;
    input.value = defaultVal;

    const removeTrap = _trapFocus(bg);
    const finish = (val) => {
      removeTrap();
      bg.remove();
      _prevFocus?.focus();
      resolve(val);
    };

    okBtn.addEventListener('click', () => finish(input.value.trim() || null));
    cancelBtn.addEventListener('click', () => finish(null));
    bg.addEventListener('click', e => { if (e.target === bg) finish(null); });
    input.addEventListener('keydown', e => {
      if (e.code === 'Enter')  { e.preventDefault(); finish(input.value.trim() || null); }
      if (e.code === 'Escape') { e.preventDefault(); finish(null); }
    });

    // Afficher + focus
    requestAnimationFrame(() => {
      bg.classList.add('on');
      input.select();
      input.focus();
    });
  });
}

// Fermer avec Échap
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.getElementById('confirm-modal-bg')?.classList.contains('on')) {
    e.stopImmediatePropagation();
    _confirmResolve(false);
  }
});

// ── Ripple ────────────────────────────────────────────────────────────────

const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc, .tb-icon-btn, .pl-card, .sb-item';

export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(_RIPPLE_SEL);
    if (!el || el.classList.contains('tr-skel')) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const r = document.createElement('span');
    r.className = 'rpl';
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;`;
    el.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  }, { passive: true });
}
