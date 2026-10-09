// LibreFlow — lf-modal.js
// Web Component Lit : modale générique confirm/prompt.
// Remplace le markup statique #confirm-modal-bg de index.html et la
// construction DOM manuelle de promptAction() dans ui.js.
//
// Contrat :
//   confirm(opts) → Promise<boolean>
//     opts : { title, bodyHTML, okLabel, okStyle }
//   prompt(opts) → Promise<string|null>
//     opts : { title, defaultValue, okLabel, cancelLabel }
//
// A11Y : role=dialog + aria-modal, focus trap interne, Escape = annuler,
// restitution du focus à l'appelant à la fermeture.
import { LitElement, html, css } from 'lit';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export class LfModal extends LitElement {
  static properties = {
    _open: { state: true },
    _mode: { state: true }, // 'confirm' | 'prompt'
    _title: { state: true },
    _bodyHTML: { state: true },
    _okLabel: { state: true },
    _okStyle: { state: true },
    _cancelLabel: { state: true },
    _value: { state: true }
  };

  constructor() {
    super();
    this._open = false;
    this._mode = 'confirm';
    this._title = '';
    this._bodyHTML = '';
    this._okLabel = '';
    this._okStyle = 'danger';
    this._cancelLabel = '';
    this._value = '';
    this._resolve = null;
    this._prevFocus = null;
    this._onKeydown = (e) => {
      if (!this._open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._finish(this._mode === 'prompt' ? null : false);
      } else if (e.key === 'Tab') {
        this._trapTab(e);
      } else if (e.key === 'Enter' && this._mode === 'prompt') {
        const inInput = e.target.tagName === 'INPUT';
        if (inInput) {
          e.preventDefault();
          this._finish(this._value.trim() || null);
        }
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown, true);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown, true);
    this._restoreFocus();
    super.disconnectedCallback();
  }

  _trapTab(e) {
    const els = [...this.renderRoot.querySelectorAll(FOCUSABLE)].filter(
      (el) => !el.disabled && el.offsetParent !== null
    );
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  _finish(result) {
    if (!this._resolve) return;
    const resolve = this._resolve;
    this._resolve = null;
    this._open = false;
    this._restoreFocus();
    resolve(result);
  }

  _restoreFocus() {
    if (this._prevFocus && this._prevFocus.isConnected) {
      this._prevFocus.focus();
    }
    this._prevFocus = null;
  }

  confirm({ title, bodyHTML = '', okLabel = '', okStyle = 'danger' }) {
    return new Promise((resolve) => {
      this._prevFocus = document.activeElement;
      this._mode = 'confirm';
      this._title = title;
      this._bodyHTML = bodyHTML;
      this._okLabel = okLabel;
      this._okStyle = okStyle;
      this._resolve = resolve;
      this._open = true;
      this.requestUpdate();
      this.updateComplete.then(() => {
        const ok = this.renderRoot.querySelector('.ok');
        if (ok) ok.focus();
      });
    });
  }

  prompt({ title, defaultValue = '', okLabel = '', cancelLabel = '' }) {
    return new Promise((resolve) => {
      this._prevFocus = document.activeElement;
      this._mode = 'prompt';
      this._title = title;
      this._bodyHTML = '';
      this._value = defaultValue;
      this._okLabel = okLabel;
      this._cancelLabel = cancelLabel;
      this._resolve = resolve;
      this._open = true;
      this.requestUpdate();
      this.updateComplete.then(() => {
        const input = this.renderRoot.querySelector('input');
        if (input) {
          input.select();
          input.focus();
        }
      });
    });
  }

  _onInput(e) {
    this._value = e.target.value;
  }

  _onBackdrop(e) {
    if (e.target === e.currentTarget) {
      this._finish(this._mode === 'prompt' ? null : false);
    }
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: none;
      align-items: center;
      justify-content: center;
      background: var(--scrim-heavy);
      backdrop-filter: blur(var(--blur-md));
      -webkit-backdrop-filter: blur(var(--blur-md));
      font-family: var(--font, sans-serif);
    }
    :host([open]) {
      display: flex;
    }
    .box {
      background: var(--glass-surface, #1c1c1e);
      border: var(--border-w-sm, 1px) solid var(--border-2, #333);
      border-radius: var(--radius-md, 12px);
      padding: var(--space-6, 24px) var(--space-6, 24px) var(--space-5, 20px);
      max-width: var(--text-sf-max, 380px);
      width: 90vw;
      box-shadow: var(--shadow-xl);
      display: flex;
      flex-direction: column;
      gap: var(--space-3, 12px);
      max-height: calc(100vh - var(--space-6, 24px));
      overflow-y: auto;
    }
    :host([open]) .box {
      animation: modalIn var(--motion-base, 200ms) var(--ease-spring, ease) both;
    }
    @keyframes modalIn {
      from {
        transform: scale(0.95) translateY(8px);
        opacity: 0;
      }
      to {
        transform: none;
        opacity: 1;
      }
    }
    .title {
      font-size: var(--text-md, 17px);
      font-weight: 700;
      letter-spacing: var(--ls-display, 0);
      text-wrap: balance;
      color: var(--t, #eee);
    }
    .body {
      font-size: var(--text-sm, 13px);
      color: var(--t2, #aaa);
      line-height: var(--lh-base, 1.5);
      white-space: pre-line;
    }
    input {
      background: var(--bg3, #222);
      border: var(--border-w-sm, 1px) solid var(--border-2, #333);
      border-radius: var(--radius-sm, 8px);
      padding: var(--space-2, 8px) var(--space-3, 12px);
      color: var(--t, #eee);
      font-size: var(--text-base, 14px);
      outline: none;
      font-family: inherit;
    }
    input:focus {
      border-color: var(--g, #1db954);
    }
    .actions {
      display: flex;
      gap: var(--space-2, 8px);
      justify-content: flex-end;
    }
    button {
      font-family: inherit;
      font-size: var(--text-sm, 13px);
      font-weight: 600;
      border-radius: var(--radius-pill, 999px);
      border: none;
      padding: var(--space-2, 8px) var(--space-4, 16px);
      cursor: pointer;
    }
    .cancel {
      background: transparent;
      color: var(--t2, #aaa);
    }
    .cancel:hover {
      background: var(--bg3, #222);
      color: var(--t, #eee);
    }
    .ok {
      color: #fff;
    }
    .ok.danger {
      background: var(--red, #e5484d);
    }
    .ok.primary {
      background: var(--g, #1db954);
    }
    .ok.danger:hover,
    .ok.primary:hover {
      filter: brightness(1.1);
    }
  `;

  render() {
    if (!this._open) {
      this.removeAttribute('open');
      return html`<div style="display:none" role="dialog" aria-modal="true"></div>`;
    }
    this.setAttribute('open', '');
    return html`
      <div role="dialog" aria-modal="true" aria-label=${this._title} @click=${this._onBackdrop}>
        <div class="box" @click=${(e) => e.stopPropagation()}>
          <div class="title">${this._title}</div>
          ${
            this._mode === 'confirm'
              ? html`<div
                  class="body"
                  @click=${(e) => e.stopPropagation()}
                  .innerHTML=${this._bodyHTML}
                ></div>`
              : html`<input type="text" .value=${this._value} @input=${this._onInput} />`
          }
          <div class="actions">
            <button
              class="cancel"
              @click=${() => this._finish(this._mode === 'prompt' ? null : false)}
            >
              ${this._cancelLabel}
            </button>
            <button
              class="ok ${this._okStyle}"
              @click=${() =>
                this._mode === 'prompt'
                  ? this._finish(this._value.trim() || null)
                  : this._finish(true)}
            >
              ${this._okLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('lf-modal', LfModal);
