// LibreFlow — dom.js
// Shared DOM-narrowing helpers for type-safe getElementById and querySelector access.
// Returns nullable typed references so callers must guard for missing elements
// rather than silently operating on undefined behaviour.

/**
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export function $id(id) {
  return document.getElementById(id);
}

/**
 * @param {string} id
 * @returns {HTMLInputElement | null}
 */
export function $input(id) {
  return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement | null}
 */
export function $select(id) {
  return /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
}

