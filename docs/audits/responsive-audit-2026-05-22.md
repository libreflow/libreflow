# Audit responsive — libreflow

**Date :** 2026-05-22
**Méthode :** 3 agents en parallèle — CSS layout/breakpoints, CSS modals/panneaux/mini-player, JS layout/resize
**Cadre :** application desktop Tauri, fenêtre redimensionnable. Défaut `1100×700`, **`minWidth: 600`, `minHeight: 400`** (`tauri.conf.json:66-69`). Le « responsive » couvre la plage **600×400 → plein écran**.

## Synthèse

| Sévérité | Count |
|---|---|
| 🔴 CRITICAL | 5 |
| 🟠 HIGH | 10 |
| 🟡 MEDIUM | 13 |
| ⚪ LOW | 9 |

## Les 3 racines systémiques

1. **La dimension VERTICALE n'est pas gérée.** Aucun `@media (max-height: …)` n'existe dans 7 279 lignes de CSS. Les modals n'ont ni `max-height` ni `overflow-y`. À `minHeight: 400`, plusieurs surfaces deviennent inaccessibles.
2. **Les panneaux latéraux (Queue/EQ) poussent `#main` sans plancher de largeur.** À 600px de fenêtre, ouvrir l'EQ expert réduit la bibliothèque à ~146px — inutilisable.
3. **Le JS ne réagit pas au redimensionnement.** Un seul listener `resize` dans tout le frontend (cinema). Le virtual scroll, Now Playing, le mini-overlay ne se recalculent pas.

**Point positif :** le **mini-player** (`mini.html`) est le module le mieux conçu — `container-type: inline-size` + `@container` + `@media (max-height)` + `ResizeObserver`. Aucun défaut CRITICAL/HIGH. À prendre comme modèle.

---

## 🔴 CRITICAL

### R-C1 — Modals sans `max-height` ni `overflow-y` → inaccessibles sous ~550px de haut
**Emplacement :** `#modal`/`#pl-modal` (`style.css:3339-3350`), `#confirm-modal` (3362), `#batch-tag-modal` (3544), `.prompt-modal` (3421), `#cd-modal`/`#organize-modal`/`#usb-modal`.
Ces modals fixent `width`/`max-width` (vw) mais **aucune gestion de hauteur**. Seules `.orphan-modal` (3440-3445) le font correctement. Pire cas : `#pl-modal` (Smart Playlist) — tabs + cover + 4 critères + grille 2×2 + règles + preview + 3 boutons. À 400px de haut, modal centrée (`align-items:center`) → **les tabs en haut et les boutons Créer/Annuler en bas sortent du viewport et deviennent inatteignables**.
**Correctif :** sur chaque conteneur modal : `max-height: calc(100vh - var(--sp-8)); overflow-y: auto;` (pattern de `.orphan-modal`). Pour `#pl-modal`, corps scrollable + tabs/boutons `sticky`.

### R-C2 — Aucun breakpoint `max-height` + panneau EQ déborde à 400px de haut
**Emplacement :** `#app` `grid-template-rows: var(--tb) 1fr var(--pb)` (`style.css:1454`) ; `#eq-panel` (4425-4440).
À `minHeight: 400` : `--tb (38) + --pb (96) = 134px` fixes → `#main` = 266px. Le panneau EQ expert empile header (~50) + presets (128) + courbe (160 fixe) + footer (~50) ≈ **388px pour 266px disponibles** → `.eq-bands` (sliders) comprimé à zéro / bandes débordantes. Aucun `@media (max-height:…)` n'existe pour atténuer.
**Correctif :** introduire des breakpoints `@media (max-height: 560px / 480px)` : réduire `--pb`/`--tb`, réduire `#eq-curve-wrap`, rendre presets/courbe collapsibles ; `overflow-y:auto` sur le conteneur EQ.

### R-C3 — Panneaux Queue/EQ poussent `#main` sans largeur de contenu minimale
**Emplacement :** `style.css:4460-4462` (`#app.panel-*-open #main { padding-right: min(--panel-w, calc(100vw - --sb - --sp-10)) }`).
À 600px / `--sb:54px` : `100vw - 54 - 48 = 498px`. EQ expert (400px) → `#main` = **146px** ; queue (300px) → `#main` = 198px. La grille `.tr` (`56px 1fr minmax(0,12em) auto`) s'effondre, la colonne `1fr` passe sous 0, le contenu chevauche. **Ouvrir l'EQ à 600px rend la bibliothèque illisible.**
**Correctif :** sous `@media (max-width: 720px)`, passer Queue/EQ en **overlay** (`position:fixed` + scrim, z-index dropdown) sans `padding-right` sur `#main`. Sinon, caper le push à `calc(100vw - var(--sb) - 320px)` pour garantir ≥320px de contenu.

### R-C4 — Virtual scroll : la fenêtre visible n'est jamais recalculée au resize vertical
**Emplacement :** `renderer.js:234-377` (`virtRenderWindow`/`virtAttachScroll`).
`viewH = listEl.clientHeight` et `endIdx` ne sont recalculés que sur `scroll` ou `renderLib()`. Aucun `resize`/`ResizeObserver` sur `#tlist`. Le delta-check `VIRT._lastWindowSig` court-circuite même un re-rendu à signature identique. **Agrandir la fenêtre verticalement → bande blanche en bas de la liste** jusqu'au prochain scroll. Viole CLAUDE.md §10 (« virtual scroll dépend strictement de la hauteur du viewport »).
**Correctif :** `ResizeObserver` sur `#tlist` dans `virtAttachScroll` (stocké `listEl._virtResizeObserver` pour réattache), callback debouncé via rAF → `VIRT._lastWindowSig = ''` puis `virtRenderWindow(getFiltered())`.

### R-C5 — Player bar : grille 3 colonnes sans `min-width:0` → colonne centrale clippée
**Emplacement :** `#pl { grid-template-columns: var(--shelf-w) 1fr var(--shelf-w) }` (`style.css:2668`, `--shelf-w:280px`).
`.pl-c`/`.pl-r` n'ont pas `min-width:0`. `.pl-prog` (`flex:1`) peut forcer un débordement de la colonne centrale ; `#pl` ayant `overflow:hidden`, les contrôles transport sont **clippés** au lieu de se réduire. Risque entre 900 et 960px (avant le breakpoint correctif 899px).
**Correctif :** grille en `minmax(0,var(--shelf-w)) minmax(0,1fr) minmax(0,var(--shelf-w))` + `min-width:0` sur `.pl-c` et `.pl-r`.

---

## 🟠 HIGH

- **R-H1 — Breakpoint `@media (max-width: 520px)` MORT** (`style.css:4269`). La fenêtre ne descend jamais sous 600px → tout le bloc `#pl-hero` 520px est inatteignable ; le token `--fs-vw-hero-sm` (`:496`) n'est utilisé que là. → remonter à 640/700px ou supprimer.
- **R-H2 — Breakpoints incohérents et trou de couverture.** 6 seuils non documentés (`899/880/719/700/640/520`). `880` et `899` à 19px d'écart sans raison ; la plage 600-640px (la plus contrainte) n'a quasi aucun ajustement. → définir une échelle canonique (`640 / 720 / 900` + `max-height`), supprimer `520` et `880`.
- **R-H3 — `.vh` en `flex-wrap: wrap` sans hauteur plafonnée** (`style.css:1737-1743`). À 600-700px (ou panneau ouvert), titre + tri + badges wrappent sur 2 lignes → `.vh` grandit et écrase la zone de liste. → masquer le libellé des `.sort-btn` (icône seule) à largeur étroite.
- **R-H4 — Now Playing : canvas plein écran jamais redimensionné** (`nowplaying.js:123-147`). `vnp-canvas` reçoit `width/height` uniquement dans `_applyNpBg`, jamais sur `resize`. Maximiser la fenêtre avec Now Playing ouvert → fond animé **étiré/flou**. → listener `resize` debouncé ré-appelant `_applyNpBg()` si ouvert.
- **R-H5 — Now Playing : `.vnp-bottom` en `position:absolute` recouvre l'artwork** (`style.css:6927-6970`). À 400px de haut, le bloc infos (absolu, `bottom:24px`, `flex-wrap`) se superpose à la pochette (`max-height:40vh=160px`). → layout flex-column en flux normal + `overflow-y:auto`.
- **R-H6 — Player bar `.pl-r` surchargée entre 720 et 900px** (`style.css:2930`, media 6736-6745). Volume + 4 boutons + `#sleep-indicator` (pilule à largeur variable) dans une colonne `minmax(120px,200px)` → débordement probable si la minuterie sommeil est active. → masquer `#sleep-indicator` aussi sous 900px.
- **R-H7 — `.tr` : la colonne album `minmax(0,12em)` disparaît brutalement à 899px** (`style.css:1858`, 2034). Entre 700-899px l'album (~192px) comprime titre/artiste alors qu'il devrait céder en premier ; `.tr-r` (`width:124px` fixe) ne se réduit jamais. → masquer `.ta` plus tôt (~760px) ou album `minmax(0,8em)` intermédiaire.
- **R-H8 — `#vw` (écran d'accueil) : padding en `%` + blobs en `vw`** (`style.css:2485,2498,2510`). Padding asymétrique `0 8% 0 10%` ; les cartes features ne sont retestées sous aucun breakpoint → débordement possible à 600px. → `clamp()`/unités fixes, vérifier `.wfeats` sous 700px.
- **R-H9 — Skeleton rows figés à la taille d'amorçage** (`renderer.js:646-659`). Nombre de lignes squelette calculé une seule fois → zone vide si la fenêtre est agrandie pendant le boot d'une grande bibliothèque. → recalcul dans le `ResizeObserver` de R-C4 tant que l'état skeleton est actif.
- **R-H10 — `scrollToCurrentTrack` peut viser une zone non rendue** (`virt.js:60`, `renderer.js:1290`). Après un resize non suivi de scroll (cf. R-C4), scroll vers une cible hors fenêtre rendue → flash de vide. Corrigé par le même `ResizeObserver` que R-C4.

---

## 🟡 MEDIUM

- **R-M1 — `#sel-bar`** (`style.css:5714-5746`) : barre de sélection `position:fixed; white-space:nowrap`, ~520-560px de large, jamais compactée → débordement hors viewport à 600px / avec i18n long. → icônes seules sous ~700px.
- **R-M2 — `#next-preview` / tooltips** (`style.css:2952-2973`, `#seek-tip`, `.vol-tip`) : popovers `left:50%` en px absolus, sans détection de collision ; `#pl` `overflow:hidden` les **clippe** près d'un bord. → `max-width: min(220px, 90vw)` + clamp de position.
- **R-M3 — Bloc `@media (max-width:640px)`** (`style.css:7250-7274`) : px bruts (`14px`, `80px`, `17px`…) hors échelle `--space-*`/`--text-*` ; `--card-min-w` redéfini inline. → recâbler sur tokens.
- **R-M4 — `.set-tabs` 200px fixe** (`style.css:4323`) : à 600px, mange 1/3 de la largeur du panneau Settings. Non cassé (`.set-content` scrolle) mais serré. → tabs en barre horizontale / icônes sous ~680px.
- **R-M5 — `#main` `1fr` sans `min-width:0`** (`style.css:1452-1456`) : un descendant `nowrap` large peut gonfler la piste grid avant que `overflow:hidden` ne clippe. → `#main { min-width: 0; }` (défense en profondeur).
- **R-M6 — Mini-overlay non re-clampé au resize** (`minioverlay.js:101-134`) : la position absolue n'est clampée que pendant le drag. Rétrécir la fenêtre après avoir placé l'overlay en bas-droite → overlay **hors écran et inatteignable**. → `resize` debouncé re-clampant `left/top`.
- **R-M7 — Canvas EQ : pas de `ResizeObserver`** (`eq.js:611-612`) : fallback hardcodé `260×116` ; la courbe ne se redessine pas si le wrap change de taille hors événement EQ.
- **R-M8 — Visualizer cinema** (`cinema.js:892`) : `clientWidth/Height` lus dans la boucle de rendu — vérifier que `applyCinemaBg` redimensionne aussi le canvas du visualizer (pas que le background).
- **R-M9 — `ambientRenderer`** (`ambientRenderer.js:36-37`) : `innerWidth/Height` lus à l'appel — correct seulement si rappelé après resize ; ne l'est pas pour Now Playing (cause partagée de R-H4).
- **R-M10 — Drill header : px littéraux** (`style.css:7100-7171`) : `gap:20px`, `padding:20px`, `.dh-art:120px`… hors tokens (dette §13).
- **R-M11 — Drill header artiste : rangée de mini-cartes** (`style.css:7187-7207`) : `overflow-x` correct, mais ~110px de hauteur s'ajoutent au header → peu d'espace liste à 400px. → réduire/masquer sous `@media (max-height:480px)`.
- **R-M12 — `.stats-cards` / `.heatmap-grid`** : `repeat(3,1fr)` (media 700px → 2 col, jamais 1) ; heatmap `repeat(28, minmax(10px,1fr))` (280px min, `overflow-x:auto`). Serré à 600px.
- **R-M13 — `.smart-criteria-grid` / `.spl-grid-2`** : `repeat(2,1fr)` fixe — dans `#pl-modal` à 600px chaque cellule ≈ 175px, tient mais à la limite.

---

## ⚪ LOW

- **R-L1 — Token `--t1` inexistant** (`style.css:7128,7147,7171,7219` — `.dh-name`, `.dh-artist-link`…). Le `:root` définit `--t/--t2/--t3/--t4` mais pas `--t1` → `color: var(--t1)` invalide, fallback `inherit`. Bug couleur (pas responsive) mais à corriger.
- **R-L2 — `.dh-play { color: #fff }`** (`style.css:7170`) : couleur littérale au lieu de `var(--text-on-accent)`.
- **R-L3 — `.dupes-badge`** (`style.css:1757-1772`) : magic numbers hors tokens.
- **R-L4 — `.card-play-btn`** (`style.css:2152`) : dimensions `40px/18px` brutes → `--icon-*`.
- **R-L5 — `.spl-results`/`.spl-preview-list`** (`style.css:3768`) : `max-height` fixes en px (scroll OK, dette tokens).
- **R-L6 — `vw`/`vh` en mode cinéma** (`--art-cinema-max`, `min(46vh,46vw,N)`) : `vw` inclut la scrollbar — impact nul en cinéma (pas de scroll), à documenter.
- **R-L7 — Mini-player : `--red`/`--red-rgb` non définis** dans le `:root` de `mini.html` (`.sys-btn.close`) — le fallback couvre `--red-rgb`, mais `var(--red)` sans fallback est invalide. Cosmétique.
- **R-L8 — Menus contextuels** (`ctxmenu.js:127`, `playlists.js:622/1153`) : clamp correct, mais fallbacks de dimensions hardcodés (`offsetWidth || 190`…) — risque faible.
- **R-L9 — Marquee player bar** (`playerbar.js:68-90`) : overflow mesuré une seule fois — un titre ne se réévalue pas si la fenêtre est élargie. Cosmétique.

---

## Plan de remédiation prioritaire

1. **Action verticale (couvre R-C1, R-C2, R-H5, R-M11)** — introduire les breakpoints `@media (max-height: 560px / 480px)` manquants ; `max-height` + `overflow-y:auto` sur tous les conteneurs modals ; Now Playing en flux normal scrollable.
2. **Action panneaux (R-C3, R-H6)** — Queue/EQ en overlay sous 720px, sans `padding-right` sur `#main` ; garantir un plancher de largeur de contenu.
3. **Action resize JS (R-C4, R-H4, R-H9, R-H10, R-M6, R-M9)** — `ResizeObserver` sur `#tlist` + un listener `window.resize` global debouncé centralisé (dans `app.js`) dispatchant vers Now Playing, mini-overlay, skeleton, marquee — sur le modèle de `cinema.js`.
4. **Action grille / player bar (R-C5, R-H3, R-H7)** — `min-width:0` sur les colonnes grid ; faire céder la colonne album avant le titre ; `.vh` sur une seule ligne.
5. **Hygiène breakpoints (R-H1, R-H2, R-M3)** — supprimer le 520px mort, consolider l'échelle, recâbler les px bruts sur les tokens.

> Note : le mini-player (`mini.html`) montre le bon pattern (container queries + `@media max-height` + `ResizeObserver`) — à généraliser au reste de l'UI.
