# Lit Integration — Design

**Date:** 2026-05-28
**Statut:** Draft (en attente de revue utilisateur)
**Scope de cette spec:** Phase 0 (installation Lit + composant pilote `<lf-toast-stack>`)
**Phases ultérieures:** documentées comme intention, mais chacune fera l'objet de sa propre spec/plan/PR.

---

## 1. Problème et objectif

### 1.1 Problème

`libreflow` est un projet Tauri offline composé d'environ 65 modules ESM vanilla JS sous `frontend/src/`. La manipulation impérative du DOM via `ui.js`, `renderer.js`, `playerbar.js` et les modules de panneaux (settings, tagedit, smartplaylist, etc.) devient difficile à maintenir : duplication, code spaghetti, couplage CSS global, absence d'encapsulation.

### 1.2 Objectif

Introduire [Lit](https://lit.dev) (Web Components) dans le projet de façon **progressive et maîtrisée**, afin de :

- Gagner en lisibilité (templates déclaratifs `html\`\``)
- Encapsuler le style (Shadow DOM, scoped CSS)
- Standardiser les composants (Custom Elements, standard navigateur — pas un framework propriétaire)
- Préserver intégralement les invariants critiques de libreflow (CLAUDE.md §2, §9, §10, §15)

### 1.3 Non-objectifs

- Pas de refactor big bang.
- Pas de migration de `virt.js`, de la chaîne audio, ni des animations canvas vers Lit.
- Pas de changement de l'API publique de `toast()` / `toastWithAction()` consommée largement (~25–29 fichiers, nombre exact confirmé au plan).
- Pas de SSR, de hydratation, ni de framework supplémentaire (React/Vue/Svelte exclus).

---

## 2. Décisions techniques fondamentales

| Décision | Choix retenu | Justification |
|---|---|---|
| Version Lit | `lit` 3.x (dernière stable) | Stable, JS pur supporté, ~6 KB gz, ESM-only |
| Langage | **JavaScript pur**, pas de TypeScript ni decorators | Aligné avec les ~65 modules existants. API `static properties` + `customElements.define()` |
| Transport | npm dependency (`npm i lit`) | Offline-first respecté. Pas de CDN |
| Préfixe Custom Elements | `lf-` (libreflow) | Convention HTML "Custom Elements must contain a dash" |
| Évènements | `CustomEvent('lf-<verbe>', { bubbles: true, composed: true, detail })` | Standard, traverse Shadow DOM via `composed: true` |
| Style | Shadow DOM par défaut + CSS custom properties pour le thème | Encapsulation sans dupliquer les variables de thème |
| SSR / hydratation | **Non** | App desktop offline, pas de serveur |
| Test runner DOM dédié | **Reporté à Phase 1** | Pas de runner DOM ajouté tant qu'un seul composant est concerné (YAGNI) |

---

## 3. Arborescence

```
frontend/src/
├── components/                 ← NOUVEAU — dédié aux Web Components Lit
│   └── lf-toast-stack.js       ← Phase 0
├── ui.js                       ← Existing — toast()/toastWithAction() deviennent façade
├── modal.js                    ← Existing — reste en Phase 0, migré en Phase 1
└── app.js                      ← Existing — orchestration globale, reste impératif
```

**Convention** :

- Un fichier = un Custom Element.
- Chaque fichier exporte la classe et appelle `customElements.define()` en bas de fichier.
- L'import depuis `app.js` (ou `main.js`) suffit à enregistrer le composant (side-effect).

---

## 4. Exclusions permanentes — zones qui resteront impératives

Ces modules **ne migreront jamais vers Lit**. Toute future spec touchant ces zones doit confirmer le maintien de cette exclusion.

| Module | Raison |
|---|---|
| `frontend/src/virt.js` | Virtual scroll perf-critique (50 k tracks). Zéro alloc dans `requestAnimationFrame`. CLAUDE.md §10 |
| `frontend/src/player.js`, chaîne Web Audio, `frontend/src/eq.js`, `frontend/src/replaygain.js` | Web Audio impératif, `setTargetAtTime`, params live. CLAUDE.md §9 |
| `frontend/src/app.js` (boot sequence) | Orchestration globale, ordres critiques (ex. `radioRefillQueue()` avant `updateBar()`). CLAUDE.md §6 |
| `frontend/src/cinema.js`, `frontend/src/viz.js`, `frontend/src/motion.js`, `frontend/src/oscPremium.js` | Animations canvas / GSAP frame-précis |
| `frontend/src/ipc.js` | Couche transport JS↔Rust, pas de UI |

---

## 5. Phasing

Chaque phase = sa propre spec, son propre plan, sa propre PR. Aucun travail au-delà de la Phase 0 n'est engagé par cette spec.

| Phase | Scope | Statut |
|---|---|---|
| **0** | Installer `lit`, créer `<lf-toast-stack>`, faire de `toast()` / `toastWithAction()` une façade | **Cette spec** |
| 1 | Modales : `<lf-modal>`, `<lf-confirm-dialog>` (incluant le `trapFocus`/`releaseFocus` actuel) | Future spec |
| 2 | Panneaux secondaires : settings, tagedit, smartplaylist | Future spec |
| 3 (optionnelle) | Sidebar playlists, devices, search bar — uniquement si Phases 0–2 valident la valeur | Future spec |

**Critère d'engagement Phase N+1** : Phase N livrée + bench/budget perf verts + revue manuelle OK.

---

## 6. Phase 0 — détail

### 6.1 Composant pilote : `<lf-toast-stack>`

**Pourquoi ce composant :**

- `toast()` existe déjà dans `ui.js:42`, consommé par ~25–29 fichiers (le mot "toast" apparaît dans 29 fichiers de `frontend/src/` — le nombre exact d'appels réels à `toast()` / `toastWithAction()` sera confirmé au début du plan d'implémentation par un grep ciblé) → on **ne touche pas aux call sites**, on remplace seulement l'implémentation interne.
- Aucun invariant critique (§2) touché.
- Visible immédiatement → validation manuelle triviale.
- Couvre la majorité de la surface utile de Lit pour le projet : props réactives, `static styles`, événements custom, animations CSS.

### 6.2 API publique préservée

Les signatures actuelles dans `ui.js` restent inchangées :

```js
export function toast(m, type = 'info')
export function toastWithAction(m, type = 'info', label, onAction, dur)
```

Aucun fichier appelant n'est modifié.

### 6.3 Implémentation interne

`ui.js` cherche (ou crée à la volée) un singleton `<lf-toast-stack>` attaché à `document.body`, puis appelle ses méthodes publiques :

```js
// frontend/src/ui.js — extrait après migration
import './components/lf-toast-stack.js'

let _stack = null
function _getStack() {
  if (!_stack) {
    _stack = document.querySelector('lf-toast-stack')
      || document.body.appendChild(document.createElement('lf-toast-stack'))
  }
  return _stack
}

export function toast(m, type = 'info') {
  _getStack().push({ message: m, type, duration: 3000 })
}

export function toastWithAction(m, type = 'info', label, onAction, dur = 5000) {
  _getStack().push({
    message: m, type, duration: dur,
    action: { label, onClick: onAction }
  })
}
```

### 6.4 Composant `<lf-toast-stack>` — contrat

```js
// frontend/src/components/lf-toast-stack.js
import { LitElement, html, css } from 'lit'
import { toastReducer } from './lf-toast-stack.logic.js'

export class LfToastStack extends LitElement {
  static properties = {
    _items: { state: true }   // [{ id, message, type, duration, action?: { label, onClick } }]
  }

  static styles = css`
    :host {
      position: fixed; bottom: 16px; right: 16px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 9999; pointer-events: none;
      font-family: var(--lf-font-ui, system-ui, sans-serif);
    }
    .toast {
      pointer-events: auto;
      color: var(--lf-toast-fg, #fff);
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
      animation: slide-in 150ms ease-out;
    }
    .toast.info    { background: var(--lf-toast-bg-info,    #222); }
    .toast.success { background: var(--lf-toast-bg-success, #2a7); }
    .toast.error   { background: var(--lf-toast-bg-error,   #a33); }
    @keyframes slide-in { from { transform: translateX(20px); opacity: 0; } }
  `

  constructor() { super(); this._items = [] }

  /** API publique appelée depuis ui.js */
  push(item) {
    const id = ++LfToastStack._seq
    this._items = toastReducer(this._items, { type: 'add', item: { ...item, id } })
    if (item.duration > 0) {
      setTimeout(() => this._dismiss(id), item.duration)
    }
  }

  _dismiss(id) {
    this._items = toastReducer(this._items, { type: 'dismiss', id })
    this.dispatchEvent(new CustomEvent('lf-toast-dismiss', {
      detail: { id }, bubbles: true, composed: true
    }))
  }

  _onAction(id, onClick) {
    try { onClick && onClick() } finally { this._dismiss(id) }
    this.dispatchEvent(new CustomEvent('lf-toast-action', {
      detail: { id }, bubbles: true, composed: true
    }))
  }

  render() {
    return html`
      ${this._items.map(t => html`
        <div class="toast ${t.type}" role="status" aria-live="polite">
          <span class="msg">${t.message}</span>
          ${t.action
            ? html`<button class="act" @click=${() => this._onAction(t.id, t.action.onClick)}>${t.action.label}</button>`
            : null}
        </div>
      `)}
    `
  }
}
LfToastStack._seq = 0
customElements.define('lf-toast-stack', LfToastStack)
```

### 6.5 Module logique pur (testable en CJS)

Pour pouvoir tester la logique sans charger ESM Lit en Node CJS :

```js
// frontend/src/components/lf-toast-stack.logic.js
// Reducer pur — pas d'import de Lit.
export function toastReducer(items, action) {
  switch (action.type) {
    case 'add':     return [...items, action.item]
    case 'dismiss': return items.filter(t => t.id !== action.id)
    default:        return items
  }
}
```

Et `frontend/src/components/lf-toast-stack.logic.cjs` généré (à l'image de `cdaudio_pure.cjs` qui suit déjà ce pattern) ou simplement importé via `require` si la cible Node supporte ESM dans les tests — décision tooling reportée au plan d'implémentation.

### 6.6 Thématisation

- Shadow DOM bloque les sélecteurs CSS globaux par défaut.
- Les variables de thème (`--lf-color-bg`, `--lf-color-fg`, `--lf-color-accent`, `--lf-toast-bg-*`, etc.) sont définies une seule fois sur `:root` dans `frontend/src/style.css`.
- Elles sont héritées dans le Shadow DOM (les custom properties traversent la frontière) et consommées via `var()` dans `static styles`.
- Aucune duplication CSS.
- Pas de Tailwind, pas de CSS-in-JS — CSS plain (CLAUDE.md §13).

### 6.7 Intégration Vite

- Aucune modification de `vite.config.js` requise.
- Lit est un package ESM standard, bundlé automatiquement par Vite.
- Tree-shaking actif en prod (Lit est conçu pour).
- Bundle attendu : **~6 KB gz** ajouté.

---

## 7. Tests

Le projet n'a actuellement pas de runner DOM (uniquement `node` pour `core.test.cjs` + Playwright visuel pour `tests/visual/`). Pour Phase 0 :

1. **Test unitaire — logique pure**
   `frontend/tests/core.test.cjs` reçoit des cas pour `toastReducer` :
   - `add` empile un item
   - `dismiss` retire l'item par `id`
   - `dismiss` sur un id absent est no-op
   - L'ordre est préservé

2. **Test visuel — rendu**
   Un scénario Playwright dans `frontend/tests/visual/` :
   - Charge la page
   - Déclenche `toast('Snapshot test', 'success')` via `page.evaluate`
   - Snapshot du DOM rendu (le Shadow Root est inspectable par Playwright)

3. **Smoke manuel**
   `npm run dev` → DevTools → `import('/src/ui.js').then(m => m.toast('hi', 'info'))` → vérification visuelle, auto-dismiss à 3 s.

**Décision report** : adoption éventuelle de `@open-wc/testing` ou `@web/test-runner` sera évaluée en Phase 1 quand plusieurs composants existeront.

---

## 8. Critères d'acceptation Phase 0

- [ ] `lit` ajouté dans `dependencies` de `package.json` (runtime, pas devDeps)
- [ ] `frontend/src/components/lf-toast-stack.js` créé, compile, render OK
- [ ] `frontend/src/components/lf-toast-stack.logic.js` créé (reducer pur)
- [ ] `ui.js#toast()` et `ui.js#toastWithAction()` délèguent au composant ; signatures publiques inchangées
- [ ] Tous les call sites identifiés (recensés via grep ciblé `\btoast(With)?\(`) continuent de fonctionner sans modification de leur code
- [ ] `npm run perf:bundle` : variation chiffrée dans la PR ; budget de `perf-budgets.json` respecté (ou rééquilibré explicitement avec justification écrite)
- [ ] `npm run perf:bench` : aucune régression > 5 % sur les scénarios existants
- [ ] `npm test` reste vert ; tests `toastReducer` ajoutés
- [ ] Au moins un test visuel Playwright pour un toast (snapshot)
- [ ] Aucun nouvel appel réseau (CLAUDE.md §15)
- [ ] CLAUDE.md mis à jour : un paragraphe mentionnant Lit + le dossier `components/` est ajouté dans la section appropriée (section "stack frontend" si elle existe, sinon nouvelle sous-section, choix tranché au moment de l'implémentation)
- [ ] `cargo test` reste vert (sécurité, pas de raison qu'il bouge)

---

## 9. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Bundle size +~6 KB pèse sur les budgets perf | Moyen | Mesurer dans la PR via `npm run perf:bundle` ; ajuster `perf-budgets.json` avec justification si nécessaire |
| Shadow DOM bloque les sélecteurs CSS globaux | Faible | CSS custom properties + `:host` styling. Convention documentée en §6.6 |
| Régression visuelle subtile sur les toasts (style légèrement différent) | Moyen | Snapshot Playwright + diff revu manuellement avant merge |
| Tests CJS ne peuvent pas charger ESM `lit` | Faible | Logique pure extraite dans `*.logic.js` (testable) ; rendu via Playwright |
| Call sites changent de comportement subtil (timing, ordre d'animation) | Faible | Façade `toast()` reproduit la signature exacte. Smoke manuel sur 4–5 call sites représentatifs choisis au moment du plan (candidats probables : `organize.js`, `dupes.js`, `tagedit.js`, `watchfolder.js`, `updater.js`, à confirmer par fréquence d'appel) |
| Lit introduit une dépendance qui pourrait tenter de phoner home | Très faible | Lit est connu pour être 100 % offline ; audit npm + vérification que `dist/sbom-npm.cdx.json` mentionne uniquement `lit`, `lit-html`, `@lit/reactive-element` |

---

## 10. Rollback

Si la Phase 0 ne tient pas ses promesses (perf, visuel, stabilité) :

1. `git revert` du commit unique de la PR Phase 0.
2. Alternativement, manuellement :
   - Retirer l'import `lit` de `ui.js` et de `frontend/src/components/lf-toast-stack.js`
   - Restaurer la version précédente de `toast()` / `toastWithAction()`
   - `npm uninstall lit`
   - Supprimer `frontend/src/components/`
3. Aucun autre fichier modifié → blast radius = nul ailleurs.

---

## 11. Hors scope (explicite)

- Migration de `modal.js` → reportée à Phase 1.
- Migration de tout panneau (settings, tagedit, smartplaylist, dupes, organize) → Phase 2 ou ultérieure.
- Migration de la sidebar, du player bar, de la now playing → Phase 3 (optionnelle).
- Choix d'un runner de tests DOM dédié → décidé en Phase 1.
- Internationalisation de `<lf-toast-stack>` → le message reçu via `push()` est déjà localisé en amont par `i18n.js`, aucune logique d'i18n dans le composant.
- Ajout d'un autre composant Lit (`<lf-modal>`, etc.) — explicitement reporté à phases ultérieures.

---

## 12. Références

- [Lit documentation officielle](https://lit.dev/)
- CLAUDE.md (projet) — §2 invariants, §9 audio, §10 virtual scroll, §13 CSS, §15 offline, §20 minimalisme
- `frontend/src/ui.js:42` — implémentation `toast()` actuelle
- `frontend/src/modal.js` — référence focus trap (utilisé Phase 1)
- `perf-budgets.json` — budgets bundle existants
- `frontend/tests/bench.cjs` — benchmark de référence
