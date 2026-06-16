// LibreFlow — modal.js
// Gestion des focus traps pour les modales : ouverture, focus trap, fermeture.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// A11Y-SERIOUS (audit 2026-05-19) : exposition de trapFocus()/releaseFocus()
// pour que TOUS les `[role="dialog"]` puissent installer le même trap (et pas
// uniquement #modal). Couvre confirm, organize, USB, CD, batch-tag, smart-pl,
// playlist, et settings.
//
// Exports publics :
//   confirmClear()              — ouvre la modale "vider la bibliothèque" (<lf-modal>)
//   closeModal()                — ferme la modale (<lf-modal>)
//   trapFocus(dialogEl, opts)   — installe un trap Tab+Shift+Tab dans dialogEl
//   releaseFocus(dialogEl)      — retire le trap et restaure le focus

import { get } from './store.js';

// Map dialog element → { handler, prevFocus } — un trap par dialogue ouvert.
// Permet d'avoir plusieurs `[role="dialog"]` simultanés sans collision
// (rare en pratique mais possible : confirm sur une modal ouverte).
/** @type {WeakMap<HTMLElement, { handler: (e: KeyboardEvent) => void, prevFocus: HTMLElement|null }>} */
const _trapRegistry = new WeakMap();

export const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const handler = function (e) {
    if (e.key !== 'Tab') return;
    const els = [...dialogEl.querySelectorAll(FOCUSABLE_SEL)]
      .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  dialogEl.addEventListener('keydown', handler);
  _trapRegistry.set(dialogEl, { handler, prevFocus });
  // Focus initial — un microtask delay évite que l'ouverture par clic vole le focus immédiatement.
  setTimeout(() => {
    const target = opts.initialFocus
      ? dialogEl.querySelector(opts.initialFocus)
      : dialogEl.querySelector(FOCUSABLE_SEL);
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
// La modale "vider la bibliothèque" utilise désormais <lf-modal id="clear-modal">
// qui gère le focus trap en interne.
let _autoTrapInstalled = false;
const _autoTrapObservers = [];

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
      // `.on` pour les backdrops modaux et sleep-menu ; `.open` pour
      // shortcuts-panel (settings.js bascule `.open`, le CSS en dépend).
      if (bg.classList.contains('on') || bg.classList.contains('open')) trapFocus(dialog);
      else                                                              releaseFocus(dialog);
    });
    obs.observe(bg, { attributes: true, attributeFilter: ['class'] });
    _autoTrapObservers.push(obs);
  }
}

/** Déconnecte tous les observateurs auto-trap. Utile pour les tests ou teardown. */
export function uninstallAutoFocusTrap() {
  _autoTrapObservers.forEach(o => o.disconnect());
  _autoTrapObservers.length = 0;
  _autoTrapInstalled = false;
}

/**
 * Ouvre la modale de confirmation "Vider la bibliothèque".
 * Ne fait rien si la bibliothèque est déjà vide.
 */
export function confirmClear() {
  if (!get('tracks').length) return;
  /** @type {any} */ (document.getElementById('clear-modal'))?.open();
}

/**
 * Ferme la modale <lf-modal id="clear-modal">.
 */
export function closeModal() {
  /** @type {any} */ (document.getElementById('clear-modal'))?.close();
}
