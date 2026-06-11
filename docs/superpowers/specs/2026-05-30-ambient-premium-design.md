# Spec : Ambient Premium — Refined Ambient Background

**Date :** 2026-05-30  
**Branche :** feat/search-mode-premium (ou nouvelle branche dédiée)  
**Fichiers touchés :** `frontend/src/artcolor.js`, `frontend/src/ambientRenderer.js`, `frontend/src/cinema.js`

---

## Objectif

Améliorer la qualité visuelle du fond ambiant du mode Cinéma sans modifier l'architecture existante. L'approche est incrémentale et rétrocompatible.

Quatre améliorations orthogonales, chacune indépendante :

1. Extraction de couleurs k-means 5 clusters (palette plus riche)
2. Grain cinématique temporel (vrai film grain animé)
3. Dérive multi-harmonique (mouvement organique apériodique)
4. Deux couches de gradient supplémentaires

---

## 1. Extraction de couleurs — k-means 5 clusters

### Problème actuel

`sampleArtColors()` (artcolor.js) divise l'image en 3 zones fixes et fait une moyenne (`regionAvg`) de tous les pixels de chaque zone. Sur une pochette avec fond sombre et sujet coloré, la moyenne produit des teintes ternes — les pixels neutres noient les couleurs vives.

### Solution

Nouvelle fonction `sampleArtColors5(img, size)` dans `artcolor.js` :

**Algorithme :**
1. Dessiner l'image à 64×64 sur un canvas temporaire
2. Lire les 4 096 pixels via `getImageData`
3. Initialiser 5 centroides via **kmeans++** : premier centroide aléatoire, chaque suivant choisi avec probabilité proportionnelle à la distance² au centroide le plus proche
4. **8 itérations** : affectation de chaque pixel au centroide le plus proche (distance euclidienne RGB), recalcul de chaque centroide comme moyenne de ses pixels assignés
5. Calculer la **prominence** de chaque cluster : `taille_cluster / total_pixels`
6. Calculer la **saturation** de chaque couleur finale via `rgbToHsl`
7. Trier par `prominence × saturation` décroissant
8. Appliquer `boostSat` sur chaque couleur retournée
9. Retourner `[c0, c1, c2, c3, c4]`

**Coût :** 4 096 pixels × 8 itérations × 5 comparaisons ≈ 164 000 opérations simples, < 1ms. Exécuté uniquement dans `_buildAmbientColors()` au changement de piste, jamais dans le loop RAF.

**Rétrocompatibilité :** `sampleArtColors()` (3 zones) reste inchangée — `nowplaying.js` continue de l'utiliser sans modification.

### Adaptation dans cinema.js

`_buildAmbientColors()` appelle `sampleArtColors5` à la place de `sampleArtColors`. Elle mappe les 5 couleurs vers la structure étendue :

```js
{
  cT:  colors[0],  // couleur dominante — tache de lumière top-center
  cL:  colors[1],  // 2e couleur — coin bas-gauche
  cR:  colors[2],  // 3e couleur — coin bas-droit
  cB1: colors[3],  // 4e couleur — couche accent 1
  cB2: colors[4],  // 5e couleur — couche accent 2
}
```

Fallback inchangé : si `sampleArtColors5` retourne `null`, `_buildAmbientColors` repasse sur `_cinArtRGB` + déclinaisons HSL.

---

## 2. Grain cinématique temporel

### Problème actuel

Le canvas noise (256×256) est généré une seule fois au chargement du module dans `ambientRenderer.js`. Le grain est statique — il ne bouge pas entre les frames.

### Solution

Ajouter un compteur `_noiseFrame` dans `ambientRenderer.js`. Régénération du canvas noise toutes les **3 frames** (≈ 10fps à 30fps cap).

**Coût :** 256 × 256 `Math.random()` appels toutes les 100ms — négligeable.

La logique de génération existante (bloc `if (!_noiseCanvas)`) est extraite dans une fonction `_regenerateNoise()` réutilisable :

```js
let _noiseFrame = 0;

// Dans renderAmbientFrame, avant le dessin noise :
_noiseFrame++;
if (_noiseFrame % 3 === 0 || !_noiseCanvas) _regenerateNoise();
```

---

## 3. Dérive multi-harmonique

### Problème actuel

Chaque position de gradient est animée par un seul sinus — mouvement parfaitement périodique, perceptible sur la durée.

### Solution

Remplacer chaque dérive par une **somme de 2 harmoniques** au rapport de fréquence irrationnel (nombre d'or φ ≈ 1.618) :

```js
const driftX = (
  Math.sin(t * f1)                * 0.68 +
  Math.sin(t * f1 * 1.618 + 1.1)  * 0.32
) * W * AMP;
```

Ratio 0.68/0.32 préserve l'amplitude globale. La phase offset `+ 1.1` évite un pic d'addition au démarrage.

**Application** sur les 4 variables de dérive : `driftX`, `driftLX`, `driftRX`, `driftCY`. Chaque variable utilise des phases distinctes pour que les gradients ne bougent pas en synchronie.

Toutes les constantes (fréquences, phases, amplitudes) sont déclarées en haut du fichier — aucun magic number inline.

---

## 4. Deux couches de gradient supplémentaires

### Problème actuel

`renderAmbientFrame` dessine 4 passes depuis 3 couleurs. Les 4e et 5e couleurs issues du k-means ne sont jamais utilisées.

### Solution

Ajouter 2 passes de gradient accent **après** les 4 passes existantes et **avant** le noise et la vignette :

- **g5** — accent mid-gauche, rayon `W × 0.38`, opacité max `0.28`
- **g6** — accent mid-droit, rayon `W × 0.32`, opacité max `0.22`

Positions dérivées de nouvelles variables multi-harmoniques (`driftB1X/Y`, `driftB2X/Y`).

**Ordre de dessin :** fond noir → g1 → g2 → g3 → g4 → g5 → g6 → noise → vignette.

**Rétrocompatibilité :** guards `if (cB1)` / `if (cB2)` — `nowplaying.js` passe un `ambientColors` sans ces clés et ne régresse pas.

---

## Invariants respectés

- Aucun appel réseau (§15)
- Aucun `innerHTML` avec contenu non approuvé — les couleurs sont des `[r,g,b]` numériques (§13)
- 30fps cap conservé
- `_noiseCanvas` reste singleton module-level
- `sampleArtColors5` exécutée hors RAF uniquement
- Fonctions < 50 lignes, fichiers < 800 lignes (§16)

---

## Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `frontend/src/artcolor.js` | Ajout `sampleArtColors5()` |
| `frontend/src/ambientRenderer.js` | Grain temporel + multi-harmonique + 2 couches accent |
| `frontend/src/cinema.js` | `_buildAmbientColors()` : appel `sampleArtColors5` + mapping `cB1/cB2` |

---

## Tests

- `npm test` vert (pas de régression)
- Validation manuelle : mode Cinéma sur 5-6 albums variés (fond sombre, coloré, monochrome)
- Vérifier absence de stroboscopie sur le grain (doit sembler continu)
