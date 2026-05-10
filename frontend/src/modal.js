// LibreFlow — modal.js
// Gestion de la modale générique (#modal-bg) : ouverture, focus trap, fermeture.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// Dépendances :
//   import  : get (store.js)
//
// Exports publics :
//   confirmClear()  — ouvre la modale de confirmation "vider la bibliothèque"
//   closeModal()    — ferme la modale avec animation + restauration focus

import { get } from './store.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _modalPrevFocus = null;
let _modalFocusTrap = null;

const _MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _buildModalFocusTrap(dialogEl) {
  return function (e) {
    if (e.key !== 'Tab') return;
    const els = [...dialogEl.querySelectorAll(_MODAL_FOCUSABLE)]
      .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
}

/**
 * Ouvre la modale de confirmation "Vider la bibliothèque".
 * Ne fait rien si la bibliothèque est déjà vide.
 */
export function confirmClear() {
  if (!get('tracks').length) return;
  _modalPrevFocus = document.activeElement;
  document.getElementById('modal-bg').classList.add('on');
  const modal = document.getElementById('modal');
  if (modal && !_modalFocusTrap) {
    _modalFocusTrap = _buildModalFocusTrap(modal);
    modal.addEventListener('keydown', _modalFocusTrap);
    setTimeout(() => modal.querySelector('.mbtn.cancel')?.focus(), 50);
  }
}

/**
 * Ferme la modale générique (#modal-bg) avec animation CSS,
 * supprime le focus trap et restaure le focus au déclencheur.
 */
export function closeModal() {
  const bg = document.getElementById('modal-bg');
  if (!bg) return; // W9 FIX : guard contre l'absence du DOM element
  bg.classList.add('modal-closing');
  bg.addEventListener('animationend', () => {
    bg.classList.remove('on', 'modal-closing');
  }, { once: true });
  setTimeout(() => bg.classList.remove('on', 'modal-closing'), 250);
  const modal = document.getElementById('modal');
  if (modal && _modalFocusTrap) {
    modal.removeEventListener('keydown', _modalFocusTrap);
    _modalFocusTrap = null;
  }
  _modalPrevFocus?.focus();
  _modalPrevFocus = null;
}
