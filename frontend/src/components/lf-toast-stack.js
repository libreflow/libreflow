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
  info:    html`<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm1.25 8.75h-2.5v-5h2.5v5z"/></svg>`,
  success: html`<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1.2 11.4L5.4 10l1.2-1.2 2.2 2.2 4.6-4.6 1.2 1.2-5.8 5.8z"/></svg>`,
  error:   html`<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm3.5 11.3-1.2 1.2L10 12.2l-2.3 2.3-1.2-1.2L8.8 11 6.5 8.7l1.2-1.2L10 9.8l2.3-2.3 1.2 1.2L11.2 11l2.3 2.3z"/></svg>`,
  warning: html`<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M10 2 1 18h18L10 2zm0 5a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm0 8.4a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z"/></svg>`,
  loading: html`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="20" height="20" aria-hidden="true"><path d="M10 2.5A7.5 7.5 0 1 1 3.2 6.8"><animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.9s" repeatCount="indefinite"/></path></svg>`,
};

export class LfToastStack extends LitElement {
  static _seq = 0;

  static properties = {
    _items: { state: true },
  };

  static styles = css`
    /* Google Material Snackbar look — single dark slab, accent via icon + thin progress bar. */
    :host {
      position: fixed;
      bottom: calc(var(--pb, 96px) + 16px);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column-reverse;
      align-items: center;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: var(--lf-font-ui, 'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif);
    }
    .t-item {
      pointer-events: auto;
      position: relative;
      background: var(--lf-toast-bg, rgba(45, 46, 48, 0.92));
      backdrop-filter: blur(12px) saturate(1.2);
      -webkit-backdrop-filter: blur(12px) saturate(1.2);
      color: var(--lf-toast-fg, rgba(255, 255, 255, .92));
      padding: 14px 16px;
      border-radius: 4px;
      box-shadow:
        0 6px 10px rgba(0, 0, 0, .14),
        0 1px 18px rgba(0, 0, 0, .12),
        0 3px 5px rgba(0, 0, 0, .20);
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 288px;
      max-width: 568px;
      font-size: 14px;
      line-height: 20px;
      letter-spacing: .01786em;
      overflow: hidden;
      animation: t-in 200ms cubic-bezier(.4, 0, .2, 1);
      cursor: pointer;
    }
    .t-item.t-out { animation: t-out 150ms cubic-bezier(.4, 0, 1, 1) forwards; }

    /* Per-type accent — applied to the icon glyph and the thin bottom bar only. */
    .t-info    { --lf-toast-accent: var(--lf-toast-bg-info,    #8ab4f8); }
    .t-success { --lf-toast-accent: var(--lf-toast-bg-success, #81c995); }
    .t-error   { --lf-toast-accent: var(--lf-toast-bg-error,   #f28b82); }
    .t-warning { --lf-toast-accent: var(--lf-toast-bg-warning, #fdd663); }
    .t-loading { --lf-toast-accent: var(--lf-toast-bg-loading, #8ab4f8); }

    .t-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--lf-toast-accent);
    }
    .t-msg  { flex: 1 1 auto; }

    .t-action {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: var(--lf-toast-action, var(--lf-toast-accent, #8ab4f8));
      padding: 6px 8px;
      margin: -4px -4px -4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: .0892857em;
    }
    .t-action:hover { background: rgba(255, 255, 255, .08); }

    .t-close {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, .6);
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .t-close:hover { color: rgba(255, 255, 255, .92); background: rgba(255, 255, 255, .08); }

    .t-bar {
      position: absolute;
      left: 0; bottom: 0;
      height: 2px;
      width: 100%;
      transform-origin: left center;
      background: var(--lf-toast-accent, rgba(255, 255, 255, .4));
      opacity: .85;
      transform: scaleX(1);
    }

    @keyframes t-in  { from { transform: translateY(20px); opacity: 0; } }
    @keyframes t-out { to   { transform: translateY(20px); opacity: 0; } }

    :host-context(html[data-mode="light"]) .t-item {
      background: var(--lf-toast-bg, rgba(255, 255, 255, 0.92));
      color: var(--lf-toast-fg, rgba(15, 17, 23, 0.92));
      box-shadow:
        0 6px 10px rgba(0, 0, 0, .10),
        0 1px 18px rgba(0, 0, 0, .08),
        0 3px 5px rgba(0, 0, 0, .14);
    }
    :host-context(html[data-mode="light"]) .t-action {
      color: var(--lf-toast-action, var(--lf-toast-accent, #2563eb));
    }
    :host-context(html[data-mode="light"]) .t-close {
      color: rgba(15, 17, 23, 0.6);
    }
    :host-context(html[data-mode="light"]) .t-close:hover {
      color: rgba(15, 17, 23, 0.92);
      background: rgba(0, 0, 0, 0.06);
    }
  `;

  constructor() {
    super();
    /** @type {Array<{ id: number, message: string, type: string, duration: number,
     *                 action?: { label: string, onClick: Function },
     *                 closable: boolean, dismissing: boolean }>} */
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
      dismissing: false,
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

  /**
   * Two-phase dismiss: mark item as dismissing (triggers t-out animation),
   * then finalize removal on animationend. Guards against double-call.
   */
  _dismiss(id) {
    // Guard: if already dismissing, do nothing.
    const existing = this._items.find(t => t.id === id);
    if (!existing || existing.dismissing) return;

    const handle = this._timers.get(id);
    if (handle) { clearTimeout(handle); this._timers.delete(id); }

    // Phase 1: mark as dismissing → triggers t-out animation via render().
    this._items = toastReducer(this._items, { type: 'mark-dismissing', id });

    this.dispatchEvent(new CustomEvent('lf-toast-dismiss', {
      detail: { id }, bubbles: true, composed: true,
    }));
  }

  /**
   * Phase 2: actually remove the item from state after t-out animation completes.
   */
  _finalize(id) {
    this._items = toastReducer(this._items, { type: 'dismiss', id });
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

  // MEDIUM 2: _onActionClick fires AFTER _dismiss by design — the action callback
  // runs first (in finally), then the dismiss event fires. The lf-toast-action
  // CustomEvent is dispatched last so listeners can tell apart action vs plain dismiss.
  _onActionClick(ev, id, onClick) {
    ev.stopPropagation();
    try { typeof onClick === 'function' && onClick(); }
    finally { this._dismiss(id); }
    this.dispatchEvent(new CustomEvent('lf-toast-action', {
      detail: { id }, bubbles: true, composed: true,
    }));
  }

  /**
   * After each Lit DOM commit, find newly added .t-bar elements and start their
   * shrink animation via two nested rAFs (first rAF commits the scaleX(1) baseline
   * from CSS; second rAF flips to scaleX(0) so the CSS transition plays).
   */
  updated(changedProps) {
    super.updated(changedProps);
    if (!this.shadowRoot) return;
    const bars = this.shadowRoot.querySelectorAll('.t-bar:not([data-bar-started])');
    bars.forEach(bar => {
      bar.dataset.barStarted = '1';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; });
      });
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const handle of this._timers.values()) clearTimeout(handle);
    this._timers.clear();
  }

  // LOW: aria-label hardcoded FR — to be parameterized via prop when WC i18n strategy is finalized.
  render() {
    return html`
      ${this._items.map(t => html`
        <div
          class="t-item t-${t.type}${t.dismissing ? ' t-out' : ''}"
          role=${t.closable ? 'alert' : 'status'}
          aria-live=${t.closable ? 'assertive' : 'polite'}
          @click=${() => this._onItemClick(t.id)}
          @animationend=${t.dismissing ? () => this._finalize(t.id) : null}
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
                style="transition: transform ${t.duration}ms linear;">
          </span>
        </div>
      `)}
    `;
  }
}
customElements.define('lf-toast-stack', LfToastStack);
