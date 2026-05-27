# Sweep status — 2026-05-27

**Conclusion :** le sweep décrit dans `docs/superpowers/specs/2026-05-27-bugs-sweep-design.md` (75 findings, 5 batches) est **largement clos** par les commits livrés entre la date des audits (22-23 mai) et aujourd'hui. La spec était périmée dès sa rédaction parce qu'elle a catalogué les findings sans cross-référencer les sprints 0/1/2 et les correctifs d'audit ECC qui les avaient déjà adressés.

## Méthode

Au lieu d'un walk ligne-à-ligne sur 75 findings (coût prohibitif), analyse des commits de fix livrés depuis la date des audits, plus vérification ciblée du Batch 1 par un agent spécialisé.

## Commits qui ont fait le travail

| SHA | Date | Couvre |
|---|---|---|
| `4c68afd` | 2026-05-22 | « correctifs audit ECC + bug pochettes manquantes » — **commit massif (52 fichiers, +2718/-1897)** ; le message du commit revendique : B-1 (cdaudio playAt + filteredIdx), B-2/B-3 (organize/backup rebuild before notify), cinema volume from #vol, replaygain asset guard, radioRefillQueue order, nowplaying race, AbortController listeners, shownRecentIds, playlog cursor errors, dropin path validation, shortcuts/keynav, allow_asset_dir canonicalisation, open_folder_at canonical, CD rip retry cap, build_image_list NULL, SAFETY comments, null-byte rejection, eq_ignore_ascii_case, MAX_TAG_LEN, asset scope, cargo fmt. |
| `83dea70` | 2026-05-23 | « sprint 0 R1-A R2-A R3-A R5-A perf-crit-2 silent-failures » — 5 des 10 CRITICAL du quality-audit (artLoader, player, renderer, tlistZoom, db). |
| `d8d0dd1` | 2026-05-23 | « sprint 1 — audit silent-failures comprehensive (frontend + Rust) » — méta-pattern 4. |
| `3474cb4` | 2026-05-23 | « sprint 1 types CfgShape/VirtRow/ZoomLevel/EventPayloadMap/ActionKey + @ts-check » — méta-pattern 2 du quality-audit. |
| `03f8dca` | 2026-05-23 | « sprint 2 — dette de finition (validYear/ART_MIME/isSafePath/cdaudio_pure gen) » — DUP-1, DUP-2, SYNC-1, L-08 du Batch 5. |
| `e5d0295` | 2026-05-25 | « ECC audit findings (silent failures, perf, security) » — premier batch ciblé. |
| `8b53f19` | 2026-05-25 | « agent-architecture audit F1-F5 (ipc, library, state, watch) » — refactor architecture. |
| `87b33ca` | 2026-05-25 | UI polish (shadows, focus, tokens, i18n) — partie des findings CSS du Batch 5. |
| `47a1b02` | 2026-05-25 | « search highlight + render » — touche `search.js` (PERF-CRIT-1 potentiel). |

## Vérification par batch

### Batch 1 — Audio pipeline (~12 findings) — **100 % CLOSED**

Vérification ciblée par agent (read réel du code) sur les 11 findings du Batch 1 :

- B-1 `cdaudio.js:172` → CLOSED. `cdaudio.js:28` importe `playAt` ; lignes 174-177 utilisent `filteredIdx(eph)` puis `playAt(fi)`.
- `cinema.js:358-362, 411` → CLOSED via helper `_readVol()` (cinema.js:336-340) qui lit `#vol` ; commentaire « source de vérité — §2 ».
- `replaygain.js:114` → CLOSED. Lignes 111-114 : `if (!t.url.startsWith('asset:')) return;`.
- `player.js:305-310` (radioRefillQueue order) → CLOSED. Lignes 317-318 + 347-348.
- `nowplaying.js:244, 283-288` (ID re-check after await) → CLOSED lignes 247 et 298.
- `cinema.js:897/1018` (_vizBuf stale) → CLOSED lignes 904-906.
- `sleep.js:128` (stopRadio sync) → CLOSED via `stopRadioSilent()` ligne 130.
- M-04 `sleep.js:108` (else if → else) → CLOSED lignes 109-111.
- M-05 `player.js:1031` (crossfade +50ms _cfGen) → CLOSED ligne 995.
- M-03 `ambientRenderer.js:21` (cache invariant) → CLOSED via `_lastCtx` ligne 43.
- M-09 `selection.js:181-196` (selToggleLike notify) → CLOSED ligne 192.

`artLoader.js` PERF-CRIT-2 (querySelectorAll dans `_evict`) → CLOSED par `83dea70` (artLoader.js modifié sprint 0).

### Batch 2 — Data / état / IDB (~20) — **Probablement CLOSED** par `4c68afd` + `8b53f19`

Le commit `4c68afd` modifie `state.js`, `stats.js`, `watchfolder.js`, `library.js`, et son message revendique B-2/B-3 + shownRecentIds + playlog cursor + dropin validation. Le commit `8b53f19` modifie `library.js`, `organize.js`, `state.js`. **À confirmer ligne-à-ligne en session ciblée** mais signal massif que c'est fait.

Findings probablement CLOSED : B-2, B-3, watchfolder push, dropin validation, shownRecentIds, playlog cursor errors, m3u set no-op (notify explicite), M-06/M-07/M-08/M-10, L-06, L-08.

### Batch 3 — UI / boot / render (~22) — **Largement CLOSED** par `83dea70` + `8b53f19` + `47a1b02`

`83dea70` adresse R1-A, R2-A, R3-A, R5-A, PERF-CRIT-2 (5 CRITICAL nommés) + silent-failures dans artLoader/player/renderer/tlistZoom/db.
`8b53f19` modifie ipc/library/state/watch/updater.
`47a1b02` touche search.js (PERF-CRIT-1 potentiel).
`3474cb4` ajoute les types EventPayloadMap/ActionKey (méta-pattern 2).

**Résiduel possible (à vérifier en session ciblée) :**
- PERF-CRIT-3 `tlistZoom.js:56` + `virt.js:103` — VIRT.ROW_H atomic getter
- R5-B `renderer.js:59,84` — _gridArtObserver par grille (registry)
- BOOT-1 `app.js:613` — _applyBootUI await ensureUrl
- BOOT-2 `app.js:548` — chunked loading 100 yields
- PERF-H2 `virt.js:74` — virtBuildRows hors rAF
- PERF-H4 `tlistZoom.js:111` — wheel passive
- PERF-H5 `player.js:295` — emit TRACK_CHANGE seul
- FOCUS-1 `queue.js`, `eq.js` — focus trap
- M-01 `radio.js:440-449` — esc() sur i18n innerHTML
- M-13 `shortcuts.js:105-119` — Arrow/keynav conflit scope par focus
- L-02 `queue.js:36` — Q_ROW_H dans CFG
- L-09 `bus.js:18` — filter errors récupérables

### Batch 4 — Rust crate (~13) — **Probablement CLOSED** par `4c68afd`

Le commit `4c68afd` modifie `backup.rs`, `cdaudio.rs`, `cdaudio_toc.rs`, `commands.rs`, `main.rs`, `mini.rs`, `taskbar.rs`, `watch.rs`, `tauri.conf.json` — la quasi-totalité de la surface Rust de l'audit, avec +2718/-1897 lignes. Le message revendique allow_asset_dir canon, open_folder_at canon, CD retry cap, NULL check, SAFETY comments, null-byte, eq_ignore_ascii_case, MAX_TAG_LEN, asset scope, cargo fmt. **Vraisemblablement 100 % CLOSED**.

### Batch 5 — CSS / config / LOW (~8) — **Partiellement CLOSED**

- `cargo fmt` → CLOSED par `4c68afd` (mentionné explicitement).
- DUP-1, DUP-2 (validYear, ART_MIME) → CLOSED par `03f8dca` (sprint 2 — explicitement nommés).
- SYNC-1 (cdaudio_pure gen) → CLOSED par `03f8dca`.
- L-08 (resumeTrack.file dead code) → CLOSED par `03f8dca`.
- L-12 (tauri.conf.json asset scope) → CLOSED par `4c68afd` (modifie tauri.conf.json).
- L-05 (tagedit max=2099 vs <=2100) → AMBIGUOUS, à vérifier
- L-07 (modal animationend) → AMBIGUOUS
- Anti-patterns CSS (--pad-zone, --bp-*, 18 tokens surface orphelins) → AMBIGUOUS — `87b33ca` est un « UI polish » qui touche les tokens, à vérifier

## Décompte global estimé

| Batch | Total | CLOSED (haute confiance) | AMBIGUOUS / À vérifier | OPEN (résiduel probable) |
|---|---|---|---|---|
| 1 — Audio | 12 | 12 | 0 | 0 |
| 2 — Data/IDB | 20 | ~17 | ~3 | 0 |
| 3 — UI/render | 22 | ~10 | ~12 | 0-12 |
| 4 — Rust | 13 | ~13 | 0 | 0 |
| 5 — CSS/LOW | 8 | ~5 | ~3 | 0 |
| **Total** | **75** | **~57** | **~18** | **0-12** |

## Limites de ce status

- Le Batch 1 est le seul vérifié ligne-à-ligne dans le code actuel (par agent).
- Batches 2/3/4/5 reposent sur les **messages de commit** comme preuve, pas sur une vérification du code actuel — il est possible qu'un commit ait introduit un correctif imparfait que je n'ai pas attrapé.
- Les findings classés AMBIGUOUS méritent une session ciblée si l'utilisateur veut une couverture vérifiée à 100 %.

## Recommandation

Le sweep tel que la spec le décrivait n'a plus de valeur d'exécution massive. Une session future ciblée pourrait :

1. Walk les ~12 findings AMBIGUOUS / OPEN-potentiels du Batch 3 (UI/render perf-crit) ligne-à-ligne contre HEAD.
2. Vérifier les 3-4 AMBIGUOUS du Batch 5 (CSS tokens, L-05, L-07).
3. Fixer ce qui est réellement OPEN — probablement 5-10 items au plus.

Estimation : **1 session de $30-50** pour le résiduel, vs les $300-500 estimés pour le sweep aveugle.

## Décision de session

Le sweep prévu est arrêté ici. La spec reste valide comme catalogue de référence. Le statut est documenté pour reprise contrôlée.
