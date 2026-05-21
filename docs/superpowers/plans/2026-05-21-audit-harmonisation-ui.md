# Audit d'harmonisation UI — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire le document d'audit `docs/superpowers/audits/ui-harmonization-audit.md` — un diagnostic complet de l'UI libreflow avec jeu de tokens cible chiffré et backlog d'incohérences priorisé par écran.

**Architecture:** Livrable 100 % documentaire, analyse en lecture seule. Deux passes : passe 1 dimension-first (inventaire du style → tokens cible), passe 2 écran-first (notation des surfaces contre les tokens → backlog). Aucun fichier source modifié ; seul le document d'audit est créé puis enrichi, avec un commit par tâche.

**Tech Stack:** Markdown ; outils Grep / Read pour l'inspection de `frontend/src/style.css`, `frontend/index.html`, `frontend/src/*.js`. Aucun build, aucun test automatisé (cf. spec §7.2).

**Spec source:** `docs/superpowers/specs/2026-05-21-audit-harmonisation-ui-design.md`

---

## Notes d'exécution

- **Read-only strict sur les sources** : ne jamais éditer `style.css`, `index.html` ni un module JS. Le seul fichier écrit par ce plan est `docs/superpowers/audits/ui-harmonization-audit.md`.
- **Commits scopés** : chaque commit ne `git add` que le fichier d'audit. Les 26 fichiers déjà modifiés dans l'arbre de travail ne sont jamais ajoutés.
- **Type de commit** : `docs(audit): …` (conventional commits, validé par `commitlint.config.js`).
- **Pas d'attribution** dans les messages de commit (désactivée globalement pour le projet).
- **Format d'un finding** (utilisé en passe 2, doc §4) :

  ```markdown
  #### UIH-<ecran>-<n> — <titre court>
  - **Dimension** : <couleur|espacement|typo|rayon|élévation|motion|icône|composant|a11y>
  - **Localisation** : `<fichier>:<ligne>`
  - **Constat** : <ce qui est observé aujourd'hui>
  - **Cible** : <token ou valeur chiffrée attendue>
  - **Sévérité** : <CRITIQUE|ÉLEVÉ|MOYEN|FAIBLE>
  - **Effort** : <S|M|L>
  - **Principe** : <P1..P10>
  ```

- **Formule de score par écran** (utilisée Task 11) :
  `score = max(0, 100 − (CRITIQUE×15 + ÉLEVÉ×7 + MOYEN×3 + FAIBLE×1))`.
  Score global = moyenne arithmétique des scores d'écran, arrondie à l'entier.

---

## File Structure

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `docs/superpowers/audits/ui-harmonization-audit.md` | Unique livrable. Créé en Task 1, enrichi section par section. | Toutes |

Le document a 5 sections fixes (cf. spec §6.1). Ordre de remplissage : squelette (T1) → §2/§3 tokens (T2–T6) → §4 backlog (T7–T11) → §1 résumé (T11) → §5 feuille de route (T12) → vérification (T13).

---

## Task 1: Initialiser le squelette du document d'audit

**Files:**
- Create: `docs/superpowers/audits/ui-harmonization-audit.md`

- [ ] **Step 1: Créer le fichier avec le squelette complet**

```markdown
# Audit d'harmonisation UI — libreflow

- **Date** : 2026-05-21
- **Statut** : EN COURS
- **Spec** : `docs/superpowers/specs/2026-05-21-audit-harmonisation-ui-design.md`
- **Périmètre** : analyse visuelle/UX en lecture seule. Cible : niveau de finition
  Spotify/Deezer en gardant l'identité libreflow (7 thèmes, clair/sombre, accent dynamique).

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

## 1. Résumé exécutif

_(rempli en Task 11)_

## 2. Jeu de tokens cible

_(rempli en Task 6)_

## 3. Inventaire constaté vs cible

_(rempli en Task 6, sous-sections alimentées par Task 2–5)_

### 3.1 Couleur
### 3.2 Espacement
### 3.3 Typographie
### 3.4 Rayons, élévations, motion, iconographie

## 4. Backlog par écran

_(rempli en Task 7–11)_

## 5. Feuille de route

_(rempli en Task 12)_
```

- [ ] **Step 2: Vérifier la création**

Run Read sur `docs/superpowers/audits/ui-harmonization-audit.md`.
Expected: les 5 sections + le tableau du référentiel sont présents.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): squelette du document d'audit UI"
```

---

## Task 2: Passe 1 — Inventaire Couleur

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 3.1)
- Read: `frontend/src/style.css`, `frontend/index.html`

- [ ] **Step 1: Inventorier les couleurs littérales**

Run Grep, output_mode `content`, `-n` true :
- pattern `#[0-9a-fA-F]{3,8}\b`, path `frontend/src/style.css`
- pattern `rgba?\([^)]*\)`, path `frontend/src/style.css`
- pattern `hsla?\([^)]*\)`, path `frontend/src/style.css`

Expected: liste de valeurs couleur avec numéros de ligne.

- [ ] **Step 2: Inventorier les variables CSS de couleur et les dégradés**

Run Grep, output_mode `content`, `-n` true :
- pattern `--[\w-]+\s*:`, path `frontend/src/style.css` (relever les variables dont la valeur est une couleur)
- pattern `(linear|radial|conic)-gradient`, path `frontend/src/style.css`

Run Grep, output_mode `content`, pattern `(color|background)\s*:`, path `frontend/index.html` (couleurs inline dans le markup).

- [ ] **Step 3: Compiler et repérer les divergences**

Regrouper les valeurs. Marquer : (a) doublons quasi-identiques (ex. `#1a1a1a` vs `#191919`), (b) couleurs littérales qui devraient être des variables, (c) variables redondantes.

- [ ] **Step 4: Écrire la sous-section 3.1**

Sous `### 3.1 Couleur`, écrire un tableau `Valeur | Occurrences | Lignes | Verdict (garder/fusionner/variabiliser)`. Lister explicitement les groupes de doublons.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): inventaire couleur (passe 1)"
```

---

## Task 3: Passe 1 — Inventaire Espacement

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 3.2)
- Read: `frontend/src/style.css`, `frontend/index.html`

- [ ] **Step 1: Inventorier padding / margin / gap dans le CSS**

Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css` :
- pattern `padding\s*:[^;]+;`
- pattern `margin\s*:[^;]+;`
- pattern `\bgap\s*:[^;]+;`

- [ ] **Step 2: Inventorier l'espacement inline dans le markup**

Run Grep, output_mode `content`, `-n` true, pattern `style="[^"]*(padding|margin|gap)[^"]*"`, path `frontend/index.html`.

- [ ] **Step 3: Compiler la liste des valeurs distinctes**

Extraire toutes les valeurs px/rem distinctes. Les trier numériquement. Marquer celles qui ne sont PAS un multiple de 4 (violation P2).

- [ ] **Step 4: Écrire la sous-section 3.2**

Sous `### 3.2 Espacement`, écrire : (a) la liste triée des valeurs distinctes avec occurrences, (b) la liste des valeurs off-grille (non-multiples de 4), (c) un constat de l'amplitude (combien de valeurs distinctes coexistent).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): inventaire espacement (passe 1)"
```

---

## Task 4: Passe 1 — Inventaire Typographie

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 3.3)
- Read: `frontend/src/style.css`, `frontend/index.html`

- [ ] **Step 1: Inventorier font-size / font-weight / line-height**

Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css` :
- pattern `font-size\s*:[^;]+;`
- pattern `font-weight\s*:[^;]+;`
- pattern `line-height\s*:[^;]+;`
- pattern `font-family\s*:[^;]+;`

Run Grep, output_mode `content`, `-n` true, pattern `style="[^"]*font-[^"]*"`, path `frontend/index.html`.

- [ ] **Step 2: Reconstituer l'échelle de fait**

Lister les `font-size` distincts triés, les `font-weight` distincts, les `line-height` distincts. Compter combien de tailles coexistent (cible P3 : ~6).

- [ ] **Step 3: Vérifier les polices**

Confirmer que toutes les `font-family` pointent vers des polices locales `@fontsource` (CLAUDE.md §12). Signaler toute police externe (= CRITIQUE).

- [ ] **Step 4: Écrire la sous-section 3.3**

Sous `### 3.3 Typographie`, écrire : échelle de tailles constatée, graisses utilisées, line-heights, et le verdict sur le nombre de tailles vs la cible.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): inventaire typographie (passe 1)"
```

---

## Task 5: Passe 1 — Inventaire Rayons, Élévations, Motion, Iconographie

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 3.4)
- Read: `frontend/src/style.css`, `frontend/index.html`

- [ ] **Step 1: Inventorier rayons et élévations**

Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css` :
- pattern `border-radius\s*:[^;]+;`
- pattern `box-shadow\s*:[^;]+;`

- [ ] **Step 2: Inventorier le motion**

Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css` :
- pattern `transition\s*:[^;]+;`
- pattern `animation\s*:[^;]+;`
- pattern `@keyframes\s+[\w-]+`
- pattern `cubic-bezier\([^)]*\)`

Relever les durées (`\d+ms`, `\d*\.?\d+s`) et les fonctions d'easing distinctes.

- [ ] **Step 3: Inventorier l'iconographie**

Run Grep, output_mode `content`, `-n` true, path `frontend/index.html` :
- pattern `<svg[^>]*viewBox="[^"]*"` (tailles de viewBox)
- pattern `stroke-width="[^"]*"`
- pattern `<svg[^>]*width="[^"]*"`

Relever les `stroke-width` distincts et les tailles d'icône distinctes.

- [ ] **Step 4: Écrire la sous-section 3.4**

Sous `### 3.4 Rayons, élévations, motion, iconographie`, écrire 4 mini-tableaux : rayons distincts | élévations distinctes | durées+easings de motion | tailles d'icône + stroke-width. Marquer les divergences (durées hors 150–300ms = violation P6 ; stroke-width incohérents = violation P9).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): inventaire rayons/élévations/motion/icônes (passe 1)"
```

---

## Task 6: Passe 1 — Synthèse du jeu de tokens cible

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 2 + complétion section 3)
- Read: la section 3 du document d'audit (sous-sections 3.1–3.4 déjà remplies)

- [ ] **Step 1: Relire les inventaires**

Read les sous-sections 3.1–3.4 du document d'audit.

- [ ] **Step 2: Définir l'échelle de tokens par dimension**

Appliquer les règles : espacement = échelle 4/8 (`--space-1:4px` … `--space-8:48px`, ne garder que les paliers réellement utiles) ; rayons = `--radius-sm/md/lg/pill` ; typo = `--text-xs/sm/base/lg/xl/2xl` (~6) + graisses `--fw-regular/medium/semibold` ; élévations = `--elev-1/2/3` ; motion = `--motion-fast:160ms`, `--motion-base:240ms` + un easing unique `--ease-standard:cubic-bezier(.4,0,.2,1)` ; couleur = palette de rôles (`--surface-0..3`, `--text-1..4`, `--border`, `--accent`) en gardant les variables de thème existantes.

- [ ] **Step 3: Vérifier la couverture à 100 %**

Pour chaque valeur listée dans les inventaires 3.1–3.4, confirmer qu'elle se mappe à un token cible OU est marquée « à supprimer ». Aucune valeur orpheline (exigence spec §4.1 / §7.2).

- [ ] **Step 4: Écrire la section 2**

Sous `## 2. Jeu de tokens cible`, écrire un tableau par dimension : `Token | Valeur | Usage`. Inclure une note de compatibilité : les tokens couleur n'écrasent ni les 7 thèmes ni `--art-color`/accent dynamique (spec §5, P4).

- [ ] **Step 5: Compléter la section 3 avec le mapping constaté→cible**

Dans chaque sous-section 3.1–3.4, ajouter une colonne ou un tableau `Valeur constatée → Token cible`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): synthèse du jeu de tokens cible (passe 1)"
```

---

## Task 7: Passe 2 — Audit écrans Groupe A (shell principal)

**Écrans:** bibliothèque (liste de pistes, virtual scroll, en-têtes de groupe), barre de lecture, navigation latérale (playlists/vues/smart playlists), recherche (champ, résultats, état vide).

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 4, sous-section « Groupe A »)
- Read: `frontend/index.html`, `frontend/src/style.css`, le document d'audit section 2 (tokens cible)

- [ ] **Step 1: Localiser le markup de chaque écran**

Run Grep, output_mode `content`, `-n` true, path `frontend/index.html`, pour repérer les blocs : pattern `id="(library|track-list|player-bar|sidebar|nav|search)` puis lire le contexte autour de chaque match avec Read.

- [ ] **Step 2: Localiser les règles CSS associées**

Pour chaque classe/id repéré, Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css` avec le sélecteur concerné.

- [ ] **Step 3: Noter chaque écran contre P1–P10**

Pour chaque écran, comparer markup + CSS aux tokens cible (section 2) et aux 10 principes. Relever chaque écart concret.

- [ ] **Step 4: Écrire les findings**

Sous `## 4. Backlog par écran`, créer `### Groupe A — Shell principal`, puis pour chaque écart un finding au format défini dans « Notes d'exécution ». Numéroter `UIH-library-NN`, `UIH-playerbar-NN`, `UIH-sidebar-NN`, `UIH-search-NN`.

- [ ] **Step 5: Vérifier 3 citations fichier:ligne au hasard**

Read chaque `fichier:ligne` cité d'un échantillon de 3 findings. Confirmer qu'il pointe bien sur l'élément décrit. Corriger toute citation fausse.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): backlog Groupe A — shell principal (passe 2)"
```

---

## Task 8: Passe 2 — Audit écrans Groupe B (panneaux)

**Écrans:** panneau Settings (modale, 5 onglets — markup `frontend/index.html:680-1073`), panneau EQ, panneau File d'attente (`queue-panel`, markup vers `frontend/index.html:1083`).

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 4, sous-section « Groupe B »)
- Read: `frontend/index.html`, `frontend/src/style.css`, le document d'audit section 2

- [ ] **Step 1: Lire le markup des panneaux**

Read `frontend/index.html` lignes 680–1100 (Settings + Queue). Run Grep, output_mode `content`, `-n` true, pattern `id="(eq-panel|eq-)`, path `frontend/index.html` pour localiser le panneau EQ.

- [ ] **Step 2: Localiser les règles CSS**

Run Grep, output_mode `content`, `-n` true, path `frontend/src/style.css`, patterns `\.set-`, `#settings`, `#queue`, `#eq-`, `\.mbtn`, `\.toggle-`.

- [ ] **Step 3: Noter contre P1–P10**

Vérifier en particulier : styles inline résiduels dans le markup Settings (`style="width:90px…"`, `style="min-width:82px"`, `style="display:flex…"`, etc. — violation P9) ; sections sans `data-i18n` (« EQ par appareil », « Historique des imports », « Arborescence fichiers », « Sauvegarde & Portabilité », « Import USB ») ; doublon de section « Réinitialisation » entre onglets Bibliothèque et Système ; cohérence des boutons `mbtn` vs `mbtn-sm` ; espacement des `set-row` contre la grille 4/8.

- [ ] **Step 4: Écrire les findings**

Sous section 4, créer `### Groupe B — Panneaux`, findings numérotés `UIH-settings-NN`, `UIH-eq-NN`, `UIH-queue-NN`.

- [ ] **Step 5: Vérifier 3 citations fichier:ligne au hasard**

Read l'échantillon, corriger toute citation fausse.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): backlog Groupe B — panneaux (passe 2)"
```

---

## Task 9: Passe 2 — Audit écrans Groupe C (immersif & transitoire)

**Écrans:** mode Cinéma, mini-player (fenêtre séparée), menus contextuels, toasts/notifications, overlay drop-in.

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 4, sous-section « Groupe C »)
- Read: `frontend/index.html`, `frontend/src/style.css`, `frontend/src/cinema.js`, `frontend/src/ctxmenu.js`, `frontend/src/dropin.js`, le document d'audit section 2

- [ ] **Step 1: Localiser markup et CSS**

Run Grep, output_mode `content`, `-n` true, path `frontend/index.html`, pattern `id="(cinema|mini|ctx|toast|dropin|drop-)`. Run Grep sur `frontend/src/style.css` avec patterns `\.cinema`, `\.ctx`, `\.toast`, `\.dropin`. Read les modules JS listés pour repérer les styles appliqués via `.style.` / `setProperty`.

- [ ] **Step 2: Inventorier les styles posés par JS**

Run Grep, output_mode `content`, `-n` true, pattern `\.style\.|setProperty`, path `frontend/src/cinema.js` puis `frontend/src/ctxmenu.js` puis `frontend/src/dropin.js`. Relever toute valeur de style codée en dur (violation potentielle P9).

- [ ] **Step 3: Noter contre P1–P10**

Attention particulière au motion (P6) sur cinéma et toasts, et aux états (P7) des menus contextuels.

- [ ] **Step 4: Écrire les findings**

Sous section 4, créer `### Groupe C — Immersif & transitoire`, findings `UIH-cinema-NN`, `UIH-miniplayer-NN`, `UIH-ctxmenu-NN`, `UIH-toast-NN`, `UIH-dropin-NN`.

- [ ] **Step 5: Vérifier 3 citations fichier:ligne au hasard**

Read l'échantillon, corriger toute citation fausse.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): backlog Groupe C — immersif & transitoire (passe 2)"
```

---

## Task 10: Passe 2 — Audit écrans Groupe D (modales & vues secondaires)

**Écrans:** modales (import USB, Organize, Backup, confirmation, raccourcis), vues secondaires (CD audio, Stats, Radio).

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 4, sous-section « Groupe D »)
- Read: `frontend/index.html`, `frontend/src/style.css`, `frontend/src/cdaudio.js`, `frontend/src/stats.js`, `frontend/src/radio.js`, le document d'audit section 2

- [ ] **Step 1: Localiser markup et CSS**

Run Grep, output_mode `content`, `-n` true, path `frontend/index.html`, pattern `id="(usb|organize|backup|confirm|shortcuts|cd|stats|radio)`. Run Grep sur `frontend/src/style.css` avec les sélecteurs correspondants.

- [ ] **Step 2: Noter contre P1–P10**

Vérifier en particulier la cohérence inter-modales (P9 : toutes les modales partagent-elles le même cadre, le même header, le même bouton de fermeture ?) et les états vides des vues secondaires (P8).

- [ ] **Step 3: Écrire les findings**

Sous section 4, créer `### Groupe D — Modales & vues secondaires`, findings `UIH-usb-NN`, `UIH-organize-NN`, `UIH-backup-NN`, `UIH-confirm-NN`, `UIH-shortcuts-NN`, `UIH-cdaudio-NN`, `UIH-stats-NN`, `UIH-radio-NN`.

- [ ] **Step 4: Vérifier 3 citations fichier:ligne au hasard**

Read l'échantillon, corriger toute citation fausse.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): backlog Groupe D — modales & vues secondaires (passe 2)"
```

---

## Task 11: Synthèse — scores, résumé exécutif, top 10

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 1 + en-têtes de section 4)
- Read: la section 4 complète du document d'audit

- [ ] **Step 1: Compter les findings par écran et par sévérité**

Read la section 4. Pour chaque écran, compter les findings par niveau (CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE).

- [ ] **Step 2: Calculer les scores**

Appliquer la formule des « Notes d'exécution » : `score = max(0, 100 − (CRITIQUE×15 + ÉLEVÉ×7 + MOYEN×3 + FAIBLE×1))` par écran. Calculer le score global (moyenne).

- [ ] **Step 3: Annoter la section 4**

Ajouter sous chaque `### Groupe X` une ligne `Scores : <écran> NN/100, …`.

- [ ] **Step 4: Écrire la section 1 — résumé exécutif**

Sous `## 1. Résumé exécutif` : score global, tableau des scores par écran trié croissant (pires en premier), et le **Top 10** des findings (toutes sévérités CRITIQUE d'abord, puis ÉLEVÉ par impact inter-écrans), chacun avec son ID et une ligne de description.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): scores, résumé exécutif et top 10"
```

---

## Task 12: Feuille de route — regroupement en specs de re-skin

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (section 5)
- Read: les sections 2 et 4 du document d'audit

- [ ] **Step 1: Regrouper les findings en lots de travail**

Lire les findings. Les regrouper en specs de re-skin candidats. Regroupement attendu : (R1) « Fondation tokens » — appliquer le jeu de tokens de la section 2 à `style.css` ; (R2) re-skin shell principal ; (R3) re-skin panneaux ; (R4) re-skin immersif & transitoire ; (R5) re-skin modales & vues secondaires. R1 est prérequis de R2–R5.

- [ ] **Step 2: Ordonner par dépendance et impact**

R1 d'abord (débloque le reste). Puis R2–R5 triés par score d'écran croissant (pires écrans prioritaires).

- [ ] **Step 3: Écrire la section 5**

Sous `## 5. Feuille de route` : un tableau `Spec | Écrans | Findings couverts (IDs) | Prérequis | Effort cumulé`. Confirmer en fin de section que 100 % des findings de la section 4 sont rattachés à un lot (exigence spec §7.2).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): feuille de route des specs de re-skin"
```

---

## Task 13: Passe de vérification du livrable

**Files:**
- Modify: `docs/superpowers/audits/ui-harmonization-audit.md` (passage du statut à TERMINÉ)
- Read: le document d'audit complet

- [ ] **Step 1: Dérouler la checklist de la spec §7.2**

Vérifier point par point : (a) échantillon de 5 `fichier:ligne` répartis sur les 4 groupes, ouverts via Read, confirmés exacts ; (b) chaque valeur des inventaires 3.x se mappe à un token de la section 2 ; (c) aucun finding sans champ « Cible » chiffré ; (d) aucun `TBD`/`TODO`/section vide — Run Grep pattern `TBD|TODO|_\(rempli` sur le document, attendu : 0 résultat ; (e) chaque finding cite ≥ 1 principe P1–P10 ; (f) chaque finding de la section 4 apparaît dans un lot de la section 5.

- [ ] **Step 2: Corriger les manques détectés**

Si un point échoue, corriger inline dans le document.

- [ ] **Step 3: Passer le statut à TERMINÉ**

Remplacer `- **Statut** : EN COURS` par `- **Statut** : TERMINÉ` en tête du document.

- [ ] **Step 4: Commit final**

```bash
git add docs/superpowers/audits/ui-harmonization-audit.md
git commit -m "docs(audit): vérification du livrable et clôture de l'audit"
```

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec :**
- spec §3.1 surfaces auditées → couvertes par T7 (Groupe A), T8 (B), T9 (C), T10 (D). Les 14 surfaces de la spec sont réparties dans les 4 groupes. ✔
- spec §4.1 passe 1 dimension-first + tokens couvrant 100 % → T2–T6 (T6 step 3 vérifie la couverture). ✔
- spec §4.2 passe 2 écran-first + `fichier:ligne` → T7–T10, étape de vérification d'échantillon dans chaque. ✔
- spec §5 principes P1–P10 → injectés dans le squelette T1, référencés par chaque finding. ✔
- spec §6.1 structure du document (5 sections) → squelette T1, remplissage T2–T12. ✔
- spec §6.2 schéma de finding → format figé dans « Notes d'exécution », appliqué T7–T10. ✔
- spec §6.3 sévérité → utilisée dans le format de finding et la formule de score. ✔
- spec §7.1 read-only strict → rappelé dans « Notes d'exécution », aucune tâche n'édite une source. ✔
- spec §7.2 checklist de vérification → T13 la déroule intégralement. ✔
- spec §8 emplacements → document à `docs/superpowers/audits/ui-harmonization-audit.md` (T1). ✔

**Placeholders :** aucun `TBD`/`TODO` dans les étapes ; les mentions `_(rempli en Task N)_` du squelette sont des marqueurs intentionnels du document de travail, supprimés au fil des tâches et contrôlés à zéro en T13 step 1d.

**Cohérence des identifiants :** préfixes de finding `UIH-<ecran>-NN` cohérents entre T7–T10 et réutilisés en T11/T12 ; formule de score définie une fois (« Notes d'exécution »), appliquée en T11 ; lots R1–R5 définis en T12 step 1.
