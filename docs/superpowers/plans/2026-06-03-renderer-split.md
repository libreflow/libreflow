# renderer.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Découper `renderer.js` (1279 lignes) en trois modules focused : `renderer-track.js` (helpers de ligne + patches DOM), `renderer-grids.js` (grilles + drill-down), `renderer.js` réduit (renderLib + virt + stats + animations).

**Architecture:** Extraction pure — aucune logique modifiée. Les exports publics restent accessibles depuis `renderer.js` via barrel re-exports. Aucun call site touché.

**Tech Stack:** Vanilla ESM JS, Vite 8, `npm test`, `npm run build`

**Spec:** `docs/superpowers/specs/2026-06-03-architecture-module-split-design.md` §4

**Test commands:**
- `npm test` → `node frontend/tests/core.test.cjs`
- Build check : `npm run build`

---

## Carte des états internes → sous-modules

| Variable | Destination |
|---|---|
| `_activeRowEl` | `renderer-track.js` |
| `ART_COLOR_RE`, `_albumMapCache`, `_artistMapCache`, `_tracksSig`, `_artTrackById`, `_gridArtObservers` | `renderer-grids.js` |
| `_statsTimer`, `_plHero`, `_skeletonActive` | `renderer.js` |

## Carte des exports → sous-modules

| Export | Fichier destination |
|---|---|
| `hlText`, `artPlaceholder`, `makeLikeBtn`, `makeAddBtn`, `thtml`, `patchActiveTrack`, `patchPlayState`, `patchTrackEl` | `renderer-track.js` |
| `renderAlbumsGrid`, `renderArtistsGrid`, `renderPlaylistsGrid`, `drillDown`, `updatePlActionBar`, `updateBreadcrumb`, `renderFormatChips`, `invalidateGridMaps` | `renderer-grids.js` |
| `virtRenderWindow`, `virtAttachScroll`, `renderLib`, `_showSkeletonRows`, `updateStats`, `scheduleStatsUpdate`, `updateSidebarCounts`, `animateViewChange`, `scrollToCurrentTrack`, `_withVT`, `playById` | `renderer.js` (inchangé) |

---

## File Map

| Fichier | Action |
|---|---|
| `frontend/src/renderer-track.js` | Créer |
| `frontend/src/renderer-grids.js` | Créer |
| `frontend/src/renderer.js` | Modifier (supprimer fonctions déplacées + ajouter barrel re-exports) |

---

## Task 1 : Créer `renderer-track.js`

**Files:**
- Create: `frontend/src/renderer-track.js`

- [ ] **Step 1 : Repérer les limites exactes**

```powershell
Select-String -Path frontend/src/renderer.js -Pattern "^export function (hlText|artPlaceholder|makeLikeBtn|makeAddBtn|thtml|patchActiveTrack|patchPlayState|patchTrackEl)"
```

Noter les numéros de ligne de début de chaque fonction.

- [ ] **Step 2 : Créer le fichier**

```js
// renderer-track.js — Templates de ligne de piste + patches DOM ciblés
// Extrait de renderer.js.

import { esc, fmtd, extEmoji, fmt } from './utils.js'
import { i18n }                      from './i18n.js'
import { CFG }                       from './cfg.js'
import { get }                       from './store.js'
import { getArtUrl }                 from './artLoader.js'
import { playLog }                   from './playlog.js'
import { audio }                     from './player.js'

// ── État interne ──────────────────────────────────────────────────────────────
let _activeRowEl = null   // cache du dernier élément .tr.act

// <copier les corps complets de hlText, artPlaceholder, makeLikeBtn, makeAddBtn,
//  thtml, patchActiveTrack, patchPlayState, patchTrackEl depuis renderer.js>
// Chaque fonction conserve son mot-clé `export`.
```

Copier les 8 fonctions dans l'ordre de leur apparition dans `renderer.js`. Ne pas modifier les corps.

> Si une des fonctions appelle `_activeRowEl`, elle la trouve dans le scope module de ce fichier. Si `patchActiveTrack` écrit `_activeRowEl`, c'est correct — elle est déclarée dans ce fichier.

- [ ] **Step 3 : Vérifier le parse**

```powershell
node --input-type=module --eval "import('./frontend/src/renderer-track.js').then(m => console.log('OK:', Object.keys(m).join(', ')))"
```

Attendu : `OK: hlText, artPlaceholder, makeLikeBtn, makeAddBtn, thtml, patchActiveTrack, patchPlayState, patchTrackEl`

---

## Task 2 : Créer `renderer-grids.js`

**Files:**
- Create: `frontend/src/renderer-grids.js`

- [ ] **Step 1 : Repérer les limites**

```powershell
Select-String -Path frontend/src/renderer.js -Pattern "^export function (renderAlbumsGrid|renderArtistsGrid|renderPlaylistsGrid|drillDown|updatePlActionBar|updateBreadcrumb|renderFormatChips|invalidateGridMaps)"
```

- [ ] **Step 2 : Créer le fichier**

```js
// renderer-grids.js — Grilles albums/artistes/playlists, drill-down, breadcrumb
// Extrait de renderer.js.

import { get, set }                        from './store.js'
import { emit, EVENTS }                    from './bus.js'
import { getFiltered, filteredIdx, _coll } from './search.js'
import { esc, fmtd, fmt }                  from './utils.js'
import { i18n }                            from './i18n.js'
import { CFG }                             from './cfg.js'
import { prefetchArts, getArtUrl }         from './artLoader.js'
import { thtml, artPlaceholder }           from './renderer-track.js'
import { cancelSearchDebounce }            from './views.js'
import { getImports }                      from './imports.js'

// ── État interne (caches grilles) ─────────────────────────────────────────────
const ART_COLOR_RE   = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/
let _albumMapCache   = null
let _artistMapCache  = null
let _tracksSig       = ''
const _artTrackById      = new Map()
const _gridArtObservers  = new Map()

// <copier _hydrateArtPlaceholders et tout helper privé lié aux grilles>
// <copier _getAlbumMap et _getArtistMap — puis ajouter export devant _getArtistMap>
// <copier invalidateGridMaps, renderAlbumsGrid, renderArtistsGrid,
//  renderPlaylistsGrid, drillDown, updatePlActionBar, updateBreadcrumb, renderFormatChips>
// Chaque fonction exportée conserve son mot-clé `export`.
```

> `_getArtistMap` doit être **exportée** (ajouter `export` devant) car `updateStats` dans `renderer.js` l'utilise.

- [ ] **Step 3 : Vérifier le parse**

```powershell
node --input-type=module --eval "import('./frontend/src/renderer-grids.js').then(m => console.log('OK:', Object.keys(m).join(', ')))"
```

Attendu : liste incluant `renderAlbumsGrid`, `renderArtistsGrid`, `renderPlaylistsGrid`, `drillDown`, `invalidateGridMaps`, `_getArtistMap`.

---

## Task 3 : Mettre à jour `renderer.js`

**Files:**
- Modify: `frontend/src/renderer.js`

- [ ] **Step 1 : Supprimer les états et fonctions déplacées**

Dans `renderer.js` :
1. Supprimer la déclaration `let _activeRowEl`.
2. Supprimer les déclarations : `ART_COLOR_RE`, `_albumMapCache`, `_artistMapCache`, `_tracksSig`, `_artTrackById`, `_gridArtObservers`.
3. Supprimer les corps complets de : `hlText`, `artPlaceholder`, `makeLikeBtn`, `makeAddBtn`, `thtml`, `patchActiveTrack`, `patchPlayState`, `patchTrackEl`.
4. Supprimer les corps complets de : `_hydrateArtPlaceholders`, `_getAlbumMap`, `_getArtistMap`, `invalidateGridMaps`, `renderAlbumsGrid`, `renderArtistsGrid`, `renderPlaylistsGrid`, `drillDown`, `updatePlActionBar`, `updateBreadcrumb`, `renderFormatChips`.

- [ ] **Step 2 : Ajouter les imports des nouveaux modules**

Ajouter dans le bloc d'imports de `renderer.js` :

```js
import { thtml, artPlaceholder, patchActiveTrack,
         patchPlayState, patchTrackEl }            from './renderer-track.js'
import { renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid, drillDown,
         updatePlActionBar, updateBreadcrumb,
         renderFormatChips, invalidateGridMaps,
         _getArtistMap }                           from './renderer-grids.js'
```

- [ ] **Step 3 : Remplacer les références à `_getArtistMap` dans `updateStats` et `updateSidebarCounts`**

Ces fonctions appellent `_getArtistMap()` — maintenant importée, l'appel reste identique. Aucune modification de corps nécessaire si l'import est en place.

- [ ] **Step 4 : Ajouter les barrel re-exports à la fin du fichier**

```js
// ── Barrel re-exports — call sites externes inchangés ────────────────────────
export { hlText, artPlaceholder, makeLikeBtn, makeAddBtn,
         thtml, patchActiveTrack, patchPlayState,
         patchTrackEl }                            from './renderer-track.js'
export { renderAlbumsGrid, renderArtistsGrid,
         renderPlaylistsGrid, drillDown,
         updatePlActionBar, updateBreadcrumb,
         renderFormatChips, invalidateGridMaps }   from './renderer-grids.js'
```

- [ ] **Step 5 : Vérifier le nombre de lignes**

```powershell
Get-ChildItem frontend/src/renderer*.js | ForEach-Object { $l=(Get-Content $_.FullName|Measure-Object -Line).Lines; "$($_.Name): $l lignes" }
```

Attendu :
- `renderer-track.js` : 200–300 lignes
- `renderer-grids.js` : 480–580 lignes
- `renderer.js` : 480–580 lignes

---

## Task 4 : Vérifier + commiter

- [ ] **Step 1 : Build Vite**

```powershell
npm run build 2>&1 | Select-String -Pattern "error" -CaseSensitive:$false
```

Attendu : aucune ligne `error`. Si un cycle d'import est détecté, identifier la fonction qui crée le cycle et l'extraire dans le fichier approprié.

- [ ] **Step 2 : Tests**

```powershell
npm test
```

Attendu : vert.

- [ ] **Step 3 : Smoke manuel**

`npm run dev` :
1. Bibliothèque → lignes de piste visibles.
2. Vue Albums → grille visible, artwork charge.
3. Clic album → drill-down, breadcrumb, action bar.
4. Lancer lecture → `.tr.act` visible sur la bonne ligne.

- [ ] **Step 4 : Commiter**

```powershell
git add frontend/src/renderer.js frontend/src/renderer-track.js frontend/src/renderer-grids.js
git commit -m "refactor(renderer): extract renderer-track.js + renderer-grids.js"
```
