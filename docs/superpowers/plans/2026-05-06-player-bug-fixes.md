# LibreFlow — Plan d'analyse et correction des bugs Player

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnostiquer tous les bugs fonctionnels du lecteur (boutons play/pause, prev, next, shuffle, repeat, like, volume, seek, speed, sleep) et les corriger de façon chirurgicale sans régression.

**Architecture:** L'app est un ES Module graph Vite 6 → Tauri v2. Les boutons utilisent un système de délégation centralisé dans `handlers.js` (`data-action="..."` → `_ACTIONS[action]()`). La logique de lecture est dans `player.js`, l'état global dans `store.js`, les évènements dans `bus.js`. Les bugs proviennent principalement de désynchronisations entre les variables locales des modules et le store réactif.

**Tech Stack:** Tauri v2, Vanilla JS ESM, Vite 6, IndexedDB, Web Audio API

---

## Bugs confirmés par analyse statique

| ID | Fichier | Ligne | Symptôme visible |
|----|---------|-------|-----------------|
| BUG-SLEEP-KEY | `index.html` | 317 | Enter dans le champ sleep custom → ReferenceError `setSleepCustom is not defined` |
| BUG-SHUFFLE-PL | `app.js` | 638–648 | "Shuffle playlist" : le bouton Next joue séquentiellement |
| BUG-CLEAR-STATE | `app.js` | 1211–1213 | Après "Vider bibliothèque" : shuffle/repeat incohérents dans player.js |
| BUG-DOUBLE-RIPPLE | `app.js` | 944–961 + `ui.js` | Double animation ripple sur chaque clic bouton |
| BUG-UNLISTENER | `app.js` | 939 | `mini-cmd` listener jamais nettoyé → fuite mémoire sur rechargement |

---

## Task 1 : Diagnostic DevTools — collecter toutes les erreurs console

**Files:**
- Read: aucun — procédure manuelle dans l'app

- [ ] **Step 1.1 : Lancer l'app en mode dev**

```powershell
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
npm run tauri dev
```

- [ ] **Step 1.2 : Ouvrir DevTools**

Raccourci dans l'app : `F12`  
Onglet Console → activer "Errors", "Warnings", "Logs".

- [ ] **Step 1.3 : Tester chaque bouton et noter les erreurs**

Liste des boutons à tester, dans l'ordre :

| Bouton | Action | Résultat attendu |
|--------|--------|-----------------|
| ▶ Play/Pause | Cliquer | Lance / met en pause l'audio |
| ⏮ Prev | Cliquer après > 3s | Retourne au début de la piste |
| ⏮ Prev | Cliquer avant 3s | Piste précédente |
| ⏭ Next | Cliquer | Piste suivante |
| 🔀 Shuffle | Cliquer | Toast "Lecture aléatoire activée", bouton s'allume |
| 🔀 Shuffle via playlist | Bouton "Shuffle" dans header playlist | Joue aléatoire, Next aussi |
| 🔁 Repeat | Cliquer 3× | Cycle none → all → one → none |
| ♥ Like | Cliquer | Cœur s'allume/s'éteint, vue "Favoris" mise à jour |
| 🔊 Volume | Glisser | Variation audio + tooltip % |
| ── Seek bar | Cliquer/glisser | Seek-tip apparaît, position change |
| Speed | Cliquer | 1× → 1.25× → 1.5× → 2× → 0.5× → 0.75× → 1× |
| Sleep timer | Cliquer → saisir valeur → Entrée | Minuterie active |
| Sleep timer | Cliquer → 15 min | Minuterie active |

- [ ] **Step 1.4 : Documenter chaque console.error/warn trouvé**

Format de documentation :
```
[BUTTON] <nom du bouton>
[ERROR]  <message d'erreur exact>
[FILE]   <fichier:ligne>
[ACTION] <action à prendre>
```

---

## Task 2 : BUG-SLEEP-KEY — Inline handler `setSleepCustom` cassé

**Files:**
- Modify: `frontend/index.html:317`
- Modify: `frontend/src/handlers.js`

**Cause :** `onkeydown="if(event.key==='Enter')setSleepCustom()"` appelle `setSleepCustom` comme variable globale (`window.setSleepCustom`). Après la migration BRIDGE-1, cette fonction n'est plus exposée sur `window`. Elle est importée dans `handlers.js` mais jamais liée au `keydown` de cet input.

- [ ] **Step 2.1 : Supprimer l'inline handler dans index.html**

Fichier : `frontend/index.html:317`

Avant :
```html
<input id="sleep-custom-input" class="sleep-custom-inp" type="number" min="1" max="999" placeholder="min…"
  onkeydown="if(event.key==='Enter')setSleepCustom()" />
```

Après :
```html
<input id="sleep-custom-input" class="sleep-custom-inp" type="number" min="1" max="999" placeholder="min…"
  data-input-action="sleep-custom-key" />
```

- [ ] **Step 2.2 : Ajouter le case dans `_handleInput` de handlers.js**

Fichier : `frontend/src/handlers.js`, dans la fonction `_handleInput`, après le `switch (el.dataset.inputAction)`, ajouter avant la fin `}` :

```js
    case 'sleep-custom-key':
      if (e.type === 'keydown' && e.key === 'Enter') setSleepCustom();
      break;
```

Attention : `_handleInput` est lié à `input` et `change` par défaut. Il faut aussi le lier à `keydown` pour cet input. Modifier `registerHandlers()` :

Avant :
```js
export function registerHandlers() {
  document.addEventListener('click',       _handleClick);
  document.addEventListener('click',       _handleBackdropClick);
  document.addEventListener('input',       _handleInput);
  document.addEventListener('change',      _handleInput);
  document.addEventListener('dblclick',    _handleDblClick);
  document.addEventListener('contextmenu', _handleContextMenu);
  document.addEventListener('keydown',     _handleKeydown);
  document.addEventListener('dragstart',   _handleDragStart);
}
```

Après (ajouter le listener `keydown` sur `_handleInput` également) :
```js
export function registerHandlers() {
  document.addEventListener('click',       _handleClick);
  document.addEventListener('click',       _handleBackdropClick);
  document.addEventListener('input',       _handleInput);
  document.addEventListener('change',      _handleInput);
  document.addEventListener('keydown',     _handleInput);   // pour sleep-custom-key Enter
  document.addEventListener('dblclick',    _handleDblClick);
  document.addEventListener('contextmenu', _handleContextMenu);
  document.addEventListener('keydown',     _handleKeydown);
  document.addEventListener('dragstart',   _handleDragStart);
}
```

Note : `_handleInput` vérifie déjà `el.dataset.inputAction` — les keydowns sur des éléments sans `data-input-action` sont ignorés.

- [ ] **Step 2.3 : Vérifier que `setSleepCustom` est bien importé dans handlers.js**

Fichier : `frontend/src/handlers.js:29`

Vérifier la ligne :
```js
import { toggleSleepMenu, setSleepTimer, setSleepEndOfTrack,
         setSleepCustom, cancelSleepTimer }                    from './sleep.js';
```
→ `setSleepCustom` est déjà importé. Aucune modification nécessaire.

- [ ] **Step 2.4 : Tester — saisir 5 dans le champ sleep, appuyer Entrée**

Attendu : minuterie active à 5 minutes. Aucune erreur console.

- [ ] **Step 2.5 : Commit**

```bash
git add frontend/index.html frontend/src/handlers.js
git commit -m "fix: sleep custom input — replace inline onkeydown with data-input-action delegation"
```

---

## Task 3 : BUG-SHUFFLE-PL — `shufflePlaylist` ne persiste pas shuffle dans le store

**Files:**
- Modify: `frontend/src/app.js:635–650`

**Cause :** `shufflePlaylist()` dans `app.js` fait `shuffle = true` (variable locale de app.js) mais n'appelle jamais `set('shuffle', true)`. Or `player.js` lit son propre `shuffle` depuis une subscription sur le store. Résultat : `player.js.shuffle` reste `false`, donc `next()` joue séquentiellement au lieu de shuffler.

- [ ] **Step 3.1 : Lire le code exact avant modification**

Fichier : `frontend/src/app.js:635–650`

```js
export async function shufflePlaylist() {
  const fl = getFiltered();
  if (!fl.length) return;
  const ri = Math.floor(Math.random() * fl.length);
  // Attendre playAt pour que curIdx et le cache soient à jour avant buildQ()
  await playAt(ri);
  shuffle = true;
  const _shufBtn = document.getElementById('pc-shuf');
  _shufBtn?.classList.add('on');
  _shufBtn?.setAttribute('aria-pressed', 'true');
  const _cinShufBtn = document.getElementById('cinema-shuf');
  _cinShufBtn?.classList.add('on');
  _cinShufBtn?.setAttribute('aria-pressed', 'true');
  buildQ(); // buildQ() utilise maintenant getFiltered() avec le bon curIdx
  _allPlayerUI();
}
```

- [ ] **Step 3.2 : Ajouter `set('shuffle', true)` et toast dans `shufflePlaylist`**

Fichier : `frontend/src/app.js`

Avant :
```js
  await playAt(ri);
  shuffle = true;
  const _shufBtn = document.getElementById('pc-shuf');
```

Après :
```js
  await playAt(ri);
  shuffle = true;
  set('shuffle', true);   // notifie player.js via subscription
  const _shufBtn = document.getElementById('pc-shuf');
```

- [ ] **Step 3.3 : Vérifier que `set` est bien importé en haut de app.js**

Fichier : `frontend/src/app.js:11`
```js
import { get, set, subscribe, setBatch }                   from './store.js';
```
→ `set` est déjà importé. Aucun import à ajouter.

- [ ] **Step 3.4 : Tester le bug shuffle playlist**

1. Ouvrir une playlist avec ≥ 5 titres
2. Cliquer le bouton "Shuffle playlist" (header de la vue playlist)
3. Cliquer Next 3 fois
4. Vérifier : les pistes jouées sont aléatoires, pas séquentielles
5. Vérifier : bouton shuffle player bar est bien allumé (classe `on`)
6. Vérifier console : aucune erreur

- [ ] **Step 3.5 : Commit**

```bash
git add frontend/src/app.js
git commit -m "fix: shufflePlaylist — propagate shuffle=true to store so player.js next() shuffles"
```

---

## Task 4 : BUG-CLEAR-STATE — `clearLibrary` ne reset pas shuffle/repeat dans le store

**Files:**
- Modify: `frontend/src/app.js:1196–1260`

**Cause :** Dans `clearLibrary()`, les lignes :
```js
shuffle = false; resetShuffleQ();  // app.js local var OK
repeat  = 'none';                  // app.js local var OK
```
…mettent à jour les variables locales de `app.js` mais pas le store. `player.js` a ses propres variables locales `shuffle` et `repeat` synchronisées depuis le store via `subscribe(...)`. Sans `set('shuffle', false)` et `set('repeat', 'none')`, `player.js` garde les anciennes valeurs après le clear.

- [ ] **Step 4.1 : Localiser le bloc dans clearLibrary**

Fichier : `frontend/src/app.js:1209–1215`

Code actuel :
```js
  curIdx  = -1; set('curIdx', -1);
  shuffle = false; resetShuffleQ();
  repeat  = 'none';
  query   = ''; set('query', '');
```

- [ ] **Step 4.2 : Ajouter les `set()` manquants**

Avant :
```js
  curIdx  = -1; set('curIdx', -1);
  shuffle = false; resetShuffleQ();
  repeat  = 'none';
  query   = ''; set('query', '');
```

Après :
```js
  curIdx  = -1; set('curIdx', -1);
  shuffle = false; set('shuffle', false); resetShuffleQ();
  repeat  = 'none'; set('repeat', 'none');
  query   = ''; set('query', '');
```

- [ ] **Step 4.3 : Vérifier que les boutons shuffle/repeat sont remis à zéro visuellement**

Le code existant dans `clearLibrary` (vers la ligne 1234) gère déjà le reset visuel des boutons :
```js
document.getElementById('pc-shuf').classList.remove('on');
document.getElementById('pc-shuf').setAttribute('aria-pressed', 'false');
document.getElementById('pc-rep').classList.remove('on');
document.getElementById('pc-rep').setAttribute('aria-pressed', 'false');
```
→ OK, pas de modification nécessaire ici.

- [ ] **Step 4.4 : Tester le bug clearLibrary**

1. Activer shuffle (bouton player bar)
2. Activer repeat "all"
3. Vider la bibliothèque (Settings → Vider)
4. Re-scanner un dossier
5. Vérifier : shuffle = OFF, repeat = none
6. Jouer une piste, cliquer Next 3 fois → séquentiel (pas aléatoire)

- [ ] **Step 4.5 : Commit**

```bash
git add frontend/src/app.js
git commit -m "fix: clearLibrary — reset shuffle/repeat in store so player.js state is consistent"
```

---

## Task 5 : BUG-DOUBLE-RIPPLE — Deux systèmes de ripple simultanés

**Files:**
- Modify: `frontend/src/app.js:944–961`

**Cause :** `ui.js` expose `initRipple()` qui ajoute un listener `pointerdown` sur `document`. `app.js` possède également sa propre fonction `spawnRipple()` + listener identique. Les deux s'enregistrent au boot → double animation ripple sur chaque clic.

- [ ] **Step 5.1 : Identifier le bloc à supprimer dans app.js**

Fichier : `frontend/src/app.js:944–961`

```js
// ── UX-6 Ripple — onde au clic sur .tr / .tbt / .pc ─────────────────────────
// Délégation sur document : un seul listener pour tous les éléments, y compris
// ceux créés dynamiquement par le virtual scroll.
function spawnRipple(el, x, y) {
  const rect = el.getBoundingClientRect();
  const cx   = x - rect.left;
  const cy   = y - rect.top;
  const maxD = Math.hypot(Math.max(cx, rect.width - cx), Math.max(cy, rect.height - cy)) * 2;
  const rpl  = document.createElement('span');
  rpl.className = 'rpl';
  rpl.style.cssText = `width:${maxD}px;height:${maxD}px;left:${cx - maxD/2}px;top:${cy - maxD/2}px`;
  el.appendChild(rpl);
  rpl.addEventListener('animationend', () => rpl.remove(), { once: true });
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.tr, .tbt, .pc, .tb-icon-btn, .mbtn, .pl-card, .sb-item');
  if (el && !el.classList.contains('tr-skel')) spawnRipple(el, e.clientX, e.clientY);
}, { passive: true });
```

- [ ] **Step 5.2 : Vérifier que `initRipple()` dans ui.js couvre les mêmes éléments**

Fichier : `frontend/src/ui.js:211–225`

```js
const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc';

export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(_RIPPLE_SEL);
    if (!el) return;
    ...
  }, { passive: true });
}
```

Le sélecteur de `ui.js` manque `.tb-icon-btn`, `.pl-card`, `.sb-item`. Mettre à jour `ui.js` avant de supprimer l'ancien :

Avant dans `ui.js` :
```js
const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc';
```

Après :
```js
const _RIPPLE_SEL = '.tr, .tbt, .mbtn, .pc, .tb-icon-btn, .pl-card, .sb-item';
```

- [ ] **Step 5.3 : Supprimer `spawnRipple` et son listener de app.js**

Supprimer le bloc entier (`function spawnRipple` + `document.addEventListener('pointerdown', ...)`) des lignes 944–961 de `app.js`.

- [ ] **Step 5.4 : Vérifier que `initRipple()` est bien appelé au boot**

Fichier : `frontend/src/app.js:913–916`

```js
waitForTauri(() => {
  boot();
  initWaveform(audio);
  initMediaSession();
  initMiniOverlayDrag();
  initRipple();         // ← doit être présent
  ...
});
```

Si absent, l'ajouter.

- [ ] **Step 5.5 : Tester les ripples**

1. Cliquer sur Play → 1 seule animation ripple
2. Cliquer sur une piste dans la liste → 1 seule animation
3. Cliquer sur un bouton toolbar → 1 seule animation
4. Aucune erreur console

- [ ] **Step 5.6 : Commit**

```bash
git add frontend/src/app.js frontend/src/ui.js
git commit -m "fix: double ripple — remove spawnRipple from app.js, expand ui.js initRipple selector"
```

---

## Task 6 : BUG-UNLISTENER — mini-cmd listener jamais nettoyé

**Files:**
- Modify: `frontend/src/app.js:539–553` (déclaration `_unlisteners`)
- Modify: `frontend/src/app.js:939` (push dans le listener)

**Cause :** `_unlisteners` est déclaré à l'intérieur de `boot()` (function scope). Le listener `mini-cmd` est créé dans le callback de `waitForTauri()` (scope externe). La closure du `.then(u => ...)` de `listen('mini-cmd', ...)` ne peut pas accéder à `_unlisteners` → `typeof _unlisteners` est toujours `'undefined'` → le listener Tauri est jamais enregistré pour cleanup → fuite mémoire sur rechargement.

- [ ] **Step 6.1 : Déplacer `_unlisteners` au niveau module dans app.js**

Fichier : `frontend/src/app.js`

Chercher la déclaration dans `boot()` (environ ligne 541) :
```js
  const _unlisteners = [];
```

La supprimer de l'intérieur de `boot()` et l'ajouter en variable module, avant la définition de `boot()` (par exemple juste après les déclarations de variables `let crossfadeDur = 0;` vers la ligne 178) :

```js
// Unlisteners Tauri — collectés ici pour cleanup sur pagehide
const _unlisteners = [];
```

- [ ] **Step 6.2 : Simplifier la condition dans le .then()**

Fichier : `frontend/src/app.js:939`

Avant :
```js
  }).then(u => { if (typeof _unlisteners !== 'undefined') _unlisteners.push(u); });
```

Après :
```js
  }).then(u => { _unlisteners.push(u); });
```

- [ ] **Step 6.3 : Vérifier les autres références à `_unlisteners` dans boot()**

Dans `boot()`, les lignes qui pushent dans `_unlisteners` (listen win-state, listen media-key, pagehide) utilisent `_unlisteners` directement — elles fonctionneront toujours puisque c'est maintenant une variable module.

Vérifier aussi `window.addEventListener('pagehide', ...)` qui itère `_unlisteners` — il accédera maintenant à la variable module. ✓

- [ ] **Step 6.4 : Tester en rechargement**

1. Lancer l'app
2. Ouvrir DevTools → Network ou console
3. Déclencher un rechargement (`F5` ou `Ctrl+R`)
4. Vérifier : aucun warning "listener already registered" ou double exécution de mini-cmd

- [ ] **Step 6.5 : Commit**

```bash
git add frontend/src/app.js
git commit -m "fix: mini-cmd unlistener — move _unlisteners to module scope for proper Tauri cleanup"
```

---

## Task 7 : Audit étendu — vérification des imports et symboles manquants

**Files:**
- Read: `frontend/src/app.js` (complet)
- Read: `frontend/src/views.js`
- Read: `frontend/src/settings.js`

**Objectif :** S'assurer qu'aucun autre `window.fn()` inline ou symbole non défini ne subsiste dans le code.

- [ ] **Step 7.1 : Chercher les `window.` dans index.html**

```bash
grep -n "window\." frontend/index.html
grep -n "on[a-z]*=" frontend/index.html
```

Attendu : 0 résultat pour les attributs `onclick`, `onchange`, `oninput`, `ondblclick`, sauf éventuellement des attributs d'animation CSS inoffensifs.

- [ ] **Step 7.2 : Chercher les inline handlers restants dans index.html**

```bash
grep -nE "on(click|keydown|change|input|dblclick|submit)=" frontend/index.html
```

Tout résultat trouvé doit être migré vers `data-action` ou `data-input-action`.

- [ ] **Step 7.3 : Vérifier l'intégrité JS avec Vite**

```powershell
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
npm run build 2>&1 | Select-String -Pattern "error|warning" -CaseSensitive:$false
```

Vérifier : aucune erreur de build. Les warnings "circular import" sont attendus et OK.

- [ ] **Step 7.4 : Si des bugs additionnels sont trouvés aux étapes 7.1–7.3**

Pour chaque inline handler trouvé :
1. Identifier la fonction cible
2. Ajouter un case dans `_ACTIONS` de `handlers.js` si c'est un click
3. Ajouter un case dans `_handleInput` si c'est un input/change/keydown
4. Remplacer l'attribut inline par `data-action="..."` ou `data-input-action="..."`
5. Commiter : `git commit -m "fix: migrate inline <event> handler to data-action delegation"`

- [ ] **Step 7.5 : Commit de l'audit**

```bash
git add -A
git commit -m "fix: audit — remove remaining inline handlers and undefined window.* references"
```

---

## Task 8 : Vérification intégrale des boutons player

**Files:**
- Aucun fichier modifié — procédure de test manuel

- [ ] **Step 8.1 : Lancer l'app après tous les fixes**

```powershell
npm run tauri dev
```

- [ ] **Step 8.2 : Protocole de test complet**

Tester CHAQUE bouton dans l'ordre ci-dessous. Pour chaque test :
- ✅ = fonctionne comme attendu
- ❌ = bug persistant à documenter

**Groupe 1 — Lecture de base**

| Test | Étapes | Attendu |
|------|--------|---------|
| Play depuis bibliothèque | Double-clic une piste | Audio joue, icône ⏸, titre dans player bar |
| Pause | Clic Play | Audio pausé, icône ▶ |
| Play depuis pause | Clic Play | Audio reprend, icône ⏸ |
| Space bar | Appuyer Espace | Toggle play/pause |

**Groupe 2 — Navigation**

| Test | Étapes | Attendu |
|------|--------|---------|
| Next séquentiel | Clic ⏭ | Piste suivante dans la liste |
| Prev < 3s | Clic ⏮ dans les 3 premières secondes | Piste précédente |
| Prev > 3s | Laisser jouer > 3s, clic ⏮ | Retour au début de la même piste |
| Arrow Right/Left | Touches ← → | prev() / next() |

**Groupe 3 — Shuffle**

| Test | Étapes | Attendu |
|------|--------|---------|
| Toggle shuffle | Clic 🔀 | Toast "aléatoire activé", bouton allumé |
| Next en shuffle | Clic ⏭ 5× | Pistes différentes, non séquentielles |
| Shuffle playlist | Header playlist → "Shuffle" | Joue aléatoire, Next aussi aléatoire |
| Désactiver shuffle | Clic 🔀 | Toast "aléatoire désactivé", Next séquentiel |

**Groupe 4 — Repeat**

| Test | Étapes | Attendu |
|------|--------|---------|
| Repeat All | Clic 🔁 | Toast "Répéter tout", bouton allumé |
| Repeat One | Re-clic 🔁 | Toast "Répéter un", bouton allumé + marqueur |
| Repeat Off | Re-clic 🔁 | Toast "Sans répétition", bouton éteint |
| Repeat One : ended | Laisser finir la piste | Même piste recommence |

**Groupe 5 — Like**

| Test | Étapes | Attendu |
|------|--------|---------|
| Like depuis player bar | Clic ♥ | Cœur allumé, animation popping |
| Unlike | Re-clic ♥ | Cœur éteint |
| Vue Favoris | Sidebar → Favoris | Piste likée apparaît |
| Like depuis liste | Clic ♥ sur une ligne | Même comportement |

**Groupe 6 — Volume et Seek**

| Test | Étapes | Attendu |
|------|--------|---------|
| Volume slider | Glisser | Son change + tooltip % |
| Seek bar clic | Clic sur la barre | Saut à la position |
| Seek bar drag | Glisser | seek-tip suit le curseur |
| Arrow Up/Down | Touches ↑ ↓ | Volume ±5% |

**Groupe 7 — Features annexes**

| Test | Étapes | Attendu |
|------|--------|---------|
| Speed cycle | Clic ⚡ | 1× → 1.25× → ... → 0.75× → 1× |
| Sleep timer preset | Clic horloge → 15 min | Minuterie active + countdown |
| Sleep timer custom | Clic horloge → saisir 3 → Enter | Minuterie 3 min active |
| Clear library | Settings → Vider | Bibliothèque vide, shuffle/repeat reset |

- [ ] **Step 8.3 : Documenter les bugs résiduels**

Pour chaque ❌ trouvé :
```
[BUG-NEW-X] <description>
[FILE] <fichier>
[STEPS] <reproduction>
[CAUSE] <hypothèse>
```

- [ ] **Step 8.4 : Créer des tâches de fix pour chaque bug résiduel**

Si des bugs additionnels sont trouvés en Step 8.3, créer des Tasks supplémentaires (Task 9, 10, …) en suivant le même format que Tasks 2–6.

---

## Checklist d'intégrité finale (CLAUDE.md §19)

Après TOUTES les corrections :

- [ ] `tracks[]` modifié → `rebuildTrackIdxMap()` appelé
- [ ] Volume : jamais `audio.volume = 1` hardcodé
- [ ] Aucun `fetch` externe
- [ ] Debounce respecté sur toutes les écritures IDB
- [ ] Virtual scroll constants inchangées
- [ ] Audio chain inchangée : Source → EQ → Analyser → Output
- [ ] Boot time < 5s (timeout IDB safety net)
- [ ] `window.*` aucun nouveau symbole ajouté

---

## Self-Review

### Spec coverage
- [x] BUG-SLEEP-KEY → Task 2
- [x] BUG-SHUFFLE-PL → Task 3
- [x] BUG-CLEAR-STATE → Task 4
- [x] BUG-DOUBLE-RIPPLE → Task 5
- [x] BUG-UNLISTENER → Task 6
- [x] Bugs inconnus → Task 7 (audit) + Task 8 (test)

### Invariants préservés
- Aucune modification du Web Audio graph
- Aucune mutation directe de `tracks[]` sans rebuild
- `audio.volume` jamais hardcodé dans les fixes proposés
- Toutes les modifications passent par `set()` du store
