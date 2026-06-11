# Audit qualité UI — libreflow

**Date** : 2026-06-11 · **Agent** : @design-eng (orchestration) · **Méthode** : 5 audits statiques parallèles (tokens, a11y modales/clavier, a11y contraste/virt, premium CSS, discipline DOM/JS) + vérifications croisées.

**Périmètre** : `design-system.css`, `style.css` (~6 884 l.), `index.html`, composants Lit, modules UI JS (playerbar, renderer, renderer-track, app, artcolor, oscPremium, ui, modal, settings, playlists, queue, cinema, shortcuts, keynav), tests guardrails.

---

## Synthèse

| Sévérité | Nombre | Dominantes |
|---|---|---|
| CRITICAL | 3 | Blocs tokens `:root` hors design-system.css (×2) ; sélecteurs `#id.classe` bannis (systémique, ~30 occurrences) |
| HIGH | ~18 | Bordures light mode <3:1 ; focus rings locaux cassant l'invariant dual-tone ; cycle d'alias `--g`↔`--accent` ; palette thème driftée en 3 sources ; app.js/playlists.js > 800 l. ; littéraux dans le code récent |
| MEDIUM | ~28 | Spring easing par défaut ; accent sur hover ; 70 `!important` ; ~30 tokens morts ; 5 implémentations de focus-trap ; fonctions >50 l. |
| LOW | ~16 | Nits de polish |

**Verdict global** : le socle est réellement premium et l'accessibilité est implémentée, pas seulement déclarée — les 3 tiers de texte tiennent **7:1 vérifié par calcul dans les deux thèmes**, la synchro `aria-current`↔`.act` est exacte, zéro handler inline, `esc()` systématique sur les données lofty (y compris `thtml()`), zéro `transition: all`, fonts auto-hébergées, pattern glass et échelle d'élévation cohérents, boucle rAF d'oscPremium exemplaire. La dette est concentrée dans **4 poches** : (1) les internals de design-system.css (cycles, doublons, alias régressés), (2) le **code le plus récent** (UI CD-rip, section #vnp, swatches, composants Lit) qui réintroduit des littéraux, (3) des **opt-outs locaux de focus ring** qui cassent la garantie AAA là où elle compte le plus, (4) le **light mode** sur les bordures et 3 littéraux blancs.

---

## CRITICAL

### C1 — Blocs de tokens `:root` hors design-system.css (violation source-unique §17)
- `style.css:338-356` : bloc complet de tokens light (`--sep`, `--border-1/2/3`, `--glass-surface`, `--eq-warm`…) hors `@media`. design-system.css §12 en revendique la propriété (son commentaire ligne 1041 décrit même le comportement qui vit en réalité ici).
- `style.css:94-96` : `:root[data-tlist-zoom="…"]` redéfinit `--tr-h`/`--art-list` (possédés par design-system.css:571-572).
- **Fix** : déplacer les deux blocs dans design-system.css (§12 et à côté des blocs `data-platform`).

### C2 — Sélecteurs `#id.classe` bannis (§13) — systémique
~30 occurrences : `style.css:2700, 2702, 3882-3906, 5600-5605, 6382, 6420-6425, 6476-6479, 6562-6564, 6637-6644, 6853` (`#drago.on`, `#app.panel-queue-pinned`, `#vnp.art-light`, `#main.view-fade`…). Pattern délibéré « classe d'état sur id singleton », mais en contradiction frontale avec la règle du projet.
- **Fix (décision requise)** : soit migrer vers `#app[data-state="…"]`, soit amender §13 avec une dérogation explicite documentée. Ne pas laisser la règle et le code se contredire.

---

## HIGH — Accessibilité (invariants §2 entamés)

### A1 — Bordures light mode : 1.14–1.31:1 (SC 1.4.11, cible 3:1) — `design-system.css:399-401`
`--border-subtle/default/strong` light = rgba(0,0,0,.06/.12/.11) → toutes sous 3:1, et l'ordre des tiers est **inversé** (strong plus claire que default). L'invariant §2 ne couvre que « flat-Vantablack » ; le light mode est sans garde-fou. Ratios sombres OK (4.44/6.26/8.55:1 — les commentaires lignes 135-137 sont faux mais dans le sens sûr).
- **Fix** : ≥ rgba(0,0,0,.42) (~3.05:1 sur #F7F8FA) quand la bordure est la seule frontière ; rétablir subtle<default<strong. Ajouter des assertions `--border-*` ≥3:1 par thème dans theme-palette.test.cjs (le test calcule de vrais ratios mais ignore les bordures et `--bg-surface`).

### A2 — Opt-outs locaux du focus ring dual-tone (SC 2.4.13 AAA, invariant §2)
Le ring global (`style.css:756-768`) est exemplaire, mais des règles locales le remplacent :
- `.tr:focus-visible` (`style.css:1311` + `--shadow-tr-focus` design-system.css:917) : 2ᵉ ton = blanc 18 % d'alpha au lieu de `--focus-ring-contrast` opaque → dépendant de l'accent, quasi invisible en light. **C'est la surface clavier principale.**
- `.eq-slider:focus-visible` (`style.css:4569-4575`) : `outline:none` remplacé par une teinte accent 12 % — pas un indicateur 3:1.
- `.vslider`/`.cf-slider` (`style.css:2552, 3808`) : deux tons dérivés de l'accent, aucun ton neutre opaque.
- Inputs texte (`style.css:2618, 2646, 2849, 2992, 3040, 3179, 3600, 3633`) : `outline:none` inconditionnel supprime l'outline 2px du ring global ; il ne reste qu'un liseré opaque de 1px (< 2px AAA).
- **Fix** : remplacer le ton interne par `var(--focus-ring-contrast)` partout ; scoper les `outline:none` en `:focus:not(:focus-visible)`.

### A3 — Ligne de référence 0 dB de l'EQ invisible en light — `style.css:4337`
`rgba(255,255,255,.20)` sans override light → repère fonctionnel perdu. **Fix** : `html[data-mode="light"] .eq-slider-wrap::before { background: rgba(0,0,0,.18); }`.

## HIGH — Tokens / design system

### T1 — Cycle d'alias accent + premier paint sans thème — `design-system.css:84/737, 86/735`
`--g: var(--accent)` et `--accent: var(--g)` (idem `--gd`/`--accent-subtle`) : dépendances circulaires, résolues seulement quand `[data-theme]` pose des littéraux — or `index.html` n'a **pas** de `data-theme` statique : `--accent`/`--gd` sont invalides au premier paint (seul `--g` est sauvé par le `@property` de style.css:87-91). **Fix** : faire des littéraux §2 la source, supprimer le re-alias §13.

### T2 — Définitions mortes/contradictoires dans design-system.css
- Deux `transition` sur `:root` (lignes 432 vs 1066) : l'animation documentée de `--g` est morte (fix : fusionner en une déclaration).
- `--shadow-sm/md/lg` définis deux fois avec valeurs différentes (§7:282-296 vs §13:862-865) ; `--font-display` en double avec stack driftée (169 vs 855).
- `--sp-7/7h/8 → var(--space-6)` (519-525) : **24px au lieu de 28-32px** — trois alias ont silencieusement rétréci, contredisant leurs propres commentaires (fix : `var(--space-8)`).

### T3 — Palette thème driftée en 3 sources
`settings.js:270-271` (`green:'#1db954', blue:'#3b82f6'…`) ≠ `index.html:765-771` (swatches hex inline) ≠ `design-system.css:1069-1076` (`green #34d399, blue #1D9BF0, cyan #22d3ee`). Le swatch affiché n'est pas l'accent appliqué. **Fix** : source unique — swatches en `var(--g)` par `[data-theme]`, JS via computed style.

### T4 — Littéraux dans le code récent (là où la discipline a glissé)
- UI CD-rip (`style.css:125-332`) : font-size 11-13px, radius 1/4px, transitions littérales — tokens existants ignorés.
- Section #vnp (`style.css:6416-6809`) : `--vnp-text` en hex brut, cluster de `.15s ease` littéraux, font-sizes en px.
- `lf-toast-stack.js:57-158` : padding 14px hors grille, radius 4px, bezier littéral, rgba dupliquant `--text-primary` light.
- `lf-modal.js:24-28` : largeurs littérales + les 3 fallbacks driftés vs vraies valeurs des tokens.
- `playlists.js:323` : `style="color:#f59e0b"` inline (token `--amber` existant).

## HIGH — Structure

### S1 — Dépassements du cap 800 lignes (§16)
`app.js` **1 094 l.**, `playlists.js` **855 l.** (style.css 6 884 l. — monolithe, hors cap JS mais résiste à la review). Fonctions >50 l. : `virtRenderWindow()` ~138 l. (renderer.js:64), `updateBar()` 97 l. (playerbar.js:138), `renderLib()` ~84 l. (renderer.js:251).

## HIGH — Motion

### M1 — Tier « ambiant » manquant : littéraux 380–800ms + 3 courbes spring
`style.css:2285, 4774, 4910, 5127, 6402, 6411, 6634` : durées hors échelle (max système : `--motion-slow` 320ms) et deux beziers presque-spring (.34,1.2/1.5) qui fragmentent le langage. **Fix** : promouvoir un token `--motion-cinema` + réutiliser `--ease-spring`.

---

## MEDIUM (sélection structurante)

1. **Spring = easing par défaut** : `.ni`, `.tr`, `.card`, `.pc` (style.css:1096, 1303, 1566, 2297) animent avec l'overshoot ; `--spring-soft` aliasé sur la courbe pleine (design-system.css:847-848). Contredit « spring = playful only ».
2. **Accent sur hover** : `.tlk:hover`, `.tr-add-btn:hover` (style.css:1489, 1518, 1533, 3259) + `--shadow-wbtn-hv` = glow accent sur simple hover — l'accent n'est plus « earned ».
3. **`--shadow-glow` orphelin** : défini (design-system.css:294-296), consommé nulle part en CSS — le glow signature du cover en lecture a peut-être disparu silencieusement.
4. **~30 tokens morts + système plateforme fantôme** : tout le §5/§10 (`--player-height`, `--cover-*`, `--layout-*`…) sans consommateur ; rien ne pose `data-platform`.
5. **70 `!important`** dont clusters de pure guerre de spécificité (hover accents, toggles de vue 1730-1746).
6. **5 implémentations de focus-trap** (`modal.js:35`, `ui.js:114`, `settings.js:37`, `lf-modal.js:62`, `cinema.js:186` — vérifié fonctionnel ; + `a11y.js:42` mort sans appelant). Double trap simultané sur `confirm-modal-bg` (modal.js autoIds + ui.js:174). Commentaire de modal.js:7-8 mensonger (settings absent d'autoIds mais auto-trappé).
7. **Dialog sans nom** : `promptAction` (ui.js:201-209) — `role=dialog` sans `aria-labelledby`.
8. **SC 2.1.4 strict** : aucun mécanisme de désactivation/remap des raccourcis mono-touche (le garde anti-typing, lui, est correct — shortcuts.js:62-119, IME inclus).
9. **Live region toast** : `role`/`aria-live` injectés en même temps que le message (lf-toast-stack.js:294-296) — les toasts polite risquent le silence NVDA/JAWS au premier rendu. Fix : conteneurs live persistants.
10. **`.set-row:hover` invisible en light** (style.css:3751) ; **blur littéraux** dans le pattern glass (2466-2467, 2497-2498).
11. **Échappement i18n incohérent** : `esc(i18n(…))` dans queue.js:351-373 mais brut ailleurs (queue.js:342, playlists.js:165-176, 319, 618-622) — non exploitable aujourd'hui, drift garanti demain.
12. **Trous des guardrails** : a11y.test.cjs ne teste ni la complétude des traps (chaque `role=dialog` ↔ un mécanisme), ni le focus-restore, ni le garde typing, ni le miroir `aria-current`↔`.act` ; theme-palette.test.cjs ignore les bordures et `--bg-surface`.

---

## Vérifications croisées (leads levés)

- **`#cinema-overlay` sans trap** (HIGH initial) : **réfuté** — `cinema.js:177-199` implémente son propre Tab-trap, installé à 266-267, focus restauré à 378. Reste la duplication (cf. MEDIUM 6).
- **`thtml()` non audité** : **propre** — renderer-track.js échappe via `esc()` name/artist/album/id/aria-label ; `hlText` passe par `esc()` (ligne 27).

## Points forts confirmés (avec preuves)

- **Texte AAA 7:1 calculé, deux thèmes** : --t 19.07/17.76:1, --t2 10.31/13.65:1, --t3 7.53/10.33:1 ; `--t4` strictement décoratif (style.css:449, 493, 698).
- **Virt ARIA exact** : `role=listitem` + setsize/posinset + roving tabindex (renderer-track.js:96-97) ; `patchActiveTrack()` retire/pose classe+attribut ensemble avec sweep de secours (renderer-track.js:119-148).
- **SC 2.5.7/2.5.8/2.4.11** : Alt+↑/↓ → `moveByOne()` (keynav.js:71-84 → app.js:863 → playlist-crud.js:138) ; `--target-min` 24px appliqué sur tous les boutons inline trouvés ; `#tlist` scroll-padding-top 32px ≥ GRP_H 28 (drift CSS/JS toléré, à surveiller).
- **Discipline DOM** : zéro handler inline ; `esc()` sur 100 % des données lofty atteignant `innerHTML` ; oscPremium.js sans allocation par frame ; ordre lecture→écriture correct dans renderer.js.
- **Light mode architecturalement complet** (sauf les 3 littéraux blancs ci-dessus) ; glass/élévation/typographie (Syne display only) disciplinés ; fonts woff2 locales.

---

## Plan d'action priorisé

| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | Bordures light ≥3:1 + ordre des tiers + assertions test | Échec WCAG réel en light | S |
| 2 | Restaurer le dual-tone sur `.tr`, sliders EQ/vol/cf, inputs (`--focus-ring-contrast`) | Invariant §2 AAA cassé sur la surface clavier principale | S-M |
| 3 | Rapatrier les blocs tokens de style.css → design-system.css ; casser le cycle `--g`↔`--accent` ; fixer `--sp-7/7h/8` | Source-unique + premier paint | S |
| 4 | Unifier la palette thème (3 sources driftées) | Bug visible utilisateur (swatch ≠ accent) | S |
| 5 | Trancher `#id.classe` : data-attributes ou amendement §13 | Cohérence règle/code | M (décision) |
| 6 | Retokeniser le code récent (CD-rip, #vnp, Lit) + ligne 0 dB light + `.set-row:hover` light | Dette du delta en cours | M |
| 7 | Découper app.js / playlists.js ; extraire phases de `updateBar`/`virtRenderWindow` | Cap §16 | M-L |
| 8 | Consolider les 5 focus-traps sur `modal.js` ; guardrail « chaque dialog a un trap » | Robustesse a11y | M |
| 9 | Discipline accent/spring : hover neutres, `--spring-soft` adouci, tier `--motion-cinema` | Feel premium | M |
| 10 | Purge ~30 tokens morts + doublons design-system.css | Hygiène | S |
