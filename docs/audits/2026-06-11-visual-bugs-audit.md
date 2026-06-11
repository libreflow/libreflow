# Audit bugs visuels — libreflow

**Date** : 2026-06-11 · **Agent** : @design-eng (orchestration) · **Méthode** : 5 audits statiques parallèles (stacking/overlays, layout/overflow/troncature, thème/couleurs, états & classes orphelines, canvas & rendu dynamique) + vérification croisée des findings majeurs par sondage.

**Périmètre** : working tree actuel (inclut les fixes non commités du GO FIX de ce matin). Complète l'audit qualité `2026-06-11-ui-quality-audit.md` — ici uniquement les **bugs visuels réels** (casse visible), pas la dette tokens déjà cataloguée.

> **✅ FIXES APPLIQUÉS (session « go », même jour)** : les 10 lots du plan d'action
> ont été implémentés — V1-V8, M1-M13, L1-L12 traités (M12 tranché côté
> suppression ; L8 doc seulement, le fallback rowBreath reste à recâbler si la
> breath sans pochette est souhaitée). Vérification : `npm test` 404/404,
> `vite build` vert, `npm run bench` sans régression, boot-theme.js présent
> dans dist. Détail par fichier dans `data/logs/2026-06-11-design-eng.md`.

---

## Synthèse

| Sévérité | Nombre | Dominantes |
|---|---|---|
| CRITICAL | 1 | Preview « piste suivante » clippée aux 2/3 à chaque survol |
| HIGH | 7 | Mini-overlay au-dessus du cinéma ; header sticky qui disparaît ; fix 0 dB mort ; titres Genre illisibles ; hue lighting sur la mauvaise pochette ; canvas flous au changement de DPR ; `hidden` inopérant pendant le rip CD |
| MEDIUM | 13 | 1 régression du GO FIX (transition d'accent à deux vitesses) ; flash de thème au boot ; `--accent-subtle` figé indigo en light ; couleur fabriquée sur pochettes N&B ; 2 animations entièrement débranchées |
| LOW | 12 | Nits (tokens fantômes, classes mortes, micro-shifts) |

**État des fixes du matin (GO FIX)** : 7/8 réellement en place et vérifiés (cycle `--g`↔`--accent`, swatches, bordures light ≥3:1, focus rings dual-tone, `.set-row:hover`, internals DS, blocs tokens rapatriés). **1 fix mort** (ligne 0 dB EQ, doublon de cascade) et **1 régression** (transition d'accent). `npm test` 404/404 vert.

---

## CRITICAL

### V1 — `#next-preview` clippée par `#pl { overflow:hidden }`
- `style.css:2096` (clip) vs `2430/2458` (position `bottom: calc(100% + var(--sp-2))` dans `#btn-next`).
- La carte (~48px) déborde au-dessus de la playerbar (96px) → **coupée aux 2/3 à chaque survol de ⏭**. Affichage 100 % CSS (`#btn-next:hover #next-preview`) ; le hack `.pbar:hover{overflow:visible}` (2353) ne couvre pas `#pl`. Le commentaire ligne 2109 documente même le clip.
- **Repro** : lecture en cours → survoler ⏭.
- **Fix** : `position:fixed` + coordonnées JS, ou déplacer le `overflow:hidden` sur un wrapper du canvas `#pl-viz`. ⚠️ En light, `backdrop-filter:none !important` supprime le stacking context de `#pl` — en tenir compte si on lève le clip.

## HIGH

### V2 — Mini-overlay `#mp-ov` (z 500) flotte au-dessus du mode cinéma (z 200)
- `style.css:5808` vs `4626` ; `cinema.js:225-245` ne le ferme pas ; raccourci `i` sans garde `!cinemaOpen` (`shortcuts.js:218`, contrairement à `f` ligne 216) ; restauré au boot (`app.js:600`).
- **Repro** : mini-overlay ouvert → mode cinéma → la vignette reste sur l'écran immersif ; `i` pendant le cinéma la fait apparaître.
- **Fix** : masquer `#mp-ov` dans `openCinema()` + garde sur `i`.

### V3 — Header de groupe sticky disparaît en plein scroll (sticky × virtualisation)
- `style.css:1640` (`.tr-grp` sticky) + `renderer.js:97` : dès que ~8 rows (le buffer) du groupe sont passées au-dessus du viewport, l'index du header sort de la fenêtre rendue → retiré du DOM → **le header collé pop-out** alors que son groupe remplit encore l'écran.
- **Repro** : tri artiste/album, groupe >15 pistes, scroller dedans.
- **Fix** : dans `virtRenderWindow`, reculer `startIdx` jusqu'au dernier `type==='grp'` ≤ `firstVisible` (scan arrière borné).

### V4 — Fix 0 dB EQ light : MORT (doublon de cascade)
- `style.css:4323` pose `rgba(0,0,0,.22)`… écrasé par la règle identique pré-existante `4324-4326` (`rgba(0,0,0,.16)`) — même sélecteur, plus tard dans la cascade. Vérifié par lecture directe.
- **Fix** : fusionner en une seule règle à ≥ `rgba(0,0,0,.42)` (cible 3:1 de l'audit du matin).

### V5 — Titres des cartes Genre quasi illisibles (les 2 thèmes)
- `.genre-name{color:var(--text-on-accent)}` (`style.css:1774`) = `#050505` + text-shadow noir (`design-system.css:963`) sur scrim `rgba(0,0,0,.75)` (1746). Meilleur cas ≈2:1, typique <1.5:1. `.genre-badge:1814` même misuse.
- **Fix** : `color:#fff` / token `--text-on-media` (le `--text-on-accent` noir est pour fond accent, pas fond scrim).

### V6 — Hue lighting now-playing échantillonne la pochette de la piste PRÉCÉDENTE
- `playerbar.js:211` : `if (_plImg && _plImg.naturalWidth) _doExtract();` — si la nouvelle image n'est pas décodée, la current request de `<img>` est encore l'ancienne pochette (`naturalWidth>0`, `complete===false`) → `drawImage` lit l'ancien bitmap → hue de N-1 appliqué à N **et caché en permanence** (`t._npHsl`).
- Aggravant (l.212) : listeners `load {once:true}` empilés sur skip rapide A→B→C → la closure B reçoit le HSL de C.
- **Repro** : enchaînement de pistes avec pochettes (quasi systématique).
- **Fix** : `_plImg.complete && _plImg.naturalWidth` + guard `if (get('curIdx') !== _p2Idx) return` dans `_doExtract` avant d'écrire le cache.

### V7 — Changement de DPR (multi-écrans Windows) jamais détecté → canvas flous
- Aucun `matchMedia('(resolution…)')` dans le projet. Pire cas `cinema-viz.js:33` (dpr figé à l'ouverture, le check resize l.317 ne compare que les px CSS) ; `oscPremium.js:60-71` et `viz.js:114-121` (dpr relu seulement si la taille CSS change) ; `cinema-bg.js:143`/`nowplaying.js:141` partiellement mitigés par l'event window resize.
- **Repro** : écrans 100 %/150 %, glisser la fenêtre pendant la lecture.
- **Fix** : relire `devicePixelRatio` dans la boucle/au resize et l'inclure dans la condition de recalcul du backing store.

### V8 — `#cd-actions` : `hidden` inopérant pendant le rip CD
- `cdaudio.js:313/321` pose `hidden`, mais `.modal-btns{display:flex}` (`style.css:2768`) bat la règle UA `[hidden]`. Aucune règle `[hidden]` dans le CSS (vérifié : 0 occurrence).
- **Repro** : lancer un rip → les boutons restent superposés à la barre de progression.
- **Fix** : `[hidden]{display:none!important}` dans design-system.css.

---

## MEDIUM

### Régression du GO FIX
1. **Transition d'accent « à deux vitesses »** — la fusion des deux `transition` de `:root` (DS:1085) a ressuscité l'animation 0.8s de `--g`, mais `--g-rgb/--gd/--gg` (non typés `@property`) snappent : pendant 0.8s tout gradient mixant les deux est bicolore (`.cf-slider` 3782, `.vslider` 2451, `--mini-glow` DS:1078) + « glide » d'accent visible au boot. **Fix** : `@property` couleur pour `--gd`/`--gg`, ou retirer `--g` de la transition `:root`.

### Thème / boot
2. **Flash of wrong theme au boot** — `index.html` sans `data-mode`/`data-theme` statique ; `setMode()`/`applyTheme()` après lecture IDB async (`app.js:313-317`). Premier paint = dark indigo pour tout utilisateur light/non-indigo, suivi du morph 0.8s. **Fix** : mirror localStorage + script inline `<head>`.
3. **`--accent-subtle` figé indigo en light** — DS:390 (spécificité 0,1,1) écrase l'alias `var(--gd)` de DS:752 → en light + thème non-indigo, ~18 états actifs (`.pc.on`, `.queue-item.active`, `.eq-mode-btn.active`…) gardent un fond indigo. **Fix** : `--accent-subtle:var(--gd)` dans le bloc light.
4. **Couleurs sémantiques light** — `--amber` ≈2.1:1 sur fond light (`.dupe-group-head` 5332, `.ctx-item.smart` 3261, `.pqp-item--smart` 2659, étoile inline `playlists.js:323`) ; `--red` texte danger ≈3.8:1. **Fix** : assombrir dans le bloc light DS.

### Canvas / dynamique
5. **Pochette monochrome → rouge fabriqué** — `artcolor.js:183-185` clamp `sat≥35%` sur h=0/s=0 → halo rouge arbitraire sur albums N&B ; PNG transparents traités comme noirs (alpha ignoré). **Fix** : `if (s < 0.05) return null` (fallback tokens).
6. **Fuite `--np-*` si extraction échoue** — `playerbar.js:203-215` : la branche `t.art` n'appelle jamais `_clearNpHsl()` → couleur de la piste précédente conservée. **Fix** : `_clearNpHsl()` en tête de branche.
7. **Cinéma : flash de pochette intermédiaire sur skip rapide** — `cinema.js:584` : `_cinSwapOutTimer` écrasé sans `clearTimeout` → A→B→C fait flasher B + Ken Burns ×2 + crossfade ambient ×2. **Fix** : `clearTimeout(_cinSwapOutTimer)` avant.
8. **Now Playing : fond ambient figé après minimisation** — `nowplaying.js:106-110` tue la boucle sur `document.hidden` sans handler `visibilitychange` (cinema.js en a un, l.776-784). **Fix** : relancer via `visibilitychange`.

### Layout / zoom
9. **Skeleton rows : drift en zoom compact** — `renderer.js:341` calcule le nombre de squelettes sur `CFG.VIRT_ROW_H` (48) mais les `.tr-skel` font `var(--tr-h)` (36 en compact) → ~25 % du viewport vide au boot. **Fix** : `VIRT.ROW_H`.
10. **PageUp/PageDown figés au zoom normal** — `keynav.js:183` : `CFG.VIRT_ROW_H` statique au lieu de `VIRT.ROW_H` → saut ~25 % trop court en compact, trop long en comfortable. **Fix** : `VIRT.ROW_H || CFG.VIRT_ROW_H`.
11. **`.tr.editing` peint au-dessus du header sticky** — `style.css:2612` (z 2) vs `.tr-grp:1640` (z 2) : à z égal l'ordre DOM gagne → la row éditée chevauche le header collé en scrollant. **Fix** : `.tr-grp{z-index:3}`.

### États débranchés
12. **`animateViewChange()` morte des deux côtés** — `renderer.js:464-478` toggle `.view-in` : aucun CSS, aucun call site (importée `app.js:94`). Idem **`animateArtChange()`** (`settings.js:400-408`, `.art-change`, importée `app.js:76`, jamais appelée, aucun CSS). **Fix** : brancher + écrire les keyframes, ou supprimer (code mort).
13. **`.sleep-opt.active` jamais posé** — CSS prêt (`style.css:2578` + light :591), mais `sleep.js:60` ne fait que `remove('active')` — aucune durée sélectionnée n'est surlignée à la réouverture du menu. **Fix** : `add('active')` sur l'option correspondante dans `setSleepTimer`.

---

## LOW

1. `--time-min-w:32px` : « 10:00 » dépasse → micro-shift de la pbar au passage 9:59→10:00 (`design-system.css:633`, `.pt` 2344). Fix : 40px.
2. `.grp-lbl` orphelin (style.css:1254-1260, z-incohérent) + commentaire du `scroll-padding-top` (1689-1692) qui le cite à tort. Confirmé par 2 agents.
3. `--z-player:900` jamais consommé — `#pl` est à z-auto (DS:1045). Token mensonger.
4. `queue-ghost--promote` togglé (`queue.js:532`) sans aucune règle CSS — la distinction visuelle promotion/reorder n'existe pas.
5. `.queue-item.act` (light only, :570) et `.queue-item.active` (:3948) : jamais posés par le JS — règles mortes (symptôme d'un highlight de piste courante jamais branché dans la file).
6. `art-dark` togglé (`ambient.js:29`) sans consommateur CSS (`.art-light` en a 5).
7. `.card-art.loading` (1322) jamais posé — le shimmer des cartes de grille n'existe pas (`card-art-ph` statique à la place).
8. Fallback rowBreath mort — `var(--art-color, var(--np-color))` (1289) : `--art-color` est une `@property` avec initial-value → toujours définie → fallback inerte ; doc DS:150 fausse.
9. `.eq-bar-flat` blanc .15 et `.eq-bar-cut` rgba hardcodé (style.css:130) sans override light — indicateurs par appareil invisibles en light.
10. Boutons `#vnp` (`.vnp-back`/`.vnp-full-btn`, 6420/6443) fond blanc .12 non inversé par `.art-light` alors que le scrim passe blanc .38 — cercle invisible sur pochette claire.
11. `--np-*` jamais nettoyés à l'arrêt (`playerbar.js` : early return avant `_clearNpHsl`) — sans impact visible aujourd'hui (hairline gated par `:has(.pcplay.playing)`).
12. `viz.js:120-121` reset le backing store sans test d'égalité → trail oscillo coupée 1 frame à chaque resize du panneau. Pattern correct dans oscPremium à copier.

---

## Vérifications croisées & zones saines (preuves aux rapports d'agents)

- **Drift CSS↔JS virtual scroll** : sain — CFG 36/48/60 == `--tr-h`, GRP_H 28 == height inline ; le diff récent virt.js/renderer.js est purement perf (parts[], `_artBatch`, `_fiToRowIdx`), zéro incidence de positionnement.
- **Troncature** : rows, playerbar (grid `minmax(0,…)` + marquee à fallback ellipsis), queue, cinema, mini-player, modales — chaîne `min-width:0`/ellipsis complète partout.
- **Overlays** : backdrops tous `fixed inset:0` ; hiérarchie modale 800→950 cohérente ; ctx-menus/sleep ferment sur outside-click ; queue-ghost appendu sur `body` (échappe au `translateX` du panneau) ; toasts au-dessus de tout.
- **Artwork** : `aspect-ratio:1` + `object-fit:cover` partout, pas de layout shift.
- **Scrollbars/responsive** : `scrollbar-gutter:stable`, un scroller par vue, breakpoints 720→480 + container queries, minWidth 600 documentée.
- **Invariant `aria-current`↔`.act`** : exact (`renderer-track.js:127-146`), `playing-row` restauré après chaque `innerHTML`, ordre TRACK_CHANGE correct.
- **Canvas** : double-boucle rAF gardée partout, données dégénérées (silence/NaN/durée 0) gardées, contexte réappliqué après reset, trails light OK, `getContext` null gardé.
- **Animations re-déclenchables** : `popping`, `eq-band-reset`, `beat`, `shake` — tous correctement nettoyés.
- **GO FIX vérifié en place** : cycle accent cassé (littéraux + `@property`), swatches unifiés sur `var(--g)`, bordures light .45/.55/.65 monotones testées ≥3:1, focus rings dual-tone restaurés (`.tr`, sliders, inputs, contenteditable), `--sp-7/7h/8`→32px, blocs tokens rapatriés en DS.

---

## Plan d'action priorisé

| # | Action | Findings | Effort |
|---|---|---|---|
| 1 | Lever le clip de `#next-preview` (fixed ou wrapper viz) | V1 | S |
| 2 | Fusionner le doublon 0 dB à ≥.42 + fermer `#mp-ov` dans `openCinema()` + garde `i` + règle `[hidden]` globale | V4, V2, V8 | S |
| 3 | Guards image dans playerbar (`complete` + curIdx) + `_clearNpHsl` + clamp sat artcolor + clearTimeout cinéma | V6, M5, M6, M7 | S |
| 4 | Pin du header de groupe dans `virtRenderWindow` | V3 | M |
| 5 | `--text-on-media` pour Genre + `--accent-subtle` light + `--amber/--red` light + eq-bar light | V5, M3, M4, L9 | S |
| 6 | DPR-aware resize sur les 4 canvas | V7 | M |
| 7 | Transition d'accent : typer `--gd/--gg` ou désanimer `--g` ; script inline anti-FOWT | M1, M2 | S-M |
| 8 | `VIRT.ROW_H` dans skeleton + keynav ; `.tr-grp` z 3 | M9, M10, M11 | S |
| 9 | Trancher les features débranchées (animateViewChange/ArtChange, sleep-opt, queue-promote, queue.act) : brancher ou supprimer | M12, M13, L4, L5 | M |
| 10 | Purge des morts : `.grp-lbl`, `--z-player`, `art-dark`, `.card-art.loading`, fallback rowBreath, `--time-min-w` 40px | LOW | S |
