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

/**
 * Configure un focus trap sur un conteneur. Retourne une fonction d'arrêt.
 */
export function trapFocusIn(container) {
  if (!container) return () => {};
  const lastFocused = document.activeElement;
  const focusables = () => container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const onKey = (e) => {
    if (e.key === 'Escape') {
      const closeBtn = container.querySelector('[data-action="close"], .modal-close');
      if (closeBtn) closeBtn.click();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    const list = focusables();
    if (list.length) list[0].focus();
  });
  return function release() {
    document.removeEventListener('keydown', onKey);
    if (lastFocused && document.contains(lastFocused) && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };
}
