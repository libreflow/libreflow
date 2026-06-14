# Welcome Screen Redesign — Design Spec
**Date:** 2026-06-14  
**Status:** Approved  
**Scope:** `#vw` — écran de bienvenue (première ouverture, bibliothèque vide)

---

## 1. Objectif

Transformer l'écran de bienvenue actuel (logo 512px + 4 feature cards + 2 CTAs) en un écran premium minimaliste centré sur l'impact visuel et le mouvement, cohérent avec l'identité "Premium Audio Vantablack" de libreflow.

**Problèmes résolus :**
- Manque d'impact visuel — trop sobre, pas assez "haut de gamme"
- Écran statique — aucune vie, aucune animation

**Ce qui disparaît :**
- Les 4 feature cards (elles décrivent, elles ne convainquent pas)
- Le second CTA "Importer une playlist" (réduit à lien texte discret ou supprimé)

---

## 2. Layout & Structure

Centrage absolu vertical + horizontal dans `#main` (hors titlebar, sidebar, player bar). Axe unique vertical, de haut en bas.

```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│           [Logo 160px]                  │
│                                         │
│          LibreFlow                      │
│   Ton lecteur audio. Hors ligne.        │
│                                         │
│    [ Choisir mon dossier… ]             │
│                                         │
│   ou glisse-dépose des fichiers ici     │
│                                         │
│                                         │
│  ░░░░ ambient canvas (fond) ░░░░░░░░░  │
└─────────────────────────────────────────┘
```

### Dimensions & espacements

| Élément | Valeur |
|---------|--------|
| Logo | 160px × 160px |
| Gap logo → titre | `--space-8` (32px) |
| Gap titre → tagline | `--space-2` (8px) |
| Gap tagline → CTA | `--space-8` (32px) |
| Gap CTA → hint | `--space-4` (16px) |
| CTA max-width | 280px |
| Canvas | `position: absolute`, `inset: 0`, `z-index: 0` |
| Contenu | `position: relative`, `z-index: 1` |

---

## 3. Identité Visuelle

### Logo
- SVG existant, rendu à 160px
- Halo CSS : `filter: drop-shadow(0 0 24px var(--accent-glow))`
- Aucune modification du fichier SVG

### Titre "LibreFlow"
| Propriété | Valeur |
|-----------|--------|
| Font | `--font-display` (Syne) |
| Taille | `--text-xl` (clamp 22→32px) |
| Poids | `--weight-bold` (700) |
| Couleur | `--text-primary` (#F5F6F8) |
| Letter-spacing | `--tracking-tight` (-0.01em) |

### Tagline
| Propriété | Valeur |
|-----------|--------|
| Texte | "Ton lecteur audio. Hors ligne." |
| Font | `--font-body` (DM Sans) |
| Taille | `--text-md` (clamp 15→18px) |
| Poids | `--weight-regular` (400) |
| Couleur | `--text-muted` (#979CAC) |

### Bouton CTA principal
| Propriété | Valeur |
|-----------|--------|
| Texte | "Choisir mon dossier…" |
| Background | `--accent` (#8B6BFF) |
| Couleur texte | `--text-on-accent` (#050505) |
| Padding | 14px 32px |
| Border-radius | `--radius-full` (9999px) |
| Shadow | `--shadow-glow` |
| Font | DM Sans Semibold (`--weight-semibold`) |
| Taille | `--text-base` |
| Hover | bg → `--accent-hover`, shadow plus prononcée |
| Active | bg → `--accent-active`, `scale(0.97)` |
| Transition | `--motion-fast` (120ms), `--ease-standard` |

### Hint drag & drop
| Propriété | Valeur |
|-----------|--------|
| Texte | "ou glisse-dépose des fichiers ici" |
| Couleur normale | `--text-muted`, opacity 0.6 |
| Couleur survol fichier | `--text-secondary`, opacity 1 |
| Taille | `--text-sm` |
| Transition | opacity `--motion-base` (200ms) |

Le survol fichier est détecté via la classe existante sur `#drago` — on ajoute seulement un sélecteur CSS qui relaye l'état sur le hint.

### Fond
`--bg-base` (#030303) pur. Le canvas ambient se superpose en `opacity: 0.4` maximum pour ne jamais écraser le noir.

---

## 4. Animations

### 4.1 Entrée staggerée (one-shot)

Déclenchée une seule fois à l'affichage de `#vw` (class `.on`). Implémentée en CSS avec `animation-delay` + `animation-fill-mode: both`.

| Élément | Délai | Durée | Effet |
|---------|-------|-------|-------|
| Canvas ambient | 0ms | 600ms | `opacity: 0 → 0.4` |
| Logo | 150ms | 500ms | `opacity: 0 → 1` + `translateY(12px → 0)` |
| Titre | 350ms | 400ms | `opacity: 0 → 1` + `translateY(8px → 0)` |
| Tagline | 500ms | 400ms | `opacity: 0 → 1` + `translateY(6px → 0)` |
| CTA | 700ms | 350ms | `opacity: 0 → 1` + `scale(0.95 → 1)` |
| Hint | 900ms | 300ms | `opacity: 0 → 0.6` |

**Easing :**
- Tous les éléments : `--ease-standard` (`cubic-bezier(.4, 0, .2, 1)`)
- CTA uniquement : `--ease-spring` (`cubic-bezier(.34, 1.56, .64, 1)`) pour l'élasticité

**`prefers-reduced-motion` :** tous les délais à 0ms, opacité directement à la valeur finale (pas de translate, pas de scale).

### 4.2 Logo breathing (loop infini)

Animation CSS pure, pas de JS.

```css
@keyframes logo-breathe {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 0 24px var(--accent-glow));
  }
  50% {
    transform: scale(1.02);
    filter: drop-shadow(0 0 36px var(--accent-glow));
  }
}

.welcome-logo {
  animation: logo-breathe 3.5s ease-in-out infinite;
  animation-delay: 900ms;
}

@media (prefers-reduced-motion: reduce) {
  .welcome-logo { animation: none; }
}
```

### 4.3 Ambient canvas (loop infini)

Réutilise le système `cinema-bg.js` existant en mode "idle" :

- **Particules :** 12–20 points, couleur `--accent` à 8% opacité
- **Mouvement :** dérive brownienne très lente (vitesse max 0.3px/frame)
- **FPS cap :** 30fps via `requestAnimationFrame` throttle
- **Canvas opacity :** 0.4 (jamais plus, pour ne pas empiéter sur le Vantablack)
- **`prefers-reduced-motion` :** un seul frame fixe rendu, pas de loop

**Interface d'appel proposée :**
```js
cinemaBg.startIdle({ particleCount: 16, opacity: 0.4 })
// appelé depuis renderer.js quand #vw devient .on
// stoppé quand #vw perd .on
```

Si `cinema-bg.js` ne supporte pas encore ce mode "idle", une fonction dédiée `startWelcomeAmbient()` est créée dans le même fichier (pas de nouveau module).

---

## 5. Intégration & Fichiers Touchés

| Fichier | Changement |
|---------|-----------|
| `frontend/index.html` | Remplacer le contenu de `#vw` (logo + titre + tagline + CTA + hint, supprimer les 4 cards) |
| `frontend/src/style.css` | Ajouter `.welcome-logo`, `.welcome-title`, `.welcome-tagline`, `.welcome-cta`, `.welcome-hint` + keyframe `logo-breathe` |
| `frontend/src/renderer.js` | Appeler `cinemaBg.startIdle()` / `stopIdle()` selon l'état `.on` de `#vw` |
| `frontend/src/cinema-bg.js` | Ajouter `startIdle(opts)` / `stopIdle()` si absent |

Aucun nouveau module. Aucune dépendance externe.

---

## 6. Accessibilité

- Le bouton CTA existant conserve son `aria-label` et son rôle (`button`)
- Le canvas reçoit `aria-hidden="true"` et `role="presentation"`
- L'animation CSS respecte `prefers-reduced-motion` (§4.1 et §4.2)
- Le logo reçoit `alt="LibreFlow"` si rendu en `<img>`, sinon `aria-label` sur l'élément SVG
- Ratio de contraste inchangé (textes déjà AAA, CTA déjà AA)

---

## 7. Hors Périmètre

- Aucune modification de la bibliothèque (`#vlib`), du player bar, ou du sidebar
- Aucune modification du système de feature cards pour d'autres vues
- Aucune animation sur les icônes SVG des cards (supprimées)
- Pas de nouveau canvas engine — réutilisation de `cinema-bg.js` uniquement
