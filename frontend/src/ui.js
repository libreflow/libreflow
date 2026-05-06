// LibreFlow — ui.js
// Utilitaires UI purs : toasts, modal de confirmation.
// Extrait de app.js (Phase 6).
//
// Aucune dépendance vers d'autres modules LibreFlow — importable partout
// sans risque de dépendance circulaire.
//
// Exports publics :
//   toast(msg, type)                               — notification temporaire
//   toastWithAction(msg, type, label, onAction, dur) — toast avec bouton undo
//   confirmAction(title, body, okLabel, okStyle)   — modal confirm → Promise<boolean>
//   resolveConfirm(result)                         — résout la modal depuis handlers.js

// ── Constantes ────────────────────────────────────────────────────────────

const _TOAST_ICONS = {
  info:    `<svg viewBox="0 0 10 10" fill="#fff" width="9" height="9"><circle cx="5" cy="3" r="1"/><rect x="4.2" y="4.8" width="1.6" height="3.2" rx=".8"/></svg>`,
  success: `<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" width="9" height="9"><polyline points="2,5.5 4,7.5 8,3"/></svg>`,
  error:   `<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" width="9" height="9"><line x1="2.5" y1="2.5" x2="7.5" y2="7.5"/><line x1="7.5" y1="2.5" x2="2.5" y2="7.5"/></svg>`,
  warning: `<svg viewBox="0 0 10 10" fill="#fff" width="9" height="9"><path d="M5 1.5L9 8.5H1Z" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="4.3" y="4" width="1.4" height="2.5" rx=".7"/><circle cx="5" cy="7.3" r=".65"/></svg>`,
  loading: `<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" width="9" height="9"><path d="M5 1.5A3.5 3.5 0 1 1 1.7 3.7"/></svg>`,
};
const _TOAST_DUR = { info: 3000, success: 2600, error: 4200, warning: 3600, loading: 120000 };

// ── Toast ─────────────────────────────────────────────────────────────────

/**
 * Affiche une notification temporaire.
 * @param {string} m    Message (HTML autorisé)
 * @param {string} type 'info' | 'success' | 'error' | 'warning' | 'loading'
 * @returns {Function} Fonction remove() — ferme le toast manuellement
 */
export function toast(m, type = 'info') {
  const shelf = document.getElementById('toast-shelf');
  if (!shelf) return () => {};
  const dur  = _TOAST_DUR[type] ?? 3000;
  const icon = _TOAST_ICONS[type] ?? _TOAST_ICONS.info;

  const el = document.createElement('div');
  el.className = `t-item t-${type}`;
  el.innerHTML = `<span class="t-icon">${icon}</span><span class="t-msg">${m}</span><span class="t-bar"></span>`;
  shelf.appendChild(el);

  const bar = el.querySelector('.t-bar');
  bar.style.transition = `transform ${dur}ms linear`;
  requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; });

  const remove = () => {
    if (el._removed) return;
    el._removed = true;
    el.classList.add('t-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  // Permet de mettre à jour le message après création (ex. progress counter)
  remove.update = (newMsg) => {
    const msgEl = el.querySelector('.t-msg');
    if (msgEl) msgEl.textContent = newMsg;
  };
  const timer = setTimeout(remove, dur);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return remove;
}

/**
 * Toast avec bouton d'action intégré (ex : "Annuler" après suppression).
 * @param {string}   m        Message principal
 * @param {string}   type     Type ('success'|'info'|...)
 * @param {string}   label    Label du bouton action
 * @param {Function} onAction Callback exécuté au clic sur le bouton
 * @param {number}   [dur]    Durée ms (défaut = _TOAST_DUR[type])
 * @returns {Function} Fonction remove()
 */
export function toastWithAction(m, type = 'info', label, onAction, dur) {
  const shelf = document.getElementById('toast-shelf');
  if (!shelf) return () => {};
  const d    = dur ?? (_TOAST_DUR[type] ?? 3000);
  const icon = _TOAST_ICONS[type] ?? _TOAST_ICONS.info;

  const el = document.createElement('div');
  el.className = `t-item t-${type}`;
  el.innerHTML = `<span class="t-icon">${icon}</span><span class="t-msg">${m}</span><button class="t-action">${label}</button><span class="t-bar"></span>`;
  shelf.appendChild(el);

  const bar = el.querySelector('.t-bar');
  bar.style.transition = `transform ${d}ms linear`;
  requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; });

  const remove = () => {
    if (el._removed) return;
    el._removed = true;
    el.classList.add('t-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(remove, d);

  const btn = el.querySelector('.t-action');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    remove();
    onAction?.();
  });
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return remove;
}

// ── Confirm modal ─────────────────────────────────────────────────────────

/** Callback interne résolvant la Promise en cours. */
let _confirmResolve = () => {};

/**
 * Affiche la modal de confirmation et retourne une Promise<boolean>.
 * @param {string} title    Titre de la modal
 * @param {string} body     Corps HTML
 * @param {string} okLabel  Label du bouton de confirmation
 * @param {string} okStyle  Classe CSS du bouton ('danger' | 'primary' | ...)
 * @returns {Promise<boolean>}
 */
export function confirmAction(title, body, okLabel = 'Confirmer', okStyle = 'danger') {
  return new Promise(resolve => {
    const bg    = document.getElementById('confirm-modal-bg');
    const elT   = document.getElementById('confirm-modal-title');
    const elB   = document.getElementById('confirm-modal-body');
    const okBtn = document.getElementById('confirm-modal-ok');
    elT.textContent   = title;
    elB.innerHTML     = body;
    okBtn.textContent = okLabel;
    okBtn.className   = `mbtn ${okStyle}`;
    _confirmResolve = (result) => {
      bg.classList.remove('on');
      _confirmResolve = () => {};
      resolve(result);
    };
    bg.classList.add('on');
    setTimeout(() => okBtn.focus(), 50);
  });
}

/**
 * Résout la modal de confirmation depuis l'extérieur (handlers.js).
 * @param {boolean} result
 */
export function resolveConfirm(result) {
  _confirmResolve(result);
}


/**
 * Modal de saisie texte (remplace window.prompt — incompatible Tauri v2).
 * @param {string} title       — Titre de la modal
 * @param {string} defaultVal  — Valeur pré-remplie
 * @param {string} okLabel     — Libellé bouton confirmer
 * @returns {Promise<string|null>} — Valeur saisie, ou null si annulé
 */
export function promptAction(title, defaultVal = '', okLabel = 'OK') {
  return new Promise(resolve => {
    // Créer la modal à la volée
    const bg = document.createElement('div');
    bg.className = 'modal-bg prompt-modal-bg';
    bg.innerHTML = `
      <div class="modal prompt-modal" role="dialog" aria-modal="true">
        <div class="modal-title"></div>
        <input class="prompt-input" type="text" />
        <div class="modal-actions">
          <button class="mbtn secondary prompt-cancel">${'Annuler'}</button>
          <button class="mbtn primary prompt-ok"></button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const input   = bg.querySelector('.prompt-input');
    const okBtn   = bg.querySelector('.prompt-ok');
    const cancelBtn = bg.querySelector('.prompt-cancel');
    bg.querySelector('.modal-title').textContent = title;
    okBtn.textContent = okLabel;
    input.value = defaultVal;

    const finish = (val) => {
      bg.remove();
      resolve(val);
    };

    okBtn.addEventListener('click', () => finish(input.value.trim() || null));
    cancelBtn.addEventListener('click', () => finish(null));
    bg.addEventListener('click', e => { if (e.target === bg) finish(null); });
    input.addEventListener('keydown', e => {
      if (e.code === 'Enter')  { e.preventDefault(); finish(input.value.trim() || null); }
      if (e.code === 'Escape') { e.preventDefault(); finish(null); }
    });

    // Afficher + focus
    requestAnimationFrame(() => {
      bg.classList.add('on');
      input.select();
      input.focus();
    });
  });
}

// Fermer avec Échap
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.getElementById('confirm-modal-bg')?.classList.contains('on')) {
    e.stopImmediatePropagation();
    _confirmResolve(false);
  }
});

// ── Ripple ────────────────────────────────────────────────────────────────

const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc';

export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(_RIPPLE_SEL);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const r = document.createElement('span');
    r.className = 'rpl';
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;`;
    el.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  }, { passive: true });
}
