# LibreFlow — Queue modèle Spotify

**Date :** 2026-05-04  
**Scope :** Refonte du panneau queue — deux sections séparées (explicite + naturelle), drag-and-drop fluide via Pointer Events, animations CSS.

---

## 1. Contexte

Le panneau queue existant (`queue.js`) dispose d'un système de drag-and-drop HTML5 fonctionnel mais limité :
- `qDragOver` fait un `querySelectorAll` O(n) à chaque mousemove → saccades visibles
- Pas de ligne d'insertion ni d'animation pendant le drag
- Une seule liste fusionnée (queue explicite ET ordre naturel indifférenciés)
- Aucun bouton "retirer" par item, ni "vider la queue"

L'objectif est d'aligner l'expérience sur le modèle Spotify : deux sections visuellement distinctes, drag fluide avec animations CSS, suppression granulaire.

---

## 2. Modèle de données

### État existant conservé

- `_queueOverride` — `null | Array<string>` (IDs ordonnés) — queue explicite (prioritaire)
- `_queueOverrideTrackId` — ID de la piste en cours au moment du reorder
- `getQueueState()` / `restoreQueueState()` — persistance en cfg (inchangés)
- `addToQueueNext()` / `addToQueueEnd()` — inchangés

### Nouvelles fonctions de build

```
_buildExplicitQueue()
  → map _queueOverride vers tracks[]
  → filtre les IDs invalides (track supprimée)
  → retourne Track[]

_buildNaturalUpcoming()
  → tracks filtrées après la piste en cours (ordre filtré courant)
  → exclut les IDs déjà présents dans _queueOverride
  → limité à 50 items pour perf
  → retourne Track[]
```

`_buildUpcoming()` existant est conservé tel quel (utilisé par `refreshQueueBadge()`).

### Nouvelles actions

```
removeFromQueue(id: string) → void
  Retire l'ID de _queueOverride. Si _queueOverride devient vide → null.
  Appelle renderQueue() si le panneau est ouvert.

clearExplicitQueue() → void
  Vide _queueOverride → null, _queueOverrideTrackId → null.
  Appelle renderQueue() si le panneau est ouvert.
  Appelle refreshQueueBadge().
```

---

## 3. Interface utilisateur

### Structure du panneau

```
┌─────────────────────────────────────┐
│  File d'attente            [✕ tout] │  ← header (✕ tout = clearExplicitQueue)
├─────────────────────────────────────┤
│  PROCHAINEMENT (n)                  │  ← section explicite (masquée si vide)
│  ┌─────────────────────────────┐   │
│  │ ⠿  🎵 Titre       3:22  ✕  │   │  ← draggable + supprimable
│  │ ⠿  🎵 Titre       4:01  ✕  │   │
│  └─────────────────────────────┘   │
│                                     │
│  À SUIVRE : [source]  ─────────── │  ← séparateur avec source contextuelle
│  ┌─────────────────────────────┐   │
│  │     🎵 Titre       2:55    │   │  ← click = jouer, drag = promouvoir
│  │     🎵 Titre       3:40    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Comportements par section

**Section "Prochainement" :**
- Drag-reorder complet (Pointer Events)
- Bouton ✕ par item → `removeFromQueue(id)`
- Bouton "✕ tout" dans le header → `clearExplicitQueue()`
- Handle de drag (icône 6 points) visible au hover
- Section entière masquée si `_queueOverride` est null ou vide

**Section "À suivre" :**
- Click → `playQueueItem(id)` (comportement actuel)
- Drag vers la section "Prochainement" → promotion à la position de drop
- Drag hors zone → spring-back (annulé)
- Pas de bouton ✕ (items naturels, non-supprimables de la queue)
- Source affichée dans le séparateur : "Bibliothèque" par défaut, nom de playlist si contexte playlist actif

### Badge
- Badge = `_buildExplicitQueue().length + _buildNaturalUpcoming().length` (comportement actuel via `_buildUpcoming()` conservé)

---

## 4. Drag & Drop — Pointer Events

### Remplacement de HTML5 DnD

Les handlers `qDragStart`, `qDragOver`, `qDrop`, `qDragEnd` (HTML5) sont supprimés.  
Remplacement par un gestionnaire Pointer Events centralisé attaché au `#queue-list` (event delegation).

### Mécanique

```
pointerdown sur handle (.q-drag-handle)
  → setPointerCapture
  → clone l'item → ghost (position: fixed, z-index élevé, opacity 0.85)
  → item original → classe .dragging (opacity 0.3)
  → autres items de la même section → transition: transform 0.15s ease

pointermove
  → déplace le ghost (clientX/Y)
  → calcule l'index cible : itère les bounding rects des items
  → applique translateY(±ROW_H) aux items qui doivent s'écarter
  → détecte si le curseur est au-dessus de la section "Prochainement" (pour promotion)

pointerup / pointercancel
  → si drag depuis "Prochainement" : commit reorder dans _queueOverride
  → si drag depuis "À suivre" + drop dans "Prochainement" : promouvoir à targetIdx
  → si drag depuis "À suivre" + drop hors zone : annuler (spring-back)
  → reset transforms, retire ghost, renderQueue()
```

### Constante

```js
const Q_ROW_H = 56; // hauteur px d'un item queue (CSS doit matcher)
```

---

## 5. CSS

Nouvelles règles dans `style.css` :

```
.queue-section-header      → label section (PROCHAINEMENT / À SUIVRE)
.queue-section-divider     → séparateur avec source
.queue-item--explicit      → item section prioritaire (avec handle + ✕)
.queue-item--natural       → item section naturelle (sans handle visible)
.queue-item.dragging       → opacity 0.3, no-transition
.queue-item.drag-over      → supprimé (remplacé par gap animation)
.queue-ghost               → clone fixe qui suit le curseur
.queue-clear-btn           → bouton "✕ tout" dans le header
.queue-remove-btn          → bouton ✕ par item explicite
```

Transitions : `transform 0.15s ease` sur `.queue-item--explicit` (sauf `.dragging`).  
Spring-back : class `.spring-back` + `@keyframes` translateY retour à 0 sur 200ms.

---

## 6. Fichiers modifiés

| Fichier | Action | Détail |
|---------|--------|--------|
| `frontend/src/queue.js` | MODIFY | +`_buildExplicitQueue`, +`_buildNaturalUpcoming`, refonte `renderQueue`, remplacement DnD→Pointer Events, +`removeFromQueue`, +`clearExplicitQueue` |
| `frontend/src/style.css` | MODIFY | Nouveaux styles sections, ghost, transitions, spring-back |

**Aucun nouveau fichier.** `queue.js` reste la responsabilité unique du panneau queue.

---

## 7. Invariants respectés

- `_trackIdxMap` non modifié (les mutations touchent uniquement `_queueOverride`, array d'IDs)
- Aucun `rebuildTrackIdxMap()` nécessaire (pas de mutation de `tracks[]`)
- Aucun fetch externe
- IDB non touché (la persistance queue passe par `cfg` via `getQueueState()` existant)
- Virtual scroll non affecté (queue est un panneau indépendant)

---

## 8. Hors scope

- Drag depuis la bibliothèque principale vers la queue (déjà géré via menu contextuel)
- Drag sur mobile / touch (Pointer Events couvrent touch nativement)
- Réorganisation de la section "À suivre" (lecture seule sauf promotion)
- Historique des pistes jouées (feature séparée)
