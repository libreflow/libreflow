# Harmonisation UI — R2 Panneaux — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminer le lot R2 de la roadmap d'harmonisation (audit §5) — recâbler les panneaux Settings, EQ et File d'attente sur les échelles de tokens canoniques R1, en résolvant les 15 findings `UIH-settings-01→07`, `UIH-eq-01→04`, `UIH-queue-01→04`.

**Architecture:** Travail principalement CSS + HTML + i18n, sur trois fichiers (`frontend/src/style.css`, `frontend/index.html`, `frontend/src/i18n.js`). Aucune logique runtime, aucun module audio/état/virt touché. Les tâches sont ordonnées par risque croissant : tokens CSS purs d'abord (T1–T4), puis markup HTML et i18n (T5–T8). Chaque tâche est un commit autonome et vérifiable.

**Tech Stack:** CSS (variables natives), HTML, JS ESM (`i18n.js`), build Vite 7, vérification `npm run vite:build` + `npm test`.

**Spec source:** `docs/superpowers/audits/ui-harmonization-audit.md` §4 (Groupe B) et §5 (lot R2).

---

## Notes d'exécution

- **Branche** : `feat/ui-harmonization-r1-fondation` (branche de feature déjà active — pas de worktree à créer, ne jamais travailler sur `master`).
- **Commits scopés — RÈGLE STRICTE** : chaque commit ne `git add` que les fichiers explicitement listés dans la tâche. **Ne jamais `git add -A` ni `git add .`** : l'arbre de travail contient ~26 fichiers WIP non liés (campagne de correctifs « B## ») + `package.json`/`package-lock.json` (bump Vite) qui ne doivent **pas** entrer dans ces commits.
- **Type de commit** : `feat(ui): …` (conventional commits, validé par `commitlint.config.js`), cohérent avec R1 (`73faf69`) et R2 (`babceb7`). Pas d'attribution (désactivée pour le projet).
- **Garde-fous R1 (rappel audit §5)** : ne toucher ni le système de 7 thèmes, ni l'accent dynamique (`--art-color`, `--g`, `--g-rgb`), ni les constantes de virtual scroll (`CFG.VIRT_ROW_H/GRP_H`), ni le pipeline audio. Polices locales `@fontsource` uniquement, aucune dépendance réseau.
- **Tokens canoniques disponibles** (posés par R1, `style.css` ~ligne 105) :
  - Espacement : `--space-0:0 --space-1:4px --space-2:8px --space-3:12px --space-4:16px --space-5:24px --space-6:32px --space-7:48px`
  - Rayons : `--radius-xs:4px --radius-sm:8px --radius-md:12px --radius-lg:16px --radius-pill:999px`
  - Typo : `--text-xs:11px --text-sm:12px --text-base:13px --text-md:14px --text-lg:16px --text-xl:20px --text-2xl:26px`
  - Graisses : `--fw-regular:400 --fw-medium:500 --fw-semibold:600 --fw-bold:700`
  - Élévations : `--elev-1 --elev-2 --elev-3 --elev-4`, `--glow-accent`
  - Motion : `--motion-fast:120ms --motion-base:200ms --motion-slow:320ms`, `--ease-standard`, `--ease-spring`
  - Voiles/teintes : `--scrim-1/2/3`, `--tint-1/2/3`
- **Vérification visuelle** : le projet n'a pas de test CSS automatisé (cf. testing.md). Après chaque tâche, la vérification automatisée est `npm run vite:build` (le CSS/HTML parse) + `npm test` (JS non cassé). Une passe visuelle manuelle (`npm run dev` → ouvrir Settings / EQ / File d'attente, mode clair + sombre) est requise en fin de plan (Task 9).
- **Format de message de tâche** : si une transformation exacte dépend du contenu courant d'un fichier, la tâche commence par une étape `Read` ; la règle de transformation est ensuite donnée précisément (mapping valeur→token).

---

## File Structure

| Fichier | Responsabilité dans ce plan | Tâches |
|---|---|---|
| `frontend/src/style.css` | Variables EQ, keyframes, ombres, classes des panneaux | T1, T2, T3, T4, T7, T8 |
| `frontend/index.html` | Markup Settings / EQ / File d'attente : `data-i18n`, classes, suppression des `style=` inline | T5, T6, T7, T8 |
| `frontend/src/i18n.js` | Clés de traduction FR/EN ajoutées | T5 |

---

## Task 1: EQ — couleurs consolidées sur `[data-mode]` (UIH-eq-02)

Élimine les tokens jumeaux `--eq-*-light` au profit d'une redéfinition du trio sous `html[data-mode="light"]` (P9 : un token, deux valeurs de thème — pas deux tokens).

**Files:**
- Modify: `frontend/src/style.css` (~`:root` ligne 133-138 ; bloc `html[data-mode="light"]`)

- [ ] **Step 1: Lire les déclarations EQ couleur**

Read `frontend/src/style.css` lignes 128-145. Relever les 6 valeurs : `--eq-warm`, `--eq-cool`, `--eq-cut`, `--eq-warm-light`, `--eq-cool-light`, `--eq-cut-light`.

- [ ] **Step 2: Recenser les consommateurs des tokens `-light`**

Run Grep, output_mode `content`, `-n` true, pattern `--eq-(warm|cool|cut)-light`, path `frontend/src/style.css`.
Expected: liste des règles utilisant les variantes claires (probablement des sélecteurs `html[data-mode="light"] …`).

- [ ] **Step 3: Redéfinir le trio sous `[data-mode="light"]`**

Dans le `:root`, conserver uniquement `--eq-warm`, `--eq-cool`, `--eq-cut` (valeurs sombres) ; supprimer les 3 lignes `--eq-*-light`.
Localiser le bloc `html[data-mode="light"]` qui (re)définit des variables (le même bloc où R1 a déjà retiré `--shadow-settings`, vers `style.css:1205+`) et y ajouter :

```css
  /* EQ — couleurs de bande en mode clair (remplace les tokens --eq-*-light, UIH-eq-02) */
  --eq-warm: <valeur de --eq-warm-light relevée au Step 1>;
  --eq-cool: <valeur de --eq-cool-light relevée au Step 1>;
  --eq-cut:  <valeur de --eq-cut-light relevée au Step 1>;
```

- [ ] **Step 4: Recâbler les consommateurs**

Pour chaque règle relevée au Step 2 qui utilisait `var(--eq-warm-light)` etc., remplacer par `var(--eq-warm)` (resp. cool/cut) et supprimer le sélecteur `html[data-mode="light"]` devenu redondant **uniquement si** la règle ne servait qu'à substituer la couleur. Si la règle fait autre chose, ne garder que le retrait de la couleur.

- [ ] **Step 5: Vérifier qu'aucune référence `-light` ne subsiste**

Run Grep, pattern `--eq-(warm|cool|cut)-light`, path `frontend/src/style.css`.
Expected: 0 résultat.

- [ ] **Step 6: Build**

Run: `npm run vite:build`
Expected: `✓ built` sans erreur de parsing CSS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(ui): R2 EQ - couleurs de bande consolidees sur data-mode (UIH-eq-02)"
```

---

## Task 2: EQ — keyframes de barre consolidées (UIH-eq-03)

Réduit les 5 keyframes d'égaliseur. Approche conservatrice : fusionner les variantes de phase, garder les animations à finalité distincte.

**Files:**
- Modify: `frontend/src/style.css` (keyframes `eqb`/`eqb2`/`eqb3` ~5869-5871, `eqBandReset` ~4612, `rv-eq-bar` ~6485 ; règles qui les appliquent)

- [ ] **Step 1: Lire les 5 keyframes**

Read `frontend/src/style.css` autour de 5865-5880, 4608-4620, 6480-6492. Noter pour chacune : les pourcentages et les valeurs `transform`/`scaleY`.

- [ ] **Step 2: Décider du regroupement**

Règle de décision :
- Si `eqb`, `eqb2`, `eqb3` ne diffèrent que par l'amplitude ou la phase d'un même rebond de barre → les fusionner en une seule `eqb`, les variantes étant obtenues sur les sélecteurs consommateurs via `animation-delay` et/ou `animation-duration` (et non par 3 keyframes).
- `eqBandReset` (réinitialisation ponctuelle d'une bande) et `rv-eq-bar` (barre de la radio-viz) ont des finalités distinctes : **les conserver**, mais aligner leur `animation-timing-function` sur `--ease-standard` et leur durée sur un token `--motion-*` si elles utilisent une valeur littérale.

- [ ] **Step 3: Appliquer la fusion**

Supprimer `@keyframes eqb2` et `@keyframes eqb3`. Conserver `@keyframes eqb`.
Run Grep, pattern `animation[^;]*eqb[23]`, path `frontend/src/style.css`, pour trouver les consommateurs de `eqb2`/`eqb3` ; les recâbler sur `eqb` avec un `animation-delay` distinct (ex. `60ms`, `120ms`) pour conserver l'effet de phase décalée.

- [ ] **Step 4: Aligner le motion résiduel**

Sur `eqBandReset` et `rv-eq-bar` (et leurs consommateurs), remplacer toute durée littérale par `--motion-fast`/`--motion-base` et tout easing littéral par `var(--ease-standard)`.

- [ ] **Step 5: Build + vérification**

Run: `npm run vite:build`
Expected: `✓ built`.
Run Grep, pattern `@keyframes eqb[23]`, path `frontend/src/style.css`. Expected: 0 résultat.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(ui): R2 EQ - keyframes de barre consolidees (UIH-eq-03)"
```

---

## Task 3: Tokens de dimensionnement — EQ, largeurs Settings, ombre/rayon File d'attente (UIH-eq-01, UIH-settings-07, UIH-queue-02, UIH-queue-03)

Aligne sur la grille 4px ce qui peut l'être, documente le reste en exceptions composant, et recâble l'ombre de la file.

**Files:**
- Modify: `frontend/src/style.css` (`:root` lignes ~229-242 ; `--shadow-queue` ~542)

- [ ] **Step 1: Lire les tokens concernés**

Read `frontend/src/style.css` lignes 225-245 (tokens `--eq-*` et `--set-*`) et la ligne du token `--shadow-queue` (~542).

- [ ] **Step 2: Aligner les tokens de dimensionnement EQ (UIH-eq-01)**

Pour `--eq-slider-min-h`, `--eq-presets-max-h:126px`, `--eq-spacer-min`, `--eq-spacer-max`, `--eq-bands-max-h:280px` :
- Toute valeur déjà multiple de 4 (ex. 280) : inchangée.
- `126px` → `128px` (multiple de 4 le plus proche, écart visuel négligeable sur un `max-height`).
- `90px` (si présente) → `88px` ou `92px` selon la valeur la plus proche.
- Ajouter au-dessus du groupe le commentaire :
  ```css
  /* Dimensions EQ — exceptions composant alignées sur la grille 4px (UIH-eq-01).
     Tokens à usage unique : conservés car spécifiques au panneau EQ. */
  ```

- [ ] **Step 3: Annoter les largeurs de layout Settings (UIH-settings-07)**

Au-dessus de `--set-sidebar-w:200px` / `--set-content-w:720px`, ajouter :
```css
  /* Largeurs de layout du panneau Settings — exceptions hors échelle d'espacement,
     assumées : ce sont des dimensions structurelles, pas des espacements (UIH-settings-07). */
```
Ne pas changer les valeurs.

- [ ] **Step 4: Recâbler l'ombre de la File d'attente (UIH-queue-02)**

`--shadow-queue` est actuellement `-6px 0 24px rgba(0,0,0,.30), -1px 0 0 var(--sep)`.
Le remplacer par une composition orientée réutilisant le scrim canonique :
```css
  --shadow-queue: -6px 0 24px var(--scrim-1), -1px 0 0 var(--sep);
```
(`--scrim-1` = `rgba(0,0,0,.4)` ; l'écart .30→.40 est volontairement absorbé dans l'échelle canonique — vérifier le rendu en Task 9.)

- [ ] **Step 5: Documenter la convention `border-radius:50%` (UIH-queue-03)**

Ajouter dans le `:root`, à côté des tokens `--radius-*` de R1 :
```css
  --radius-circle: 50%;  /* cercle parfait — boutons ronds (file d'attente, lecteur) */
```
Run Grep, output_mode `content`, `-n` true, pattern `border-radius:\s*50%`, path `frontend/src/style.css`, pour repérer les boutons ronds de la **file d'attente** uniquement (sélecteurs `.queue-*`/`#queue*`) et y remplacer `50%` par `var(--radius-circle)`. Ne pas toucher les `50%` hors panneau file (hors périmètre R2).

- [ ] **Step 6: Build**

Run: `npm run vite:build`
Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(ui): R2 - tokens dimensionnement EQ/Settings/Queue alignes et documentes (UIH-eq-01, UIH-settings-07, UIH-queue-02-03)"
```

---

## Task 4: File d'attente — keyframe `qSpringBack` sur l'easing canonique (UIH-queue-04)

**Files:**
- Modify: `frontend/src/style.css` (`@keyframes qSpringBack` ~4531 ; règle qui l'applique)

- [ ] **Step 1: Lire le keyframe et son consommateur**

Read `frontend/src/style.css` lignes 4525-4545. Run Grep, output_mode `content`, `-n` true, pattern `qSpringBack`, path `frontend/src/style.css` pour trouver la règle `animation: … qSpringBack …`.

- [ ] **Step 2: Aligner le motion**

Dans la règle qui applique `qSpringBack` :
- Remplacer la durée littérale par `var(--motion-base)` (200ms).
- Remplacer la fonction d'easing littérale par `var(--ease-spring)`.
Si `qSpringBack` encode lui-même l'effet de ressort (sur-passe à >100% dans les keyframes), conserver le keyframe et ajouter le commentaire :
```css
/* qSpringBack — keyframe de ressort canonique de la file ; timing aligné sur --ease-spring (UIH-queue-04) */
```

- [ ] **Step 3: Build**

Run: `npm run vite:build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(ui): R2 Queue - keyframe qSpringBack alignee sur ease-spring (UIH-queue-04)"
```

---

## Task 5: i18n — sections Settings & EQ par appareil (UIH-settings-02, UIH-eq-04)

Ajoute `data-i18n` sur les libellés français codés en dur et les clés correspondantes dans `i18n.js`.

**Files:**
- Modify: `frontend/index.html` (lignes ~777, 780, 785, 943, 949, 952-953, 975, 996, 999-1000)
- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: Apprendre la structure de `i18n.js`**

Read `frontend/src/i18n.js` lignes 1-80 puis Grep, output_mode `content`, `-n` true, pattern `set_reset_section`, path `frontend/src/i18n.js` (clé Settings existante connue). Noter : la forme d'une entrée (objet par langue ? clé plate ?), les langues présentes, et où s'insèrent les clés `set_*`.

- [ ] **Step 2: Lire le markup à traduire**

Read `frontend/index.html` lignes 773-790 (EQ par appareil) et 940-1005 (sections Settings : Historique des imports, Arborescence fichiers, Organiser la bibliothèque, Sauvegarde & Portabilité, Import USB). Relever le texte exact de chaque libellé sans `data-i18n`.

- [ ] **Step 3: Ajouter les clés dans `i18n.js`**

En suivant exactement la structure relevée au Step 1, ajouter les clés ci-dessous (valeurs FR = texte actuel ; EN = traduction ; étendre aux autres langues présentes en suivant le motif du fichier) :

| Clé | FR | EN |
|---|---|---|
| `set_eq_per_device` | EQ par appareil | EQ per device |
| `set_eq_current_device` | Appareil actuel | Current device |
| `set_eq_save_tooltip` | Enregistrer l'EQ pour cet appareil | Save EQ for this device |
| `set_import_history` | Historique des imports | Import history |
| `set_file_tree` | Arborescence fichiers | File tree |
| `set_organize_library` | Organiser la bibliothèque | Organize library |
| `set_backup_portability` | Sauvegarde & Portabilité | Backup & Portability |
| `set_usb_import` | Import USB | USB import |

Si un libellé du Step 2 diffère de cette liste, ajouter une clé supplémentaire au même format.

- [ ] **Step 4: Poser les `data-i18n` dans le markup**

Pour chaque libellé relevé au Step 2, ajouter l'attribut `data-i18n="<clé>"` sur l'élément texte (en suivant le motif des libellés déjà traduits voisins — ex. `<span data-i18n="set_eq_per_device">EQ par appareil</span>`). Pour un tooltip, utiliser le mécanisme i18n de tooltip déjà en place dans le fichier (Grep `data-i18n-title` ou équivalent au Step 1 si présent).

- [ ] **Step 5: Vérifier la couverture des clés**

Pour chaque nouvelle clé, Run Grep pattern `<clé>` sur `frontend/src/i18n.js` (≥1 résultat) et sur `frontend/index.html` (≥1 résultat). Aucune clé orpheline.

- [ ] **Step 6: Build + test**

Run: `npm run vite:build` → Expected: `✓ built`.
Run: `npm test` → Expected: tests verts (i18n.js parse, aucune régression JS).

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/i18n.js
git commit -m "feat(ui): R2 Settings/EQ - i18n des sections non traduites (UIH-settings-02, UIH-eq-04)"
```

---

## Task 6: Settings — dédoublonnage de la section « Réinitialisation » (UIH-settings-03)

Deux sections portent le même libellé `set_reset_section` dans deux onglets. Choix à risque minimal : **différencier les libellés** (pas de restructuration d'onglets).

**Files:**
- Modify: `frontend/index.html` (lignes ~1008 onglet Bibliothèque, ~1024 onglet Système)
- Modify: `frontend/src/i18n.js`

- [ ] **Step 1: Lire les deux sections**

Read `frontend/index.html` lignes 1003-1030. Confirmer : l'une contient « Vider la bibliothèque », l'autre « Vider les caches ».

- [ ] **Step 2: Ajouter deux clés i18n distinctes**

Dans `i18n.js`, au même format que `set_reset_section`, ajouter :

| Clé | FR | EN |
|---|---|---|
| `set_reset_library` | Réinitialisation de la bibliothèque | Reset library |
| `set_reset_caches` | Réinitialisation des caches | Reset caches |

- [ ] **Step 3: Recâbler les libellés**

À `index.html:~1008` (onglet Bibliothèque), remplacer `data-i18n="set_reset_section"` par `data-i18n="set_reset_library"` + mettre à jour le texte visible.
À `index.html:~1024` (onglet Système), remplacer par `data-i18n="set_reset_caches"` + texte visible.

- [ ] **Step 4: Vérifier que `set_reset_section` n'est plus référencé**

Run Grep, pattern `set_reset_section`, path `frontend/index.html`. Expected: 0 résultat. Laisser la clé dans `i18n.js` si d'autres écrans l'utilisent (Grep sur tout `frontend/src/`) ; sinon la supprimer.

- [ ] **Step 5: Build**

Run: `npm run vite:build` → Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/src/i18n.js
git commit -m "feat(ui): R2 Settings - dedoublonnage section Reinitialisation (UIH-settings-03)"
```

---

## Task 7: Settings & File d'attente — extraction des styles inline (UIH-settings-01, 05, 06 ; UIH-queue-01)

Sort la logique de présentation du HTML vers des classes CSS (CLAUDE.md §13 ; P9).

**Files:**
- Modify: `frontend/index.html` (Settings : 813, 840, 879, 956, 1031, 1053, 1054, 1060 ; Queue : 1085-1088)
- Modify: `frontend/src/style.css` (nouvelles classes)

- [ ] **Step 1: Lire chaque emplacement inline**

Read `frontend/index.html` autour de chaque ligne citée (contexte ±3 lignes) pour identifier l'élément porteur du `style=` et ses classes existantes.

- [ ] **Step 2: Créer les classes CSS**

Ajouter dans `frontend/src/style.css`, près des règles `.set-*` (vers la zone `style.css:4256+` recâblée par R2), le bloc suivant. Adapter les sélecteurs au markup réel lu au Step 1 :

```css
/* R2 — utilitaires d'extraction des styles inline des panneaux (UIH-settings-01/05/06, UIH-queue-01) */

/* Slider compact partagé (cible RG + crossfade) — remplace style="width:90px;accent-color:var(--g)" */
.set-range { width: 88px; accent-color: var(--g); }

/* Bouton d'action à largeur intrinsèque — remplace style="width:auto;padding:6px 14px" */
.set-btn-auto { width: auto; padding: var(--space-2) var(--space-4); }

/* Rangée à enroulement — remplace style="flex-wrap:wrap" et style="display:flex;align-items:center;gap:12px" */
.set-row-wrap { flex-wrap: wrap; }
.set-inline-row { display: flex; align-items: center; gap: var(--space-3); }

/* Vignette d'option — remplace style="border-radius:8px;flex-shrink:0" */
.set-thumb { border-radius: var(--radius-sm); flex-shrink: 0; }

/* Texte d'aide secondaire — remplace style="color:var(--t3);font-size:12px" */
.set-hint { color: var(--t3); font-size: var(--text-sm); }

/* Largeur minimale de contrôle — remplace style="min-width:82px" (82 hors grille → 84) */
.set-ctrl-min { min-width: 84px; }

/* Icône précédant un libellé de bouton — remplace style="margin-right:5px" (5px hors grille).
   À appliquer en posant la classe sur le bouton parent, pas sur l'icône. */
.btn-with-icon { display: inline-flex; align-items: center; gap: var(--space-1); }

/* File d'attente — en-tête et utilitaires (remplace les style= inline de index.html:1085-1088) */
.queue-head { display: flex; align-items: center; gap: var(--space-2); }
.queue-head-icon { margin-right: var(--space-2); vertical-align: middle; }
.queue-head-actions { display: flex; align-items: center; gap: var(--space-1); }
.is-dim { opacity: .7; }
```

- [ ] **Step 3: Recâbler le markup Settings**

Pour chaque ligne, retirer l'attribut `style="…"` et ajouter la classe correspondante :
- `813` : `style="width:90px;accent-color:var(--g)"` → classe `set-range` (UIH-settings-05).
- `840` : `style="min-width:82px"` → classe `set-ctrl-min`.
- `879` : `style="width:auto;padding:6px 14px"` → classe `set-btn-auto` (sur `.mp-toggle-btn`).
- `956` : `style="flex-wrap:wrap"` → classe `set-row-wrap`.
- `1031` : icône avec `style="margin-right:5px"` → retirer le `style`, poser `btn-with-icon` sur le **bouton** parent (UIH-settings-06).
- `1053` : `style="display:flex;align-items:center;gap:12px"` → classe `set-inline-row`.
- `1054` : `style="border-radius:8px;flex-shrink:0"` → classe `set-thumb`.
- `1060` : `style="color:var(--t3);font-size:12px"` → classe `set-hint`.

- [ ] **Step 4: Recâbler le markup File d'attente**

`index.html:1085-1088` : retirer `style="margin-right:6px;vertical-align:middle"` → `queue-head-icon` ; `style="display:flex;align-items:center;gap:4px"` → `queue-head-actions` ; `style="opacity:.7"` → `is-dim`. Poser `queue-head` sur le conteneur d'en-tête si pertinent.

- [ ] **Step 5: Vérifier l'absence de `style=` résiduel**

Run Grep, output_mode `content`, `-n` true, pattern `style="[^"]*(width|padding|margin|flex|gap|opacity|border-radius|color|font-)`, path `frontend/index.html`, puis vérifier qu'aucun match ne tombe dans les plages Settings (≈770-1075) ou File d'attente (≈1083-1095).

- [ ] **Step 6: Build**

Run: `npm run vite:build` → Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/style.css
git commit -m "feat(ui): R2 Settings/Queue - extraction des styles inline en classes (UIH-settings-01-05-06, UIH-queue-01)"
```

---

## Task 8: Settings — cohérence des boutons d'action dans le panneau (UIH-settings-04)

**Note de périmètre :** l'audit propose un composant bouton global `.btn` + variantes. C'est un changement **transverse** (la classe `.mbtn` est utilisée par toutes les modales/panneaux), hors du périmètre R2 « Panneaux ». R2 se limite donc à la **cohérence intra-panneau** : utiliser uniformément les classes bouton existantes dans Settings. La création du système `.btn` est notée comme dette pour un futur lot « Composants ».

**Files:**
- Modify: `frontend/index.html` (Settings : ~783, 879, 907, 933-937, 981, 990, 1002)
- Modify: `frontend/src/style.css` si un alias de classe est nécessaire

- [ ] **Step 1: Inventorier les boutons du panneau Settings**

Read `frontend/index.html` aux lignes citées. Classer chaque bouton : action principale, action compacte de rangée, action destructive, bascule. Noter la classe actuelle (`.mp-toggle-btn`, `.mbtn`, `.mbtn-sm`, `.mbtn` nu).

- [ ] **Step 2: Définir la règle de cohérence**

- Action compacte alignée à droite d'une `.set-row` → `.mbtn .mbtn-sm`.
- Action de section pleine largeur ou autonome → `.mbtn`.
- `.mp-toggle-btn` : si l'élément est sémantiquement un bouton d'action de rangée (et non une vraie bascule on/off), le convertir en `.mbtn .mbtn-sm` + `.set-btn-auto` si largeur intrinsèque nécessaire. S'il s'agit d'une vraie bascule, le laisser mais vérifier qu'il partage hauteur/rayon avec `.mbtn-sm`.
- Un bouton destructif (« Vider… ») garde sa classe mais doit porter un marqueur d'état danger cohérent : Grep une classe `danger`/`mbtn-danger` existante ; si elle existe, l'appliquer uniformément aux 2-3 boutons destructifs de Settings ; sinon ne rien inventer (hors périmètre).

- [ ] **Step 3: Appliquer**

Recâbler chaque bouton sur la classe décidée au Step 2. Ne renommer aucune classe globale ; n'ajouter aucun nouveau système de classes.

- [ ] **Step 4: Vérifier que `.mp-toggle-btn` n'est plus utilisé à tort**

Run Grep, pattern `mp-toggle-btn`, path `frontend/index.html`. Si plus aucun usage dans Settings, vérifier qu'aucune règle CSS `.mp-toggle-btn` n'est devenue morte (Grep sur `style.css`) ; si morte, la supprimer.

- [ ] **Step 5: Build + test**

Run: `npm run vite:build` → Expected: `✓ built`.
Run: `npm test` → Expected: tests verts.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/src/style.css
git commit -m "feat(ui): R2 Settings - coherence des boutons d'action intra-panneau (UIH-settings-04)"
```

---

## Task 9: Vérification du lot R2

**Files:**
- Lecture seule + mise à jour de l'audit

- [ ] **Step 1: Vérification automatisée**

Run: `npm run vite:build` → Expected: `✓ built`, aucune erreur.
Run: `npm test` → Expected: tous les tests verts.

- [ ] **Step 2: Vérification visuelle manuelle**

Run: `npm run dev`. Ouvrir successivement, en **mode sombre** puis **mode clair** :
- Panneau **Settings** : les 5 onglets ; vérifier qu'aucun écart visuel (espacements, boutons, slider RG, sections traduites, libellés « Réinitialisation … » distincts).
- Panneau **EQ** : couleurs des bandes en mode clair (Task 1), animation des barres (Task 2), libellés « EQ par appareil » traduits.
- **File d'attente** : ombre du panneau, en-tête, boutons ronds, animation de réordonnancement.
Noter tout écart ; le corriger avant de poursuivre.

- [ ] **Step 3: Confirmer la non-régression des invariants**

Run Grep, pattern `VIRT_ROW_H|VIRT_GRP_H`, path `frontend/src/style.css` — confirmer qu'aucune constante de virtual scroll n'a été touchée. Confirmer qu'aucun thème ni l'accent dynamique (`--art-color`, `--g`, `--g-rgb`) n'a été modifié dans les diffs des Tasks 1-8.

- [ ] **Step 4: Marquer R2 terminé dans l'audit**

Dans `docs/superpowers/audits/ui-harmonization-audit.md`, section §5, ajouter dans la ligne du lot R2 un marqueur d'achèvement (ex. préfixer l'intitulé de `✅ `), et ajouter sous le tableau une note : `R2 implémenté le 2026-05-21 — voir plan docs/superpowers/plans/2026-05-21-harmonisation-ui-r2-panneaux.md.`

- [ ] **Step 5: Commit final**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): R2 Panneaux marque comme implemente"
```

---

## Self-Review

**Couverture des 15 findings R2 :**
- UIH-eq-02 → T1 ✔ · UIH-eq-03 → T2 ✔ · UIH-eq-01 → T3 ✔ · UIH-eq-04 → T5 ✔
- UIH-settings-07 → T3 ✔ · UIH-settings-02 → T5 ✔ · UIH-settings-03 → T6 ✔
- UIH-settings-01/05/06 → T7 ✔ · UIH-settings-04 → T8 ✔
- UIH-queue-02/03 → T3 ✔ · UIH-queue-04 → T4 ✔ · UIH-queue-01 → T7 ✔
- Total : 4 EQ + 7 Settings + 4 Queue = 15. Aucun finding orphelin.

**Placeholders :** les `<valeur … relevée au Step 1>` de T1 et les « adapter au markup réel » de T7/T8 sont des renvois explicites à une étape `Read` qui précède dans la même tâche — ce ne sont pas des TODO : la règle de transformation est entièrement spécifiée, seule la valeur littérale courante doit être lue. Aucun `TBD`/`TODO`.

**Cohérence des identifiants :** noms de classes CSS introduits en T7 (`.set-range`, `.set-hint`, `.queue-head`, etc.) réutilisés tels quels en T8 (`.set-btn-auto`). Tokens canoniques référencés strictement avec les noms posés par R1 (`--space-*`, `--radius-*`, `--text-*`, `--ease-spring`, `--scrim-1`). Type de commit `feat(ui):` constant.

**Risques assumés :** T8 réduit volontairement la portée de UIH-settings-04 (pas de système `.btn` global — transverse, hors R2) ; documenté comme dette. T3 absorbe l'écart d'opacité d'ombre .30→.40 dans l'échelle canonique — à confirmer en vérification visuelle T9 Step 2.
