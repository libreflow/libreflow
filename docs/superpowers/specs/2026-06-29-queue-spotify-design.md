# Queue — Parité comportementale et visuelle Spotify

**Date :** 2026-06-29
**Statut :** Approuvé — prêt pour implémentation
**Scope :** Option B — câblage lecture + section "En cours"

---

## Problème

La file d'attente explicite (`_queueOverride` dans `queue.js`) est **purement visuelle**. Quand l'utilisateur ajoute un titre via "Lire ensuite" ou "Ajouter à la file", il apparaît dans le panneau mais `getNextIdx()` et `next()` dans `player.js` l'ignorent complètement — la lecture continue selon la liste filtrée normale.

De plus, le panneau de queue n'affiche pas la piste en cours de lecture, ce qui oblige l'utilisateur à fermer le panneau et à chercher la piste dans la bibliothèque.

---

## Objectifs

1. **Comportement** : les pistes de la queue explicite jouent en priorité lors de l'auto-progression (fin de piste, crossfade, gapless).
2. **Visuel** : une section "En cours de lecture" apparaît en haut du panneau de queue.

---

## Architecture

### Séparation des responsabilités (inchangée)

| Module | Rôle |
|---|---|
| `queue.js` | Source de vérité de `_queueOverride` (IDs), rendu HTML du panneau |
| `player.js` | Moteur de lecture, consommation de la queue lors de l'auto-progression |

Les imports circulaires `player.js → queue.js` et `queue.js → player.js` existent déjà. On ajoute deux exports supplémentaires à `queue.js`, importés dans `player.js`.

---

## Section 1 — Câblage de la lecture

### Nouvelles exports de `queue.js`

```js
/**
 * Retourne la première piste de la queue explicite sans la consommer.
 * Utilisé par player.js pour le pre-buffer crossfade/gapless et peekNext().
 * @returns {object|null} Track object ou null si queue vide
 */
export function peekFirstExplicit() { ... }

/**
 * Retire et retourne la première piste de la queue explicite.
 * Appelée par player.js lors de l'auto-progression.
 * Met à jour le badge et re-render le panneau si ouvert.
 * @returns {object|null} Track object consommé ou null
 */
export function consumeFirstExplicit() { ... }
```

**Implémentation de `peekFirstExplicit()` :**
```js
export function peekFirstExplicit() {
  // Délègue à _buildExplicitQueue() qui filtre déjà les IDs invalides.
  const ex = _buildExplicitQueue();
  return ex.length ? ex[0] : null;
}
```

**Implémentation de `consumeFirstExplicit()` :**
```js
export function consumeFirstExplicit() {
  if (!_queueOverride?.length) return null;
  // Trouver le premier ID valide (filtrer les IDs obsolètes en tête)
  const validTrack = peekFirstExplicit();
  if (!validTrack) {
    // Tous les IDs restants sont obsolètes — vider la queue
    _queueOverride = null;
    _queueOverrideTrackId = null;
    refreshQueueBadge();
    if (queueOpen) renderQueue();
    return null;
  }
  // Retirer le premier ID (y compris les éventuels IDs obsolètes avant lui)
  const firstValidIdx = _queueOverride.findIndex(id => _trackIdxMap?.has(id));
  _queueOverride = _queueOverride.slice(firstValidIdx + 1);
  if (!_queueOverride.length) {
    _queueOverride = null;
    _queueOverrideTrackId = null;
  }
  refreshQueueBadge();
  if (queueOpen) renderQueue();
  return validTrack;
}
```

### Modifications de `player.js`

**Imports ajoutés :**
```js
import { ..., peekFirstExplicit, consumeFirstExplicit } from './queue.js';
```

**`peekNext()` — priorité queue explicite :**
```js
export function peekNext() {
  // Queue explicite en priorité
  const explicitNext = peekFirstExplicit();
  if (explicitNext) return explicitNext;

  // File manuelle (priorité 2)
  if (manualQueue.length) { ... }
  // Radio, shuffle, naturel...
}
```

**`getNextIdx()` — priorité queue explicite :**
```js
export function getNextIdx() {
  if (repeat === 'one') return -1;

  // Queue explicite en priorité (avant radio, shuffle, naturel)
  const explicitNext = peekFirstExplicit();
  if (explicitNext) {
    const idx = trackIdx(explicitNext);
    if (idx >= 0) return idx;
  }

  if (radioActive) { ... }
  if (shuffle && shuffleQ.length > 0) return shuffleQ[0];
  // ... séquentiel naturel
}
```

**`next()` — consommation de la queue explicite :**

Ajouté avant le bloc `manualQueue` existant :

```js
// ── Queue explicite (priorité 1) ─────────────────────────────────────────
const _explicitNext = peekFirstExplicit();
if (_explicitNext) {
  consumeFirstExplicit();
  // Queue épuisée ? peekFirstExplicit() est maintenant null → dernier item consommé.
  const _queueNowEmpty = peekFirstExplicit() === null;
  if (_queueNowEmpty && !radioActive && !_queueEndedToastShown) {
    _queueEndedToastShown = true;
    setTimeout(() => toast(i18n('t_queue_ended'), 'info'), 400);
  }
  const fi = filteredIdx(_explicitNext);
  if (fi >= 0) { playAt(fi, { keepQueue: true }); return; }
  // Fallback : piste hors vue filtrée → lecture directe par index absolu
  _playDirect(_explicitNext, trackIdx(_explicitNext));
  return;
}
```

Note : `keepQueue: true` empêche `clearQueueOverride()` de wiper les items restants de la queue.

### Points de vigilance

- `peekFirstExplicit()` filtre silencieusement les IDs invalides (piste supprimée de la bibliothèque) — si le premier ID est invalide, retourne `null` et la lecture tombe sur `manualQueue` / naturel. Il faudra itérer pour trouver le premier ID valide.
- `_queueEndedToastShown` : réinitialisé par `setManualQueue()` (comportement existant) — OK car les deux queues sont indépendantes.
- `clearQueueOverride()` continue d'être appelée uniquement quand l'utilisateur démarre une piste sans `keepQueue` — comportement inchangé.

---

## Section 2 — Section "En cours" dans le panneau

### Layout du panneau

```
┌─────────────────────────────────────┐
│ File d'attente               📌  ✕  │
├─────────────────────────────────────┤
│  EN COURS DE LECTURE                │  ← .queue-now-playing
│  [art]  Nom de la piste             │     artwork 48×48
│         Artiste  ·  3:45            │
├─────────────────────────────────────┤
│  Prochainement (2)       ✕ tout     │  ← .queue-section-header (existant)
│  ⠿ [art]  Piste A            2:30  │
│  ⠿ [art]  Piste B            4:12  │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
│  À suivre · Bibliothèque            │  ← .queue-section-divider (existant)
│    [art]  Piste C            3:15   │
└─────────────────────────────────────┘
```

### Modifications de `renderQueue()` dans `queue.js`

Avant la génération des sections existantes, ajouter :

```js
// ── Section "En cours" ─────────────────────────────────────────────────
const curTrack = (curIdx >= 0 && tracks[curIdx]) ? tracks[curIdx] : null;
if (curTrack) {
  const artHTML = curTrack.art
    ? `<img src="${esc(curTrack.art)}" alt="">`
    : extEmoji(curTrack.ext ?? '');
  html += `<div class="queue-now-playing">
    <div class="queue-now-playing__label">${esc(i18n('queue_now_playing'))}</div>
    <div class="queue-item queue-item--now" data-action="play-queue-item" data-track-id="${curTrack.id}" tabindex="0" aria-label="${esc(curTrack.name + ' — ' + (curTrack.artistFull || curTrack.artist || ''))} — ${esc(i18n('queue_now_playing'))}">
      <div class="q-art q-art--now" aria-hidden="true">${artHTML}
        <button class="q-art-hover-play" data-action="toggle-play" tabindex="-1" aria-hidden="true">
          <svg class="icon-play" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        </button>
      </div>
      <div class="q-info">
        <div class="q-name">${esc(curTrack.name)}</div>
        <div class="q-artist">${esc(curTrack.artistFull || curTrack.artist || '–')}</div>
      </div>
      <div class="q-dur" aria-hidden="true">${fmtd(curTrack.duration ?? 0)}</div>
    </div>
  </div>`;
}
```

### CSS (ajouts dans `style.css`)

```css
/* ── Queue — section "En cours" ─────────────────────── */
.queue-now-playing {
  padding: var(--space-2) var(--space-3) var(--space-3);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-1);
}

.queue-now-playing__label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-1);
}

.queue-item--now {
  cursor: default;
  background: transparent;
}

.queue-item--now:hover {
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

.q-art--now {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.q-art--now img {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}
```

### i18n

Nouvelles clés à ajouter dans `i18n.fr.js` et `i18n.en.js` :

| Clé | FR | EN |
|---|---|---|
| `queue_now_playing` | `En cours de lecture` | `Now playing` |

---

## Flux de données après les changements

```
Utilisateur clique "Lire ensuite"
  → addToQueueNext(trackId)          [queue.js]
  → _queueOverride = [trackId, ...]
  → badge mis à jour

Piste en cours se termine (audio.ended)
  → next()                            [player.js]
  → peekFirstExplicit() ≠ null ?
      OUI → consumeFirstExplicit()    [queue.js] — retire le premier ID
           → _queueOverride = [...]  (reste)
           → playAt(fi, {keepQueue:true})
      NON → logique existante (manualQueue / radio / shuffle / naturel)

Crossfade/Gapless pre-buffer
  → getNextIdx()                      [player.js]
  → peekFirstExplicit() ≠ null ?
      OUI → trackIdx(track) → pre-buffer la bonne piste
      NON → logique existante
```

---

## Gestion des erreurs

| Cas | Comportement |
|---|---|
| Premier ID de `_queueOverride` invalide (piste supprimée) | `peekFirstExplicit()` retourne `null` → itérer jusqu'au premier ID valide ou tomber sur le suivant |
| `filteredIdx(explicitNext)` retourne -1 (piste hors vue) | `_playDirect()` utilisé comme fallback (comportement existant dans `playQueueItem`) |
| Queue vide après consommation | `_queueOverride = null`, badge masqué, section "Prochainement" disparaît du panneau |
| `renderQueue()` pendant crossfade | `patchPlayState()` appelé après `el.innerHTML` — comportement inchangé |

---

## Tests

Ajouter dans `frontend/tests/core.test.cjs` :

1. `peekFirstExplicit() retourne null si _queueOverride vide`
2. `consumeFirstExplicit() retire le premier item et met à jour le badge`
3. `consumeFirstExplicit() met _queueOverride à null quand le dernier item est consommé`
4. `peekFirstExplicit() filtre les IDs invalides (piste supprimée)`

---

## Checklist pré-commit (CLAUDE.md §19)

- [ ] Pas de mutation de `tracks[]` — non concerné
- [ ] Pas d'assignation directe `audio.volume` — non concerné
- [ ] `keepQueue: true` passé à `playAt()` lors de la consommation automatique
- [ ] `refreshQueueBadge()` appelé après chaque `consumeFirstExplicit()`
- [ ] Imports circulaires player.js ↔ queue.js — existants, pas de nouveau cycle
- [ ] Pas de `console.log` — uniquement `console.warn` si besoin
- [ ] Nouvelles clés i18n ajoutées dans les deux fichiers de traduction
- [ ] `patchPlayState()` appelé après tout `el.innerHTML` dans `renderQueue()`

---

## Fichiers modifiés

| Fichier | Type de changement |
|---|---|
| `frontend/src/queue.js` | Ajout `peekFirstExplicit`, `consumeFirstExplicit`; `renderQueue()` section "En cours" |
| `frontend/src/player.js` | Imports + `peekNext()`, `getNextIdx()`, `next()` |
| `frontend/src/style.css` | `.queue-now-playing`, `.queue-item--now`, `.q-art--now` |
| `frontend/src/i18n.fr.js` | Clé `queue_now_playing` |
| `frontend/src/i18n.en.js` | Clé `queue_now_playing` |
| `frontend/tests/core.test.cjs` | 4 nouveaux tests |
