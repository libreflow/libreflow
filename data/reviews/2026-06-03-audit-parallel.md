# Audit parallèle — feat/search-mode-premium
**Date:** 2026-06-03 | **6 domaines audités en parallèle**

---

## 1. Performance — bench

**VERT — baseline établi (première mesure)**

| Opération | Médiane |
|-----------|---------|
| filterExact "shadow" | 173.91 ms |
| filterExact cache hit | 3.21 ms |
| filterFuzzy "shdaow" | 174.46 ms |
| virtBuildRows az/grouped | 9.78 ms |
| virtBuildRows date/flat | 1.07 ms |

Baseline enregistré dans `data/perf/baselines.json`.

---

## 2. GSAP Tween Lifecycle — 4 HIGH · 3 MEDIUM · 2 LOW

**G-H1** `motion.js:222` — `modalOpen` : `clearProps` manque `opacity` → modale invisible après double-clic
**G-H2** `motion.js:221` — `modalOpen` reduced-motion : `gsap.from(opacity:0, dur:0)` → modale invisible
**G-H3** `settings.js:219` — race close/open → `.then(_doClose)` orphelin cache le panneau rouvert
**G-H4** `queue.js:249` — race closeQueue/toggleQueue → `.then(remove.open)` s'exécute après réouverture

**G-M1** `motion.js:255` — `trackSwap` : `clearProps` manque `opacity` sur titre/artiste
**G-M2** `motion.js:283` — `staggerIn` : pas de `clearProps:'opacity'` → cards figées sur rebuild
**G-M3** `views.js:125` — race viewExit.then(cleanup) quand A→B→A < 140ms → flash vide

**G-L1** `motion.js:266` — `playPausePress` : `clearProps:'transform'` absent
**G-L2** `motion.js:291` — `staggerOut` : export mort, jamais consommé

---

## 3. Burger Menu ARIA — NON-CONFORME

| Priorité | Manquant | Fichier |
|----------|---------|---------|
| CRITICAL | Arrow/Home/End navigation | `handlers.js` (à ajouter) |
| CRITICAL | Focus initial à l'ouverture | `handlers.js:360` |
| CRITICAL | Focus retour `#tbt-burger` après Escape | `shortcuts.js:178` + `handlers.js:92` |
| HIGH | Fermeture sur Tab | `handlers.js` (à ajouter) |
| HIGH | Roving tabindex dynamique | `handlers.js` (à ajouter) |
| LOW | `aria-haspopup="true"` → `"menu"` | `index.html:34` |

Présents : aria-expanded, Escape, clic extérieur, roles, aria-label, aria-hidden SVG.

---

## 4. Queue Pin — 1 BUG · 2 INFO

**QP-B1 (MEDIUM)** `handlers.js:135,186` — `clearQueuePin()` non appelé pour cinema/mini-player
Fix: ajouter dans les actions `toggle-cinema` et `toggle-mini-player`.

**QP-I1** `queuePinned` non déclaré dans `_state` de store.js (champ fantôme).
**QP-I2** `toggleQueuePin()` ne persiste pas lui-même — dépend de l'appelant.

Boot restore : OK. Padding double : OK (mêmes valeurs CSS).

---

## 5. Search Sort — 1 BUG · 1 dead export

**SR-B1 (MEDIUM)** `search.js:getFiltered()` — Query `"   "` (espaces) passe dans `_relevanceSort` car truthy → rank 3 uniforme → tri alpha inattendu sur toute la library.
Fix: `const query = (get('query') || '').trim();` en tête de `getFiltered()`.

**SR-I1** `wasFuzzySearch()` exporté mais aucun consommateur — dead export.

Chemins mutuellement exclusifs : OK. Escape regex : OK. FUZZY_THRESHOLD=0.4 : OK.

---

## 6. Z-index — 3 HIGH · 2 LOW

**ZI-H1** `style.css:3817` — `#queue-panel`/`#eq-panel` z=50 (magic) → sous titlebar (z=100)
Fix: `z-index: var(--z-dropdown)` (200)

**ZI-H2** `style.css:5293` — `#shortcuts-panel`/`#dupes-panel` z=300 → sous `#drago` (z=500)
Fix: `z-index: var(--z-modal)` (800)

**ZI-H3** `style.css:2818` — `.prompt-bg` z=900 → collision avec `--z-player` (900)
Fix: `calc(var(--z-modal) + 120)` = 920

**ZI-L1** Modales +150 (z=950) dépassent `--z-player` — à documenter.
**ZI-L2** `.tr-grp` z=2 diverge de `.grp-lbl` var(--z-sticky) — même rôle.

---

## Tableau de bord

| Audit | Sévérité | Findings |
|-------|----------|---------|
| Perf/bench | VERT | Baseline établi |
| GSAP lifecycle | 4 HIGH | 4H + 3M + 2L |
| Burger menu ARIA | NON-CONFORME | 3 CRITICAL + 2 HIGH |
| Queue pin | MEDIUM | 1 bug + 2 info |
| Search sort | MEDIUM | 1 bug + 1 dead export |
| Z-index | 3 HIGH | 3H + 2L |

**Total : 10 HIGH/CRITICAL · 5 MEDIUM · 5 LOW/INFO**
