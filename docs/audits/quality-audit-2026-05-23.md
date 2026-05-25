# Audit qualité — libreflow vs Spotify desktop

**Date :** 2026-05-23
**Méthode :** 6 agents spécialisés en parallèle — architecture, code-flow, performance, refactor/cohérence, type-design, silent-failures.
**Source :** `feat/ui-harmonization-r1-fondation` HEAD `68d9391` après 60+ fichiers modifiés en session.

---

## Verdict synthétique

| Dimension | Verdict | Note | Référence |
|---|---|---|---|
| **Architecture** | EN DESSOUS de Spotify, largement | structural | architect agent |
| **Cohérence du projet** | « pas à chier — transition à 65 % » | 6.5/10 | refactor agent |
| **Type design** | trou critique | 3.5/10 | type-design agent |
| **Performance liste 50k** | tient mais à la limite | ~65 % Spotify | perf agent |
| **Performance grilles 50k** | non virtualisées — plafond structurel | ~30 % Spotify | perf agent |
| **Race conditions runtime** | 2 CRITICAL, 8 HIGH inter-flux | bugs réels | code-explorer agent |
| **Échecs silencieux** | partout dans le pipeline audio | culture du `.catch(()=>{})` | silent-failures agent (partiel) |

**TL;DR honnête :** libreflow est un **monolithe ESM en transition active**, avec une discipline d'invariants documentée plus haute que la moyenne mais une **architecture qui retarde la documentation de 2 ans**. Le code n'est pas pourri — il est *à mi-chemin* d'un design moderne. La distance à Spotify est **structurelle, pas cosmétique** : entre 6 semaines (niveau « indie premium ») et 18 mois (niveau Spotify réel).

---

## 4 méta-patterns qui expliquent la plupart des symptômes

Plutôt qu'une longue liste de bugs isolés, voici les 4 racines qui produisent la majorité de ce que l'utilisateur observe comme « ça marche mal ».

### 🧬 Méta-pattern 1 — Migrations laissées à mi-chemin

Trois grands chantiers ont été lancés et **abandonnés en route**, chacun laissant des résidus qui dégradent la qualité perçue :

| Migration | État | Résidus visibles |
|---|---|---|
| `tracks[]` global → `store.js` réactif | ~70 % | 20 `subscribe('X', v ⇒ X = v)` dans `app.js` qui dupliquent l'état du store dans des locals (architect F2.2 + F3.1) |
| `types.js` → `@ts-check` partout | 11 % couvert | 6 modules typés / ~55 non — *le pire des deux mondes* (type 3.1) |
| Design-system tokens (`--surface-*`, `--fg-*`, `--tint-*`) | ~10 % migré | 75 tokens CSS définis mais jamais consommés (refactor 1.6, groupe A) |

**Lien logique :** ce méta-pattern explique pourquoi B-1 (`window.playAt` no-op) est passé inaperçu — le wiring `Object.assign(window)` est lui aussi une migration incomplète. Si l'un de ces 3 chantiers était terminé, B-1 n'aurait jamais existé.

### 🧬 Méta-pattern 2 — Discipline documentée sans enforcement runtime

CLAUDE.md liste 20 invariants. Aucun n'est **imposé par le code** — tous sont des conventions humaines :

| Invariant | Imposé par | Bug si violé |
|---|---|---|
| `tracks[]` muté → `rebuildTrackIdxMap()` | revue humaine + 4 tests | corruption silencieuse de l'index ; aucun runtime check (pas de Proxy, pas d'API `mutateTracks()`) — architect F3.2 |
| `audio.volume` lu depuis `#vol` | habitude | confondu plusieurs fois cette session (`cinema.js` réparé) |
| Pas de `fetch` externe | linter mental | `replaygain.js:114` était sans garde de schéma jusqu'à cette session |
| `data-action="X"` ↔ `_ACTIONS['X']` | 80+ strings dupliquées | typo HTML = `console.warn` runtime seulement (type 1, handlers.js) |
| Payload event bus `{ track, idx }` | commentaire dans `bus.js` | rename = casse silencieuse de N subscribers (type 1, bus.js) |
| Niveau zoom `'compact'/'normal'/'comfortable'` | `if (!includes)` runtime | typo `'compcat'` = `console.warn` (type 1, tlistZoom.js) |

**Lien logique :** ce méta-pattern AMPLIFIE le méta-pattern 3 — chaque race condition est silencieuse parce que le contrat n'est pas typé.

### 🧬 Méta-pattern 3 — Ordering bugs procéduraux dans un boot de 360 lignes

`boot()` enchaîne 15+ phases sans abstraction phase-machine. Conséquences directes :

| Bug | Cause | Symptôme utilisateur |
|---|---|---|
| **R1-A CRITICAL** | `setTlistZoom()` ligne 485 émet `RENDER_LIB` AVANT le `Promise.all(dall(tracks))` ligne 492 — la liste est rendue vide avant le chargement | écran "liste vide" pendant ~300-600 ms au boot (code-explorer R1-A) |
| **R1-D HIGH** | `set('tracks', tracks)` notifie `invalidateFilterCache()` synchronement AVANT `rebuildTrackIdxMap()` | bombe à retardement : tout subscriber `'tracks'` qui appelle `trackIdx()` voit une map vide (code-explorer R1-D) |
| **R2-A CRITICAL** | `_playDirect()` (radio auto-play, crossfade) contourne `_playLock` du `playAt()` | double `TRACK_CHANGE`, deux `updateBar()`, désync UI/audio (code-explorer R2-A) |
| **R3-B HIGH** | `RENDER_LIB → virtAttachScroll → new ResizeObserver → callback → RENDER_LIB` | flash de double render à certaines tailles ; pas de boucle infinie aujourd'hui mais une régression layout y exposerait (code-explorer R3-B + perf MEDIUM-2) |
| **CRITICAL-3** | `VIRT.ROW_H` muté runtime par `setTlistZoom()` — race avec rAF de scroll en vol | au Ctrl+Wheel pendant scroll rapide, prefix-sum incohérent 1 frame (perf CRITICAL-3) |
| **`_applyBootUI` retardé** | Bloque jusqu'à 5 s si fichier audio de reprise inaccessible (NAS lent) | langue/mode par défaut affichés jusqu'à reprise (code-explorer R1-B) |

**Lien logique :** ces 6 bugs partagent UNE cause architecturale (boot procédural sans contrat de phase). Un **boot phase machine** (`bootstrap → identity → restore → first-paint → idle-prefetch`) avec préconditions explicites les éliminerait tous d'un coup.

### 🧬 Méta-pattern 4 — Culture du `.catch(() => {})` qui mange l'information

Pattern systémique dans le pipeline audio :

```js
invoke('taskbar_set_playing', ...).catch(() => {});    // player.js:267
audio.play().catch(() => {});                          // player.js:305  — silence sur échec lecture !
invoke('win_set_title', ...).catch(() => {});          // player.js:358
getArtUrl(t).then(...).catch(() => {});                // renderer.js:80 — artwork échec silencieux
getStorageEstimate().then(...).catch(...).then(...);   // db.js:145 — null sans log
```

**Lien logique :** ce méta-pattern combiné au méta-pattern 1 (migration store incomplète) explique pourquoi *« l'utilisateur ne sait pas ce qui ne marche pas »*. Quand `audio.play()` échoue (autoplay policy, codec, fichier verrouillé), l'app reste muette sans toast, sans log diagnostic. L'utilisateur clique 3 fois, voit que ça ne joue pas, conclut « plein de choses ne marchent pas ». La feature MARCHE — c'est juste qu'elle ÉCHOUE silencieusement quand elle échoue.

---

## Top 10 problèmes — CRITICAL, ordonnés par ROI

| # | ID | Problème | Fichier:Ligne | Symptôme utilisateur | Causes/Liens |
|---|---|---|---|---|---|
| 1 | **R1-A** | `setTlistZoom()` émet `RENDER_LIB` sur `tracks=[]` au boot | `tlistZoom.js:67` + `app.js:485` | écran liste vide 300-600 ms au boot, parfois persistant si chunked loading lent | méta-3 ; correctif : déplacer `setTlistZoom` APRÈS `Promise.all` ou supprimer le `emit` quand `tracks.length===0` |
| 2 | **R2-A** | `_playDirect()` contourne `_playLock` | `player.js:299-313` | double `TRACK_CHANGE` au crossfade ou radio auto-play, désync icône play/pause | méta-3 ; correctif : étendre `_cfGen` ou ajouter `_playLock` partout |
| 3 | **PERF-CRIT-1** | `filterExact()` cold = 175 ms + 300 MB heap | `search.js` _ensureNlc | freeze 175 ms sur 1re recherche après tag edit / scan | invalidation grossière `_filterGen` ; correctif : 2 compteurs `_metaGen` / `_viewGen` |
| 4 | **PERF-CRIT-2** | `_evict()` fait `querySelectorAll('img')` du DOM entier à chaque éviction LRU | `artLoader.js:43` | jank diffuse sur longues sessions (5-15 ms par scroll-frame avec grille ouverte) | correctif : `Set<string>` des URLs en DOM, maintenue par `_patchArtDOM` + observer DOM |
| 5 | **PERF-CRIT-3 + R3-C** | `VIRT.ROW_H` muté runtime — race avec rAF | `tlistZoom.js:56` + `virt.js:103` | au Ctrl+Wheel pendant scroll rapide : 1 frame désynchronisée | méta-2 ; correctif : passer ROW_H en paramètre ou getter atomique |
| 6 | **R3-A** | Changement de zoom = `scrollTop` perdu à zéro | `renderer.js:351` | l'utilisateur perd sa position dans la liste à chaque Ctrl+Wheel | correctif : `const top = listEl.scrollTop` avant `innerHTML=`, restore dans rAF après |
| 7 | **R5-A** | `_artTrackById` Map jamais vidée | `renderer.js:58` | fuite mémoire + références à pistes supprimées (`getArtUrl` sur Track absent) | correctif : `_artTrackById.clear()` quand `_albumMapCache` / `_artistMapCache` invalidé |
| 8 | **R5-B** | `_gridArtObserver` unique partagé Albums/Artistes | `renderer.js:59,84` | navigation rapide Albums→Artistes annule les `getArtUrl` en vol des albums | correctif : un observer par grille, ou registry `Map<grid, observer>` |
| 9 | **HANDLER-TYPE** | 80+ `data-action="X"` strings sans union type | `handlers.js:_ACTIONS` + ~80 templates HTML | typo HTML = `console.warn` runtime seul, feature cassée jusqu'à découverte manuelle | méta-2 ; correctif : `@ts-check` + `ActionKey` union + `Record<ActionKey, Handler>` |
| 10 | **BUS-PAYLOAD** | 11 events avec payloads documentés en commentaire seulement | `bus.js` | rename d'un champ payload = casse silencieuse de N subscribers | méta-2 ; correctif : `EventPayloadMap` typedef + `emit<K>(event: K, payload: EventPayloadMap[K])` |

---

## HIGH — tableau condensé (18 findings)

| ID | Fichier | Problème | Source |
|---|---|---|---|
| ARCH-1 | `app.js` (1070 l.) | god-module : 5 responsabilités, viole CLAUDE.md §16 (800 lignes max) | architect F1.1 |
| ARCH-2 | wiring | `Object.assign(window)` documenté comme bonne pratique = anti-pattern (tree-shaking, tests, types) | architect F1.2 |
| BOOT-1 | `app.js:613` | `_applyBootUI` après `await ensureUrl` — bloque jusqu'à 5s si fichier audio NAS manquant | code-explorer R1-B |
| BOOT-2 | `app.js:548` | 100 yields `setTimeout(0)` pendant chunked loading = +400ms boot perçu sur 50k | perf HIGH-6 |
| RACE-1 | `app.js:551-552` | `set('tracks')` notifie AVANT `rebuildTrackIdxMap()` — bombe à retardement | code-explorer R1-D |
| RACE-2 | `renderer.js:393` | ResizeObserver pendant chunked loading → render partiel avec liste partiellement remplie | code-explorer R1-C |
| RACE-3 | `playerbar.js:161` | `updateBar` Phase 2 dans `rAF + setTimeout(0)` — closure `t` peut être stale | code-explorer R2-E |
| RACE-4 | `player.js:336` | `emit TRACK_CHANGE` AVANT `audio.play()` — icône play/pause incorrecte | code-explorer R2-B |
| PERF-H1 | `renderer.js:722` | `renderAlbumsGrid` rebuild sa propre Map ignorant `_getAlbumMap` mémoïsé (50k = 25ms à chaque tri) | perf HIGH-1 |
| PERF-H2 | `virt.js:74` | `virtBuildRows` 9.3ms dans le rAF (budget 16.6ms) — fragile à toute régression | perf HIGH-2 |
| PERF-H3 | `renderer.js:83` | Grilles non virtualisées → 3000 cartes albums = 50-100ms de layout sur 50k | perf HIGH-3 |
| PERF-H4 | `tlistZoom.js:111` | `wheel { passive: false }` sur `#tlist` bloque compositor à chaque scroll | perf HIGH-4 |
| PERF-H5 | `player.js:295` | `_postPlaySideEffects` émet `FILTER_CHANGED` → `renderLib()` complet à CHAQUE lecture | code-explorer R2-C + perf |
| FOCUS-1 | `queue.js`, `eq.js` | Pas de focus trap sur Queue/EQ → Tab sort des panneaux | code-explorer R4-A |
| DUP-1 | `library.js:276` + `artLoader.js:68` | `_resolveArtBuf` vs `getArtUrl` — même logique IDB+`_artBuf`+`artB64` dupliquée | refactor 2.1 |
| DUP-2 | `library.js:39` + `app.js:113` | `validYear` strictement identique défini 2 fois | refactor 1.3 |
| SEC-1 | `dropin.js`, `m3u.js`, `watchfolder.js` | Validation chemins JS = ZÉRO (Rust solide, mais JS pousse `../` brut au backend) | refactor 2.4 |
| SYNC-1 | `cdaudio_pure.js` / `.cjs` | Doublon manuel "Keep in sync" — divergence silencieuse garantie au prochain refactor | refactor 1.5 |

---

## MEDIUM (~25 findings) — résumé thématique

- **8 patterns dupliqués** : debounce inline ×6, volume-from-slider ×3, IDB error handling incohérent, art MIME allowlist ×2, `--card-min-w` no-op dans `@media 640px`, `--pl-shelf-*` tokens morts post-T8.
- **6 trous de types** : `CfgShape` absent (~35 champs), `VirtRow` discriminated union absent, `ZoomLevel` union absent, `_albumMapCache` entry shape implicite, JS mirror des structs Rust IPC absent, `tlistZoom`/`autoUpdate`/`lastSettingsTab` absents du typedef `AppState`.
- **5 fuites/cleanup partiels** : `_unlisteners` ne couvre que Tauri (pas DOM resize/error/mousemove), ResizeObserver/IntersectionObserver sans registry, listeners settings sans `AbortController` (réparé partiellement cette session), pas de versioning IDB, `subscribe()` jamais désabonné.
- **4 anti-patterns CSS** : `--pad-zone` token mort, `--bp-*` non utilisables dans `@media` (que des constantes documentaires), 18 tokens sémantiques `--surface-*`/`--fg-*`/`--tint-*` orphelins, `.tr` mixed magic numbers + tokens.
- **2 perf MEDIUM** : `artistMap` `new Set()` ×5000 (1.5 MB overhead), `getFiltered()` signature de cache fragile sur reorders.

---

## Comparaison HONNÊTE à Spotify desktop

Spotify desktop = CEF + React + Redux + TypeScript strict + sélecteurs mémoïsés + lazy par route + Sentry-like + feature flags + A/B framework + bundle analyzer + Web Workers pour search + AudioWorklet pour décode. ~300 ingénieurs full-time.

| Couche | Spotify | libreflow | Verdict |
|---|---|---|---|
| Typage | TS strict, codegen FE/BE | `@ts-nocheck` sur `app.js`, 11 % de couverture `@ts-check` | **3.5/10** |
| State | Redux + sélecteurs + time-travel | 3 sources (`tracks[]` + store + IDB) synchronisées à la main | **3/10** |
| Code splitting | lazy par route, chunks < 50 KB | tout chargé au boot, `style.css` 333 KB | **2/10** |
| Error boundaries | par feature + Sentry-like | 2 listeners globaux `error`/`unhandledrejection` + toast | **3/10** |
| Observabilité | OpenTelemetry, perf budgets enforced | `console.warn` + `CFG.DEBUG` | **2/10** |
| Migration IDB | versionnée transactionnelle | best-effort ad-hoc dans le code | **2/10** |
| Tests | unit + integration + e2e + visual diff | 271 unit + 22 visual + bench synthétique | **5/10** |
| Virtual scroll 1D | équivalent | `virt.js` maison, prefix-sum + binary search propre | **8/10** — **parité** |
| Virtual scroll 2D (grilles) | virtualisé | grilles plates `innerHTML = ...` sur N | **3/10** |
| Audio pipeline | AudioWorklet + crossfade engine maison | Web Audio + setTargetAtTime + crossfade JS | **7/10** |
| Sécurité IPC | typée + signed | Rust solide, JS aveugle | **5/10** |
| **MOYENNE PONDÉRÉE** | — | — | **~4/10** |

**Sur ce qui est bon :** le pipeline audio, le virtual scroll 1D, le `state.js` (mutations atomiques `pushTracks`/`removeTrackAt`/`replaceTracks`), `store.js` (re-entrancy guard, snapshot avant notify), `search.js` (mieux typé du codebase), la sécurité Rust (canonicalize + anti-symlink + cap image 10 MB). Ces 6 modules **sont au niveau d'un sénior Spotify**.

**Sur ce qui n'est pas bon :** l'orchestration. `app.js` est le god-module qui maintient tout ensemble par habitude humaine plutôt que par contrat. Spotify a 100 fois moins de discipline humaine dans son code et 100 fois plus de garde-fous statiques. C'est l'inverse de libreflow.

---

## Plan d'action priorisé — ce qu'un sénior ferait

### Sprint 0 — corriger les bugs runtime (1 semaine)

Corrigent l'essentiel de ce que l'utilisateur observe comme « ça marche pas » :

1. **R1-A** : ne pas émettre `RENDER_LIB` quand `tracks=[]` au boot — 1 garde dans `tlistZoom.js`.
2. **R2-A** : ajouter `_playLock` dans `_playDirect()`.
3. **R3-A** : préserver `listEl.scrollTop` autour de `innerHTML=` dans `virtRenderWindow`.
4. **R5-A** : `_artTrackById.clear()` quand caches album/artiste invalidés.
5. **PERF-CRIT-2** : remplacer `querySelectorAll('img')` dans `_evict` par Set maintenue.
6. **Bus events `track-prev`/`track-next`/etc.** : ajouter `console.warn` au lieu de `.catch(()=>{})` dans les `.catch` du player → fini les pannes silencieuses.

### Sprint 1 — clore les méta-patterns (2-3 semaines)

7. **Méta-1** : finir la migration store. Supprimer les 20 `subscribe('X', v ⇒ X = v)` d'`app.js`. Toute lecture de state passe par `get('X')`. Cible : app.js < 800 lignes.
8. **Méta-2** : créer les 5 types manquants (`CfgShape`, `VirtRow`, `ZoomLevel`, `EventPayloadMap`, `ActionKey`) dans `types.js`. Activer `@ts-check` sur `app.js`, `handlers.js`, `bus.js`, `renderer.js`, `virt.js`.
9. **Méta-3** : refactor `boot()` en phase machine (`bootstrap → restoreCfg → loadStores → firstRender → idlePrefetch`) avec préconditions explicites.
10. **Méta-4** : audit complet des `.catch(()=>{})` (l'agent silent-failures n'a pas pu finir 2 fois, signal en soi) — chaque catch doit soit toast soit `console.warn` un contexte exploitable.

### Sprint 2 — la dette de finition (1-2 semaines)

11. Supprimer `cdaudio_pure.cjs`, générer depuis `.js` en prebuild via esbuild.
12. Consolider `validYear` + `ART_MIME_ALLOWLIST` dans `utils.js`.
13. Nettoyer les 75 tokens CSS morts (groupe A : supprimer ou migrer, choisir).
14. Validation chemins JS (parité avec Rust) dans `dropin.js`/`m3u.js`/`watchfolder.js`.
15. Focus trap sur Queue/EQ (pattern de `_setupSettingsFocusTrap`).

### Sprint 3+ — viser le niveau « indie premium » (10-15 semaines)

16. Virtualisation 2D des grilles albums/artistes.
17. Web Worker pour `getFiltered()` / `virtBuildRows` quand >10k pistes.
18. Migrations IDB versionnées avec changelog.
19. Code splitting par feature (`features/{library, player, playlists, radio, cinema, eq, settings}/`).
20. Bundle analyzer dans CI + perf budgets enforced.

**Estimation totale :** ~6 semaines pour atteindre un niveau « indie premium » solide ; ~6 mois pour viser sérieusement le niveau Spotify desktop ; ~18 mois en équipe pour l'atteindre réellement.

---

## Conclusion honnête

Le projet n'est pas mauvais. Il n'est pas non plus au niveau Spotify, et la distance est mesurable : ~4/10 pondérée. La cause principale n'est pas un manque de talent — c'est un manque d'**enforcement par le code**. CLAUDE.md décrit l'app idéale ; le code décrit l'app réelle. L'écart entre les deux est la dette à payer.

Les findings concrets de cet audit (Top 10 CRITICAL + 18 HIGH + ~25 MEDIUM) sont tous **adressables**. Les méta-patterns sont **identifiables et clos** par 4 chantiers structurants. Le pipeline audio et le virtual scroll 1D prouvent que la qualité Spotify-niveau est **atteignable** sur certains modules — il reste à généraliser.
