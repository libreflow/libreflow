# LibreFlow — Audit UI Approfondi

**Date** : 19 mai 2026
**Périmètre** : UX, Design System, Accessibilité profonde, Qualité du code UI
**Méthodologie** : 4 audits spécialistes en parallèle (lecture seule)

---

## 1. Notes par axe

| Axe | Note | Tendance |
|---|---:|---|
| UX (flows, friction, feedback) | **77 / 100** | Solide ; manque undo + cohérence modaux |
| Design system & cohérence visuelle | **72 / 100** | Tokens avancés mais drift d'inline styles |
| Accessibilité profonde (au-delà WCAG cases) | **74 / 100** | WCAG OK ; expérience SR perfectible |
| Qualité du code UI | **78 / 100** | Architecture saine ; duplication + god-modules |

**Note UI agrégée (pondérée 30/25/25/20) : 75 / 100**

Pour atteindre 90+ : adresser les 12 problèmes P0/P1 ci-dessous.

---

## 2. Problèmes UI à régler — par priorité

### 🔴 P0 — Bloqueurs / High impact

| # | Problème | Fichier | Type | Effort |
|---|---|---|---|---|
| **1** | **`#shortcuts-panel` n'est pas un dialog accessible** : pas de `role="dialog"`, pas d'`aria-modal`, pas de focus trap, pas d'`aria-labelledby` | `index.html:1292-1318` | a11y BLOCKER | S |
| **2** | **Bouton répétition trompe le SR** : 3 états (off/all/one) mappés sur `aria-pressed` binaire → SR ne distingue jamais "tout" de "un" | `index.html:285` + `player.js:625-641` | a11y BLOCKER | S |
| **3** | **`organizeCancel()` ne restaure pas le focus** — opener perdu après fermeture | `organize.js:203` | a11y régression | XS |
| **4** | **`regen-cur-pl` handler manquant** : empty state smart playlist propose "Régénérer" mais aucune action câblée → dead-end | `handlers.js` | UX dead-end | XS |
| **5** | **`AUDIO_EXTS` dupliqué et inline styles dans 106 endroits de index.html** : drift de tokens, classes secondaires hardcodées | `index.html` (settings 471-595, spl 782-1062) | DS HIGH | M |
| **6** | **Toasts d'erreur en `aria-live=polite`** au lieu de `role="alert"` → erreurs IPC / IDB quota peuvent passer inaperçues | `ui.js:42-80` | a11y SERIOUS | S |

### 🟠 P1 — Sérieux / Medium-high impact

| # | Problème | Fichier | Type | Effort |
|---|---|---|---|---|
| **7** | **Sliders sans `aria-valuetext` humain** : volume annoncé "0.74", crossfade "5", LUFS "-14" — non actionnable | `index.html:322,808,824,1282` + listeners | a11y SERIOUS | S |
| **8** | **Ordre boutons modaux incohérent** : 8 modaux avec hiérarchie variable ; CD modal 3 primaires côte à côte sans hiérarchie | `index.html:355-358,367-370,379-382,419-423,1361-1364` | UX HIGH | M |
| **9** | **Pas d'undo après suppression piste / vider lib / organize** : confirm modal sans toast "Annuler 8s" | partout, pattern `confirmAction()` | UX HIGH | M |
| **10** | **Tooltip troncation manquant** sur titres/artistes longs dans la tracklist | `renderer.js` thtml + `style.css .tr` | UX MEDIUM | S |
| **11** | **`.tr.act` (piste courante) repose UNIQUEMENT sur la couleur** — pas d'icône, pas d'`aria-current="true"` | `renderer.js` thtml | a11y color-only | XS |
| **12** | **Sort direction color-only** : caret CSS sans annonce SR de l'ordre | `index.html:200` `#sort-lbl` | a11y color-only | XS |

### 🟡 P2 — Améliorations significatives

| # | Problème | Fichier | Type | Effort |
|---|---|---|---|---|
| 13 | Welcome screen : USB/CD planqués dans Settings — ajouter CTAs | `index.html:141-162` (vw welcome) | UX onboarding | S |
| 14 | Pas de bouton "Annuler" sur le scan initial → si scan 50k files, ragequit | `watchfolder.js:57-132` | UX long-running | M |
| 15 | CD rip : pas de progression GLOBALE (juste fill par track) | `cdaudio.js:172-224` | UX feedback | S |
| 16 | **64 `!important` dans style.css** — symptôme spécificité mal gérée light mode | `style.css` | DS HIGH | M |
| 17 | **stroke-width SVG hétérogène** : 1.4/1.5/1.7/2/2.2/2.5 mélangés sur 92 SVG | `index.html` | DS visual | M |
| 18 | **22 tokens spacing redondants** (`--sp-1d/--sp-3h/...`) hors échelle 4/8/12/16 | `style.css:151-175` | DS dette | M |
| 19 | Couche sémantique CSS absente : composants touchent directement `--bg3`, `--t2` au lieu de `--surface-card`, `--text-secondary` | `style.css:104-122` | DS architecture | L |
| 20 | **`renderAlbumsGrid` / `renderArtistsGrid` / `renderPlaylistsGrid` : 95% duplication** | `renderer.js:602-831` | Code MAJOR | M |
| 21 | **607 `document.getElementById` magic strings** — `dom.js` existe mais sous-utilisé | tous modules | Code MAJOR | L |
| 22 | **`registerHandlers()` retourne un cleanup jamais appelé** — leak HMR | `handlers.js:612-639` | Code MAJOR | S |
| 23 | **viz.js : ResizeObserver jamais `disconnect()`** | `viz.js:112` | Code leak | XS |
| 24 | EQ curve canvas sans alternative SR (10 valeurs invisibles) | `eq.js` | a11y SERIOUS | S |
| 25 | Mots anglais (Hardstyle/Trap/Lofi) sans `lang="en"` — SR FR les prononce en français | `index.html:1118-1120` | a11y i18n | XS |
| 26 | Sleep timer countdown non annoncé (T-5min, T-1min) | `sleep.js` | a11y annonce | S |
| 27 | Sel-bar : Escape comme dismiss non annoncé (pas d'`aria-keyshortcuts`) | `index.html:215-237` | UX discoverability | XS |
| 28 | Inline cssText dans selection.js pour picker — devrait être CSS class | `selection.js:119-122` | Code MINOR | XS |
| 29 | Toasts : pas de limite de stacking (5 nouveaux files → 5 toasts) | `ui.js` | UX feedback | S |
| 30 | Focus ring `var(--g)` accent dynamique : risque < 3:1 sur cyan/jaune | `style.css:292` | a11y contraste | S |

### 🟢 P3 — Polish / Long-term

- Sleep menu : `role="dialog"` inadéquat → devrait être `role="menu"`
- Mini-overlay close : `✕` Unicode → SVG cohérent
- Boot spinner copy : "Chargement de votre bibliothèque…"
- Backup .libreflow : afficher taille estimée
- Batch tag inputs : pré-remplir avec valeur commune si shared, sinon `(plusieurs valeurs)`
- Format chips empty : "Aucun MP3" au lieu de générique
- Tooltip cohérence (title= natif vs custom `#seek-tip`/`#vol-tip`)
- 28 font-sizes distincts → échelle modulaire 10/12/14/16/20/26/32/48/72
- Renommer doc CLAUDE.md (`--t1..5` → réalité `--t/--t2..4`, Inter retiré, `--bg0..5` → `--bg/--bg1..6`)
- Centraliser `IDS` constants

---

## 3. Patterns récurrents à corriger systémiquement

1. **`if (!el) return` répété 50+ fois** → helper `withEl(id, fn)` ou `$id(id)?.…` chaining
2. **Container-or-create pattern** dupliqué sur 10 sites → `getOrCreateChild(parentId, id, tag, cls)`
3. **Empty state cascade** dupliqué entre renderLib + 3 grids → `renderEmptyState(gridEl, …)`
4. **Click-outside dismiss** ré-implémenté dans ctxmenu, selection picker, pl-ctx menu, pl-quick-pop → `openTransientPanel(el, {closeOn:[outsideClick, escape], onClose})`
5. **Focus restore on close** redéfini dans confirmAction, promptAction, confirmClear, ctxmenu, smartPlaylistModal → centraliser via `installAutoFocusTrap` registry
6. **SVG paths inline** dupliqués 10+ fois → `icons.js` registry (`ICON.play`, `ICON.shuffle`)
7. **toast() / toastWithAction()** : 80% logique partagée → factoriser `_makeToast()`
8. **Inline styles 106× dans index.html** → classes utilitaires (`.mbtn--sm`, `.set-row__compact`, `.mbtn.secondary`)

---

## 4. Points forts (UI wins déjà acquis)

- **Skeleton rows** dimensionnés au viewport (`renderer.js:584-597`)
- **Empty states contextuels** : 5 variantes par vue + CTA adapté
- **Focus trap auto** sur 7 dialogs via `installAutoFocusTrap` (modal.js)
- **`#pbar` keynav complet** : Arrow/Home/End/PgUp/Dn (ajout récent)
- **Tablists ARIA complètes** : aria-controls + aria-labelledby (ajout récent)
- **Accent dynamique `@property --g`** — rare en vanilla CSS
- **Parité dark/light explicite** via `html[data-mode="light"]`
- **8 régions `aria-live`** ciblées
- **`prefers-reduced-motion` honoré** (9 blocs)
- **Skeleton + virtualisation + debounce** → performance perçue excellente
- **`data-action` delegation rigoureuse** — zéro `onclick=` inline
- **`esc()` universellement appliqué** — toasts XSS-safe via textContent
- **Roving tabindex** sur virt list
- **Double-rAF** pour view transitions (anti-reflow)
- **18 raccourcis clavier documentés** (`#shortcuts-panel`)
- **Sauvegarde / restauration .libreflow** atomique
- **Cancel rip CD** + détection "annulée vs erreur"
- **Tokens WCAG suivis activement** (`--t3` 5.4:1, `--t2` 9.1:1 documentés)

---

## 5. Plan d'attaque recommandé

### Sprint 1 — Quick wins P0 (1-2h)
- #3 organize focus restore (XS)
- #4 regen-cur-pl handler (XS)
- #11 `.tr.act` aria-current + icône ▶ (XS)
- #12 sort-lbl annonce direction (XS)
- #23 viz.js ResizeObserver disconnect (XS)
- #25 `lang="en"` sur chips genre (XS)
- #27 aria-keyshortcuts sur sel-close (XS)

### Sprint 2 — A11y core P0 (3-4h)
- #1 `#shortcuts-panel` dialog complet (S)
- #2 repeat 3-states avec annonce live (S)
- #6 toast erreur → role="alert" séparé (S)
- #7 sliders aria-valuetext humain (S)
- #30 double focus ring contraste garanti (S)

### Sprint 3 — UX cohérence P1 (4-6h)
- #5 inline styles → classes utilitaires + `.mbtn.secondary` (M)
- #8 standardiser ordre boutons modaux (M)
- #10 tooltip troncation `.tr` (S)
- #17 stroke-width SVG standardisé (M)
- #29 limite toasts stacking (S)

### Sprint 4 — Patterns / Refactor P2 (sprint dédié)
- #20 extraire `renderGrid()` helper
- #21 `IDS` constants + dom.js partout
- #22 AbortController cleanup HMR
- #18 purger tokens spacing redondants
- #19 introduire couche sémantique CSS

### Sprint 5 — Long-running UX P2 (4-6h)
- #9 undo pattern via toastWithAction
- #14 cancel scan initial
- #15 progression globale CD rip
- #24 EQ curve summary live
- #26 sleep countdown annonces

---

## 6. Estimation gain après patches

| Sprint exécuté | UX | DS | a11y | Code | **UI agrégée** |
|---|---:|---:|---:|---:|---:|
| Avant | 77 | 72 | 74 | 78 | **75** |
| Après Sprint 1 (XS) | 80 | 72 | 80 | 79 | **78** |
| Après Sprint 2 (a11y core) | 80 | 72 | 88 | 79 | **80** |
| Après Sprint 3 (UX cohérence) | 87 | 79 | 90 | 80 | **84** |
| Après Sprint 4 (refactor) | 87 | 86 | 90 | 88 | **88** |
| Après Sprint 5 (long-running) | 92 | 86 | 93 | 88 | **90** |

---

*Audit généré le 19 mai 2026.*
