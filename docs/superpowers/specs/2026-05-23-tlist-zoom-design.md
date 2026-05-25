# Zoom de la liste de pistes — design

**Date :** 2026-05-23
**Inspiration :** Spotify desktop (Compact / Normal / Confortable)
**Fichier piloté par :** `cfg.tlistZoom: 'compact' | 'normal' | 'comfortable'`

## Goal
Permettre à l'utilisateur de changer la densité de la liste de pistes — comme Spotify desktop — via Settings et raccourcis clavier.

## Architecture
État unique `cfg.tlistZoom` (3 valeurs). Une fonction centrale `setTlistZoom(level)` est la **source de vérité unique** : elle synchronise (a) un attribut `data-tlist-zoom` sur `<html>` qui pilote des variables CSS, (b) le runtime `VIRT.ROW_H` qui pilote le virtual scroll, (c) la persistance via `cfg`, puis force un re-render.

## Niveaux

| Niveau | `--tr-h` | `--art-list` |
|---|---|---|
| Compact | 36px | 28px |
| **Normal** (défaut) | 48px | 36px |
| Confortable | 60px | 44px |

Ratio art/row ≈ 0.74 — conserve les proportions actuelles.

## Évolution invariant CLAUDE.md §10
`VIRT.ROW_H` devient une valeur **runtime** (initialisée à `CFG.VIRT_ROW_H` au boot). Règle évoluée :
> Toutes les computations scroll/render utilisent la même `VIRT.ROW_H` à un instant donné. Seule `setTlistZoom()` peut la changer, et elle invalide les caches virt (`VIRT._lastListSig = ''`, `VIRT._lastWindowSig = ''`) + force un re-render via `EVENTS.RENDER_LIB`.

`CFG.VIRT_ROW_H` reste figé (défaut Normal).

## Composants

### `frontend/src/tlistZoom.js` (NOUVEAU)
API :
- `setTlistZoom(level)` — applique le niveau (data-attr + VIRT.ROW_H + cfg + invalidation + re-render).
- `tlistZoomIn()` — passe au niveau plus grand si possible.
- `tlistZoomOut()` — passe au niveau plus petit si possible.
- `tlistZoomReset()` — repasse à `normal`.
- `TLIST_ZOOM_LEVELS` (export) — `['compact','normal','comfortable']`.
- `TLIST_ZOOM_ROW_H` (export) — `{compact:36, normal:48, comfortable:60}`.

Imports : `VIRT` (virt.js), `set`/`get` (store.js), `emit`/`EVENTS` (bus.js), `saveCfg` (cfgsave.js).

### `frontend/src/virt.js` (MODIF)
- À l'initialisation : `VIRT.ROW_H = CFG.VIRT_ROW_H` (défaut Normal).
- Remplacer tous les `CFG.VIRT_ROW_H` du module par `VIRT.ROW_H`. `CFG.VIRT_GRP_H` reste inchangé (le zoom ne touche pas la hauteur de groupe).

### `frontend/src/style.css` (MODIF)
Bloc nouveau au `:root` ou immédiatement après :
```css
:root[data-tlist-zoom="compact"]     { --tr-h: 36px; --art-list: 28px; }
:root[data-tlist-zoom="normal"]      { --tr-h: 48px; --art-list: 36px; }
:root[data-tlist-zoom="comfortable"] { --tr-h: 60px; --art-list: 44px; }
```
Et `.tr { height: var(--tr-h); }`. Vérifier que `--art-list` existe déjà dans `:root` — sinon ajouter un défaut `--art-list: 36px;`. Garder l'existant intact.

### `frontend/src/app.js` (MODIF — boot)
Après la lecture de `cfg`, appeler `setTlistZoom(cfg.tlistZoom || 'normal')` AVANT le premier rendu de la liste. Import depuis `./tlistZoom.js`.

### `frontend/src/shortcuts.js` (MODIF)
Ajouter dans `initShortcuts` (et son registre) :
- `Ctrl+=` / `Ctrl++` → `tlistZoomIn()` — `preventDefault()` pour bloquer le zoom navigateur.
- `Ctrl+-` (et `Ctrl+_`) → `tlistZoomOut()` — `preventDefault()`.
- `Ctrl+0` → `tlistZoomReset()` — `preventDefault()`.
Garde : ignorer si le focus est dans un `input`/`textarea`/`[contenteditable]` (laisser le navigateur gérer dans les champs).

### `frontend/src/settings.js` + `frontend/index.html` (MODIF)
Nouvelle section dans Settings → onglet « Affichage » (ou l'onglet existant le plus approprié) :
- Label : `i18n('tlist_zoom_label')`.
- 3 boutons radio (`name="tlist-zoom"`, values `compact`/`normal`/`comfortable`).
- Listener change → `setTlistZoom(value)`.
- Au render du panneau, refléter `cfg.tlistZoom` courant.

### `frontend/src/i18n.js` (MODIF)
Ajouter 4 clés FR + EN :
- `tlist_zoom_label` — « Densité de la liste » / « List density »
- `tlist_zoom_compact` — « Compact » / « Compact »
- `tlist_zoom_normal` — « Normal » / « Normal »
- `tlist_zoom_comfortable` — « Confortable » / « Comfortable »

### `frontend/tests/core.test.cjs` (MODIF)
Tests purs pour la logique de cycling (sans DOM/store). Extraire la fonction de cycling dans une fonction pure si nécessaire, ou tester via mocks minimaux :
- `tlistZoomIn` à `compact` → état devient `normal`.
- `tlistZoomIn` à `comfortable` → reste `comfortable`.
- `tlistZoomOut` à `comfortable` → `normal`.
- `tlistZoomOut` à `compact` → reste `compact`.
- `tlistZoomReset` depuis n'importe quel niveau → `normal`.

## Data flow (changement de zoom)
1. Utilisateur appuie `Ctrl+=` (ou clique le radio Settings).
2. `shortcuts.js` (ou `settings.js`) appelle `tlistZoomIn()` (ou `setTlistZoom(value)`).
3. `tlistZoom.js` :
   - met `document.documentElement.dataset.tlistZoom = level` → les variables CSS s'appliquent → `.tr` height + `.tart` size changent immédiatement.
   - met `VIRT.ROW_H = TLIST_ZOOM_ROW_H[level]`.
   - `VIRT._lastListSig = ''; VIRT._lastWindowSig = '';` (invalide les caches).
   - `set('tlistZoom', level)` puis `saveCfg()` (debounced).
   - `emit(EVENTS.RENDER_LIB, {})`.
4. `renderer.js` re-rend la fenêtre virtuelle avec la nouvelle `VIRT.ROW_H`.

## Gestion d'erreur
- `setTlistZoom(level)` avec une valeur inconnue → no-op + `console.warn`.
- Au boot, `cfg.tlistZoom` absent ou invalide → fallback `'normal'`.

## Vérification
- `node frontend/tests/core.test.cjs` → 266 + 5 nouveaux tests = 271/271 PASS.
- `npm run vite:build` → succès, accolades CSS = 0.
- `npm run test:visual` → 22/22 PASS (la baseline est `normal` par défaut, inchangée).
- Smoke manuel : Ctrl+= dans la liste → hauteur change visuellement, scroll fonctionne, position de la piste courante préservée (le `scrollToCurrentTrack` doit pouvoir être réutilisé si nécessaire).

## Out of scope
- Bouton visible dans le header de liste (Settings + clavier uniquement, choix utilisateur).
- Granularité continue (3 niveaux fixes seulement).
- Scaling de la typographie (hauteur + pochette seulement).
- Zoom indépendant par vue / par playlist.
