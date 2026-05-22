# Audit de bugs — libreflow (commandes ECC)

**Date :** 2026-05-22
**Branche :** `feat/ui-harmonization-r1-fondation`
**Périmètre :** tout le codebase (`frontend/src/` ~750 Ko, `src-tauri/src/` ~120 Ko)
**Méthode :** 5 agents de revue en parallèle + scanners déterministes ECC

## Commandes ECC exécutées

| Commande | Résultat |
|---|---|
| `harness-audit` | **18/39** — config repo (pas de bugs code) |
| `code-review` (3 agents) | frontend audio / data / UI — voir findings |
| `rust-review` (1 agent) | `cargo check` PASS, `clippy` PASS, `fmt` **FAIL**, `test` PASS (9), `audit` N/A |
| `security-review` + `security-scan` | AgentShield **Grade A 95/100** ; npm audit **0 vuln** |
| `quality-gate` | `npm test` **266/266** ✓ ; 63 modules JS parsent OK |

## Synthèse

| Sévérité | Count | Action |
|---|---|---|
| 🔴 BLOQUANT | 3 | corriger avant merge |
| 🟠 HIGH | 21 | corriger avant merge / acquittement explicite |
| 🟡 MEDIUM | 23 | à planifier |
| ⚪ LOW | 13 | note |

Aucun secret hardcodé, aucun appel réseau externe, garantie offline confirmée. Build Rust et tests JS verts.

---

## 🔴 BLOQUANT

### B-1 — `cdaudio.js:172` — `window.playAt` n'est jamais défini → lecture CD jamais démarrée
```js
if (typeof window.playAt === 'function') window.playAt(newIdx);
```
**Vérifié :** le seul `Object.assign(window, …)` du codebase est dans `viz.js` et n'expose pas `playAt`. Après injection de la piste CD éphémère dans `tracks[]`, la lecture ne démarre jamais (no-op silencieux). Signalé indépendamment par 2 agents + confirmé par grep.
**Sous-bug** (`cdaudio.js:171`) : `newIdx = tracks.length - 1` est un index `tracks[]` brut passé à `playAt`, qui attend un index *filtré* (`getFiltered()`). Même corrigé, l'index serait faux sur bibliothèque filtrée.
**Correctif :** `import { playAt } from './player.js'`, résoudre l'index filtré (`filteredIdx(eph)`) puis `playAt(fi)`.

### B-2 — `organize.js:186` — écritures IDB non-debounced en boucle + `rebuildTrackIdxMap()` après `notify()`
```js
for (const track of tracks) { …; dput('tracks', track).catch(…); }   // 1 dput / piste
…
notify('tracks'); rebuildTrackIdxMap();   // ordre inversé
```
Viole §2 (« IDB writes TOUJOURS debounced ») — jusqu'à N transactions IDB dans la même frame sur N pistes déplacées. Et `rebuildTrackIdxMap()` est appelé **après** `notify('tracks')` : les subscribers voient `_trackIdxMap` désynchronisé de `tracks[]`.
**Correctif :** accumuler puis `saveTracks(moved)` (batché) ; inverser → `rebuildTrackIdxMap()` *puis* `notify('tracks')`.

### B-3 — `backup.js:129-133` — `set('tracks')` notifie les subscribers avant `rebuildTrackIdxMap()`
```js
set('tracks', newTracks);   // _notify() synchrone → subscribers voient _trackIdxMap stale
rebuildTrackIdxMap();
invalidateFilterCache();
notify('tracks');           // double notification
```
`store.set()` notifie synchronement. Tout subscriber de `tracks` déclenché ici lit `_trackIdxMap` encore stale (projection de l'ancien `tracks[]`). Viole l'invariant §2.
**Correctif :** utiliser `replaceTracks(newTracks)` de `state.js` (qui enchaîne `set` + `rebuildTrackIdxMap`) et supprimer le `notify('tracks')` superflu.

---

## 🟠 HIGH

### Frontend — audio / lecture
- **`artLoader.js:91,102,139`** — `window.updateBar?.()` : `updateBar` jamais exposé sur `window` (vérifié grep). L'artwork de la barre now-playing n'est pas rafraîchie au chargement de la pochette de la piste courante. → passer `updateBar` en callback / via le bus.
- **`cinema.js:358-362,411`** — volume calculé depuis `masterGainNode.gain.value` (valeur instantanée du nœud, intermédiaire pendant un fondu) au lieu du slider `#vol`. Viole §2 « volume via DOM ». Corrompt la valeur persistée en `cfg`. → lire `parseFloat(document.getElementById('vol').value)`.
- **`replaygain.js:114`** — `fetch(t.url)` sans valider le schéma. Si `t.url` n'est pas `asset://` (donnée corrompue, dossier réseau), sortie du périmètre offline sans garde. → `if (!t.url.startsWith('asset://')) return;`.
- **`player.js:305-310`** — `radioRefillQueue()` appelé après `_postPlaySideEffects()`, qui émet `EVENTS.FILTER_CHANGED` ; des callbacks UI peuvent lire la file radio avant son refill. Viole l'ordre §3. → déplacer `radioRefillQueue()` avant `_postPlaySideEffects()`.
- **`nowplaying.js:244` (et `:283-288`)** — `_renderNowPlaying(t, info)` après `await _loadTechInfo(t.path)` sans vérifier que la piste courante est toujours `t`. Skip rapide → infos techniques d'une ancienne piste sur la nouvelle pochette. → revérifier `get('curIdx')`/`id` après l'await.
- **`cinema.js:897/1018`** — `_vizBuf` alloué une fois avec `analyser.frequencyBinCount` ; si l'AudioContext est recréé, le buffer est de taille obsolète → spectre erroné. → recréer le buffer si la taille change.
- **`sleep.js:128`** — `stopRadio()` (async, déclenche un `confirmAction`) appelé sans `await` dans `_sleepTick()` synchrone → dialog de confirmation hors contexte, état radio incohérent. → variante silencieuse `stopRadio({silent:true})`.

### Frontend — données / état / UI
- **`watchfolder.js:405`** — `tracks.push(t)` direct en boucle, `rebuildTrackIdxMap()` une seule fois après. Fenêtre d'incohérence `_trackIdxMap` pendant la boucle. → `pushTracks(newTracks)` après accumulation.
- **`dropin.js:101-115`** — aucune validation de chemin sur fichiers droppés : `f.webkitRelativePath || f.name` utilisé tel quel comme `path` (segments `../`, `\`, octets null possibles). De plus `f.name.split('.').pop()` sans extension renvoie le nom entier. → valider comme `_isValidFolderPath` ; garde `f.name.includes('.')`.
- **`playlists.js:487`** — `shownRecentIds` (Set) créé mais jamais alimenté → la dé-duplication échoue, les playlists « Récentes » apparaissent **en double** dans la nav. → `const shownRecentIds = new Set(recents.map(p => p.id))`.
- **`playlog.js:76-88`** — purge IDB par cursor sans `purgeTx.onerror`/`cursor.onerror` ; une erreur IDB est avalée silencieusement → le playlog peut croître au-delà de `PLAYLOG_MAX_ENTRIES`. → ajouter les handlers d'erreur.
- **`m3u.js:211-213`** — `playlists.push(newPl); set('playlists', playlists)` : `set()` est un no-op (même référence → guard `=== val`), aucune notification émise ; dépend de `savePlaylists()` pour notifier. Si `savePlaylists()` échoue, RAM et store divergent. → `notify('playlists')` explicite après le push (pattern de `smartplaylist.js`).

### Frontend — boot / infra
- **`app.js:729`** — `initShortcuts(...)` exécuté au niveau module, **avant** `waitForTauri` et hors `DOMContentLoaded`. Les raccourcis IPC (F11/F12) peuvent s'exécuter avant que `__TAURI__` soit prêt ; éléments DOM potentiellement `null`. → déplacer dans le callback `waitForTauri`.
- **`ctxmenu.js:163-171` + `settings.js:233-238,240`** — listeners `document`/`window` enregistrés au niveau module sans `AbortController` → non nettoyables, cumul lors d'un futur HMR/tests, coexistence avec les handlers délégués de `handlers.js`. → intégrer au registre `_ACTIONS` / `initShortcuts` avec signal.
- **`app.js:605,646`** — `_applyBootUI(cfg)` ajoute des listeners (`#auto-update-chk`, `#watch-folder-chk`, `checkUpdateBtn`) sans garde anti-double-appel. Robuste tant que la fonction n'est appelée qu'une fois, fragile au refactor. → flag `_bootUIApplied` ou `{ once: true }`.

### Rust — `src-tauri/`
- **`commands.rs:356-365`** — `allow_asset_dir` : `is_safe_dir()` appliqué au chemin **non canonique**. `C:\Music\..\Windows` passe le test de profondeur mais résout vers `C:\Windows`. → `canonicalize()` avant validation **et** avant `allow_directory`.
- **`commands.rs:1139-1152`** — `open_folder_at` retourne `folder_str` brut (non canonique) alors que `open_folder` retourne le chemin canonique → incohérence de correspondance de chemin côté JS. → retourner `canon.to_string_lossy()`.
- **`cdaudio.rs:435`** — `std::thread::sleep` de backoff dans `refill_buffer`, sans cap global de retries. Un CD rayé → des centaines d'appels sleep, peut saturer le pool `spawn_blocking` Tokio et figer les autres commandes IPC. → compteur d'échecs consécutifs, abandon après N.
- **`taskbar.rs:344-358`** — `build_image_list` : `ImageList_Create` peut renvoyer `NULL` (OOM/DPI) ; `ImageList_ReplaceIcon` sur handle NULL = comportement indéfini Win32. → tester `il.0.is_null()` et sortir tôt.
- **`cdaudio.rs:57`** — `guard.as_mut().unwrap()` sur une `Option` garantie `Some` par un invariant implicite de `rip_cancel_lock()` — bombe silencieuse si la fonction change. → `.ok_or_else(...)?`.
- **`taskbar.rs` (`setup_impl`, `subclass_proc`)** — blocs `unsafe` Win32 sans commentaire `// SAFETY:`. Viole la convention projet. → documenter les invariants thread/lifetime.
- **`taskbar.rs:97-222`** — `com_thread_loop` ~125 lignes (seuil projet : 50). → extraire en sous-fonctions.

---

## 🟡 MEDIUM

| ID | Emplacement | Problème |
|---|---|---|
| M-01 | `radio.js:440-449` | 3 chaînes `i18n()` injectées dans `innerHTML` sans `esc()` (fichier de langue malformé → injection) |
| M-02 | `cdaudio.js:79,145` | message d'erreur IPC brut (`${e}`) affiché en toast — fuite de détails internes Rust |
| M-03 | `ambientRenderer.js:21` | cache `_noiseCanvas`/`_vignetteGrad` partagé cinema/nowplaying, invariant non gardé |
| M-04 | `sleep.js:108` | `else if (audio.volume < _targetVol)` devrait être `else` — restauration volume parfois skippée |
| M-05 | `player.js:1031` | timeout crossfade `+50ms` ne revérifie pas `_cfGen` à l'entrée |
| M-06 | `renderer.js:852-858` | `drillDown()` invalide les caches album/artist même si `tracks[]` inchangé (coûteux sur 50k) |
| M-07 | `search.js:302` | signature de cache `getFiltered()` = `length + lastId` : ne détecte pas un reorder |
| M-08 | `stats.js:55-59` | `renderStats` cache `tracks`/`trackIdxMap` en module-local → références potentiellement stale |
| M-09 | `selection.js:181-196` | `selToggleLike` mute le Set `liked` en place sans `notify('liked')` |
| M-10 | `m3u.js:196-200` | `tracksNow.find()` en boucle = O(n_m3u × n_tracks) — construire une Map |
| M-11 | `genres.js:330-340` | `saveTracks()` en boucle de rescan — toléré par le max-timer 2s mais à surveiller |
| M-12 | `ctxmenu.js:107-111`, `organize.js:253` | `innerHTML` avec interpolation — sûr aujourd'hui (entiers / `esc()`), fragile au refactor |
| M-13 | `shortcuts.js:105-119` | `ArrowUp/Down` volume entre en conflit avec la navigation liste de `keynav.js` (double action) |
| M-14 | `views.js:424-480` | boutons créés dynamiquement avec `.onclick` direct — contourne le registre `_ACTIONS` |
| M-15 | `dropin.js:76-88` | `readAll()` accumule toutes les entrées d'un dossier en RAM avant traitement |
| S-02 | `commands.rs:885` | `organize_files` : `fs::rename` sur chemins non canonicalisés après validation `..` |
| S-03 | `ui.js:184` | `confirmAction(body)` accepte du HTML brut — sûr par convention, non par construction |
| S-04 | `ipc.js:126` | chemins FS absolus loggés en console sur échec IPC retry |
| M-R1 | `cdaudio.rs:492` | `Vec<i32>` alloué à chaque `read_samples` (réutilisable via champ) |
| M-R2 | `cdaudio.rs:463,606` | `let _ = app.emit(...)` — échecs d'émission avalés |
| M-R3 | `commands.rs:306-311` | `check_paths` accepte des chemins arbitraires sans `is_safe_dir` |
| M-R4 | `commands.rs:149-154`, `watch.rs:70` | `is_audio` : `to_lowercase()` alloue par fichier — `eq_ignore_ascii_case` |
| M-R5 | `commands.rs:774-796`, `cdaudio.rs` | `validate_organize_path`/`validate_rip_dest` ne rejettent pas octets null / caractères de contrôle |

---

## ⚪ LOW

| ID | Emplacement | Problème |
|---|---|---|
| L-01 | `ctxmenu.js:270` | `_artist` échappe `<` via `.replace()` ad-hoc au lieu de `esc()` — **inoffensif** ici (contexte texte), incohérent. *(ex-S-01, rétrogradé de HIGH : l'agent sécurité avait manqué le `.replace(/</g,'&lt;')`)* |
| L-02 | `queue.js:36` | `Q_ROW_H = 50` hardcodé au lieu de `CFG` (drag, hors render loop) |
| L-03 | `miniplayer.js:50` | listener `volumechange` ajouté via `setTimeout(0)` sans nettoyage (singleton, impact nul) |
| L-04 | `cinema.js:674` | `em.innerHTML = extEmoji(...)` — SVG statique sûr, pattern fragile |
| L-05 | `tagedit.js:106` vs `library.js:40` | `max="2099"` UI vs `<= 2100` validation backend |
| L-06 | `dupes.js:31-33` | clé de dédoublonnage ignore l'extension (MP3 + FLAC homonymes groupés) |
| L-07 | `modal.js:149-153` | `animationend` + `setTimeout(250)` — idempotent, incohérent avec le flag `_closeHandled` de `settings.js` |
| L-08 | `app.js:637` | `resumeTrack.file?.split(...)` — dead code (`file` toujours `null` sur pistes restaurées) |
| L-09 | `bus.js:18` | re-throw via `queueMicrotask` → toast d'erreur visible pour des erreurs récupérables |
| L-10 | `commands.rs:244` | lettre de lecteur CD sans garde `is_ascii_alphabetic()` |
| L-11 | `commands.rs` `read_tags` | pas de cap de longueur sur les champs texte de tags (title/artist/album/genre) |
| L-12 | `tauri.conf.json:85` | scope asset statique inclut `$DESKTOP/**` et `$DOWNLOAD/**` — plus large que nécessaire |
| L-13 | `cdaudio_toc.rs`, `backup.rs`, `commands.rs`, `cdaudio.rs` | `cargo fmt --check` échoue (formatage uniquement) |

---

## Config harness (hors code applicatif)

Findings de `harness-audit` et `security-scan` — ne concernent **pas** le code de l'app :

- **`harness-audit` 18/39** : manque `.claude/` overrides projet, `AGENTS.md`, `.claude/memory.md`, `.github/workflows/`, `SECURITY.md`, `dependabot.yml`, `CODEOWNERS`.
- **AgentShield (Grade A 95/100)** : `.claude/settings.local.json` — règle `Bash(rm .git/COMMIT_EDITMSG_tmp)` trop permissive ; pas de deny-list ; pas de hook `PreToolUse`.
- **`cargo-audit`** non installé — à ajouter en CI (surveiller `tauri-plugin-updater`, `lofty`, `zip`).

---

## Priorités

1. **B-1** — réparer la lecture CD (`window.playAt`).
2. **B-2 / B-3** — corriger les violations d'invariant `_trackIdxMap` / IDB (`organize.js`, `backup.js`).
3. **HIGH Rust sécurité** — `allow_asset_dir` canonicalisation (path traversal), `build_image_list` NULL.
4. **HIGH frontend** — `window.updateBar`, volume cinema hors `#vol`, validation `dropin.js`, `shownRecentIds`.
5. Lancer `cargo fmt` ; ajouter `cargo audit` en CI.

---

## Notes de fiabilité

- **Vérifiés manuellement :** B-1 (`window.playAt`/`window.updateBar` jamais assignés — grep), L-01 (ex-S-01, faux positif HIGH de l'agent sécurité).
- **À confirmer rapidement :** B-2/B-3 dépendent de la sémantique de notification synchrone de `store.set()` — exacte d'après la lecture des agents, mais vérifier qu'un subscriber lit bien `_trackIdxMap` dans le callback synchrone avant d'appliquer le correctif.
- Sévérités issues des agents ECC `code-reviewer` / `rust-reviewer` / `security-reviewer`, recoupées et dédupliquées.
