# LibreFlow — Design Spec : Complétion & Polish (Spotify/Deezer quality)

**Date :** 2026-05-04  
**Session :** 173+  
**Approche retenue :** Option B — Now Playing Hub  
**Objectif :** Combler les lacunes des features existantes pour atteindre le niveau Spotify/Deezer en mode 100% offline

---

## Contexte

LibreFlow est fonctionnellement complet (audio pipeline, queue, playlists, tags, search, stats). Les lacunes restantes ne sont pas des features manquantes, mais des **features existantes incomplètes** :

1. La barre de lecture est muette au clic — aucun panneau "Now Playing"
2. Les pages Album et Artiste n'ont pas de header — juste une liste filtrée nue
3. Les infos techniques du fichier (bitrate, codec, qualité) ne sont nulle part affichées

Ces 3 gaps sont adressés en 3 sprints indépendants, du plus impactant au moins.

---

## Sprint 1 — Panneau "Now Playing"

### Objectif
Ouvrir un panneau contextuel riche au clic sur la zone info de la barre de lecture.

### Déclencheur
- Click sur `#pl-info` (zone pochette + titre + artiste dans la barre)
- Bouton dédié `#btn-nowplaying` ajouté dans `.pl-r` (même style que `#btn-queue`)

### Layout du panneau (panneau droit, pattern queue/EQ)

```
┌─────────────────────────────┐
│                         [✕] │
│                             │
│      ┌───────────┐          │
│      │  Pochette │          │
│      │  300×300  │          │
│      └───────────┘          │
│                             │
│  Titre du morceau      [♥]  │
│  Artiste · Album            │
│  Année                      │
│                             │
│  ── Infos techniques ──     │
│  Format    FLAC             │
│  Bitrate   1 024 kbps       │
│  Qualité   24 bit / 96 kHz  │
│  Taille    42.3 Mo          │
│                             │
│  [→ Voir l'album]           │
│  [→ Voir l'artiste]         │
└─────────────────────────────┘
```

### Architecture frontend

**Nouveau fichier : `frontend/src/nowplaying.js`** (~120 LOC)

```
Exports :
  nowPlayingOpen           — booléen état du panneau
  toggleNowPlaying()       — ouvre/ferme
  openNowPlaying()         — ouvre + charge les infos
  closeNowPlaying()        — ferme
  updateNowPlaying(track)  — met à jour titre/art/like au changement de piste
                             (si panneau ouvert)
```

Logique interne :
- `_loadTechInfo(path)` — appel IPC `get_track_info` uniquement si le panneau est ouvert (lazy)
- `_renderNowPlaying(track, info)` — génère le HTML du panneau
- `_techInfoCache` — Map `path → info` pour éviter les doubles appels IPC

**Modifications :**

| Fichier | Modification |
|---------|-------------|
| `frontend/index.html` | `#now-playing-panel` + `#btn-nowplaying` dans `.pl-r` |
| `frontend/src/handlers.js` | action `toggle-now-playing`, lien `→ album` / `→ artiste` |
| `frontend/src/app.js` | import nowplaying + `window.toggleNowPlaying` + `window.closeNowPlaying` |
| `frontend/src/nowplaying.js` | `on(EVENTS.TRACK_CHANGE, ...)` interne — met à jour le panneau si ouvert (pas de modif player.js) |
| `frontend/src/style.css` | styles `#now-playing-panel`, `.np-art`, `.np-tech`, `.np-links` |

### Architecture backend (Rust)

**Nouvelle commande : `get_track_info(path: String) → TrackInfo`**

```rust
#[derive(Serialize)]
pub struct TrackInfo {
    pub codec:       String,       // "FLAC", "MP3", "AAC", "OGG", "WAV", "OPUS", …
    pub bitrate:     Option<u32>,  // kbps — None pour les formats lossless à bitrate variable
    pub sample_rate: Option<u32>,  // Hz (ex: 44100, 48000, 96000)
    pub bit_depth:   Option<u8>,   // bits (ex: 16, 24, 32) — None pour MP3
    pub channels:    Option<u8>,   // 1=mono, 2=stéréo
    pub file_size:   u64,          // bytes
}
```

Implémentation : `lofty::Probe::open(path)?.read()` → `tagged_file.properties()` fournit `audio_bitrate()`, `sample_rate()`, `bit_depth()`, `channels()`. Le codec est inféré depuis `tagged_file.file_type()` (FileType::Flac, FileType::Mpeg, etc.).

Enregistrement dans `main.rs` : ajouter `commands::get_track_info` au `.invoke_handler(...)`.

### Invariants respectés
- Aucune modification du Web Audio graph
- Aucun `rebuildTrackIdxMap()` nécessaire (pas de mutation `tracks[]`)
- IPC lazy — un seul appel par piste unique (cache `path → info`)
- `audio.volume` jamais touché

---

## Sprint 2 — Pages Album enrichies

### Objectif
Ajouter un header visuel riche au-dessus de la liste de titres lors d'un drill-down album.

### État actuel
`drillDown('albums', key, display)` → filtre `tracks[]` → `renderLib()` → liste brute sans contexte visuel.

### Header à ajouter

```
┌────────────────────────────────────────────┐
│  ┌────────┐  Nom de l'album   [▶ Lire tout]│
│  │Pochette│  Artiste (lien)   [⤮ Mélanger] │
│  │ 160px  │  2019 · 12 titres · 48 min     │
│  └────────┘                                │
└────────────────────────────────────────────┘
[Track list]
```

### Comportement liste
- Triée par `t.track` (numéro de piste) en vue `album-detail` — ascendant, nulls en fin
- Numéro de piste affiché dans la colonne gauche (champ `t.track` déjà stocké en IDB)
- Groupes alphabétiques supprimés en vue `album-detail` (pas de `grp-lbl`)

### Architecture frontend

**Nouveau fichier : AUCUN** — tout dans `renderer.js`.

Nouvelle fonction `renderDrillHeader(view, key)` dans `renderer.js` :
- Appelée depuis `renderLib()` si `view === 'album-detail'` ou `'artist-detail'` ou `'genre-detail'`
- Injecte un `#drill-header` au-dessus de `#tlist` (créé dynamiquement, réutilisé)
- Pour album-detail : cherche l'entrée dans `_getAlbumMap()` → art, displayName, artist, year, count, totalDuration
- "Lire tout" → `playAt(0)` (index 0 de `getFiltered()`) ; "Mélanger" → `set('shuffle', true)` + `playAt(0)`
- "Artiste (lien)" → `drillDown('artists', artistKey, artistDisplay)`

| Fichier | Modification |
|---------|-------------|
| `frontend/src/renderer.js` | +`renderDrillHeader()`, modif `renderLib()` pour l'appeler |
| `frontend/src/style.css` | styles `.drill-header`, `.dh-art`, `.dh-meta`, `.dh-actions` |
| `frontend/src/search.js` | tri par `t.track` si `view === 'album-detail'` dans `getFiltered()` |

### Invariants respectés
- `renderDrillHeader` est read-only — aucune mutation de `tracks[]`
- Virtual scroll inchangé — le header est hors du `#tlist` (pas dans la fenêtre virtuelle)

---

## Sprint 3 — Pages Artiste enrichies

### Objectif
Ajouter un header artiste + une section albums groupés au-dessus de la liste complète.

### Layout

```
┌────────────────────────────────────────────┐
│  ┌────────┐  Nom Artiste      [▶ Lire tout]│
│  │ Photo  │  5 albums         [⤮ Mélanger] │
│  │ cercle │  47 titres                     │
│  └────────┘                                │
└────────────────────────────────────────────┘

── Albums ────────────────────────────────────
[mini-grille : cards albums de cet artiste, triés par année desc]

── Tous les titres ───────────────────────────
[liste complète, virtual scroll]
```

### Architecture frontend

Extension de `renderDrillHeader(view, key)` pour le cas `artist-detail` :
- Header : photo (première pochette trouvée pour l'artiste), nom, compteurs albums/titres
- Section Albums : mini-grille filtrée depuis `_getAlbumMap()` où `a.artist.toLowerCase() === key`
  - Triée par année décroissante
  - Click card → `drillDown('albums', albumKey, albumDisplay)`
  - Maximum 20 albums affichés (overflow rare)
- Section Tous les titres : `renderLib()` est appelé normalement pour la liste virtuelle

| Fichier | Modification |
|---------|-------------|
| `frontend/src/renderer.js` | extension `renderDrillHeader()` pour `artist-detail` + mini-grille |
| `frontend/src/style.css` | `.dh-albums-mini`, `.dh-albums-mini .card` (version compacte) |

### Invariants respectés
- Mini-grille albums : rendu statique (pas de virtual scroll — max 20 items)
- Pas de nouvel état global — tout dérivé de `_getAlbumMap()` et `_getArtistMap()` existants

---

## Ordre d'exécution

```
Sprint 1 (Now Playing + get_track_info)
  → Sprint 2 (Album header + tri par track)
    → Sprint 3 (Artiste header + mini-grille albums)
```

Chaque sprint est indépendant et peut être livré séparément.

---

## Risques

| Risque | Mitigation |
|--------|-----------|
| `get_track_info` lent sur FLAC/WAV volumineux | lofty lit uniquement les métadonnées (header), pas le contenu audio — rapide |
| `#drill-header` désynchronisé après mutation `tracks[]` | `renderLib()` le recrée toujours — pas de state séparé |
| Conflit panneau Now Playing + queue/EQ ouverts simultanément | fermer les autres panneaux à l'ouverture de Now Playing (même pattern que `toggleQueue`) |
| Numéro de piste absent (`t.track = null`) | afficher `–` au lieu du numéro, tri par titre en fallback |
