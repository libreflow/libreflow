// LibreFlow — view-transition.js
// Cross-fade entre vues (library → playlist → settings → …).
// Posé en classe sur le conteneur principal ; CSS gère l'animation.
//
// API : runViewTransition() — appelle juste avant un changement de vue.

const MAIN_SELECTOR = '#main';
const CLASS = 'view-fade';
const DUR_MS = 200;

/**
 * Trigger a cross-fade on the main view container.
 * Idempotent : two rapid calls coalesce on the latest.
 */
export function runViewTransition() {
  const el = document.querySelector(MAIN_SELECTOR);
  if (!el) return;
  el.classList.remove(CLASS);
  // Force reflow so the class can be re-applied.
  void el.offsetWidth;
  el.classList.add(CLASS);
  // Auto-clean ; if a new call lands sooner it preempts.
  setTimeout(() => el.classList.remove(CLASS), DUR_MS + 50);
}
