// LibreFlow — lf-toast-stack.logic.js
// Module logique pur du Web Component <lf-toast-stack>.
// Aucun import Lit, aucune référence DOM — testable directement en CJS.
//
// Exports :
//   TOAST_DUR        — durées par défaut par type (ms)
//   TOAST_TYPES      — liste des types valides
//   toastReducer     — (items, action) → items'
//   normalizeType    — type|undefined → type valide (fallback 'info')
//   resolveDuration  — (typeOrItem, explicitDur?) → durée résolue (ms)

'use strict';

// Durées par défaut alignées avec l'ancien _TOAST_DUR de ui.js (préservation contrat)
export const TOAST_DUR = Object.freeze({
  info:    3000,
  success: 2600,
  error:   8000,
  warning: 6000,
  loading: 120000,
});

export const TOAST_TYPES = Object.freeze(['info', 'success', 'error', 'warning', 'loading']);

export function normalizeType(t) {
  return TOAST_TYPES.includes(t) ? t : 'info';
}

/**
 * @param {string} type
 * @param {number} [explicitDur] — only used if a strictly positive number.
 *        0 and negative values fall back to the type default duration.
 * @param {string} [message] — A11Y-13 (SC 2.2.1) : si fourni, la durée s'étire
 *        avec la longueur du message (~15 car./s de lecture + 1,5 s de marge),
 *        sans jamais descendre sous la base du type. Un explicitDur > 0 gagne.
 */
export function resolveDuration(type, explicitDur, message) {
  if (typeof explicitDur === 'number' && explicitDur > 0) return explicitDur;
  const base = TOAST_DUR[normalizeType(type)];
  if (!message) return base;
  const required = Math.ceil(String(message).length / 15) * 1000 + 1500;
  return Math.max(base, required);
}

/**
 * Reducer pur de la pile de toasts.
 * @param {Array} items   pile courante (immutable, jamais mutée)
 * @param {Object} action { type, ... }
 * @returns {Array} nouvelle pile
 *
 * Actions supportées :
 *   - { type: 'add',             item: {...} }        → empile
 *   - { type: 'add',             item: {...}, max: N } → empile en respectant cap N (drop oldest)
 *   - { type: 'update',          id, message }        → modifie le message du toast id (no-op si absent)
 *   - { type: 'mark-dismissing', id }                 → active l'animation de sortie (phase 1 dismiss)
 *   - { type: 'dismiss',         id }                 → retire définitivement (phase 2 dismiss / no-op si absent)
 *   - autre                                           → renvoie items inchangé
 */
export function toastReducer(items, action) {
  switch (action && action.type) {
    case 'add': {
      const next = [...items, action.item];
      if (typeof action.max === 'number' && next.length > action.max) {
        return next.slice(next.length - action.max);
      }
      return next;
    }
    case 'update': {
      let touched = false;
      const next = items.map(t => {
        if (t.id === action.id) {
          touched = true;
          return { ...t, message: action.message };
        }
        return t;
      });
      return touched ? next : items;
    }
    case 'mark-dismissing': {
      let touched = false;
      const next = items.map(t => {
        if (t.id === action.id && !t.dismissing) {
          touched = true;
          return { ...t, dismissing: true };
        }
        return t;
      });
      return touched ? next : items;
    }
    case 'dismiss': {
      const next = items.filter(t => t.id !== action.id);
      return next.length === items.length ? items : next;
    }
    default:
      return items;
  }
}
