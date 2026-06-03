# playlists.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Découper `playlists.js` (1382 lignes) en trois modules focused : `playlist-crud.js` (CRUD IDB + play helpers), `playlist-nav.js` (sidebar nav + dossiers), `playlists.js` réduit (hero + modales + ctx menu + quick pop + cover).

**Architecture:** Extraction pure — aucune logique modifiée. Les exports publics restent accessibles depuis `playlists.js` via barrel re-exports. Aucun call site touché.

**Tech Stack:** Vanilla ESM JS, Vite 8, `npm test`, `npm run build`

**Spec:** `docs/superpowers/specs/2026-06-03-architecture-module-split-design.md` §5

---

## Carte des états internes → sous-modules

| Variable | Destination |
|---|---|
| `_dragPlId`, `_plNavDropInit` | `playlist-nav.js` |
| `plModalMode`, `_pqpTrackId`, `_dragTrackId`, `_plCtxClose`, `_plCtxEscClose`, `_plModalPrevFocus`, `_plModalFocusTrap`, `_plModalCoverB64`, `_plModalBusy`, `_heroMosaicGen` | `playlists.js` |

## Carte des exports → sous-modules

| Export | Fichier destination |
|---|---|
| `savePlaylists`, `addTrackToPlaylist`, `removeTrackFromPlaylist`, `deletePlaylist`, `togglePinPlaylist`, `movePlToFolder`, `removePlFromFolder`, `movePlaylist`, `movePlaylistTrack`, `playPlaylistFrom`, `playPlaylistDirect`, `shufflePlaylist` | `playlist-crud.js` |
| `renderPlNav`, `setupPlNavDrop`, `onPlNavDragStart`, `renamePlFolder`, `deletePlFolder`, `togglePlFolder`, `showPlFolderCtxMenu` | `playlist-nav.js` |
| Tous les autres exports | `playlists.js` (inchangé) |

`invalidateFilter` (privée) : copiée dans chaque sous-module qui en a besoin.

---

## File Map

| Fichier | Action |
|---|---|
| `frontend/src/playlist-crud.js` | Créer |
| `frontend/src/playlist-nav.js` | Créer |
| `frontend/src/playlists.js` | Modifier |

---

## Task 1 : Créer `playlist-crud.js`

**Files:**
- Create: `frontend/src/playlist-crud.js`

- [ ] **Step 1 : Repérer les limites**

```powershell
Select-String -Path frontend/src/playlists.js -Pattern "^export (async function|function) (playPlaylistFrom|playPlaylistDirect|shufflePlaylist|savePlaylists|togglePinPlaylist|movePlToFolder|removePlFromFolder|movePlaylist|movePlaylistTrack|addTrackToPlaylist|removeTrackFromPlaylist)"
```

- [ ] **Step 2 : Créer le fichier**

```js
// playlist-crud.js — CRUD playlists + IDB + play helpers
// Extrait de playlists.js. Aucune dépendance vers playlist-nav.js ou playlists.js.

import { esc, moveByOne }                     from './utils.js'
import { i18n }                               from './i18n.js'
import { get, set }                           from './store.js'
import { emit, EVENTS }                       from './bus.js'
import { DB }                                 from './db.js'
import { toast, toastWithAction }             from './ui.js'
import { invalidateFilterCache }              from './search.js'
import { invalidateGenreGridSig }             from './genres.js'
import { saveCfg }                            from './cfgsave.js'
import { playAt, buildQ }                     from './player.js'
import { _allPlayerUI }                       from './allplayerui.js'
import { setView }                            from './views.js'
import { getFiltered }                        from './search.js'

function invalidateFilter() {
  invalidateFilterCache()
  invalidateGenreGridSig()
  emit(EVENTS.FILTER_CHANGED, {})
}
```

Puis copier les corps complets des 11 fonctions dans l'ordre de leur apparition dans `playlists.js`. Chaque fonction conserve son mot-clé `export`.

- [ ] **Step 3 : Vérifier**

```powershell
node --input-type=module --eval "import('./frontend/src/playlist-crud.js').then(m => console.log('OK:', Object.keys(m).join(', ')))"
```

Attendu : liste incluant `savePlaylists`, `addTrackToPlaylist`, `playPlaylistFrom`.

---

## Task 2 : Créer `playlist-nav.js`

**Files:**
- Create: `frontend/src/playlist-nav.js`

- [ ] **Step 1 : Repérer les limites**

```powershell
Select-String -Path frontend/src/playlists.js -Pattern "^export (async function|function) (renderPlNav|setupPlNavDrop|onPlNavDragStart|renamePlFolder|deletePlFolder|togglePlFolder|showPlFolderCtxMenu)"
```

- [ ] **Step 2 : Créer le fichier**

```js
// playlist-nav.js — Sidebar nav playlists + dossiers + drag sidebar
// Extrait de playlists.js.

import { esc, moveByOne }                     from './utils.js'
import { i18n }                               from './i18n.js'
import { get, set, notify }                   from './store.js'
import { emit, EVENTS }                       from './bus.js'
import { DB }                                 from './db.js'
import { toast }                              from './ui.js'
import { closeCtxMenu }                       from './ctxmenu.js'
import { invalidateFilterCache }              from './search.js'
import { invalidateGenreGridSig }             from './genres.js'
import { modalOpen, modalClose }              from './motion.js'
import { savePlaylists }                      from './playlist-crud.js'

function invalidateFilter() {
  invalidateFilterCache()
  invalidateGenreGridSig()
  emit(EVENTS.FILTER_CHANGED, {})
}

let _dragPlId      = null
let _plNavDropInit = false
```

Puis copier : les helpers privés `_plNavItemHTML`, `_plNavInlineRename`, puis les exports `renderPlNav`, `setupPlNavDrop`, `onPlNavDragStart`, `renamePlFolder`, `deletePlFolder`, `togglePlFolder`, `showPlFolderCtxMenu` (et `onPlFolderDragOver/Leave/Drop` si présentes dans `playlists.js`).

- [ ] **Step 3 : Vérifier**

```powershell
node --input-type=module --eval "import('./frontend/src/playlist-nav.js').then(m => console.log('OK:', Object.keys(m).join(', ')))"
```

Attendu : liste incluant `renderPlNav`, `setupPlNavDrop`, `renamePlFolder`.

---

## Task 3 : Mettre à jour `playlists.js`

**Files:**
- Modify: `frontend/src/playlists.js`

- [ ] **Step 1 : Supprimer états et fonctions déplacés**

Dans `playlists.js` :
1. Supprimer `_dragPlId` et `_plNavDropInit` du bloc d'état.
2. Supprimer les corps des 11 fonctions déplacées vers `playlist-crud.js`.
3. Supprimer les corps des fonctions déplacées vers `playlist-nav.js`.

- [ ] **Step 2 : Ajouter les imports des sous-modules**

```js
import { savePlaylists, addTrackToPlaylist, removeTrackFromPlaylist,
         deletePlaylist, togglePinPlaylist, movePlToFolder,
         removePlFromFolder, movePlaylist, movePlaylistTrack,
         playPlaylistFrom, playPlaylistDirect,
         shufflePlaylist }                    from './playlist-crud.js'
import { renderPlNav }                        from './playlist-nav.js'
```

- [ ] **Step 3 : Ajouter les barrel re-exports à la fin**

```js
// ── Barrel re-exports ──────────────────────────────────────────────────────────
export { savePlaylists, addTrackToPlaylist, removeTrackFromPlaylist,
         deletePlaylist, togglePinPlaylist, movePlToFolder,
         removePlFromFolder, movePlaylist, movePlaylistTrack,
         playPlaylistFrom, playPlaylistDirect,
         shufflePlaylist }                    from './playlist-crud.js'
export { renderPlNav, setupPlNavDrop, onPlNavDragStart,
         renamePlFolder, deletePlFolder, togglePlFolder,
         showPlFolderCtxMenu }                from './playlist-nav.js'
```

- [ ] **Step 4 : Vérifier les tailles**

```powershell
Get-ChildItem frontend/src/playlist*.js | ForEach-Object { $l=(Get-Content $_.FullName|Measure-Object -Line).Lines; "$($_.Name): $l lignes" }
```

Attendu :
- `playlist-crud.js` : 280–360 lignes
- `playlist-nav.js` : 380–460 lignes
- `playlists.js` : 450–540 lignes

---

## Task 4 : Vérifier + commiter

- [ ] **Step 1 : Build**

```powershell
npm run build 2>&1 | Select-String -Pattern "error" -CaseSensitive:$false
```

Attendu : aucune `error`.

- [ ] **Step 2 : Tests**

```powershell
npm test
```

Attendu : vert.

- [ ] **Step 3 : Smoke manuel**

`npm run dev` :
1. Créer une playlist → toast confirmation.
2. Drag piste vers playlist → fonctionne.
3. Créer un dossier, déplacer une playlist dedans.
4. Supprimer une playlist → confirmation + nav mis à jour.
5. Ouvrir le hero d'une playlist → cover, tri, action bar OK.

- [ ] **Step 4 : Commiter**

```powershell
git add frontend/src/playlists.js frontend/src/playlist-crud.js frontend/src/playlist-nav.js
git commit -m "refactor(playlists): extract playlist-crud.js + playlist-nav.js"
```
