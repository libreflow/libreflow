# Design : Import CD Audio (Windows)

**Date :** 2026-05-17
**Plateforme cible :** Windows uniquement (stub propre sur macOS/Linux)
**Statut roadmap :** Auparavant marqué hors-scope dans `2026-05-16-roadmap-features-manquantes-design.md:248`. Réintégré sur demande utilisateur explicite avec scope réduit.

---

## Contexte

Quand un CD Audio est inséré dans un lecteur optique Windows, LibreFlow doit le détecter et proposer à l'utilisateur de **lire** les pistes ou de les **extraire** vers la bibliothèque. La spec roadmap d'origine excluait cette feature pour cause de poids (`ffmpeg` bundlé) et complexité (`Win32 DeviceArrival`). Le présent design contourne ces objections en utilisant :

- `IOCTL_CDROM_READ_TOC` + `ReadFile` direct sur `\\\\.\\D:` via le crate `windows` déjà présent (zéro nouvelle dépendance système)
- Polling existant de `devices.js` (zéro nouveau timer, zéro `DeviceArrival`)
- `flacenc` crate Rust pure (~150KB, MIT) pour l'encodage (zéro `ffmpeg`)
- Aucune dépendance réseau (`Track 01`/`Track 02`... — respect de l'invariant offline-strict)

---

## Décisions de design validées

| Question | Décision |
|---|---|
| Comportement à l'insertion | **Demander** via modal (cohérent avec USB) |
| Source métadonnées | **Aucune** — `Track 01`, `Track 02`... (offline-strict respecté) |
| Format extraction | **FLAC** (lossless ~30MB/track, encoder pure-Rust) |
| Plateforme | **Windows uniquement** — macOS/Linux : stub retournant erreur claire |
| Approche technique | **IOCTL natifs Windows** (DeviceIoControl + ReadFile sur raw device) |

---

## Architecture globale

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (JS)                                              │
│                                                              │
│  devices.js (étendu)        cdaudio.js (NOUVEAU)            │
│  ├─ poll list_drives        ├─ openCdModal()                │
│  ├─ detect kind="cdrom"  ───┤  └─ "Lire" / "Extraire"       │
│  │   + audio_cd=true        ├─ playCdTrack(drive, idx)      │
│  └─ toast "CD détecté"      │   └─ rip→temp→audio.src       │
│                             ├─ extractCd(drive, dir)        │
│                             │   └─ rip→watchPath→importPaths│
│                             ├─ cancelCurrentRip()           │
│                             └─ cleanupCdCache(drive)        │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────────┐
│  Backend (Rust) — src-tauri/src/cdaudio.rs (NOUVEAU)        │
│                                                              │
│  cd_read_toc(drive)   → CdToc { tracks: [{idx, lba, len}] } │
│  cd_rip_track(drive,  → écrit FLAC à dest_path              │
│      track_idx,         (event:cd-rip-progress)             │
│      dest_path,                                              │
│      rip_id)                                                 │
│  cd_cancel_rip(rip_id) → AtomicBool flip                    │
│                                                              │
│  list_drives (étendu) → ajoute audio_cd:bool + track_count  │
└─────────────────────────────────────────────────────────────┘
```

**Principe clé** : *PLAY = rip-then-play sur fichier temporaire FLAC*. Le pipeline audio existant (`<audio>` + Web Audio EQ) reste **complètement inchangé** — il joue un fichier comme n'importe quel autre. Le prefetch du track suivant se fait en background pendant la lecture du courant. Le cache temp est nettoyé à l'éjection.

**EXTRACT** : rip tous les tracks vers un sous-dossier du watch folder configuré, puis réutilise `importPaths()` existant → le scan/tag/IDB flow standard prend le relais.

---

## Backend Rust

### Nouveau module : `src-tauri/src/cdaudio.rs`

~300 lignes estimées. `commands.rs` touché uniquement pour étendre `list_drives` et enregistrer 3 nouveaux `#[tauri::command]`.

### Types

```rust
#[derive(Serialize, Clone)]
pub struct CdTrack {
    pub idx: u8,           // 1..=99
    pub lba_start: u32,    // logical block address
    pub frames: u32,       // durée en frames CD (75 frames/s)
    pub duration_sec: f32, // frames / 75.0
}

#[derive(Serialize, Clone)]
pub struct CdToc {
    pub drive: String,           // "D:\\"
    pub tracks: Vec<CdTrack>,    // pistes AUDIO uniquement (data tracks filtrées)
    pub total_duration_sec: f32,
}
```

### Détection audio CD — extension de `DriveInfo`

```rust
pub struct DriveInfo {
    pub path:        String,
    pub label:       String,
    pub kind:        String,    // "removable" | "fixed" | "cdrom" | ...
    pub audio_cd:    bool,      // NOUVEAU — true si ≥1 piste audio
    pub track_count: u8,        // NOUVEAU — 0 si pas audio CD
}
```

Quand `GetDriveTypeW == 5` (CDROM), on tente `IOCTL_CDROM_READ_TOC`. Si la lecture réussit et qu'au moins une track a `control & 0x04 == 0` (audio, pas data), on marque `audio_cd=true`. Drive vide ou data CD → `audio_cd=false`. Coût : ~1ms par poll si CDROM présent.

### Commandes Tauri

```rust
#[tauri::command]
pub fn cd_read_toc(drive: String) -> Result<CdToc, String>;

#[tauri::command]
pub async fn cd_rip_track(
    app: AppHandle,
    drive: String,
    track_idx: u8,
    dest_path: String,   // chemin FLAC sortie
    rip_id: String,      // identifie l'event:cd-rip-progress et permet cancel
) -> Result<(), String>;

#[tauri::command]
pub fn cd_cancel_rip(rip_id: String) -> Result<(), String>;
```

### Pipeline de rip

1. **Open raw device** : `CreateFileW("\\\\.\\D:")` avec `GENERIC_READ | FILE_SHARE_READ`. Pas d'élévation requise pour lecture séquentielle.
2. **Read sectors** : boucle `DeviceIoControl(IOCTL_CDROM_RAW_READ)` par chunks de ~50 sectors (1 sector = 2352 bytes = audio PCM 44.1kHz/16/stéréo). Émet `event:cd-rip-progress` toutes les ~500ms : `{ rip_id, percent, sector_current, sector_total }`.
3. **Encode FLAC** : crate `flacenc` (pure Rust, MIT). Wrap les samples PCM stéréo → écrit `.flac` à `dest_path`.
4. **Cancel** : `Mutex<HashMap<String, Arc<AtomicBool>>>` indexé par `rip_id`. `cd_cancel_rip` flip l'atomic, vérifié à chaque chunk → return early + cleanup partial file.

### Plateforme

Module entier guardé `#[cfg(target_os = "windows")]`. Sur macOS/Linux, les commandes retournent `Err("CD audio non supporté sur cette plateforme")`. `audio_cd` reste toujours `false`, `track_count = 0`. Aucune panique, aucun crash.

### Crates ajoutées

| Crate | Taille | Usage |
|---|---|---|
| `flacenc` | ~150KB | Encoder FLAC pure-Rust |

`windows` crate déjà présent → activer features `Win32_Storage_IscsiDisc` (IOCTL CDROM) + `Win32_System_IO` si pas déjà actif.

---

## Frontend JS

### Nouveau module : `frontend/src/cdaudio.js` (~250 lignes)

```js
// Exports
//   openCdModal(drivePath)        — affiche modal (Lire / Extraire / Ignorer)
//   closeCdModal()
//   playCdTrack(drivePath, idx)   — rip→temp→audio.src→play
//   extractCd(drivePath, destDir) — rip tous tracks → importPaths()
//   cancelCurrentRip()            — IPC cd_cancel_rip + nettoyage
//   cleanupCdCache(drivePath)     — purge temp dir à l'éjection
```

### Extension `devices.js`

```js
function _detectNewAudioCd(previous, current) {
  const prevAudioCds = new Set(
    previous.filter(d => d.audio_cd).map(d => d.path)
  );
  return current.filter(d => d.audio_cd && !prevAudioCds.has(d.path));
}

async function _poll() {
  // ... logique USB existante préservée ...
  const newCds = _detectNewAudioCd(_lastDrives, drives);
  for (const cd of newCds) _onAudioCdInserted(cd);
  _lastDrives = drives;
}

function _onAudioCdInserted(drive) {
  toast(`CD Audio détecté (${drive.track_count} pistes) — Lire ou extraire ?`, 'info');
  openCdModal(drive.path);
}
```

L'éjection est détectée naturellement (le drive disparaît de `list_drives`) → on appelle `cleanupCdCache(drive.path)` qui purge fichiers temp + tracks éphémères.

### Tracks éphémères CD

```js
const ephemeralCdTrack = {
  id: `cd:${drive.path}:${track_idx}`,    // ID stable par CD+track
  path: tempPath,                          // chemin FLAC temp
  title: `Track ${String(track_idx).padStart(2, '0')}`,
  artist: 'CD Audio',
  album: drive.label || 'CD inconnu',
  dur: toc.tracks[i - 1].duration_sec,
  _isEphemeralCd: true,                    // flag de filtrage
  _cdDrive: drive.path,                    // pour nettoyage groupé à l'éjection
};
```

**Règles** :
- `db.dput('tracks', t)` skip si `t._isEphemeralCd === true` (modification minime de `db.js`)
- Projection lib principale exclut `t._isEphemeralCd` (filtre dans `invalidateFilterCache` pipeline)
- À l'éjection : `tracks = tracks.filter(t => t._cdDrive !== drive.path)` → `rebuildTrackIdxMap()` → `invalidateFilterCache()` → `VIRT._lastListSig = ''`

### UI — modal CD (`index.html`)

Réutilise classes CSS modal existantes (`modal-bg`, `modal-card`, `modal-actions`, CSS tokens pour scrim/shadow/border conformes au fix `a265725`).

```html
<div id="cd-modal-bg" class="modal-bg">
  <div class="modal-card">
    <h2>CD Audio détecté</h2>
    <p>Volume : <strong id="cd-label"></strong></p>
    <p><span id="cd-track-count"></span> pistes — <span id="cd-duration"></span></p>

    <div id="cd-progress" hidden>
      <div class="cd-progress-bar"><div id="cd-progress-fill"></div></div>
      <p id="cd-progress-text">Extraction : 0 / 0</p>
      <button id="cd-cancel-btn">Annuler</button>
    </div>

    <div class="modal-actions" id="cd-actions">
      <button data-action="cd-play">Lire</button>
      <button data-action="cd-extract">Extraire vers bibliothèque</button>
      <button data-action="cd-cancel-modal">Ignorer</button>
    </div>
  </div>
</div>
```

### Wiring (`app.js`)

```js
import { openCdModal, closeCdModal, playCdTrack, extractCd, cancelCurrentRip }
  from './cdaudio.js';

Object.assign(window, {
  openCdModal, closeCdModal, playCdTrack, extractCd, cancelCurrentRip
});

// initDevices() existant déjà appelé au boot — il découvre les CD via list_drives étendu
```

---

## Data flow

### PLAY

```
1. User insère CD
2. devices.js polling (6s) appelle list_drives → audio_cd=true détecté
3. Toast + openCdModal(drive)
4. User clique "Lire"
5. cd_read_toc(drive) → CdToc { tracks[] }
6. Pour track 1 (ou track demandé) :
   - rip_id = crypto.randomUUID()
   - tempPath = `${appDataDir}/cd-cache/${rip_id}.flac`
   - await cd_rip_track(drive, 1, tempPath, rip_id)
     ↳ progress via event:cd-rip-progress → banner UI
7. Une fois écrit :
   - Construit track éphémère
   - tracks.push(eph) + rebuildTrackIdxMap() + invalidateFilterCache()
   - playAt(idx) standard → moteur audio joue le FLAC temp comme un fichier normal
8. À T-5s avant fin du track courant : prefetch track suivant en background
9. À l'éjection ou close app : cleanupCdCache()
```

### EXTRACT

```
1. User clique "Extraire"
2. cd_read_toc(drive) → CdToc
3. destDir = `${watchPath}/CD_${sanitize(label)}_${YYYY-MM-DD}/`
   (sanitize via la fonction existante de organize.js)
4. mkdir destDir
5. FOR i = 1..N :
   - destPath = `${destDir}/Track ${i.padStart(2,'0')}.flac`
   - await cd_rip_track(drive, i, destPath, rip_id)
   - banner progress "Extraction CD : i/N"
6. await importPaths([destPath_1, ..., destPath_N])
     ↳ scan_folder ↳ read_tags ↳ tracks[] update ↳ dput('tracks')
     ↳ rebuildTrackIdxMap() ↳ invalidateFilterCache()
7. Toast "N pistes extraites et ajoutées à la bibliothèque"
8. closeCdModal()
```

---

## Invariants respectés (CLAUDE.md)

| Invariant | Conformité |
|---|---|
| Mutation `tracks[]` → `rebuildTrackIdxMap()` | Après `push` éphémère (PLAY), après `importPaths` (EXTRACT), après filter (éjection) |
| `audio.volume` = slider DOM | Pipeline audio inchangé |
| Virtual scroll `CFG.VIRT_ROW_H` | Inchangé. Éphémères filtrés de la projection lib principale |
| `radioRefillQueue()` avant UI update | `playAt()` standard l'appelle déjà |
| Aucun accès FS direct JS | Tout via IPC (`cd_read_toc`, `cd_rip_track`, `cleanupCdCache`) |
| **Aucun réseau externe** | Track 01/02 généré localement, zéro lookup |
| IDB writes debounced | Éphémères PAS écrits en IDB. EXTRACT passe par `importPaths` (debounce existant) |
| Artwork loading async | N/A (CD = pas d'artwork) |
| Une seule source vérité cfg | Aucun nouveau cfg requis pour MVP |
| Aucun état dupliqué | `_lastDrives` étendu, pas de second cache |

---

## Cache temporaire FLAC

- **Path** : `${appDataDir}/cd-cache/${rip_id}.flac` (résolu via `path::app_data_dir` Tauri)
- **Lifecycle** :
  - Créé par `cd_rip_track`
  - Joué via `<audio src>` URL convertie par `convertFileSrc` Tauri
  - Supprimé quand : track suivant remplace, ou éjection CD, ou app close, ou explicite `cleanupCdCache()`
- **Quota** : max 3 fichiers temp simultanés (current + 2 prefetch). ~30MB/FLAC = ~90MB peak
- **GC au boot** : `cleanupCdCache()` purge tout le contenu de `cd-cache/` (orphelins d'un crash précédent)

---

## Concurrence rip

- **Un seul rip actif à la fois** (Mutex Rust côté backend, `_currentRipId` guard côté JS)
- Si user clique "Extraire" pendant un PLAY en cours : cancel le prefetch, démarre l'extraction. Le track en lecture continue (déjà en cache temp)
- Prefetch background toujours annulable par action user explicite

---

## Error handling

| Erreur | Détection | Réaction |
|---|---|---|
| Drive vide (CDROM sans média) | `IOCTL_CDROM_READ_TOC` → `ERROR_NOT_READY` ou `ERROR_NO_MEDIA_IN_DRIVE` | Silencieux. `audio_cd=false`, pas de toast |
| Data CD inséré | TOC lu mais 0 track audio | Silencieux. `audio_cd=false` |
| CD mixte audio+data | TOC contient ≥1 track audio | `audio_cd=true`, `track_count` = AUDIO uniquement. Data tracks ignorées |
| CD rayé / read error mi-rip | `IOCTL_CDROM_RAW_READ` error | Retry 3x sur le sector. Si KO : skip 1 sector (silence). Track marquée `partial`. Toast final "Track N : extraction partielle" |
| CD éjecté pendant rip | `ReadFile` → `ERROR_NOT_READY` | Cancel auto + cleanup temp. Toast "CD éjecté pendant l'extraction". `tracks[]` purgé des éphémères |
| Disque plein pendant EXTRACT | `flacenc` write fail | Stop. Cleanup partial. Toast "Espace disque insuffisant". Tracks déjà rippés conservés |
| Permission denied `\\\\.\\D:` | `CreateFileW` → `ERROR_ACCESS_DENIED` | Toast "Accès au lecteur refusé — fermer les autres applications utilisant le CD" |
| User cancel pendant rip | `cd_cancel_rip` → AtomicBool flip | Cleanup partial. Pas de toast (action explicite) |
| App ferme pendant rip | `WindowEvent::CloseRequested` | `cancelCurrentRip()` + flush. Cache temp purgé au prochain boot via GC |
| `flacenc` panic | `catch_unwind` autour de l'encode | Toast "Erreur d'encodage FLAC". Log. Pas de crash app |
| Call IPC CD sur macOS/Linux | Commandes retournent `Err("CD audio non supporté")` | Côté JS : `audio_cd` toujours `false`, modal jamais affiché |

### Logging

```rust
eprintln!("[cdaudio] read_toc failed: drive={} err={:?}", drive, e);
eprintln!("[cdaudio] sector read retry {}/3: lba={}", retry, lba);
```

```js
console.warn('[cdaudio] ...', err);
```

Pas de toast utilisateur sauf erreurs visibles (cancel, fini, fail global).

---

## Testing

### Tests automatisés (`tests/core.test.cjs`, pattern zero-dep)

| Test | Coverage |
|---|---|
| `toc_to_durations()` | conversion frames → secondes (75 frames/s) |
| `_detectNewAudioCd(prev, curr)` | nouveau CD, ignore CD connu, ignore data CDs |
| `_ephemeralTrackFor(drive, idx, toc)` | défauts corrects (Track 0X, CD Audio, label, dur, flags) |
| `cleanupEphemeralForDrive(tracks, drivePath)` | filtre éphémères du bon drive uniquement |
| `dput_skips_ephemeral_cd_tracks` | mock dput vérifie skip si `_isEphemeralCd` |
| `extractDestPath(label, idx, dir)` | `<dir>/CD_<label>_<date>/Track 01.flac` avec sanitization |
| `_calculateRipProgress(sector, total)` | percent rounding correct |

Couverture estimée : 8-10 tests, ~15 assertions. Tous purs, testables sans hardware ni IDB.

### Tests Rust

`cdaudio.rs` exporte les fonctions de parsing TOC en `pub(crate)` pour test unitaire avec un buffer TOC binaire fixe extrait d'un dump réel :

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn parses_simple_audio_toc() {
        let raw = include_bytes!("../tests/fixtures/toc_audio_12tracks.bin");
        let toc = parse_toc(raw).unwrap();
        assert_eq!(toc.tracks.len(), 12);
        assert_eq!(toc.tracks[0].lba_start, 0);
    }
}
```

### Tests manuels (impossible automatiser sans CD physique)

- Smoke test avec 3 CDs : audio pur, mixed audio+data, data only
- Test éjection pendant rip
- Test cancel pendant rip
- Test rip d'un CD rayé
- Test prefetch (track 2 démarre sans gap)
- Test extract complet → vérifier import dans la lib + tags vierges

---

## Métriques attendues

| Op | Cible |
|---|---|
| `cd_read_toc` | < 500ms |
| `cd_rip_track` (1 track 3min) | 30-60s (1x-2x speed selon drive) |
| Encode FLAC overhead | < 10% du temps de rip (IO-bound) |
| Boot impact | 0 (pas de scan CD au boot) |
| Polling overhead | +1 IOCTL par poll si CDROM présent (~1ms) |
| Bundle size | +150KB (flacenc) |

---

## Fichiers touchés

| Fichier | Type | Changement |
|---|---|---|
| `src-tauri/src/cdaudio.rs` | NOUVEAU | Module Rust complet (~300 lignes) |
| `src-tauri/src/commands.rs` | MODIFIÉ | Étend `DriveInfo` + `list_drives` (Windows) ; enregistre 3 commandes |
| `src-tauri/src/main.rs` | MODIFIÉ | `mod cdaudio` + `.invoke_handler(..cdaudio::commands..)` |
| `src-tauri/Cargo.toml` | MODIFIÉ | Ajoute `flacenc` ; éventuellement features `windows` |
| `frontend/src/cdaudio.js` | NOUVEAU | Module JS complet (~250 lignes) |
| `frontend/src/devices.js` | MODIFIÉ | Ajoute `_detectNewAudioCd` + `_onAudioCdInserted` |
| `frontend/src/db.js` | MODIFIÉ | `dput('tracks', t)` skip si `t._isEphemeralCd` (~3 lignes) |
| `frontend/src/app.js` | MODIFIÉ | Import + `Object.assign(window, {...})` |
| `frontend/index.html` | MODIFIÉ | Ajoute markup `#cd-modal-bg` |
| `frontend/src/style.css` | MODIFIÉ | Classes `.cd-progress-bar`, `.cd-progress-fill` (réutilise tokens) |
| `tests/core.test.cjs` | MODIFIÉ | Ajoute section CD Audio (~10 tests) |
| `src-tauri/tests/fixtures/toc_audio_12tracks.bin` | NOUVEAU | Dump TOC binaire pour test parsing |

---

## Out of scope (assumés volontairement)

- MusicBrainz / freedb lookup (viole offline-strict)
- Burn (gravure CD) — uniquement lecture
- macOS / Linux — Windows only, stub propre retournant erreur
- Multi-rip parallèle (un seul à la fois, pas de bottleneck identifié)
- Pause/resume rip (peut être cancel + restart)
- Vue dédiée "tracks CD" en sidebar séparée — éphémères apparaissent juste dans queue + lecteur, pas dans la lib principale
- Sauvegarde préférence `cfg.cdAutoBehavior` ('ask'/'play'/'extract') — toujours "ask" en MVP
- CD-Text (sous-canal Q) — souvent vide ou tronqué, gain rare ne justifie pas la complexité

---

## Risques identifiés

| Risque | Mitigation |
|---|---|
| `flacenc` crate moins maintenu que `libflac-sys` | Vérifier dernière release < 12 mois avant d'adopter ; fallback `libflac-sys` (bindings C, +200KB) si rejet |
| Variabilité hardware lecteurs CD (timings, error rates) | Retry strategy en place ; tests manuels sur 2-3 lecteurs différents avant merge |
| Quota disque appData (~90MB cache temp) | Quota documenté ; GC au boot purge orphelins |
| Polling 6s = délai détection CD perceptible | Acceptable pour MVP (cohérent avec USB) ; futur : ReadDirectoryChangesW ou `WM_DEVICECHANGE` si user feedback insuffisant |
| Compatibilité Windows 7/8 si non testée | LibreFlow cible Windows 10+ (tauri 2.0) → non concerné |

---

## Critères d'acceptation

- [ ] CD audio inséré → toast + modal affichés en ≤ 12s (worst case 2× polling)
- [ ] "Lire" → première piste démarre en < 90s sur drive 8x
- [ ] Prefetch track suivant : pas de gap audible entre tracks
- [ ] "Extraire" → tous tracks rippés en FLAC + ajoutés à la lib avec métadonnées Track 0X
- [ ] Cancel pendant rip → cleanup propre, retour immédiat à l'état précédent
- [ ] Éjection pendant lecture → `tracks[]` nettoyé, lecture stoppée gracieusement
- [ ] Data CD inséré → silencieux, aucune popup
- [ ] App sur macOS → aucun crash, comportement identique à "pas de CD"
- [ ] Tests automatisés passent (≥ 8 nouveaux tests)
- [ ] Bundle size +150KB max
