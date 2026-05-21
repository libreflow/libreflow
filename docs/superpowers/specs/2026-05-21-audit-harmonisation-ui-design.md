# Spec — Audit d'harmonisation UI

- **Date** : 2026-05-21
- **Statut** : approuvé (design), en attente de relecture du spec
- **Type** : livrable documentaire (analyse en lecture seule)
- **Topic** : harmonisation de l'UI libreflow vers un niveau de finition Spotify/Deezer

---

## 1. Contexte & objectif

libreflow vise un rendu et une cohérence comparables à Spotify/Deezer. Le chantier
complet — harmoniser **toute** l'UI — est trop large pour un seul spec. Il se découpe en :

1. une **fondation design partagée** (tokens + composants communs) ;
2. un **re-skin écran par écran**.

Décision de cadrage : on commence par un **audit complet**. Ce spec décrit *comment
mener l'audit* et *ce qu'il produit*. L'audit est le 1ᵉʳ livrable du chantier ; son
résultat (backlog + tokens cible) alimente les specs suivants.

**Cible retenue** : garder l'identité libreflow (7 thèmes de couleur, mode clair/sombre,
accent dynamique tiré de la pochette) et atteindre la qualité Spotify/Deezer sur
l'espacement, le motion, la hiérarchie et la densité. On ne converge **pas** vers un
thème sombre figé unique.

## 2. Décisions cadrées

| Décision | Choix retenu |
|---|---|
| Découpage du chantier | Audit complet d'abord, puis specs de re-skin |
| Cible visuelle | Garder l'identité, viser le niveau de finition |
| Livrable de l'audit | Diagnostic (backlog) **+ cible chiffrée** (jeu de tokens) |
| Méthode d'audit | Hybride deux passes : dimension-first puis écran-first |

## 3. Périmètre

### 3.1 Surfaces auditées

- Bibliothèque principale (liste de pistes, virtual scroll, en-têtes de groupe)
- Barre de lecture (transport, volume, pochette, visualiseur)
- Navigation latérale (playlists, vues, smart playlists)
- Recherche (champ, résultats, état vide / zéro résultat)
- Panneau Settings (modale, 5 onglets)
- Panneau EQ
- Panneau File d'attente (queue)
- Mode Cinéma
- Mini-player (fenêtre séparée)
- Menus contextuels
- Modales : import USB, Organize, Backup, confirmation, raccourcis
- Toasts / notifications
- Vues secondaires : CD audio, Stats, Radio
- Overlay drop-in (drag & drop)

### 3.2 Hors périmètre

- Backend Rust, pipeline audio, IPC, logique fonctionnelle
- Constantes de virtual scroll (`CFG.VIRT_ROW_H`, `CFG.VIRT_GRP_H`) : fonctionnelles,
  pas du style → exclues de toute recommandation
- Comportement audio et invariants CLAUDE.md §2/§9/§10 : intouchables

L'audit est **purement visuel/UX**. Il ne propose aucune modification de comportement.

## 4. Méthodologie — deux passes

### 4.1 Passe 1 — dimension-first → tokens cible

Scan exhaustif des sources de style :

- `frontend/src/style.css`
- styles inline dans `frontend/index.html`
- assignations de style dans les modules JS (`style.setProperty`, `.style.X`)

Pour chaque dimension, produire : (a) l'**inventaire constaté** de toutes les valeurs
réelles, (b) le repérage des divergences (doublons quasi-identiques, valeurs
hors-variable), (c) un **jeu de tokens cible nommé**.

| Dimension | À inventorier | Token cible proposé |
|---|---|---|
| Couleur | hex/rgb/hsl, variables `--*`, dégradés | palette resserrée + rôles |
| Espacement | tous `padding`/`margin`/`gap` | `--space-1..n` (grille 4/8) |
| Typographie | `font-size`, `font-weight`, `line-height` | `--text-xs..xl` + graisses |
| Rayons | tous `border-radius` | `--radius-sm/md/lg/pill` |
| Élévations | tous `box-shadow` | `--elev-1..3` |
| Motion | `transition`, `animation`, durées, easings | `--motion-fast/base` + easing |
| Iconographie | tailles SVG, `stroke-width` | tailles + épaisseur normées |

Le jeu de tokens cible doit **couvrir 100 %** des valeurs constatées dans son
inventaire (chaque valeur réelle se mappe à un token, ou est explicitement signalée
comme à supprimer).

### 4.2 Passe 2 — écran-first → backlog priorisé

Pour chaque surface de la §3.1, en s'appuyant sur les tokens cible de la passe 1 :
parcourir markup + CSS, relever chaque écart concret, le rattacher à un écran et à une
dimension, le dater en `fichier:ligne`.

Exécution parallélisable : un sous-agent par groupe d'écrans (cf.
`.claude/rules/common/agents.md`). Chaque sous-agent reçoit les tokens cible figés de la
passe 1 comme référence commune.

## 5. Référentiel — principes nommés

Pas d'accès live à Spotify/Deezer : le standard est codifié en principes vérifiables.
Chaque finding de la passe 2 référence le(s) principe(s) enfreint(s).

| ID | Principe | Critère vérifiable |
|---|---|---|
| P1 | Surfaces étagées | Profondeur exprimée par 3–4 niveaux de surface + élévation, pas par des bordures dures |
| P2 | Grille 4/8 | Tout espacement est un multiple de 4px |
| P3 | Hiérarchie typo nette | Échelle limitée (~6 tailles), contraste de graisse marqué titre/sous-texte |
| P4 | Accent discipliné | La couleur d'accent (thème/dynamique) sert aux états actifs/CTA, jamais décorative en masse |
| P5 | Cibles généreuses | Éléments interactifs ≥ ~32px de hauteur, zones cliquables confortables |
| P6 | Transitions fluides | 150–300ms, easing cohérent, sur hover/focus/press/ouverture de panneau |
| P7 | États complets | Chaque interactif a hover + focus-visible + active + disabled cohérents |
| P8 | Densité maîtrisée | Respiration entre sections ; états vides traités ; pas de listes tassées |
| P9 | Cohérence des composants | Un bouton / un toggle / une ligne de réglage = un seul rendu partout |
| P10 | Contraste AA | Texte et UI respectent WCAG 2.1 AA dans les deux modes |

**Compatibilité identité** : P4 et P10 sont évalués en tenant compte des 7 thèmes +
accent dynamique. Une recommandation ne doit jamais casser le multi-thème ni l'accent
dynamique (cible « garder l'identité »).

## 6. Livrable — structure du document d'audit

Ce spec définit la structure ; le document d'audit lui-même est produit lors de
l'implémentation.

### 6.1 Sections du document d'audit

1. **Résumé exécutif** — score global de cohérence, top 10 des écarts.
2. **Jeu de tokens cible** — tableaux par dimension : token → valeur → usage (sortie passe 1).
3. **Inventaire constaté** — par dimension, valeurs existantes vs cible.
4. **Backlog par écran** — pour chaque surface : score + liste d'items.
5. **Feuille de route** — regroupement des items en futurs specs de re-skin, ordre suggéré.

### 6.2 Schéma d'un item de backlog

| Champ | Contenu |
|---|---|
| ID | `UIH-<écran>-<n>` (ex. `UIH-settings-03`) |
| Écran | Surface concernée (§3.1) |
| Dimension | couleur / espacement / typo / rayon / élévation / motion / icône / composant / a11y |
| Localisation | `fichier:ligne` réel et exact |
| Constat | Ce qui est observé aujourd'hui |
| Cible | Valeur ou token attendu — **chiffrée et mesurable** |
| Sévérité | voir §6.3 |
| Effort | S / M / L |
| Principe | P1–P10 enfreint(s) |

### 6.3 Modèle de sévérité

| Niveau | Définition |
|---|---|
| CRITIQUE | Casse la cohérence de marque ou l'accessibilité (contraste sous AA, focus invisible) |
| ÉLEVÉ | Incohérence visible inter-écrans (même composant, rendus différents) |
| MOYEN | Écart de polish (espacement off-grille, transition manquante, état incomplet) |
| FAIBLE | Nit (alignement mineur, arrondi marginal) |

## 7. Exécution & vérification

### 7.1 Contraintes d'exécution

- **Read-only strict** : Grep / Read uniquement. Zéro modification de fichier source.
- Les tokens cible n'introduisent **aucune police externe**, restent en **variables
  CSS** (CLAUDE.md §12/§13), compatibles offline strict (§15).
- Aucune recommandation ne touche au pipeline audio ni au virtual scroll.

### 7.2 Passe de vérification du livrable

Le document d'audit n'est considéré complet que si :

- [ ] Chaque `fichier:ligne` cité est réel et exact (échantillon contrôlé manuellement)
- [ ] Chaque token cible couvre 100 % des valeurs constatées dans son inventaire
- [ ] Aucun item de backlog sans cible chiffrée
- [ ] Aucun placeholder, TBD ou section incomplète
- [ ] Chaque item référence au moins un principe P1–P10
- [ ] La feuille de route couvre 100 % des items du backlog

Pas de tests automatisés (livrable documentaire) — la passe de vérification ci-dessus
en tient lieu.

## 8. Emplacements

| Artefact | Chemin |
|---|---|
| Ce spec | `docs/superpowers/specs/2026-05-21-audit-harmonisation-ui-design.md` |
| Document d'audit (output de l'implémentation) | `docs/superpowers/audits/ui-harmonization-audit.md` |

## 9. Suite

Une fois ce spec relu et approuvé : passage à la skill `writing-plans` pour produire le
plan d'implémentation détaillé de l'audit (découpage en tâches, ordre, points de
vérification). Le document d'audit produit servira ensuite d'entrée aux specs de
re-skin écran par écran.
