# Design : Roadmap features manquantes — Approche A

**Date :** 2026-05-16  
**Profil utilisateur cible :** Utilisateur quotidien offline-first  
**Approche retenue :** Finir avant d'ajouter (quick wins → features moyennes → sauvegarde → USB)

---

## Contexte

Audit complet du codebase LibreFlow (mai 2026) révèle que le cœur lecteur est solide. Plusieurs features listées dans la vision produit sont absentes ou partielles. Les thèmes, la vue grille albums et le système de design UI sont **déjà implémentés** (faux positifs de l'audit initial). Les vrais gaps sont :

- 2 features petites (filtre format, historique imports)
- 2 features moyennes (profils EQ par appareil, arborescence fichiers)
- 1 module critique absent (sauvegarde & portabilité)
- 1 module enhancement (import USB)

---

## Roadmap

```
Phase 1   (~1 sem)    Filtre format audio + Historique imports
Phase 1b  (~2-3 sem)  Profils EQ par appareil + Arborescence fichiers
Phase 2   (~2-3 sem)  Sauvegarde & Portabilité (.libreflow)
Phase 3   (~1 sem)    Import USB / disque externe
Total estimé : 6-8 semaines
```

---

## Phase 1 — Quick wins (~1 semaine)

### 1.1 Filtre par format audio

**Fichiers concernés :** `library.js`, `renderer.js`, `cfg.js`, `types.js`

**Description :**  
Chips de filtre dans la toolbar de la bibliothèque permettant de filtrer les pistes par format audio : `Tous` / `FLAC` / `MP3` / `AAC` / `OGG` / `WAV` / `AIFF`.

**Comportement :**
- La valeur `format` est déjà extraite par lofty et stockée dans l'objet `Track`
- Filtre read-only : `tracks.filter(t => !activeFormat || t.format === activeFormat)`
- S'intègre dans le pipeline de filtre existant (genre + année + format)
- Le filtre actif est persisté dans `cfg`
- Les chips n'affichent que les formats présents dans la bibliothèque (pas de chip AIFF si aucune piste AIFF)

**Risque :** faible — aucune mutation de données.

---

### 1.2 Historique des imports

**Fichiers concernés :** `db.js`, `dropin.js`, `watchfolder.js`, `renderer.js`, nouveau store IDB

**Description :**  
Nouveau store IndexedDB `imports` qui enregistre chaque opération d'import avec sa date, source et liste de pistes.

**Schéma du store :**
```js
{
  id: string,          // uuid
  date: number,        // timestamp
  source: 'drag-drop' | 'folder-scan' | 'manual',
  paths: string[],     // chemins des fichiers importés
  count: number        // nombre de pistes ajoutées
}
```

**Comportement :**
- `dropin.js` et `watchfolder.js` écrivent une entrée après chaque import réussi
- Nouvelle section "Historique des imports" (dans les réglages ou vue dédiée) : liste par date, cliquable pour voir les pistes du batch
- Aucune modification du flow d'import existant — hooks post-import seulement

**Risque :** faible — store isolé, aucun impact sur les stores existants.

---

## Phase 1b — Features moyennes (~2-3 semaines)

### 1b.1 Profils EQ par appareil audio

**Fichiers concernés :** `eq.js`, `settings.js`, `cfg.js`

**Description :**  
Chaque profil EQ peut être associé à un appareil audio. LibreFlow charge automatiquement le bon profil quand l'appareil audio actif change.

**Comportement :**
- Détection via `navigator.mediaDevices.enumerateDevices()` + événement `devicechange`
- Structure dans `cfg` :
  ```js
  eqDeviceProfiles: {
    "Casque Sony WH-1000XM5": { bands: [...10 valeurs...], name: "Sony" },
    "Réaltek Audio": { bands: [...], name: "Bureau" }
  }
  ```
- Quand l'appareil change → chargement automatique du profil correspondant (fallback : profil global si aucun profil lié)
- UI dans les réglages EQ : section "Par appareil" avec label de l'appareil actif + bouton "Sauvegarder pour cet appareil"

**Fallback :** Si `navigator.mediaDevices` est instable ou non disponible, on reste sur le profil global sans erreur.

**Risque :** moyen — API `mediaDevices` peut être capricieuse sur certains drivers Windows. Fallback obligatoire.

---

### 1b.2 Arborescence fichiers (Artiste / Album (Année) / Piste)

**Fichiers concernés :** `commands.rs` (nouvelle commande), nouveau module `organize.js`, `modal.js`

**Description :**  
Organisation opt-in des fichiers audio sur disque selon la structure `{racine}/{Artiste}/{Album (Année)}/{N° - Titre.ext}`. Toujours précédée d'un dry-run.

**Comportement :**
1. L'utilisateur déclenche "Organiser les fichiers" depuis les réglages
2. **Dry-run obligatoire** : modale affichant la liste complète des renommages prévus avant toute action
3. L'utilisateur confirme → Rust exécute les déplacements
4. Frontend met à jour les `path` dans IDB après confirmation Rust

**Commande Rust `organize_files` :**
- Calcule les nouveaux chemins depuis les métadonnées lofty
- Déplace les fichiers de façon atomique (`rename`, pas `copy + delete`)
- Retourne les nouveaux chemins au frontend
- Annule tout (rollback) si une erreur survient

**Règles de fallback :**
- Artiste manquant → dossier `Inconnu/`
- Album manquant → dossier `Sans album/`
- Titre manquant → conserve le nom de fichier original
- Caractères spéciaux → sanitisation côté Rust (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`)
- Volume réseau / lecture seule → erreur explicite AVANT le dry-run

**Risque :** moyen-élevé — opération destructrice sur le filesystem. Le dry-run et le rollback Rust sont non-négociables.

---

## Phase 2 — Sauvegarde & Portabilité (~2-3 semaines)

### Format `.libreflow`

Archive ZIP renommée `.libreflow` :

```
backup.libreflow
├── manifest.json     ← version format, date, app version, stats
├── library.json      ← tous les tracks (métadonnées uniquement)
├── playlists.json    ← playlists + smart playlists
├── playlog.json      ← historique d'écoute
├── imports.json      ← historique des imports
├── config.json       ← cfg (thème, EQ, préférences)
└── files/            ← audio files (optionnel, choix explicite utilisateur)
    └── {Artiste}/{Album}/piste.flac
```

**manifest.json :**
```json
{
  "version": 1,
  "app_version": "1.1.0",
  "date": "2026-05-16T...",
  "track_count": 4200,
  "includes_files": false
}
```

---

### 2.1 Export bibliothèque

**Fichiers concernés :** nouveau module `backup.js`, nouvelle commande Rust `export_backup`

**Comportement :**
- UI dans les réglages : bouton "Exporter la bibliothèque" + case à cocher "Inclure les fichiers audio" (décochée par défaut)
- Frontend sérialise tous les stores IDB en JSON (via `dall()` existant)
- Rust reçoit le JSON + chemins des fichiers audio → construit le ZIP → écrit le `.libreflow` à l'emplacement choisi (dialog `save file`)
- Barre de progression pour les grandes bibliothèques (streaming chunk par chunk)
- Mode "métadonnées uniquement" par défaut — les fichiers audio sont en option explicite

---

### 2.2 Import / restauration

**Fichiers concernés :** `backup.js`, nouvelle commande Rust `import_backup`

**Comportement :**
- Bouton "Restaurer une sauvegarde" → file picker `.libreflow`
- Rust décompresse → vérifie `manifest.json` (version compatible ?)
- Frontend lit les JSON et réimporte dans IDB store par store (batch 500 tracks max pour ne pas saturer la mémoire)
- Si fichiers audio inclus → Rust les dépose dans le dossier musique configuré
- Stratégie de conflit : **merge** par défaut (tracks existantes conservées, nouvelles ajoutées) avec option "Remplacer tout" explicite
- Rollback IDB si erreur mi-import (transaction atomique par store)

---

### 2.3 Migration PC via clé USB

Pas de feature dédiée. Le format `.libreflow` est autoportant :
1. PC source : exporter `.libreflow` (avec fichiers si souhaité) → copier sur USB
2. PC cible : installer LibreFlow → "Restaurer une sauvegarde" → pointer le USB

La clé USB est un vecteur de transport, aucun code spécifique nécessaire.

---

## Phase 3 — Import USB / Disque externe (~1 semaine)

### 3.1 Détection USB

**Fichiers concernés :** nouveau module `devices.js`, `commands.rs` (nouvelle commande `list_drives`), `watch.rs`

**Comportement :**
- Commande Rust `list_drives` → liste des volumes montés (lettre, label, type : fixe/amovible/réseau)
- Polling léger via `watch.rs` (déjà en place) : détecte l'apparition d'un nouveau volume → émet `drive-connected`
- Toast : "Disque USB détecté — Voulez-vous importer de la musique ?"
- Pas de scan automatique — toujours à l'initiative de l'utilisateur

---

### 3.2 Import sélectif

**Fichiers concernés :** `devices.js`, `modal.js`

**Comportement :**
- Modale avec arborescence de dossiers du volume (lazy-loading, pas de listing complet d'emblée)
- L'utilisateur sélectionne un ou plusieurs dossiers → confirme
- Le pipeline existant prend le relais : `scan_folder` → `read_tags` → hydratation IDB → `renderLib()`
- L'import écrit une entrée dans le store `imports` (Phase 1.2), source : `'usb'`

**Différence avec drag-drop :** navigation dans le périphérique depuis l'UI LibreFlow, sans passer par l'explorateur de fichiers externe.

**Risque :** faible — scan et import déjà robustes.

---

## Invariants système à respecter (CLAUDE.md)

- Toute mutation de `tracks[]` → `rebuildTrackIdxMap()` obligatoire
- IDB writes toujours debounced
- Aucun fetch externe (offline strict)
- Arborescence fichiers : jamais de `tracks.splice()` sans rebuild
- Backup : batch IDB writes (500 max par transaction)
- Organize : uniquement `rename` atomique, jamais `copy + delete`

---

## Features hors scope (pour cette roadmap)

- AcoustID / MusicBrainz (incompatible offline-strict)
- Module CD Audio complet (ffmpeg bundlé, Win32 DeviceArrival) — niche, faible priorité offline-first
- Import analogique (vinyle/cassette)
- Migration vers SQLite (IndexedDB suffisant, refactor non justifié)
