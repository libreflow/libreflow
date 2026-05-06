# Queue modèle Spotify — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte du panneau queue avec deux sections séparées (explicite prioritaire + naturelle), drag-and-drop fluide via Pointer Events avec animations CSS, et suppression granulaire par item.

**Architecture:** `queue.js` gère toute la logique et le rendu du panneau. Le drag HTML5 (document-level) est remplacé par des Pointer Events locaux sur `#queue-list`. `handlers.js` perd ses 4 handlers DnD queue et gagne 2 actions (`clear-queue`, `remove-from-queue`). Aucun nouveau fichier.

**Tech Stack:** Vanilla JS ESM, Pointer Events API, CSS transitions/keyframes, Node.js 18+ (tests)

---

## Cartographie des fichiers

| Action | Fichier | Raison |
|--------|---------|--------|
| MODIFY | `frontend/src/queue.js` | +`_buildExplicitQueue`, +`_buildNaturalUpcoming`, +`removeFromQueue`, +`clearExplicitQueue`, +`_getQueueSource`, +`initQueueDrag`, refonte `renderQueue`, suppression exports HTML5 DnD |
| MODIFY | `frontend/src/handlers.js` | Supprimer imports/handlers HTML5 DnD queue, +actions `clear-queue` et `remove-from-queue` |
| MODIFY | `frontend/src/style.css` | Styles sections, ghost, transitions, spring-back |
| MODIFY | `frontend/tests/core.test.cjs` | Section 9 : tests data layer queue |

---

## Task 1 : Data layer — tests TDD + implémentation

**Files:**
- Modify: `frontend/tests/core.test.cjs` (section 9, avant le bloc `// -- Resultat ---`)
- Modify: `frontend/src/queue.js` (nouvelles fonctions internes + exports)

- [ ] **Step 1 : Ajouter la section 9 dans `core.test.cjs`**

Insérer juste avant le bloc `// -- Resultat ---` :

```js
// =============================================================================
// 9. QUEUE -- data layer : _buildExplicitQueue / _buildNaturalUpcoming / removeFromQueue
// =============================================================================
section('queue.js -- data layer fonctions pures');

function _buildExplicitQueue_t(queueOverride, trackIdxMap, tracks) {
  if (!queueOverride || !queueOverride.length) return [];
  return queueOverride
    .filter(function(id) { return trackIdxMap.has(id); })
    .map(function(id) { return tracks[trackIdxMap.get(id)]; });
}

function _buildNaturalUpcoming_t(filteredIds, curId, overrideIds, tracks, limit) {
  limit = limit || 50;
  var overSet   = new Set(overrideIds || []);
  var startIdx  = filteredIds.indexOf(curId);
  var result    = [];
  for (var i = startIdx + 1; i < filteredIds.length && result.length < limit; i++) {
    var id = filteredIds[i];
    if (!overSet.has(id)) {
      var t = tracks.find(function(x) { return x.id === id; });
      if (t) result.push(t);
    }
  }
  return result;
}

function removeFromQueue_t(queueOverride, id) {
  if (!queueOverride) return null;
  var next = queueOverride.filter(function(x) { return x !== id; });
  return next.length ? next : null;
}

(function () {
  var tracks = [
    { id: 'a', title: 'AAA' },
    { id: 'b', title: 'BBB' },
    { id: 'c', title: 'CCC' },
    { id: 'd', title: 'DDD' },
  ];
  var idxMap = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);

  // _buildExplicitQueue
  assert(_buildExplicitQueue_t(null, idxMap, tracks).length === 0,  'explicit: null -> []');
  assert(_buildExplicitQueue_t([],   idxMap, tracks).length === 0,  'explicit: vide -> []');
  var eq = _buildExplicitQueue_t(['c', 'a'], idxMap, tracks);
  assert(eq.length === 2,                                            'explicit: 2 items');
  assert(eq[0].id === 'c' && eq[1].id === 'a',                      'explicit: ordre préservé');
  var eqBad = _buildExplicitQueue_t(['c', 'z', 'a'], idxMap, tracks);
  assert(eqBad.length === 2,                                         'explicit: ID inconnu filtré');

  // _buildNaturalUpcoming
  var fl = ['a', 'b', 'c', 'd'];
  var nu = _buildNaturalUpcoming_t(fl, 'a', [], tracks);
  assert(nu.length === 3,         'natural: 3 tracks après "a"');
  assert(nu[0].id === 'b',        'natural: premier = "b"');
  var nuEx = _buildNaturalUpcoming_t(fl, 'a', ['b', 'c'], tracks);
  assert(nuEx.length === 1,       'natural: exclut override');
  assert(nuEx[0].id === 'd',      'natural: seul "d" reste');
  var nuEnd = _buildNaturalUpcoming_t(fl, 'd', [], tracks);
  assert(nuEnd.length === 0,      'natural: dernière piste -> []');
  var nuLimit = _buildNaturalUpcoming_t(['a','b','c','d'], 'a', [], tracks, 2);
  assert(nuLimit.length === 2,    'natural: limit respecté');

  // removeFromQueue
  assert(removeFromQueue_t(null, 'a') === null,  'remove: null -> null');
  var r1 = removeFromQueue_t(['a', 'b', 'c'], 'b');
  assert(r1.length === 2 && r1[0] === 'a' && r1[1] === 'c', 'remove: retire "b"');
  var r2 = removeFromQueue_t(['a'], 'a');
  assert(r2 === null,                            'remove: dernier item -> null');
  var r3 = removeFromQueue_t(['a', 'b'], 'z');
  assert(r3.length === 2,                        'remove: ID inconnu -> inchangé');
}());
```

- [ ] **Step 2 : Vérifier que la section 9 passe**

```bash
node frontend/tests/core.test.cjs
```

Résultat attendu : section 9 verte, 0 KO.

- [ ] **Step 3 : Ajouter les fonctions data layer dans `queue.js`**

Ajouter juste après le bloc `// ── State ─────` (ligne ~29, après `_queueOverrideTrackId`) :

```js
// ── Data builders ────────────────────────────────────────────

/** Queue explicite : map _queueOverride vers Track[], filtre IDs invalides. */
function _buildExplicitQueue() {
  if (!_queueOverride || !_queueOverride.length) return [];
  const tracks = get('tracks');
  return _queueOverride
    .filter(id => _trackIdxMap?.has(id))
    .map(id => tracks[_trackIdxMap.get(id)]);
}

/** Queue naturelle : tracks filtrées après la piste en cours, sans les IDs explicites. */
function _buildNaturalUpcoming() {
  const fl      = getFiltered();
  const curIdx  = get('curIdx');
  const tracks  = get('tracks');
  const overSet = new Set(_queueOverride || []);
  const curId   = curIdx >= 0 ? tracks[curIdx]?.id : null;
  const startFl = curId ? fl.findIndex(x => x.id === curId) : -1;
  const result  = [];
  for (let i = startFl + 1; i < fl.length && result.length < 50; i++) {
    if (!overSet.has(fl[i].id)) result.push(fl[i]);
  }
  return result;
}

/** Source textuelle pour le header "À suivre : [source]". */
function _getQueueSource() {
  const view = get('view');
  if (view === 'liked')    return 'Titres aimés';
  if (view === 'radio')    return 'Radio';
  if (view === 'playlist') {
    const pl = (get('playlists') || []).find(p => p.id === get('curPlId'));
    if (pl?.name) return pl.name;
  }
  return 'Bibliothèque';
}
```

- [ ] **Step 4 : Ajouter `removeFromQueue` et `clearExplicitQueue` dans `queue.js`**

Ajouter après `clearQueueOverride()` (vers ligne ~57) :

```js
/** Retire un ID de la queue explicite. */
export function removeFromQueue(id) {
  if (!_queueOverride) return;
  _queueOverride = _queueOverride.filter(x => x !== id);
  if (!_queueOverride.length) {
    _queueOverride        = null;
    _queueOverrideTrackId = null;
  }
  refreshQueueBadge();
  if (queueOpen) renderQueue();
}

/** Vide entièrement la queue explicite. */
export function clearExplicitQueue() {
  _queueOverride        = null;
  _queueOverrideTrackId = null;
  refreshQueueBadge();
  if (queueOpen) renderQueue();
}
```

- [ ] **Step 5 : Mettre à jour `_buildUpcoming()` pour conserver la compatibilité badge**

`_buildUpcoming()` est utilisé uniquement par `refreshQueueBadge()`. Le modifier pour combiner les deux sections :

```js
function _buildUpcoming() {
  const explicit = _buildExplicitQueue();
  const natural  = _buildNaturalUpcoming();
  return [...explicit, ...natural];
}
```

Remplacer le corps entier de la fonction `_buildUpcoming` existante par ce code.

- [ ] **Step 6 : Lancer les tests pour vérifier 0 KO**

```bash
node frontend/tests/core.test.cjs
```

Résultat attendu : 0 KO.

- [ ] **Step 7 : Commit**

```bash
git add frontend/tests/core.test.cjs frontend/src/queue.js
git commit -m "feat(queue): data layer — _buildExplicitQueue, _buildNaturalUpcoming, removeFromQueue, clearExplicitQueue"
```

---

## Task 2 : CSS — sections, items, boutons

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1 : Ajouter les styles queue dans `style.css`**

Chercher le bloc CSS queue existant (grep `queue-item` ou `q-drag-handle`). Ajouter à la suite :

```css
/* ── Queue : sections Spotify ──────────────────────────────── */
.queue-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 4px;
}
.queue-section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--c-text-2);
}
.queue-clear-btn {
  font-size: 11px;
  color: var(--c-text-2);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: color .15s, background .15s;
}
.queue-clear-btn:hover {
  color: var(--c-text);
  background: var(--c-hover);
}
.queue-section-divider {
  padding: 12px 12px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--c-text-2);
  border-top: 1px solid var(--c-border);
  margin-top: 6px;
}

/* Items explicites (draggable + supprimables) */
.queue-item--explicit {
  position: relative;
  will-change: transform;
  /* transition injectée dynamiquement pendant le drag uniquement */
}
.queue-item--explicit .q-drag-handle {
  cursor: grab;
  opacity: 0;
  transition: opacity .15s;
  flex-shrink: 0;
}
.queue-item--explicit:hover .q-drag-handle {
  opacity: 1;
}
.queue-item--explicit:active .q-drag-handle {
  cursor: grabbing;
}

.queue-remove-btn {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--c-text-2);
  font-size: 15px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color .15s;
}
.queue-item--explicit:hover .queue-remove-btn {
  display: flex;
  align-items: center;
}
.queue-remove-btn:hover {
  color: var(--c-accent);
}

/* Items naturels (lecture seule sauf promotion) */
.queue-item--natural {
  cursor: grab;
  padding-left: 12px; /* pas de handle visible */
}
.queue-item--natural:active {
  cursor: grabbing;
}

/* Drag states */
.q-placeholder {
  opacity: .25 !important;
  pointer-events: none;
}

/* ── Ghost drag ─────────────────────────────────────────────── */
.queue-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  border-radius: 8px;
  background: var(--c-surface);
  box-shadow: 0 6px 24px rgba(0,0,0,.35);
  opacity: .88;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

/* Promotion : zone explicite en surbrillance quand ghost au-dessus */
.queue-promote-active .queue-section-header {
  background: var(--c-hover);
  border-radius: 6px;
}

/* Spring-back animation (promotion annulée) */
@keyframes qSpringBack {
  0%   { opacity: .88; transform: scale(1); }
  100% { opacity: 0;   transform: scale(.92) translateY(8px); }
}
.queue-ghost--spring {
  animation: qSpringBack .25s ease forwards;
}
```

- [ ] **Step 2 : Vérifier visuellement que les nouvelles classes n'entrent pas en conflit**

Ouvrir l'application (`npm run tauri dev` ou `npm run vite:build`). Aucune erreur de lint CSS. Si des variables comme `--c-text-2`, `--c-hover`, `--c-border` n'existent pas, remplacer par les équivalents réels du projet (chercher `--c-text` dans style.css pour identifier les noms exacts).

- [ ] **Step 3 : Commit**

```bash
git add frontend/src/style.css
git commit -m "style(queue): sections Spotify, ghost drag, spring-back, transitions"
```

---

## Task 3 : `renderQueue()` — deux sections

**Files:**
- Modify: `frontend/src/queue.js`

- [ ] **Step 1 : Remplacer `renderQueue()` entièrement**

Remplacer la fonction `renderQueue()` existante (lignes 120–175 environ) par :

```js
export function renderQueue() {
  const el     = document.getElementById('queue-list');
  const tracks = get('tracks');
  const curIdx = get('curIdx');
  const repeat = get('repeat');

  // repeat='one' — comportement inchangé
  if (repeat === 'one' && curIdx >= 0) {
    const t = tracks[curIdx];
    _updateQueueBadge('∞');
    const artHTML = t?.art
      ? `<img src="${t.art}" alt="">`
      : extEmoji(t?.ext ?? '');
    const row = `<div class="queue-item queue-item--loop" data-action="play-queue-item" data-track-id="${t?.id}">
      <div class="q-art q-art--loop">${artHTML}<span class="q-loop-icon">🔂</span></div>
      <div class="q-info">
        <div class="q-name">${esc(t?.name ?? '')}</div>
        <div class="q-artist">${esc(t?.artistFull || t?.artist || '–')}</div>
      </div>
      <div class="q-dur">${fmtd(t?.duration ?? 0)}</div>
    </div>`;
    el.innerHTML = Array(5).fill(row).join('');
    return;
  }

  // Invalider l'override si la piste a changé depuis le reorder
  if (_queueOverride && curIdx >= 0 && tracks[curIdx]?.id !== _queueOverrideTrackId) {
    _queueOverride = null; _queueOverrideTrackId = null;
  }

  const explicit = _buildExplicitQueue();
  const natural  = _buildNaturalUpcoming();

  // repeat='all' : compléter la section naturelle si peu de pistes et pas d'override
  if (!_queueOverride && repeat === 'all' && natural.length < 20 && curIdx >= 0) {
    const fl    = getFiltered();
    const curId = tracks[curIdx]?.id;
    const startFl = fl.findIndex(x => x.id === curId);
    for (let i = 0; i < fl.length && natural.length < 20; i++) {
      if (i !== startFl && !natural.find(t => t.id === fl[i].id)) natural.push(fl[i]);
    }
  }

  _updateQueueBadge(explicit.length + natural.length);

  if (!explicit.length && !natural.length) {
    el.innerHTML = `<div class="queue-empty">${i18n('queue_empty')}</div>`;
    return;
  }

  let html = '';

  // ── Section "Prochainement" (queue explicite) ─────────────
  if (explicit.length) {
    html += `<div class="queue-section-header">
      <span class="queue-section-label">Prochainement (${explicit.length})</span>
      <button class="queue-clear-btn" data-action="clear-queue">✕ tout</button>
    </div>`;
    html += explicit.map((t, i) => {
      const artHTML = t.art ? `<img src="${t.art}" alt="">` : extEmoji(t.ext);
      return `<div class="queue-item queue-item--explicit" data-id="${t.id}" data-qi="${i}">
        <div class="q-drag-handle"><svg viewBox="0 0 6 14" aria-hidden="true" width="10" height="14"><circle cx="2" cy="2" r="1.2"/><circle cx="5" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="5" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/></svg></div>
        <div class="q-art">${artHTML}</div>
        <div class="q-info">
          <div class="q-name">${esc(t.name)}</div>
          <div class="q-artist">${esc(t.artistFull || t.artist || '–')}</div>
        </div>
        <div class="q-dur">${fmtd(t.duration)}</div>
        <button class="queue-remove-btn" data-action="remove-from-queue" data-track-id="${t.id}" title="Retirer">✕</button>
      </div>`;
    }).join('');
  }

  // ── Section "À suivre" (naturelle) ──────────────────────
  if (natural.length) {
    html += `<div class="queue-section-divider">À suivre : ${esc(_getQueueSource())}</div>`;
    html += natural.slice(0, 50).map((t, i) => {
      const artHTML = t.art ? `<img src="${t.art}" alt="">` : extEmoji(t.ext);
      return `<div class="queue-item queue-item--natural" data-id="${t.id}" data-ni="${i}"
          data-action="play-queue-item" data-track-id="${t.id}">
        <div class="q-art">${artHTML}</div>
        <div class="q-info">
          <div class="q-name">${esc(t.name)}</div>
          <div class="q-artist">${esc(t.artistFull || t.artist || '–')}</div>
        </div>
        <div class="q-dur">${fmtd(t.duration)}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
}
```

- [ ] **Step 2 : Mettre à jour `handlers.js` — actions `clear-queue` et `remove-from-queue`**

Dans `handlers.js`, ajouter les deux imports manquants :

```js
// Ligne d'import queue existante (vers ligne 24) — remplacer par :
import { toggleQueue, closeQueue, playQueueItem,
         addToQueueNext, addToQueueEnd,
         removeFromQueue, clearExplicitQueue }              from './queue.js';
```

Dans le registre `_ACTIONS` (section `// ── Queue`), ajouter :

```js
'clear-queue':           ()    => clearExplicitQueue(),
'remove-from-queue':     btn  => { removeFromQueue(btn.dataset.trackId); },
```

- [ ] **Step 3 : Lancer l'app et vérifier le rendu des deux sections**

```bash
npm run vite:build
```

Ouvrir la queue avec quelques pistes en cours. Vérifier :
- Section "Prochainement" visible si des pistes ont été ajoutées via "Lire ensuite"
- Section "À suivre : Bibliothèque" visible avec les pistes naturelles
- Bouton "✕ tout" visible dans le header explicite
- Bouton "✕" visible au hover sur chaque item explicite
- Click "✕" retire bien l'item

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/queue.js frontend/src/handlers.js
git commit -m "feat(queue): renderQueue deux sections Spotify + actions clear/remove"
```

---

## Task 4 : Pointer Events — reorder section explicite

**Files:**
- Modify: `frontend/src/queue.js`
- Modify: `frontend/src/handlers.js`

La constante de hauteur doit correspondre au CSS `.queue-item` (vérifier la valeur réelle dans style.css — chercher la propriété `height` sur `.queue-item`).

- [ ] **Step 1 : Ajouter la constante et le state drag dans `queue.js`**

Ajouter après le bloc `// ── State ─────` existant :

```js
// ── Drag Pointer Events ──────────────────────────────────────
const Q_ROW_H = 56; // hauteur px d'un .queue-item — doit correspondre au CSS

let _ptrState = null; // null quand inactif
```

- [ ] **Step 2 : Implémenter `initQueueDrag()` et les handlers Pointer Events**

Ajouter en fin de fichier, avant les exports :

```js
// ── Init drag (appelé une seule fois) ───────────────────────

/**
 * Attache le gestionnaire Pointer Events sur #queue-list (event delegation).
 * Survit aux innerHTML replacements car attaché au conteneur parent.
 */
export function initQueueDrag() {
  const el = document.getElementById('queue-list');
  if (!el || el.dataset.dragInit) return;
  el.dataset.dragInit = '1';
  el.addEventListener('pointerdown', _onQueuePointerDown);
}

function _onQueuePointerDown(e) {
  // Reorder explicite : drag depuis le handle
  const handle = e.target.closest('.q-drag-handle');
  if (handle) {
    const itemEl = handle.closest('.queue-item--explicit');
    if (itemEl) { _startReorderDrag(e, itemEl); return; }
  }
  // Promotion : drag depuis item naturel
  const natural = e.target.closest('.queue-item--natural');
  if (natural && !e.target.closest('[data-action]')) {
    _startPromotionDrag(e, natural);
  }
}

// ── Reorder drag (section explicite) ────────────────────────

function _startReorderDrag(e, itemEl) {
  e.preventDefault();
  const listEl = document.getElementById('queue-list');
  const items  = [...listEl.querySelectorAll('.queue-item--explicit')];
  const srcIdx = items.indexOf(itemEl);
  if (srcIdx < 0) return;

  const rect  = itemEl.getBoundingClientRect();
  const ghost = _createGhost(itemEl, rect);

  itemEl.classList.add('q-placeholder');
  items.forEach((el, i) => { if (i !== srcIdx) el.style.transition = 'transform .15s ease'; });

  _ptrState = {
    mode: 'reorder', listEl, itemEl, ghost, items,
    srcIdx, targetIdx: srcIdx,
    startY: e.clientY, startRectTop: rect.top,
  };

  window.addEventListener('pointermove',   _onReorderMove);
  window.addEventListener('pointerup',     _onReorderUp);
  window.addEventListener('pointercancel', _onReorderUp);
}

function _onReorderMove(e) {
  if (!_ptrState || _ptrState.mode !== 'reorder') return;
  const { ghost, items, itemEl, srcIdx, startY, startRectTop } = _ptrState;

  const dy = e.clientY - startY;
  ghost.style.top = (startRectTop + dy) + 'px';

  // Calcul index cible
  const ghostMid = parseFloat(ghost.style.top) + Q_ROW_H / 2;
  let targetIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === itemEl) continue;
    const midY = items[i].getBoundingClientRect().top + Q_ROW_H / 2;
    if (ghostMid > midY) targetIdx = i;
  }
  if (srcIdx <= targetIdx) targetIdx = Math.min(targetIdx, items.length - 1);
  _ptrState.targetIdx = targetIdx;

  // Animer les items voisins
  items.forEach((el, i) => {
    if (el === itemEl) return;
    let shift = 0;
    if (srcIdx < targetIdx && i > srcIdx && i <= targetIdx) shift = -Q_ROW_H;
    if (srcIdx > targetIdx && i >= targetIdx && i < srcIdx) shift =  Q_ROW_H;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function _onReorderUp() {
  if (!_ptrState || _ptrState.mode !== 'reorder') return;
  const { itemEl, ghost, items, srcIdx, targetIdx } = _ptrState;

  if (srcIdx !== targetIdx) {
    const ex = _buildExplicitQueue();
    const [moved] = ex.splice(srcIdx, 1);
    ex.splice(targetIdx, 0, moved);
    _queueOverride        = ex.map(t => t.id);
    _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;
  }

  _cleanupDrag(ghost, items, itemEl);
  window.removeEventListener('pointermove',   _onReorderMove);
  window.removeEventListener('pointerup',     _onReorderUp);
  window.removeEventListener('pointercancel', _onReorderUp);
  renderQueue();
}
```

- [ ] **Step 3 : Ajouter `_createGhost` et `_cleanupDrag` (helpers partagés)**

Ajouter juste avant `_startReorderDrag` :

```js
function _createGhost(itemEl, rect) {
  const ghost = itemEl.cloneNode(true);
  ghost.className = 'queue-ghost';
  ghost.style.cssText = [
    `left:${rect.left}px`, `top:${rect.top}px`,
    `width:${rect.width}px`, `height:${rect.height}px`,
  ].join(';');
  document.body.appendChild(ghost);
  return ghost;
}

function _cleanupDrag(ghost, items, itemEl) {
  ghost.remove();
  if (itemEl) itemEl.classList.remove('q-placeholder');
  items.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _ptrState = null;
}
```

- [ ] **Step 4 : Appeler `initQueueDrag()` depuis `toggleQueue()`**

Dans `toggleQueue()`, ajouter l'appel après `renderQueue()` :

```js
export function toggleQueue() {
  queueOpen = !queueOpen;
  document.getElementById('queue-panel').classList.toggle('open', queueOpen);
  document.getElementById('btn-queue').classList.toggle('active', queueOpen);
  document.getElementById('app')?.classList.toggle('panel-queue-open', queueOpen);
  if (eqOpen) closeEQ();
  if (queueOpen && document.getElementById('settings-panel').classList.contains('on')) closeSettings();
  if (queueOpen) { renderQueue(); initQueueDrag(); }  // ← initQueueDrag ajouté
}
```

- [ ] **Step 5 : Supprimer les handlers HTML5 DnD queue dans `handlers.js`**

Dans `handlers.js` :

1. **Import** — retirer `qDragStart, qDragOver, qDrop, qDragEnd` de l'import queue :
```js
import { toggleQueue, closeQueue, playQueueItem,
         addToQueueNext, addToQueueEnd,
         removeFromQueue, clearExplicitQueue }              from './queue.js';
```

2. **`_handleDragStart`** — retirer le bloc queue item (garder le reste) :
```js
function _handleDragStart(e) {
  const plNav = e.target.closest('[data-pl-drag-id]');
  if (plNav) { onPlNavDragStart(e, plNav.dataset.plDragId); return; }
  // Queue items : gérés via Pointer Events, plus via dragstart
  const tr = e.target.closest('[draggable="true"][data-track-id]');
  if (tr) { onTrackDragStart(e, tr.dataset.trackId); return; }
}
```

3. **`_handleDragOver`** — retirer le bloc queue :
```js
function _handleDragOver(e) {
  // Queue : géré par Pointer Events
}
```

4. **`_handleDrop`** — retirer le bloc queue :
```js
function _handleDrop(e) {
  // Queue : géré par Pointer Events
}
```

5. **`_handleDragEnd`** — retirer le bloc queue :
```js
function _handleDragEnd(e) {
  // Queue : géré par Pointer Events
}
```

- [ ] **Step 6 : Supprimer les exports HTML5 DnD devenus inutiles dans `queue.js`**

Dans `queue.js`, supprimer les fonctions `qDragStart`, `qDragOver`, `qDrop`, `qDragEnd` entièrement (lignes ~179–212). Supprimer aussi la variable `qDragIdx` devenue inutile.

Remplacer `_qDragging` dans `playQueueItem()` par le check `_ptrState` :

```js
export function playQueueItem(id) {
  if (_ptrState) return; // drag en cours → ignorer le click
  const t = (_trackIdxMap.has(id) ? get('tracks')[_trackIdxMap.get(id)] : undefined);
  // ... reste inchangé
```

Supprimer ensuite `let qDragIdx = -1;` et `let _qDragging = false;` du bloc State.

- [ ] **Step 7 : Tester le drag dans la section "Prochainement"**

Ajouter 3 pistes via "Lire ensuite". Ouvrir la queue. Tester :
- Saisir le handle (6 points) → item suit le curseur
- Les autres items s'écartent pendant le drag
- Relâcher → ordre commité, `renderQueue()` reconstruit le DOM

- [ ] **Step 8 : Commit**

```bash
git add frontend/src/queue.js frontend/src/handlers.js
git commit -m "feat(queue): Pointer Events drag reorder + suppression HTML5 DnD"
```

---

## Task 5 : Promotion depuis "À suivre" + spring-back

**Files:**
- Modify: `frontend/src/queue.js`

- [ ] **Step 1 : Implémenter `_startPromotionDrag` et ses handlers**

Ajouter après `_onReorderUp` dans `queue.js` :

```js
// ── Promotion drag (section naturelle → explicite) ───────────

function _startPromotionDrag(e, itemEl) {
  e.preventDefault();
  const listEl = document.getElementById('queue-list');
  const trackId = itemEl.dataset.id;
  if (!trackId) return;

  const rect  = itemEl.getBoundingClientRect();
  const ghost = _createGhost(itemEl, rect);
  ghost.classList.add('queue-ghost--promote');

  itemEl.classList.add('q-placeholder');

  _ptrState = {
    mode: 'promote', listEl, itemEl, ghost, trackId,
    startY: e.clientY, startRectTop: rect.top,
    targetIdx: -1,
  };

  window.addEventListener('pointermove',   _onPromotionMove);
  window.addEventListener('pointerup',     _onPromotionUp);
  window.addEventListener('pointercancel', _onPromotionUp);
}

function _onPromotionMove(e) {
  if (!_ptrState || _ptrState.mode !== 'promote') return;
  const { ghost, listEl, startY, startRectTop } = _ptrState;

  const dy = e.clientY - startY;
  ghost.style.top = (startRectTop + dy) + 'px';

  // Détecter si le ghost est au-dessus du séparateur "À suivre"
  const divider = listEl.querySelector('.queue-section-divider');
  const inZone  = divider
    ? e.clientY < divider.getBoundingClientRect().top
    : true; // pas encore de section explicite → toute la zone est valide

  listEl.classList.toggle('queue-promote-active', inZone);

  if (inZone) {
    const explicitItems = [...listEl.querySelectorAll('.queue-item--explicit')];
    const ghostMid = parseFloat(ghost.style.top) + Q_ROW_H / 2;
    let targetIdx = 0;
    for (let i = 0; i < explicitItems.length; i++) {
      const midY = explicitItems[i].getBoundingClientRect().top + Q_ROW_H / 2;
      if (ghostMid > midY) targetIdx = i + 1;
    }
    _ptrState.targetIdx = targetIdx;
  } else {
    _ptrState.targetIdx = -1;
  }
}

function _onPromotionUp() {
  if (!_ptrState || _ptrState.mode !== 'promote') return;
  const { itemEl, ghost, listEl, trackId, targetIdx } = _ptrState;

  listEl.classList.remove('queue-promote-active');

  if (targetIdx >= 0) {
    // Promouvoir : insérer dans la queue explicite à targetIdx
    const current = _queueOverride ? [..._queueOverride] : [];
    const filtered = current.filter(id => id !== trackId);
    filtered.splice(targetIdx, 0, trackId);
    _queueOverride        = filtered;
    _queueOverrideTrackId = get('tracks')[get('curIdx')]?.id ?? null;

    ghost.remove();
    itemEl.classList.remove('q-placeholder');
    _ptrState = null;
    window.removeEventListener('pointermove',   _onPromotionMove);
    window.removeEventListener('pointerup',     _onPromotionUp);
    window.removeEventListener('pointercancel', _onPromotionUp);
    renderQueue();
  } else {
    // Spring-back : annuler avec animation
    ghost.classList.add('queue-ghost--spring');
    setTimeout(() => { ghost.remove(); }, 300);
    itemEl.classList.remove('q-placeholder');
    _ptrState = null;
    window.removeEventListener('pointermove',   _onPromotionMove);
    window.removeEventListener('pointerup',     _onPromotionUp);
    window.removeEventListener('pointercancel', _onPromotionUp);
  }
}
```

- [ ] **Step 2 : Tester la promotion**

Ouvrir la queue avec au moins 5 pistes dans "À suivre". Tester :
- Glisser un item naturel vers le haut → la zone "Prochainement" se surligne
- Relâcher dans la zone → l'item apparaît dans "Prochainement" à la bonne position
- L'item disparaît de "À suivre" (exclu car dans `_queueOverride`)
- Glisser un item naturel et relâcher dans "À suivre" → spring-back (animation de retour), pas de changement

- [ ] **Step 3 : Vérifier les tests existants**

```bash
node frontend/tests/core.test.cjs
```

Résultat attendu : 0 KO (les nouvelles fonctions n'ont pas cassé les tests existants).

- [ ] **Step 4 : Vérifier le build complet**

```bash
npm run vite:build
```

Résultat attendu : build propre, aucun "Could not resolve" ni warning critique.

- [ ] **Step 5 : Commit final**

```bash
git add frontend/src/queue.js
git commit -m "feat(queue): promotion drag naturel→explicite + spring-back animation"
```

---

## Vérification finale

- [ ] `node frontend/tests/core.test.cjs` → 0 KO (section 9 incluse)
- [ ] `npm run vite:build` → build propre
- [ ] Queue vide → message "queue_empty" affiché, pas de section "Prochainement"
- [ ] 3+ pistes en queue explicite → drag-reorder fluide avec animations CSS
- [ ] Bouton "✕" au hover → retire l'item, badge mis à jour
- [ ] Bouton "✕ tout" → vide la queue explicite, section masquée
- [ ] Glisser depuis "À suivre" vers "Prochainement" → promotion à la bonne position
- [ ] Glisser depuis "À suivre" et relâcher dans la section naturelle → spring-back
- [ ] repeat='one' → comportement loop inchangé (5 lignes dégradées)
- [ ] repeat='all' → section naturelle complétée correctement sans override
