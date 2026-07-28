# Mode cinéma — repositionnement en grille CSS (design)

**Date :** 2026-07-05
**Branche :** feat/cinema-overhaul
**Statut :** approuvé par l'utilisateur, prêt pour le plan d'implémentation

## Contexte

Le mode cinéma (`#cinema-overlay`, `frontend/index.html:1339-1474`) empile aujourd'hui
ses éléments via `display:flex; flex-direction:column` sur l'overlay + `position:absolute`
pour l'horloge idle (`#cinema-clock`, bas-gauche), la piste suivante/panneau file
d'attente (`.cinema-next` / `#cinema-queue-panel`, bas-droite) et les 3 boutons de coin
(`#cinema-bg-btn` haut-gauche, `#cinema-fs-btn` + `.cinema-close` haut-droite). Le centrage
vertical du bloc héros (pochette/titre/progression/contrôles) repose sur un calcul
`padding-top: calc(36vh - min(23vh, 23vw, 210px))` sur l'overlay.

Problèmes remontés par l'utilisateur :
1. **Collisions à certaines tailles** — la fenêtre Tauri descend jusqu'à 600×400px
   (`src-tauri/tauri.conf.json`). Les breakpoints existants (`max-width:600px`,
   `max-height:640px`) réagissent en **masquant** l'horloge, la piste suivante et le
   volume plutôt qu'en réorganisant — perte de fonctionnalité (accès à la file d'attente)
   plutôt que résolution du chevauchement.
2. **Espacements incohérents** — le placement des éléments flottants (horloge, piste
   suivante) utilise des valeurs `vh`/`clamp()` ad hoc sans relation structurelle avec le
   reste de la mise en page.
3. **Déséquilibre vertical** — le calcul `36vh - demi-hauteur-art` ne tient pas compte de
   la hauteur réelle de la rangée de boutons de coin ni ne s'adapte proprement aux
   variations de hauteur de fenêtre.

Décision : reconstruire le positionnement sur `display:grid` avec des zones nommées,
où chaque élément a une cellule explicite — les collisions deviennent structurellement
impossibles au lieu d'être corrigées par breakpoint.

## Architecture — zones de grille

`#cinema-overlay` passe de `display:flex` à `display:grid` :

```css
#cinema-overlay {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "corner-l  .     corner-r"
    "side-l    hero  side-r";
}
```

Les colonnes extérieures **égales** (`1fr`/`1fr`) sont ce qui garantit que le contenu
héros reste visuellement centré même si l'horloge (gauche) et la carte piste-suivante
(droite) ont des largeurs différentes — sans cette égalité, un contenu de coin plus
large que l'autre décentrerait visuellement le héros.

| Zone | Contenu | Alignement dans la cellule |
|---|---|---|
| `corner-l` | `#cinema-bg-btn` | `justify-self:start; align-self:start` |
| `corner-r` | **nouveau wrapper** `.cinema-corner-r` contenant `#cinema-fs-btn` + `.cinema-close` (flex row, gap) | `justify-self:end; align-self:start` |
| `side-l` | `#cinema-clock` | `justify-self:start; align-self:end` |
| `hero` | **nouveau wrapper** `.cinema-hero` contenant `.cinema-art-wrap` + `.cinema-info` + `.cinema-prog` + `.cinema-controls` (flex column interne, inchangée) | `justify-self:center; align-self:center` — **centrage vrai**, remplace le biais actuel légèrement au-dessus du centre (décision utilisateur : simplicité > reproduction du biais existant) |
| `side-r` | **nouveau wrapper** `.cinema-side-r` contenant `.cinema-next` + `.cinema-shuffle-hint` + `#cinema-queue-panel` | `justify-self:end; align-self:end` |

`#cinema-bg` et `#cinema-viz` (canvas plein-bleed) restent `position:absolute; inset:0`,
en dehors du flux de grille (calques de fond indépendants, inchangés).

### Panneau file d'attente — ancrage repositionné

`#cinema-queue-panel` passe d'un positionnement en dur relatif au viewport
(`bottom: calc(var(--sp-8) + var(--cqp-trigger-gap)); right: var(--sp-8)`, couplé
implicitement à la position de `#cinema-next` par coïncidence de valeurs) à un
positionnement relatif à son nouveau parent `.cinema-side-r` (`position:relative` sur
le wrapper, `position:absolute; bottom:100%; right:0` + le même `--cqp-trigger-gap` sur
le panneau) — découplé du bord du viewport, robuste à tout changement futur d'inset.

## Comportement aux tailles réduites

Deux seuils indépendants, remplaçant « masquer » par « adapter » :

- **Piloté par la hauteur** (`max-height: 640px`, seuil inchangé) : `#cinema-clock`
  continue de disparaître entièrement (purement décoratif, aucune perte fonctionnelle).
- **Piloté par la taille** (`max-width: 700px` OU `max-height: 640px` — seuil de largeur
  relevé de 600 à 700px : c'est le point réel où la carte piste-suivante ne tient plus,
  indépendant du seuil 600px existant qui compacte la pill de contrôles) :
  `.cinema-next` / `.cinema-shuffle-hint` perdent leur contenu riche (vignette +
  titre/artiste, ou texte du hint shuffle) au profit d'un **bouton rond icône seul**,
  même gabarit visuel que `.cinema-corner-btn`, avec une icône file d'attente/liste.
  Le clic ouvre toujours `#cinema-queue-panel` — mêmes attributs `aria-expanded`/
  `aria-controls`/`aria-label` (réutilise la clé i18n `aria_cinema_queue_toggle`
  existante, le nom accessible du bouton ne dépend pas de son contenu visuel).
- La compaction propre de la pill de contrôles (taille icônes, gap, masquage volume) aux
  seuils `<600px`/`601–1023px` largeur reste **inchangée** — hors périmètre de ce
  rework, fonctionne déjà correctement.

## Changements DOM requis

Trois nouveaux `<div>` wrapper dans `frontend/index.html`, **aucun** ID/classe/attribut
existant modifié sur les éléments qu'ils contiennent (aucun changement de câblage JS) :

1. `.cinema-corner-r` — enveloppe `#cinema-fs-btn` + `.cinema-close`
2. `.cinema-hero` — enveloppe `.cinema-art-wrap` + `.cinema-info` + `.cinema-prog` + `.cinema-controls`
3. `.cinema-side-r` — enveloppe `.cinema-next` + `.cinema-shuffle-hint` + `#cinema-queue-panel`

## Ce qui ne change pas

- Tout le style visuel (pills en verre, apparence des corner-btn, animations glow/breathe
  de la pochette, pulse au beat, Ken Burns, barre de progression, typographie) — ce
  rework touche uniquement le **mécanisme de positionnement**, pas l'habillage visuel.
- `cinema-loop.js` / `cinema-bg.js` / `cinema-viz.js` / `cinema-input.js` (rendu +
  input) — totalement inchangés ; seul `index.html` (structure) et `style.css`
  (règles de layout de `#cinema-overlay` et de ses wrappers de zone directs) sont
  touchés.
- `cinema-queue.js` — seul l'ancrage CSS du panneau change (relatif à son nouveau
  wrapper au lieu du bord du viewport) ; la logique d'ouverture/fermeture/rendu est
  inchangée.

## Tests

- `core.test.cjs` :
  - scan structurel : `grid-template-areas` de `#cinema-overlay` ne contient aucune
    zone dupliquée en dehors des cas volontaires (aucun ici — chaque zone nommée
    n'apparaît qu'une fois) ;
  - scan : les 3 nouveaux wrappers existent dans `index.html` et contiennent bien
    leurs enfants respectifs ;
  - scan : le bouton icône-seule de la piste suivante en mode compact référence bien
    `aria-expanded`/`aria-controls="cinema-queue-panel"` (parité avec la version pleine
    taille).
- A11y (`a11y.test.cjs`) : le bouton icône-seule conserve un nom accessible
  (`aria-label`/`data-i18n-aria`) — pas de régression WCAG 4.1.2/2.5.3.
- `token-source.test.cjs` / `theme-palette.test.cjs` / `npm run bench` : exécutés comme
  d'habitude, non affectés par un changement de layout pur.
- Smoke manuel : redimensionner jusqu'à 600×400 (taille min réelle de la fenêtre Tauri)
  et confirmer l'absence de chevauchement/clipping sur toute la plage intermédiaire,
  à la fois en compression largeur et hauteur ; vérifier le panneau file d'attente
  toujours correctement ancré au-dessus de son déclencheur (plein format ET icône
  compacte).

## Hors périmètre

- Aucun changement de style visuel (couleurs, glass, ombres, typographie).
- Aucun changement à la boucle de rendu (`cinema-loop.js` et renderers passifs).
- Aucun changement aux seuils de compaction de la pill de contrôles (`<600px`/
  `601–1023px` largeur) — déjà fonctionnels, non touchés.
- Le Task 8 (gate smoke manuel de la Cinema Polish Cycle 2) et les Tasks 9-27 du plan
  `docs/superpowers/plans/2026-07-04-cinema-polish-structure-first.md` restent un fil
  de travail séparé — ce rework de positionnement est un plan indépendant sur la même
  branche.
