// LibreFlow — a11y.js
// Helpers a11y purement DOM. Aucun IPC, IDB ou audio.

/**
 * Assigne aria-valuetext sur l'élément `el` à la valeur formattée par `fmt(val)`.
 */
export function setAriaValueText(el, fmt, val) {
  if (!el || typeof fmt !== 'function') return;
  el.setAttribute('aria-valuetext', fmt(val));
}
