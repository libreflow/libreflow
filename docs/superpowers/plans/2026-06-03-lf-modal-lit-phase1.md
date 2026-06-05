# lf-modal — Lit Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer `<lf-modal>` (Lit 3, Shadow DOM), encapsulant focus trap + animation GSAP + gestion Escape. Piloter sur la modale "Vider la bibliothèque". `modal.js` réduit à ses utilitaires.

**Architecture:** TDD sur `lf-modal.logic.js` (reducer pur). Composant `lf-modal.js` délègue l'animation à `motion.js` et le focus trap à sa logique interne. `confirmClear()`/`closeModal()` dans `modal.js` deviennent des délégations d'une ligne. Les 8 autres dialogs non-migrés conservent `installAutoFocusTrap`.

**Tech Stack:** Lit 3.x (déjà dans `dependencies`), Vanilla ESM JS, `npm test`, `npm run build`

**Spec:** `docs/superpowers/specs/2026-06-03-architecture-module-split-design.md` §6

---

## File Map

| Fichier | Action |
|---|---|
| `frontend/src/components/lf-modal.logic.js` | Créer |
| `frontend/src/components/lf-modal.js` | Créer |
| `frontend/tests/core.test.cjs` | Modifier — ajouter tests `modalReducer` |
| `frontend/src/modal.js` | Modifier — déléguer `confirmClear` + `closeModal` |
| `frontend/index.html` | Modifier — remplacer `#modal-bg + #modal` |
| `frontend/src/app.js` | Modifier — ajouter import side-effect |

---

## Task 1 : Tests du reducer (TDD — RED puis GREEN)

**Files:**
- Modify: `frontend/tests/core.test.cjs`

- [ ] **Step 1 : Ajouter les cas de test**

Dans `frontend/tests/core.test.cjs`, ajouter après les tests existants :

```js
// ── lf-modal reducer ─────────────────────────────────────────────────────────
{
  // Logique inline pour la phase RED — extraite dans lf-modal.logic.js en Task 2
  function modalReducer(state, action) {
    switch (action.type) {
      case 'open':  return { ...state, isOpen: true }
      case 'close': return { ...state, isOpen: false }
      default:      return state
    }
  }
  const s0 = { isOpen: false }

  let s = modalReducer(s0, { type: 'open' })
  assert.strictEqual(s.isOpen, true, 'open sets isOpen true')

  s = modalReducer(s, { type: 'close' })
  assert.strictEqual(s.isOpen, false, 'close sets isOpen false')

  s = modalReducer(s0, { type: 'unknown' })
  assert.strictEqual(s.isOpen, false, 'unknown action is no-op')

  s = modalReducer({ isOpen: true }, { type: 'open' })
  assert.strictEqual(s.isOpen, true, 'open on already-open preserves state')

  console.log('lf-modal reducer: OK')
}
```

- [ ] **Step 2 : Lancer les tests**

```powershell
npm test
```

Attendu : vert + `lf-modal reducer: OK`.

---

## Task 2 : Créer `lf-modal.logic.js`

**Files:**
- Create: `frontend/src/components/lf-modal.logic.js`

- [ ] **Step 1 : Créer le reducer pur**

```js
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
```

- [ ] **Step 2 : Vérifier le parse**

```powershell
node --input-type=module --eval "import('./frontend/src/components/lf-modal.logic.js').then(m => { const r = m.modalReducer({isOpen:false},{type:'open'}); console.log('isOpen:', r.isOpen) })"
```

Attendu : `isOpen: true`

---

## Task 3 : Créer `lf-modal.js`

**Files:**
- Create: `frontend/src/components/lf-modal.js`

- [ ] **Step 1 : Créer le composant**

```js
// lf-modal.js — Modal générique Shadow DOM. Focus trap + GSAP + Escape intégrés.

import { LitElement, html, css } from 'lit'
import { modalReducer }          from './lf-modal.logic.js'
import { modalOpen, modalClose } from '../motion.js'
import { FOCUSABLE_SEL }         from '../modal.js'

export class LfModal extends LitElement {
  static properties = { _state: { state: true } }

  static styles = css`
    :host { display: contents; }
    .backdrop {
      display: none; position: fixed; inset: 0;
      background: var(--lf-modal-backdrop, rgba(0,0,0,.55));
      z-index: var(--z-modal-bg, 900);
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
      const els = [...dlg.querySelectorAll(FOCUSABLE_SEL)]
        .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    dlg.addEventListener('keydown', this._trapHandler)
    setTimeout(() => dlg.querySelector(FOCUSABLE_SEL)?.focus(), 0)
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
        <div class="dialog" role="dialog" aria-modal="true">
          <slot></slot>
        </div>
      </div>
    `
  }
}

customElements.define('lf-modal', LfModal)
```

---

## Task 4 : Mettre à jour `index.html`

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1 : Trouver le bloc `#modal-bg`**

```powershell
Select-String -Path frontend/index.html -Pattern "modal-bg" | Select-Object -First 5
```

- [ ] **Step 2 : Remplacer le bloc HTML**

Localiser le bloc :

```html
<div id="modal-bg" ...>
  <div id="modal" role="dialog" aria-modal="true" ...>
    ...
  </div>
</div>
```

Le remplacer par (conserver les attributs `data-i18n` exacts du HTML original) :

```html
<lf-modal id="clear-modal">
  <div class="modal-h" data-i18n="clear_h"></div>
  <div class="modal-s" data-i18n-html="clear_body"></div>
  <div class="modal-btns">
    <button class="mbtn cancel" data-action="close-modal" data-i18n="pl_cancel"></button>
    <button class="mbtn confirm" data-action="confirm-clear" data-i18n="clear_confirm"></button>
  </div>
</lf-modal>
```

> Les sélecteurs `data-action` existants dans `handlers.js` (`close-modal`, `confirm-clear`) continuent de fonctionner — ils sont dans le Light DOM (slot), pas dans le Shadow DOM.

---

## Task 5 : Mettre à jour `modal.js`

**Files:**
- Modify: `frontend/src/modal.js`

- [ ] **Step 1 : Remplacer `confirmClear`**

Supprimer le corps actuel de `confirmClear()` et le remplacer par :

```js
export function confirmClear() {
  if (!get('tracks').length) return
  /** @type {any} */ (document.getElementById('clear-modal'))?.open()
}
```

- [ ] **Step 2 : Remplacer `closeModal`**

Supprimer le corps actuel de `closeModal()` et le remplacer par :

```js
export function closeModal() {
  /** @type {any} */ (document.getElementById('clear-modal'))?.close()
}
```

- [ ] **Step 3 : Supprimer les variables internes obsolètes**

Supprimer de `modal.js` :
- `let _modalPrevFocus = null`
- `let _modalFocusTrap = null`
- La fonction privée `_buildModalFocusTrap`

Conserver intégralement : `FOCUSABLE_SEL`, `trapFocus`, `releaseFocus`, `installAutoFocusTrap`.

- [ ] **Step 4 : Vérifier le nombre de lignes**

```powershell
(Get-Content frontend/src/modal.js | Measure-Object -Line).Lines
```

Attendu : 80–115 lignes.

---

## Task 6 : Enregistrer le composant dans `app.js`

**Files:**
- Modify: `frontend/src/app.js`

- [ ] **Step 1 : Ajouter l'import side-effect**

Dans le bloc d'imports de `frontend/src/app.js`, ajouter :

```js
import './components/lf-modal.js'
```

(juste après ou à côté de l'import existant `./components/lf-toast-stack.js`)

---

## Task 7 : Build + tests + smoke + commit

- [ ] **Step 1 : Build**

```powershell
npm run build 2>&1 | Select-String -Pattern "error" -CaseSensitive:$false
```

Attendu : aucune `error`.

- [ ] **Step 2 : Tests**

```powershell
npm test
```

Attendu : vert + `lf-modal reducer: OK`.

- [ ] **Step 3 : Smoke manuel**

`npm run dev` :
1. Cliquer "Vider la bibliothèque" → modale s'ouvre avec animation.
2. `Tab` → cycle focus entre boutons uniquement.
3. `Escape` → modale se ferme, focus restauré.
4. Clic backdrop → modale se ferme.
5. Cliquer "Annuler" → ferme sans vider.
6. Toasts, autres modales (organize, settings, etc.) → non régressés.

- [ ] **Step 4 : Commiter**

```powershell
git add frontend/src/components/lf-modal.js frontend/src/components/lf-modal.logic.js frontend/src/modal.js frontend/index.html frontend/src/app.js frontend/tests/core.test.cjs
git commit -m "feat(components): lf-modal Lit Phase 1 — modal wrapper with focus trap + GSAP"
```
