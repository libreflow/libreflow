// lf-modal.js — Composant modal générique Shadow DOM. Focus trap + GSAP + Escape intégrés.

import { LitElement, html, css } from 'lit'
import { modalReducer }          from './lf-modal.logic.js'
import { modalOpen, modalClose } from '../motion.js'
import { FOCUSABLE_SEL }         from '../modal.js'

export class LfModal extends LitElement {
  static properties = {
    _state: { state: true },
    label:  { type: String }
  }

  static styles = css`
    :host { display: contents; }
    .backdrop {
      display: none; position: fixed; inset: 0;
      background: var(--lf-modal-backdrop, rgba(0,0,0,.55));
      z-index: var(--z-modal, 800);
      align-items: center; justify-content: center;
    }
    .backdrop.on { display: flex; }
    .dialog {
      background: var(--bg2, #1e1e1e);
      border-radius: var(--radius-lg, 12px);
      padding: var(--space-6, 24px);
      min-width: 320px; max-width: 480px;
      box-shadow: var(--elev-4, 0 8px 32px rgba(0,0,0,.5));
    }
  `

  constructor() {
    super()
    this._state = { isOpen: false }
    this.label = ''
    this._prevFocus = null
    this._trapHandler = null
  }

  open() {
    this._prevFocus = document.activeElement
    this._state = modalReducer(this._state, { type: 'open' })
    this.updateComplete.then(() => {
      const dlg = this.shadowRoot?.querySelector('.dialog')
      if (dlg) { modalOpen(dlg); this._installTrap(dlg) }
    })
  }

  close() {
    const dlg = this.shadowRoot?.querySelector('.dialog')
    this._releaseTrap(dlg)
    const doClose = () => {
      this._state = modalReducer(this._state, { type: 'close' })
      this._prevFocus?.focus?.()
      this._prevFocus = null
      this.dispatchEvent(new CustomEvent('lf-modal-close', { bubbles: true, composed: true }))
    }
    if (dlg) modalClose(dlg).then(doClose)
    else doClose()
  }

  _installTrap(dlg) {
    this._trapHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return }
      if (e.key !== 'Tab') return
      const els = [...this.querySelectorAll(FOCUSABLE_SEL)]
        .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    dlg.addEventListener('keydown', this._trapHandler)
    setTimeout(() => this.querySelector(FOCUSABLE_SEL)?.focus(), 0)
  }

  _releaseTrap(dlg) {
    if (dlg && this._trapHandler) {
      dlg.removeEventListener('keydown', this._trapHandler)
      this._trapHandler = null
    }
  }

  _onBackdropClick(e) { if (e.target === e.currentTarget) this.close() }

  render() {
    return html`
      <div class="backdrop ${this._state.isOpen ? 'on' : ''}"
           role="presentation"
           @click=${this._onBackdropClick}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${this.label || undefined}>
          <slot></slot>
        </div>
      </div>
    `
  }
}

customElements.define('lf-modal', LfModal)
