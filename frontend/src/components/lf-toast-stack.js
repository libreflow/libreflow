// LibreFlow — lf-toast-stack.js
// Web Component Lit : pile de notifications éphémères.
// Préserve le contrat de l'ancien ui.js#toast() / toastWithAction() :
// - 5 types (info, success, error, warning, loading)
// - Durées par type (TOAST_DUR)
// - A11Y : role=alert + aria-live=assertive pour error/warning ;
//          aria-live=polite (sur :host) sinon
// - Cap MAX_TOASTS = 5
// - Click sur le toast → dismiss
// - Bouton close × pour error/warning
// - Progress bar linéaire qui se vide
// - Méthode push(...) retourne un handle { remove, update } (= ancien remove + remove.update)

import { LitElement, html, css } from 'lit';
import { toastReducer, resolveDuration, normalizeType } from './lf-toast-stack.logic.js';

const MAX_TOASTS = 5;

const _TOAST_ICONS = {
  info:    html`<svg viewBox="0 0 10 10" fill="#fff" width="9" height="9"><circle cx="5" cy="3" r="1"/><rect x="4.2" y="4.8" width="1.6" height="3.2" rx=".8"/></svg>`,
  success: html`<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" width="9" height="9"><polyline points="2,5.5 4,7.5 8,3"/></svg>`,
  error:   html`<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" width="9" height="9"><line x1="2.5" y1="2.5" x2="7.5" y2="7.5"/><line x1="7.5" y1="2.5" x2="2.5" y2="7.5"/></svg>`,
  warning: html`<svg viewBox="0 0 10 10" fill="#fff" width="9" height="9"><path d="M5 1.5L9 8.5H1Z" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="4.3" y="4" width="1.4" height="2.5" rx=".7"/><circle cx="5" cy="7.3" r=".65"/></svg>`,
  loading: html`<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" width="9" height="9"><path d="M5 1.5A3.5 3.5 0 1 1 1.7 3.7"/></svg>`,
};

export class LfToastStack extends LitElement {
  static properties = {
    _items: { state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, system-ui, sans-serif);
    }
    .t-item {
      pointer-events: auto;
      position: relative;
      color: var(--lf-toast-fg, #fff);
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .3);
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 220px;
      overflow: hidden;
      animation: t-in 150ms ease-out;
      cursor: pointer;
    }
    .t-item.t-out { animation: t-out 200ms ease-in forwards; }
    .t-info    { background: var(--lf-toast-bg-info,    #222); }
    .t-success { background: var(--lf-toast-bg-success, #2a7); }
    .t-error   { background: var(--lf-toast-bg-error,   #a33); }
    .t-warning { background: var(--lf-toast-bg-warning, #c80); }
    .t-loading { background: var(--lf-toast-bg-loading, #46a); }
    .t-icon { flex: 0 0 auto; display: flex; align-items: center; }
    .t-msg  { flex: 1 1 auto; }
    .t-action {
      flex: 0 0 auto;
      background: rgba(255,255,255,.18);
      border: none;
      color: inherit;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }
    .t-close {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: inherit;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
    }
    .t-bar {
      position: absolute;
      left: 0; bottom: 0;
      height: 2px;
      width: 100%;
      transform-origin: left center;
      background: rgba(255,255,255,.4);
    }
    @keyframes t-in  { from { transform: translateX(20px); opacity: 0; } }
    @keyframes t-out { to   { transform: translateX(20px); opacity: 0; } }
  `;

  constructor() {
    super();
    /** @type {Array<{ id: number, message: string, type: string, duration: number,
     *                 action?: { label: string, onClick: Function },
     *                 closable: boolean }>} */
    this._items = [];
    this._timers = new Map();  // id → setTimeout handle (jamais sérialisé)
  }

  /**
   * API publique appelée par ui.js façade.
   * @param {Object} opts
   * @param {string} opts.message
   * @param {string} [opts.type='info']
   * @param {number} [opts.duration]                — override la durée par type
   * @param {{label: string, onClick: Function}} [opts.action]
   * @returns {{ remove: Function, update: Function }} handle
   */
  push(opts) {
    const type = normalizeType(opts.type);
    const id = ++LfToastStack._seq;
    const closable = (type === 'error' || type === 'warning');
    const duration = resolveDuration(type, opts.duration);

    const item = {
      id,
      message: String(opts.message ?? ''),
      type,
      duration,
      action: opts.action || null,
      closable,
    };

    this._items = toastReducer(this._items, { type: 'add', item, max: MAX_TOASTS });

    if (duration > 0 && duration < Infinity) {
      const handle = setTimeout(() => this._dismiss(id), duration);
      this._timers.set(id, handle);
    }

    return {
      remove: () => this._dismiss(id),
      update: (newMsg) => this._update(id, newMsg),
    };
  }

  _dismiss(id) {
    const t = this._timers.get(id);
    if (t) { clearTimeout(t); this._timers.delete(id); }
    this._items = toastReducer(this._items, { type: 'dismiss', id });
    this.dispatchEvent(new CustomEvent('lf-toast-dismiss', {
      detail: { id }, bubbles: true, composed: true,
    }));
  }

  _update(id, message) {
    this._items = toastReducer(this._items, { type: 'update', id, message: String(message ?? '') });
  }

  _onItemClick(id) {
    this._dismiss(id);
  }

  _onCloseClick(ev, id) {
    ev.stopPropagation();
    this._dismiss(id);
  }

  _onActionClick(ev, id, onClick) {
    ev.stopPropagation();
    try { typeof onClick === 'function' && onClick(); }
    finally { this._dismiss(id); }
    this.dispatchEvent(new CustomEvent('lf-toast-action', {
      detail: { id }, bubbles: true, composed: true,
    }));
  }

  render() {
    return html`
      ${this._items.map(t => html`
        <div
          class="t-item t-${t.type}"
          role=${t.closable ? 'alert' : 'status'}
          aria-live=${t.closable ? 'assertive' : 'polite'}
          @click=${() => this._onItemClick(t.id)}
        >
          <span class="t-icon" aria-hidden="true">${_TOAST_ICONS[t.type] ?? _TOAST_ICONS.info}</span>
          <span class="t-msg">${t.message}</span>
          ${t.action ? html`
            <button class="t-action"
                    @click=${(ev) => this._onActionClick(ev, t.id, t.action.onClick)}>
              ${t.action.label}
            </button>
          ` : null}
          ${t.closable ? html`
            <button class="t-close" aria-label="Fermer"
                    @click=${(ev) => this._onCloseClick(ev, t.id)}>×</button>
          ` : null}
          <span class="t-bar" aria-hidden="true"
                style="transition: transform ${t.duration}ms linear; transform: scaleX(0);">
          </span>
        </div>
      `)}
    `;
  }
}
LfToastStack._seq = 0;
customElements.define('lf-toast-stack', LfToastStack);
