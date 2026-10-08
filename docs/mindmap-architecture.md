# LibreFlow — carte mentale de la construction

> Format Markmap : chaque niveau de titre/liste = une branche.
> Rendu : `npx --yes markmap-cli docs/mindmap-architecture.md -o docs/mindmap-architecture.html`

## 🎯 Identité

- Lecteur musique **offline**, desktop, mono-utilisateur
- **Tauri 2** (Rust) + **Vanilla ESM JS** + **Lit 3** (composants `lf-*`)
- Zéro appel réseau : `fetch` / `XMLHttpRequest` / `WebSocket` interdits
- ~27 000 lignes JS, 5 commandes npm de test/perf

## 🚀 Séquence de boot

- `main.js`
  - `registerHandlers()` — event delegation sur `document`
- `app.js` — orchestrateur unique
  1. Lecture cfg + IndexedDB en parallèle (`Promise.all([playlists, playlog, tracks])`)
  2. `rebuildTrackIdxMap()` — projection dérivée de `tracks[]`
  3. Câblage des listeners (`DOMContentLoaded`)
  4. `radioRefillQueue()` **avant** le premier `updateBar()`
  5. `loadTagsBg()` — hydratation tags incrémentale (concurrence 4)

## 🖥️ Frontend

### Infrastructure

- `ipc.js` — transport IPC unique, timeout obligatoire
- `db.js` — façade IndexedDB (`tracks`, `playlists`, `playlog`, `cfg`), écritures débouncées
- `cfg.js` / `cfgsave.js` — store settings + persistance
- `store.js` / `state.js` / `search.js` — état runtime + `rebuildTrackIdxMap()`
- `bus.js` — events cross-module
- `ui.js` — toasts + modales, délègue à `<lf-toast-stack>` (Lit)
- `utils.js` — `esc()`, formats, `moveByOne()`
- `handlers.js` — delegation click/dblclick/contextmenu/keydown/dragstart

### Web Audio (impératif, jamais Lit)

- `player.js` — `tracks[]` source de vérité, lecture, shuffle/repeat
- `eq.js` — chaîne Source → EQ → Analyser → Output
- `replaygain.js` — gain appliqué à la source, pas à la sortie
- `setTargetAtTime` partout — jamais `.value =` (bruit zipper)
- Crossfade : ramp in/out, `audio.volume` reflète toujours `#vol`

### Modules features

- `playlists.js` / `smartplaylist.js` — playlists, dossiers, épinglage, DnD
- `queue.js` — file « lire ensuite », drag Pointer Events
- `radio.js` — radio générative, refill avant updateBar
- `library.js` / `tags.js` / `organize.js` / `dupes.js` / `orphans.js`
- `cdaudio.js` (+ `cdaudio_pure.js` → `.cjs` généré) — import CD
- `settings.js` / `stats.js` / `genres.js` / `tagedit.js` / `m3u.js`
- `sleep.js` / `backup.js` / `devices.js` / `dropin.js` / `updater.js`

### Cinema (mode plein écran)

- `cinema.js` — façade, évite le cycle d'import player↔cinema
- `cinema-render` / `cinema-queue` / `cinema-seek` / `cinema-input`
- `cinema-bg` / `cinema-canvas` / `cinema-viz` / `cinema-waves` / `cinema-beat`
- `cinema-loop` — suspend/reactive GSAP

### UI / Rendu

- `virt.js` — scroll virtuel (binaire, zéro alloc dans la boucle, `CFG.VIRT_ROW_H`)
- `renderer.js` / `renderer-grids.js` — liste + grilles albums/artistes
- `views.js` / `search.js` / `keynav.js` / `selection.js` / `ctxmenu.js`
- `design-system.css` — unique source des tokens CSS
- `style.css` + Shadow DOM Lit

### Composants Lit

- `<lf-toast-stack>` (Phase 0)
- Préfixe `lf-*`, logique pure extraite en `.logic.js`

## 🦠 Backend Rust (`src-tauri/`)

- `commands.rs` — commandes Tauri typées, `Result<T, String>`
- `watch.rs` — FS watching (`notify`), retry reload
- `cdaudio.rs` / `cdaudio_toc.rs` — TOC CD, `lofty` pour les tags
- `backup.rs` / `mini.rs` / `taskbar.rs`
- Erreurs IPC mappées en messages utilisateur côté JS

## 🧪 Qualité & Tests

- `npm test` — 1542 tests (vanilla assert, CJS)
- `cargo test` — Rust + proptest
- `npm run bench` — 50k pistes synthétiques + budgets bundle (`perf-budgets.json`)
- `test:visual` — snapshots Playwright
- `frontend/tests/a11y.test.cjs` + `theme-palette.test.cjs` — WCAG 2.1/2.2 AA

## ⚖️ Invariants critiques (CLAUDE.md)

- `rebuildTrackIdxMap()` après **chaque** mutation de `tracks[]`
- `audio.volume` lu depuis `#vol` uniquement
- IDB toujours débouncé — jamais de commit par frappe
- IPC via `ipc.js` avec timeout
- `radioRefillQueue()` avant updateBar
- Pas d'`innerHTML` avec contenu non fiable — `esc()` systématique
- Pas de `console.log` committé
