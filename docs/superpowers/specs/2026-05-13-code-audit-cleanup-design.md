# LibreFlow — Audit & Cleanup Design
**Date:** 2026-05-13  
**Objectif:** Application propre, qualité Spotify — zéro code mort, zéro bug recensé, polish UX complet, accessibilité WCAG 2.1 AA.  
**Approche:** Catégorie par catégorie (Approche A) — 4 passes séquentielles, un commit par passe.

---

## Périmètre

| Inclus | Exclus |
|--------|--------|
| `frontend/src/*.js` (51 modules) | Refactoring architectural ARCH-1 à ARCH-10 |
| `frontend/src/style.css` | Migrations de modules |
| `frontend/index.html` | Changements de comportement audio |
| `src-tauri/src/` (Rust) | Nouvelles fonctionnalités |

---

## Passe 1 — Code mort
**Commit cible :** `chore(cleanup): remove dead code`

### 1.1 — Re-exports "backward compat" dans `app.js` (lignes 63–105)
Vérifier que chaque re-export est encore importé par au moins un consommateur via grep cross-modules. Supprimer toute ligne sans consommateur actif.

Re-exports à vérifier :
- `playPlaylistFrom`, `playPlaylistDirect`, `shufflePlaylist` (ligne 63)
- `statsGoToGenre`, `statsGoToArtist`, `statsGoToAlbum` (ligne 80)
- `_allPlayerUI` (ligne 91)
- `confirmClear`, `closeModal` (ligne 97)
- `updateBar`, `updateVolSlider` (ligne 99)
- `saveCfg`, `saveCfgNow` (ligne 102)
- `setCurIdx`, `setTracks`, `setLiked`, `setCtxTrackId` (ligne 105)

### 1.2 — Exports orphelins dans `eq.js`
Les boutons A/B et AUTO ont été supprimés du HTML. Vérifier si ces exports sont encore appelés depuis l'extérieur de `eq.js` :
- `toggleEQAB`
- `toggleEQAutoMode`
- `setEQAutoMode`
- `startSmartEQ`, `stopSmartEQ`, `updateSmartEQGenre`

Si aucun consommateur externe : retirer l'export (conserver le code interne si SmartEQ l'utilise).

### 1.3 — CSS : sélecteurs orphelins
Chercher et supprimer les règles CSS qui ciblent des éléments retirés du HTML :
- `.eq-auto-btn`, `.eq-ab-btn` (supprimés lors de la refonte EQ)
- `.eq-status-wrap`, `.eq-detect-badge` (supprimés avec les boutons AUTO/AB)
- Token `--eq-canvas-h: 116px` dans `:root` (remplacé par `80px/160px` adaptatif — plus aucune référence)
- Toute règle `.eq-auto-*` subsistante

### 1.4 — HTML : éléments et `data-action` vestigiaux
Auditer `index.html` pour :
- Des `id` qui ne correspondent à aucun `document.getElementById` ni sélecteur CSS actif
- Des `data-action` qui ne correspondent à aucun case dans `handlers.js`
- Des éléments commentés qui ne seront jamais réactivés

### 1.5 — Rust : commandes non invoquées
Vérifier chaque `#[tauri::command]` dans `commands.rs` et `main.rs` contre les appels `invoke(...)` dans le JS :
- `allow_asset_dir` — présent dans `library.js` ? Vérifier.
- Tout autre command sans correspondant JS → supprimer + retirer du `invoke_handler!`.

---

## Passe 2 — Bugs
**Commit cible :** `fix: address audit findings`

### 2.1 — `_updateSmartStatus()` référence des éléments supprimés (`eq.js`)
`#eq-status-wrap` et `#eq-detect-badge` n'existent plus dans le DOM après la refonte EQ.  
La fonction retourne silencieusement (`if (!badge || !wrap) return`) mais est appelée à chaque changement de piste et de genre — cycles CPU inutiles.  
**Fix :** Évaluer si SmartEQ est encore fonctionnel. Si oui, réintégrer les éléments DOM ou désactiver les appels. Si non, supprimer `_updateSmartStatus` et ses call sites.

### 2.2 — `eqAutoMode` persisté mais sans effet UI
`cfgsave.js` sauvegarde `eqAutoMode`. `app.js` le restaure au boot via `setEQAutoMode(true)`. Mais `setEQAutoMode` ne met plus à jour aucun élément UI (bouton AUTO supprimé).  
**Fix :** Décider si `eqAutoMode` reste une feature persistée (en prévision d'un futur UI) ou si on retire la clé de cfg + le restore au boot.

### 2.3 — `#eq-panel::before` pendant la transition de largeur
Lors du passage Simple→Expert (320→400px), le pseudo-élément `::before` (filet d'accent) se redimensionne avec le panel via `width` transition.  
**Fix :** Vérifier visuellement. Si artefact, ajouter `overflow: hidden` sur `#eq-panel` ou exclure `::before` de la transition width.

### 2.4 — `_animFrame` : appels concurrents possibles
`_drawEQCurve()` est appelé depuis des chemins extérieurs (changement de piste, toggle enabled) sans passer par `_animateSlidersTo`. Ces appels ne cancellent pas `_animFrame`.  
**Fix :** Vérifier si `_drawEQCurve` seul peut être invoqué pendant une animation active et si cela crée un état incohérent. Si oui, ajouter un guard.

### 2.5 — Découverte dynamique
Lecture des fichiers chauds (`player.js`, `handlers.js`, `cinema.js`, `radio.js`) pour détecter :
- Promesses non catchées
- Race conditions sur timers
- Erreurs silencieuses non loguées

---

## Passe 3 — Polish UX / CSS
**Commit cible :** `polish: UX micro-improvements`

### 3.1 — View exit animation *(haute priorité)*
`.view-leave` et `@keyframes viewOut` existent dans `style.css` mais ne sont jamais déclenchés.  
**Fix :** Dans `views.js` `showView()`, ajouter la classe `.view-leave` sur la vue sortante, écouter `animationend`, puis swap la vue.  
Durée : `--dur-fast` (130ms). Easing : `--accelerate`.

### 3.2 — Context menu : scale-in
`#ctx-menu` apparaît instantanément sans transition.  
**Fix :** Ajouter `transform: scale(0.95) → scale(1)` + `opacity: 0 → 1` en `--dur-fast` avec `--spring` au moment où `.open` est activé.

### 3.3 — `dotpulse` → `art-color`
L'indicateur de lecture en sidebar (`.sb-dot.playing`) utilise une couleur fixe.  
**Fix :** Remplacer par `color-mix(in srgb, var(--art-color) 60%, transparent)` pour suivre la couleur artwork courante — cohérent avec le glow du player et les accents EQ.

### 3.4 — Row breath sur la piste active
`.tr.act.playing-row` est statique — aucune indication visuelle de lecture en cours dans la liste.  
**Fix :** Ajouter un pulse d'opacité subtil sur le fond d'accent : `10% → 17%` sur `3.2s ease-in-out infinite`. Respecter `prefers-reduced-motion`.

### 3.5 — Seek time preview sur `#pbar`
Le hover sur la barre de progression ne montre pas le timestamp cible.  
**Fix :** Ajouter un tooltip léger positionné dynamiquement au curseur (pattern `.vol-pill` du mini-player). Affiche `MM:SS` calculé depuis `audio.duration * (mouseX / barWidth)`.

---

## Passe 4 — Accessibilité & i18n
**Commit cible :** `a11y: accessibility and i18n fixes`

### 4.1 — `<html lang>` jamais mis à jour *(critique)*
`applyLang()` dans `i18n.js` ne met pas à jour `document.documentElement.lang`.  
**Fix :** Ajouter `document.documentElement.lang = lang;` dans `applyLang()` après avoir résolu la langue effective.

### 4.2 — `aria-label` hardcodés en français
Boutons du player bar, EQ, mini-player avec `aria-label="..."` littéraux FR dans le HTML.  
**Fix :** Inventorier tous les `aria-label` hardcodés. Les remplacer par un mécanisme `data-i18n-aria="clé"` lu par `applyLang()`. Ajouter les clés manquantes dans `i18n.js`.

### 4.3 — Toggles sans `aria-pressed`
Boutons shuffle, repeat, like : pas d'`aria-pressed`.  
**Fix :** Ajouter `aria-pressed="false"` dans le HTML, synchroniser dans les setters d'état correspondants (`setShuffle`, `setRepeat`, `toggleLike`).

### 4.4 — Track rows sans rôle ni tabindex
Les `<div>` de piste générés par le virtual scroll sont inaccessibles au clavier.  
**Fix :** Dans `renderer.js` `renderRow()`, ajouter `role="row"` et `tabindex="0"`. Gérer `keydown` Enter/Space pour activer la lecture.

### 4.5 — Texte hardcodé dans les éléments récents
Vérifier que tous les éléments ajoutés lors des sessions EQ récentes (`eq-mode-btn`, `eq-preset-label`, `eq-footer-reset`, `eq-scale` labels) passent bien par `data-i18n` ou sont des valeurs dynamiques correctement gérées.

---

## Contraintes & garde-fous

- **R1 inviolable :** aucune modification du graphe Web Audio
- **R2 inviolable :** `tracks[]` jamais trié en place
- **Chaque passe** : vérifier `npm run build` (Vite) avant commit
- **Passe 4** : tester avec le switch de langue FR↔EN après chaque fix i18n
- **Pas de nouveaux comportements** : les passes 1–3 ne changent pas la logique métier

---

## Livrables

| Passe | Commit | Fichiers principaux |
|-------|--------|---------------------|
| 1 — Code mort | `chore(cleanup): remove dead code` | `app.js`, `eq.js`, `style.css`, `index.html`, `commands.rs` |
| 2 — Bugs | `fix: address audit findings` | `eq.js`, `player.js`, `cinema.js` |
| 3 — Polish UX | `polish: UX micro-improvements` | `views.js`, `style.css`, `handlers.js` |
| 4 — A11y & i18n | `a11y: accessibility and i18n fixes` | `i18n.js`, `renderer.js`, `index.html`, `style.css` |
