# Responsive niveau Spotify — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer l'UI de libreflow d'un responsive piloté par breakpoints viewport à un responsive piloté par *container queries* + layout intrinsèque — adaptation fluide continue, composants responsive à leur propre conteneur, aucun état cassé à n'importe quelle taille de fenêtre.

**Architecture:** Trois couches. (1) Une couche de **tokens fluides** (échelles de type/espace en `clamp()`). (2) Des **contextes de container query** sur les zones de layout majeures, avec migration composant par composant de `@media` vers `@container` — chaque composant migré *derrière* les règles `@media` existantes (filet), retirées une fois validé. (3) Un **harnais de régression visuelle** Playwright couvrant le continuum de tailles, posé en PREMIER pour valider chaque tâche par diff d'image. Migration progressive, jamais de big-bang.

**Tech Stack:** CSS container queries (`container-type`, `container-name`, `@container`, unités `cqi`/`cqh`), `clamp()`/`minmax()`/`min()`, Playwright (`@playwright/test`, régression visuelle), Vite 6, Vanilla JS ESM.

**Pré-requis :** la branche doit être propre (les correctifs responsive de `docs/audits/responsive-audit-2026-05-22.md` sont déjà commités — `d7008ea`). Ce plan construit *au-dessus*.

---

## Structure des fichiers

| Fichier | Création / Modif | Responsabilité |
|---|---|---|
| `frontend/tests/visual/playwright.config.js` | Créer | Config Playwright : webServer Vite, projet Chromium, dossier snapshots |
| `frontend/tests/visual/seed.js` | Créer | `addInitScript` : stub `window.__TAURI__` + seed IndexedDB synthétique |
| `frontend/tests/visual/responsive.spec.js` | Créer | Matrice de captures (largeur × hauteur × panneaux) |
| `package.json` | Modifier | Script `test:visual` + devDep `@playwright/test` |
| `frontend/src/style.css` | Modifier | Tokens fluides (`:root`), `container-type`, migration `@media`→`@container` |
| `docs/responsive-contract.md` | Créer | Le « contrat responsive » : seuils canoniques + priorité de contenu par composant |

> Pas de nouveau module JS : la migration est quasi exclusivement CSS. Le seul JS lié reste le `ResizeObserver` déjà en place.

---

## Échelle de breakpoints canonique (référence pour tout le plan)

Trois seuils **intentionnels** remplacent les 6 actuels incohérents (`899/880/719/700/640/520`) :

| Token | Valeur | Sens |
|---|---|---|
| `--bp-compact` | `720px` | sidebar icône-seule, panneaux en overlay |
| `--bp-wide`    | `1100px` | au-delà : densité confortable |
| `--bp-short`   | `560px` (hauteur) | chrome vertical réduit |

Les ajustements *de taille* (et non de disposition) ne doivent PAS utiliser de breakpoint — ils passent par `clamp()` / `@container`.

---

## Phase 0 — Filet de sécurité

### Task 1: Harnais de régression visuelle Playwright

**Files:**
- Create: `frontend/tests/visual/playwright.config.js`
- Create: `frontend/tests/visual/seed.js`
- Create: `frontend/tests/visual/responsive.spec.js`
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Installer Playwright**

Run: `npm i -D @playwright/test && npx playwright install chromium`
Expected: `@playwright/test` ajouté à `devDependencies`, navigateur Chromium installé.

- [ ] **Step 2: Créer la config Playwright**

`frontend/tests/visual/playwright.config.js` :

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  snapshotDir: './__snapshots__',
  // Sert l'app via Vite (pas tauri dev) : le CSS/layout rend en Chromium pur.
  webServer: { command: 'npm run vite', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60000 },
  use: { baseURL: 'http://localhost:1420' },
  // Tolérance anti-bruit (antialiasing) — un vrai changement de layout dépasse largement ce seuil.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

> Note : le port Vite par défaut Tauri est `1420` (cf. `tauri.conf.json` → `devUrl`). Vérifier et ajuster si besoin.

- [ ] **Step 3: Créer le seed (stub Tauri + IndexedDB synthétique)**

`frontend/tests/visual/seed.js` — exporté comme fonction à injecter AVANT le chargement de la page. Stub `__TAURI__` (l'app l'attend via `ipc.js`) et peuple IndexedDB pour que la vraie UI rende (sinon écran d'accueil `#vw`) :

```js
// Injecté via page.addInitScript() — s'exécute dans le contexte page avant tout script de l'app.
export function seedScript() {
  // 1. Stub minimal de l'API Tauri (invoke renvoie des données vides, listen no-op).
  window.__TAURI__ = {
    core: { invoke: async () => [], convertFileSrc: (p) => p },
    event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ listen: async () => () => {} }) },
  };
  // 2. Seed IndexedDB 'libreflow' store 'tracks' avec 200 pistes synthétiques.
  const open = indexedDB.open('libreflow', 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const s of ['tracks', 'playlists', 'playlog', 'cfg']) {
      if (!db.objectStoreNames.contains(s)) {
        db.createObjectStore(s, { keyPath: s === 'cfg' ? 'k' : (s === 'playlog' ? 'ts' : 'id') });
      }
    }
  };
  open.onsuccess = () => {
    const tx = open.result.transaction('tracks', 'readwrite');
    const st = tx.objectStore('tracks');
    for (let i = 0; i < 200; i++) {
      st.put({ id: 't' + i, path: `/m/song${i}.mp3`, name: `Titre ${i}`,
               artist: `Artiste ${i % 25}`, album: `Album ${i % 40}`,
               ext: 'MP3', duration: 180 + i, _hasArt: false });
    }
  };
}
```

> Si l'app n'affiche toujours pas la bibliothèque, la cause est dans la séquence de boot (`app.js`) — adapter le seed (clé `cfg`, flag de première-ouverture) en lisant `app.js` `boot()`.

- [ ] **Step 4: Créer la spec — matrice de tailles**

`frontend/tests/visual/responsive.spec.js` :

```js
import { test, expect } from '@playwright/test';
import { seedScript } from './seed.js';

const WIDTHS  = [600, 720, 900, 1200, 1600];
const HEIGHTS = [400, 600, 800, 1000];

for (const w of WIDTHS) {
  for (const h of HEIGHTS) {
    test(`layout ${w}x${h}`, async ({ page }) => {
      await page.addInitScript(seedScript);
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await page.waitForSelector('#tlist, #vw', { timeout: 10000 });
      await expect(page).toHaveScreenshot(`lib-${w}x${h}.png`, { fullPage: false });
    });
  }
}

// Panneaux ouverts — états les plus à risque (cf. audit R-C3)
for (const panel of ['queue', 'eq']) {
  test(`panel ${panel} @ 720x600`, async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.setViewportSize({ width: 720, height: 600 });
    await page.goto('/');
    await page.waitForSelector('#tlist', { timeout: 10000 });
    await page.click(`#btn-${panel}`);            // adapter au vrai id du bouton
    await page.waitForTimeout(350);               // fin d'animation panneau
    await expect(page).toHaveScreenshot(`panel-${panel}-720x600.png`);
  });
}
```

- [ ] **Step 5: Ajouter le script npm**

Dans `package.json`, section `scripts` :

```json
"test:visual": "playwright test -c frontend/tests/visual/playwright.config.js",
"test:visual:update": "playwright test -c frontend/tests/visual/playwright.config.js --update-snapshots"
```

- [ ] **Step 6: Capturer la baseline**

Run: `npm run test:visual:update`
Expected: 28 captures créées dans `frontend/tests/visual/__snapshots__/`. **Ces images sont la référence AVANT migration** — toute tâche suivante les compare.

- [ ] **Step 7: Commit**

```bash
git add frontend/tests/visual package.json package-lock.json
git commit -m "test: harnais de regression visuelle responsive (Playwright)"
```

---

## Phase 1 — Couche de tokens fluides

### Task 2: Échelle typographique fluide

**Files:**
- Modify: `frontend/src/style.css` (bloc `:root`, après la ligne ~493 `--fs-hero`)

Les `--fs-*` actuels pointent vers des `--text-*` **statiques** (px). On ajoute une couche fluide *à côté* (ne casse rien), adoptée progressivement.

- [ ] **Step 1: Ajouter les tokens fluides au `:root`**

Après `--fs-hero` dans `:root` :

```css
  /* ── Échelle typographique fluide (responsive niveau Spotify) ──────────
     clamp(min, préférence-fluide, max). L'unité cqi = 1% de la largeur du
     conteneur de query le plus proche → le texte respire avec son panneau,
     pas avec la fenêtre. Adoptée progressivement, remplace les --fs-* fixes. */
  --fs-f-caption: clamp(0.69rem, 0.66rem + 0.15cqi, 0.78rem);
  --fs-f-body:    clamp(0.81rem, 0.77rem + 0.25cqi, 0.94rem);
  --fs-f-subhead: clamp(0.94rem, 0.88rem + 0.4cqi,  1.13rem);
  --fs-f-title:   clamp(1.06rem, 0.95rem + 0.7cqi,  1.5rem);
  --fs-f-disp:    clamp(1.4rem,  1.1rem + 2cqi,     2.4rem);
```

- [ ] **Step 2: Vérifier l'équilibre des accolades**

Run: `node -e "const c=require('fs').readFileSync('frontend/src/style.css','utf8');let d=0;for(const ch of c){if(ch==='{')d++;if(ch==='}')d--;}console.log(d)"`
Expected: `0`

- [ ] **Step 3: Régression visuelle (doit être INCHANGÉE — on a seulement ajouté des tokens inutilisés)**

Run: `npm run test:visual`
Expected: 22/22 PASS (aucun token n'est encore consommé → zéro diff).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(css): echelle typographique fluide (clamp + cqi)"
```

### Task 3: Tokens structurels fluides + contrat responsive

**Files:**
- Modify: `frontend/src/style.css` (`:root`)
- Create: `docs/responsive-contract.md`

- [ ] **Step 1: Ajouter les tokens de breakpoint canoniques et un padding fluide au `:root`**

```css
  /* Échelle de breakpoints canonique — 3 seuils intentionnels (voir le plan). */
  --bp-compact: 720px;
  --bp-wide:    1100px;
  /* Padding de zone fluide — remplace les paddings en % et px fixes. */
  --pad-zone:   clamp(var(--sp-3), 2.5cqi, var(--sp-8));
```

- [ ] **Step 2: Créer le contrat responsive**

`docs/responsive-contract.md` — pour CHAQUE composant majeur, ce qui *cède en premier* quand la place manque. Contenu minimal :

```markdown
# Contrat responsive — libreflow

Règle d'or : un composant est responsive à SON conteneur, pas à la fenêtre.

## Ligne de piste (.tr)
Priorité (cède du moins au plus important) : pochette → album → durée → artiste → titre.
Le titre ne se tronque jamais avant que l'album ait disparu.

## Grille albums/artistes
Cartes en repeat(auto-fill, minmax(fluide, 1fr)). Jamais de nombre de colonnes fixe.

## Player bar
Colonne centrale (transport + progression) prioritaire. Les extras (volume, vitesse,
sleep) cèdent d'abord ; les 3 boutons transport + lecture/pause ne disparaissent jamais.

## Panneaux Queue / EQ
< --bp-compact : overlay. Sinon : poussent #main MAIS #main garde >= 320px.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css docs/responsive-contract.md
git commit -m "docs(css): tokens de breakpoint canoniques + contrat responsive"
```

---

## Phase 2 — Contextes de container query

### Task 4: Déclarer les contextes `container-type`

**Files:**
- Modify: `frontend/src/style.css` (règles `#main`, `#content-area`, `#pl`, `#queue-panel`, `#eq-panel`, `#drill-header`)

`container-type: inline-size` rend un élément interrogeable par `@container` sans changer son rendu. **Étape inerte** — aucun `@container` ne l'utilise encore.

- [ ] **Step 1: Ajouter les contextes**

Sur chaque sélecteur, ajouter (sans retirer l'existant) :

```css
#main         { container: main / inline-size; }
#content-area { container: content / inline-size; }
#pl           { container: playerbar / inline-size; }
#queue-panel  { container: panel-queue / inline-size; }
#eq-panel     { container: panel-eq / inline-size; }
#drill-header { container: drill / inline-size; }
```

> `container: <nom> / inline-size` = raccourci `container-name` + `container-type`. Le nom permet de cibler un conteneur précis (`@container content (...)`).

- [ ] **Step 2: Vérifier accolades + build**

Run: `node -e "..."` (cf. Task 2 Step 2) → `0`
Run: `npm run vite:build`
Expected: build OK.

- [ ] **Step 3: Régression visuelle — INCHANGÉE**

Run: `npm run test:visual`
Expected: 22/22 PASS (`container-type` seul ne modifie pas le rendu).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(css): contextes container query sur les zones de layout"
```

### Task 5: Migrer les grilles albums/artistes vers `@container` (composant phare)

**Files:**
- Modify: `frontend/src/style.css` (`.grid-view` ~ligne 2117, `.card`/`.card-art`, blocs `@media` 640px concernant les cartes)

Les grilles utilisent déjà `repeat(auto-fill, minmax(var(--card-min-w), 1fr))` → le reflow est bon. La migration apporte : (a) taille de carte **fluide** au conteneur, (b) densité pilotée par `@container content` et non par la fenêtre → correct que les panneaux soient ouverts ou non.

- [ ] **Step 1: Rendre la largeur de carte fluide**

Remplacer `minmax(var(--card-min-w), 1fr)` dans `.grid-view` par une borne fluide :

```css
.grid-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, clamp(140px, 22cqi, 200px)), 1fr));
  gap: clamp(var(--sp-2), 2cqi, var(--sp-4));
}
```

Le `min(100%, …)` évite tout débordement quand le conteneur est plus étroit qu'une carte.

- [ ] **Step 2: Densité d'info pilotée par `@container`**

Ajouter, et **retirer** l'équivalent du bloc `@media (max-width: 640px)` qui touche les cartes :

```css
/* Conteneur étroit : carte compacte — métadonnées secondaires masquées */
@container content (max-width: 480px) {
  .card-sub  { display: none; }
  .card-info { padding: var(--sp-1h) var(--sp-2); }
}
```

- [ ] **Step 3: Typo de carte fluide**

```css
.card-name { font-size: var(--fs-f-body); }
.card-sub  { font-size: var(--fs-f-caption); }
```

- [ ] **Step 4: Vérifier accolades + build** (cf. Task 4 Step 2).

- [ ] **Step 5: Régression visuelle — diff ATTENDU et à valider**

Run: `npm run test:visual`
Expected: les captures de grilles changent. **Inspecter chaque diff** : les cartes doivent reflower de façon fluide, sans débordement, à 600px comme à 1600px, panneau ouvert comme fermé. Si OK : `npm run test:visual:update`. Si une carte déborde → corriger avant de continuer.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/style.css frontend/tests/visual/__snapshots__
git commit -m "feat(css): grilles albums/artistes en container query fluide"
```

### Task 6: Migrer la liste de pistes (`.tr`) vers `@container`

**Files:**
- Modify: `frontend/src/style.css` (`.tr` ~ligne 1858, bloc `@media (max-width:899px)` touchant `.tr`/`.ta`)

Applique le **contrat** : l'album cède avant le titre.

- [ ] **Step 1: Colonnes de piste pilotées par `@container main`**

Remplacer le bloc `@media`-based de `.tr` par :

```css
/* Large : pochette | titre+artiste | album | actions */
.tr { grid-template-columns: var(--art-list) minmax(0,1fr) minmax(0,12em) auto; }

/* Conteneur moyen : l'album rétrécit AVANT le titre */
@container main (max-width: 820px) {
  .tr { grid-template-columns: var(--art-list) minmax(0,1fr) minmax(0,7em) auto; }
}
/* Conteneur étroit : l'album disparaît, le titre reste */
@container main (max-width: 680px) {
  .tr { grid-template-columns: var(--art-list) minmax(0,1fr) auto; }
  .ta { display: none; }
}
```

- [ ] **Step 2: Retirer les règles `.tr`/`.ta` du `@media (max-width:899px)`** (désormais redondantes — la migration `@container` les remplace). Laisser le reste du bloc `@media` intact.

- [ ] **Step 3: Vérifier accolades + build.**

- [ ] **Step 4: Régression visuelle — diff attendu**

Run: `npm run test:visual`
Expected: les captures de liste changent. **Valider** : à 720x600 panneau EQ ouvert, la liste doit afficher titre+artiste lisibles (l'album a cédé), aucun chevauchement (le bug R-C3 de l'audit doit être visuellement résolu par la migration `@container main`). Si OK : `npm run test:visual:update`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css frontend/tests/visual/__snapshots__
git commit -m "feat(css): liste de pistes en container query (priorite titre>album)"
```

### Task 7: Migrer le drill header vers `@container`

**Files:**
- Modify: `frontend/src/style.css` (`#drill-header`/`.dh-*`, bloc `@media (max-width:640px)` du drill)

- [ ] **Step 1: Remplacer le `@media` 640px du drill par `@container drill`**

```css
@container drill (max-width: 560px) {
  .dh-art  { width: clamp(56px, 18cqi, 96px); height: clamp(56px, 18cqi, 96px); }
  .dh-name { font-size: var(--fs-f-subhead); }
}
```

- [ ] **Step 2: Retirer les règles drill du bloc `@media (max-width:640px)`.**

- [ ] **Step 3: Accolades + build + régression visuelle** (valider le drill header à toutes tailles ; `test:visual:update` si OK).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css frontend/tests/visual/__snapshots__
git commit -m "feat(css): drill header en container query"
```

### Task 8: Migrer la player bar vers `@container playerbar`

**Files:**
- Modify: `frontend/src/style.css` (`#pl`, blocs `@media (max-width:899px)` et `(max-width:719px)` touchant `#pl`/`.pl-*`)

- [ ] **Step 1: Remplacer les règles player bar des `@media` par `@container playerbar`**

```css
/* Étagères latérales rétrécissent ; la colonne centrale est prioritaire. */
@container playerbar (max-width: 900px) {
  .vol .vslider    { width: var(--vol-slider-sm); }
  #sleep-indicator { display: none; }
}
@container playerbar (max-width: 720px) {
  #btn-speed, .vol { display: none; }   /* extras cèdent — transport jamais touché */
}
```

- [ ] **Step 2: Retirer les règles `#pl`/`.pl-*` des blocs `@media` 899/719** (garder le reste de ces blocs : sidebar, etc.).

- [ ] **Step 3: Accolades + build + régression visuelle** (valider que les 3 boutons transport + lecture/pause restent visibles à 600px ; `test:visual:update` si OK).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css frontend/tests/visual/__snapshots__
git commit -m "feat(css): player bar en container query (transport prioritaire)"
```

---

## Phase 3 — Panneaux redimensionnables

### Task 9: Panneaux Queue/EQ redimensionnables avec plancher de contenu

**Files:**
- Modify: `frontend/src/style.css` (`#queue-panel`, `#eq-panel`, `#app.panel-*-open #main`)

L'audit a déjà mis Queue/EQ en overlay sous 720px. Au-delà, ils poussent `#main` ; on garantit ici un **plancher** de largeur de contenu et une largeur de panneau fluide.

- [ ] **Step 1: Largeur de panneau fluide + plancher**

```css
/* Le panneau ne prend jamais plus que "place dispo - 320px de contenu". */
#queue-panel, #eq-panel {
  width: clamp(260px, 26cqi, var(--panel-eq-expert-w));
  max-width: calc(100cqw - var(--sb) - 320px);
}
```

> `cqw`/`cqi` relatifs au conteneur `#main`. Si la place est trop faible, `max-width` gagne et garde 320px au contenu — sous `--bp-compact` le panneau est déjà en overlay (acquis de l'audit).

- [ ] **Step 2: Accolades + build + régression visuelle**

Valider les captures `panel-queue-720x600` / `panel-eq-720x600` : la liste reste lisible derrière/à côté du panneau. `test:visual:update` si OK.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css frontend/tests/visual/__snapshots__
git commit -m "feat(css): largeur de panneau fluide avec plancher de contenu"
```

> **Optionnel (hors périmètre minimal) :** poignée de drag pour redimensionner le panneau à la souris (style Spotify). Nécessite un petit module JS (`pointerdown`/`pointermove` écrivant une CSS var `--panel-eq-expert-w`, persistée dans `cfg`). À planifier séparément si souhaité.

---

## Phase 4 — Nettoyage

### Task 10: Retrait des `@media` redondants + consolidation

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Recenser les `@media (max-width)` restants**

Run: `node -e "const c=require('fs').readFileSync('frontend/src/style.css','utf8');console.log((c.match(/@media[^{]*max-width[^{]*/g)||[]).join('\n'))"`
Expected: liste des `@media` largeur restants.

- [ ] **Step 2: Pour chacun, vérifier que le composant a été migré** (Tasks 5-8). Si oui, **supprimer le bloc** (ou les règles devenues vides). Ne PAS toucher `prefers-reduced-motion` ni les `@media (max-height)` (acquis de l'audit). Conserver uniquement les `@media` width qui pilotent un *vrai changement de disposition* non capturable par `@container` (ex. `--sb` sidebar globale au `:root` — un `@media` global reste correct ici).

- [ ] **Step 3: Aligner les seuils restants sur `--bp-compact`/`--bp-wide`** (un `@media` ne lit pas une CSS var dans sa condition : utiliser la valeur littérale `720px`/`1100px` avec un commentaire `/* = --bp-compact */`).

- [ ] **Step 4: Accolades + build + régression visuelle COMPLÈTE**

Run: `npm run test:visual`
Expected: 22/22 PASS contre la baseline mise à jour au fil des tasks. Tout diff inattendu = régression à corriger.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "refactor(css): retrait des @media redondants post-migration container"
```

### Task 11: Passe de validation finale

- [ ] **Step 1:** `npm run vite:build` → OK.
- [ ] **Step 2:** `npm test` → `Total : 266 OK: 266 KO: 0`.
- [ ] **Step 3:** `npm run test:visual` → 22/22 PASS.
- [ ] **Step 4: Smoke manuel** — `npm run dev`, redimensionner la fenêtre de 600×400 à plein écran *en continu* : l'adaptation doit être fluide (pas de saut), ouvrir Queue/EQ/Now Playing/modal Smart Playlist à 600×400 → rien de coupé ni d'inatteignable.
- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore: validation finale responsive niveau container query"
```

---

## Auto-revue

- **Couverture du spec :** tokens fluides (T2,T3) ✓ ; container queries (T4-T8) ✓ ; panneaux (T9) ✓ ; dimension verticale → acquise de l'audit (`@media max-height`), non re-traitée ici ✓ ; régression visuelle (T1, validée à chaque task) ✓ ; nettoyage breakpoints (T10) ✓.
- **Placeholders :** aucun — chaque task a fichiers exacts, code complet pour les patterns, et une vérification mesurable (accolades / `vite build` / diff visuel).
- **Cohérence des noms :** tokens `--fs-f-*`, `--bp-*`, `--pad-zone` ; conteneurs nommés `main`/`content`/`playerbar`/`panel-queue`/`panel-eq`/`drill` — réutilisés tels quels dans les `@container` des tasks 5-9.

## Risques connus

- **Seed Playwright :** si l'app ne rend pas la bibliothèque avec le stub, lire `app.js` `boot()` et compléter le seed (clé `cfg`). C'est le point le plus incertain — bloquer Task 1 jusqu'à ce que les 28 captures montrent la vraie UI.
- **`cqi`/`@container` :** supportés par WebView2/Chromium (cible Tauri Windows) — aucun souci. Vérifier la version min de WebView2 si support Windows ancien requis.
- **Migration `@media`→`@container` :** toujours derrière le filet de la régression visuelle. Ne jamais retirer un `@media` avant d'avoir validé le `@container` qui le remplace (ordre imposé : ajouter `@container`, valider, puis retirer `@media` — Tasks 5-8 le font, Task 10 nettoie le reste).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-responsive-spotify-level.md`.**
