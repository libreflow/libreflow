# Queue Spotify-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wirer la queue explicite dans le moteur de lecture (auto-progression) et ajouter une section "En cours" en haut du panneau queue.

**Architecture:** Deux nouvelles fonctions exportées de `queue.js` (`peekFirstExplicit`, `consumeFirstExplicit`) sont importées dans `player.js` pour brancher la queue explicite en priorité dans `peekNext()`, `getNextIdx()` et `next()`. Séparément, `renderQueue()` est étendu pour afficher la piste courante en haut du panneau.

**Tech Stack:** Vanilla ESM JS, CSS custom properties existantes, node:assert pour les tests CJS.

## Global Constraints

- Aucun `console.log` dans le code commité — `console.warn` uniquement pour les signaux documentés
- Pas de réseau (`fetch`, XHR, WebSocket)
- `keepQueue: true` obligatoire dans tout appel `playAt()` déclenché depuis la queue explicite (empêche `clearQueueOverride()`)
- CSS : utiliser les variables existantes `--sp-*`, `--fs-*`, `--t3`, `--bg4`, `--row-hover`, `--icon-36`, etc.
- `patchPlayState(!audio.paused)` doit être appelé après tout `el.innerHTML` dans `renderQueue()`
- Les tests dans `core.test.cjs` inline la logique — pas d'import ESM

---

## File Map

| Fichier | Changement |
|---|---|
| `frontend/src/i18n.fr.js` | +1 clé `queue_now_playing` |
| `frontend/src/i18n.en.js` | +1 clé `queue_now_playing` |
| `frontend/src/queue.js` | +2 exports (`peekFirstExplicit`, `consumeFirstExplicit`) ; `renderQueue()` section "En cours" |
| `frontend/src/player.js` | Imports étendus ; `peekNext()` ligne 473, `getNextIdx()` ligne 1066, `next()` ligne 532 |
| `frontend/src/style.css` | +6 règles CSS section "En cours" après ligne 4130 |
| `frontend/tests/core.test.cjs` | +section avec 6 assertions inline |

---

### Task 1: Clés i18n `queue_now_playing`

**Files:**
- Modify: `frontend/src/i18n.fr.js`
- Modify: `frontend/src/i18n.en.js`

**Interfaces:**
- Produit: clé `'queue_now_playing'` consommée par `i18n('queue_now_playing')` dans `queue.js` (Task 3)

- [ ] **Step 1: Ajouter la clé dans i18n.fr.js**

  Trouver la ligne `queue_empty: "File vide"` (≈ ligne 470) et ajouter juste après :

  ```js
  queue_empty:          "File vide",
  queue_now_playing:    'En cours de lecture',
  ```

- [ ] **Step 2: Ajouter la clé dans i18n.en.js**

  Même emplacement (≈ ligne 470) :

  ```js
  queue_empty:          'Queue empty',
  queue_now_playing:    'Now playing',
  ```

- [ ] **Step 3: Vérifier visuellement**

  ```bash
  grep -n "queue_now_playing" frontend/src/i18n.fr.js frontend/src/i18n.en.js
  ```

  Attendu : 1 ligne dans chaque fichier.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/i18n.fr.js frontend/src/i18n.en.js
  git commit -m "feat(queue): add queue_now_playing i18n key (FR + EN)"
  ```

---

### Task 2: Primitives `peekFirstExplicit` / `consumeFirstExplicit` dans `queue.js`

**Files:**
- Modify: `frontend/src/queue.js`
- Modify: `frontend/tests/core.test.cjs`

**Interfaces:**
- Consomme: `_queueOverride` (var module privée), `_trackIdxMap` (importé de `search.js`), `get('tracks')` (importé de `store.js`), `queueOpen`, `renderQueue`, `refreshQueueBadge` (vars/fonctions locales)
- Produit:
  - `peekFirstExplicit(): Track | null` — premier track valide de la queue explicite, sans la modifier
  - `consumeFirstExplicit(): Track | null` — retire le premier track valide, met à jour badge + panneau, retourne le track

- [ ] **Step 1: Écrire les tests inline dans core.test.cjs**

  Ajouter en fin de fichier, avant le bloc de rapport final :

  ```js
  // =============================================================================
  // N. queue.js — logique peekFirstExplicit / consumeFirstExplicit
  // =============================================================================
  section('queue.js -- peekFirstExplicit / consumeFirstExplicit (logique inline)');

  (function () {
    // Simulation légère de _trackIdxMap + tracks[]
    const _tmap = new Map([['t1', 0], ['t2', 1], ['t3', 2]]);
    const _tr   = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }, { id: 't3', name: 'C' }];

    function _peek(q) {
      if (!q?.length) return null;
      for (const id of q) {
        if (_tmap.has(id)) return _tr[_tmap.get(id)];
      }
      return null;
    }

    function _consume(q) {
      if (!q?.length) return { track: null, remaining: null };
      const track = _peek(q);
      if (!track) return { track: null, remaining: null };
      const fi  = q.findIndex(id => _tmap.has(id));
      const rem = q.slice(fi + 1);
      return { track, remaining: rem.length ? rem : null };
    }

    assert(_peek(null)      === null, 'peekFirstExplicit: queue null → null');
    assert(_peek([])        === null, 'peekFirstExplicit: queue vide → null');
    assert(_peek(['t1']).id === 't1', 'peekFirstExplicit: retourne le premier track');
    assert(_peek(['dead', 't2']).id === 't2', 'peekFirstExplicit: saute les IDs obsolètes');

    const r1 = _consume(['t1', 't2', 't3']);
    assert(r1.track.id === 't1',      'consumeFirstExplicit: retourne le premier track');
    assert(r1.remaining.length === 2, 'consumeFirstExplicit: remaining a 2 items');

    const r2 = _consume(['t1']);
    assert(r2.track.id   === 't1', 'consumeFirstExplicit: retourne le dernier track');
    assert(r2.remaining  === null, 'consumeFirstExplicit: remaining null quand vide');

    const r3 = _consume(['dead1', 'dead2', 't2']);
    assert(r3.track.id  === 't2', 'consumeFirstExplicit: saute stale IDs en tête');
    assert(r3.remaining === null, 'consumeFirstExplicit: remaining null après stale purge');
  }());
  ```

- [ ] **Step 2: Lancer les tests — vérifier qu'ils passent (logique inline)**

  ```bash
  node frontend/tests/core.test.cjs
  ```

  Attendu : les 8 nouvelles assertions `✓`. Aucune régression.

- [ ] **Step 3: Implémenter `peekFirstExplicit` dans queue.js**

  Ajouter après la ligne `export function addToQueueEnd(trackId) {` (≈ fin du fichier, ligne 648), avant la dernière accolade fermante :

  En réalité, ajouter à la fin du fichier (après `addToQueueEnd`), avant l'EOF :

  ```js
  /**
   * Retourne le premier track valide de la queue explicite sans le consommer.
   * Saute silencieusement les IDs dont la piste a été supprimée de la bibliothèque.
   * @returns {object|null}
   */
  export function peekFirstExplicit() {
    const ex = _buildExplicitQueue(); // filtre déjà les IDs invalides
    return ex.length ? ex[0] : null;
  }

  /**
   * Retire et retourne le premier track valide de la queue explicite.
   * Met à jour le badge et re-rend le panneau si ouvert.
   * Saute et purge les IDs obsolètes en tête de queue.
   * @returns {object|null}
   */
  export function consumeFirstExplicit() {
    if (!_queueOverride?.length) return null;
    const track = peekFirstExplicit();
    if (!track) {
      // Tous les IDs restants sont obsolètes — vider
      _queueOverride        = null;
      _queueOverrideTrackId = null;
      refreshQueueBadge();
      if (queueOpen) renderQueue();
      return null;
    }
    const fi = _queueOverride.findIndex(id => _trackIdxMap?.has(id));
    _queueOverride = _queueOverride.slice(fi + 1);
    if (!_queueOverride.length) {
      _queueOverride        = null;
      _queueOverrideTrackId = null;
    }
    refreshQueueBadge();
    if (queueOpen) renderQueue();
    return track;
  }
  ```

- [ ] **Step 4: Vérifier la syntaxe**

  ```bash
  node --input-type=module < frontend/src/queue.js 2>&1 | head -5
  ```

  Attendu : aucune erreur de syntaxe (le module a des imports Tauri qui échoueront à l'exécution, mais pas à la parse — si des erreurs `Cannot find module` apparaissent c'est normal).

  Alternativement : `npm run build 2>&1 | tail -20` et vérifier qu'il n'y a pas d'erreur de parse.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/queue.js frontend/tests/core.test.cjs
  git commit -m "feat(queue): add peekFirstExplicit and consumeFirstExplicit exports"
  ```

---

### Task 3: Câblage dans `player.js`

**Files:**
- Modify: `frontend/src/player.js:40-41` (imports)
- Modify: `frontend/src/player.js:473-516` (`peekNext`)
- Modify: `frontend/src/player.js:524-547` (`next` — bloc manualQueue)
- Modify: `frontend/src/player.js:1066-1079` (`getNextIdx`)

**Interfaces:**
- Consomme: `peekFirstExplicit(): Track | null` et `consumeFirstExplicit(): Track | null` (Task 2)
- Consomme: `playAt(filteredIdx, { keepQueue: true })` et `_playDirect(track, absoluteIdx)` (fonctions internes)
- Consomme: `filteredIdx(track)`, `trackIdx(track)` (de `search.js`, déjà importés)
- Ne produit pas de nouvelles interfaces

- [ ] **Step 1: Étendre l'import depuis `queue.js` (ligne 40-41)**

  Remplacer :
  ```js
  import { clearQueueOverride, queueOpen,
           renderQueue }                            from './queue.js';
  ```
  Par :
  ```js
  import { clearQueueOverride, queueOpen,
           renderQueue,
           peekFirstExplicit, consumeFirstExplicit } from './queue.js';
  ```

- [ ] **Step 2: Modifier `peekNext()` — priorité queue explicite (ligne 473)**

  Remplacer le corps de `peekNext()` de :
  ```js
  export function peekNext() {
    const tracks = get('tracks');
    if (!tracks?.length || curIdx < 0) return null;

    // File manuelle (priorité maximale)
    if (manualQueue.length) {
  ```
  Par :
  ```js
  export function peekNext() {
    const tracks = get('tracks');
    if (!tracks?.length || curIdx < 0) return null;

    // Queue explicite (priorité 1)
    const _epn = peekFirstExplicit();
    if (_epn) return _epn;

    // File manuelle (priorité 2)
    if (manualQueue.length) {
  ```

- [ ] **Step 3: Modifier `getNextIdx()` — priorité queue explicite (ligne 1066)**

  Remplacer le début de `getNextIdx()` de :
  ```js
  export function getNextIdx() {
    if (repeat === 'one') return -1;
    if (radioActive) {
  ```
  Par :
  ```js
  export function getNextIdx() {
    if (repeat === 'one') return -1;

    // Queue explicite (priorité 1 — avant radio, shuffle, naturel)
    const _egn = peekFirstExplicit();
    if (_egn) {
      const idx = trackIdx(_egn);
      if (idx >= 0) return idx;
    }

    if (radioActive) {
  ```

- [ ] **Step 4: Modifier `next()` — consommation de la queue explicite (ligne 524)**

  Remplacer le début du corps de `next()` (après la gestion `repeat='one'`) de :
  ```js
    const tracks = get('tracks'); // Phase 4

    // ── File manuelle ─────────────────────────────────────────────────────────
    if (manualQueue.length) {
  ```
  Par :
  ```js
    const tracks = get('tracks'); // Phase 4

    // ── Queue explicite (priorité 1) ──────────────────────────────────────────
    const _explicitNext = peekFirstExplicit();
    if (_explicitNext) {
      consumeFirstExplicit();
      // Queue épuisée si peekFirstExplicit() est maintenant null
      if (peekFirstExplicit() === null && !radioActive && !_queueEndedToastShown) {
        _queueEndedToastShown = true;
        setTimeout(() => toast(i18n('t_queue_ended'), 'info'), 400);
      }
      getFiltered(); // warm cache pour filteredIdx O(1)
      const fi = filteredIdx(_explicitNext);
      if (fi >= 0) { playAt(fi, { keepQueue: true }); return; }
      // Fallback : piste hors vue filtrée → lecture directe
      _playDirect(_explicitNext, trackIdx(_explicitNext));
      return;
    }

    // ── File manuelle ─────────────────────────────────────────────────────────
    if (manualQueue.length) {
  ```

- [ ] **Step 5: Smoke test manuel**

  ```bash
  npm run dev
  ```

  Scénario :
  1. Charger une bibliothèque avec au moins 3 pistes.
  2. Cliquer droit sur une piste → "Lire ensuite" → vérifier que le badge du bouton queue s'incrémente.
  3. Cliquer droit sur une deuxième piste → "Ajouter à la file" → badge += 1.
  4. Laisser la piste en cours se terminer (ou utiliser le bouton suivant).
  5. **Attendu** : la piste ajoutée en "Lire ensuite" joue en premier.
  6. Après sa fin, la piste "Ajouter à la file" joue.
  7. Quand les deux ont joué, un toast "File d'attente terminée" apparaît.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/player.js
  git commit -m "feat(queue): wire explicit queue into peekNext, getNextIdx, next"
  ```

---

### Task 4: Section "En cours" dans `renderQueue()` + CSS

**Files:**
- Modify: `frontend/src/queue.js` (fonction `renderQueue`, ≈ ligne 253)
- Modify: `frontend/src/style.css` (après ligne 4130, bloc "Queue : sections")

**Interfaces:**
- Consomme: `i18n('queue_now_playing')` (Task 1)
- Consomme: `curIdx`, `tracks`, `esc()`, `extEmoji()`, `fmtd()`, `audio` (tous déjà disponibles dans `renderQueue()`)

- [ ] **Step 1: Modifier `renderQueue()` — ajouter la section "En cours"**

  Dans `renderQueue()`, trouver ce bloc (≈ ligne 310-313) :
  ```js
    _updateQueueBadge(explicit.length + natural.length);

    if (!explicit.length && !natural.length) {
      el.innerHTML = `<div class="queue-empty">${i18n('queue_empty')}</div>`;
      return;
    }

    let html = '';
  ```

  Le remplacer par :
  ```js
    _updateQueueBadge(explicit.length + natural.length);

    let html = '';

    // ── Section "En cours" ──────────────────────────────────────────────────
    const curTrack = (curIdx >= 0 && tracks[curIdx]) ? tracks[curIdx] : null;
    if (curTrack) {
      const artNow = curTrack.art
        ? `<img src="${esc(curTrack.art)}" alt="">`
        : extEmoji(curTrack.ext ?? '');
      html += `<div class="queue-now-playing">
        <div class="queue-now-playing__label">${esc(i18n('queue_now_playing'))}</div>
        <div class="queue-item queue-item--now" data-action="play-queue-item" data-track-id="${curTrack.id}" tabindex="0" aria-label="${esc((curTrack.name ?? '') + ' — ' + (curTrack.artistFull || curTrack.artist || '') + ' — ' + (i18n('queue_now_playing') || ''))}">
          <div class="q-art q-art--now" aria-hidden="true">${artNow}
            <button class="q-art-hover-play" data-action="toggle-play" tabindex="-1" aria-hidden="true">
              <svg class="icon-play" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
              <svg class="icon-pause" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            </button>
          </div>
          <div class="q-info">
            <div class="q-name">${esc(curTrack.name ?? '')}</div>
            <div class="q-artist">${esc(curTrack.artistFull || curTrack.artist || '–')}</div>
          </div>
          <div class="q-dur" aria-hidden="true">${fmtd(curTrack.duration ?? 0)}</div>
        </div>
      </div>`;
    }

    if (!explicit.length && !natural.length) {
      el.innerHTML = html + `<div class="queue-empty">${i18n('queue_empty')}</div>`;
      patchPlayState(!audio.paused);
      return;
    }
  ```

  Note : l'`el.innerHTML` de la branche "vide" inclut maintenant `html` (la section "En cours") avant le message vide. Le `patchPlayState` est ajouté à cette branche car `el.innerHTML` a changé.

- [ ] **Step 2: Ajouter le CSS dans style.css**

  Après la ligne 4130 (`/* ── Queue : sections ──────────────────────────────── */`), insérer **avant** `.queue-section-header` :

  ```css
  /* ── Queue : section "En cours" ───────────────────────── */
  .queue-now-playing {
    padding: var(--sp-2h) var(--sp-3h) var(--sp-2);
    border-bottom: 1px solid var(--sep);
    margin-bottom: var(--sp-1);
  }
  .queue-now-playing__label {
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: var(--sp-1h);
  }
  .queue-item--now { cursor: default; }
  .queue-item--now:hover { background: var(--row-hover); }
  .q-art--now { width: 44px; height: 44px; }
  .q-art--now img { width: 44px; height: 44px; }
  /* Swap play/pause selon état audio sur la carte "En cours" */
  .queue-item--now .q-art-hover-play .icon-pause             { display: none; }
  .queue-item--now.playing-row .q-art-hover-play .icon-play  { display: none; }
  .queue-item--now.playing-row .q-art-hover-play .icon-pause { display: block; }
  ```

- [ ] **Step 3: Vérifier le rendu visuel**

  ```bash
  npm run dev
  ```

  Scénario :
  1. Lancer une piste.
  2. Ouvrir le panneau queue (bouton queue ou raccourci).
  3. **Attendu** : section "EN COURS DE LECTURE" (ou "NOW PLAYING") en haut avec artwork 44×44, titre, artiste, durée.
  4. Vérifier que le bouton play/pause overlay sur l'artwork fonctionne (toggle lecture).
  5. Passer à la piste suivante → la section "En cours" se met à jour automatiquement.
  6. Tester sans piste active (`curIdx = -1`) → section absente, message "File vide" seul.

- [ ] **Step 4: Vérifier que `patchPlayState` est correct**

  Ouvrir le queue panel pendant la lecture → vérifier que `.playing-row` est appliqué à `.queue-item--now` et que l'icône pause s'affiche sur hover.
  Mettre en pause → `.playing-row` doit disparaître de `.queue-item--now`.

- [ ] **Step 5: Lancer `npm test`**

  ```bash
  npm test
  ```

  Attendu : toutes les assertions passent, zéro `✗`.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/queue.js frontend/src/style.css
  git commit -m "feat(queue): add now-playing section to queue panel"
  ```

---

## Récapitulatif des commits

| # | Message | Fichiers |
|---|---|---|
| 1 | `feat(queue): add queue_now_playing i18n key (FR + EN)` | i18n.fr.js, i18n.en.js |
| 2 | `feat(queue): add peekFirstExplicit and consumeFirstExplicit exports` | queue.js, core.test.cjs |
| 3 | `feat(queue): wire explicit queue into peekNext, getNextIdx, next` | player.js |
| 4 | `feat(queue): add now-playing section to queue panel` | queue.js, style.css |
