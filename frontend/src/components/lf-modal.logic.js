// lf-modal.logic.js — reducer pur pour <lf-modal>. Zéro import Lit.

/**
 * @typedef {{ isOpen: boolean }} ModalState
 * @param {ModalState} state
 * @param {{ type: 'open' | 'close' }} action
 * @returns {ModalState}
 */
export function modalReducer(state, action) {
  switch (action.type) {
    case 'open':  return { ...state, isOpen: true }
    case 'close': return { ...state, isOpen: false }
    default:      return state
  }
}
