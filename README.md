<div align="center">

# LibreFlow

**Lecteur audio de bureau, 100 % hors-ligne, respectueux de votre vie privée.**

Lit votre bibliothèque musicale locale sans jamais transmettre une seule donnée.

[![CI](https://github.com/libreflow/libreflow/actions/workflows/ci.yml/badge.svg)](https://github.com/libreflow/libreflow/actions/workflows/ci.yml)

</div>

---

## Pourquoi LibreFlow ?

LibreFlow est un lecteur musical pour Windows, macOS et Linux qui fait exactement
ce que vous attendez d'un lecteur — et rien d'autre :

- **100 % hors-ligne** — aucune télémétrie, aucun compte, aucun analytics, aucun crash report.
  Le seul flux réseau sortant possible est la vérification de mises à jour (désactivable).
- **Vos données restent sur votre machine** — bibliothèque, playlists, préférences et
  historique sont stockés localement (IndexedDB), jamais envoyés ailleurs.
- **Léger et rapide** — rendu virtuel des listes, recherche floue instantanée,
  budgets de performance suivis en CI.

## Fonctionnalités

- 🎵 **Bibliothèque locale** — scan de dossiers, extraction des tags et pochettes,
  surveillance en temps réel des changements de fichiers.
- 🔍 **Recherche & tri** — recherche instantanée (exacte et floue), tris par artiste,
  album, date, genre.
- 📃 **Playlists** — playlists manuelles et **smart playlists** à règles dynamiques.
- 🎨 **Mode Cinéma** — vue immersive plein écran avec visualisations audio
  (vagues, starfield, spectre) réactives à la musique, pilotées par analyse FFT.
- 📻 **Radio** — génération de radio à partir de votre bibliothèque.
- 🎚️ **Égaliseur** — EQ multi-bandes avec presets et gestion des périphériques audio.
- 📀 **Audio CD** — détection et extraction des CD audio insérés.
- 📊 **Statistiques** — historique de lecture et statistiques locales.
- 🌓 **Thèmes** — mode sombre/clair, accent dynamique suivant la pochette en lecture.
- 🌐 **i18n** — interface disponible en français et en anglais.
- ♿ **Accessibilité** — navigation clavier complète, aria-pressed/labels,
  contraste AA vérifié, mode mouvement réduit.
- 🔄 **Mises à jour signées** — vérification minisign, contrôlée par l'utilisateur.

## Captures d'écran

> _À venir — ajoutez vos captures dans `docs/` et référencez-les ici._

## Installation

Téléchargez la dernière version depuis la page
[Releases](https://github.com/libreflow/libreflow/releases) :

| OS      | Fichier                                       |
| ------- | --------------------------------------------- |
| Windows | `LibreFlow_<version>_x64-setup.exe` / `.msi`  |
| macOS   | `LibreFlow_<version>_aarch64.dmg`             |
| Linux   | `LibreFlow_<version>_amd64.AppImage` / `.deb` |

La vérification de mise à jour intégrée est signée (minisign) et peut être
désactivée dans **Paramètres → Système**.

## Développement

### Prérequis

- [Node.js](https://nodejs.org) ≥ 20 et npm
- [Rust](https://www.rust-lang.org/tools/install) (stable) + [Tauri 2](https://tauri.app/) :
  sous Linux, installez aussi `pkg-config` et les dépendances système
  GTK/webkit2gtk (cf. [prérequis Tauri](https://tauri.app/start/prerequisites/)).

### Démarrage

```bash
npm install       # dépendances JS
npm run dev       # lance l'app en mode développement (tauri dev)
```

### Scripts utiles

| Script                 | Rôle                                        |
| ---------------------- | ------------------------------------------- |
| `npm test`             | Suite de tests unitaires (1500+ assertions) |
| `npm run vite:build`   | Build de production du frontend (Vite)      |
| `npm run build`        | Build complet de l'application (Tauri)      |
| `npm run format`       | Formate tout le dépôt avec Prettier         |
| `npm run format:check` | Vérifie la conformité Prettier              |
| `npm run test:visual`  | Tests visuels (Playwright)                  |
| `npm run perf:check`   | Budgets de bundle + benchs + comparaison    |
| `npm run sbom`         | Génère les SBOM npm (CycloneDX) et Rust     |

### Architecture

```
frontend/            Application web (Lit + Vite, sans framework lourd)
  src/               90+ modules ES : UI, bibliothèque, cinema, EQ, i18n…
  tests/             Tests unitaires + benchs de performance
src-tauri/           Backend Rust (Tauri 2)
  src/               Commandes : CD audio, surveillance de dossiers, appareils…
scripts/             Outils perf (budgets de bundle, comparaison de benchs)
.github/workflows/   CI : syntaxe + tests + build + perf ; release par tag
```

Le frontend communique avec le backend Rust uniquement via les commandes
Tauri ; toute la donnée applicative vit dans IndexedDB, en local.

## Contribution

Les contributions sont bienvenues ! Par défaut :

1. Forkez et créez une branche depuis `master`.
2. Assurez-vous que `npm test`, `npm run format:check` et `npm run perf:check` passent.
3. Ouvrez une pull request vers `master`.

Pour les vulnérabilités, **n'ouvrez pas d'issue publique** : suivez la
[politique de sécurité](SECURITY.md).

## Sécurité & confidentialité

- [Politique de sécurité](SECURITY.md) — versions supportées, signalement privé.
- [Politique de confidentialité](PRIVACY.md) — traitement 100 % local des données.
- SBOM générés en CycloneDX pour les dépendances npm et Rust (`npm run sbom`).

## Licence

Ce projet est distribué sous la licence indiquée dans le fichier [LICENSE](LICENSE).
Les notices des dépendances tierces sont dans
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) et
[THIRD_PARTY_LICENSES_RUST.txt](THIRD_PARTY_LICENSES_RUST.txt).
