# Nav Directional Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activer les animations directionnelles de vue (`navSlideOutLeft/InRight/OutRight/InLeft`) déjà définies dans `style.css` mais jamais déclenchées, en détectant la direction de navigation dans `setView()` et en posant `data-nav-dir` sur `<html>`.

**Architecture:** Une constante module-level `_NAV_ORDER` définit l'ordre conceptuel des vues. Avant chaque `_withVT()` dans `setView()`, on compare l'index de la vue courante à celui de la vue cible pour dériver `forward` ou `back`, puis on pose `data-nav-dir` sur `document.documentElement`. Le CSS existant (`html[data-nav-dir="forward|back"] ::view-transition-*(main-content)`) fait le reste.

**Tech Stack:** Vanilla ESM JS, View Transitions API (`document.startViewTransition`), CSS custom properties, `get()` du store.

## Global Constraints

- Aucun `console.log` dans le code commité — `console.warn` uniquement pour les signaux documentés
- Pas de réseau (`fetch`, XHR, WebSocket)
- Pas de nouvelles dépendances npm ou Tauri
- Pas de changement CSS (le CSS des slides directionnels est déjà complet dans `style.css`)
- Pas de changement à `_withVT`, `showView`, `transitionViews` ou `renderer.js`
- Fonctions <50 lignes, fichiers <800 lignes (CLAUDE.md §16)

---

## File Map

| Fichier | Changement |
|---|---|
| `frontend/src/views.js` | +1 module-level `let _navDirTimer = null`; +1 module-level `const _NAV_ORDER`; +8 lignes avant `_withVT` dans `setView()` |

Aucun autre fichier modifié.

---

### Task 1 : Activer la direction `data-nav-dir` dans `setView()`

**Files:**
- Modify: `frontend/src/views.js:185` (module-level vars, après `_searchDebounceTimer`)
- Modify: `frontend/src/views.js:342-348` (corps de `setView`, avant `_withVT`)

**Interfaces:**
- Consomme: `get('view')` (store.js — retourne la vue courante en string ou `undefined`)
- Consomme: `_withVT(fn)` (renderer.js — wraps `startViewTransition` déjà présent)
- Produit: `document.documentElement.dataset.navDir` posé avant la transition, retiré après ~400ms

- [ ] **Step 1 : Ajouter les variables module-level**

  Localiser la ligne 185 dans `frontend/src/views.js` :
  ```js
  let _searchDebounceTimer = null;
  ```

  Ajouter juste après (ligne 186) :
  ```js
  let _navDirTimer = null;
  const _NAV_ORDER = ['all', 'liked', 'recent', 'artists', 'albums', 'genres', 'playlists', 'radio'];
  ```

- [ ] **Step 2 : Ajouter la détection de direction dans `setView()`**

  Localiser ce bloc dans `setView()` (≈ ligne 342-348) :
  ```js
  if (typeof document.startViewTransition !== 'function') runViewTransition();
  // Annuler le debounce de recherche en cours
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
  // Nettoyer la sélection active avant tout changement de vue (BUG-1 FIX)
  clearSelection();

  _withVT(() => {
  ```

  Le remplacer par :
  ```js
  if (typeof document.startViewTransition !== 'function') runViewTransition();
  // Annuler le debounce de recherche en cours
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
  // Nettoyer la sélection active avant tout changement de vue (BUG-1 FIX)
  clearSelection();

  // Direction slide — active les animations directionnelles CSS (navSlideOut/In)
  const _fi = _NAV_ORDER.indexOf(get('view') || 'all');
  const _ti = _NAV_ORDER.indexOf(v);
  if (_fi >= 0 && _ti >= 0 && _fi !== _ti) {
    clearTimeout(_navDirTimer);
    document.documentElement.setAttribute('data-nav-dir', _ti > _fi ? 'forward' : 'back');
    _navDirTimer = setTimeout(() => document.documentElement.removeAttribute('data-nav-dir'), 400);
  }

  _withVT(() => {
  ```

- [ ] **Step 3 : Vérifier la syntaxe**

  ```bash
  node --input-type=module < frontend/src/views.js 2>&1 | head -10
  ```

  Attendu : erreurs d'import Tauri ou de modules (`Cannot find module`) — **normales** à l'exécution directe. Aucune erreur de syntaxe JS ne doit apparaître.

  Alternativement :
  ```bash
  npm run build 2>&1 | tail -20
  ```
  Attendu : build réussi, zéro erreur de parse.

- [ ] **Step 4 : Lancer les tests unitaires**

  ```bash
  npm test
  ```

  Attendu :
  ```
  Total : 444   OK: 444   KO: 0
  ✓ Tous les tests passent
  ```

  Aucune régression sur les 444 assertions existantes.

- [ ] **Step 5 : Smoke test manuel**

  ```bash
  npm run dev
  ```

  Scénario :
  1. Charger une bibliothèque avec au moins 3 pistes.
  2. Depuis la vue **Tous les titres**, cliquer l'onglet **Albums** dans la lib-bar.
     → Attendu : le contenu principal glisse vers la gauche (slide forward).
  3. Cliquer l'onglet **Tous** (retour).
     → Attendu : le contenu glisse vers la droite (slide back).
  4. Dans la sidebar, cliquer **Playlists** (index 6) depuis **Tous** (index 0).
     → Attendu : slide forward.
  5. Cliquer **Tous** depuis **Playlists**.
     → Attendu : slide back.
  6. Switcher entre lib et stats (via le menu "…" ou raccourci) — doit rester un cross-fade sans slide.
  7. Cliquer très rapidement sur 3–4 onglets différents.
     → Attendu : pas de glitch visuel, le dernier slide s'applique correctement.
  8. Activer "prefers-reduced-motion" dans les paramètres d'accessibilité de l'OS ou les DevTools.
     → Attendu : les transitions sont instantanées (le browser annule les animations VT).

- [ ] **Step 6 : Commit**

  ```bash
  git add frontend/src/views.js
  git commit -m "feat(nav): activate directional slide transitions via data-nav-dir"
  ```

---

## Récapitulatif

| # | Message | Fichiers |
|---|---|---|
| 1 | `feat(nav): activate directional slide transitions via data-nav-dir` | `frontend/src/views.js` |
