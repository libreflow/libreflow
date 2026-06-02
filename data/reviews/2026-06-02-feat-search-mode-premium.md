# Audit Tier-1 — Rapport Final
**Date:** 2026-06-02  
**Branch:** feat/search-mode-premium  
**Objectif:** Transformer libreflow en application de qualité production tier-1  
**Tests:** 378/378 verts à chaque phase

---

## Score global

| Domaine | Phase 0 | Final | Delta |
|---------|---------|-------|-------|
| Audio pipeline | 6.0 | 7.0 | +1.0 |
| UI Renderer / Virt | 6.5 | 7.5 | +1.0 |
| CSS / Design System | 8.5 | 8.8 | +0.3 |
| Library / Search | 8.5 | 8.7 | +0.2 |
| Settings / i18n / a11y | 8.0 | 8.7 | +0.7 |
| Device / IPC / CD | 8.5 | 8.8 | +0.3 |
| **Global** | **7.3** | **8.1** | **+0.8** |

---

## Phase 1 — Corrections critiques (session précédente)

- `player.js:964` — `setValueAtTime` remplace `.value=0` (DSP-5)
- `stats.js` — AbortController + event delegation
- `lf-toast-stack.js` — SC 2.5.8 `.t-close` min 24×24px

## Phase 2 — Code mort

- `radio.js` — `_cleanRvProg()` + `_installRvProgUpdate()` (defs + 4 call sites)
- `renderer.js` — `makeEqHTML(_t) { return ''; }` + appel dans thtml
- `app.js` — import `makeEqHTML` retiré
- `radio.js` — `slice(2,8)` → `slice(2,7)` harmonisation

## Phase 3 — Robustesse

- `i18n.js` — clés `device_default_label` + `toast_close` (FR + EN)
- `eqdevice.js` — `setDefaultDeviceLabel()` + `_defaultLabel` var
- `lf-toast-stack.js` — prop réactive `closeLabel` (défaut `'Fermer'`)
- `ui.js` — `liveAnnounce()` sur `toast()` + `toastWithAction()` (a11y AT)
- `selection.js` — `_bteOpenedFrom` : focus restauré à la fermeture batch-tag modal
- `app.js` — wiring `setDefaultDeviceLabel()` + `setToastCloseLabel()` après `initLang()`

## Phase 4 — Performance

- `renderer.js` — `_getArtistMap()` étendu avec `albumCount` ; `renderArtistsGrid()` fast-path O(1) sans query ; schema unifié `displayName`/`art`
- `cinema.js` — snap RGB via `_cinArtRGBTarget` direct (supprime `split(',').map(Number)` par changement de piste)

## Phase 5 — Standards

- `cfg.js` — 4 nouvelles constantes : `FUZZY_THRESHOLD 0.4`, `BOOT_CHUNK 5000`, `STAGGER_CAP 12`, `VIEW_FADE_MS 200`
- `search.js`, `app.js`, `motion.js`, `view-transition.js` — utilisent CFG, plus de magic numbers locaux
- `modal.js` — `export const FOCUSABLE_SEL` canonical ; `playlists.js` + `queue.js` importent et suppriment leurs doublons
- `design-system.css` — `--lf-toast-action` (#8ab4f8 dark / #2563eb light) + `--lf-toast-min-w: 288px`
- `lf-toast-stack.js` CSS — 5 valeurs littérales → tokens (`--text-sm`, `--space-2`, `--space-4`, `--lf-toast-min-w`, `--lf-toast-action`)

---

## Fausses alarmes (ne pas corriger)

| Présomption | Verdict |
|-------------|---------|
| `eq.js:261` volume literal | FAUSSE ALARME — lit `#vol` DOM slider |
| `player.js:878` + `eq.js:827-829` guard `!eqCtx` | FAUSSE ALARME — guard correct |
| `renderer.js` getFiltered() dans scroll handler | FAUSSE ALARME — PM-9, cache chaud |

---

## Dettes restantes

- **A** — `boot()` 365 lignes → scission 4 phases `app.js:355-720` (~3h, risque moyen)
- **B** — `_gridRenderToken` → AbortController `views.js:85-98` (~30min, risque faible)
- **C** — Double RAF keynav+renderer → `VIRT.scrollToIdx()` Promise (~1h, risque moyen)
- Toast `padding: 14px` — non tokenisé (pas de token canonique)
- `.t-action margin: -4px -4px -4px 8px` — valeurs négatives non tokenisées

---

## Commits recommandés

```
refactor(radio): remove no-op _cleanRvProg helpers
refactor(renderer): remove always-empty makeEqHTML export
feat(i18n): add device_default_label and toast_close keys
fix(a11y): liveAnnounce on toasts, closeLabel prop, batch-tag focus restore
perf(renderer): memo renderArtistsGrid via _getArtistMap cache
perf(cinema): use _cinArtRGBTarget directly on track change
refactor(cfg): promote FUZZY_THRESHOLD BOOT_CHUNK STAGGER_CAP VIEW_FADE_MS
refactor(modal): export FOCUSABLE_SEL, remove duplicates in playlists + queue
feat(tokens): --lf-toast-action --lf-toast-min-w in design-system.css
```
