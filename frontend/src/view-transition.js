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

const WIPE_ID = 'nav-eq-wipe';
const WIPE_CLASS = 'wiping';
// 7 bars, max animation-delay 84ms (nth-child(7)) + eq-wipe duration (--motion-base,
// 200ms) = 284ms until the last bar finishes; 320ms leaves a safety margin so cleanup
// never truncates the animation.
const WIPE_DUR_MS = 320;

/**
 * Trigger the equalizer-wave accent on a main-nav transition. No-op under
 * reduced motion (CSS also collapses the animation, but skip the class churn).
 * Idempotent : rapid repeated calls restart the wave from a clean state.
 */
export function triggerNavWipe() {
  if (document.documentElement.dataset.motion === 'reduce') return;
  const el = document.getElementById(WIPE_ID);
  if (!el) return;
  el.classList.remove(WIPE_CLASS);
  void el.offsetWidth; // force reflow, mirrors runViewTransition()'s pattern above
  el.classList.add(WIPE_CLASS);
  setTimeout(() => el.classList.remove(WIPE_CLASS), WIPE_DUR_MS);
}
