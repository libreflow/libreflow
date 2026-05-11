// LibreFlow — dom.js
// Shared DOM-narrowing helpers for type-safe getElementById and querySelector access.
// Returns typed references so checkJs does not complain about property access on
// HTMLElement | null without needing per-site @ts-ignore.

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function $id(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
export function $input(id) {
  return /** @type {HTMLInputElement} */ (document.getElementById(id));
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
export function $select(id) {
  return /** @type {HTMLSelectElement} */ (document.getElementById(id));
}

/**
 * @param {string} id
 * @returns {HTMLTextAreaElement}
 */
export function $textarea(id) {
  return /** @type {HTMLTextAreaElement} */ (document.getElementById(id));
}

/**
 * @param {HTMLElement | Document} root
 * @param {string} selector
 * @returns {HTMLElement}
 */
export function $qs(root, selector) {
  return /** @type {HTMLElement} */ (root.querySelector(selector));
}

/**
 * @param {HTMLElement | Document} root
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
export function $qsInput(root, selector) {
  return /** @type {HTMLInputElement} */ (root.querySelector(selector));
}
