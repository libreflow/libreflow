# Spec — Sweep bugs BLOQUANT → LOW

**Date :** 2026-05-27
**Statut :** Design — en attente de revue utilisateur
**Source des findings :** `docs/audits/ecc-bug-audit-2026-05-22.md` + `docs/audits/quality-audit-2026-05-23.md`, déduplication appliquée.
**Déjà couvert par `e5d0295`** : silent failures (player/app/radio), 4 perf items, 3 sécurité (CSP, replaygain race, tags bounds, M4A depth). **Tout le reste est ouvert.**

---

## 1. Objectif

Adresser **~75 findings** des deux audits encore ouverts, classés en 5 batches par surface technique. Aucun nouveau code applicatif — uniquement des correctifs sur l'existant et restauration des invariants documentés dans `CLAUDE.md` (§2, §9, §10, §13, §14, §15).

**Non-objectifs :**
- Pas de refactor structurel (méta-patterns 1/2/3 du quality-audit : séparé, hors scope)
- Pas de nouvelle fonctionnalité
- Pas de migration `@ts-check` étendue (méta-pattern 2 : séparé)
- Pas de virtualisation 2D des grilles (perf longue durée : séparé)

## 2. Critère de succès

- `cargo test` et `npm test` verts après chaque batch
- `npm run bench` sans régression > 5% après le batch 3 (UI/render)
- Smoke manuel `npm run dev` OK après batch 1 (audio) et batch 4 (Rust IPC)
- Chaque batch commit avec message conventionnel `fix: <surface> — <résumé>`
- Tous les BLOQUANT et CRITICAL des deux audits sont soit corrigés, soit explicitement justifiés en commit body comme « non-applicable » ou « déjà corrigé par e5d0295 »

## 3. Architecture

**Mode séquentiel par batch.** Pas de parallélisation cross-batch (conflits de merge probables sur fichiers transverses comme `app.js`, `renderer.js`). Au sein d'un batch, les fixes indépendants peuvent être groupés.

| # | Batch | Fichiers principaux | Findings ouverts (estimé) | Invariants concernés |
|---|---|---|---|---|
| 1 | Audio pipeline | `player.js`, `cinema.js`, `sleep.js`, `replaygain.js`, `nowplaying.js`, `cdaudio.js`, `viz.js`, `ambient.js`, `artLoader.js` | ~12 | §9 setTargetAtTime, §13 #vol |
| 2 | Data / état / IDB | `organize.js`, `backup.js`, `watchfolder.js`, `dropin.js`, `playlists.js`, `playlog.js`, `m3u.js`, `selection.js`, `stats.js`, `library.js`, `tagedit.js`, `db.js` | ~20 | §2 rebuildTrackIdxMap, §14 IDB debounce |
| 3 | UI / boot / render | `app.js`, `tlistZoom.js`, `virt.js`, `renderer.js`, `ctxmenu.js`, `settings.js`, `search.js`, `views.js`, `modal.js`, `shortcuts.js`, `keynav.js`, `radio.js` | ~22 | §10 virt constants, §11 high-risk |
| 4 | Rust crate | `commands.rs`, `cdaudio.rs`, `taskbar.rs`, `watch.rs`, `backup.rs` | ~13 | IPC contract, FS scope, allowlist |
| 5 | CSS / config / LOW | `style.css`, `tauri.conf.json`, dédup `validYear`, `cargo fmt` | ~8 | §12 tokens, §15 offline |

## 4. Findings par batch

### Batch 1 — Audio pipeline (~12)

**BLOQUANT :**
- **B-1** `cdaudio.js:172` — `window.playAt` jamais défini → CD playback no-op silencieux. Importer `playAt` de `./player.js`, calculer `filteredIdx(eph)`, appeler `playAt(fi)`.

**HIGH :**
- `artLoader.js:91,102,139` — `window.updateBar?.()` jamais exposé → artwork barre stale. Passer en callback ou via bus.
- `cinema.js:358-362, 411` — volume lu depuis `masterGainNode.gain.value` (intermédiaire pendant fondu) au lieu de `#vol`. Lire `parseFloat(document.getElementById('vol').value)`.
- `replaygain.js:114` — `fetch(t.url)` sans valider schéma. Ajouter `if (!t.url.startsWith('asset://')) return;`.
- `player.js:305-310` — `radioRefillQueue()` après `_postPlaySideEffects()`. Inverser l'ordre.
- `nowplaying.js:244, 283-288` — `_renderNowPlaying(t, info)` après `await _loadTechInfo(t.path)` sans revérifier la piste courante. Comparer `get('curIdx')`/`id` après await.
- `cinema.js:897/1018` — `_vizBuf` taille obsolète si AudioContext recréé. Recréer si la taille change.
- `sleep.js:128` — `stopRadio()` async sans await dans tick synchrone. Ajouter variante `{silent:true}`.

**MEDIUM :**
- M-04 `sleep.js:108` — `else if` → `else` pour restauration volume.
- M-05 `player.js:1031` — timeout crossfade `+50ms` ne revérifie pas `_cfGen`.
- M-03 `ambientRenderer.js:21` — cache `_noiseCanvas`/`_vignetteGrad` partagé sans invariant gardé.
- M-09 `selection.js:181-196` — `selToggleLike` mute Set sans `notify('liked')`.

### Batch 2 — Data / état / IDB (~20)

**BLOQUANT :**
- **B-2** `organize.js:186` — boucle `dput('tracks', track)` non debounced + `rebuildTrackIdxMap()` après `notify()`. Accumuler puis `saveTracks(moved)` ; inverser ordre.
- **B-3** `backup.js:129-133` — `set('tracks', newTracks)` avant `rebuildTrackIdxMap()` (subscribers voient map stale). Utiliser `replaceTracks(newTracks)` de `state.js`.

**HIGH :**
- `watchfolder.js:405` — `tracks.push(t)` direct en boucle. Accumuler puis `pushTracks(newTracks)`.
- `dropin.js:101-115` — aucune validation chemin (`webkitRelativePath`, `.` extension). Réutiliser `_isValidFolderPath`.
- `playlists.js:487` — `shownRecentIds` jamais alimenté → doublons. `new Set(recents.map(p => p.id))`.
- `playlog.js:76-88` — purge IDB sans `onerror` sur transaction/cursor. Ajouter handlers.
- `m3u.js:211-213` — `playlists.push(newPl); set('playlists', playlists)` no-op (même ref). Ajouter `notify('playlists')` explicite.

**MEDIUM :**
- M-06 `renderer.js:852-858` — `drillDown()` invalide caches album/artist même si `tracks[]` inchangé. Garde par génération.
- M-07 `search.js:302` — signature cache `length + lastId` ne détecte pas reorder. Inclure hash léger.
- M-08 `stats.js:55-59` — caches module-local de `tracks`/`trackIdxMap`. Toujours relire via `state.js`.
- M-10 `m3u.js:196-200` — `tracksNow.find()` en boucle O(n×m). Construire Map en pré-passe.
- M-11 `genres.js:330-340` — `saveTracks()` en boucle de rescan. Batcher.
- M-15 `dropin.js:76-88` — `readAll()` accumule tout en RAM. Streamer.

**LOW :**
- L-06 `dupes.js:31-33` — clé de dédup ignore l'extension. Inclure extension dans la clé.
- L-08 `app.js:637` — `resumeTrack.file?.split(...)` dead code. Supprimer.

### Batch 3 — UI / boot / render (~22)

**CRITICAL (du quality-audit, Top 10) :**
- **R1-A** `tlistZoom.js:67` + `app.js:485` — `setTlistZoom()` émet `RENDER_LIB` avant `Promise.all(dall(tracks))`. Soit déplacer `setTlistZoom` après, soit garder `if (tracks.length === 0) return;` dans `setTlistZoom`.
- **PERF-CRIT-1** `search.js _ensureNlc` — `filterExact()` cold 175 ms + 300 MB. Découpler `_metaGen` (tags) et `_viewGen` (filtres).
- **PERF-CRIT-2** `artLoader.js:43` — `_evict` fait `querySelectorAll('img')` du DOM. Maintenir `Set<string>` des URLs en DOM via `_patchArtDOM` + MutationObserver.
- **PERF-CRIT-3** `tlistZoom.js:56` + `virt.js:103` — `VIRT.ROW_H` muté runtime, race avec rAF. Passer en paramètre ou getter atomique.
- **R3-A** `renderer.js:351` — `scrollTop` perdu au zoom (innerHTML=). Save + restore dans rAF.
- **R5-A** `renderer.js:58` — `_artTrackById` Map jamais vidée. `.clear()` quand caches album/artiste invalidés.
- **R5-B** `renderer.js:59,84` — `_gridArtObserver` unique partagé Albums/Artistes. Un observer par grille, registry `Map<grid, observer>`.

**HIGH :**
- BOOT-1 `app.js:613` — `_applyBootUI` après `await ensureUrl` (bloque jusqu'à 5s si NAS lent). Séparer UI hydration de l'audio resume.
- BOOT-2 `app.js:548` — 100 yields `setTimeout(0)` au chunked loading = +400ms. Réduire la cadence à 10-20.
- RACE-1 `app.js:551-552` — `set('tracks')` notifie avant `rebuildTrackIdxMap()`. Utiliser `replaceTracks()`.
- RACE-2 `renderer.js:393` — ResizeObserver pendant chunked loading → render partiel. Guard `_loading`.
- RACE-3 `playerbar.js:161` — `updateBar` Phase 2 dans `rAF + setTimeout(0)` ; closure `t` stale. Re-lire `get('curIdx')`.
- RACE-4 `player.js:336` — `emit TRACK_CHANGE` avant `audio.play()`. Inverser.
- PERF-H1 `renderer.js:722` — `renderAlbumsGrid` rebuild sa Map ignorant `_getAlbumMap`. Réutiliser.
- PERF-H2 `virt.js:74` — `virtBuildRows` 9.3ms dans rAF. Pré-calculer hors rAF si possible.
- PERF-H4 `tlistZoom.js:111` — `wheel { passive: false }`. Évaluer si vraiment nécessaire.
- PERF-H5 `player.js:295` — `_postPlaySideEffects` émet `FILTER_CHANGED` (renderLib complet) à chaque lecture. Émettre `TRACK_CHANGE` seul.
- FOCUS-1 `queue.js`, `eq.js` — pas de focus trap. Réutiliser pattern `_setupSettingsFocusTrap`.
- `app.js:729` — `initShortcuts(...)` au niveau module avant `waitForTauri`. Déplacer dans callback.
- `ctxmenu.js:163-171` + `settings.js:233-238,240` — listeners sans `AbortController`. Intégrer au registre.
- `app.js:605,646` — `_applyBootUI(cfg)` sans garde anti-double-appel. Flag `_bootUIApplied`.

**MEDIUM :**
- M-01 `radio.js:440-449` — 3 chaînes i18n dans `innerHTML` sans `esc()`.
- M-13 `shortcuts.js:105-119` — Arrow Up/Down volume en conflit avec keynav. Scope par focus.
- M-14 `views.js:424-480` — boutons dynamiques `.onclick` direct. Passer par `data-action`.

**LOW :**
- L-02 `queue.js:36` — `Q_ROW_H = 50` hardcodé. Promote à `CFG`.
- L-09 `bus.js:18` — re-throw via `queueMicrotask` → toast pour erreurs récup. Filtrer.

### Batch 4 — Rust crate (~13)

**HIGH :**
- `commands.rs:356-365` — `allow_asset_dir` : `is_safe_dir()` sur chemin non canonique. `canonicalize()` avant validation.
- `commands.rs:1139-1152` — `open_folder_at` retourne `folder_str` brut. Retourner `canon.to_string_lossy()`.
- `cdaudio.rs:435` — `std::thread::sleep` sans cap retries. Compteur d'échecs consécutifs, abandon après N.
- `taskbar.rs:344-358` — `build_image_list` : `ImageList_Create` peut renvoyer NULL. Tester `il.0.is_null()` et exit.
- `cdaudio.rs:57` — `guard.as_mut().unwrap()` sur invariant implicite. `.ok_or_else(...)?`.
- `taskbar.rs` `setup_impl`/`subclass_proc` — blocs `unsafe` sans `// SAFETY:`. Documenter invariants thread/lifetime.
- `taskbar.rs:97-222` — `com_thread_loop` 125 lignes (seuil 50). Extraire sous-fonctions.

**MEDIUM :**
- M-R1 `cdaudio.rs:492` — `Vec<i32>` alloué à chaque `read_samples`. Champ réutilisable.
- M-R2 `cdaudio.rs:463,606` — `let _ = app.emit(...)`. Logger erreurs.
- M-R3 `commands.rs:306-311` — `check_paths` sans `is_safe_dir`. Ajouter.
- M-R4 `commands.rs:149-154`, `watch.rs:70` — `is_audio` : `to_lowercase()` alloue. `eq_ignore_ascii_case`.
- M-R5 `commands.rs:774-796`, `cdaudio.rs` — `validate_organize_path`/`validate_rip_dest` ne rejettent pas octets null / ctrl chars.

**LOW :**
- L-10 `commands.rs:244` — lettre lecteur CD sans `is_ascii_alphabetic()`.
- L-11 `commands.rs` `read_tags` — pas de cap longueur sur tags. `MAX_TAG_LEN = 512`.

### Batch 5 — CSS / config / LOW (~8)

- L-13 `cdaudio_toc.rs`, `backup.rs`, `commands.rs`, `cdaudio.rs` — `cargo fmt --check` FAIL. Run `cargo fmt`.
- L-12 `tauri.conf.json:85` — scope asset inclut `$DESKTOP/**` + `$DOWNLOAD/**` plus large que nécessaire. Restreindre à `$AUDIO`, `$MUSIC`, `$DOCUMENT/libreflow`.
- DUP-1 `library.js:276` + `artLoader.js:68` — `_resolveArtBuf` vs `getArtUrl` dupliqués. Consolider dans `artLoader.js`.
- DUP-2 `library.js:39` + `app.js:113` — `validYear` dupliqué. Mover dans `utils.js`.
- SYNC-1 `cdaudio_pure.js` / `.cjs` — doublon. Générer `.cjs` depuis `.js` en prebuild esbuild.
- Anti-patterns CSS — `--pad-zone` token mort, `--bp-*` mal utilisé en `@media`, 18 tokens `--surface-*` orphelins. Supprimer ou consommer.
- L-05 `tagedit.js:106` vs `library.js:40` — `max="2099"` UI vs `<= 2100` backend. Aligner.
- L-07 `modal.js:149-153` — `animationend` + `setTimeout(250)`. Aligner avec `_closeHandled` de `settings.js`.

## 5. Tests à ajouter

Pour ne pas régresser, ajouts dans `frontend/tests/core.test.cjs` :

```js
test('B-1 — cdaudio playAt uses filtered index')
test('B-2 — organize batches dput then rebuilds idx before notify')
test('B-3 — backup uses replaceTracks (idx valid in subscriber callback)')
test('R1-A — setTlistZoom skips RENDER_LIB when tracks empty')
test('R3-A — virtRenderWindow preserves scrollTop across innerHTML')
test('R5-A — _artTrackById cleared on album/artist cache invalidation')
test('shownRecentIds dedupes recent playlists')
```

Pour Rust dans `src-tauri/src/commands.rs` (proptest) :
- `allow_asset_dir` rejette les chemins qui canonicalisent hors-scope
- `validate_organize_path` rejette null bytes et ctrl chars
- `is_audio` insensible à la casse sans allocation

## 6. Ordre d'exécution + checkpoints

```
[Pré-flight]   → désactiver libreflow-gateguard (LIBREFLOW_GATEGUARD=off) le temps du sweep
[Batch 1 — Audio]   → fix, tests, smoke manuel "npm run dev" (utilisateur valide)
[Batch 2 — Data]    → fix, npm test, commit
[Batch 3 — UI]      → fix, npm test + npm run bench (régression <5%), commit
[Batch 4 — Rust]    → fix, cargo test + cargo fmt, smoke manuel IPC, commit
[Batch 5 — CSS/LOW] → fix, npm test, commit
[Post-flight]  → réactiver libreflow-gateguard, run full quality-gate, créer audit-2026-05-27.md
```

## 7. Risques + mitigations

| Risque | Mitigation |
|---|---|
| **Régression invariant non détectée par tests** | Tests régression ajoutés pour B-1/B-2/B-3, R1-A, R3-A, R5-A. Smoke manuel demandé après batches 1 et 4. |
| **Conflit cross-batch** | Tous les fixes sur `app.js` (RACE-1 ligne 551, BOOT-1/-2, initShortcuts, `_applyBootUI`) sont groupés dans le batch 3. Aucun autre fichier n'est touché par plus d'un batch. |
| **Token budget** | Stops obligatoires entre chaque batch. Utilisateur peut interrompre. |
| **GateGuard fatigue (75+ premières-éditions)** | Désactivation explicite via `LIBREFLOW_GATEGUARD=off` au début du sweep, réactivation au post-flight. |
| **`e5d0295` déjà couvert d'autres findings non listés** | Plan d'implémentation (writing-plans) lit le diff de `e5d0295` avant chaque batch et skip les déjà-corrigés avec note en commit body. |
| **Tests `npm test` cassent au milieu d'un batch** | Stop, debug, fix avant de continuer. Pas de commit partiel. |

## 8. Décisions ouvertes

Aucune — l'utilisateur a approuvé toutes les options présentées en brainstorming. Liste pour mémoire :

- ✅ Scope : tout BLOQUANT → LOW (~75)
- ✅ Ordre batches : Audio → Data → UI → Rust → CSS
- ✅ Désactiver GateGuard pendant le sweep
- ✅ Stops entre batches (budget tokens)
- ✅ Tests régression ajoutés pour les BLOQUANT et CRITICAL
- ✅ Smoke manuel demandé après batches 1 et 4

## 9. Hand-off

Après revue utilisateur de ce spec → invocation `superpowers:writing-plans` pour le plan d'exécution batch-par-batch avec checkpoints précis.
