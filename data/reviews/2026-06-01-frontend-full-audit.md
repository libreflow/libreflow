# Audit complet frontend -- libreflow

**Date:** 2026-06-01
**Branche:** feat/search-mode-premium
**Scope:** 70 fichiers -- frontend/src/*.js + frontend/src/components/ + frontend/src/*.css
**Agents:** @reviewer, @audio-eng, @perf-eng, @js-dev, @design-eng (6 domaines paralleles)
**Tests:** npm test 378/378 GREEN | cargo check GREEN

---

## Verdict global : BLOCK

4 CRITICAL | 18 HIGH | 20 MEDIUM | 13 LOW

---

## CRITICAL

### C-1 -- organize.js : IPC sans timeout sur operations FS non bornees
**Fichier :** frontend/src/organize.js:129,159

invoke('organize_files', ...) utilise le timeout par defaut. Sur un rename de centaines
de fichiers, le timeout peut expirer alors que le Rust a deja renomme N/M fichiers.
La memoire JS pointe toujours les anciens chemins, aucun rollback n'est declenche.
**Fix :** { timeout: 0 } sur la ligne 159 (meme pattern que pick_audio_file).

### C-2 -- backup.js : IPC sans timeout sur serialisation grande bibliotheque
**Fichier :** frontend/src/backup.js:74,109

Sur 50k pistes, le JSON round-trip depasse le timeout par defaut. import_backup est
particulierement dangereux : IDB est ecrit APRES l'invoke. Timeout silencieux = pas
de backup, pas de message actionnable.
**Fix :** { timeout: 0 } sur les deux appels.

### C-3 -- app.js depasse le hard cap
**Fichier :** frontend/src/app.js -- 1071 lignes (cap: 800, CLAUDE.md 16)

boot() approx 360 lignes, clearLibrary() approx 120 lignes.
**Fix :** extraire boot.js et library-reset.js.

### C-4 -- i18n.js depasse le hard cap ET viole section-6
**Fichier :** frontend/src/i18n.js -- 1554 lignes + imports feature-modules (lignes 7-11)

Importe settings.js, player.js, renderer.js. Double violation : hard cap (1554 vs 800)
et section-6 (tout le cablage cross-module passe par app.js).
**Fix :** extraire locales/fr.js + locales/en.js, deplacer les side-effects vers app.js
via bus event LANG_CHANGED.

---

## HIGH

### H-1 -- player.js : .value = direct sur AudioParam en vie (zipper noise)
**Fichier :** frontend/src/player.js:858,863,878,964,1016-1019

clearCrossfadeTimers() et _resetGains() assignent .gain.value = sur des GainNodes
actifs. CLAUDE.md section-9 interdit toute assignation directe.
**Fix :** setTargetAtTime(val, ctx.currentTime, 0.01) sur toutes les lignes concernees.

### H-2 -- replaygain.js + artLoader.js : fetch() interdit (section-15)
**Fichiers :** frontend/src/replaygain.js:120 | frontend/src/artLoader.js:271
- replaygain.js:120 : fetch(t.url) sur asset: -- local mais viole le ban explicite.
- artLoader.js:271 : fetch(t.art) sur blob: -- fallback migration reachable.
**Fix :** IPC command Rust pour replaygain ; supprimer branch blob dans artLoader.

### H-3 -- renderer.js : classList.toggle duplique (logic bug)
**Fichier :** frontend/src/renderer.js:1247-1248
Ligne 1248 est un exact doublon de 1247. Code mort introduit par ce diff.
**Fix :** supprimer la ligne 1248.

### H-4 -- handlers.js : addEventListener hors AbortController (pas de cleanup)
**Fichier :** frontend/src/handlers.js:94
document.addEventListener('click', _burgerOutside, true) -- niveau module, jamais nettoye.
Accumule sur chaque HMR reload. Tous les autres listeners utilisent { signal: ac.signal }.
**Fix :** deplacer dans registerHandlers() avec { signal }.

### H-5 -- Burger panel : pas de focus trap ni restauration de focus
**Fichiers :** index.html:41 + modal.js:101-109 + shortcuts.js:174-179
#tb-burger-panel (role="menu") absent de installAutoFocusTrap. Tab fuit hors du panel.
Escape ferme sans restaurer le focus. WCAG 2.4.3 + 2.1.2.
**Fix :** focus restoration sur close (tbt-burger.focus()).

### H-6 -- renderer.js depasse le hard cap
**Fichier :** frontend/src/renderer.js -- 1410 lignes
**Fix :** extraire gridRenderer.js, statsRenderer.js.

### H-7 -- playlists.js depasse le hard cap + import circulaire
**Fichier :** frontend/src/playlists.js -- 1489 lignes
Import circulaire : playlists.js:42 -> smartplaylist.js:25 -> playlists.js.
TDZ crash potentiel selon le bundler.
**Fix :** extraire playlists-dnd.js, playlists-modal.js, playlists-nav.js.
Couper le cycle via bus events.

### H-8 -- Cross-module imports feature <-> feature (section-6)
Violations recensees :
- radio.js:30 -> playlists.js
- smartplaylist.js:25 -> playlists.js (circulaire avec H-7)
- tagedit.js:26 -> queue.js
- m3u.js:19 -> playlists.js
- genres.js:26 -> library.js
- orphans.js:21 -> library.js
- selection.js:31 -> playlists.js
- i18n.js:7-11 -> settings.js, player.js, renderer.js
**Fix :** bus.js events ou injection via app.js.

### H-9 -- radio.js : rollback sans notify apres splice
**Fichier :** frontend/src/radio.js:526-535
Apres un echec IDB, playlists.splice() sans notify('playlists'). Playlist fantome
visible dans la sidebar jusqu'a la prochaine re-render non liee.
**Fix :** notify('playlists') + renderPlNav() apres le rollback.

### H-10 -- cinema.js depasse le hard cap + prefersReducedMotion absent des rAF
**Fichier :** frontend/src/cinema.js -- 1277 lignes
Ken Burns, ambient loop, spectrum visualiseur ignorent prefersReducedMotion(). WCAG SC 2.3.3 + CLAUDE.md section-2.
**Fix :** extraire cinemaViz.js + cinemaAmbient.js. Garde prefersReducedMotion() dans
_startKenBurns, _startAmbientAnim, _startViz.

### H-11 -- ambientRenderer.js : 4-6 CanvasGradient crees par frame
**Fichier :** frontend/src/ambientRenderer.js:81,124-164
120-180 allocations/s a 30fps. Viole "zero allocations dans la render loop" (CLAUDE.md section-10).
**Fix :** cache AMOLED branch (comparer ax + colorStr). Branch ambient : documenter ou hacher.

### H-12 -- design-system.css : double definition z-index contradictoire
**Fichier :** frontend/src/design-system.css:295-302 vs 1006-1012
Section-9 et section-13 definissent les memes tokens avec des valeurs differentes.
La cascade applique section-13. --z-raised (10) et --z-player (600) definis uniquement
en section-9 resolvent a 0.
**Fix :** supprimer le bloc section-9, integrer --z-raised et --z-player dans section-13.

### H-13 -- design-system.css : --text-display redefini en valeur fixe
**Fichier :** frontend/src/design-system.css:164 vs 434
--text-display: clamp(28px, 4vw, 48px) (section-3) ecrase par --text-display: 32px (section-13).
**Fix :** renommer en --fs-disp-32 ou supprimer la redefinition.

### H-14 -- watchfolder.js : validation path incomplete
**Fichier :** frontend/src/watchfolder.js:186
_isValidFolderPath() ne rejette pas les null bytes (\0) ni les caracteres de controle.
isSafePath() (utils.js) couvre ces cas et est deja importee.
**Fix :** remplacer _isValidFolderPath par isSafePath a la ligne 186.

### H-15 -- ui.js : esc() duplique -- deux sources de verite sur une fonction securite
**Fichier :** frontend/src/ui.js:19-21
Meme implementation que utils.js#esc. Si utils.js est renforce, ui.js reste en retard
silencieusement. devices.js importe esc depuis ui.js.
**Fix :** supprimer de ui.js, re-exporter depuis utils.js.

### H-16 -- tagedit.js : write_tags sans timeout override
**Fichier :** frontend/src/tagedit.js:215
Write FLAC sur disque lent peut depasser CFG.IPC_TIMEOUT_MS. IDB deja ecrit avant l'invoke.
**Fix :** { timeout: 15000 } (aligne sur selection.js:465).

### H-17 -- player.js depasse le hard cap
**Fichier :** frontend/src/player.js -- 1276 lignes
**Fix :** extraire crossfade.js (~280 lignes, 782-1062), mediasession.js (~55 lignes).

### H-18 -- style.css + lf-toast-stack.js : z-index hardcodes
**Fichiers :** style.css:31,67 | lf-toast-stack.js:45
- style.css:31 : z-index:9999 (.skip-link) -> var(--z-tooltip)
- style.css:67 : z-index:99999 (#boot-spinner) -> calc(var(--z-tooltip) + 1)
- lf-toast-stack.js:45 : z-index:9999 -> var(--z-toast, 9000)

---

## MEDIUM (20 items)

| # | Fichier | Description |
|---|---------|-------------|
| M-1 | app.js:boot | radioRefillQueue() non appele avant updateBar() au boot si radioActive |
| M-2 | db.js:120,133 | Magic number 8000 -- utiliser CFG.IDB_TIMEOUT_DEFAULT |
| M-3 | app.js:clearLibrary | Fonction ~120 lignes (cap 50) |
| M-4 | cfgsave.js:34-46 | Import de 10 modules feature -- dette architecturale section-6 |
| M-5 | player.js:256 | console.error -> console.warn (standard projet) |
| M-6 | eq.js + replaygain.js | .value = init AudioParam non documente (exception legitime non commentee) |
| M-7 | playerbar.js:135 | innerHTML avec extEmoji() -- pattern fragile |
| M-8 | replaygain.js:70 | Branche else if (rgGainNode) unreachable -- code mort |
| M-9 | views.js:439,451,463,487,497 | .onclick = au lieu du pattern data-action |
| M-10 | tlistZoom.js:59 | TLIST_ZOOM_ROW_H non source de CFG.VIRT_ROW_H (section-2 invariant) |
| M-11 | ctxmenu.js:233 | .catch(() => {}) avale silencieusement l'erreur clipboard (section-14) |
| M-12 | smartplaylist.js:289,436 | maxSize sans borne inferieure (0 ou negatif silencieux) |
| M-13 | m3u.js:212 | Nom playlist sans cap de longueur (section-13) |
| M-14 | backup.js:137-150 | Pas de validation schema sur records importes (id, path requis) |
| M-15 | cinema.js:833 | innerHTML avec extEmoji() -- pattern fragile |
| M-16 | cinema.js:1062 | usedBins dead variable dans la boucle rAF |
| M-17 | artcolor.js:68-82 | Canvas de sampling non libere (c.width = c.height = 0) |
| M-18 | devices.js:121-183 | Messages toast hardcodes FR sans i18n() |
| M-19 | cdaudio.js:229 | Erreur Rust brute exposee a l'utilisateur |
| M-20 | lf-toast-stack.js:297 | aria-label="Fermer" hardcode FR (section-18 i18n) |

---

## LOW (13 items)

| # | Fichier | Description |
|---|---------|-------------|
| L-1 | views.js:339-543 | setView() 204 lignes (cap 50) |
| L-2 | renderer.js:682-691 | Skeleton rows sans height explicite pour zoom non-default |
| L-3 | view-transition.js:9,23 | DUR_MS = 200 magic number |
| L-4 | cinema.js | Beat-detector state realloue a chaque openCinema -- hisser a module scope |
| L-5 | cinema.js | Canvas cross-fade snapshot non libere apres fondu |
| L-6 | player.js:checkCrossfade | Fonction 145 lignes (cap 50) |
| L-7 | tags.js | readTags export mort (~210 lignes bundle inutile) |
| L-8 | playlists.js | _plHeroInlineRename exporte avec _ prefix (convention incoherente) |
| L-9 | motion.js:91 | gsap.set({}) reduced-motion non commente |
| L-10 | design-system.css:422 | transition: --g dans :root sans commentaire explicatif |
| L-11 | sleep.js:82 | Emoji hardcode -- devrait passer par i18n |
| L-12 | stats.js:225,245,248 | Magic numbers gap heatmap |
| L-13 | lf-toast-stack.js:38,57,64 | 8px, 14px, 16px hardcodes -- utiliser --space-* / --text-* |

---

## Recap par domaine

| Domaine | CRITICAL | HIGH | MEDIUM | LOW | Verdict |
|---------|----------|------|--------|-----|---------|
| Core/Boot/IPC | 2 | 3 | 3 | 2 | BLOCK |
| Audio pipeline | 0 | 3 | 4 | 2 | WARN |
| UI/Views/Virt | 0 | 4 | 5 | 4 | WARN |
| Features | 2 | 4 | 4 | 3 | BLOCK |
| Canvas/Motion | 0 | 5 | 5 | 3 | WARN |
| CSS/Utils/Lit | 0 | 5 | 4 | 3 | WARN |
| TOTAL (70 fichiers) | 4 | 24 | 25 | 17 | BLOCK |

---

## Actions prioritaires

1. [C-1, C-2] { timeout: 0 } sur organize.js:159 et backup.js:74,109
2. [H-3] Supprimer classList.toggle duplique renderer.js:1248
3. [H-1] Corriger .value = live sur player.js:858,863,878,1016-1019
4. [H-12, H-13] Consolider tokens z-index + --text-display dans design-system.css
5. [H-14, H-15] _isValidFolderPath -> isSafePath ; dedup esc() ui.js -> utils.js
6. [H-2] Supprimer fetch() dans replaygain.js et artLoader.js
7. [H-4] Listener burger dans registerHandlers() avec { signal }
8. [H-9] notify('playlists') apres rollback dans radio.js
9. [C-3, C-4, H-6, H-7, H-10, H-17] Plan split modules oversize (milestone dedie)
10. [H-8] Plan desimbrication cross-module imports -> bus events (milestone dedie)
