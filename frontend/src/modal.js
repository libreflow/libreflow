// LibreFlow — modal.js
// Gestion de la modale générique (#modal-bg) : ouverture, focus trap, fermeture.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// A11Y-SERIOUS (audit 2026-05-19) : exposition de trapFocus()/releaseFocus()
// pour que TOUS les `[role="dialog"]` puissent installer le même trap (et pas
// uniquement #modal). Couvre confirm, organize, USB, CD, batch-tag, smart-pl,
// playlist, et settings.
//
// Exports publics :
//   confirmClear()              — ouvre la modale "vider la bibliothèque"
//   closeModal()                — ferme la modale avec animation + restaure focus
//   trapFocus(dialogEl, opts)   — installe un trap Tab+Shift+Tab dans dialogEl
//   releaseFocus(dialogEl)      — retire le trap et restaure le focus

import { get } from './store.js';

// ── État interne ──────────────────────────────────────────────────────────────
let _modalPrevFocus = null;
let _modalFocusTrap = null;

// Map dialog element → { handler, prevFocus } — un trap par dialogue ouvert.
// Permet d'avoir plusieurs `[role="dialog"]` simultanés sans collision
// (rare en pratique mais possible : confirm sur une modal ouverte).
/** @type {WeakMap<HTMLElement, { handler: (e: KeyboardEvent) => void, prevFocus: HTMLElement|null }>} */
const _trapRegistry = new WeakMap();

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
 * Installe un focus trap sur n'importe quel `[role="dialog"]` ouvert.
 * - Sauvegarde l'élément focusé avant ouverture (restauré dans releaseFocus).
 * - Si déjà installé sur le même dialogEl, no-op (idempotent).
 * - `opts.initialFocus` (optionnel) : sélecteur CSS pour le 1er élément à focuser.
 *
 * @param {HTMLElement} dialogEl
 * @param {{ initialFocus?: string }} [opts]
 */
export function trapFocus(dialogEl, opts = {}) {
  if (!dialogEl || _trapRegistry.has(dialogEl)) return;
  const prevFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  const handler   = _buildModalFocusTrap(dialogEl);
  dialogEl.addEventListener('keydown', handler);
  _trapRegistry.set(dialogEl, { handler, prevFocus });
  // Focus initial — un microtask delay évite que l'ouverture par clic vole le focus immédiatement.
  setTimeout(() => {
    const target = opts.initialFocus
      ? dialogEl.querySelector(opts.initialFocus)
      : dialogEl.querySelector(_MODAL_FOCUSABLE);
    /** @type {HTMLElement|null} */ (target)?.focus();
  }, 0);
}

/**
 * Retire le focus trap d'un dialog et restaure le focus à l'élément initial.
 * No-op si aucun trap n'était installé.
 *
 * @param {HTMLElement} dialogEl
 */
export function releaseFocus(dialogEl) {
  if (!dialogEl) return;
  const entry = _trapRegistry.get(dialogEl);
  if (!entry) return;
  dialogEl.removeEventListener('keydown', entry.handler);
  _trapRegistry.delete(dialogEl);
  entry.prevFocus?.focus?.();
}

// ── Global trap installer ────────────────────────────────────────────────────
//
// Observe l'attribut `class` de tous les `[id$="modal-bg"]` connus et installe
// automatiquement le focus trap sur le `[role="dialog"]` enfant quand la classe
// `.on` est ajoutée — le retire quand elle disparaît. Couvre confirm, organize,
// USB, CD, batch-tag, smart-pl, playlist, settings sans toucher à chaque module.
// La modale principale #modal continue d'utiliser confirmClear()/closeModal()
// pour préserver le comportement existant (sauvegarde locale du prev focus).
let _autoTrapInstalled = false;

/** Initialise l'observateur global. Idempotent — appelé une fois au boot. */
export function installAutoFocusTrap() {
  if (_autoTrapInstalled) return;
  _autoTrapInstalled = true;
  // Cibles auto-wirées (TOUS sauf #modal-bg qui garde son ancien path explicite).
  // `shortcuts-panel` est inclus : le panel lui-même porte `role="dialog"` (pas de wrapper).
  const autoIds = [
    'confirm-modal-bg', 'organize-modal-bg', 'usb-modal-bg', 'cd-modal-bg',
    'pl-modal-bg',      'batch-tag-modal-bg', 'smart-pl-modal-bg',
    'shortcuts-panel',
    // A11Y-14 : sleep-menu se déclare role=dialog aria-modal — il porte le rôle
    // lui-même (comme shortcuts-panel) et bascule `.on`. La fermeture clavier
    // (Escape) est gérée dans shortcuts.js pour éviter un piège au clavier.
    'sleep-menu',
  ];
  for (const id of autoIds) {
    const bg = document.getElementById(id);
    if (!bg) continue;
    // Le dialog est soit un descendant `[role="dialog"]`, soit le wrapper lui-même
    // (cas shortcuts-panel : pas de structure bg→dialog imbriquée).
    const dialog = /** @type {HTMLElement|null} */ (
      bg.matches('[role="dialog"]') ? bg : bg.querySelector('[role="dialog"]')
    );
    if (!dialog) continue;
    const obs = new MutationObserver(() => {
      if (bg.classList.contains('on')) trapFocus(dialog);
      else                              releaseFocus(dialog);
    });
    obs.observe(bg, { attributes: true, attributeFilter: ['class'] });
  }
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
  if (!modal) return;
  // Toujours nettoyer un trap résiduel avant d'en installer un nouveau (anti-leak).
  if (_modalFocusTrap) {
    modal.removeEventListener('keydown', _modalFocusTrap);
    _modalFocusTrap = null;
  }
  _modalFocusTrap = _buildModalFocusTrap(modal);
  modal.addEventListener('keydown', _modalFocusTrap);
  setTimeout(() => modal.querySelector('.mbtn.cancel')?.focus(), 50);
}

/**
 * Ferme la modale générique (#modal-bg) avec animation CSS,
 * supprime le focus trap et restaure le focus au déclencheur.
 */
export function closeModal() {
  const bg = document.getElementById('modal-bg');
  if (!bg) return; // W9 FIX : guard contre l'absence du DOM element
  bg.classList.add('modal-closing');
  // L-07 : flag _closeHandled — animationend + setTimeout sont tous deux idempotents
  // (aligné sur le pattern de settings.js closeSettings) : la première exécution gagne.
  let _closeHandled = false;
  const _onClose = () => {
    if (_closeHandled) return;
    _closeHandled = true;
    bg.classList.remove('on', 'modal-closing');
  };
  bg.addEventListener('animationend', _onClose, { once: true });
  setTimeout(_onClose, 250); // fallback si animationend ne se déclenche jamais
  const modal = document.getElementById('modal');
  if (modal && _modalFocusTrap) {
    modal.removeEventListener('keydown', _modalFocusTrap);
    _modalFocusTrap = null;
  }
  _modalPrevFocus?.focus();
  _modalPrevFocus = null;
}
