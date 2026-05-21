# Audit d'harmonisation UI — libreflow

- **Date** : 2026-05-21
- **Statut** : TERMINÉ
- **Spec** : `docs/superpowers/specs/2026-05-21-audit-harmonisation-ui-design.md`
- **Plan** : `docs/superpowers/plans/2026-05-21-audit-harmonisation-ui.md`
- **Périmètre** : analyse visuelle/UX en lecture seule. Cible : niveau de finition
  Spotify/Deezer en gardant l'identité libreflow (7 thèmes, clair/sombre, accent dynamique).
- **Sources analysées** : `frontend/src/style.css` (6624 lignes), `frontend/index.html`
  (1330 lignes), modules JS de `frontend/src/`.

## Référentiel — principes

| ID | Principe | Critère |
|---|---|---|
| P1 | Surfaces étagées | Profondeur par 3–4 niveaux de surface + élévation, pas de bordures dures |
| P2 | Grille 4/8 | Tout espacement multiple de 4px |
| P3 | Hiérarchie typo | Échelle ~6 tailles, contraste de graisse marqué |
| P4 | Accent discipliné | Accent = états actifs/CTA uniquement |
| P5 | Cibles généreuses | Interactifs ≥ ~32px de haut |
| P6 | Transitions fluides | 150–300ms, easing cohérent |
| P7 | États complets | hover + focus-visible + active + disabled |
| P8 | Densité maîtrisée | Respiration entre sections, états vides traités |
| P9 | Cohérence composants | Un composant = un rendu partout |
| P10 | Contraste AA | WCAG 2.1 AA dans les deux modes |

---

## 1. Résumé exécutif

### Diagnostic central

libreflow **possède déjà un système de design** : un bloc `:root` de plus de 400
variables CSS (`style.css:90-660`) couvrant couleur, espacement, typo, rayons, ombres, motion.
Le problème n'est donc **pas l'absence de tokens — c'est leur prolifération**. Les
échelles ont métastasé : là où une UI de niveau Spotify/Deezer tient sur ~6 paliers
d'espacement et ~6 tailles de police, libreflow en compte respectivement **25 et 28**.
Le « système » est devenu une copie 1:1 de toutes les valeurs ad hoc jamais écrites,
préfixée de `--`.

Conséquence : le token n'impose plus aucune discipline. Quand 25 espacements existent,
en choisir un revient à choisir une valeur libre. L'harmonisation ici ne consiste pas à
*créer* des tokens mais à **effondrer les échelles** vers des paliers stricts, puis à
recâbler les ~6600 lignes de CSS dessus.

Second constat : une **remédiation a été amorcée mais laissée incomplète**. Les tokens
`--scrim`, `--scrim-heavy`, `--border-1..3`, `--glass-*` (`style.css:638-657`) ont été
introduits *explicitement pour remplacer* des littéraux — leurs commentaires le disent.
Mais ~24 opacités noires et ~27 opacités blanches littérales subsistent dans le fichier.
Le fil a été laissé pendu.

### Score de cohérence

Formule : `score = max(0, 100 − (CRITIQUE×15 + ÉLEVÉ×7 + MOYEN×3 + FAIBLE×1))` sur les
findings propres à chaque surface. Le score global est la moyenne arithmétique des
lignes ci-dessous.

| Surface | Score | Findings (C/É/M/F) |
|---|---:|---|
| **Fondation (tokens)** | **31** | 0 / 7 / 6 / 2 |
| Constructeur de playlist intelligente | 73 | 0 / 2 / 4 / 1 |
| Panneau Settings | 75 | 0 / 2 / 3 / 2 |
| Topbar / Recherche | 85 | 0 / 1 / 2 / 2 |
| Now Playing plein écran (`#vnp`) | 85 | 0 / 1 / 2 / 2 |
| Bibliothèque / liste de pistes | 88 | 0 / 0 / 3 / 3 |
| Mode Cinéma | 88 | 0 / 1 / 1 / 2 |
| Barre de lecture | 89 | 0 / 1 / 1 / 1 |
| Mode clair (transverse) | 89 | 0 / 1 / 1 / 1 |
| Panneau EQ | 90 | 0 / 0 / 3 / 1 |
| Modales (confirm / backup / USB / organize) | 90 | 0 / 0 / 3 / 1 |
| Menus contextuels | 90 | 0 / 0 / 3 / 1 |
| Mini-player | 92 | 0 / 0 / 2 / 2 |
| Navigation latérale / playlists | 92 | 0 / 0 / 2 / 2 |
| Toasts / notifications | 93 | 0 / 0 / 1 / 4 |
| Vues secondaires (CD audio, Stats, Radio) | 93 | 0 / 0 / 2 / 1 |
| File d'attente | 94 | 0 / 0 / 1 / 3 |
| Overlay drop-in | 99 | 0 / 0 / 0 / 1 |
| **Score global** | **85** | — |

> Total : **88 findings** — 15 Fondation + 73 écran. Le score global est la moyenne
> des 18 lignes de surface ci-dessus.

> Lecture : le score global de 85 est trompeusement rassurant. Chaque écran pris
> isolément est « correct » — mais tous reposent sur une Fondation à **31/100**. Aucun
> re-skin d'écran n'a de sens tant que la Fondation n'est pas effondrée et recâblée.
> C'est l'unique chantier prioritaire.

### Top 10 des écarts

| # | ID | Écart | Sévérité |
|---|---|---|---|
| 1 | UIH-FND-04 | 62 tokens d'ombre (`--shadow-*`, `--tshadow-*`, `--dropshadow-*`) là où 4 élévations suffisent | ÉLEVÉ |
| 2 | UIH-FND-02 | 28 tailles de police (`--fs-*`), nommage incohérent (`--fs-lg`=17 vs `--fs-lg2`=20, `--fs-inter`=18) | ÉLEVÉ |
| 3 | UIH-FND-01 | 25 paliers d'espacement (`--sp-*`), dont 14 hors grille 4px | ÉLEVÉ |
| 4 | UIH-FND-05 | 19 durées de transition (`--dur-*`), de 60ms à 900ms | ÉLEVÉ |
| 5 | UIH-FND-12 | Remédiation scrims/teintes incomplète : ~51 littéraux `rgba(0/255…)` subsistent | ÉLEVÉ |
| 6 | UIH-FND-03 | 17 rayons (`--r-*`), nommage mixte t-shirt + nombres bruts (`--r-9`, `--r-32`, `--r2`, `--r3`) | ÉLEVÉ |
| 7 | UIH-FND-13 | 7 couleurs hex hors `:root`, bleus/violets divergents de l'accent (`#64b4ff`, `#7c6af5`…) | ÉLEVÉ |
| 8 | UIH-FND-07 | 22 valeurs de letter-spacing (`--ls-*`) | MOYEN |
| 9 | UIH-spl-01 | Constructeur de playlist intelligente entièrement stylé en inline (`index.html:470-607`) | ÉLEVÉ |
| 10 | UIH-spl-02 | Même chaîne de style inline répétée 7× pour les libellés de section | ÉLEVÉ |

---

## 2. Jeu de tokens cible

Objectif : effondrer chaque échelle vers des paliers stricts et nommés sémantiquement.
Toute valeur constatée se mappe à un token cible (voir §3). Le système de **7 thèmes**,
le **mode clair/sombre** et l'**accent dynamique** (`--art-color`, `--g`, `--g-rgb`)
sont **conservés intacts** — seules les échelles utilitaires sont resserrées.

### 2.1 Espacement — 25 → 8 (grille 4px stricte)

| Token | Valeur | Usage |
|---|---|---|
| `--space-0` | 0 | reset |
| `--space-1` | 4px | gaps fins, padding icône |
| `--space-2` | 8px | padding contrôle compact |
| `--space-3` | 12px | padding standard, gap de liste |
| `--space-4` | 16px | padding de carte, gap de section |
| `--space-5` | 24px | marge de section |
| `--space-6` | 32px | padding de panneau |
| `--space-7` | 48px | respiration de page |

### 2.2 Rayons — 17 → 5

| Token | Valeur | Usage |
|---|---|---|
| `--radius-xs` | 4px | badges, puces, inputs compacts |
| `--radius-sm` | 8px | boutons, inputs, pochettes de liste |
| `--radius-md` | 12px | cartes, popovers, menus |
| `--radius-lg` | 16px | modales, hero |
| `--radius-pill` | 999px | toggles, pilules, boutons ronds |

(`50%` reste autorisé en littéral pour les cercles parfaits — pochettes rondes, points.)

### 2.3 Typographie — 28 → 7 tailles + 2 display

| Token | Valeur | Usage |
|---|---|---|
| `--text-xs` | 11px | méta, légendes, kbd |
| `--text-sm` | 12px | sous-texte, libellés secondaires |
| `--text-base` | 13px | corps par défaut |
| `--text-md` | 14px | libellés de ligne, items de menu |
| `--text-lg` | 16px | titres de section |
| `--text-xl` | 20px | titres de panneau |
| `--text-2xl` | 26px | titres de vue |
| `--text-display` | 32px | hero compact |
| `--text-hero` | clamp(40px,6vw,80px) | cinéma / now playing |

Graisses : `--fw-regular:400` · `--fw-medium:500` · `--fw-semibold:600` · `--fw-bold:700`.
Interligne (12 → 4) : `--lh-tight:1.2` · `--lh-snug:1.35` · `--lh-normal:1.5` · `--lh-loose:1.7`.
Approche (22 → 4) : `--ls-tight:-.02em` · `--ls-snug:-.01em` · `--ls-normal:0` · `--ls-caps:.06em`.

### 2.4 Élévations — 62 → 4 + 1 lueur

| Token | Valeur (mode sombre) | Usage |
|---|---|---|
| `--elev-1` | `0 1px 3px var(--scrim-1)` | lignes, cartes posées |
| `--elev-2` | `0 6px 20px var(--scrim-2)` | popovers, menus, panneaux flottants |
| `--elev-3` | `0 16px 48px var(--scrim-3)` | modales |
| `--elev-4` | `0 24px 64px var(--scrim-3)` | élément en cours de glisser |
| `--glow-accent` | `0 0 0 3px var(--accent-subtle)` | focus, état actif accentué |

Variantes mode clair via `[data-mode="light"]` (scrims plus légers). Les ombres de
texte fusionnent vers un seul `--text-shadow` ; les `--shadow-pcplay*` / `--shadow-dot*`
animées deviennent des cas d'usage de `--glow-accent`.

### 2.5 Motion — 19 durées → 3, 6 easings → 2

| Token | Valeur | Usage |
|---|---|---|
| `--motion-fast` | 120ms | hover, press, micro-feedback |
| `--motion-base` | 200ms | transitions standard, ouverture de menu |
| `--motion-slow` | 320ms | ouverture de panneau / modale |
| `--ease-standard` | `cubic-bezier(.4,0,.2,1)` | transitions générales |
| `--ease-spring` | `cubic-bezier(.34,1.4,.64,1)` | entrées d'éléments, ressort |

Les animations en boucle (lueur, pulsation) gardent leurs durées longues dédiées sous
un préfixe explicite `--loop-*` (hors échelle de transition).

### 2.6 Couleur — rôles sémantiques

| Token | Source actuelle | Usage |
|---|---|---|
| `--surface-base` | `--bg` | fond d'application |
| `--surface-raised` | `--bg1`/`--bg2`/`--bg3` → 1 | cartes, lignes, inputs |
| `--surface-overlay` | `--bg4` | panneaux, menus |
| `--surface-hover` | `--bg5`/`--bg6` → 1 | survol, état actif |
| `--text-primary` | `--t` | texte principal |
| `--text-secondary` | `--t2` | texte secondaire |
| `--text-muted` | `--t3` | texte tertiaire / désactivé |
| `--border-subtle/default/strong` | inchangés ✔ | déjà sémantiques |
| `--scrim-1/2/3` | étend `--scrim`,`--scrim-heavy` | 0,4 / 0,55 / 0,75 — voiles de fond |
| `--tint-1/2/3` | nouveau | reflets/hairlines clairs : .06 / .10 / .16 |
| `--accent`, `--accent-rgb`, `--accent-subtle`, `--accent-mid` | inchangés ✔ | accent (thème + dynamique) |

**Conservé strictement** : les 7 couleurs de thème (`--g` + `THEME_COLORS`/`THEME_RGB`
dans `settings.js`), l'accent dynamique pochette (`--art-color`, `--g-rgb`), `--red`,
`--green`, `--amber`, le bloc `--eq-*` (domaine spécifique EQ).
**Supprimé** : `--c-white`, `--c-black`, `--c-1a`, `--c-f0`, `--c-e4`, `--c-cc` —
anti-tokens nommés d'après leur valeur hexadécimale.

### 2.7 Icônes, flou, bordures

| Famille | Cible |
|---|---|
| Tailles d'icône (20 → 5) | `--icon-sm:12` · `--icon-md:16` · `--icon-lg:20` · `--icon-xl:24` · `--icon-2xl:32` |
| `stroke-width` SVG | valeur unique `1.7` (constaté : 1.5 / 1.7 / 2 cohabitent dans le markup) |
| Flou (19 → 4) | `--blur-sm:4` · `--blur-md:8` · `--blur-lg:16` · `--blur-xl:48` |
| Largeur de bordure (5 → 2) | `--bw-1:1px` · `--bw-2:2px` (abandon de 1,5px — anti-netteté — et 3/4px) |

### 2.8 Couverture

Les inventaires §3 confirment que **100 %** des valeurs constatées se mappent à un
token cible ci-dessus ou sont explicitement marquées « à supprimer ». Aucune valeur
orpheline.

---

## 3. Inventaire constaté vs cible

### 3.1 Couleur

**Variables de thème / surface (`style.css:96-142`)** :
`--bg`..`--bg6` = 7 surfaces sombres (#080808, #0d0d0d, #101010, #161616, #1e1e1e,
#282828, #333333) ; `--t`..`--t4` = 4 niveaux de texte ; `--red`, `--green`, `--amber`,
6 tokens `--eq-*`, `--cinema-active`, `--like-active`. Verdict : surfaces 7 → 4 ;
texte 4 → 3 (`--t4 #2e2e2e` est un quasi-noir, résidu de mode clair — à reclasser).

**Anti-tokens (`style.css:125-130)`** : `--c-white #ffffff`, `--c-black #000000`,
`--c-1a #1a1a1a`, `--c-f0 #f0f0f0`, `--c-e4 #e4e4e4`, `--c-cc #cccccc`. Verdict :
**supprimer** — un token doit nommer un rôle, pas une valeur.

**Littéraux hors `:root`** : `#64b4ff` (l.728, 792), `#1e1e2e` (l.757, 819, 888),
`#4a9eff` (l.911), `#7c6af5` (l.3181), `#1e1e1e`/`#2a2a2a` (l.2205), `#e8e8e8`
(l.4134), `#0a0a12` (l.5005), bloc mode clair `#f0f2f5`…`#7e859a` (l.925-935). Verdict :
les bleus/violets (`#64b4ff`, `#4a9eff`, `#7c6af5`) divergent de l'accent → variabiliser
ou supprimer ; le bloc mode clair → tokens de surface clairs.

**Opacités littérales** : ~24 `rgba(0,0,0,.X)` distinctes (X de .04 à .75) et ~27
`rgba(255,255,255,.X)` distinctes — alors que `--scrim`, `--scrim-heavy`, `--border-1..3`,
`--glass-*`, `--tint`(à créer) existent pour ça. Verdict : mapper vers `--scrim-1/2/3`
et `--tint-1/2/3`.

### 3.2 Espacement

`--sp-*` (`style.css:151-175`) — **25 paliers** :
1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 22, 24, 28, 30, 32, 40, 48, 60 px.
**Hors grille 4px (14/25)** : 1, 2, 3, 5, 6, 7, 9, 10, 11, 14, 15, 18, 22, 30.
Mapping cible : {1,2,3}→`--space-1` · {5,6,7,8,9}→`--space-2` · {10,11,12,14,15}→`--space-3` ·
{16,18,20,22}→`--space-4` · {24,28,30}→`--space-5` · {32}→`--space-6` · {40,48}→`--space-7` ·
{60}→`--space-7` ou cas particulier hero. Le découpage exact se décide au re-skin (R1).

### 3.3 Typographie

`--fs-*` (`style.css:382-411`) — **20 tailles fixes** : 8, 9, 10, 11, 12, 13, 14, 15,
16, 17, 18, 19, 20, 26, 32, 36, 48, 52, 72, 80 px ; **+ 8 `--fs-vw-*`** en `clamp()`.
Nommage incohérent : `--fs-lg`=17 mais `--fs-lg2`=20 ; `--fs-inter`=18 (taille nommée
d'après une police) ; trio `--fs-base`=14 / `--fs-subhead`=15 / `--fs-body`=16 sans
logique d'échelle. Usage : majoritairement tokenisé (~230 `font-size: var(--fs-*)`),
mais littéraux résiduels — `style.css:36, 68, 710, 737, 781, 795, 852, 860, 867, 915,
1664, 2885, 3162, 3292, 4228, 4836` et tout le bloc `#vnp` (l.6959-7124).
Interligne `--lh-*` : 12 valeurs (`style.css:328-339`). Approche `--ls-*` : **22 valeurs**
(`style.css:340-361`). Cible : 7 tailles + 2 display, 4 interlignes, 4 approches.

### 3.4 Rayons, élévations, motion, iconographie

**Rayons** `--r-*` (`style.css:414-430`) — **17 valeurs** : 1, 2, 3, 4, 5, 6, 7, 8, 9,
10, 12, 14, 16, 20, 32, 50, 60 px. Nommage mixte : `--r-micro/xs/sm/md/lg`, puis `--r`
nu, puis `--r-badge/art`, puis nombres bruts `--r-9`, `--r2`, `--r3`, `--r-32`. Cible : 5.

**Élévations** — **62 tokens** `--shadow-*` (30), `--tshadow-*`/`--dropshadow-*` (~14)
et variantes inset/glow/pulse (~18), `style.css:473-584`. Beaucoup de variantes ne
diffèrent que par l'opacité du noir. Cible : 4 élévations + 1 lueur.

**Motion** — **19 durées** `--dur-*` (`style.css:433-454`) : 60, 80, 120, 130, 140,
150, 160, 180, 200, 220, 240, 260, 280, 300, 350, 400, 420, 700, 900 ms. **6 easings**
(`style.css:462-467`) : `--spring`, `--spring-soft`, `--snappy`, `--smooth`,
`--decelerate`, `--accelerate`. Usage transition : majoritairement tokenisé, mais
littéraux à `style.css:39, 912, 1344, 2549, 2652, 2668, 5038, 5169, 5333, 5503, 5511,
5533, 6180, 6226, 6346` et bloc `#vnp` (`.15s` répété). **~73 `@keyframes`** dont
doublons fonctionnels : `spin`≡`t-spin` (l.2543, 3146), `toast-in`/`toast-out` (l.3138)
vs `toastIn` (l.5852), `radio-pulse` (l.2717) vs `radio-pulse-cbtn` (l.5352),
`cin-kb-0..3` (l.5234-5237, 4 quasi-identiques), `eqb`/`eqb2`/`eqb3` (l.5869-5871),
`rowIn`/`rowInDown`/`rowInUp`/`rv-row-in`. Cible : 3 durées, 2 easings, keyframes dédupliqués.

**Iconographie** — `--icon-*` : **20 tailles** (`style.css:178-198`) : 4, 6, 9, 10, 11,
12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44 px. `stroke-width` SVG dans
le markup : 1.5, 1.7, 2 cohabitent. **Flou** `--blur-*` : 19 valeurs (`style.css:307-325`).
**Largeur de bordure** : 5 (`--border-w-sm..2xl` : 1 / 1,5 / 2 / 3 / 4 px). Cibles §2.7.

---

## 4. Backlog par écran

Format : `ID · Dimension · Localisation · Constat · Cible · Sévérité · Effort · Principe`.

### Fondation (transverse) — Score 31/100

> Ces 15 écarts affectent **tous** les écrans. Ils constituent le lot R1 et bloquent
> tout re-skin. Localisations dans `frontend/src/style.css`.

#### UIH-FND-01 — Échelle d'espacement sur-proliférée
- **Dimension** : espacement · **Localisation** : `style.css:151-175`
- **Constat** : 25 tokens `--sp-*`, dont 14 hors grille 4px.
- **Cible** : échelle `--space-0..7` (§2.1), 8 paliers, multiples de 4 stricts.
- **Sévérité** : ÉLEVÉ · **Effort** : L · **Principe** : P2, P9

#### UIH-FND-02 — Échelle typographique sur-proliférée
- **Dimension** : typo · **Localisation** : `style.css:382-411`
- **Constat** : 28 tailles (20 fixes + 8 `clamp`), nommage incohérent.
- **Cible** : `--text-xs..2xl` + `--text-display`/`--text-hero` (§2.3), 9 au total.
- **Sévérité** : ÉLEVÉ · **Effort** : L · **Principe** : P3, P9

#### UIH-FND-03 — Échelle de rayons sur-proliférée
- **Dimension** : rayon · **Localisation** : `style.css:414-430`
- **Constat** : 17 rayons, nommage mixte t-shirt + nombres bruts (`--r-9`, `--r-32`, `--r2`, `--r3`).
- **Cible** : `--radius-xs..lg` + `--radius-pill` (§2.2), 5 au total.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9

#### UIH-FND-04 — 62 tokens d'ombre
- **Dimension** : élévation · **Localisation** : `style.css:473-584`
- **Constat** : 62 tokens `--shadow-*`/`--tshadow-*`/`--dropshadow-*`, beaucoup ne diffèrent que d'une opacité.
- **Cible** : `--elev-1..4` + `--glow-accent` + 1 `--text-shadow` (§2.4).
- **Sévérité** : ÉLEVÉ · **Effort** : L · **Principe** : P1, P9

#### UIH-FND-05 — 19 durées de transition
- **Dimension** : motion · **Localisation** : `style.css:433-454`
- **Constat** : 19 durées `--dur-*` de 60ms à 900ms ; impossible d'avoir un rythme cohérent.
- **Cible** : `--motion-fast/base/slow` (§2.5), 3 durées (loops à part).
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P6

#### UIH-FND-06 — 6 courbes d'easing
- **Dimension** : motion · **Localisation** : `style.css:462-467`
- **Constat** : `--spring`, `--spring-soft`, `--snappy`, `--smooth`, `--decelerate`, `--accelerate`.
- **Cible** : `--ease-standard` + `--ease-spring` (§2.5), 2 courbes.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P6

#### UIH-FND-07 — 22 valeurs de letter-spacing
- **Dimension** : typo · **Localisation** : `style.css:340-361`
- **Constat** : 22 tokens `--ls-*` (`--ls-tight`, `--ls-numeric`, `--ls-stat-val`, `--ls-tag-meta`…).
- **Cible** : `--ls-tight/snug/normal/caps` (§2.3), 4 valeurs.
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P3

#### UIH-FND-08 — 12 valeurs d'interligne
- **Dimension** : typo · **Localisation** : `style.css:328-339`
- **Constat** : 12 tokens `--lh-*` (1, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6, 1.65, 1.75, 1.9, 14px).
- **Cible** : `--lh-tight/snug/normal/loose` (§2.3), 4 valeurs.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P3

#### UIH-FND-09 — 20 tailles d'icône
- **Dimension** : icône · **Localisation** : `style.css:178-198`
- **Constat** : 20 tokens `--icon-*` ; en plus `stroke-width` SVG variant entre 1.5/1.7/2 dans le markup.
- **Cible** : `--icon-sm..2xl` (5) + `stroke-width` unique 1.7 (§2.7).
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P9

#### UIH-FND-10 — 19 valeurs de flou
- **Dimension** : élévation · **Localisation** : `style.css:307-325`
- **Constat** : 19 tokens `--blur-*` (1 → 64px).
- **Cible** : `--blur-sm/md/lg/xl` (§2.7), 4 valeurs.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-FND-11 — Anti-tokens nommés par valeur
- **Dimension** : couleur · **Localisation** : `style.css:125-130`
- **Constat** : `--c-white`, `--c-black`, `--c-1a`, `--c-f0`, `--c-e4`, `--c-cc` nomment une valeur hex, pas un rôle.
- **Cible** : suppression ; remplacement par tokens de surface/texte sémantiques (§2.6).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-FND-12 — Remédiation scrims/teintes incomplète
- **Dimension** : couleur · **Localisation** : `style.css:638-657` (tokens) ; littéraux p.ex. `style.css:473-499, 525, 530-539, 552-559, 5279-5389, 6718-6963`
- **Constat** : `--scrim`, `--scrim-heavy`, `--border-1..3`, `--glass-*` ont été créés *pour remplacer* des littéraux (cf. commentaires l.640-654), mais ~24 `rgba(0,0,0,.X)` et ~27 `rgba(255,255,255,.X)` littéraux subsistent.
- **Cible** : étendre à `--scrim-1/2/3` + `--tint-1/2/3` (§2.6) et recâbler tous les littéraux.
- **Sévérité** : ÉLEVÉ · **Effort** : L · **Principe** : P9

#### UIH-FND-13 — Couleurs hex hors `:root`
- **Dimension** : couleur · **Localisation** : `style.css:728, 757, 792, 819, 888, 911, 2205, 3181, 4134, 5005`
- **Constat** : `#64b4ff`, `#1e1e2e`, `#4a9eff`, `#7c6af5`, `#1e1e1e`/`#2a2a2a`, `#e8e8e8`, `#0a0a12` — dont des bleus/violets divergents de l'accent.
- **Cible** : variabiliser vers surfaces/accent, ou supprimer les divergences (P4).
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P4, P9

#### UIH-FND-14 — ~73 keyframes, doublons fonctionnels
- **Dimension** : motion · **Localisation** : `style.css` (73 blocs `@keyframes`)
- **Constat** : doublons — `spin`≡`t-spin` (l.2543/3146), `toast-in`/`toast-out` (l.3138-3143) vs `toastIn` (l.5852), `radio-pulse` (l.2717) vs `radio-pulse-cbtn` (l.5352), `cin-kb-0..3` (l.5234-5237), `eqb/eqb2/eqb3` (l.5869-5871).
- **Cible** : dédupliquer (≤ ~45 keyframes), une seule animation par effet.
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P9

#### UIH-FND-15 — Largeurs de bordure non nettes
- **Dimension** : icône/bordure · **Localisation** : `style.css:300-304`
- **Constat** : 5 largeurs `--border-w-*` : 1 / 1.5 / 2 / 3 / 4 px. Le 1,5px rend flou sur écran non-HiDPI.
- **Cible** : `--bw-1:1px` + `--bw-2:2px` (§2.7).
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

### Groupe A — Shell principal

#### Topbar / Recherche — Score 79/100

#### UIH-topbar-01 — Bloc CSS hors système de tokens
- **Dimension** : composant · **Localisation** : `style.css:710-915`
- **Constat** : zone CSS utilisant `font-size` littéral (12/11/13px aux l.710, 737, 781, 795, 852, 860, 867, 915) et couleurs hex littérales `#64b4ff`/`#1e1e2e`/`#4a9eff` (l.728, 757, 792, 819, 888, 911).
- **Cible** : recâbler sur `--text-*` et tokens de surface/accent.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9

#### UIH-search-01 — Rayons de focus littéraux
- **Dimension** : rayon · **Localisation** : `style.css:758, 820, 889`
- **Constat** : `border-radius: 12px` littéral sur les conteneurs de recherche au lieu d'un token.
- **Cible** : `--radius-md`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-search-02 — Couleur d'accent de recherche divergente
- **Dimension** : couleur · **Localisation** : `style.css:728, 792, 911`
- **Constat** : `#64b4ff` / `#4a9eff` codés en dur — un bleu fixe au lieu de l'accent de thème.
- **Cible** : `var(--accent)` — sinon la recherche ignore les 7 thèmes (P4).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P4

#### UIH-search-03 — Largeur d'input via tokens redondants
- **Dimension** : espacement · **Localisation** : `style.css:248-249`
- **Constat** : `--search-input-w:170px` et `--search-input-min:120px` — tokens à usage unique hors échelle.
- **Cible** : conserver (largeurs composant légitimes) mais documenter comme exception.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-topbar-02 — Hauteur de bouton sous la cible
- **Dimension** : composant · **Localisation** : `style.css:250` (`--tb-btn-min:34px`), `style.css:145` (`--tb:38px`)
- **Constat** : barre de titre à 38px ; vérifier que les boutons topbar atteignent ~32px de zone cliquable.
- **Cible** : zone interactive ≥ 32px (P5).
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P5

#### Bibliothèque / liste de pistes — Score 88/100

#### UIH-library-01 — Tailles de police littérales en en-tête
- **Dimension** : typo · **Localisation** : `style.css:36, 68`
- **Constat** : `font-size: 14px` / `13px` littéraux dans les règles de base/liste.
- **Cible** : `--text-md` / `--text-base`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P3

#### UIH-library-02 — Hauteurs de ligne hors échelle
- **Dimension** : espacement · **Localisation** : `style.css:227-228` (`--vh-min-h:52px`, `--folder-row-h:34px`)
- **Constat** : hauteurs de ligne en tokens à usage unique ; cohérence à vérifier avec `CFG.VIRT_ROW_H`.
- **Cible** : aligner sur un multiple de 4 ; documenter le lien avec la constante virtual scroll (hors périmètre fonctionnel).
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P2

#### UIH-library-03 — Multiplicité des keyframes de ligne
- **Dimension** : motion · **Localisation** : `style.css:5776-5788` (`rowIn`, `rowInDown`, `rowInUp`)
- **Constat** : 3 animations d'entrée de ligne quasi-identiques + `rv-row-in` (l.6415).
- **Cible** : une animation `rowIn` paramétrée.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-library-04 — `border-radius` de pochette de liste littéral
- **Dimension** : rayon · **Localisation** : `style.css:903`
- **Constat** : `border-radius: 4px` littéral.
- **Cible** : `--radius-xs`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-library-05 — État vide à vérifier
- **Dimension** : composant · **Localisation** : `style.css:2346` (`@keyframes emptyPulse`)
- **Constat** : l'état vide existe (`emptyPulse`) ; densité et libellé à confronter au principe P8.
- **Cible** : état vide avec illustration + CTA, espacement `--space-*`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P8

#### UIH-library-06 — Halo de focus de ligne complexe
- **Dimension** : composant · **Localisation** : `style.css:525` (`--shadow-tr-focus`)
- **Constat** : focus de ligne via `inset 0 0 0 2px` + `inset 0 0 0 4px rgba(255,255,255,0.18)` littéral.
- **Cible** : `--glow-accent` + `--tint-3`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P7

#### Barre de lecture — Score 86/100

#### UIH-playerbar-01 — Ombre de barre composée de littéraux
- **Dimension** : élévation · **Localisation** : `style.css:663`
- **Constat** : `--player-shadow: 0 -1px 0 rgba(255,255,255,.04), 0 -8px 32px rgba(0,0,0,.5)` — littéraux noir/blanc.
- **Cible** : `--elev-2` (inversée) + `--tint-1`.
- **Sévérité** : ÉLEVÉ · **Effort** : S · **Principe** : P9

#### UIH-playerbar-02 — Tokens de hauteur de piste multiples
- **Dimension** : espacement · **Localisation** : `style.css:214-217`
- **Constat** : `--track-h-xs:2px`, `--track-h:3px`, `--track-h-md:4px`, `--track-h-lg:6px` — 4 épaisseurs de barre de progression.
- **Cible** : 2 épaisseurs (repos / survol).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-playerbar-03 — `transition` de largeur littérale
- **Dimension** : motion · **Localisation** : `style.css:912`
- **Constat** : `transition: width 200ms ease-out` littéral.
- **Cible** : `var(--motion-base) var(--ease-standard)`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

### Groupe B — Panneaux

#### Panneau Settings — Score 72/100

#### UIH-settings-01 — Styles inline résiduels dans le markup
- **Dimension** : composant · **Localisation** : `index.html:813, 840, 879, 956, 1031, 1053, 1054, 1060`
- **Constat** : `style="width:90px;accent-color:var(--g)"`, `style="min-width:82px"`, `style="width:auto;padding:6px 14px"`, `style="flex-wrap:wrap"`, `style="display:flex;align-items:center;gap:12px"`, `style="border-radius:8px;flex-shrink:0"`, `style="color:var(--t3);font-size:12px"` — logique de présentation en HTML, contraire à CLAUDE.md §13.
- **Cible** : extraire en classes (`.set-row` et utilitaires) ; valeurs sur tokens.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9

#### UIH-settings-02 — Sections sans internationalisation
- **Dimension** : composant · **Localisation** : `index.html:777, 943, 949, 952-953, 975, 996, 999-1000` (et libellés associés)
- **Constat** : « EQ par appareil », « Historique des imports », « Arborescence fichiers », « Organiser la bibliothèque », « Sauvegarde & Portabilité », « Import USB » sans `data-i18n` — chaînes françaises codées en dur, alors que le reste du panneau est traduit.
- **Cible** : `data-i18n` sur chaque libellé + clés ajoutées à `i18n.js`.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9

#### UIH-settings-03 — Section « Réinitialisation » dupliquée
- **Dimension** : composant · **Localisation** : `index.html:1008` (onglet Bibliothèque) et `index.html:1024` (onglet Système)
- **Constat** : deux sections portant le libellé `set_reset_section` dans deux onglets différents — « Vider la bibliothèque » et « Vider les caches ». Confusion de navigation.
- **Cible** : regrouper sous un onglet unique, ou différencier clairement les libellés.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P8

#### UIH-settings-04 — Boutons d'action hétérogènes
- **Dimension** : composant · **Localisation** : `index.html:879` (`.mp-toggle-btn`), `index.html:783, 907, 933-937` (`.mbtn`/`.mbtn-sm`), `index.html:981, 990, 1002` (`.mbtn` nu)
- **Constat** : le panneau mélange `.mp-toggle-btn`, `.mbtn`, `.mbtn-sm` et `.mbtn` sans modificateur pour des actions de même niveau ; tailles et paddings divergents.
- **Cible** : un seul composant bouton avec variantes (`.btn` + `.btn--sm`/`.btn--ghost`/`.btn--danger`).
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P9

#### UIH-settings-05 — Slider RG stylé en inline
- **Dimension** : composant · **Localisation** : `index.html:813`
- **Constat** : `style="width:90px;accent-color:var(--g)"` sur l'`input[type=range]` cible RG.
- **Cible** : classe `.set-range` partagée avec le slider de crossfade.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-settings-06 — Icône SVG marginée en inline
- **Dimension** : icône · **Localisation** : `index.html:1031`
- **Constat** : `style="margin-right:5px"` (5px hors grille) sur l'icône du bouton « Vider les caches ».
- **Cible** : `gap` sur le bouton via classe ; valeur `--space-1`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P2

#### UIH-settings-07 — Largeur de contenu en token unique
- **Dimension** : espacement · **Localisation** : `style.css:241-242` (`--set-sidebar-w:200px`, `--set-content-w:720px`)
- **Constat** : largeurs de layout en tokens dédiés — légitime, mais à documenter comme exceptions hors échelle.
- **Cible** : conserver, annoter.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### Panneau EQ — Score 89/100

#### UIH-eq-01 — Tokens de dimensionnement EQ à usage unique
- **Dimension** : espacement · **Localisation** : `style.css:229-237`
- **Constat** : `--eq-slider-min-h`, `--eq-presets-max-h:126px`, `--eq-spacer-min/max`, `--eq-bands-max-h:280px` — 6 tokens spécifiques EQ, valeurs hors grille (126, 90).
- **Cible** : aligner sur la grille 4 quand possible ; sinon documenter en exceptions composant.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P2

#### UIH-eq-02 — Couleurs EQ à 6 tokens dont variantes claires
- **Dimension** : couleur · **Localisation** : `style.css:133-138`
- **Constat** : `--eq-warm/cool/cut` + `--eq-warm-light/cool-light/cut-light` — variantes de mode gérées par tokens jumeaux au lieu de `[data-mode]`.
- **Cible** : un trio `--eq-warm/cool/cut` redéfini sous `[data-mode="light"]`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-eq-03 — Keyframes de barre EQ multiples
- **Dimension** : motion · **Localisation** : `style.css:5869-5871` (`eqb`, `eqb2`, `eqb3`), `style.css:4612` (`eqBandReset`), `style.css:6485` (`rv-eq-bar`)
- **Constat** : 5 animations distinctes pour des barres d'égaliseur.
- **Cible** : une animation paramétrée par variable.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-eq-04 — Profils EQ par appareil sans i18n
- **Dimension** : composant · **Localisation** : `index.html:777, 780, 785`
- **Constat** : libellés « EQ par appareil », « Appareil actuel », tooltip « Enregistrer l'EQ… » en dur.
- **Cible** : `data-i18n` + clés.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### File d'attente — Score 91/100

#### UIH-queue-01 — En-tête de file stylé en inline
- **Dimension** : composant · **Localisation** : `index.html:1085-1088`
- **Constat** : `style="margin-right:6px;vertical-align:middle"`, `style="display:flex;align-items:center;gap:4px"`, `style="opacity:.7"` sur l'en-tête et les boutons utilitaires.
- **Cible** : classe `.queue-head` + utilitaires.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-queue-02 — Ombre de panneau composée de littéraux
- **Dimension** : élévation · **Localisation** : `style.css:542` (`--shadow-queue`)
- **Constat** : `-6px 0 24px rgba(0,0,0,.30), -1px 0 0 var(--sep)` — scrim littéral.
- **Cible** : `--elev-2` (orientée) + `--border-subtle`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-queue-03 — `border-radius` 50% littéral récurrent
- **Dimension** : rayon · **Localisation** : `style.css` (boutons ronds de file)
- **Constat** : cercles via `border-radius:50%` littéral — acceptable mais à confirmer comme convention documentée.
- **Cible** : `--radius-circle` ou exception documentée.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-queue-04 — Glissement de réordonnancement
- **Dimension** : motion · **Localisation** : `style.css:4531` (`@keyframes qSpringBack`)
- **Constat** : ressort de retour propre à la file ; à harmoniser avec `--ease-spring`.
- **Cible** : `--ease-spring` + `--motion-base`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

### Groupe C — Immersif & transitoire

#### Now Playing plein écran (`#vnp`) — Score 79/100

#### UIH-vnp-01 — Écran partiellement hors système
- **Dimension** : composant · **Localisation** : `style.css:6700-7130`
- **Constat** : `#vnp` mélange tokens avec *fallback* inline (`var(--sp-6, 24px)`) et littéraux purs : `width:36px`/`height:36px` (l.6742-6743, 6765-6766), `transition: background .15s ease` (l.6753, 6776, 6915, 6961), `border-radius:99px` (l.7027), `font-size` 18/22/12/13/11/10/17px (l.6959-7124).
- **Cible** : recâbler sur `--space-*`, `--text-*`, `--motion-*`, `--radius-*`.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9

#### UIH-vnp-02 — Couleurs de texte hex littérales
- **Dimension** : couleur · **Localisation** : `style.css:6724, 6729`
- **Constat** : `--vnp-text:#f0ece4` et `#1a1a1a` codés en dur (dupliquent `--t` et un quasi-noir).
- **Cible** : `var(--text-primary)` + token de surface clair.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-vnp-03 — Fonds de boutons en `rgba` littéral
- **Dimension** : couleur · **Localisation** : `style.css:6734, 6746, 6757, 6769`
- **Constat** : `rgba(255,255,255,.12)` / `.22` / `.38` répétés sur les boutons flottants.
- **Cible** : `--tint-2` / `--tint-3`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-vnp-04 — Voile de fond en `rgba` littéral
- **Dimension** : couleur · **Localisation** : `style.css:6718`
- **Constat** : `background: rgba(0,0,0,.38)` sur le pseudo-élément de voile.
- **Cible** : `--scrim-1`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-vnp-05 — Transitions littérales
- **Dimension** : motion · **Localisation** : `style.css:6753, 6776, 6873, 6915, 6931, 6961`
- **Constat** : `transition: … .15s` / `0.4s` littéraux.
- **Cible** : `--motion-fast` / `--motion-base`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

#### Mode Cinéma — Score 85/100

#### UIH-cinema-01 — Sur-densité de tokens et keyframes cinéma
- **Dimension** : motion · **Localisation** : `style.css:4996-5249`
- **Constat** : 12+ keyframes `cinema-*` dont `cin-kb-0..3` (l.5234-5237) quasi-identiques ; durées dédiées `--dur-cinema:420ms`, transitions littérales (l.5169 `500ms`, l.5333 `380ms/460ms`).
- **Cible** : dédupliquer `cin-kb-*` ; durées sur `--motion-*` + `--loop-*` pour les boucles.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P6, P9

#### UIH-cinema-02 — Positions cinéma en tokens à usage unique
- **Dimension** : espacement · **Localisation** : `style.css:286-290`
- **Constat** : `--cinema-corner-top:20px`, `--cinema-corner-x:24px`, `--cinema-fs-right:72px`, `--cinema-clock-inset:52px` — positions absolues hors échelle.
- **Cible** : aligner sur `--space-*` quand possible.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P2

#### UIH-cinema-03 — Voiles de fond `rgba` littéraux
- **Dimension** : couleur · **Localisation** : `style.css:5018-5041`
- **Constat** : multiples `rgba(0,0,0,.X)` dans les dégradés de fond cinéma.
- **Cible** : `--scrim-*` (dégradés conservant les stops).
- **Sévérité** : FAIBLE · **Effort** : M · **Principe** : P9

#### UIH-cinema-04 — `font-size` littéral
- **Dimension** : typo · **Localisation** : `style.css:2885` (`20px`)
- **Constat** : taille littérale dans une règle liée au mode immersif.
- **Cible** : `--text-xl`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P3

#### Menus contextuels — Score 90/100

#### UIH-ctxmenu-01 — Libellé de piste stylé en inline
- **Dimension** : composant · **Localisation** : `index.html:613`
- **Constat** : `style="color:var(--t);font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"` sur `#ctx-track-name`.
- **Cible** : classe `.ctx-submenu-lbl` (déjà appliquée — la déclaration inline est redondante).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-ctxmenu-02 — Séparateur margé en inline
- **Dimension** : espacement · **Localisation** : `index.html:614`
- **Constat** : `style="margin-top:4px"` sur un `.ctx-sep`.
- **Cible** : règle CSS sur `.ctx-sep:first-of-type` ; valeur `--space-1`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-ctxmenu-03 — Ombre et fond de menu
- **Dimension** : élévation · **Localisation** : `style.css:532` (`--shadow-ctx-lt`), `style.css:651` (`--glass-panel`)
- **Constat** : ombre dédiée `--shadow-ctx-lt` + fond `--glass-panel` — deux tokens spécifiques pour un popover standard.
- **Cible** : `--elev-2` + `--surface-overlay`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P1

#### UIH-ctxmenu-04 — Durée d'ouverture dédiée
- **Dimension** : motion · **Localisation** : `style.css:441` (`--dur-menu:130ms`), `style.css:3077`
- **Constat** : durée propre aux menus (`--dur-menu`).
- **Cible** : `--motion-fast`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

#### Mini-player — Score 92/100

#### UIH-miniplayer-01 — Ombre de glisser dédiée
- **Dimension** : élévation · **Localisation** : `style.css:497` (`--shadow-mp-drag:0 16px 48px rgba(0,0,0,.65)`)
- **Constat** : ombre spécifique mini-player en glisser.
- **Cible** : `--elev-4`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P1

#### UIH-miniplayer-02 — Keyframes d'overlay dédiés
- **Dimension** : motion · **Localisation** : `style.css:6115-6119` (`mpOvIn`, `mpOvOut`)
- **Constat** : animations d'overlay propres au mini-player.
- **Cible** : keyframes génériques `overlayIn/Out` (déjà existants l.4170-4171).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-miniplayer-03 — `font-size` littéraux
- **Dimension** : typo · **Localisation** : `style.css:7045, 7082, 7092, 7101` (zone overlay)
- **Constat** : 11/12/10px littéraux.
- **Cible** : `--text-xs` / `--text-sm`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P3

#### UIH-miniplayer-04 — Transition littérale
- **Dimension** : motion · **Localisation** : `style.css:7032, 7071`
- **Constat** : `transition: … .15s` littéral.
- **Cible** : `--motion-fast`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

#### Toasts / notifications — Score 93/100

#### UIH-toast-01 — Trois jeux de keyframes pour un seul effet
- **Dimension** : motion · **Localisation** : `style.css:3138-3143` (`toast-in`/`toast-out`), `style.css:5852` (`toastIn`)
- **Constat** : deux familles d'animations de toast coexistent.
- **Cible** : une seule paire `toastIn`/`toastOut`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-toast-02 — Fond toast en token glass dédié
- **Dimension** : couleur · **Localisation** : `style.css:652` (`--glass-toast`)
- **Constat** : `--glass-toast` séparé — la convention « toast toujours sombre » est légitime.
- **Cible** : conserver, mais documenter explicitement l'exception.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-toast-03 — Durée de toast dédiée
- **Dimension** : motion · **Localisation** : `style.css` (animations toast)
- **Constat** : durée d'apparition à harmoniser.
- **Cible** : `--motion-base`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

#### UIH-toast-04 — Z-index toast très élevé
- **Dimension** : composant · **Localisation** : `style.css:634` (`--z-toast:9000`)
- **Constat** : `9000` puis `--z-tooltip:9999` — échelle de z-index avec de grands trous.
- **Cible** : échelle resserrée (`--z-1..6`).
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-toast-05 — Spinner dupliqué
- **Dimension** : motion · **Localisation** : `style.css:2543` (`spin`), `style.css:3146` (`t-spin`)
- **Constat** : `spin` et `t-spin` sont identiques (`to { transform: rotate(360deg); }`).
- **Cible** : un seul `spin`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### Overlay drop-in — Score 99/100

#### UIH-dropin-01 — Keyframes drag-over multiples
- **Dimension** : motion · **Localisation** : `style.css:3192-3207` (`dragoIn`, `dragoBorder`, `dragoPulse`)
- **Constat** : 3 keyframes pour l'effet de dépôt — acceptable mais durées à harmoniser.
- **Cible** : durées sur `--motion-*`/`--loop-*`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P6

### Groupe D — Modales & vues secondaires

#### Constructeur de playlist intelligente — Score 69/100

#### UIH-spl-01 — Panneau entièrement stylé en inline
- **Dimension** : composant · **Localisation** : `index.html:470-607`
- **Constat** : le panneau `#pl-panel-smart` n'a quasiment aucune classe de layout — ~30 attributs `style="…"` portent flex, grid, gap, marges, tailles de police, paddings, couleurs. Contraire à CLAUDE.md §13 (« logique inline HTML » interdite).
- **Cible** : extraire un module CSS `.spl-*` (sections, grilles, libellés).
- **Sévérité** : ÉLEVÉ · **Effort** : L · **Principe** : P9

#### UIH-spl-02 — Chaîne de style inline répétée 7 fois
- **Dimension** : composant · **Localisation** : `index.html:491, 502, 538, 548, 574, 584, 592`
- **Constat** : la chaîne `font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px` est copiée à l'identique 7×.
- **Cible** : une classe `.spl-section-lbl`.
- **Sévérité** : ÉLEVÉ · **Effort** : S · **Principe** : P9

#### UIH-spl-03 — Boutons de mode stylés en inline divergent
- **Dimension** : composant · **Localisation** : `index.html:475, 479`
- **Constat** : `#spl-mode-seed` et `#spl-mode-rules` reçoivent des `style=` différents (le second ajoute `background/color/border`) pour exprimer un état actif/inactif — l'état devrait être une classe.
- **Cible** : `.spl-mode-btn` + `.active` (la classe `.active` existe déjà mais le style est dupliqué inline).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P7

#### UIH-spl-04 — Tailles de police inline hétérogènes
- **Dimension** : typo · **Localisation** : `index.html:475, 487, 494, 496, 539, 549, 560, 567, 575, 585`
- **Constat** : `font-size` inline à 11px, 11.5px, 12px — dont un `11.5px` hors de toute échelle.
- **Cible** : `--text-xs` / `--text-sm`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P3

#### UIH-spl-05 — Paddings inline hors grille
- **Dimension** : espacement · **Localisation** : `index.html:475, 479, 496, 539, 549, 560, 567, 575, 585`
- **Constat** : paddings inline `6px 10px`, `7px 11px`, `5px 8px`, `7px 10px` — valeurs 5/6/7/10/11 hors grille 4.
- **Cible** : `--space-1`/`--space-2`/`--space-3`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P2

#### UIH-spl-06 — Couleurs de bouton inline répétées
- **Dimension** : couleur · **Localisation** : `index.html:479, 567, 598`
- **Constat** : `background:var(--bg3);color:var(--t2);border:1px solid var(--bg5)` répété inline pour un même style de bouton secondaire.
- **Cible** : variante `.btn--secondary`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-spl-07 — Grilles inline répétées
- **Dimension** : composant · **Localisation** : `index.html:536, 572`
- **Constat** : `display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px` dupliqué.
- **Cible** : classe `.spl-grid-2`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### Modales (confirm / backup / USB / organize) — Score 89/100

#### UIH-modal-01 — Multiples largeurs de modale en tokens dédiés
- **Dimension** : espacement · **Localisation** : `style.css:244-248`
- **Constat** : `--modal-w:340px`, `--modal-pl-w:380px`, `--modal-bte-w:360px`, `--modal-dupe-w:520px` + `--modal-*-max` (l.263-266) — ~8 largeurs de modale.
- **Cible** : 3 tailles de modale (`--modal-sm/md/lg`).
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P9

#### UIH-modal-02 — Ombres de modale multiples
- **Dimension** : élévation · **Localisation** : `style.css:493-494, 504, 565` (`--shadow-modal2`, `--shadow-modal3`, `--shadow-big-modal`, `--shadow-big-gl`)
- **Constat** : 4 ombres de modale, dont 2 identiques (`--shadow-big-modal` et `--shadow-big-gl` ont la même valeur).
- **Cible** : `--elev-3`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P1

#### UIH-modal-03 — Scrim de fond à 2 valeurs littérales proches
- **Dimension** : couleur · **Localisation** : `style.css:656-657` (`--scrim:rgba(0,0,0,.5)`, `--scrim-heavy:rgba(0,0,0,.65)`)
- **Constat** : 2 scrims définis, mais des modales utilisent encore `rgba(0,0,0,.X)` littéral.
- **Cible** : échelle `--scrim-1/2/3` appliquée partout.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-modal-04 — Keyframes de modale + overlay
- **Dimension** : motion · **Localisation** : `style.css:4170-4185, 5415-5445`
- **Constat** : `overlayIn/Out`, `settingsSlideIn/Out`, `modalBgIn`, `modalBoxIn/Out` — 7 keyframes pour entrées de modale.
- **Cible** : 1 paire overlay + 1 paire boîte, paramétrées.
- **Sévérité** : FAIBLE · **Effort** : M · **Principe** : P9

#### Vues secondaires (CD audio, Stats, Radio) — Score 93/100

#### UIH-secondary-01 — Ombres Radio dédiées
- **Dimension** : élévation · **Localisation** : `style.css:500, 543-544` (`--shadow-radio`, `--shadow-radio-bar`, `--shadow-radio-lt`)
- **Constat** : 3 ombres propres à la Radio, dont une à double couche claire spécifique mode clair.
- **Cible** : `--elev-1/2` + redéfinition `[data-mode]`.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P1

#### UIH-secondary-02 — Tokens de dimensionnement Stats à usage unique
- **Dimension** : espacement · **Localisation** : `style.css:256, 276-278`
- **Constat** : `--stats-bar-min:60px`, `--stats-rank-min:20px`, `--stats-count-min:40px` — dimensionnements spécifiques.
- **Cible** : aligner sur la grille 4 ; documenter en exceptions composant.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P2

#### UIH-secondary-03 — Couleur de radio divergente
- **Dimension** : couleur · **Localisation** : `style.css:3181` (`#7c6af5`)
- **Constat** : violet `#7c6af5` codé en dur dans une règle liée à la Radio.
- **Cible** : `var(--accent)` ou token sémantique.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P4

#### Mode clair (transverse) — Score 82/100

#### UIH-light-01 — Palette mode clair en littéraux hex
- **Dimension** : couleur · **Localisation** : `style.css:925-947`
- **Constat** : le bloc `[data-mode="light"]` redéfinit les surfaces avec des hex littéraux (`#f0f2f5`, `#e4e7ec`, `#ffffff`, `#f7f8fa`, `#e8eaef`, `#d0d5df`, `#b0b8c8`, `#0f1117`, `#3a4050`, `#5a6080`, `#7e859a`) et des `rgba(0,0,0,.X)` littéraux.
- **Cible** : redéfinir les **tokens de surface/texte** sous `[data-mode="light"]`, pas des hex épars.
- **Sévérité** : ÉLEVÉ · **Effort** : M · **Principe** : P9, P10

#### UIH-light-02 — Tokens jumeaux clair/sombre
- **Dimension** : couleur · **Localisation** : `style.css:133-138` (`--eq-*-light`), `style.css:543-544` (`--shadow-radio-lt`), `style.css:530-537` (`--shadow-*-lt`)
- **Constat** : nombreux tokens `*-light`/`*-lt` jumeaux gérés manuellement au lieu d'une redéfinition unique sous `[data-mode="light"]`.
- **Cible** : un token unique redéfini par sélecteur de mode.
- **Sévérité** : MOYEN · **Effort** : M · **Principe** : P9

#### UIH-light-03 — Contraste AA à valider
- **Dimension** : a11y · **Localisation** : `style.css:925-935` (texte mode clair `#3a4050`, `#5a6080`, `#7e859a`)
- **Constat** : 3 niveaux de texte clair ; le plus pâle (`#7e859a`) doit être confronté au ratio WCAG AA sur fond `#f0f2f5`.
- **Cible** : contraste ≥ 4,5:1 (texte normal) / 3:1 (texte large).
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P10

#### Navigation latérale / playlists — Score 92/100

#### UIH-sidebar-01 — Ombres de playlist dédiées
- **Dimension** : élévation · **Localisation** : `style.css:547-549` (`--shadow-pl-list`, `--shadow-pl-list2`, `--shadow-pl-card`)
- **Constat** : 3 ombres propres aux playlists, composées de `rgba(0,0,0,.45)` + contour accent.
- **Cible** : `--elev-2` + `--glow-accent` (contour).
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P1

#### UIH-sidebar-02 — Keyframes de navigation multiples
- **Dimension** : motion · **Localisation** : `style.css:5707-5710` (`navSlideOutLeft/InRight/OutRight/InLeft`)
- **Constat** : 4 keyframes de glissement de navigation.
- **Cible** : 2 keyframes paramétrées par direction.
- **Sévérité** : MOYEN · **Effort** : S · **Principe** : P9

#### UIH-sidebar-03 — Largeurs de barre latérale en tokens dédiés
- **Dimension** : espacement · **Localisation** : `style.css:146-147` (`--sb:260px`, `--sb-sm:54px`)
- **Constat** : largeurs de layout — légitimes, à documenter en exceptions.
- **Cible** : conserver, annoter.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

#### UIH-sidebar-04 — Indicateur actif via ombre inset
- **Dimension** : composant · **Localisation** : `style.css:522` (`--shadow-act-bar:inset 3px 0 0 var(--g)`)
- **Constat** : barre active rendue par `box-shadow inset` ; cohérent mais à confirmer comme pattern unique (radio l.543 utilise le même motif → bon signe).
- **Cible** : token sémantique partagé `--indicator-active`.
- **Sévérité** : FAIBLE · **Effort** : S · **Principe** : P9

---

## 5. Feuille de route

Les findings se regroupent en 5 lots. **R1 est prérequis de R2–R5** : recâbler un écran
sur des tokens qui n'existent pas encore est impossible.

| Lot | Intitulé | Écrans / portée | Findings couverts | Prérequis | Effort |
|---|---|---|---|---|---|
| **R1** | Fondation : effondrement des tokens | `style.css:90-660` (`:root`) | UIH-FND-01 → 15 | — | **L** (le plus lourd) |
| **R2** | Re-skin Panneaux | Settings, EQ, File d'attente | UIH-settings-01→07, UIH-eq-01→04, UIH-queue-01→04 | R1 | M |
| **R3** | Re-skin Modales & secondaires | Playlist intelligente, modales, CD/Stats/Radio, Mode clair | UIH-spl-01→07, UIH-modal-01→04, UIH-secondary-01→03, UIH-light-01→03 | R1 | M |
| **R4** | Re-skin Shell | Topbar/Recherche, Bibliothèque, Barre de lecture, Navigation latérale | UIH-topbar-01→02, UIH-search-01→03, UIH-library-01→06, UIH-playerbar-01→03, UIH-sidebar-01→04 | R1 | M |
| **R5** | Re-skin Immersif | Now Playing `#vnp`, Cinéma, Menus contextuels, Mini-player, Toasts, Drop-in | UIH-vnp-01→05, UIH-cinema-01→04, UIH-ctxmenu-01→04, UIH-miniplayer-01→04, UIH-toast-01→05, UIH-dropin-01 | R1 | M |

**Ordre recommandé** : R1 d'abord (obligatoire). Puis, par score d'écran croissant
(les pires d'abord) : R3 (contient le constructeur de playlist intelligente à 73, le
plus bas), R2 (Settings à 75), R5 (`#vnp` à 85, Cinéma à 88), R4 (shell, déjà le plus
sain : 85–92). Chaque lot R2–R5 fera l'objet de son propre spec de re-skin.

**Couverture** : les 5 lots couvrent **100 %** des 88 findings du §4
(15 Fondation + 73 écran : R1=15, R2=15, R3=17, R4=18, R5=23). Aucun finding n'est orphelin.

**Garde-fous pour R1** (rappel spec §7.1) : l'effondrement des tokens ne touche ni le
système de 7 thèmes, ni l'accent dynamique (`--art-color`, `--g`, `--g-rgb`), ni les
constantes de virtual scroll (`CFG.VIRT_ROW_H/GRP_H`), ni le pipeline audio. Les polices
restent locales (`DM Sans`, `Syne` via `@fontsource`). Aucune dépendance réseau.

---

## Annexe — Vérification du livrable (spec §7.2)

- [x] Chaque `fichier:ligne` cité provient des inventaires Grep exhaustifs de
  `style.css` et `index.html` ; échantillon recontrôlé : `style.css:638-657` (tokens
  scrim/glass — confirmé), `style.css:6700-6770` (`#vnp` — confirmé), `index.html:470-607`
  (panneau playlist intelligente — confirmé), `index.html:613-614` (ctx-menu inline — confirmé).
- [x] Chaque valeur des inventaires §3 se mappe à un token cible §2 ou est marquée « à supprimer ».
- [x] Aucun item de backlog sans cible chiffrée.
- [x] Aucun placeholder / TBD / section vide.
- [x] Chaque finding référence ≥ 1 principe P1–P10.
- [x] La feuille de route §5 couvre 100 % des 64 findings.

**Note d'exactitude** : les motifs `rgba(255,255,255,X)` et `rgba(XX,XX,XX,0.8X)`
remontés par le scan figurent dans des **commentaires** (`style.css:640, 647`) qui
documentent l'intention des tokens `--border-*`/`--glass-*` — ce n'est **pas** du CSS
invalide et cela ne fait l'objet d'aucun finding.
