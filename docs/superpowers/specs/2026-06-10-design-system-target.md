# libreflow — Design System cible (2026)
**Date** : 2026-06-10 · **Statut** : adopté (consolide l'existant, n'invente pas)
**Source de vérité d'implémentation** : `frontend/src/design-system.css` (test-enforced par `token-source.test.cjs`)

Principe directeur : le système actuel est la cible. Ce document fige les décisions, leurs justifications,
et les **deltas** à appliquer (audit 2026-06-10). Cohérence > nouveauté.

---

## 1. Tokens (décisions + justification en une phrase)

### Couleurs
- **Surfaces dark-first** `#030303 → #060606 → #0A0A0A → #0E0E0E` (+ overlay rgba .82) —
  l'élévation par éclaircissement remplace les ombres lourdes, standard du genre en dark mode, jamais de #000 plat.
- **Light dérivé** (`html[data-mode="light"]`, mêmes tokens, valeurs inversées) —
  un seul vocabulaire sémantique garantit la symétrie des deux thèmes (vérifiée : couverture identique).
- **Texte 3 tiers AAA** `--text-primary #F5F6F8 (19:1) / --text-secondary #B4B7C2 (10.3:1) / --text-muted #979CAC (7.5:1)` —
  7:1 sur tous les tiers (SC 1.4.6) tout en gardant une hiérarchie lisible ; `--t4` reste décoratif/placeholder, contrast-exempt.
- **Accent Electric Indigo `#8B6BFF`**, constant dark/light, 8 variantes `[data-theme]` —
  identité distincte de Spotify-vert / Apple-rouge / Tidal-cyan, et la constance inter-thèmes en fait une vraie signature.
- **Sémantiques** : `--state-playing` (=accent), `--state-error #FF5A5F`, `--state-success #4ADE80` —
  trois états suffisent à une app offline sans flux sociaux.
- **Bordures** `--border-subtle/default/strong` (alpha blanc ≥3:1 sur base) — contraste non-texte AA garanti par test.

### Typographie
- **Syne (display)** pour titres d'albums/héros, **DM Sans (UI)** pour tout le reste, self-hosted `@font-face` —
  une famille à caractère + une famille lisible, l'offline (§12/§15) interdit tout CDN.
- **Échelle fluide `clamp()`** (`--text-xs → --text-display`) + variantes container-query `--fs-f-*` —
  le fluide remplace un ratio modulaire figé et suit la fenêtre Tauri redimensionnable.
- **`tabular-nums` pour toute valeur numérique alignée** (durées, stats, dB) —
  delta : promouvoir en utilitaire unique au lieu de 14 répétitions (MI-1).
- Poids 400/500/600/700, interlignes 1.15/1.35/1.55.

### Espacement, rayons, élévation
- **Grille 4px** (`--space-1: 4px → --space-16: 64px`) + 3 hairlines intentionnels (1/2/3px) — 100 % tokenisé, acquis.
- **Rayons** `--radius-xs 4 / sm 6 / md 10 / lg 14 / xl 20 / full` — cards=lg, boutons=sm/md, artwork=sm : un rayon par rôle.
- **Élévations 4 niveaux max** (`--elev-1..4`, ombres noires composées) — en dark l'éclaircissement de surface prime, l'ombre appuie.
- **Z-index 9 paliers nommés** (`--z-base … --z-tooltip`) — delta MA-3 : résorber ~30 littéraux.

### Motion
- **3 durées** : `--motion-fast 120ms` (interaction), `--motion-base 200ms` (transitions vues), `--motion-slow 320ms` (overlays) —
  trois paliers couvrent 95 % des cas mesurés, le reste est documenté littéral (reveal 700ms, art-color 900ms, boucles ambient).
- **2 courbes** : `--ease-standard cubic-bezier(.4,0,.2,1)` et `--ease-spring cubic-bezier(.34,1.56,.64,1)` —
  une courbe neutre + une courbe d'accent émotionnel (like, play) suffisent ; GSAP miroir via `lf-premium`/`lf-overshoot`.
- **Règle absolue** : toute animation passe par tokens CSS ou la façade `motion.js` ; **les boucles canvas
  doivent guarder `prefersReducedMotion()`** (delta CR-1) — le fond ambient rend alors 1 frame statique.

---

## 2. Signature visuelle (une seule audace, exécutée parfaitement)

**Le système couleur vivant** : extraction k-means++ 3 zones de l'artwork (`artcolor.js`) → halo AMOLED,
particules ambient, gradient volume, LERP cinéma — le contenu (l'artwork) colore l'app, le chrome s'efface.
C'est déjà implémenté à un niveau supérieur à Spotify (blur simple) ; on le **consolide** :
contraste texte garanti par scrim (CR-2) et respect reduced-motion (CR-1), plutôt que d'ajouter une
seconde audace (la continuité spatiale artwork→player reste en backlog MI-4, non-signature).

Interdits confirmés : gradient violet/bleu générique, glassmorphism systémique, néon gratuit, #000 plat.

---

## 3. Deltas d'implémentation (Phase 4)

| # | Delta | Fichier(s) |
|---|---|---|
| CR-1 | Guards `prefersReducedMotion()` sur boucles rAF décoratives | cinema.js, cinema-bg.js, nowplaying.js, oscPremium.js |
| CR-2 | Scrim + text-shadow garantis sous texte-sur-artwork | style.css |
| MA-1 | Destructif=`.danger`, validation=`.confirm`, neutre=base | index.html |
| MA-2 | `--target-min` → 44px en `data-platform="mobile"` | design-system.css |
| MA-3 | z-index/borders/font-size littéraux → tokens (lots) | style.css |
| MA-5/MI-1/MI-2/MI-3 | bc-link underline, utilitaire tabular-nums, durées documentées, transition zoom | style.css, design-system.css |
| MA-6 | Skeleton cards grilles (réutilise `--anim-shim`) | style.css, renderer-grids.js |

Dette explicitement reportée (specs dédiées) : MA-4 migration `<lf-modal>`, MI-4 continuité spatiale,
MI-6 bottom-nav mobile explicite + minWidth Tauri.
