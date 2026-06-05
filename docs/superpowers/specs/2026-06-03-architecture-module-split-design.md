# Architecture — Module splitting + Lit Phase 1

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope:** Réduire les 3 modules >800 lignes (i18n, renderer, playlists) par extraction de sous-modules ciblés, puis migrer les modales vers `<lf-modal>` (Lit Phase 1).

---

## 1. Problème

7 modules dépassent le hard cap CLAUDE.md §16 (800 lignes). Parmi eux, 3 ne sont pas "complexes" — ils sont mal découpés : des responsabilités distinctes cohabitent dans un seul fichier, ce qui alourdit chaque modification et rend le code difficile à naviguer.

| Module | Lignes | Diagnostic |
|---|---|---|
| `i18n.js` | 1538 | ~1450 lignes de data pure (dict fr + en) noient ~80 lignes de logique |
| `playlists.js` | 1382 | CRUD, gestion dossiers, hero + modales mélangés |
| `renderer.js` | 1279 | Helpers track, grilles, core render + stats mélangés |

---

## 2. Décisions techniques

| Décision | Choix | Raison |
|---|---|---|
| Approche | Refactor de frontières — aucune logique modifiée | Préserve les invariants CLAUDE.md §2, risque minimal |
| Call sites | Préservés via re-exports barrel dans le module racine | Zéro touche aux importeurs existants |
| Ordre | i18n → renderer → playlists → Lit Phase 1 | Du plus simple au plus couplé |
| Nouvelle tech | Lit 3.x pour `<lf-modal>` uniquement (déjà dans `dependencies`) | Pas de nouvelle dépendance |
| Modules exclus | `virt.js`, `player.js`, `app.js`, `cinema.js`, `eq.js` — intacts | CLAUDE.md §18 exclusions permanentes |

---

## 3. PR 1 — `i18n.js` : data vs logique

### Diagnostic

`i18n.js` a deux rôles sans rapport :
- **~1450 lignes** : deux dictionnaires d'objets JS pure data (`LANGS.fr`, `LANGS.en`)
- **~80 lignes** : la logique réelle (`i18n()`, `initLang()`, `setLang()`, `getLang()`, `applyLang()`)

### Découpage cible

```
frontend/src/
├── i18n.fr.js      export const fr = { ... }    (~710 lignes, zéro import)
├── i18n.en.js      export const en = { ... }    (~720 lignes, zéro import)
└── i18n.js         import { fr } from './i18n.fr.js'
                    import { en } from './i18n.en.js'
                    export const LANGS = { fr, en }
                    + initLang / getLang / setLang / i18n / applyLang
                    (~90 lignes)
```

### Contrat préservé

`LANGS`, `i18n`, `initLang`, `setLang`, `getLang`, `applyLang` restent tous exportés depuis `i18n.js`. Aucun call site modifié.

### Risque

Quasi nul — déplacement de data pure, aucune logique modifiée.

---

## 4. PR 2 — `renderer.js` : trois familles d'exports

### Diagnostic

| Famille | Exports | Lignes approx. |
|---|---|---|
| **Helpers track** — fabriquer une ligne, patches DOM | `thtml`, `hlText`, `artPlaceholder`, `makeLikeBtn`, `makeAddBtn`, `patchActiveTrack`, `patchPlayState`, `patchTrackEl` | ~230 |
| **Grilles + navigation drill** — albums, artistes, playlists, breadcrumb | `renderAlbumsGrid`, `renderArtistsGrid`, `renderPlaylistsGrid`, `drillDown`, `updatePlActionBar`, `updateBreadcrumb`, `renderFormatChips`, `invalidateGridMaps` | ~530 |
| **Core lib + virt + stats** — moteur principal | `renderLib`, `virtRenderWindow`, `virtAttachScroll`, `_showSkeletonRows`, `updateStats`, `scheduleStatsUpdate`, `updateSidebarCounts`, `animateViewChange`, `scrollToCurrentTrack`, `_withVT`, `playById` | ~520 |

### Découpage cible

```
frontend/src/
├── renderer-track.js   helpers HTML track row + DOM patches            (~230 lignes)
├── renderer-grids.js   grilles + drill-down + action bar + breadcrumb  (~530 lignes)
└── renderer.js         renderLib + virtual scroll + stats + animations  (~520 lignes)
```

`renderer-grids.js` reste à ~530 lignes car ses fonctions partagent les caches `_albumMapCache` / `_artistMapCache` et l'`IntersectionObserver` d'artwork — les séparer forcerait à exporter ces états internes.

### Dépendances après split

```
renderer-track.js   ← feuille : aucun import vers les deux autres
renderer-grids.js   ← importe thtml, artPlaceholder depuis renderer-track.js
renderer.js         ← importe thtml depuis renderer-track.js
```

Re-exports barrel dans `renderer.js` pour zéro touche aux call sites :

```js
export { thtml, hlText, artPlaceholder, makeLikeBtn, makeAddBtn,
         patchActiveTrack, patchPlayState, patchTrackEl } from './renderer-track.js'
export { renderAlbumsGrid, renderArtistsGrid, renderPlaylistsGrid,
         drillDown, updatePlActionBar, updateBreadcrumb,
         renderFormatChips, invalidateGridMaps }          from './renderer-grids.js'
```

### Risque

**Moyen.** Les imports circulaires existants (`player.js`, `views.js`) restent dans `renderer.js` uniquement. Vérifier `vite build` avant de merger.

---

## 5. PR 3 — `playlists.js` : données, dossiers, UI

### Diagnostic

| Famille | Exports clés | Nature |
|---|---|---|
| **CRUD + play** | `savePlaylists`, `addTrackToPlaylist`, `removeTrackFromPlaylist`, `deletePlaylist`, `togglePinPlaylist`, `movePlToFolder`, `removePlFromFolder`, `movePlaylist`, `movePlaylistTrack`, `playPlaylistFrom`, `playPlaylistDirect`, `shufflePlaylist` | Data + IDB pur |
| **Dossiers + nav sidebar** | `renamePlFolder`, `deletePlFolder`, `togglePlFolder`, `showPlFolderCtxMenu`, `setupPlNavDrop`, `onPlNavDragStart`, `renderPlNav`, `_plNavInlineRename` | UI sidebar |
| **Hero + modales + ctx** | `renderPlHero`, `setPlSort`, `_plHeroInlineRename`, `openNewPlaylistModal`, `openRenamePlaylistModal`, `closePlModal`, `confirmPlaylistModal`, `setPlModalMode`, `showPlCtxMenu`, `ctxPlayPlaylist`, `ctxShufflePlaylist`, `showPlQuickPop`, `pqpAdd`, `pqpNew`, `closePlQuickPop`, `onTrackDragStart`, `_attachPlaylistReorder`, `_detachPlaylistReorder`, `onPlCoverSelected`, `clearPlCover`, `trapFocus` | UI panel principal |

### Découpage cible

```
frontend/src/
├── playlist-crud.js    CRUD IDB + play helpers          (~300 lignes)
├── playlist-nav.js     sidebar nav + dossiers + drag    (~400 lignes)
└── playlists.js        hero + modales + ctx + quick pop + cover (~480 lignes)
```

### Dépendances après split

```
playlist-crud.js  → DB, store, bus, player, cfgsave — aucun import vers les deux autres
playlist-nav.js   → importe savePlaylists depuis playlist-crud.js
playlists.js      → importe savePlaylists, renderPlNav depuis playlist-crud/nav
```

Re-exports barrel dans `playlists.js` :

```js
export { savePlaylists, addTrackToPlaylist, removeTrackFromPlaylist,
         deletePlaylist, togglePinPlaylist, movePlToFolder, removePlFromFolder,
         movePlaylist, movePlaylistTrack, playPlaylistFrom,
         playPlaylistDirect, shufflePlaylist }              from './playlist-crud.js'
export { renderPlNav, setupPlNavDrop, onPlNavDragStart,
         renamePlFolder, deletePlFolder, togglePlFolder,
         showPlFolderCtxMenu }                             from './playlist-nav.js'
```

### Risque

**Moyen.** Identifier quel état local (`_pqpTrackId`, `plModalMode`, etc.) appartient à quel sous-module avant de coder — grep d'état obligatoire en début de tâche.

---

## 6. PR 4 — Lit Phase 1 : `<lf-modal>`

### Objectif

Les modales actuelles sont des éléments HTML statiques dans `index.html` avec état géré par JS impératif. `<lf-modal>` encapsule le pattern focus trap + animation + lifecycle une fois pour toutes.

### Nouveaux fichiers

```
frontend/src/components/
├── lf-toast-stack.js        Phase 0 (livré)
├── lf-toast-stack.logic.js  Phase 0 (livré)
├── lf-modal.js              Phase 1 — composant Shadow DOM
└── lf-modal.logic.js        reducer pur, testable CJS
```

### API publique de `<lf-modal>`

- `lf-modal.open()` — ouvre + installe focus trap + anime via `modalOpen` (`motion.js`)
- `lf-modal.close()` — ferme + libère trap + anime + restaure focus
- Événement `lf-modal-close` : `{ bubbles: true, composed: true }`
- `<slot>` — contenu (titre, body, boutons) passé par le parent

### Impact sur `modal.js`

Conserve : `FOCUSABLE_SEL`, `trapFocus`, `releaseFocus`, `installAutoFocusTrap` (utilitaires pour dialogs non-migrés).

Supprime : `confirmClear()`, `closeModal()` (déléguées au composant pilote).

`modal.js` : 168 → ~100 lignes.

### Pilote

La modale "Vider la bibliothèque" (`#modal-bg + #modal`) est la seule migrée dans cette phase. Les 8 autres dialogs (organize, USB, CD, pl-modal, batch-tag, smart-pl, shortcuts-panel, sleep-menu) gardent HTML statique + `installAutoFocusTrap`.

### `lf-modal.logic.js`

```js
// Reducer pur, zéro import Lit — testable depuis core.test.cjs
export function modalReducer(state, action) { ... }
// state : { isOpen: bool, prevFocus: HTMLElement|null }
```

---

## 7. Séquençage des PRs

| PR | Scope | Durée estimée | Risque |
|---|---|---|---|
| 1 | `i18n.js` split | ~2h | Faible |
| 2 | `renderer.js` split | ~4h | Moyen |
| 3 | `playlists.js` split | ~4h | Moyen |
| 4 | `<lf-modal>` (Lit Phase 1) | ~6h | Faible |

PR 4 peut être démarrée après PR 1 — elle ne dépend pas de PR 2 ou 3.

---

## 8. Critères d'acceptation globaux

- [ ] Tous les modules cibles ≤ 800 lignes (hard cap CLAUDE.md §16)
- [ ] Modules principaux entre 200–530 lignes
- [ ] Zéro call site modifié en dehors des fichiers splittés (re-exports barrel)
- [ ] `npm test` vert sur les 4 PRs
- [ ] `vite build` propre (zéro import circulaire cassé)
- [ ] Smoke manuel : lib load → seek → playlists → modale → toast — aucune régression
- [ ] `<lf-modal>` : tests unitaires `modalReducer` dans `core.test.cjs`
- [ ] `<lf-modal>` : au moins un test visuel Playwright (open + close)

---

## 9. Hors scope

- `virt.js`, `player.js`, `app.js`, `cinema.js`, `eq.js` — exclusions permanentes CLAUDE.md §18
- Aucune modification de logique métier
- Lit Phase 2 (settings, tagedit, smartplaylist) — future spec distincte
- TypeScript — exclu (CLAUDE.md §17)
- `cinema.js` (1324L), `player.js` (1182L), `app.js` (1019L) — taille acceptée, exclusions permanentes

---

## 10. Références

- CLAUDE.md §16 (tailles modules), §18 (exclusions Lit), §2 (invariants critiques)
- `docs/superpowers/specs/2026-05-28-lit-integration-design.md` — Phase 0 Lit
- `frontend/src/i18n.js`, `renderer.js`, `playlists.js`, `modal.js`
