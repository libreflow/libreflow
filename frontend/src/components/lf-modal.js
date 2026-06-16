// lf-modal.js — Composant modal générique Shadow DOM. Focus trap + GSAP + Escape intégrés.

import { LitElement, html, css, nothing } from 'lit'
import { modalReducer }          from './lf-modal.logic.js'
import { modalOpen, modalClose } from '../motion.js'
// LIT-COMPONENTS-4: inlined to avoid §6 feature-module import dependency.
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export class LfModal extends LitElement {
  static properties = {
    _state:      { state: true },
    label:       { type: String },
    labelledby:  { type: String }
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
    this.labelledby = ''
    this._prevFocus = null
    this._trapHandler = null
    this._closing = false   // LIT-COMPONENTS-2: idempotency guard
  }

  connectedCallback() {
    super.connectedCallback()
    if (!this.label && !this.labelledby) {
      console.warn('[lf-modal] No accessible name: supply label="" or labelledby="heading-id"')
    }
  }

  open() {
    this._prevFocus = document.activeElement
    this._state = modalReducer(this._state, { type: 'open' })
    this.updateComplete
      .then(() => { const dlg = this.shadowRoot?.querySelector('.dialog'); if (dlg) { modalOpen(dlg); this._installTrap(dlg); } })
      .catch(err => console.warn('[lf-modal] open update failed', err));
  }

  close() {
    if (this._closing) return;  // LIT-COMPONENTS-2: idempotency guard
    this._closing = true;
    const dlg = this.shadowRoot?.querySelector('.dialog')
    this._releaseTrap(dlg)
    const doClose = () => {
      this._closing = false;
      this._state = modalReducer(this._state, { type: 'close' })
      this._prevFocus?.focus?.()
      this._prevFocus = null
      this.dispatchEvent(new CustomEvent('lf-modal-close', { bubbles: true, composed: true }))
    }
    if (dlg) modalClose(dlg).then(doClose).catch(err => { console.warn('[lf-modal] close animation failed', err); doClose(); })
    else doClose()
  }

  _installTrap(dlg) {
    this._trapHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return }
      if (e.key !== 'Tab') return
      // LIT-COMPONENTS-3: query both shadow DOM (dlg) and light DOM (slot children).
      const els = [
        ...(dlg?.querySelectorAll(FOCUSABLE_SEL) || []),
        ...this.querySelectorAll(FOCUSABLE_SEL)
      ].filter(el => el.offsetWidth > 0 || el.offsetHeight > 0)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      const active = e.composedPath()[0]
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    // LIT-COMPONENTS-7: listen on `this` (shadow host) instead of `dlg` so slotted
    // light-DOM elements have their Tab/Escape events captured — keydown from a slotted
    // child bubbles up to the host but does NOT enter the shadow tree (so dlg.addEventListener
    // was silently missing every keydown from the actual modal content).
    this.addEventListener('keydown', this._trapHandler)
    setTimeout(() => this.querySelector(FOCUSABLE_SEL)?.focus(), 0)
  }

  _releaseTrap(_dlg) {
    if (this._trapHandler) {
      this.removeEventListener('keydown', this._trapHandler)
      this._trapHandler = null
    }
  }

  _onBackdropClick(e) { if (e.target === e.currentTarget) this.close() }

  render() {
    return html`
      <div class="backdrop ${this._state.isOpen ? 'on' : ''}"
           role="presentation"
           @click=${this._onBackdropClick}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${this.label || nothing} aria-labelledby=${this.labelledby || nothing}>
          <slot></slot>
        </div>
      </div>
    `
  }
}

customElements.define('lf-modal', LfModal)
