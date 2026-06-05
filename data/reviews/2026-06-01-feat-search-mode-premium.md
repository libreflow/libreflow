# Code Review — feat/search-mode-premium

**Date:** 2026-06-01  
**Branch:** `feat/search-mode-premium` → `master`  
**Reviewer:** @reviewer (orchestrated: @audio-eng, @perf-eng, @design-eng)  
**Verdict:** ⚠️ WARN — 1 HIGH bloque le merge (voir H-1), 3 MEDIUM, 5 LOW

---

## Test Results

| Suite | Status | Count |
|-------|--------|-------|
| `npm test` | GREEN | 378 / 378 |
| `cargo check` | GREEN | compilation OK |
| `cargo test` | SKIPPED | .exe locked (app running) — check manually |

---

## Diff Summary

23 files, +1751 / -249 lines.

| Module | Change |
|--------|--------|
| `motion.js` | +132 — presets GSAP (view/panel/modal/player/list) |
| `ambientRenderer.js` | +89 — harmoniques duales, golden ratio drift, couches cB1/cB2 |
| `artcolor.js` | +99 — `_kmeansColors` (k-means++) + `sampleArtColors5` |
| `search.js` | +76 — `relevanceScore`, `_relevanceSort` (tri par pertinence) |
| `renderer.js` | -54 — suppression highlight markup, nettoyage `hlText` |
| `cinema.js` | refactor vers `sampleArtColors5` |
| `eq.js` / `queue.js` / `settings.js` | migration CSS animations -> GSAP panelOpen/Close |
| `player.js` | `setIcon` -> CSS-only play/pause toggle, bounce animation |
| `views.js` | view transitions -> GSAP viewEnter/viewExit, staggerIn grilles |
| `style.css` | `.tb-menu-item`, suppression `.srch-ct` / `mark.srch-hl`, outlines |
| `core.test.cjs` | +133 — tests `_kmeansColors` |

---

## §19 Invariants Checklist

- [x] `rebuildTrackIdxMap()` apres toute mutation `tracks[]` — aucune mutation dans ce diff
- [x] `audio.volume` jamais assigne litteralement
- [x] Aucun `fetch()`, `XMLHttpRequest`, `WebSocket` ajoute
- [x] Tous les nouveaux ecrits IDB debounced — aucun ecrit IDB ajoute
- [x] Parametres audio via `setTargetAtTime` — aucun AudioParam touche
- [x] Appels IPC via `ipc.js` avec timeout — aucun appel IPC ajoute
- [x] Constantes scroll virtuel depuis `CFG` — non touchees
- [x] `radioRefillQueue()` avant `updateBar()` — sequence boot non modifiee
- [x] Aucun `console.log` committe
- [x] Aucun reseau externe
- [x] Aucune police CDN externe
- [x] `innerHTML` avec contenu non fiable — `extEmoji()` retourne SVG hardcode

---

## Findings

---

### HIGH — H-1 · `_showViewRaw` — corruption layout sur navigation rapide A→B→A
**File:** `frontend/src/views.js` · fonction `_showViewRaw`

Quand l'utilisateur navigue rapidement A→B puis revient sur A avant la fin de l'animation de sortie (140ms) :

1. **A→B** : A reçoit `position:absolute; inset:0; pointer-events:none; z-index:1` en inline style. `viewExit(A)` démarre (0.14s). `.then(() => A.style.cssText = '')` est enregistré.
2. **Avant 140ms — B→A** : `next = A` → `viewEnter(A)` appelle `kill(A)`. **Tue `viewExit(A)`.** `.then()` ne se déclenche **jamais**.
3. A est maintenant la vue active (`.on`) mais conserve `position:absolute; inset:0` → **layout cassé** (la vue flotte au-dessus du contenu au lieu d'être dans le flux normal).

**Fix minimal (`views.js`) :**
```js
next.classList.add('on');
next.style.cssText = '';           // ← efface les inline styles de sortie résiduels
if (!prev || prev !== next) viewEnter(next);
```

---

### MEDIUM — M-1 · Paramètre `query` mort dans `thtml` / `virtRenderWindow`

**File:** `frontend/src/renderer.js`

`hlText` a été simplifié (résultats Spotify-like sans highlight). Mais `thtml` destructure toujours `query` et `virtRenderWindow` le passe encore. `query` n'est utilisé nulle part dans `thtml`. Code mort et trompeur.

**Fix :** Supprimer `query` du destructuring de `thtml` et du call-site dans `virtRenderWindow`.

---

### MEDIUM — M-2 · Race condition réouverture rapide settings

**File:** `frontend/src/settings.js` · `closeSettings`

```js
panelClose(box).then(() => {
  panel.classList.remove('on');  // 160ms plus tard
  ...
});
```

Si l'utilisateur rouvre le panneau dans les 160ms suivant la fermeture, `panel.classList.remove('on')` se déclenche **après** que `openSettings` l'ait ré-ajouté. Le panneau se ferme tout seul.

**Fix :** `kill(box)` en tête de `openSettings` pour annuler tout tween de fermeture en cours.

---

### MEDIUM — M-3 · `staggerIn` requête trop large dans `_deferGridRender`

**File:** `frontend/src/views.js`

`document.querySelectorAll('.card')` cible toutes les `.card` du DOM, pas seulement celles de la vue rendue. Risque pratique faible (guard token actif), mais fragile.

**Fix :** `document.querySelector('.view.on')?.querySelectorAll('.card') ?? []`

---

### MEDIUM — M-4 · Branches `else` mortes dans `closeEQ` et `closeQueue`

**Files:** `frontend/src/eq.js:322`, `frontend/src/queue.js:521`

```js
const ep = document.getElementById('eq-panel');
if (ep) panelClose(ep).then(() => ep.classList.remove('open'));
else document.getElementById('eq-panel')?.classList.remove('open'); // mort — ep déjà null
```

Re-requête la même variable qui vient d'être null. No-op garanti. **Supprimer les deux `else`.**

---

### LOW — `wasFuzzySearch` export mort (`search.js:353`)

Exporte mais plus importe nulle part depuis la refonte du badge.
Action : supprimer dans un pass cleanup separe.

### LOW — Branche `else` redondante dans `closeEQ` (`eq.js:322`)

```js
if (ep) panelClose(ep).then(() => ep.classList.remove('open'));
else document.getElementById('eq-panel')?.classList.remove('open');
```

Si `ep` est null, la re-requete retourne aussi null. Code mort inoffensif.
Action : supprimer le `else`.

### LOW — `staggerIn` requete trop large dans `_deferGridRender` (`views.js:96`)

`document.querySelectorAll('.card')` capture toutes les .card du DOM, pas seulement
celles du render en cours. Risque pratiquement nul (garde token actif).
Action : passer les cards en parametre ou appeler `staggerIn` depuis les fonctions renderX.

---

## Notes par agent

### @audio-eng

- Dual-harmonic drift (PHI=1.618) : fréquences irrationnelles évitent les patterns periodiques.
- `_regenerateNoise()` toutes les 3 frames : grain animé ~20fps, aucune allocation dans rAF.
- `sampleArtColors5` k-means++ 5 clusters sur canvas 64x64 : coût léger, hors rAF.
- `cB1`/`cB2` null-safe dans `renderAmbientFrame`.

### @perf-eng

- `STAGGER_CAP = 12` : plafonne le coût GSAP.
- `kill(el)` systematique avant chaque animation : pas de timeline leak.
- `clearProps: 'transform'` après panelOpen/trackSwap : restitue le flow CSS.
- Aucune allocation dans rAF.

### @design-eng

- Badge `sr-only` + `aria-live="polite"` : accessible sans badge visuel.
- `#ico-play/#ico-pause` : passage display:none JS -> CSS opacity+blur+scale via `.playing`. Transition fluide.
- `outline: 1px solid rgba(255,255,255,.08)` sur `.tart img` : hairline border artworks.
- `.empty-h` : `--t2` -> `--t` améliore le contraste états vides.
- `.clear-filters-btn` : style accent -> style neutre. Plus sobre.

### @reviewer

- `hlText` simplifié : tous les call-sites mis à jour.
- `_pressListenerAttached` guard : safe car `.pcplay` est élément statique non re-rendu.
- `relevanceScore` exporté / `_relevanceSort` interne : bonne separation.
- Aucune violation §6 cross-module ajoutée.

---

### LOW — `viewEnter` au premier chargement (flash initial)

**File:** `frontend/src/views.js`

Quand `prev = null` (boot), `!prev` est vrai → `viewEnter(next)` anime la première vue depuis opacity:0. Flash visible au démarrage.

**Fix :** `if (prev && prev !== next) viewEnter(next);`

---

### LOW — `relevanceScore` double-lowercase la query

**File:** `frontend/src/search.js`

Doc dit "caller passes lowercased q" mais la fonction re-lowercases en interne. Incohérence documentation/code.

---

### LOW — Debounce recherche réduit à 90ms

**File:** `frontend/src/cfg.js`

`SEARCH_DEBOUNCE` : 150ms → 90ms. Avec 50k pistes, `_relevanceSort` (O(n×champs)) tourne plus souvent. Benchmarker avec `npm run bench` avant de shipper.

---

### LOW — `staggerOut` appelle `gsap.set` deux fois en reduced-motion

**File:** `frontend/src/motion.js`

```js
if (prefersReducedMotion()) { gsap.set(els, { opacity: 0 }); return gsap.set(els, {}); }
```

Double appel redondant. Préférer `return gsap.to(els, { opacity:0, duration:0 })` pour la cohérence avec `staggerIn`.

---

### LOW — `_attachPressListener` appelé à chaque `setIcon`

**File:** `frontend/src/player.js`

Le guard `_pressListenerAttached` est correct mais `setIcon` est appelé fréquemment (crossfade, taskbar sync). Très mineur.

---

## Verdict

**⚠️ WARN — 1 HIGH bloque le merge**

Corriger **H-1** (`_showViewRaw` layout corruption) avant merge — fix d'une ligne dans `views.js`.  
M-1 à M-4 peuvent être adressés dans le même commit.  
Les LOW peuvent suivre dans un cleanup pass séparé.

**npm test:** ✅ 378/378 · **cargo test:** ⚠️ app en cours d'exécution (accès refusé) — relancer avec l'app fermée
