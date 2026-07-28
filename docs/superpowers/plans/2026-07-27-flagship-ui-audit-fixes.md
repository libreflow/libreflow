# Flagship UI Audit Fixes — Implementation Plan

> **STATUT (2026-07-27) : EXÉCUTÉ.** Les 22 tâches sont appliquées dans le working
> tree (non commitées — la branche portait déjà du travail non commité).
> Écarts documentés : (1) fills one-shot stats/scan/watchfolder laissés en
> `transition: width` (pas d'écriture 60fps, conversion scaleX non rentable) ;
> (2) re-séparation des tiers typo fusionnés (--fs-subhead vs --fs-body) DIFFÉRÉE
> — les annotations sont corrigées, changer les valeurs exige une vérification
> visuelle ; (3) le ripple est RÉEL (ui.js initRipple) contrairement au rapport
> d'audit — conservé, override light ajouté. Tests : 1540/1542 (2 KO préexistants
> CINEMA_PROGRESS, branche cinema-overhaul), A11Y 70/70, THEME-PALETTE 40/40.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer les 3 phases d'améliorations issues de l'audit design du 2026-07-27 (quick wins flagship, cohérence/navigation, assainissement design system) pour amener LibreFlow au niveau Spotify/Deezer.

**Architecture:** Modifications frontend uniquement (HTML/CSS/vanilla JS). Aucun nouveau composant Lit, aucune dépendance, aucun changement IPC/Rust. Les changements respectent les invariants CLAUDE.md §2 (aucune mutation `tracks[]`, aucun accès audio.volume, IDB inchangé).

**Tech Stack:** Vanilla ESM JS, CSS custom properties (design-system.css source unique), Vite 8.

## Global Constraints

- Aucun `fetch`/réseau, aucune font externe (CLAUDE.md §12/§15).
- Aucun `transition: all` ; transitions transform/opacity de préférence ; tokens `--motion-*` (agents.md).
- WCAG 2.2 AA/AAA : cibles ≥24px (`--target-min`), focus ring double-tone conservé, `aria-*` maintenus (CLAUDE.md §2.9).
- Tag content jamais en `innerHTML` non échappé — utiliser `esc()` existant.
- Baseline tests : 1540 OK / 2 KO préexistants (bus CINEMA_PROGRESS, branche cinema-overhaul). Aucune nouvelle régression tolérée.
- **Pas de commits** : l'arbre de travail contient des modifications non commitées préexistantes (branche `feat/cinema-overhaul`) ; commiter mélangerait ce travail. Les changements restent dans le working tree ; l'utilisateur commitera.
- Vérification après chaque groupe : `npm test` (frontend/), et re-lecture visuelle des règles CSS modifiées.

---

## PHASE 1 — Quick wins flagship

### Task 1: Réparer le système d'ombres (§7 vs §13)

**Files:** Modify: `frontend/src/design-system.css`

Le bloc §7 (lignes ~245-255, `--shadow-sm/md/lg` réels) est mort — écrasé par §13 (`--shadow-sm/md/lg/xl → --elev-*` tous transparents). Les modales/dropdowns ne peignent aucune ombre.

- [ ] Supprimer le bloc §7 mort (garder un commentaire de renvoi vers §13).
- [ ] Dans §13, donner de vraies valeurs aux ombres des surfaces FLOTTANTES (les `--elev-*` restent transparents pour les surfaces en flux — doctrine Spotify conservée) :
```css
--shadow-sm:  0 1px 3px rgba(0,0,0,.25);
--shadow-md:  0 4px 12px rgba(0,0,0,.30);
--shadow-lg:  0 8px 24px rgba(0,0,0,.35);
--shadow-xl:  0 16px 48px rgba(0,0,0,.45);
--shadow-pop: var(--shadow-md);   /* remplace le littéral .sb-more-pop */
--shadow-modal2: var(--shadow-lg);
--shadow-modal3: var(--shadow-xl);
```
- [ ] Remplacer le littéral `style.css:980` (`.sb-more-pop { box-shadow: 0 4px 16px rgba(0,0,0,.32) }`) par `var(--shadow-pop)`.
- [ ] `npm test` — vérifier theme-palette/token-source verts.

### Task 2: Cross-fade play/pause

**Files:** Modify: `frontend/src/player.js:272-291`, `frontend/index.html` (#pcplay, #cinema play btn), `frontend/src/style.css`, `frontend/src/cinema.js:426-432`

`setIcon()` toggle `style.display` brutalement. `.pcplay` reçoit déjà la classe `.playing` (player.js:287).

- [ ] index.html : retirer `style="display:none"` de `#ico-pause` (et équivalent cinéma) — l'état par défaut devient piloté par CSS.
- [ ] CSS : empiler les deux SVG (`grid-area 1/1` ou position absolute) et cross-fader :
```css
.pcplay { display: grid; place-items: center; }
.pcplay > svg { grid-area: 1 / 1; transition: opacity var(--dur-fast) ease, transform var(--dur-fast) var(--spring); }
.pcplay:not(.playing) #ico-pause, .pcplay.playing #ico-play { opacity: 0; transform: scale(.55); pointer-events: none; }
```
- [ ] player.js `setIcon()` : supprimer les 2 lignes `style.display` pour #ico-play/#ico-pause (la classe `.playing` suffit). Appliquer le même mécanisme au bouton cinéma (classe sur le bouton parent, retirer les toggles display cinema-ico-*).
- [ ] Vérifier qu'aucun test ne greppe les lignes supprimées (`grep -rn "ico-play" frontend/tests/`).
- [ ] `npm test`.

### Task 3: Hit-areas pbar + volume

**Files:** Modify: `frontend/src/style.css` (~:2349 .pbar, ~:2452 .vslider)

- [ ] `.pbar { position:relative; }` (si absent) + `.pbar::before { content:''; position:absolute; inset:-10px 0; }` — zone de clic 23px sans changement visuel. Vérifier que `.pbar` n'a pas `overflow:hidden` qui clipperait (le fill est un enfant ; si oui, clipper sur `.pfill` via border-radius).
- [ ] `.vslider` : hauteur de piste conservée, zone étendue via `padding-block: 10px; background-clip: content-box;` (ou input range wrapper). Tester le rendu du thumb.
- [ ] `#seek-tip { font-variant-numeric: tabular-nums; }`.
- [ ] `npm test`.

### Task 4: Barre Play/Aléatoire sur Tous les titres / Favoris / Récents

**Files:** Modify: `frontend/index.html` (#vlib après .vh), `frontend/src/views.js`, `frontend/src/style.css`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`

Les actions existent déjà : `dh-play-all` / `dh-shuffle-all` (handlers.js:155-156) opèrent sur `getFiltered()`.

- [ ] index.html : après `.vh` de #vlib, insérer :
```html
<div id="lib-action-bar" class="lib-action-bar">
  <button class="fab-play" data-action="dh-play-all" aria-label="Tout lire" data-i18n-aria="lib_play_all">
    <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 21 12 7 20" fill="currentColor"/></svg>
  </button>
  <button class="lib-shuf-btn" data-action="dh-shuffle-all" aria-label="Lecture aléatoire" data-i18n-aria="lib_shuffle_all">
    <svg><!-- shuffle SVG identique à #pc-shuf --></svg>
  </button>
</div>
```
- [ ] CSS `.fab-play` : 48px rond, `background var(--g)`, `color var(--text-on-accent)`, hover scale 1.04 + glow `--gg`, active scale .96, focus-visible ring. `.lib-shuf-btn` : 36px fantôme.
- [ ] views.js : afficher la barre uniquement pour les vues liste (`all`, `liked`, `recent`, `genre-detail`) — masquer sur artists/albums/playlists/radio/drill (le drill a déjà `dh-actions`). Identifier le point central de bascule de vue (`setView`/`renderLib`) et toggler `hidden`.
- [ ] i18n : clés `lib_play_all` («Tout lire»), `lib_shuffle_all` («Lecture aléatoire») fr+en.
- [ ] `npm test`.

### Task 5: FAB Play dans playlist hero + drill header, suppression des glyphes Unicode

**Files:** Modify: `frontend/src/renderer.js:518-525`, `frontend/src/renderer-grids.js:201-203 & 254-256`, `frontend/src/style.css`

- [ ] renderer.js `updatePlActionBar()` : remplacer `▶ Tout lire` / `⇀ Aléatoire` / `•••` par SVG inline (play plein, shuffle stroke, ellipsis 3 cercles). Le bouton play devient `class="fab-play fab-play--sm"` (40px, rond, accent).
- [ ] renderer-grids.js `dh-actions` (2 sites) : même traitement — `.dh-play` devient FAB accent avec SVG, `.dh-shuf` garde le style secondaire avec SVG shuffle.
- [ ] CSS : `.fab-play--sm { width:40px; height:40px; }` ; adapter `.dh-play`/`.pl-act-btn` pour accueillir les SVG (14px, `flex`, gap).
- [ ] `npm test`.

### Task 6: Radius concentriques

**Files:** Modify: `frontend/src/style.css` (~:1598 `.card-art`, ~:1227 `.tart`)

- [ ] `.card-art` : `border-radius: var(--r)` (8px sous carte 16px/padding 12px).
- [ ] `.tart` : `border-radius: var(--r-xs)` (4px sous rangée 8px/padding 8px). Vérifier `.tart img` et les états hover associés.
- [ ] `npm test`.

### Task 7: ::selection accent + queue vide au standard maison

**Files:** Modify: `frontend/src/style.css`, `frontend/src/queue.js:~361`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`

- [ ] `design-system.css` a déjà `::selection` (§11) — vérifier qu'il gagne la cascade ; sinon renforcer avec `rgba(var(--g-rgb), .28)`.
- [ ] queue.js : remplacer la ligne `.queue-empty` texte brut par le pattern maison `.empty-state` (`.empty-ico` icône file + `.empty-h` «Aucun titre en file» + `.empty-s` invite). Pas de CTA (informational, conforme spec 2026-07-14).
- [ ] CSS : s'assurer que le pattern `.empty-ico/.empty-h/.empty-s` s'applique dans le panneau queue (largeur réduite).
- [ ] `npm test`.

### Task 8: Désenterrer Stats / Cinéma / EQ

**Files:** Modify: `frontend/index.html` (#sb-more-pop, sidebar nav, #pl .pl-r), `frontend/src/style.css`

- [ ] Sidebar : ajouter `<button class="ni" id="ni-stats" data-action="set-view" data-view="stats">` (icône bar-chart existante) après #ni-recent. Retirer `#tbt-stats` du menu ⋯.
- [ ] Player bar `.pl-r` : ajouter deux boutons `pl-queue-btn` avant #btn-queue — `#btn-eq-bar` (`data-action="toggle-eq"`, aria-expanded/controls copiés de #btn-eq) et `#btn-cinema-bar` (`data-action="toggle-cinema"`, aria-pressed, icône fullscreen). Retirer `#tbt-cinema` et `#btn-eq` du menu ⋯ (garder Thème, Paramètres, Mini-player, Minuterie).
- [ ] Vérifier handlers : les `data-action` sont routés par délégation — aucun changement JS attendu ; contrôler que `toggle-eq`/`toggle-cinema` ne dépendent pas des ids `#btn-eq`/`#tbt-cinema` (grep dans handlers.js/eq.js/cinema.js ; adapter les `aria-expanded` sync si ciblés par id).
- [ ] `npm test` (a11y.test.cjs contrôle les aria — adapter si un test cible les ids déplacés).

---

## PHASE 2 — Cohérence & navigation

### Task 9: Unifier la navigation bibliothèque

**Files:** Modify: `frontend/index.html` (.lib-tabs), `frontend/src/views.js` (_svMarkNav, setView), `frontend/src/i18n.*.js`

- [ ] `.lib-tabs` : retirer l'onglet «Tous les titres» (doublon sidebar) et l'onglet «Radio». Ajouter l'onglet «Genres» (`data-view="genres"` — la vue existe, `_NAV_ORDER` la connaît). Résultat : Artistes / Albums / Genres.
- [ ] Radio : ajouter `<button class="ni" id="ni-radio" data-action="set-view" data-view="radio">` dans la sidebar (icône radio existante du ctx-menu).
- [ ] views.js : masquer `.lib-tabs` pour les vues `liked`/`recent` (plus d'onglets tous éteints) ; `_svMarkNav` : ajouter `genres` à la liste des vues marquables, retirer `all`/`radio` des tabs.
- [ ] Vérifier le clavier : ordre de tabulation et `aria-selected` cohérents.
- [ ] `npm test`.

### Task 10: Bouton « ⋯ » au hover sur les rangées

**Files:** Modify: `frontend/src/renderer.js` (thtml), `frontend/src/handlers.js`, `frontend/src/style.css`

- [ ] thtml() : ajouter dans `.tr-r` un bouton `.tr-more-btn` (3 points SVG, `--target-min`, `aria-label` «Plus d'actions», `aria-haspopup="menu"`) visible au hover/focus-within de `.tr` (opacity 0→1, toujours visible au focus clavier).
- [ ] handlers.js : action `tr-more` → appeler le même chemin que le contextmenu (localiser `showCtxMenu` et l'invoquer avec les coordonnées du bouton + l'id de piste de la rangée).
- [ ] CSS : `.tr-more-btn` calqué sur `.tr-add-btn` existant.
- [ ] Zéro allocation nouvelle dans le chemin de rendu virtuel (string template seulement).
- [ ] `npm test`.

### Task 11: Colonnes de tri cliquables

**Files:** Modify: `frontend/src/style-polish.css` (#tlist-col-hdr) ou style.css fusionné, `frontend/index.html:291-296`, `frontend/src/handlers.js`, `frontend/src/views.js`

- [ ] index.html : `col-title`/`col-album`/`col-dur` deviennent des `<button>` (`data-action="sort-col"` + `data-col`), flèche ▲/▼ en SVG 10px, `aria-sort` sur la colonne active.
- [ ] handlers : `sort-col` mappe col→clé de tri existante (title→az/za toggle, album→album, dur→duration) en réutilisant la mécanique de `next-sort` (lire l'implémentation avant : le tri vit dans cfg/state `sort`).
- [ ] `#main-sort-btn` conservé (utile pour les tris non-colonnes : artiste, récents) mais synchronisé.
- [ ] `npm test` + test unitaire du mapping col→sort si la logique est extraite pure.

### Task 12: Passe de wording fr

**Files:** Modify: `frontend/src/i18n.fr.js` (+ `i18n.en.js` si clé partagée), sources des toasts émojis (grep)

- [ ] `scan_title` : «Lecture en cours…» → «Analyse de ta musique…».
- [ ] «Liker/Déliker» → «Ajouter aux favoris» / «Retirer des favoris» (clés sel_like, ctx_like, aria_sel_like — garder cohérence avec nav_liked «Favoris»).
- [ ] `radio_regen_btn`/`radio_regen_done` : «Regénérer» → «Régénérer»/«régénérée».
- [ ] `pl_hero_edit` : «Modifier le cover» → «Modifier la pochette» ; «Graine radio» → «Titre de départ» ; `sc_search` «Focuser la recherche» → «Activer la recherche».
- [ ] Vouvoiement → tutoiement : chaînes usb-modal, organize, erreurs disque («Sélectionnez» → «Sélectionne», etc.). Grep `ez\b`-heuristique + relecture manuelle du fichier.
- [ ] Retirer les émojis des chaînes de toasts (🗑️ ✅ 📻 ⏱ ✏) — grep dans i18n.fr.js et les `toast(` appels.
- [ ] `npm test` (core.test.cjs vérifie des clés i18n — adapter si des tests citent les libellés modifiés).

### Task 13: États vides 100 % actionnables

**Files:** Modify: `frontend/src/renderer-grids.js` (pl-grid-empty), `frontend/src/renderer.js` (favoris vides), `frontend/src/stats.js` (stats vides), i18n

- [ ] Grille playlists vide : bouton `.empty-cta` «Créer une playlist» (`data-action="new-playlist"`).
- [ ] Favoris vides : bouton «Explorer la bibliothèque» (`data-action="set-view" data-view="all"`).
- [ ] Stats vides : bouton «Écouter un titre» (`data-action="set-view" data-view="all"`).
- [ ] `npm test`.

### Task 14: Affordance Now Playing + temps restant

**Files:** Modify: `frontend/index.html` (.pl-info), `frontend/src/style.css`, `frontend/src/app.js` (updateBar), `frontend/src/handlers.js`, `frontend/src/cfg.js`

- [ ] `.pl-info` : chevron-up SVG apparaissant au hover (opacity 0→1, coin de la pochette, comme Spotify).
- [ ] `#td` : cliquable (`role="button"`, `data-action="toggle-remaining"`, aria-label) ; cfg `showRemaining` (persist debounced via cfgsave) ; updateBar affiche `-M:SS` si actif. Localiser updateBar dans app.js et le point unique d'écriture de #td.
- [ ] `npm test` + ajout d'un test core sur le formatage temps restant si helper pur extrait.

### Task 15: Gaps light mode

**Files:** Modify: `frontend/src/style.css` (:1844, :1861, :5895, :521-527)

- [ ] `.genre-meta` : override light (`rgba(0,0,0,.55)` ou token `--scrim-2` light).
- [ ] `.genre-variants-badge` : override light (fond `rgba(255,255,255,.5)`, texte `--text-primary` light).
- [ ] `.rpl` (ripple) : encre adaptée au light (`rgba(0,0,0,.12)`) — ou suppression si Task 19 tranche contre le ripple.
- [ ] Scrims littéraux :521-527 → `var(--scrim-3)`.
- [ ] `npm test` (theme-palette).

### Task 16: prefers-reduced-motion OS par défaut

**Files:** Modify: `frontend/public/boot-motion.js`, `frontend/src/motion.js`, `frontend/index.html` (data-motion), settings default

- [ ] Défaut du réglage : `system` (au lieu de `full`) — `system` résout `prefers-reduced-motion` OS ; `full`/`reduce` restent des overrides in-app explicites.
- [ ] boot-motion.js : si mirror localStorage absent → poser `data-motion` selon `matchMedia('(prefers-reduced-motion: reduce)')`.
- [ ] index.html : `data-motion="full"` initial → laisser boot-motion décider (attribut retiré ou posé à `system`-résolu).
- [ ] Settings : option `Système` sélectionnée par défaut.
- [ ] `npm test` (a11y.test.cjs a des tests motion — lire avant de modifier).

---

## PHASE 3 — Assainissement design system

### Task 17: Vérité des échelles (spacing + typo)

**Files:** Modify: `frontend/src/design-system.css`

- [ ] Corriger TOUTES les annotations mensongères des alias `--sp-*` (…/* 24 */ qui rend 20px) et `--fs-*` (…/* 14 */ qui rend clamp 15-18) pour refléter les valeurs réellement rendues. Aucune valeur calculée ne change (zéro régression visuelle).
- [ ] Trancher le pas 32px : supprimer `--space-8` (mort) OU le recâbler — décision : **supprimer** (le rendu actuel fait foi ; le pas 24→48 est documenté comme intentionnel dans le commentaire d'échelle).
- [ ] Supprimer les 5 autres tokens morts stricts : `--blur-1`, `--card-min-w` (vérifier grep avant), `--shadow-art-col`, `--shadow-pl-list`, `--text-2xl` (recâbler `--fs-2xl`→26px littéral si consommé).
- [ ] Supprimer les sections squelettes vides §1/§9/§10 et les placeholders §3 (Weights/Line-heights/Letter-spacing) — le sommaire est mis à jour.
- [ ] `npm test` (token-source.test.cjs).

### Task 18: Fusionner style-polish.css dans style.css

**Files:** Modify: `frontend/src/style.css`, `frontend/index.html:10`, Delete: `frontend/src/style-polish.css`

- [ ] Pour chaque règle de style-polish.css : la reporter à l'endroit canonique de style.css EN RÉSOLVANT les contradictions (une seule déclaration finale) : `.tr.act .tn` (3 défs → 1 : accent/500), `.ts`/`.ta` (fs-xs), `#tlist-col-hdr` (bloc polish fait foi), `.pcplay` (32px visuel + expansion ::before inset:-6px pour cible 44px — corrige aussi le point hit-area), `#ico-play` margin (voir Task 21), gaps player bar (tokens `--sp-1`/6px→`--sp-1h` arbitré).
- [ ] Supprimer le `<link>` style-polish.css d'index.html, supprimer le fichier.
- [ ] Grep tests (`token-source.test.cjs`, a11y) pour toute référence à style-polish.css — adapter.
- [ ] `npm test`.

### Task 19: Purge tokens ombre `none` + doublons + ripple fantôme

**Files:** Modify: `frontend/src/design-system.css`, `frontend/src/style.css`

- [ ] Les ~34 tokens `--shadow-* : none` encore consommés : supprimer le token ET la déclaration `box-shadow: var(--X)` chez chaque consommateur (no-op aujourd'hui, zéro changement visuel). Exceptions : ceux réactivés par Task 1 (--shadow-pop/modal2/modal3).
- [ ] Doublons style.css : supprimer `.tr.act::before` mort (:1216, battu par :6060) et dédupliquer `.queue-head h3` (3 défs → 1).
- [ ] Ripple : les commentaires `/* requis pour ripple */` référencent un ripple inexistant. Décision : **supprimer** les commentaires et les `overflow:hidden` devenus inutiles (sauf si nécessaires au clip réel — vérifier chaque cas, notamment `.tr` :1206 qui clippe le scale des pochettes au hover). Si `.rpl` est du CSS mort (grep JS), le supprimer aussi (annule 15.3).
- [ ] `npm test`.

### Task 20: Règle Syne écrite et appliquée

**Files:** Modify: `frontend/src/design-system.css` (§3 commentaire), `frontend/src/style.css`

- [ ] Documenter dans §3 : «Syne : rôles display uniquement, ≥16px rendus. Jamais en taille corps.»
- [ ] Appliquer : `.dh-name` et `.vnp-title` passent en `var(--font-display)` ; `.modal-h` repasse en `var(--font-body)` (poids 700) ; `.tart-init` (11px) repasse en font-body.
- [ ] `npm test`.

### Task 21: Tokeniser les poches hors-système (drill header, vnp) + triangle play

**Files:** Modify: `frontend/src/style.css` (:7187-7260, :6918-7046, :2341), `frontend/src/design-system.css`

- [ ] Drill header : `20px` → `var(--space-5)` (le commentaire «aucun token exact» est faux), `.dh-art 120px` → token `--art-drill: 120px` (§13, littéral assumé), `.dh-name 22px` → `var(--fs-xl)` recalibré ou littéral tokenisé, `transition .15s` → `var(--motion-fast)`.
- [ ] VNP : `--vnp-text/--vnp-text2` déplacés dans design-system.css §13 (documentés : palette locale sur fond pochette) ; `.vnp-art 320px` → token `--art-np: 320px`.
- [ ] Triangle play : garder UN seul mécanisme de centrage optique — le viewBox du polygon est déjà décalé de +1 ; supprimer `margin-left: var(--sp-micro)` sur `#ico-play` et vérifier `#cinema-ico-play` identique.
- [ ] `#0a0a12` (:4827) → `var(--c-black)` ou token cinéma dédié ; fallbacks genre `#1e1e1e/#2a2a2a` → tokens `--c-1a`/`--bg5` équivalents perceptuels (vérifier rendu).
- [ ] `npm test`.

### Task 22: Motion — token press + fills scaleX

**Files:** Modify: `frontend/src/design-system.css`, `frontend/src/style.css` (:5779, :5787, :5809, :6317, :6433, :313), JS des fills concernés

- [ ] `--motion-press: 70ms` en §2bis ; remplacer les 9 littéraux `70ms`.
- [ ] `#cd-progress-fill` (:313) : `200ms` → `var(--motion-base)`.
- [ ] Fills en `transition: width` (stats/radio/mini-player) : convertir en `transform: scaleX()` + `transform-origin: left` là où le JS pose une largeur en % (adapter le JS : `style.transform = 'scaleX(' + p + ')'`). Si un site s'avère structurellement dépendant de width (texte centré dedans), le documenter et le laisser.
- [ ] `npm test` + `npm run bench` (aucune régression >5%).

---

## Self-review

- Couverture : les 8 items Phase 1, 8 items Phase 2, 6 items Phase 3 de l'audit sont tous mappés sur les Tasks 1-22.
- Le toggle temps restant (Task 14) et le moment de succès post-scan (audit UX #10) : le second est DÉFÉRÉ (nécessite un flux scan→toast interactif, scope produit) — documenté ici comme hors périmètre.
- Types/signatures : aucune API inter-modules nouvelle sauf actions data-action (`sort-col`, `tr-more`, `toggle-remaining`) routées par la délégation handlers.js existante.
