# LibreFlow

Lecteur de musique desktop libre et rapide, conçu pour les grandes bibliothèques locales. 100% offline — aucune connexion réseau, aucun compte, aucune télémétrie.

Construit avec [Tauri 2](https://tauri.app) (backend Rust) + JavaScript vanilla (frontend), pour un binaire léger et une consommation mémoire minimale comparé aux lecteurs Electron.

## Fonctionnalités

- **Bibliothèque locale scalable** — scan de dossiers, tags ID3/Vorbis/FLAC via [lofty](https://github.com/Serial-ATA/lofty-rs), virtualisation de liste (O(1)/O(log n)) pour des dizaines de milliers de pistes sans ralentissement
- **Lecture glitch-free** — pipeline Web Audio (EQ 10 bandes, ReplayGain, crossfade configurable jusqu'à 12s) sans zipper noise, transitions de gain via `setTargetAtTime`
- **Surveillance de dossiers** — détection automatique des nouveaux fichiers (via `notify`), import CD audio
- **Mode cinéma** — visualiseur plein écran avec pochette dynamique et fond ambiant
- **Mini-player** — fenêtre compacte indépendante pour contrôle rapide
- **Playlists intelligentes**, statistiques d'écoute, gestion des doublons/orphelins, éditeur de tags par lot
- **Sauvegarde/restauration** de la bibliothèque (export/import complet)
- **Accessible** — WCAG 2.1 AA + 2.2 AA/AAA (navigation clavier complète, lecteurs d'écran, contraste renforcé, cibles tactiles ≥24px)
- **Media keys OS** et intégration MediaSession (notifications système, contrôle depuis le clavier multimédia)

## Stack technique

| Composant | Technologie |
|---|---|
| Shell desktop | Tauri 2 (Rust) |
| Frontend | JavaScript vanilla ESM (~82 modules) + [Lit](https://lit.dev) pour les Web Components |
| Bundler | Vite 8 |
| Tags audio | lofty-rs |
| Surveillance FS | notify |
| Persistance | IndexedDB (frontend, via `idb`) |

## Développement

Prérequis : [Node.js 20+](https://nodejs.org), [Rust stable](https://rustup.rs), [prérequis Tauri](https://v2.tauri.app/start/prerequisites/) pour votre OS.

```bash
npm install
npm run dev          # lance l'app en mode développement (hot-reload)
```

### Scripts utiles

| Commande | Effet |
|---|---|
| `npm run dev` | Lance l'app Tauri en mode développement |
| `npm run build` | Build de production (installeur inclus) |
| `npm test` | Suite de tests JS (assertions vanilla) |
| `npm run bench` | Benchmark synthétique (bibliothèque de 50k pistes) |
| `npm run perf:check` | Build + budget bundle + bench + comparaison de régression perf |
| `cd src-tauri && cargo test` | Suite de tests Rust |
| `cd src-tauri && cargo clippy --all-targets` | Lint Rust |

### Tests

Le projet maintient une suite de tests conséquente exécutée en CI à chaque push :

- **Frontend** : tests unitaires (assertions vanilla, `frontend/tests/core.test.cjs`), tests d'accessibilité dédiés (`a11y.test.cjs`), tests de palette de thème (`theme-palette.test.cjs`), tests visuels Playwright, benchmark de performance synthétique avec détection de régression automatique
- **Backend** : tests Rust (`cargo test`) + property-based testing (`proptest`) + lint strict (`cargo clippy -D warnings`)

## Architecture

Les conventions de code, invariants architecturaux et décisions de conception sont documentés dans [`CLAUDE.md`](./CLAUDE.md) — la référence pour tout contributeur (humain ou agent) travaillant sur le projet.

Points clés :
- `frontend/src/app.js` — séquence de boot et câblage inter-modules (point d'orchestration unique)
- `frontend/src/ipc.js` — couche de transport IPC unique vers Rust (timeout obligatoire sur chaque appel)
- `frontend/src/db.js` — façade IndexedDB unique
- `src-tauri/src/` — commandes Tauri (scan fichiers, tags, CD audio, sauvegarde)

## Sécurité & confidentialité

Voir [`SECURITY.md`](./SECURITY.md) et [`PRIVACY.md`](./PRIVACY.md). En résumé : aucune donnée ne quitte la machine, aucune requête réseau sortante, CSP stricte, aucune dépendance à un service tiers.

## Licence

[MIT](./LICENSE) — © 2026 Robin Di Berardini. Licences des dépendances tierces : [`THIRD_PARTY_LICENSES.txt`](./THIRD_PARTY_LICENSES.txt) (npm) et [`THIRD_PARTY_LICENSES_RUST.txt`](./THIRD_PARTY_LICENSES_RUST.txt) (cargo).
