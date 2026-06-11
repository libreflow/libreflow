# libreflow — Audit Complet du Codebase
**Date**: 2026-06-09  
**Auditeur**: Claude Sonnet 4.6 (12 agents spécialisés)  
**Périmètre**: tous les fichiers `frontend/src/`, `src-tauri/src/`, `frontend/tests/`  
**Résultat global**: **BLOCKED** — 5 violations CRITICAL, 40+ HIGH

---

## Table des matières

1. [Résumé exécutif](#1-résumé-exécutif)
2. [Tableau de bord des findings](#2-tableau-de-bord-des-findings)
3. [Violations CRITICAL](#3-violations-critical)
4. [Violations HIGH](#4-violations-high)
5. [Violations MEDIUM](#5-violations-medium)
6. [Violations LOW](#6-violations-low)
7. [Analyse par fichier (détail complet)](#7-analyse-par-fichier)
8. [Récapitulatif des invariants CLAUDE.md](#8-récapitulatif-des-invariants-claudemd)
9. [Plan de remédiation priorisé](#9-plan-de-remédiation-priorisé)
10. [Gaps de tests](#10-gaps-de-tests)

---

## 1. Résumé exécutif

L'audit couvre **~80 modules JS/CSS** + **8 fichiers Rust** + **la suite de tests**. L'application est fonctionnellement riche mais accumule une dette technique significative, avec **5 violations CRITICAL bloquantes** et plus de **40 violations HIGH**.

### Points positifs

- `virt.js` : exemplaire — binary search correct, zéro allocation en rAF, constantes depuis CFG.
- `ipc.js` : contrat IPC bien encapsulé, timeout présent.
- `app.js` boot sequence : invariants `rebuildTrackIdxMap` et `radioRefillQueue` correctement respectés.
- `cfg.js` / `cfgsave.js` : pattern correct de source unique de vérité.
- `player.js` crossfade : volume préservé via `#vol` DOM, pas de reset.
- Tests `core.test.cjs` : ~200 cas, bonne couverture des chemins critiques connus.

### Points critiques (bloquants)

1. **fetch() en production** — trois modules appellent `fetch()` qui est banni par CLAUDE.md §15 : `replaygain.js`, `artLoader.js`, `miniplayer.js`.
2. **XSS sinks dans `ui.js`** — `innerHTML` avec contenu non contrôlé dans `confirmAction` et `promptAction`.
3. **AudioParam `.value =` dans `eq.js`** — 6+ affectations directes causant du zipper-noise (§9).
4. **Données lofty en `innerHTML` sans `esc()`** — `tagedit.js`, `cinema.js`, `selection.js`, `smartplaylist.js`.
5. **Fichiers > 800 lignes** — `player.js` (1283), `eq.js` (899), `app.js` (1086), `playlists.js` (856).

---

## 2. Tableau de bord des findings

| Sévérité | Compte | Statut |
|----------|--------|--------|
| CRITICAL | 5 | BLOCK — ne pas merger |
| HIGH | 42 | WARN — doit être corrigé |
| MEDIUM | 28 | INFO — recommandé |
| LOW | 19 | NOTE — optionnel |
| **TOTAL** | **94** | |

### Répartition par domaine

| Domaine | CRITICAL | HIGH | MEDIUM | LOW |
|---------|----------|------|--------|-----|
| Pipeline Audio | 1 | 6 | 3 | 2 |
| Boot/State | 0 | 3 | 2 | 1 |
| Playback/Playlists | 0 | 5 | 3 | 2 |
| Rendu/VirtScroll | 0 | 3 | 3 | 1 |
| UI/Accessibilité | 0 | 6 | 4 | 3 |
| Bibliothèque/Tags | 2 | 5 | 2 | 1 |
| Cinéma/Viz | 1 | 4 | 3 | 1 |
| Composants Lit | 0 | 4 | 2 | 1 |
| Utilitaires/IPC | 1 | 3 | 2 | 2 |
| Fonct. Secondaires | 0 | 5 | 3 | 2 |
| Rust Backend | 0 | 3 | 3 | 1 |
| CSS/Tests | 0 | 3 | 2 | 2 |

---

## 3. Violations CRITICAL

Ces violations bloquent tout merge. Elles représentent des failles de sécurité ou des violations d'invariants fondamentaux.

---

### C-01 · `replaygain.js:119` — fetch() banni

**Invariant violé**: CLAUDE.md §15 (aucun appel réseau)
**Sévérité**: CRITICAL

```js
// replaygain.js:119
const arrayBuffer = await fetch(t.url).then(r => r.arrayBuffer());
```

`fetch()` est utilisé pour lire un fichier audio local via une URL blob/file afin de le décoder pour l'analyse ReplayGain. Cette API est explicitement bannie par §15, même pour les URLs locales — l'interdiction vise l'API elle-même, pas uniquement les appels réseau.

**Fix**: Utiliser un Tauri IPC command `read_file_bytes` ou lire via `AudioContext.decodeAudioData` depuis un chemin Tauri FS, ou accepter que l'analyse RG se fasse côté Rust via lofty.

---

### C-02 · `artLoader.js:271` — fetch() sur blob URL

**Invariant violé**: CLAUDE.md §15
**Sévérité**: CRITICAL

```js
// artLoader.js:271
const res = await fetch(t.art);  // t.art est une blob: URL
const buf = await res.arrayBuffer();
```

Même pattern que C-01. `fetch()` utilisé pour convertir un blob URL en ArrayBuffer.

**Fix**: Utiliser `FileReader.readAsArrayBuffer`, ou conserver le Blob directement depuis sa source d'origine sans passer par `fetch()`.

---

### C-03 · `miniplayer.js:123` — fetch() sur blob URL

**Invariant violé**: CLAUDE.md §15
**Sévérité**: CRITICAL

```js
// miniplayer.js:123
const blob = await fetch(t.art).then(r => r.blob());
```

Troisième occurrence du même pattern interdit.

**Fix**: Identique à C-02. Le blob est déjà disponible — ne pas le re-fetcher.

---

### C-04 · `ui.js:155` — innerHTML XSS sink dans `confirmAction`

**Invariant violé**: CLAUDE.md §13 (pas d'innerHTML avec contenu non contrôlé)
**Sévérité**: CRITICAL

```js
// ui.js:155
elB.innerHTML = body;  // body = paramètre de l'appelant
```

`body` est une chaîne HTML passée par tous les appelants de `confirmAction` à travers le codebase. Si un seul appelant passe du contenu dérivé de données lofty (titre, artiste, chemin de fichier), c'est XSS. Actuellement plusieurs appelants passent des templates avec des données de track.

**Fix**: Utiliser `elB.textContent = body` pour le contenu simple. Pour les dialogs avec HTML structurel, passer un HTMLElement construit programmatiquement.

---

### C-05 · `ui.js:199` — innerHTML XSS sink dans `promptAction`

**Invariant violé**: CLAUDE.md §13
**Sévérité**: CRITICAL

```js
// ui.js:199
bg.innerHTML = `
  <div class="modal" role="dialog"...>
    <h3>${title}</h3>        // injection si title contient des tags HTML
    <p class="body">${body}</p>
    ...
  </div>
`;
```

Template literal injecté directement comme `innerHTML`. `title` et `body` proviennent des appelants qui peuvent passer des données issues de lofty.

**Fix**: Construire le DOM programmatiquement avec `createElement` + `textContent` pour chaque champ textuel.

---

## 4. Violations HIGH

### Pipeline Audio

---

#### H-01 · `eq.js:170,179,191-195,201` — AudioParam `.value =` direct

**Invariant violé**: CLAUDE.md §9
**Sévérité**: HIGH — zipper noise audible

```js
// eq.js:170
biquad.frequency.value = band.freq;
// eq.js:179
biquad.Q.value = band.q;
// eq.js:191-195
biquad.gain.value = gains[i];   // x5 dans la boucle
// eq.js:201
masterGain.gain.value = 1.0;
```

Six affectations directes sur AudioParam lors de l'initialisation de l'EQ.

**Fix**:
```js
biquad.frequency.setValueAtTime(band.freq, eqCtx.currentTime);
biquad.Q.setValueAtTime(band.q, eqCtx.currentTime);
biquad.gain.setTargetAtTime(gains[i], eqCtx.currentTime, 0.02);
```

---

#### H-02 · `replaygain.js:53` — AudioParam `.value =` direct

**Invariant violé**: CLAUDE.md §9
**Sévérité**: HIGH

```js
// replaygain.js:53
rgGainNode.gain.value = 1.0;
```

**Fix**: `rgGainNode.gain.setTargetAtTime(1.0, ctx.currentTime, 0.02);`

---

#### H-03 · `eq.js:899` & `player.js:1283` — Fichiers > 800 lignes

**Invariant violé**: CLAUDE.md §16 (hard cap 800 lignes)
**Sévérité**: HIGH

- `eq.js`: 899 lignes (+99 au-dessus du cap)
- `player.js`: 1283 lignes (+483 au-dessus du cap)

**Fix**: Extraire depuis `eq.js` : `eq-presets.js` (helpers de preset) + `eq-handlers.js` (listeners). Depuis `player.js` : extraire `player-crossfade.js`.

---

#### H-04 · `player.js:checkCrossfade` — Fonction 153 lignes

**Invariant violé**: CLAUDE.md §16 (max 50 lignes par fonction)
**Sévérité**: HIGH

`checkCrossfade()` fait 153 lignes, `next()` fait 82 lignes.

**Fix**: Décomposer `checkCrossfade` en `_shouldCrossfade()`, `_startCrossfade()`, `_endCrossfade()`.

---

#### H-05 · `player.js:initCrossfadeAudio` — `setValueAtTime(v, 0)` timestamp passé

**Sévérité**: HIGH

```js
// player.js (init crossfade)
gainNode.gain.setValueAtTime(v, 0);  // timestamp 0 est dans le passé
```

**Fix**: Utiliser `eqCtx.currentTime` à la place de `0`.

---

#### H-06 · `replaygain.js:analyzeAndApplyRG` — Loop CPU 65536 sur main thread

**Sévérité**: HIGH — bloque l'UI pendant 100-500ms

`analyzeAndApplyRG()` (120 lignes) exécute une boucle `for (let i = 0; i < 65536; i++)` sur le thread principal.

**Fix**: Déplacer l'analyse dans un Web Worker, ou déléguer à lofty côté Rust via une commande IPC `analyze_replaygain`.

---

### Boot & State

---

#### H-07 · `app.js:boot` — Fonction 374 lignes

**Invariant violé**: CLAUDE.md §16
**Sévérité**: HIGH

**Fix**: Extraire `_bootAudio()`, `_bootUI()`, `_bootEventListeners()`, `_bootHandlers()` comme fonctions helper privées.

---

#### H-08 · `app.js:clearLibrary` — Fonction 118 lignes

**Invariant violé**: CLAUDE.md §16
**Sévérité**: HIGH

**Fix**: Extraire `_clearLibraryDB()`, `_clearLibraryUI()`.

---

#### H-09 · `state.js:setTracks` — Notification avant rebuild

**Invariant violé**: CLAUDE.md §7 (rebuildTrackIdxMap immédiatement après mutation)
**Sévérité**: HIGH

```js
// state.js
export function setTracks(v) {
  set('tracks', v);         // notifie les listeners
  rebuildTrackIdxMap();     // trop tard : listeners voient l'ancienne map
}
```

**Fix**: Inverser l'ordre : `rebuildTrackIdxMap()` d'abord, `set()` ensuite.

---

### Playback & Playlists

---

#### H-10 · `playlists.js:856` — Fichier > 800 lignes

**Invariant violé**: CLAUDE.md §16
**Sévérité**: HIGH

**Fix**: Extraire `playlists-render.js` (~200 lignes) et `playlists-modal.js`.

---

#### H-11 · `playlists.js` — Fonctions > 50 lignes

**Sévérité**: HIGH

- `confirmPlaylistModal()`: 71 lignes
- `showPlCtxMenu()`: 85 lignes
- `renderPlHero()`: 63 lignes

---

#### H-12 · `radio.js:226` — Import direct de `playlists.js`

**Invariant violé**: CLAUDE.md §6 (pas d'imports cross-feature-module)
**Sévérité**: HIGH

```js
// radio.js:226
import { getPlaylist } from './playlists.js';
```

**Fix**: Exposer `getPlaylist` via callback injecté depuis `app.js` à l'init de `radio.js`.

---

#### H-13 · `playlist-crud.js:savePlaylists` — Erreur IDB avalée silencieusement

**Sévérité**: HIGH

```js
// playlist-crud.js
async function savePlaylists() {
  try {
    await dput('playlists', ...);
  } catch (e) {
    console.warn(e);  // l'appelant croit que ça a réussi
  }
}
```

**Fix**: Re-throw l'erreur après `console.warn`.

---

#### H-14 · `queue.js:renderQueue` — Fonction 119 lignes

**Sévérité**: HIGH

---

### Rendu & Virtual Scroll

---

#### H-15 · `renderer-grids.js:renderArtistsGrid` — O(n) scan sur chaque keypress

**Sévérité**: HIGH — régression de performance critique sur 50k tracks

```js
// renderer-grids.js
function renderArtistsGrid(queryLc) {
  if (queryLc) {
    const map = {};
    for (const t of tracks) {  // O(50 000) par keypress
      if (t.artist?.toLowerCase().includes(queryLc)) ...
    }
  }
}
```

**Fix**: Filtrer `_getArtistMap()` (O(1)) plutôt que rescanner `tracks[]`.

---

#### H-16 · `renderer.js:virtRenderWindow` — Fonction 131 lignes + allocation rAF

**Sévérité**: HIGH

```js
// renderer.js (dans rAF)
requestAnimationFrame(() => listEl.scrollTop = pos)  // arrow fn allouée par appel
```

**Fix**: Stocker la fonction en dehors du chemin rAF.

---

#### H-17 · `bench.cjs:120` — ROW_H=36 vs CFG.VIRT_ROW_H=48

**Invariant violé**: CLAUDE.md §10
**Sévérité**: HIGH

```js
// bench.cjs:120
const ROW_H = 36;  // FAUX — CFG.VIRT_ROW_H = 48
```

Le benchmark est 25% trop optimiste. **Fix**: Importer `CFG.VIRT_ROW_H` depuis `cfg.js`.

---

### UI & Accessibilité

---

#### H-18 · `views.js:setView` — Fonction 206 lignes (god function)

**Sévérité**: HIGH

**Fix**: Extraire `_hideAllViews()`, `_showView(name)`, `_animateViewTransition()`.

---

#### H-19 · `views.js:plNewBtn, plSmartBtn` — Boutons icône sans `aria-label`

**Invariant violé**: WCAG 4.1.2
**Sévérité**: HIGH

```html
<button class="pl-new-btn"><!-- SVG icon seul, sans texte accessible --></button>
```

**Fix**: `aria-label="Nouvelle playlist"` et `aria-label="Playlist intelligente"`.

---

#### H-20 · `selection.js:sel-pl-picker` — Menu inaccessible au clavier

**Invariant violé**: WCAG 2.1.1
**Sévérité**: HIGH

Le picker de playlist n'a pas de `role=menu`, le focus n'y est pas déplacé à l'ouverture, et Escape ne le ferme pas.

---

#### H-21 · `selection.js:102` — `pl.id` non échappé dans innerHTML

**Invariant violé**: CLAUDE.md §13
**Sévérité**: HIGH

```js
// selection.js:102
picker.innerHTML += `<div data-id="${pl.id}">...`;
```

**Fix**: Utiliser `esc(pl.id)`.

---

#### H-22 · `shortcuts.js:invoke('open_devtools')` — IPC sans timeout

**Invariant violé**: CLAUDE.md §4
**Sévérité**: HIGH

**Fix**: `ipc('open_devtools', {}, 5000)`.

---

#### H-23 · `stats.js:renderStats` — Fonction 292 lignes

**Invariant violé**: CLAUDE.md §16
**Sévérité**: HIGH

**Fix**: Décomposer en `_renderTopArtists()`, `_renderGenreChart()`, `_renderListeningHistory()`, etc.

---

### Bibliothèque & Tags

---

#### H-24 · `library.js:25-33` — 4 imports cross-feature-module

**Invariant violé**: CLAUDE.md §6
**Sévérité**: HIGH

```js
// library.js
import { play } from './player.js';           // violation §6
import { updateBar } from './playerbar.js';   // violation §6
import { renderLib } from './renderer.js';    // violation §6
import { applyRG } from './replaygain.js';    // violation §6
```

**Fix**: Callbacks injectés par `app.js` dans `initLibrary({ onPlay, onUpdateBar, onRender, onRG })`.

---

#### H-25 · `settings.js:13-14` — 2 imports cross-feature-module

**Invariant violé**: CLAUDE.md §6
**Sévérité**: HIGH

```js
// settings.js
import { getEQPreset } from './eq.js';      // violation §6
import { getQueueMode } from './queue.js';  // violation §6
```

---

#### H-26 · `smartplaylist.js:25` — 5 imports depuis `playlists.js`

**Invariant violé**: CLAUDE.md §6
**Sévérité**: HIGH

---

#### H-27 · `tagedit.js:openTagEditor` — Données lofty en innerHTML sans esc()

**Invariant violé**: CLAUDE.md §13
**Sévérité**: HIGH

```js
// tagedit.js:119
infoEl.innerHTML = `
  <span>${t.ext}</span>          // lofty — données non fiables
  <span>${t.bitDepth}</span>
  <span>${t.sampleRate}</span>
  <span>${t.bitrate}</span>
  <span>${t.channels}</span>
`;
```

**Fix**: Construction DOM avec `textContent` ou `esc()` sur chaque champ.

---

#### H-28 · `tagedit.js:openTagEditor` — Fonction 119 lignes

**Invariant violé**: CLAUDE.md §16
**Sévérité**: HIGH

---

### Cinéma & Visualiseurs

---

#### H-29 · `cinema.js:597` — `extEmoji(t.ext)` en innerHTML

**Invariant violé**: CLAUDE.md §13
**Sévérité**: HIGH

```js
// cinema.js:597
em.innerHTML = extEmoji(t.ext);  // t.ext = donnée lofty non fiable
```

**Fix**: `em.textContent = extEmoji(t.ext)`.

---

#### H-30 · `cinema-viz.js:319` — Allocation `new Uint8Array` dans la garde RAF

**Invariant violé**: CLAUDE.md §10 (zéro allocation en RAF)
**Sévérité**: HIGH

```js
// cinema-viz.js:319 (dans le callback RAF)
if (!dataArr || dataArr.length !== analyser.frequencyBinCount) {
  dataArr = new Uint8Array(analyser.frequencyBinCount);  // allocation en RAF
}
```

**Fix**: Pré-allouer à l'init du visualiseur.

---

#### H-31 · `ambientRenderer.js:44` — 65536 `Math.random()` appels par 3 frames RAF

**Sévérité**: HIGH

```js
// ambientRenderer.js
function _regenerateNoise() {
  for (let i = 0; i < 65536; i++) noiseData[i] = Math.random();  // tous les 3 frames
}
```

~1 000 000 appels/seconde à 60fps. **Fix**: Précomputer le buffer une fois, ou utiliser du noise algorithmique (Simplex/Perlin).

---

#### H-32 · `cinema-viz.js:beatTimeline` — GSAP timelines non stockées

**Sévérité**: HIGH — memory leak + `_envMul.v` peut dériver

Les beat timelines créées à chaque beat ne sont jamais stockées. `stopCinemaViz()` ne peut pas les killer.

**Fix**: Stocker dans un Set, `kill()` sur chaque timeline dans `stopCinemaViz()`.

---

### Composants Lit

---

#### H-33 · `lf-modal.js:66` — Focus trap interroge le light DOM

**Sévérité**: HIGH

```js
// lf-modal.js:66
const focusables = this.querySelectorAll(FOCUSABLE_SEL);  // cherche en light DOM
// mais le keydown listener est sur shadowRoot
```

**Fix**: Interroger à la fois `shadowRoot` et les slotted elements.

---

#### H-34 · `lf-modal.js:74` — Focus initial silencieusement raté

**Sévérité**: HIGH

```js
// lf-modal.js:74
setTimeout(() => this.querySelector(FOCUSABLE_SEL)?.focus(), 0);
// no-op silencieux si aucun élément focusable slotté
```

**Fix**: Fallback sur `shadowRoot.querySelector('[tabindex="-1"]')?.focus()`.

---

#### H-35 · `lf-modal.js:aria-label` manquant quand label vide

**Invariant violé**: WCAG 4.1.2
**Sévérité**: HIGH

```js
<div role="dialog" aria-label=${this.label || undefined}>
// rend aria-label="undefined" quand this.label est vide
```

**Fix**: Ne pas rendre l'attribut si `label` est vide, utiliser `aria-labelledby`.

---

#### H-36 · `lf-toast-stack.js:host-context()` — CSS déprécié

**Sévérité**: HIGH

```css
:host-context([data-theme="light"]) { ... }
// Retiré Chrome 118+, jamais implémenté Firefox/Safari
```

**Fix**: CSS custom properties héritées depuis `:root[data-theme="light"]`.

---

### Utilitaires & IPC

---

#### H-37 · `ui.js:promptAction:role=dialog` mal placé

**Invariant violé**: WCAG 4.1.2
**Sévérité**: HIGH

```js
bg.innerHTML = `<div id="prompt-bg" role="dialog"...>  // backdrop
  <div class="modal">...                               // dialog réel sans role
```

**Fix**: Déplacer `role="dialog"` sur `.modal`.

---

#### H-38 · `ui.js:_trapFocus` dupliqué depuis `modal.js`

**Sévérité**: HIGH — deux implémentations peuvent diverger.

---

#### H-39 · `i18n.js:58` — `innerHTML` avec valeurs i18n

**Sévérité**: HIGH

```js
// i18n.js:58
el.innerHTML = i18n(key);
```

**Fix**: `el.textContent = i18n(key)` sauf si la traduction contient du HTML structurel documenté.

---

### Fonctionnalités Secondaires

---

#### H-40 · `cdaudio.rs:cd_rip_track` — `drive` non validé au niveau commande

**Sévérité**: HIGH

```rust
// cdaudio.rs
async fn cd_rip_track(drive: String, ...) -> Result<...> {
    let dev = open_drive(&drive)?;  // drive passé sans validation préalable
```

**Fix**: Valider `drive` (longueur, caractères, pas de `..`) avant `open_drive()`.

---

#### H-41 · `commands.rs:write_tags:566` — `is_safe_dir` manquant

**Sévérité**: HIGH

```rust
// commands.rs:566
let canonical = fs::canonicalize(&path)?;
// is_safe_dir(canonical.parent()) MANQUANT ici
lofty::write_tags(&canonical, tags)?;
```

`read_tags` (~ligne 230) fait cette vérification. `write_tags` et `write_replaygain_tags` (ligne 727) ne la font pas.

---

#### H-42 · `miniplayer.js:audio.volume` lu directement

**Invariant violé**: CLAUDE.md §2
**Sévérité**: HIGH

```js
// miniplayer.js
const vol = audio.volume;  // doit lire depuis #vol DOM
```

---

## 5. Violations MEDIUM

### M-01 · `eq.js:_applyGains(immediate=true)` — flag perpétue `.value =`

Quand `immediate=true`, `_applyGains` utilise `.value =` directement.

### M-02 · `player.js` — Magic numbers non dans CFG

```js
const FADE_MS = 50;         // CFG.CROSSFADE_FADE_MS
const SEEK_THRESHOLD = 80;  // CFG.SEEK_THRESHOLD_MS
const CROSSFADE_DUR = 3.0;  // CFG.CROSSFADE_DEFAULT_S
```

### M-03 · `playlists.js` — 2 `setTimeout(80)` magic delays

```js
setTimeout(() => updatePlHero(), 80);  // CFG.PL_HERO_UPDATE_DELAY_MS
```

### M-04 · `playlist-crud.js:150` — Debounce 150ms non dans CFG

```js
const DEBOUNCE_MS = 150;  // CFG.PL_SAVE_DEBOUNCE_MS
```

### M-05 · `handlers.js` & `shortcuts.js` — `_isTypingTarget` dupliqué

Fonction identique dans les deux modules. Extraire dans `utils.js`.

### M-06 · `search.js:getFiltered` — `new RegExp` sans flag `u`

```js
const re = new RegExp(query, 'i');  // manque 'u' pour Unicode
```

### M-07 · `search.js:getFiltered` — Fonction 149 lignes

### M-08 · `db.js:openDB` — Race condition double-open concurrent

```js
let _db = null;
async function openDB() {
  if (!_db) _db = await idb.openDB(...);  // deux await simultanés créent deux DB
}
```

**Fix**: `let _dbPromise = null; return _dbPromise ??= idb.openDB(...)`.

### M-09 · `ipc.js:timeout:0` — timeout bloquant non documenté

`timeout=0` signifie "attendre indéfiniment" — comportement non documenté.

### M-10 · `smartplaylist.js:t.id` dans innerHTML sans esc()

```js
results.innerHTML += `<div data-id="${t.id}">...`;
```

### M-11 · `lf-toast-stack.js:role=alert + aria-live=assertive` — double annonce

`role=alert` implique déjà `aria-live=assertive`. Double annonce sur certains lecteurs d'écran.

### M-12 · `modal.js:trapFocus` — Escape non géré

`trapFocus` ne handle pas Escape. Chaque module implémente son propre handler — si un oublie, la modale est inescapable au clavier (WCAG 2.1.2).

### M-13 · `backup.js:93,190` — `console.error` au lieu de `console.warn`

CLAUDE.md §14 prescrit `console.warn` pour les signaux documentés.

### M-14 · `watchfolder.js:184` — `console.error` idem

### M-15 · `cdaudio.js` — 4 `invoke()` sans timeout explicite

```js
await invoke('cd_read_toc', { drive });     // sans timeout
await invoke('cd_cancel_rip', { rip_id }); // sans timeout
await invoke('cd_purge_cache');             // sans timeout
await invoke('cd_cache_dir');               // sans timeout
```

### M-16 · `cdaudio.rs:cd_cancel_rip` — Retourne Err sur rip_id inconnu

Annuler un rip inconnu devrait être idempotent (`Ok(())`).

### M-17 · `commands.rs:win_set_title` — titre non borné

```rust
fn win_set_title(title: String, window: Window) {
    window.set_title(&title).unwrap();  // pas de cap longueur, pas de filtre control chars
```

### M-18 · `commands.rs:check_paths` — pas de `spawn_blocking`, pas de cap

```rust
fn check_paths(paths: Vec<String>) -> Result<Vec<bool>, String> {
    // pas de spawn_blocking pour fs::exists() en boucle
    // pas de cap sur paths.len()
```

### M-19 · `renderer-grids.js` — 4 fonctions > 50 lignes

- `renderDrillHeader()`: 100 lignes
- `renderAlbumsGrid()`: 85 lignes
- `renderArtistsGrid()`: 76 lignes
- `renderPlaylistsGrid()`: 75 lignes

### M-20 · `design-system.css` — tokens `--font` dupliqués

Déclarés en §3 ET §13 du même fichier.

### M-21 · `design-system.css:transition: --g` — `@property` non enregistrée

Sans `@property { syntax: '<color>'; }`, la transition CSS sur `--g` est silencieusement ignorée.

### M-22 · `updater.js` — appel réseau non documenté comme exception à §15

`@tauri-apps/plugin-updater` fait un appel réseau. Non documenté comme exception intentionnelle dans CLAUDE.md §15.

### M-23 · `queue.js` — magic numbers 50 et 20 non dans CFG

### M-24 · `shortcuts.js:initShortcuts` — listener 191 lignes inline

### M-25 · `oscPremium.js:draw` — allocations string en RAF

```js
ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;  // nouvelle string à chaque frame
ctx.fillStyle = `rgba(0,0,0,${alpha})`;     // idem
```

### M-26 · `selection.js:confirmBatchTagEdit` — Fonction 116 lignes

### M-27 · `playlists.js` — 2 listeners DOM au niveau module (side-effect à l'import)

```js
// playlists.js (top-level)
document.addEventListener('click', handlePlClick);
document.addEventListener('contextmenu', handlePlCtx);
```

Attachés à l'import, avant que le DOM soit prêt dans certains chemins.

### M-28 · `watch.rs:is_safe_dir` — canonicalize non appelé dans le callback notify

```rust
if is_safe_dir(p.parent()) { ... }  // p.parent() peut être un symlink
```

Devrait être `fs::canonicalize(p)` avant `is_safe_dir`.

---

## 6. Violations LOW

### L-01 · `playlog.js:playLog.slice(-N)` — rompt les live bindings ESM

```js
export let playLog = [];
playLog = playLog.slice(-N);  // réassigne la ref — les importeurs voient l'ancienne array
```

### L-02 · `radio.js:228,557` — `console.error` au lieu de `console.warn`

### L-03 · `watchfolder.js:_isValidFolderPath` — code mort

Défini mais jamais appelé.

### L-04 · `design-system.css` — `--accent-hover`, `--accent-active` non surchargés dans les thèmes

Certains accents peuvent avoir un contraste hover insuffisant.

### L-05 · `theme-palette.test.cjs` — 6 des 8 accents non testés pour le contraste

Orange `#f97316` est estimé à ~3:1 sur fond clair — risque d'échec AA.

### L-06 · `handlers.js:_isTypingTarget` & `shortcuts.js:_isTypingTarget` — duplication

### L-07 · `player.js` — magic numbers 50ms, 80ms, 3.0s non dans CFG (détail)

### L-08 · `cfgsave.js:_doSaveCfg` — Fonction 91 lignes

### L-09 · `ipc.js` — pas de retry sur timeout, comportement non documenté

### L-10 · `app.js:1086` — Fichier 1086 lignes (excessif)

### L-11 · `selection.js:selRemove` — Fonction 66 lignes

### L-12 · `tagedit.js:saveTagEdit` — Fonction 83 lignes

### L-13 · `artLoader.js:cacheArt` — pas de MIME allowlist

### L-14 · `artLoader.js` — pas de cap sur base64 legacy IDB avant `atob()`

### L-15 · `commands.rs:write_tags` — champs texte non bornés en longueur

### L-16 · `cdaudio.rs:rip_id` — non borné en longueur/contenu

### L-17 · `style.css` — `html[data-mode='light']` déclare des tokens CSS (devrait être dans design-system.css)

### L-18 · `style.css` — 14+ sélecteurs mixant id et class (CLAUDE.md §13)

```css
#organize-modal-bg.on { ... }    /* violation §13 */
#usb-modal-bg.on { ... }         /* violation §13 */
#cd-modal-bg.on { ... }          /* violation §13 */
#cinema-rep.rep-one { ... }      /* violation §13 */
/* ... 10 autres */
```

### L-19 · `updater.js:117` — `checkUpdate()` sans error handler

---

## 7. Analyse par fichier

### 7.1 Pipeline Audio — `player.js`, `eq.js`, `replaygain.js`

#### `player.js` (1283 lignes)

| Élément | Verdict |
|---------|---------|
| Taille fichier | VIOLATION — 1283 > 800 lignes (H-03) |
| `checkCrossfade()` | 153 lignes (H-04) |
| `next()` | 82 lignes (H-04) |
| `initCrossfadeAudio` | `setValueAtTime(v, 0)` timestamp passé (H-05) |
| Magic numbers 50ms/80ms/3.0s | MEDIUM (M-02) |
| Volume crossfade | CORRECT — préservé via `#vol` |
| `rebuildTrackIdxMap` | N/A |

**Fonctions à décomposer**:
- `checkCrossfade(153L)` → `_shouldCrossfade()` + `_startCrossfade()` + `_endCrossfade()`
- `next(82L)` → `_resolveNextTrack()` + `_loadAndPlay()`

---

#### `eq.js` (899 lignes)

| Élément | Verdict |
|---------|---------|
| Taille fichier | VIOLATION — 899 > 800 lignes (H-03) |
| `initEQ()` | ~100 lignes (M-01) |
| `.value =` direct | CRITICAL — 6 occurrences lignes 170,179,191-195,201 (H-01) |
| `_applyGains(immediate=true)` | MEDIUM — perpetue le pattern (M-01) |
| `eqSource` export | Couplage fragile avec replaygain.js |

---

#### `replaygain.js` (211 lignes)

| Élément | Verdict |
|---------|---------|
| `fetch(t.url)` ligne 119 | **CRITICAL** — fetch() banni §15 (C-01) |
| `rgGainNode.gain.value = 1.0` ligne 53 | HIGH — `.value =` direct (H-02) |
| `analyzeAndApplyRG()` | 120 lignes + loop 65536 CPU main thread (H-06) |
| Câblage graphe EQ direct | Fragilité architecturale |

---

### 7.2 Boot & State — `app.js`, `state.js`, `db.js`

#### `app.js` (1086 lignes)

| Élément | Verdict |
|---------|---------|
| Taille fichier | LOW — 1086 lignes (L-10) |
| `boot()` 374 lignes | HIGH (H-07) |
| `clearLibrary()` 118 lignes | HIGH (H-08) |
| `rebuildTrackIdxMap` usage | CORRECT |
| `radioRefillQueue` avant `updateBar` | CORRECT — invariant §7 respecté |
| `console.log` | Aucun trouvé — CORRECT |

---

#### `state.js` (142 lignes)

| Élément | Verdict |
|---------|---------|
| `setTracks()` ordre ops | HIGH — notification avant rebuild (H-09) |
| `replaceTracks()` ordre ops | CORRECT |

---

#### `db.js` (165 lignes)

| Élément | Verdict |
|---------|---------|
| Double-open concurrent | MEDIUM (M-08) |
| Debounce `dput` | CORRECT |

---

### 7.3 Playback & Playlists

#### `playlists.js` (856 lignes)

| Élément | Verdict |
|---------|---------|
| Taille fichier | VIOLATION — 856 > 800 lignes (H-10) |
| `confirmPlaylistModal()` 71L | HIGH (H-11) |
| `showPlCtxMenu()` 85L | HIGH (H-11) |
| `renderPlHero()` 63L | HIGH (H-11) |
| Listeners DOM top-level | MEDIUM (M-27) |
| Magic delays setTimeout(80) | MEDIUM (M-03) |

---

#### `playlist-crud.js` (268 lignes)

| Élément | Verdict |
|---------|---------|
| `savePlaylists()` avale l'erreur IDB | HIGH (H-13) |
| Debounce 150ms magic | MEDIUM (M-04) |

---

#### `radio.js` (749 lignes)

| Élément | Verdict |
|---------|---------|
| Import direct `playlists.js` | HIGH §6 (H-12) |
| `renderRadioView()` 122L | MEDIUM |
| `buildRadioQueue()` 73L | MEDIUM |
| `console.error` lignes 228, 557 | LOW (L-02) |

---

#### `queue.js` (679 lignes)

| Élément | Verdict |
|---------|---------|
| `renderQueue()` 119L | HIGH (H-14) |
| Accès DOM cross-module | MEDIUM |
| Magic numbers 50, 20 | MEDIUM (M-23) |

---

### 7.4 Rendu & Virtual Scroll

#### `renderer.js` (554 lignes)

| Élément | Verdict |
|---------|---------|
| `virtRenderWindow()` 131L | HIGH (H-16) |
| Allocation arrow fn dans rAF | HIGH (H-16) |
| `renderLib()` 79L | MEDIUM |

---

#### `renderer-grids.js` (732 lignes)

| Élément | Verdict |
|---------|---------|
| `renderArtistsGrid` O(n) sur query | HIGH — régression perf 50k tracks (H-15) |
| 4 fonctions > 50 lignes | MEDIUM (M-19) |

---

#### `virt.js` (149 lignes) — EXEMPLAIRE

| Élément | Verdict |
|---------|---------|
| Binary search | CORRECT — Int32Array prefix-sum |
| Constantes | CORRECT — toutes depuis CFG |
| Allocation en RAF | CORRECT — zéro |
| Buffer ±8 rows | CORRECT |

Aucun finding. Module de référence.

---

### 7.5 UI & Accessibilité

#### `views.js` (593 lignes)

| Élément | Verdict |
|---------|---------|
| `setView()` 206L | HIGH — god function (H-18) |
| `plNewBtn`, `plSmartBtn` sans aria-label | HIGH WCAG 4.1.2 (H-19) |
| `.onclick` inline assignments | MEDIUM |

---

#### `shortcuts.js` (270 lignes)

| Élément | Verdict |
|---------|---------|
| Listener 191L inline | MEDIUM (M-24) |
| `_isTypingTarget` dupliqué | LOW (L-06) |
| `invoke('open_devtools')` sans timeout | HIGH (H-22) |
| Volume sans `setAriaValueText` | MEDIUM |

---

#### `selection.js` (513 lignes)

| Élément | Verdict |
|---------|---------|
| `confirmBatchTagEdit()` 116L | MEDIUM (M-26) |
| `sel-pl-picker` inaccessible clavier | HIGH WCAG 2.1.1 (H-20) |
| `pl.id` non échappé innerHTML | HIGH §13 (H-21) |

---

#### `search.js` (526 lignes)

| Élément | Verdict |
|---------|---------|
| `getFiltered()` 149L | MEDIUM (M-07) |
| `new RegExp` sans flag `u` | MEDIUM (M-06) |

---

### 7.6 Bibliothèque & Tags

#### `library.js` (411 lignes)

| Élément | Verdict |
|---------|---------|
| 4 imports cross-feature-module | HIGH §6 (H-24) |
| `loadTagsBg()` ~110L | MEDIUM |
| `loadTagsAndDurations()` 84L | MEDIUM |
| `flushTrackBatch()` 70L | MEDIUM |
| `rebuildTrackIdxMap` après flush | CORRECT |

---

#### `tagedit.js` (281 lignes)

| Élément | Verdict |
|---------|---------|
| Audio info en innerHTML sans esc() | HIGH §13 (H-27) |
| `openTagEditor()` 119L | HIGH (H-28) |
| `saveTagEdit()` 83L | LOW (L-12) |

---

#### `artLoader.js` (296 lignes)

| Élément | Verdict |
|---------|---------|
| `fetch(t.art)` ligne 271 | **CRITICAL** §15 (C-02) |
| Pas de cap base64 legacy | LOW (L-14) |
| `cacheArt()` sans MIME allowlist | LOW (L-13) |

---

### 7.7 Cinéma & Visualiseurs

#### `cinema.js` (719 lignes)

| Élément | Verdict |
|---------|---------|
| `extEmoji(t.ext)` en innerHTML | HIGH §13 (H-29) |
| `updateCinema()` 159L | HIGH |
| `_onCinKey()` 57L | MEDIUM |

---

#### `cinema-viz.js` (351 lignes)

| Élément | Verdict |
|---------|---------|
| `new Uint8Array` dans garde RAF | HIGH (H-30) |
| Beat timelines non killées | HIGH memory leak (H-32) |

---

#### `oscPremium.js` (148 lignes)

| Élément | Verdict |
|---------|---------|
| String allocations par frame | MEDIUM (M-25) |
| `draw()` 70L | MEDIUM |

---

#### `ambientRenderer.js` (167 lignes)

| Élément | Verdict |
|---------|---------|
| 65536 Math.random() tous les 3 frames | HIGH (H-31) |
| `renderAmbientFrame()` 122L | HIGH |

---

### 7.8 Composants Lit

#### `lf-modal.js` (99 lignes)

| Élément | Verdict |
|---------|---------|
| Focus trap light DOM | HIGH (H-33) |
| Focus initial silencieusement raté | HIGH (H-34) |
| `aria-label="undefined"` quand vide | HIGH WCAG 4.1.2 (H-35) |

---

#### `lf-toast-stack.js` (316 lignes)

| Élément | Verdict |
|---------|---------|
| `:host-context()` déprécié | HIGH (H-36) |
| `role=alert` + `aria-live=assertive` double | MEDIUM (M-11) |
| Pas de `:focus-visible` sur `.t-close` | MEDIUM |

---

### 7.9 Utilitaires & IPC

#### `ui.js` (270 lignes)

| Élément | Verdict |
|---------|---------|
| `confirmAction` innerHTML body | **CRITICAL** §13 (C-04) |
| `promptAction` innerHTML template | **CRITICAL** §13 (C-05) |
| `_trapFocus` dupliqué | HIGH (H-38) |
| `role=dialog` sur backdrop | HIGH WCAG (H-37) |
| Listener module-level | MEDIUM |

---

#### `modal.js` (132 lignes)

| Élément | Verdict |
|---------|---------|
| Escape non géré dans `trapFocus` | MEDIUM (M-12) |

---

#### `ipc.js` (148 lignes)

| Élément | Verdict |
|---------|---------|
| `timeout=0` non documenté | MEDIUM (M-09) |
| Contract stable | CORRECT |

---

#### `i18n.js` (177 lignes)

| Élément | Verdict |
|---------|---------|
| `innerHTML = i18n(key)` | HIGH (H-39) |
| `applyLang()` 129L | HIGH |

---

### 7.10 Fonctionnalités secondaires

#### `miniplayer.js` (194 lignes)

| Élément | Verdict |
|---------|---------|
| `fetch(t.art)` ligne 123 | **CRITICAL** §15 (C-03) |
| `audio.volume` lu directement | HIGH §2 (H-42) |
| `invoke()` sans timeout | HIGH |

---

#### `backup.js` (204 lignes)

| Élément | Verdict |
|---------|---------|
| `console.error` lignes 93, 190 | MEDIUM (M-13) |

---

#### `watchfolder.js` (447 lignes)

| Élément | Verdict |
|---------|---------|
| `_isValidFolderPath` dead code | LOW (L-03) |
| `console.error` ligne 184 | MEDIUM (M-14) |

---

#### `cdaudio.js` (380 lignes)

| Élément | Verdict |
|---------|---------|
| 4 `invoke()` sans timeout | MEDIUM (M-15) |

---

#### `updater.js` (117 lignes)

| Élément | Verdict |
|---------|---------|
| Appel réseau non documenté | MEDIUM (M-22) |
| `checkUpdate()` sans error handler | LOW (L-19) |

---

### 7.11 Backend Rust

#### `commands.rs` (1428 lignes)

| Élément | Verdict |
|---------|---------|
| `write_tags:566` — `is_safe_dir` manquant | HIGH (H-41) |
| `write_replaygain_tags:727` — même | HIGH (H-41) |
| `win_set_title` — titre non borné | MEDIUM (M-17) |
| `check_paths` — pas de cap ni spawn_blocking | MEDIUM (M-18) |
| Champs texte write_tags non bornés | LOW (L-15) |

---

#### `cdaudio.rs` (736 lignes)

| Élément | Verdict |
|---------|---------|
| `drive` non validé au niveau commande | HIGH (H-40) |
| `rip_id` non borné | HIGH (L-16) |
| `cd_cancel_rip` Err sur inconnu | MEDIUM (M-16) |

---

#### `watch.rs` (133 lignes)

| Élément | Verdict |
|---------|---------|
| `is_safe_dir` sans canonicalize | MEDIUM (M-28) |

---

### 7.12 CSS & Tests

#### `design-system.css` (1065 lignes)

| Élément | Verdict |
|---------|---------|
| `transition: --g` sans `@property` | MEDIUM (M-21) |
| `--font` dupliqué | LOW (M-20) |
| `--accent-hover/active` manquant dans thèmes | LOW (L-04) |

---

#### `style.css` (~6300 lignes)

| Élément | Verdict |
|---------|---------|
| 14+ sélecteurs id+class mixés | LOW §13 (L-18) |
| `html[data-mode='light']` tokens CSS | LOW §17 (L-17) |

---

#### `bench.cjs`

| Élément | Verdict |
|---------|---------|
| `ROW_H = 36` vs `CFG.VIRT_ROW_H = 48` | HIGH §10 (H-17) |

---

#### `core.test.cjs` (~200 tests)

| Test manquant | Sévérité |
|----------------|----------|
| `audio.volume` DOM invariant | HIGH |
| IDB debounce invariant | HIGH |
| Network-call ban static scan | HIGH |
| Boot ordering (`radioRefillQueue` avant `updateBar`) | MEDIUM |
| `bench.cjs` ROW_H match CFG | MEDIUM |

---

#### `theme-palette.test.cjs`

| Élément | Verdict |
|---------|---------|
| 6/8 accents non testés pour contraste | MEDIUM |
| Orange `#f97316` probablement < AA | MEDIUM |

---

## 8. Récapitulatif des invariants CLAUDE.md

| Invariant | Statut | Finding |
|-----------|--------|---------|
| §2.1 `rebuildTrackIdxMap` après mutation | PARTIEL | `state.js:setTracks()` ordre incorrect (H-09) |
| §2.2 `audio.volume` depuis `#vol` DOM | VIOLATION | `miniplayer.js` lit directement (H-42) |
| §2.3 Pas de fetch/XHR/WebSocket | **3 VIOLATIONS** | C-01, C-02, C-03 |
| §2.4 IDB writes debounced | CORRECT | |
| §2.5 AudioParam via `setTargetAtTime` | **VIOLATION** | `eq.js` (6x) + `replaygain.js` (1x) |
| §2.6 IPC via `ipc.js` avec timeout | PARTIEL | `cdaudio.js` (4x), `shortcuts.js`, `miniplayer.js` |
| §2.7 `radioRefillQueue` avant `updateBar` | CORRECT | Respecté dans `app.js` |
| §2.8 Constantes virt depuis CFG | PARTIEL | `bench.cjs` hardcode ROW_H=36 (H-17) |
| §9 WCAG 2.1 AA + 2.2 AA | PARTIEL | H-19, H-20, H-33, H-34, H-35, H-36, H-37, M-11, M-12 |
| §13 innerHTML avec untrusted | **VIOLATIONS** | C-04, C-05, H-27, H-29, H-21, M-10 |
| §15 Offline guarantee | **3 VIOLATIONS** | C-01, C-02, C-03 |
| §16 Fichiers <800L, fonctions <50L | VIOLATIONS | 4 fichiers, 20+ fonctions |

---

## 9. Plan de remédiation priorisé

### Sprint 1 — CRITICAL (Débloquer le merge)

> Estimé: 1-2 jours

**C-01/C-02/C-03** — Remplacer `fetch()` dans `replaygain.js`, `artLoader.js`, `miniplayer.js`
- `replaygain.js:119`: Créer commande Rust `analyze_replaygain` via lofty, ou `FileReader.readAsArrayBuffer`
- `artLoader.js:271` + `miniplayer.js:123`: Lire le Blob directement depuis sa source sans re-fetch

**C-04/C-05** — Sécuriser `ui.js:confirmAction` et `promptAction`
- Remplacer `innerHTML = body` par construction DOM programmatique
- Auditer tous les appelants pour identifier les data flows à risque

---

### Sprint 2 — HIGH Audio (Qualité sonore)

> Estimé: 1 jour

1. `eq.js`: 6 affectations `.value =` → `setTargetAtTime` (H-01)
2. `replaygain.js:53`: `.value = 1.0` → `setTargetAtTime` (H-02)
3. `player.js`: `setValueAtTime(v, 0)` → `setValueAtTime(v, eqCtx.currentTime)` (H-05)
4. `replaygain.js:analyzeAndApplyRG`: déléguer à Rust ou Web Worker (H-06)

---

### Sprint 3 — HIGH Sécurité (Données untrusted)

> Estimé: 0.5 jour

1. `tagedit.js:openTagEditor`: échapper t.ext, t.bitDepth, etc. avec `esc()` (H-27)
2. `cinema.js:597`: `innerHTML = extEmoji(t.ext)` → `textContent` (H-29)
3. `smartplaylist.js`: `t.id` dans innerHTML → `esc(t.id)` (M-10)
4. `commands.rs:write_tags/write_replaygain_tags`: ajouter `is_safe_dir` check (H-41)

---

### Sprint 4 — HIGH Architecture (§6 cross-module imports)

> Estimé: 1-2 jours

1. Supprimer 4 imports cross-feature-module dans `library.js` (H-24)
2. Supprimer 2 imports dans `settings.js` (H-25)
3. Supprimer 5 imports dans `smartplaylist.js` (H-26)
4. `radio.js`: import de `playlists.js` → callback injecté (H-12)

Refactorer vers injection de callbacks depuis `app.js`: `initLibrary({ onPlay, onUpdateBar, onRender, onRG })`.

---

### Sprint 5 — HIGH Taille fichiers

> Estimé: 2-3 jours

1. `player.js` (1283L): extraire `player-crossfade.js` (H-03)
2. `eq.js` (899L): extraire `eq-presets.js` + `eq-handlers.js` (H-03)
3. `app.js:boot` (374L): décomposer en helpers `_bootAudio()`, `_bootUI()` (H-07)
4. `app.js:clearLibrary` (118L): décomposer (H-08)
5. `playlists.js` (856L): extraire `playlists-render.js` (H-10)
6. `stats.js:renderStats` (292L): décomposer par section (H-23)

---

### Sprint 6 — HIGH Performance

> Estimé: 0.5 jour

1. `renderer-grids.js:renderArtistsGrid`: filtrer `_getArtistMap()` (H-15)
2. `bench.cjs`: remplacer `ROW_H=36` par `CFG.VIRT_ROW_H` (H-17)
3. `cinema-viz.js`: pré-allouer Uint8Array hors RAF (H-30)
4. `ambientRenderer.js`: précomputer noise buffer (H-31)
5. `cinema-viz.js`: stocker beat timelines + killer dans `stopCinemaViz` (H-32)

---

### Sprint 7 — HIGH Accessibilité

> Estimé: 1 jour

1. `views.js`: ajouter `aria-label` sur boutons icônes (H-19)
2. `selection.js:sel-pl-picker`: `role=menu`, focus management, Escape (H-20)
3. `lf-modal.js`: corriger focus trap + focus initial + aria-label (H-33/34/35)
4. `lf-toast-stack.js`: remplacer `:host-context()` (H-36)
5. `ui.js:promptAction`: déplacer `role=dialog` sur `.modal` (H-37)

---

### Sprint 8 — HIGH IPC & Rust

> Estimé: 0.5 jour

1. `state.js:setTracks`: inverser ordre rebuild/notify (H-09)
2. `shortcuts.js:open_devtools`: ajouter timeout via `ipc.js` (H-22)
3. `cdaudio.rs:cd_rip_track`: valider `drive` au niveau commande (H-40)
4. `miniplayer.js:audio.volume`: lire depuis `#vol` DOM (H-42)
5. `selection.js:pl.id`: wrapper `esc()` (H-21)

---

### Sprint 9 — MEDIUM & LOW (Dette technique)

> Estimé: 2-3 jours (parallélisable)

- Promouvoir tous les magic numbers dans CFG (M-02, M-03, M-04, M-23)
- Dédupliquer `_isTypingTarget` → `utils.js` (M-05, L-06)
- `console.error` → `console.warn` dans backup.js, radio.js, watchfolder.js (M-13, M-14, L-02)
- Supprimer dead code `_isValidFolderPath` (L-03)
- `db.js:openDB` promise-singleton (M-08)
- `design-system.css`: supprimer `transition: --g`, résoudre doublons `--font` (M-21, M-20)
- `style.css`: migrer tokens vers `design-system.css` (L-17)
- `style.css`: corriger 14 sélecteurs id+class mixés (L-18)
- `theme-palette.test.cjs`: tester les 8 accents pour le contraste AA (L-05)
- `lf-toast-stack.js`: `role=alert` + `aria-live` → simplifier (M-11)

---

## 10. Gaps de tests

### Tests manquants critiques à ajouter dans `core.test.cjs`

```js
// Invariant audio.volume
test('audio.volume == #vol slider value at all times', () => {
  const vol = document.getElementById('vol');
  vol.value = '0.7';
  vol.dispatchEvent(new Event('input'));
  assert.strictEqual(getAudioVolume(), 0.7);
});

// Invariant IDB debounce
test('dput coalesces 100 rapid writes into <=2 actual IDB writes', async () => {
  const writes = [];
  // mock idb.put pour compter les appels
  for (let i = 0; i < 100; i++) dput('cfg', { key: 'test', val: i });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(writes.length <= 2);
});

// Network ban static check
test('no fetch() calls in source files', () => {
  const fs = require('fs');
  const glob = require('glob');
  const src = glob.sync('frontend/src/**/*.js');
  for (const f of src) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(
      !content.includes('fetch('),
      `fetch() found in ${f} — violation CLAUDE.md §15`
    );
  }
});

// Boot ordering
test('radioRefillQueue called before updateBar in boot sequence', () => {
  const order = [];
  mockRadioRefillQueue(() => order.push('radio'));
  mockUpdateBar(() => order.push('bar'));
  simulateBoot();
  assert.ok(
    order.indexOf('radio') < order.indexOf('bar'),
    'radioRefillQueue must precede updateBar'
  );
});

// bench.cjs ROW_H match CFG
test('bench.cjs ROW_H matches CFG.VIRT_ROW_H', () => {
  const fs = require('fs');
  const bench = fs.readFileSync('frontend/tests/bench.cjs', 'utf8');
  assert.ok(
    !bench.includes('ROW_H = 36'),
    'hardcoded ROW_H=36 in bench.cjs does not match CFG.VIRT_ROW_H=48'
  );
});
```

### Couverture accent themes à ajouter dans `theme-palette.test.cjs`

```js
const ACCENTS = ['purple','blue','green','orange','red','teal','pink','yellow'];
const BG_DARK = '#0a0a0a';
const BG_LIGHT = '#f5f5f5';

for (const accent of ACCENTS) {
  test(`accent:${accent} contrast >= 4.5:1 on dark bg (WCAG AA)`, () => {
    const color = getAccentColor(accent, 'dark');
    const ratio = contrastRatio(color, BG_DARK);
    assert.ok(ratio >= 4.5,
      `${accent} dark fails AA: ${ratio.toFixed(2)}:1 (need 4.5:1)`);
  });

  test(`accent:${accent} contrast >= 4.5:1 on light bg (WCAG AA)`, () => {
    const color = getAccentColor(accent, 'light');
    const ratio = contrastRatio(color, BG_LIGHT);
    assert.ok(ratio >= 4.5,
      `${accent} light fails AA: ${ratio.toFixed(2)}:1 (need 4.5:1)`);
  });
}
```

---

*Rapport généré le 2026-06-09.*
*Couverture: ~80 modules JS, 8 fichiers Rust, 5 fichiers CSS, 3 fichiers de tests.*
*Agents: audio-pipeline · boot-state · playback-playlists · rendering · ui-a11y · library-tags · cinema-viz · lit-components · utilities-ipc · secondary-features · rust-backend · css-tests.*
