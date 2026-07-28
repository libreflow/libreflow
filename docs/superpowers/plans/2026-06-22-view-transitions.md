# View Transitions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer le saut visuel lors du changement de section dans la sidebar en remplaçant les animations CSS défectueuses par un cross-fade GSAP "exit on top".

**Architecture:** Deux corrections distinctes — (1) supprimer `.view-leave` du chemin View Transition API qui causait une double animation, (2) remplacer `.view-enter`/`.view-leave` dans le chemin fallback par une timeline GSAP coordonnée depuis `motion.js`. Ajout de `position: relative` sur `#main` pour ancrer les enfants absolus correctement.

**Tech Stack:** Vanilla JS (ESM), GSAP 3 via `motion.js`, CSS custom properties.

## Global Constraints

- CLAUDE.md §2 WCAG 2.2 AA : aucun changement aux rôles ARIA, labels, ordre de focus
- CLAUDE.md §9 : aucun changement à la chaîne Web Audio
- CLAUDE.md §15 : aucun réseau — GSAP est déjà bundlé localement
- `npm test` doit rester vert après chaque tâche
- Fonctions < 50 lignes, fichiers < 800 lignes (§16)
- Pas de `console.log` dans le code commité (§14)

---

## File Map

| Fichier | Rôle dans ce plan |
|---------|-------------------|
| `frontend/src/style.css` | Task 1 : ajouter `position: relative` à `#main`; Task 3 : supprimer `.view-enter`, `.view-leave`, `viewIn`, `viewOut` |
| `frontend/src/motion.js` | Task 2 : ajouter `transitionViews(prev, next)` |
| `frontend/src/views.js` | Task 2 : réécrire `_showViewRaw()` |
| `frontend/tests/visual/` | Task 4 : régénérer les snapshots Playwright |

---

## Task 1 : Fixer le containing block de `#main`

**Fichiers :**
- Modifier : `frontend/src/style.css` (règle `#main`, ligne ~1070)

**Pourquoi :** Sans `position: relative` sur `#main`, un enfant `position: absolute; inset: 0` s'ancre sur le viewport entier → couvre toute la fenêtre → jump visible.

- [ ] **Step 1 : Localiser la règle `#main` dans `style.css`**

  ```powershell
  Select-String -Path "frontend/src/style.css" -Pattern "#main \{" | Select-Object -First 3
  ```
  Attendu : une ligne autour de 1070 avec `grid-area: main; display: flex; ...`

- [ ] **Step 2 : Ajouter `position: relative` à `#main`**

  Dans `frontend/src/style.css`, trouver :
  ```css
  #main {
    container: main / inline-size;
    grid-area: main; display: flex; flex-direction: column; overflow: hidden;
  ```
  Remplacer par :
  ```css
  #main {
    container: main / inline-size;
    grid-area: main; display: flex; flex-direction: column; overflow: hidden;
    position: relative;
  ```
  (Ajouter `position: relative;` sur la ligne suivante, avant `min-width: 0`)

- [ ] **Step 3 : Lancer les tests**

  ```powershell
  npm test
  ```
  Attendu : tous les tests passent (aucun test n'assertive la position CSS de `#main`).

- [ ] **Step 4 : Commit**

  ```powershell
  git add frontend/src/style.css
  git commit -m "fix(layout): add position:relative to #main to anchor absolute view overlays"
  ```

---

## Task 2 : Remplacer le CSS dance par GSAP dans `_showViewRaw`

**Fichiers :**
- Modifier : `frontend/src/motion.js` (ajouter `transitionViews`)
- Modifier : `frontend/src/views.js` (réécrire `_showViewRaw`)

**Interfaces :**
- `transitionViews(prev: Element | null, next: Element): void` — exporté depuis `motion.js`, appelé par `_showViewRaw` dans `views.js`

### Sous-tâche A : Ajouter `transitionViews` dans `motion.js`

- [ ] **Step 1 : Lire la fin de `motion.js` pour trouver l'endroit d'insertion**

  ```powershell
  Select-String -Path "frontend/src/motion.js" -Pattern "^export" | Select-Object -Last 5
  ```
  Attendu : voir les dernières lignes `export function ...` — insérer `transitionViews` juste avant ou après `kill`.

- [ ] **Step 2 : Ajouter `transitionViews` dans `motion.js`**

  À la fin de `frontend/src/motion.js`, avant la dernière ligne du fichier, ajouter :

  ```js
  /**
   * Transition between two top-level view panels.
   *
   * VT API path  → called inside document.startViewTransition; just swaps .on,
   *                the browser handles the visual cross-fade.
   * Fallback path → "exit on top" GSAP cross-fade: old view fades out as an
   *                absolute overlay while new view fades in from below.
   *
   * @param {Element|null} prev  Currently visible .view (may be null on first load)
   * @param {Element}      next  Target .view to show
   */
  export function transitionViews(prev, next) {
    if (!prev || prev === next) {
      next.classList.add('on');
      return;
    }

    // Kill any in-progress tweens so rapid nav doesn't stack
    gsap.killTweensOf(prev);
    gsap.killTweensOf(next);

    // Always show the new view in normal flow first
    next.classList.add('on');

    if (prefersReducedMotion()) {
      // Instant swap — no animation
      prev.classList.remove('on');
      prev.style.display = '';
      return;
    }

    // Overlay old view on top (anchored to #main via position:relative)
    gsap.set(prev, { position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' });

    // Exit: old view fades out (shorter, quieter)
    gsap.to(prev, {
      opacity: 0,
      duration: 0.15,
      ease: eases.SNAP,
      onComplete() {
        gsap.set(prev, { clearProps: 'position,inset,zIndex,pointerEvents,opacity' });
        prev.classList.remove('on');
        prev.style.display = '';
      },
    });

    // Enter: new view fades in with upward lift (longer)
    gsap.fromTo(
      next,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.22, ease: eases.PREMIUM, clearProps: 'transform,opacity' }
    );
  }
  ```

### Sous-tâche B : Réécrire `_showViewRaw` dans `views.js`

- [ ] **Step 3 : Ajouter l'import de `transitionViews` dans `views.js`**

  En haut de `frontend/src/views.js`, trouver la ligne qui importe depuis `motion.js` (ou ajouter si absente). Ajouter `transitionViews` à l'import existant :

  ```js
  import { tween, timeline, set, eases, transitionViews } from './motion.js';
  ```
  Si `motion.js` n'est pas encore importé dans `views.js`, ajouter la ligne complète ci-dessus.

- [ ] **Step 4 : Réécrire `_showViewRaw` dans `views.js`**

  Trouver la fonction `_showViewRaw` (ligne ~110). La remplacer intégralement par :

  ```js
  /** Bascule vers une vue sans View Transition — utilisé en interne pour éviter l'imbrication. */
  export function _showViewRaw(v) {
    const map = { welcome: 'vw', wlc: 'vw', scan: 'vscan', lib: 'vlib', stats: 'vstats', radio: 'vradio', 'now-playing': 'vnp' };
    const next = document.getElementById(map[v] || 'vlib');
    if (!next) return;

    const prev = document.querySelector('.view.on');

    if (typeof document.startViewTransition === 'function') {
      // VT API path : simple swap, browser handles visual transition
      if (prev && prev !== next) prev.classList.remove('on');
      next.classList.add('on');
    } else {
      // Fallback path : GSAP "exit on top" cross-fade
      transitionViews(prev !== next ? prev : null, next);
    }
  }
  ```

- [ ] **Step 5 : Lancer les tests**

  ```powershell
  npm test
  ```
  Attendu : tous les tests passent.

- [ ] **Step 6 : Commit**

  ```powershell
  git add frontend/src/motion.js frontend/src/views.js
  git commit -m "feat(motion): replace view-leave/enter CSS dance with GSAP transitionViews"
  ```

---

## Task 3 : Nettoyer les CSS devenus inutiles

**Fichiers :**
- Modifier : `frontend/src/style.css`

Les classes `.view-enter`, `.view-leave` et les keyframes `viewIn`, `viewOut` ne sont plus utilisées en JS. Les supprimer évite qu'elles soient accidentellement réintroduites et allège le CSS.

**À NE PAS supprimer :**
- `@keyframes wlFadeIn` + les règles `#vw.on .wl/wh1/...` (welcome screen stagger — toujours utilisé)
- `@keyframes vtOut`, `vtIn`, `navSlide*` (utilisés par `::view-transition-*`)
- `html.vt-running .view.on / .view-enter` (peut rester — inoffensif, pas de classe `.view-enter` à déclencher maintenant)
- `#main.view-fade` + `@keyframes view-fade-in` (utilisé par `view-transition.js`)

- [ ] **Step 1 : Supprimer `.view-enter`, `.view-leave` et leurs keyframes**

  Dans `frontend/src/style.css`, supprimer les blocs suivants (rechercher et supprimer chaque bloc intégralement) :

  ```css
  /* À SUPPRIMER — bloc 1 */
  @keyframes viewIn  {
    0%   { opacity: 0; transform: translateY(var(--sp-2)) scale(.994); filter: blur(var(--blur-1)); }
    60%  { filter: blur(0); }
    100% { opacity: 1; transform: none; filter: blur(0); }
  }

  /* À SUPPRIMER — bloc 2 */
  @keyframes viewOut { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.975) translateY(calc(-1 * var(--sp-1h))); } }

  /* À SUPPRIMER — bloc 3 */
  .view-enter { animation: viewIn  var(--dur-nav) var(--decelerate) forwards; }

  /* À SUPPRIMER — bloc 4 */
  .view-leave {
    /* CLS FIX : ... */
    position: absolute !important; inset: 0; pointer-events: none; z-index: 2;
    animation: viewOut var(--dur-interact) var(--accelerate) forwards;
  }
  ```

  Supprimer aussi le commentaire qui précède ces keyframes (ligne ~5376 : `/* ── Transitions de vues (fallback sans API) ... */`).

- [ ] **Step 2 : Vérifier qu'aucune référence CSS survivante ne pointe vers ces classes**

  ```powershell
  Select-String -Path "frontend/src/style.css","frontend/src/*.js","frontend/index.html" -Pattern "view-enter|view-leave|viewIn|viewOut" 2>$null
  ```
  Attendu : aucun résultat (ou uniquement dans des commentaires explicatifs de suppression).

- [ ] **Step 3 : Lancer les tests**

  ```powershell
  npm test
  ```
  Attendu : tous les tests passent.

- [ ] **Step 4 : Commit**

  ```powershell
  git add frontend/src/style.css
  git commit -m "refactor(style): remove unused view-enter/leave CSS (replaced by GSAP transitionViews)"
  ```

---

## Task 4 : Régénérer les snapshots visuels Playwright

**Fichiers :**
- Modifier : `frontend/tests/visual/` (fichiers `.png`)

Les snapshots Playwright seront invalidés par les changements d'animation (timing, comportement visuel légèrement différent).

- [ ] **Step 1 : Vérifier que le build de dev démarre**

  ```powershell
  npm run dev
  ```
  Laisser tourner en arrière-plan (ou dans un terminal séparé). Attendre que Tauri soit prêt.

- [ ] **Step 2 : Mettre à jour les snapshots**

  Dans un second terminal :
  ```powershell
  npx playwright test --update-snapshots
  ```
  Si le script dédié existe :
  ```powershell
  npm run test:visual:update
  ```
  Attendu : snapshots régénérés sans erreur. Ignorer les warnings sur les animations (GSAP n'est pas visible dans les snapshots statiques).

- [ ] **Step 3 : Lancer la suite complète**

  ```powershell
  npm test
  ```
  Attendu : tout passe, y compris les tests visuels avec les nouveaux snapshots.

- [ ] **Step 4 : Commit**

  ```powershell
  git add frontend/tests/visual/
  git commit -m "test(visual): update snapshots after GSAP view transition refactor"
  ```

---

## Self-Review

**Spec coverage :**
- [x] Root cause 1 (wrong containing block) → Task 1 (`position: relative` sur `#main`)
- [x] Root cause 2 (double animation VT API) → Task 2 (`_showViewRaw` : VT path fait un swap pur)
- [x] Root cause 3 (`animationend` non-fiable) → Task 2 (GSAP `onComplete` remplace l'écouteur)
- [x] GSAP cross-fade 150ms / 220ms → Task 2 (`transitionViews`)
- [x] `prefers-reduced-motion` → Task 2 (`prefersReducedMotion()` check dans `transitionViews`)
- [x] Nettoyage CSS → Task 3
- [x] Snapshots → Task 4

**Placeholder scan :** aucun TBD/TODO/placeholder.

**Type consistency :** `transitionViews(prev, next)` nommé identiquement dans `motion.js` (Task 2A) et `views.js` (Task 2B). Import ajouté dans `views.js` au Step 3 avant utilisation au Step 4.

**Risk flag :** Si `views.js` n'importe pas encore `motion.js`, le Step 3 crée l'import. Vérifier avec `Select-String -Path "frontend/src/views.js" -Pattern "from './motion"` avant le Step 3.
