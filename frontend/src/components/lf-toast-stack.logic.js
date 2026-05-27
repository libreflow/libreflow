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

export function resolveDuration(type, explicitDur) {
  if (typeof explicitDur === 'number' && explicitDur > 0) return explicitDur;
  return TOAST_DUR[normalizeType(type)];
}

/**
 * Reducer pur de la pile de toasts.
 * @param {Array} items   pile courante (immutable, jamais mutée)
 * @param {Object} action { type, ... }
 * @returns {Array} nouvelle pile
 *
 * Actions supportées :
 *   - { type: 'add',     item: {...} }        → empile
 *   - { type: 'add',     item: {...}, max: N } → empile en respectant cap N (drop oldest)
 *   - { type: 'update',  id, message }        → modifie le message du toast id (no-op si absent)
 *   - { type: 'dismiss', id }                 → retire (no-op si absent)
 *   - autre                                   → renvoie items inchangé
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
    case 'dismiss': {
      const next = items.filter(t => t.id !== action.id);
      return next.length === items.length ? items : next;
    }
    default:
      return items;
  }
}
