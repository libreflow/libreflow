# Spec — Bundle analyzer + perf budgets (Sprint 3 / sub-project E)

**Date :** 2026-05-27
**Statut :** Design — en attente de revue utilisateur
**Source :** `docs/audits/quality-audit-2026-05-23.md` plan d'action Sprint 3, item « Bundle analyzer dans CI + perf budgets enforced ».
**Périmètre :** sous-projet E de Sprint 3 uniquement. Les sous-projets A (virtualisation 2D), B (Web Worker), C (migrations IDB), D (code splitting + split de `app.js`) auront leurs propres specs.

---

## 1. Objectif

Mettre en place une mesure perf gating sur PR pour éviter la dérive silencieuse du bundle et du runtime. Deux gates indépendantes :

1. **Budget taille de bundle** sur les chunks Vite produits (`main`, `mini`, `libreflow-core`, `libreflow-extras`, CSS).
2. **Budget runtime** sur les 8 scénarios de `frontend/tests/bench.cjs` (5 filter + 3 virtBuildRows).

Sprint 3 ne peut pas commencer sereinement sans ce harnais : A et D vont déplacer des kilo-octets entre chunks, B va changer le profil temporel de `getFiltered` / `virtBuildRows`. Sans mesure, on naviguera à l'aveugle.

**Non-objectifs :**
- Pas de PR comment bot, pas d'upload d'artefacts treemap, pas de stockage historique (déjà décidé en brainstorming).
- Pas de mesure de Web Vitals (LCP/INP) — la fenêtre Tauri n'a pas les API standard, ce serait du custom non fiable.
- Pas de `cargo bloat` ni de budget binaire Rust (hors scope, à instaurer plus tard si besoin).
- Pas de migration des autres sous-projets Sprint 3 — ce spec ne les couvre pas.

## 2. Critère de succès

- `npm run perf:check` s'exécute localement sans erreur sur master après baseline.
- CI ajoute 3 steps (bundle, bench, bench-compare) qui échouent rouge en cas de régression > tolérance.
- Le diff `perf-budgets.json` / `perf-baseline-bench.json` apparaît explicitement dans la PR lors d'un changement perf intentionnel (jamais auto-update CI).
- Tests unitaires de `perf-bundle.js`, `bench-compare.js` et du flag `bench.cjs --json` dans `core.test.cjs` (subprocess + fixtures). `perf-baseline.js` est un outil opérateur et n'est pas testé automatiquement.
- Smoke manuel : sur `master` HEAD, `npm run perf:check` exit 0.

## 3. Contraintes & invariants

- **Zero new runtime dep.** Match du pattern `bench.cjs` / `core.test.cjs` (vanilla Node, zéro `import`). Les scripts sont en `.js` ESM ou `.cjs` selon ce qui s'aligne au reste du repo.
- **Offline strict (CLAUDE.md §15).** Aucun appel réseau dans les scripts (devDeps incluses).
- **Aucune permission GitHub supplémentaire.** Pas de `pull-requests: write`, pas de token spécial — la CI actuelle suffit.
- **Baseline jamais auto-modifiée par CI.** Toujours explicite via `npm run perf:baseline` + commit du diff.
- **Tolérances documentées dans les fichiers baseline eux-mêmes.** Pas de constantes magiques cachées dans les scripts.

## 4. Architecture

```
                                 ┌────────────────────────────┐
                                 │   perf-budgets.json        │   ← per-chunk byte budgets
                                 │   perf-baseline-bench.json │   ← per-scenario median + tolerance
                                 └────────────┬───────────────┘
                                              │ read
   ┌──────────┐  vite:build   ┌───────────────▼───────────────┐
   │ source   ├──────────────►│ scripts/perf-bundle.js        │ → exit 0/1, table à stdout
   └──────────┘               │   lit dist/assets/*.{js,css}  │
                              │   compare buckets vs budgets  │
                              └───────────────────────────────┘

   ┌──────────┐  --json       ┌───────────────────────────────┐
   │ bench.cjs├──────────────►│ scripts/bench-compare.js      │ → exit 0/1, table à stdout
   └──────────┘               │   compare median vs baseline  │
                              │   tolérance from baseline file│
                              └───────────────────────────────┘

   npm run perf:check  =  vite:build → perf:bundle → perf:bench → perf:bench-compare
   CI: mêmes steps ajoutés au job `frontend` après "Vite build"
```

**Fichiers ajoutés / modifiés :**

| Fichier | Action | Taille estimée |
|---|---|---|
| `scripts/perf-bundle.js` | nouveau | ~60 LOC |
| `scripts/bench-compare.js` | nouveau | ~50 LOC |
| `scripts/perf-baseline.js` | nouveau | ~40 LOC (re-génère les 2 fichiers baseline) |
| `frontend/tests/bench.cjs` | modifié | +10 LOC (flag `--json`) |
| `perf-budgets.json` | nouveau, racine, committé | ~20 lignes |
| `perf-baseline-bench.json` | nouveau, racine, committé | ~20 lignes |
| `package.json` scripts | modifié | +5 entrées : `perf:bundle`, `perf:bench`, `perf:bench-compare`, `perf:check`, `perf:baseline` |
| `.github/workflows/ci.yml` | modifié | +3 steps dans job `frontend` |
| `frontend/tests/core.test.cjs` | modifié | +~50 LOC de tests subprocess |
| `.gitignore` | modifié | +1 entrée `.perf-current.json` |
| `frontend/tests/fixtures/perf/` | nouveau dossier de fixtures pour tests | ~5 fichiers vides + 2 JSON |

## 5. Composants

### 5.1 `scripts/perf-bundle.js` — gate taille de bundle

**Responsabilité :** après `vite:build`, classer les fichiers `dist/assets/` par bucket et échouer en cas de dépassement.

**Logique :**
1. Lister `dist/assets/*.{js,css}`.
2. Pour chaque fichier, dériver le bucket en deux temps : (a) essayer la regex hashée `/^(.+)-[a-f0-9]{8,}\.(js|css)$/` qui correspond au pattern Vite `[name]-[hash].js` ; (b) sinon, fallback `/^(.+)\.(js|css)$/` pour les cas non-hashés (fixtures de test, configurations futures). Le groupe 1 = nom du bucket.
3. CSS : bucket spécial `_css` (somme de tous les `.css`).
4. Sommer les octets bruts par bucket. Calculer aussi le gzip via `zlib.gzipSync({level: 9})` pour reporting uniquement.
5. Comparer total bucket au budget : `budget * (1 + _tolerancePct/100)`. Dépassement = échec.
6. Bucket inconnu (pas d'entrée budgets.json) : WARNING stdout, **n'échoue pas** (`_unknownBucketPolicy: "warn"`). Force une décision consciente au prochain `perf:baseline`.
7. Imprimer table tabulée ; exit 1 si au moins une bucket en dépassement, exit 2 si erreur structurelle (dist manquant, budgets.json manquant).

**Format sortie (toujours stdout) :**
```
Bucket             Raw KB   Gzip KB   Budget    Δ vs budget   Status
main                118.4    42.1     120.0     -1.6 KB       OK
mini                 38.2    13.1      40.0     -1.8 KB       OK
libreflow-core       23.7     8.4      25.0     -1.3 KB       OK
libreflow-extras    195.2    65.0     180.0    +15.2 KB       FAIL
_css                 58.9    11.2      60.0     -1.1 KB       OK
unknown-chunk-x      12.4     4.1       -          -          WARN (no budget)
```

### 5.2 `scripts/bench-compare.js` — gate runtime

**Responsabilité :** lire le JSON émis par `bench.cjs --json`, comparer au baseline, échouer si régression au-delà de tolérance.

**Logique :**
1. Lire fichier passé en argv[2] (ou stdin si pas d'arg). Format : une ligne JSON par scénario.
2. Parser en `Map<label, {medianMs, deltaMB}>`.
3. Lire `perf-baseline-bench.json` (`scenarios` object).
4. Pour chaque entrée baseline : `drift = (current.medianMs - baseline.medianMs) / baseline.medianMs`.
5. Tolérance : per-scenario si présente, sinon `_tolerancePct` racine.
6. `drift > tolerancePct/100` → échec.
7. Scénario présent en baseline mais absent du run courant → ÉCHEC (« bench supprimé »).
8. Scénario présent dans run mais absent baseline → WARNING (« nouveau bench, baseline à régénérer »), pas d'échec.
9. Exit 0/1 selon résultats. Exit 2 si JSON corrompu ou baseline manquant.

**Format sortie :**
```
Scenario                                Baseline   Current    Δ%      Tol     Status
filterExact() full pass empty            42.10 ms   41.80 ms  -0.7%   5%      OK
filterExact() query "shadow"              5.30 ms    5.42 ms  +2.3%   5%      OK
virtBuildRows() sort=az (grouped)        18.30 ms   19.90 ms  +8.7%   5%      FAIL
…
```

### 5.3 `scripts/perf-baseline.js` — régénération manuelle

**Responsabilité :** outil opérateur uniquement. Lance `vite:build` + `bench.cjs --json`, écrit `perf-budgets.json` et `perf-baseline-bench.json` avec les valeurs mesurées + tolérances par défaut.

**Logique :**
1. Refuser si un de ces fichiers existe avec un diff git non commit (force user à committer ou stash).
2. Spawn `vite:build`, exit si non-zero.
3. Lire `dist/assets/`, calculer les buckets comme `perf-bundle.js`, écrire `perf-budgets.json` avec tolérance par défaut `10%`.
4. Spawn `bench.cjs --json`, parser, écrire `perf-baseline-bench.json` avec tolérance par défaut `5%` (`10%` pour les scénarios sous-milliseconde — détection par `medianMs < 1`).
5. Préserver les tolérances déjà personnalisées si le fichier existait (merge non destructif).
6. Imprimer un diff résumé.

### 5.4 `frontend/tests/bench.cjs` — modifications

- Parser `process.argv` pour détecter `--json` parmi les args (le N actuel reste en `argv[2]`).
- Si `--json` : remplacer la sortie tabulée par une ligne JSON par appel de `bench()`, format `{label, medianMs, deltaMB}\n`.
- Le mode humain reste le défaut, inchangé.
- Aucune nouvelle dépendance.

### 5.5 `perf-budgets.json` (committé, racine)

```json
{
  "_tolerancePct": 10,
  "_unknownBucketPolicy": "warn",
  "_note": "Edited by `npm run perf:baseline`. Manual overrides preserved.",
  "buckets": {
    "main":             { "rawBytes": 120000 },
    "mini":             { "rawBytes": 40000 },
    "libreflow-core":   { "rawBytes": 25000 },
    "libreflow-extras": { "rawBytes": 180000 },
    "_css":             { "rawBytes": 60000, "_match": "*.css" }
  }
}
```

Valeurs initiales : à mesurer sur HEAD lors de l'implémentation, pas devinées ici.

### 5.6 `perf-baseline-bench.json` (committé, racine)

```json
{
  "_tolerancePct": 5,
  "_note": "Edited by `npm run perf:baseline`. Per-scenario tolerance overrides.",
  "scenarios": {
    "filterExact() full pass empty":         { "medianMs": <measured> },
    "filterExact() query \"shadow\"":         { "medianMs": <measured> },
    "filterExact() query \"queen pulse\"":    { "medianMs": <measured> },
    "filterExact() cache hit \"shadow\"":     { "medianMs": <measured>, "tolerancePct": 10 },
    "filterFuzzy() query \"shdaow\"":         { "medianMs": <measured> },
    "virtBuildRows() sort=az (grouped)":      { "medianMs": <measured> },
    "virtBuildRows() sort=artist (grouped)":  { "medianMs": <measured> },
    "virtBuildRows() sort=date (flat)":       { "medianMs": <measured> }
  }
}
```

### 5.7 `package.json` scripts

Ajouter :
```json
"perf:bundle":        "node scripts/perf-bundle.js",
"perf:bench":         "node frontend/tests/bench.cjs --json > .perf-current.json",
"perf:bench-compare": "node scripts/bench-compare.js .perf-current.json",
"perf:check":         "npm run vite:build && npm run perf:bundle && npm run perf:bench && npm run perf:bench-compare",
"perf:baseline":      "node scripts/perf-baseline.js"
```

### 5.8 `.github/workflows/ci.yml` — job `frontend`

Ajouter après `Vite build` :
```yaml
- name: Bundle size budget
  run: npm run perf:bundle

- name: Bench (synthetic perf)
  run: npm run perf:bench

- name: Bench regression check
  run: npm run perf:bench-compare
```

## 6. Data flow

### 6.1 Flow développeur local

```
$ npm run perf:check
  ├─ npm run vite:build                       (existant)
  ├─ npm run perf:bundle                      (lit dist/ + budgets.json)
  │     → table stdout, exit 0/1
  ├─ npm run perf:bench                       (écrit .perf-current.json git-ignored)
  └─ npm run perf:bench-compare               (lit .perf-current.json + baseline)
        → table stdout, exit 0/1

Exit non-zero stoppe la chaîne (&&). `.perf-current.json` ne sort jamais du repo local.
```

### 6.2 Flow CI (par push / PR)

```
job frontend (ubuntu-latest):
  ├─ Checkout
  ├─ Setup Node 20
  ├─ npm ci
  ├─ Syntax check                  (existant)
  ├─ Unit tests                    (existant)
  ├─ Vite build                    (existant)
  ├─ Bundle size budget            ← nouveau
  ├─ Bench (synthetic perf)        ← nouveau
  └─ Bench regression check        ← nouveau

Step ≠ 0 → check rouge ; PR ne peut pas merger si branch protection active sur master.
```

### 6.3 Flow « j'ai amélioré perf, je veux baisser le baseline »

```
1. Dev fait l'optimisation (ex: shrink libreflow-extras de 30 KB).
2. Local: `npm run perf:check` → PASS (sous-utilisation, on ne FAIL jamais pour underage).
3. Dev décide de resserrer le budget pour bloquer la régression future :
       npm run perf:baseline
   → régénère perf-budgets.json + perf-baseline-bench.json.
4. Dev revue le diff :
       git diff perf-budgets.json perf-baseline-bench.json
5. Commit explicite dans le même PR que l'optimisation. Rationale en commit body.
6. CI passe sur les nouvelles valeurs.
```

### 6.4 Politique de dérive (documentée, non enforced par code)

- Tolérance bundle : 10% par bucket (chunks fluctuent avec nouvelles features mineures).
- Tolérance bench : 5% par scénario (10% pour scénarios sub-milliseconde, bruités).
- Si une régression est inévitable (feature nécessaire qui gonfle un chunk), le dev DOIT soit la faire tenir sous la tolérance, soit lever le budget dans le **même commit** avec rationale en commit body.
- Jamais d'auto-bump CI. Toujours explicite.

## 7. Error handling & edge cases

| Scénario | Comportement |
|---|---|
| `dist/` n'existe pas quand `perf-bundle.js` tourne | Exit 2, message « Run `npm run vite:build` first ». |
| `perf-budgets.json` n'existe pas | Exit 2, message « Run `npm run perf:baseline` to generate ». |
| Nouveau chunk sans entrée budget | WARNING stdout, exit 0 (`_unknownBucketPolicy: "warn"`). |
| Hash collision / 2 fichiers même bucket | Octets sommés. Documenté en header de `perf-bundle.js`. |
| `bench.cjs --json` crashe mid-run | `.perf-current.json` incomplet → `bench-compare.js` exit 2 « Bench did not complete ». Pas de skip silencieux. |
| Bench bruité en CI (variance runner GitHub) | Mitigé par `RUNS = 5` median + tolérance 5%. Si flaky, future tightening : RUNS=10 (doublé : ~5s → ~10s acceptable). |
| Erreur réseau en CI | Non applicable — aucun appel réseau (CLAUDE.md §15). |
| Windows vs Ubuntu : tailles différentes ? | Bundles JS sont byte-identiques (pas de line endings dans les bundles minifiés). Bench timings diffèrent — CI tourne uniquement sur `ubuntu-latest` pour la cohérence ; baseline = « numbers Ubuntu ». Run local Windows verra timings différents — documenté ici comme limitation connue. |
| Dev régénère baseline sur branche dev, commit, PR sur master | Standard review PR catch ça — diff baseline visible. Pas de handling spécial. |
| Vite change outDir | `perf-bundle.js` lit constante `DIST_DIR = 'dist'`. Changement = 1 ligne ; documenté en header. |
| `_css` matche `style.css` mais aussi un futur `print.css` | Sommés ensemble (comportement voulu). Future split CSS = ajouter explicitement un bucket. |

## 8. Plan de tests

Tests dans `frontend/tests/core.test.cjs` (subprocess + fixtures, pas de framework nouveau) :

### 8.1 Tests `scripts/perf-bundle.js`

Fixtures : créer `frontend/tests/fixtures/perf/dist/assets/` avec fichiers `.js`/`.css` de tailles connues (via `Buffer.alloc(N)`), généré dynamiquement par le test setup.

1. Fixture under-budget → exit 0, stdout contient « OK ».
2. Fixture over-budget → exit 1, stdout contient le nom du bucket + « FAIL ».
3. Fixture avec chunk inconnu → exit 0, stdout contient « WARN ».
4. `dist/` manquant → exit 2, stdout « vite:build ».
5. `perf-budgets.json` manquant → exit 2, stdout « perf:baseline ».

### 8.2 Tests `scripts/bench-compare.js`

Fixtures : fichiers JSON pré-écrits dans `frontend/tests/fixtures/perf/`.

6. Fixture identique baseline → exit 0.
7. Fixture +4% sur un scénario → exit 0 (sous tolérance 5%).
8. Fixture +7% sur un scénario → exit 1, stdout nomme le scénario.
9. Fixture sans un scénario baseline → exit 1, stdout « deleted bench ».
10. Fixture avec scénario en plus → exit 0, stdout « new bench, no baseline ».

### 8.3 Test `bench.cjs --json`

11. Spawn `bench.cjs --json N=1000` (N petit pour vitesse), assert 1 ligne JSON par scénario, chaque ligne `JSON.parse` valide avec `{label, medianMs}`.

### 8.4 Smoke manuel (non automatisé)

- `npm run perf:check` sur master après baseline → exit 0.
- Modif d'un fichier source (+50 KB padding), rebuild, `npm run perf:check` → exit 1 sur la bucket impactée.

## 9. Critères d'acceptation (recap)

- [ ] `perf-budgets.json` + `perf-baseline-bench.json` générés depuis HEAD, committés.
- [ ] `scripts/perf-bundle.js`, `scripts/bench-compare.js`, `scripts/perf-baseline.js` créés.
- [ ] `bench.cjs --json` fonctionne, sortie testée.
- [ ] CI ajoute les 3 nouveaux steps dans le job `frontend`.
- [ ] 11 tests subprocess passent dans `core.test.cjs`.
- [ ] `npm run perf:check` exit 0 sur master.
- [ ] Smoke manuel régression : modifier un source pour dépasser, `perf:check` exit 1.
- [ ] Aucune nouvelle dépendance runtime ou devDep (vanilla Node).
- [ ] Aucun appel réseau ajouté (CLAUDE.md §15 respecté).
- [ ] Aucune permission GitHub Actions nouvelle.
- [ ] Commit unique de type `feat: perf budgets + bundle gate (sprint 3/E)`.

## 10. Hors scope (pour mémoire — autres sous-projets Sprint 3)

- **A** — Virtualisation 2D des grilles albums/artistes.
- **B** — Web Worker pour `getFiltered()` / `virtBuildRows` à N > 10k.
- **C** — Migrations IDB versionnées avec changelog.
- **D** — Code splitting par feature + split de `app.js` god-module.

Chacun aura son spec séparé. Ce spec **E** prépare le terrain en fournissant le harnais de mesure que A, B, D utiliseront pour valider leurs gains/régressions.
