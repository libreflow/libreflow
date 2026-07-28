# Mode cinéma — repositionnement en grille CSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruire le positionnement de `#cinema-overlay` sur `display:grid` avec des zones nommées (corner-l, corner-r, side-l, hero, side-r) pour rendre les collisions structurellement impossibles, harmoniser les insets, et remplacer le masquage d'éléments aux petites tailles par une adaptation gracieuse (piste suivante/accès file d'attente → bouton icône seule au lieu de disparaître).

**Architecture:** `#cinema-overlay` passe de `display:flex; flex-direction:column` + `position:absolute` épars à `display:grid` avec `grid-template-areas`. Trois nouveaux wrappers `<div>` dans `index.html` (`.cinema-corner-r`, `.cinema-hero`, `.cinema-side-r`) donnent une cellule de grille unique à des groupes d'éléments existants, sans toucher à leurs IDs/classes/attributs ni au JS qui les cible. `#cinema-queue-panel` passe d'un ancrage viewport-edge à un ancrage relatif à son nouveau parent `.cinema-side-r`. Aux petites tailles, `.cinema-next`/`.cinema-shuffle-hint` se réduisent en bouton rond icône seule au lieu de disparaître.

**Tech Stack:** HTML statique (`frontend/index.html`), CSS pur (`frontend/src/style.css`, `frontend/src/design-system.css`), tests `node:assert` CJS (`frontend/tests/core.test.cjs`, pattern `read()`/regex déjà établi dans ce fichier).

## Global Constraints

- Aucun changement de style visuel (couleurs, glass, ombres, typographie, animations) — uniquement le mécanisme de positionnement (CLAUDE.md §16, §20 — minimalisme).
- Aucun ID/classe/attribut existant modifié ou supprimé sur les éléments déplacés dans les nouveaux wrappers — zéro changement de câblage JS requis.
- `cinema-loop.js` / `cinema-bg.js` / `cinema-viz.js` / `cinema-input.js` / `cinema-queue.js` (logique) restent intouchés — seul l'ancrage CSS du panneau file d'attente change.
- Aucun `console.log` commité (CLAUDE.md §14).
- Aucun réseau (`fetch`, `XMLHttpRequest`, `WebSocket`) — non applicable ici, aucun changement ne s'en approche.
- Tests style maison : `node:assert`, scans regex sur le contenu des fichiers via le helper `read()` déjà établi dans `core.test.cjs` (`fs.readFileSync(path.join(root, f), 'utf8')`) — pattern à réutiliser tel quel, pas de nouvelle dépendance de test.
- WCAG : le bouton `#cinema-next` conserve `aria-expanded`/`aria-controls`/`aria-label` intacts après ajout de l'icône compacte ; la nouvelle icône `.cn-icon` est `aria-hidden="true"` (décorative, le nom accessible reste porté par le bouton).
- Commits conventionnels `<type>(<scope>): <description>`, pas d'attribution.
- `npm test` vert à chaque commit ; `npm run bench` non régressé (changement de layout pur, aucun impact rAF/canvas attendu).

---

## File Map

| Fichier | Changements (tâches) |
|---|---|
| `frontend/index.html` | T1 : 3 wrappers (`.cinema-corner-r`, `.cinema-hero`, `.cinema-side-r`) ; T3 : icône `.cn-icon` dans `#cinema-next` |
| `frontend/src/style.css` | T2 : `#cinema-overlay` en grid, zones nommées, repositionnement clock/next/queue-panel/corner-btn ; T3 : media query compacte |
| `frontend/src/design-system.css` | T2 : suppression du token mort `--cinema-fs-right`, commentaire `--cinema-clock-inset` mis à jour |
| `frontend/tests/core.test.cjs` | T1, T2, T3 : nouvelles sections de scan |

**Séquencement :** T1 (DOM) → T2 (grid + zones, cœur du rework) → T3 (comportement compact) → T4 (gate smoke manuel). Chaque tâche = un commit indépendant vérifiable.

---

## Task 1: Wrappers DOM (`.cinema-corner-r`, `.cinema-hero`, `.cinema-side-r`)

**Files:**
- Modify: `frontend/index.html:1358-1393` (piste suivante / panneau file d'attente / hint shuffle)
- Modify: `frontend/index.html:1396-1473` (boutons de coin fs+close, puis pochette/infos/progression/contrôles)
- Modify: `frontend/tests/core.test.cjs`

**Interfaces:**
- Produces: 3 nouveaux wrappers dans le DOM (`.cinema-corner-r`, `.cinema-hero`, `.cinema-side-r`), consommés par les règles de grille de la Task 2. Aucun export JS.

Ordre actuel dans le DOM (inchangé par cette tâche — seuls des `<div>` enveloppants sont insérés) : horloge, **[piste-suivante, panneau-file-d'attente, hint-shuffle]**, bouton fond, **[fs, close]**, pochette, infos, progression, contrôles.

- [ ] **Step 1 (TDD) : test d'ordre/structure des wrappers**

Ajouter à la fin de `frontend/tests/core.test.cjs`, juste après le bloc `catch` qui ferme la section `cinema Task 7` (juste avant le commentaire `// -- Résultat -----`) :

```js
  // =============================================================================
  // cinema layout grid — repositionnement en grille (2026-07-05)
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 1 -- wrappers corner-r / hero / side-r');

    const HTML1 = read('frontend/index.html');
    const iClock      = HTML1.indexOf('id="cinema-clock"');
    const iSideR      = HTML1.indexOf('class="cinema-side-r"');
    const iNext       = HTML1.indexOf('id="cinema-next"');
    const iQueuePanel = HTML1.indexOf('id="cinema-queue-panel"');
    const iShuffle    = HTML1.indexOf('id="cinema-shuffle-hint"');
    const iBgBtn      = HTML1.indexOf('id="cinema-bg-btn"');
    const iCornerR    = HTML1.indexOf('class="cinema-corner-r"');
    const iFsBtn      = HTML1.indexOf('id="cinema-fs-btn"');
    const iClose      = HTML1.indexOf('cinema-close');
    const iHero       = HTML1.indexOf('class="cinema-hero"');
    const iArtWrap    = HTML1.indexOf('id="cinema-art-wrap"');
    const iInfo       = HTML1.indexOf('id="cinema-info"');
    const iProg       = HTML1.indexOf('class="cinema-prog"');
    const iControls   = HTML1.indexOf('id="cinema-controls"');

    const allFound = [iClock, iSideR, iNext, iQueuePanel, iShuffle, iBgBtn, iCornerR,
      iFsBtn, iClose, iHero, iArtWrap, iInfo, iProg, iControls].every(i => i !== -1);
    assert(allFound,
      'index.html: horloge, les 3 wrappers et tous leurs enfants existent');

    assert(allFound && iClock < iSideR && iSideR < iNext && iNext < iQueuePanel && iQueuePanel < iShuffle,
      '.cinema-side-r precede piste-suivante < panneau-file-d\'attente < hint-shuffle, apres l\'horloge');
    assert(allFound && iShuffle < iBgBtn && iBgBtn < iCornerR && iCornerR < iFsBtn && iFsBtn < iClose,
      '#cinema-bg-btn reste hors wrapper, suivi de .cinema-corner-r contenant fs-btn < close');
    assert(allFound && iClose < iHero && iHero < iArtWrap && iArtWrap < iInfo && iInfo < iProg && iProg < iControls,
      '.cinema-hero contient art-wrap < info < prog < controls, apres .cinema-corner-r');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 1 scans crashed:', e.message);
    _ko++;
  }
```

- [ ] **Step 2 : vérifier que le test échoue**

Run: `npm test 2>&1 | grep -A20 "cinema layout grid Task 1"`
Expected: plusieurs lignes `✗` (les wrappers n'existent pas encore) ou un crash du bloc `try` (indexOf renvoie `-1`, `allFound` est `false`).

- [ ] **Step 3 : ajouter le wrapper `.cinema-side-r`**

Dans `frontend/index.html`, remplacer (le commentaire multi-lignes précédant `#cinema-next` et le `<div id="cinema-shuffle-hint">` fermant sont les bornes) :

```html
  <!-- Piste suivante (bottom-right, avec les contrôles) — Task 9 : bouton dépliant le
       panneau file d'attente (#cinema-queue-panel). Pas d'attribut hidden sur ce
       bouton : la visibilité est gérée via .cin-has-next + opacity CSS (display:none
       casse les transitions opacity) ; renderCinNextPanel() bascule aussi .disabled
       pour éviter un focus fantôme quand aucune piste suivante n'est prévisible. -->
  <button type="button" id="cinema-next" class="cinema-next" aria-expanded="false" aria-controls="cinema-queue-panel" aria-label="Afficher la file d'attente" data-i18n-aria="aria_cinema_queue_toggle">
```

par :

```html
  <!-- Task 1 (layout grid) : wrapper -- zone de grille side-r (Task 2). Regroupe
       piste-suivante/hint-shuffle (superposés, un seul visible via opacity togglée
       en JS) et le panneau file d'attente (ancré relativement à ce wrapper). -->
  <div class="cinema-side-r">
  <!-- Piste suivante (bottom-right, avec les contrôles) — Task 9 : bouton dépliant le
       panneau file d'attente (#cinema-queue-panel). Pas d'attribut hidden sur ce
       bouton : la visibilité est gérée via .cin-has-next + opacity CSS (display:none
       casse les transitions opacity) ; renderCinNextPanel() bascule aussi .disabled
       pour éviter un focus fantôme quand aucune piste suivante n'est prévisible. -->
  <button type="button" id="cinema-next" class="cinema-next" aria-expanded="false" aria-controls="cinema-queue-panel" aria-label="Afficher la file d'attente" data-i18n-aria="aria_cinema_queue_toggle">
```

Puis fermer le wrapper juste après la fin de `#cinema-shuffle-hint`, en remplaçant :

```html
      <span data-i18n="cinema_shuffle_on">Lecture aléatoire</span>
    </div>
  </div>

  <!-- Boutons de coin -->
```

par :

```html
      <span data-i18n="cinema_shuffle_on">Lecture aléatoire</span>
    </div>
  </div>
  </div>

  <!-- Boutons de coin -->
```

- [ ] **Step 4 : ajouter le wrapper `.cinema-corner-r`**

Remplacer :

```html
  <button id="cinema-fs-btn" class="cinema-corner-btn" data-action="cinema-fullscreen" title="" data-i18n-title="t_cinema_fs" data-i18n-aria="aria_cinema_fs" aria-label="Basculer en plein écran">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
  </button>
  <button class="cinema-close cinema-corner-btn" data-action="close-cinema" title="" data-i18n-title="t_cinema_close" data-i18n-aria="aria_cinema_close" aria-label="Fermer le mode cinéma">
    <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>

  <div class="cinema-art-wrap" id="cinema-art-wrap">
```

par :

```html
  <!-- Task 1 (layout grid) : wrapper -- zone de grille corner-r (Task 2). -->
  <div class="cinema-corner-r">
    <button id="cinema-fs-btn" class="cinema-corner-btn" data-action="cinema-fullscreen" title="" data-i18n-title="t_cinema_fs" data-i18n-aria="aria_cinema_fs" aria-label="Basculer en plein écran">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
    </button>
    <button class="cinema-close cinema-corner-btn" data-action="close-cinema" title="" data-i18n-title="t_cinema_close" data-i18n-aria="aria_cinema_close" aria-label="Fermer le mode cinéma">
      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>

  <!-- Task 1 (layout grid) : wrapper -- zone de grille hero (Task 2). -->
  <div class="cinema-hero">
  <div class="cinema-art-wrap" id="cinema-art-wrap">
```

- [ ] **Step 5 : fermer le wrapper `.cinema-hero`**

Remplacer (fin de `.cinema-controls`, juste avant la fermeture de `#cinema-overlay`) :

```html
      </div>
    </div>
  </div>
</div>

<!-- SHORTCUTS PANEL — a11y: dialog complet (BLOCKER fix audit 2026-05-19) -->
```

par :

```html
      </div>
    </div>
  </div>
  </div>
</div>

<!-- SHORTCUTS PANEL — a11y: dialog complet (BLOCKER fix audit 2026-05-19) -->
```

(Le dernier `</div>` de `.cinema-vol-wrap` → `.cinema-vol-bar` → `.cinema-controls` reste tel quel ; on ajoute une fermeture supplémentaire pour `.cinema-hero` juste avant `</div>` de `#cinema-overlay`.)

- [ ] **Step 6 : vérifier que le test passe**

Run: `npm test 2>&1 | grep -A5 "cinema layout grid Task 1"`
Expected: 3 lignes `✓`.

- [ ] **Step 7 : suite complète + commit**

Run: `npm test`
Expected: tous les tests passent (aucune régression — ces wrappers sont neutres tant que la Task 2 n'a pas converti `#cinema-overlay` en grid ; visuellement inchangé pour l'instant car `display:flex` sur l'overlay traite les wrappers comme des blocs enfants ordinaires).

```bash
git add frontend/index.html frontend/tests/core.test.cjs
git commit -m "refactor(cinema): add corner-r/hero/side-r layout wrappers (no visual change yet)"
```

---

## Task 2: `#cinema-overlay` en grid + zones nommées

**Files:**
- Modify: `frontend/src/style.css` (`#cinema-overlay`, `#cinema-clock`, `.cinema-next`, `.cinema-queue-panel`, `.cinema-corner-btn` + réglages associés)
- Modify: `frontend/src/design-system.css:666-669`
- Modify: `frontend/tests/core.test.cjs`

**Interfaces:**
- Consumes: wrappers `.cinema-corner-r` / `.cinema-hero` / `.cinema-side-r` de la Task 1.
- Produces: `#cinema-overlay` en `display:grid` avec 5 zones nommées (`corner-l`, `corner-r`, `side-l`, `hero`, `side-r`), consommées visuellement mais sans aucune interface JS.

- [ ] **Step 1 (TDD) : tests de structure de grille**

Ajouter à `core.test.cjs`, juste après le bloc Task 1 :

```js
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 2 -- #cinema-overlay grid + zones nommees');

    const CSS2 = read('frontend/src/style.css');
    const DS2  = read('frontend/src/design-system.css');

    assert(/#cinema-overlay \{[\s\S]{0,400}display: grid;/.test(CSS2),
      '#cinema-overlay passe en display:grid');
    assert(/"corner-l\s+\.\s+corner-r"/.test(CSS2) && /"side-l\s+hero\s+side-r"/.test(CSS2),
      '#cinema-overlay declare les 5 zones (corner-l/corner-r/side-l/hero/side-r) dans le bon ordre');
    assert(/padding:\s*var\(--cinema-corner-top\)\s*var\(--cinema-corner-x\)\s*var\(--cinema-clock-inset\);/.test(CSS2),
      '#cinema-overlay applique les insets harmonises via padding (corner-top/corner-x/clock-inset)');

    for (const zone of ['corner-l', 'corner-r', 'side-l', 'hero', 'side-r']) {
      const n = (CSS2.match(new RegExp(`grid-area:\\s*${zone}\\b`, 'g')) || []).length;
      assert(n === 1, `zone '${zone}' assignee exactement une fois (trouve ${n})`);
    }

    assert(/#cinema-bg-btn \{\s*\n\s*grid-area: corner-l; justify-self: start; align-self: start;/.test(CSS2),
      '#cinema-bg-btn place en corner-l (start/start)');
    assert(/\.cinema-corner-r \{\s*\n\s*grid-area: corner-r; justify-self: end; align-self: start;/.test(CSS2),
      '.cinema-corner-r place en corner-r (end/start)');
    assert(/#cinema-clock \{\s*\n\s*grid-area: side-l; justify-self: start; align-self: end;/.test(CSS2),
      '#cinema-clock place en side-l, ancre au bas de sa cellule (align-self:end)');
    assert(/\.cinema-hero \{\s*\n\s*grid-area: hero; justify-self: center; align-self: center;/.test(CSS2),
      '.cinema-hero centre vraiment (justify-self/align-self: center)');
    assert(/\.cinema-side-r \{\s*\n\s*grid-area: side-r; justify-self: end; align-self: end;/.test(CSS2),
      '.cinema-side-r place en side-r (end/end)');

    const sideRIdx = CSS2.indexOf('.cinema-side-r {');
    assert(sideRIdx !== -1 && /position: relative;/.test(CSS2.slice(sideRIdx, sideRIdx + 200)),
      '.cinema-side-r est position:relative (ancre #cinema-queue-panel)');

    assert(/\.cinema-shuffle-hint \{ position: absolute; inset: 0; \}/.test(CSS2),
      '.cinema-shuffle-hint se superpose exactement a #cinema-next (inset:0)');

    assert(!/\.cinema-corner-btn \{\s*\n\s*position: absolute;/.test(CSS2),
      '.cinema-corner-btn ne porte plus position:absolute (place par grid/flex desormais)');
    assert(!/\.cinema-close\s*\{\s*top:/.test(CSS2), "l'ancienne regle .cinema-close { top:...; right:...; } est retiree");
    assert(!/#cinema-bg-btn\s*\{\s*top:/.test(CSS2), "l'ancienne regle #cinema-bg-btn { top:...; left:...; } est retiree");
    assert(!/#cinema-fs-btn\s*\{\s*top:/.test(CSS2), "l'ancienne regle #cinema-fs-btn { top:...; right:...; } est retiree");

    const nextIdx = CSS2.indexOf('.cinema-next {');
    assert(nextIdx !== -1 && !/position: absolute; bottom: var\(--sp-8\)/.test(CSS2.slice(nextIdx, nextIdx + 150)),
      '.cinema-next ne porte plus bottom/right en dur relatif au viewport');

    const qpIdx = CSS2.indexOf('.cinema-queue-panel {');
    assert(qpIdx !== -1 && /position: absolute; bottom: calc\(100% \+ var\(--cqp-trigger-gap\)\); right: 0;/.test(CSS2.slice(qpIdx, qpIdx + 300)),
      '.cinema-queue-panel ancre a 100% (haut de .cinema-side-r) + right:0 -- decouple du viewport');

    assert(!/--cinema-fs-right/.test(DS2), 'token --cinema-fs-right retire de design-system.css (mort)');
    assert(!/--cinema-fs-right/.test(CSS2), 'token --cinema-fs-right plus reference dans style.css');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 2 scans crashed:', e.message);
    _ko++;
  }
```

- [ ] **Step 2 : vérifier que le test échoue**

Run: `npm test 2>&1 | grep -A25 "cinema layout grid Task 2"`
Expected: la plupart des lignes `✗` (aucune des règles n'existe encore).

- [ ] **Step 3 : convertir `#cinema-overlay` en grid**

Dans `frontend/src/style.css`, remplacer :

```css
#cinema-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: var(--c-black);
  display: flex; /* toujours flex — visibility/opacity gèrent l'état */
  flex-direction: column; align-items: center; justify-content: flex-start;
  /* Centre l'art à 36vh (position "hero") — laisse plus de place aux contrôles
     sans les pousser trop bas. La composition complète (art+contrôles) se centre
     autour de ~45vh, légèrement au-dessus du milieu visuel (choix intentionnel).
     Formule : padding-top = 36vh − demi-hauteur-art = 36vh − min(23vh,23vw,210px) */
  padding-top: calc(36vh - min(23vh, 23vw, 210px));
  overflow: hidden; /* empêche tout scroll interne */
  /* ── Animation d'entrée / sortie ── */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity    var(--dur-cinema) ease,
    visibility 0ms   var(--dur-cinema); /* visibility cachée après la fin du fade-out */
  cursor: none;
}
```

par :

```css
#cinema-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: var(--c-black);
  /* Task 2 (layout grid) : chaque élément a une zone nommée explicite -- les
     collisions deviennent structurellement impossibles au lieu d'être patchées
     par breakpoint. Colonnes extérieures égales (1fr/1fr) : le héros reste centré
     même si l'horloge (gauche) et la carte piste-suivante (droite) ont des
     largeurs différentes. */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "corner-l .    corner-r"
    "side-l   hero side-r";
  /* Insets harmonisés : mêmes tokens que les boutons de coin pour corner-l/r,
     même token que l'horloge pour le bas (side-l/side-r) -- avant ce commit,
     .cinema-next/.cinema-queue-panel utilisaient --sp-8 (32px fixe) au lieu de
     --cinema-clock-inset (clamp 40-80px), écart non intentionnel. */
  padding: var(--cinema-corner-top) var(--cinema-corner-x) var(--cinema-clock-inset);
  overflow: hidden; /* empêche tout scroll interne */
  /* ── Animation d'entrée / sortie ── */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity    var(--dur-cinema) ease,
    visibility 0ms   var(--dur-cinema); /* visibility cachée après la fin du fade-out */
  cursor: none;
}
```

- [ ] **Step 4 : repositionner `#cinema-clock`**

Remplacer :

```css
#cinema-clock {
  position: absolute; bottom: var(--cinema-clock-inset); left: var(--cinema-clock-inset); z-index: 5;
  opacity: 0; transform: translateY(var(--sp-2));
  transition: opacity var(--dur-reveal) ease, transform var(--dur-reveal) ease;
  pointer-events: none;
}
```

par :

```css
#cinema-clock {
  grid-area: side-l; justify-self: start; align-self: end; z-index: 5;
  opacity: 0; transform: translateY(var(--sp-2));
  transition: opacity var(--dur-reveal) ease, transform var(--dur-reveal) ease;
  pointer-events: none;
}
```

- [ ] **Step 5 : `.cinema-next` en flux normal dans `.cinema-side-r`**

Remplacer :

```css
.cinema-next {
  position: absolute; bottom: var(--sp-8); right: var(--sp-8); z-index: 5;
  background: var(--cin-surface);
```

par :

```css
.cinema-next {
  z-index: 5;
  background: var(--cin-surface);
```

- [ ] **Step 6 : ancrer `.cinema-queue-panel` relativement à `.cinema-side-r`**

Remplacer :

```css
.cinema-queue-panel {
  position: absolute; bottom: calc(var(--sp-8) + var(--cqp-trigger-gap)); right: var(--sp-8);
  z-index: 6;
```

par :

```css
.cinema-queue-panel {
  /* Task 2 (layout grid) : ancré relativement à .cinema-side-r (position:relative)
     au lieu du bord du viewport -- découplé de tout inset dupliqué. */
  position: absolute; bottom: calc(100% + var(--cqp-trigger-gap)); right: 0;
  z-index: 6;
```

- [ ] **Step 7 : boutons de coin + nouvelles zones de grille**

Remplacer tout le bloc :

```css
/* ── Boutons de coin (close + bg + fs) ────────────────────── */
.cinema-corner-btn {
  position: absolute; z-index: 10;
  background: var(--cin-surface-hover); border: none;
  width: var(--btn-h-lg); height: var(--btn-h-lg); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.55); cursor: pointer;
  backdrop-filter: blur(var(--blur-8));
  -webkit-backdrop-filter: blur(var(--blur-8));
  /* État initial (masqué) */
  opacity: 0;
  transform: translateY(calc(-1 * var(--sp-3)));
  pointer-events: none;
  /* Transition unifiée : hover bg/color rapide + animation entrée/sortie + hover/press scale */
  transition: background var(--motion-fast) var(--ease-standard),
              transform var(--motion-fast) var(--ease-standard), color var(--dur-fast) ease,
              opacity var(--dur-overlay) ease;
}
.cinema-corner-btn:hover { background: rgba(255,255,255,.2); color: var(--text-on-accent); transform: scale(1.08); }
.cinema-corner-btn:active { transform: scale(0.95); }
.cinema-corner-btn:focus-visible { outline: none; box-shadow: var(--cin-focus-ring); }
.cinema-corner-btn svg   { width: var(--icon-lg); height: var(--icon-lg); }
.cinema-close  { top: var(--cinema-corner-top); right: var(--cinema-corner-x); }
.cinema-close svg { stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; width: var(--icon-md); height: var(--icon-md); }
#cinema-bg-btn { top: var(--cinema-corner-top); left: var(--cinema-corner-x); }
#cinema-fs-btn { top: var(--cinema-corner-top); right: var(--cinema-fs-right); } /* entre bg-btn et close */
```

par :

```css
/* ── Boutons de coin (close + bg + fs) ────────────────────── */
.cinema-corner-btn {
  z-index: 10;
  background: var(--cin-surface-hover); border: none;
  width: var(--btn-h-lg); height: var(--btn-h-lg); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.55); cursor: pointer;
  backdrop-filter: blur(var(--blur-8));
  -webkit-backdrop-filter: blur(var(--blur-8));
  /* État initial (masqué) */
  opacity: 0;
  transform: translateY(calc(-1 * var(--sp-3)));
  pointer-events: none;
  /* Transition unifiée : hover bg/color rapide + animation entrée/sortie + hover/press scale */
  transition: background var(--motion-fast) var(--ease-standard),
              transform var(--motion-fast) var(--ease-standard), color var(--dur-fast) ease,
              opacity var(--dur-overlay) ease;
}
.cinema-corner-btn:hover { background: rgba(255,255,255,.2); color: var(--text-on-accent); transform: scale(1.08); }
.cinema-corner-btn:active { transform: scale(0.95); }
.cinema-corner-btn:focus-visible { outline: none; box-shadow: var(--cin-focus-ring); }
.cinema-corner-btn svg   { width: var(--icon-lg); height: var(--icon-lg); }
.cinema-close svg { stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; width: var(--icon-md); height: var(--icon-md); }

/* ── Zones de grille (Task 2 -- repositionnement cinéma) ──────────────────
   Chaque zone nommée est assignée exactement une fois -- les collisions sont
   structurellement impossibles (cf. grid-template-areas de #cinema-overlay). */
#cinema-bg-btn {
  grid-area: corner-l; justify-self: start; align-self: start;
}
.cinema-corner-r {
  grid-area: corner-r; justify-self: end; align-self: start;
  display: flex; align-items: center; gap: var(--sp-2);
}
.cinema-hero {
  grid-area: hero; justify-self: center; align-self: center;
  display: flex; flex-direction: column; align-items: center;
}
.cinema-side-r {
  grid-area: side-r; justify-self: end; align-self: end;
  position: relative; /* ancre #cinema-queue-panel (bottom:100% relatif à cette boîte) */
}
/* .cinema-shuffle-hint partage la classe .cinema-next (même carte visuelle) mais doit
   se superposer EXACTEMENT à #cinema-next plutôt que s'empiler dessous en flux normal
   -- seul l'un des deux est visible à la fois (opacity togglée en JS, cinema.js). */
.cinema-shuffle-hint { position: absolute; inset: 0; }
```

- [ ] **Step 8 : retirer le token mort `--cinema-fs-right`**

Dans `frontend/src/design-system.css`, remplacer :

```css
  --cinema-corner-top:  clamp(16px, 2vh, 32px);   /* inset top boutons coin cinéma */
  --cinema-corner-x:    clamp(20px, 2.5vw, 48px); /* inset horizontal principal coin cinéma */
  --cinema-fs-right:    72px;   /* inset right bouton fullscreen cinéma */
  --cinema-clock-inset: clamp(40px, 5vh, 80px);   /* position horloge idle + panneau next */
```

par :

```css
  --cinema-corner-top:  clamp(16px, 2vh, 32px);   /* inset top boutons coin cinéma */
  --cinema-corner-x:    clamp(20px, 2.5vw, 48px); /* inset horizontal principal coin cinéma */
  --cinema-clock-inset: clamp(40px, 5vh, 80px);   /* insets bas de #cinema-overlay -- horloge (side-l) ET piste suivante/file d'attente (side-r), harmonisés (Task 2 layout grid) */
```

- [ ] **Step 9 : vérifier que le test passe**

Run: `npm test 2>&1 | grep -A25 "cinema layout grid Task 2"`
Expected: toutes les lignes `✓`.

- [ ] **Step 10 : suite complète + smoke rapide + commit**

Run: `npm test`
Expected: tous les tests passent.

Smoke rapide (`npm run dev`, ouvrir le mode cinéma en plein format) : pochette/titre/progression/contrôles centrés, horloge idle bas-gauche, piste suivante/file d'attente bas-droite, boutons de coin en haut — visuellement équivalent à avant (mécanisme différent, résultat identique en plein format).

```bash
git add frontend/src/style.css frontend/src/design-system.css frontend/tests/core.test.cjs
git commit -m "refactor(cinema): reposition #cinema-overlay via CSS grid named areas"
```

---

## Task 3: Comportement compact — piste suivante/accès file d'attente en icône seule

**Files:**
- Modify: `frontend/index.html:1358-1367` (`#cinema-next` — ajout de l'icône compacte)
- Modify: `frontend/src/style.css` (nouvelle règle `.cn-icon` + media query compacte)
- Modify: `frontend/tests/core.test.cjs`

**Interfaces:**
- Consumes: `.cinema-next` / `.cinema-shuffle-hint` (Task 2, déjà repositionnés dans `.cinema-side-r`).
- Produces: aucune nouvelle interface JS — comportement purement CSS/HTML. Le bouton `#cinema-next` garde exactement les mêmes attributs `aria-*`.

- [ ] **Step 1 (TDD) : tests icône compacte**

Ajouter à `core.test.cjs`, après le bloc Task 2 :

```js
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 3 -- next/queue-access compact icon-only');

    const CSS3 = read('frontend/src/style.css');
    const HTML3 = read('frontend/index.html');

    const nextBtnIdx = HTML3.indexOf('id="cinema-next"');
    const nextBtnEnd = HTML3.indexOf('</button>', nextBtnIdx);
    assert(nextBtnIdx !== -1 && nextBtnEnd !== -1,
      '#cinema-next: bouton localise (ouverture + fermeture)');
    const nextBtnBody = HTML3.slice(nextBtnIdx, nextBtnEnd);
    assert(/class="cn-icon"/.test(nextBtnBody),
      '#cinema-next contient une icone .cn-icon (mode compact) avant sa fermeture');
    assert(/aria-hidden="true"/.test(nextBtnBody.slice(nextBtnBody.indexOf('class="cn-icon"'))),
      '.cn-icon est aria-hidden (decorative, le nom accessible reste porte par le bouton)');
    assert(/aria-expanded="false"/.test(nextBtnBody) && /aria-controls="cinema-queue-panel"/.test(nextBtnBody) &&
      /aria-label="Afficher la file d'attente"/.test(nextBtnBody),
      '#cinema-next conserve aria-expanded/aria-controls/aria-label apres ajout de .cn-icon');

    assert(/\.cn-icon \{ display: none;/.test(CSS3),
      '.cn-icon masquee par defaut (pleine taille)');
    assert(/@media \(max-width: 700px\), \(max-height: 640px\) \{/.test(CSS3),
      'media query compacte next/queue-access (700px largeur OU 640px hauteur)');
    assert(/\.cinema-next \.cn-icon \{ display: block; \}/.test(CSS3),
      '.cinema-next .cn-icon visible en mode compact');
    assert(/border-radius: 50%;/.test(CSS3.slice(CSS3.indexOf('@media (max-width: 700px)'), CSS3.indexOf('@media (max-width: 700px)') + 500)),
      'le bloc compact force un bouton rond (border-radius:50%)');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 3 scans crashed:', e.message);
    _ko++;
  }
```

- [ ] **Step 2 : vérifier que le test échoue**

Run: `npm test 2>&1 | grep -A15 "cinema layout grid Task 3"`
Expected: plusieurs lignes `✗`.

- [ ] **Step 3 : ajouter l'icône compacte dans `#cinema-next`**

Dans `frontend/index.html`, remplacer :

```html
  <button type="button" id="cinema-next" class="cinema-next" aria-expanded="false" aria-controls="cinema-queue-panel" aria-label="Afficher la file d'attente" data-i18n-aria="aria_cinema_queue_toggle">
    <div class="cn-label">Suivant</div>
    <div class="cn-body">
      <img id="cinema-next-img" class="cn-img" alt="">
      <div class="cn-info">
        <div id="cinema-next-title" class="cn-title">–</div>
        <div id="cinema-next-artist" class="cn-artist">–</div>
      </div>
    </div>
  </button>
```

par :

```html
  <button type="button" id="cinema-next" class="cinema-next" aria-expanded="false" aria-controls="cinema-queue-panel" aria-label="Afficher la file d'attente" data-i18n-aria="aria_cinema_queue_toggle">
    <div class="cn-label">Suivant</div>
    <div class="cn-body">
      <img id="cinema-next-img" class="cn-img" alt="">
      <div class="cn-info">
        <div id="cinema-next-title" class="cn-title">–</div>
        <div id="cinema-next-artist" class="cn-artist">–</div>
      </div>
    </div>
    <!-- Task 3 (layout grid) : icone seule visible en mode compact (media query
         plus bas) -- accès file d'attente toujours possible au lieu de disparaître. -->
    <svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <line x1="4" y1="18" x2="14" y2="18"/>
    </svg>
  </button>
```

- [ ] **Step 4 : ajouter la règle `.cn-icon` + media query compacte**

Dans `frontend/src/style.css`, remplacer :

```css
.cn-artist { font-size: var(--fs-sm); color: rgba(255,255,255,.65); margin-top: var(--sp-1q); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

par :

```css
.cn-artist { font-size: var(--fs-sm); color: rgba(255,255,255,.65); margin-top: var(--sp-1q); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cn-icon { display: none; width: var(--icon-lg); height: var(--icon-lg); flex-shrink: 0; }

/* ── Compact : piste suivante / hint shuffle → bouton icône seule (Task 3) ──
   En dessous de ces seuils, la carte riche (vignette+titre/artiste, ou texte du
   hint shuffle) ne tient plus sans chevaucher la pill de contrôles ou le texte
   titre/artiste. Plutôt que masquer l'accès à la file d'attente (perte
   fonctionnelle), on le réduit à un bouton rond icône seule, même gabarit que
   .cinema-corner-btn. Seuil largeur (700px) distinct du seuil de compaction de
   la pill de contrôles (600px, inchangé) -- c'est le point réel où la carte
   piste-suivante ne tient plus, pas où la pill se resserre. */
@media (max-width: 700px), (max-height: 640px) {
  .cinema-next, .cinema-shuffle-hint {
    width: var(--btn-h-lg); height: var(--btn-h-lg);
    min-width: 0; max-width: none;
    padding: 0; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--cin-surface-hover);
    backdrop-filter: blur(var(--blur-8));
    -webkit-backdrop-filter: blur(var(--blur-8));
    color: rgba(255,255,255,.55);
  }
  .cinema-next .cn-label,
  .cinema-next .cn-body,
  .cinema-shuffle-hint .cn-body--hint span { display: none; }
  .cinema-next .cn-icon { display: block; }
}
```

- [ ] **Step 5 : vérifier que le test passe**

Run: `npm test 2>&1 | grep -A15 "cinema layout grid Task 3"`
Expected: toutes les lignes `✓`.

- [ ] **Step 6 : a11y + suite complète + commit**

Run: `npm test && node frontend/tests/a11y.test.cjs`
Expected: tous les tests passent (aucune régression WCAG 4.1.2/2.5.3 — le bouton garde son nom accessible, seul son contenu visuel change).

```bash
git add frontend/index.html frontend/src/style.css frontend/tests/core.test.cjs
git commit -m "feat(cinema): next-track/queue-access collapses to icon button instead of hiding at compact sizes"
```

---

## Task 4: GATE — smoke manuel de fin de plan

**Files:** aucun (vérification) — corrections éventuelles en commits `fix(cinema):` dédiés.

- [ ] **Step 1 :** `npm test` + `node frontend/tests/a11y.test.cjs` + `node frontend/tests/token-source.test.cjs` + `node frontend/tests/theme-palette.test.cjs` — tous verts.
- [ ] **Step 2 :** `npm run bench` — pas de régression (changement de layout pur, aucun impact rAF/canvas attendu).
- [ ] **Step 3 (manuel, `npm run dev`) :** redimensionner la fenêtre Tauri sur toute la plage jusqu'à 600×400 (taille min réelle, `src-tauri/tauri.conf.json`) et confirmer :
  - plein format : composition identique à avant (pochette/titre/progression/contrôles centrés, horloge bas-gauche, piste suivante bas-droite, boutons de coin en haut) — aucune régression visuelle ;
  - en dessous de 700px de large OU 640px de haut : la piste suivante/accès file d'attente devient un bouton rond icône seule (toujours cliquable, ouvre bien le panneau file d'attente) au lieu de disparaître ;
  - en dessous de 640px de haut : l'horloge idle disparaît (comportement inchangé, purement décoratif) ;
  - à AUCUNE taille intermédiaire les éléments ne se chevauchent (coins, horloge, piste suivante/icône, pochette, contrôles) ;
  - le panneau file d'attente reste bien ancré juste au-dessus de son déclencheur (plein format ET icône compacte) ;
  - resize + changement d'écran : la composition suit sans artefact.
- [ ] **Step 4 :** commit éventuel des fixes ; mettre à jour `.superpowers/sdd/progress.md` avec le résumé de ce plan (nouvelle section datée, même format que les entrées existantes).

---

## Self-Review (fait par l'auteur du plan)

- **Couverture spec :** architecture grid (§1) → Task 2 ; compact behavior (§2) → Task 3 ; DOM changes (§3) → Task 1 ; "ce qui ne change pas" (§4) → contraintes globales + aucune tâche ne touche `cinema-loop.js`/`cinema-bg.js`/`cinema-viz.js`/`cinema-input.js`/`cinema-queue.js` logique ; tests (§5) → chaque tâche a sa section TDD + Task 4 couvre le smoke manuel + bench.
- **Placeholders :** aucun "TBD"/"implémenter plus tard" — chaque step contient le code exact avant/après.
- **Cohérence des types/noms :** `.cinema-corner-r`/`.cinema-hero`/`.cinema-side-r` utilisés identiquement dans les 3 tâches (DOM Task 1, CSS Task 2, référencés tels quels Task 3) ; `.cn-icon` introduit en Task 3 et nulle part avant.
- **Scope :** 4 tâches, une seule préoccupation (repositionnement), aucune dépendance sur le plan `2026-07-04-cinema-polish-structure-first.md` (Phase 2 de ce dernier reste un fil de travail séparé sur la même branche).
