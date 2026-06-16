// LibreFlow — a11y.js
// Helpers a11y purement DOM. Aucun IPC, IDB ou audio.

let _live = null;
function _ensureLiveRegion() {
  if (_live && document.contains(_live)) return _live;
  _live = document.createElement('div');
  _live.id = 'a11y-live';
  _live.setAttribute('aria-live', 'polite');
  _live.setAttribute('aria-atomic', 'true');
  _live.className = 'sr-only';
  document.body.appendChild(_live);
  return _live;
}

/**
 * Annonce un message dans une live region masquée visuellement.
 * @param {string} text
 * @param {'polite'|'assertive'} [priority='polite']
 */
export function liveAnnounce(text, priority = 'polite') {
  if (!text) return;
  const el = _ensureLiveRegion();
  if (el.getAttribute('aria-live') !== priority) {
    el.setAttribute('aria-live', priority);
  }
  el.textContent = '';
  Promise.resolve().then(() => { el.textContent = String(text); });
}

/**
 * Assigne aria-valuetext sur l'élément `el` à la valeur formattée par `fmt(val)`.
 */
export function setAriaValueText(el, fmt, val) {
  if (!el || typeof fmt !== 'function') return;
  el.setAttribute('aria-valuetext', fmt(val));
}

