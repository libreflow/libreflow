# Cinema Mode Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer le mode cinéma sur tous les aspects : performance (boucles rAF concurrentes, allocations par frame, fuites GSAP), accessibilité (aria-pressed, aria-live, reduced-motion canvas, auto-hide vs clavier), santé du code (fonctions >50 lignes, duplication beat/couleur, état partagé par référence), design system (tokens, constantes JS/CSS désynchronisées), et UX premium (scrubbing, transitions texte, état pause, cohésion chromatique, cross-fade de fonds, responsive, panneau file d'attente).

**Architecture:** Le mode cinéma reste le cluster de modules existant (`cinema.js` orchestrateur + `cinema-bg.js` + `cinema-viz.js` + `cinema-canvas.js`) avec le pattern init-callback anti-cycle déjà en place. Deux nouveaux modules focalisés sont créés pour ne pas faire exploser `cinema.js` (727 lignes, cap 800) : `cinema-seek.js` (scrubbing) et `cinema-queue.js` (panneau file d'attente). La détection de beat dupliquée 3× est extraite dans `cinema-beat.js`. L'état couleur (`_cinArtRGBCur/Target`) devient privé à `cinema-bg.js` derrière une API de fonctions.

**Tech Stack:** Vanilla ESM JS, GSAP via `motion.js`, tokens CSS dans `design-system.css` uniquement, node:assert pour les tests CJS (`core.test.cjs`, `a11y.test.cjs`).

**Hors périmètre (explicite):** Vue paroles/lyrics (nécessite backend Rust/lofty USLT + spec dédiée — plan séparé futur). Refonte §6 des imports feature↔feature à l'échelle de l'app (le couplage player↔cinema existant est conservé tel quel ; on n'en AJOUTE pas).

## Global Constraints

- Aucun `console.log` dans le code commité — `console.warn` uniquement pour signaux documentés (CLAUDE.md §14)
- Aucun réseau (`fetch`, `XMLHttpRequest`, `WebSocket`) (§15)
- `audio.volume` n'est JAMAIS assigné littéralement — le volume passe par `setMasterGain()` (qui utilise `setTargetAtTime`) et les sliders DOM `#vol` / `#cinema-vol-slider` restent la source de vérité (§2, §9, §13)
- Aucun `.value =` direct sur un AudioParam (§9)
- Toute écriture IDB passe par `saveCfg()` (déjà debouncé via `CFG.CFG_SAVE_DEBOUNCE`) (§8)
- Zéro allocation dans les boucles `requestAnimationFrame` : les strings de couleur (`rgb(...)`, gradients) sont mises en cache et reconstruites uniquement quand la valeur change réellement (§10, common/performance.md)
- Tout nouveau token CSS (`--cin-*`, `--dur-cin-*`, `--ease-*`) est déclaré dans `frontend/src/design-system.css` UNIQUEMENT — jamais de bloc `:root { --… }` dans `style.css` (§17, garde-fou `token-source.test.cjs`)
- Fichiers <800 lignes, fonctions <50 lignes (§16)
- Toute nouvelle clé i18n est ajoutée dans `i18n.fr.js` ET `i18n.en.js` (parité)
- Tests : style maison — `node:assert`, logique inline (pas d'import ESM), scans regex du source pour les garde-fous ; suites `npm test` (core) et `node frontend/tests/a11y.test.cjs` + `node frontend/tests/token-source.test.cjs` doivent rester vertes
- WCAG 2.1 AA + 2.2 AA + critères AAA du projet (§2.9) : aria-pressed sur tout toggle, focus ring ≥2px dual-tone, cibles ≥24×24px, reduced-motion respecté partout (y compris les boucles canvas rAF « maison »)
- `prefers-reduced-motion` : les boucles canvas peignent UNE frame statique puis s'arrêtent (pas d'animation continue) ; utiliser `prefersReducedMotion()` de `motion.js`
- Nouveaux modules cinéma : préfixe `cinema-`, suivent le pattern init-callback existant (`initCinemaBgModule`/`initCinemaVizModule`) pour éviter les cycles d'import ; ils ne sont importés QUE par les modules cinéma ou `app.js`
- Aucun nouvel import cross-feature en dehors du cluster cinéma (ne pas aggraver la dette §6 existante)
- Le test `core.test.cjs` section « cinema split » (≈ lignes 2035-2062) vérifie les tailles de fichiers et la surface d'exports — le mettre à jour si de nouveaux fichiers cinéma sont créés
- Commits : format conventionnel `<type>(<scope>): <description>`, pas d'attribution

---

## File Map

| Fichier | Changements (tâches) |
|---|---|
| `frontend/src/viz.js` | T1: suspension pendant cinéma + garde `document.hidden` |
| `frontend/src/cinema-canvas.js` | T1: kill tweens GSAP + cache strings couleur ; T3: beat via `cinema-beat.js` |
| `frontend/src/cinema-viz.js` | T1: cache strings ; T2: reduced-motion ; T3: extraction `_detectBeat`/`_drawVolVis`, API couleur |
| `frontend/src/cinema-bg.js` | T1: cache innerWidth ; T2: reduced-motion ; T3: état couleur privé + API ; T6: `--cin-rgb-ui` ; T8: cross-fade modes |
| `frontend/src/cinema.js` | T2: aria-pressed/aria-live/auto-hide focus ; T3: split `updateCinema` ; T6: transitions texte + pause + skeleton ; câblage T5/T9 |
| `frontend/src/cinema-beat.js` | **T3: nouveau** — factory détection de beat partagée |
| `frontend/src/cinema-seek.js` | **T5: nouveau** — scrubbing barre de progression |
| `frontend/src/cinema-queue.js` | **T9: nouveau** — panneau file d'attente |
| `frontend/src/app.js` | T1: câblage suspension viz ; T5/T9: side-effect imports éventuels |
| `frontend/src/design-system.css` | T4: tokens `--cin-*`, `--dur-cin-*`, easings ; T8: overrides responsive |
| `frontend/src/style.css` | T2: reduced-motion + focus-within ; T4: remplacement littéraux par tokens ; T5-T9: styles features |
| `frontend/index.html` | T2: aria-pressed/aria-live ; T5: thumb/tooltip ; T7: data-action mute ; T9: panneau queue |
| `frontend/src/i18n.fr.js` / `i18n.en.js` | T6/T7/T9: nouvelles clés |
| `frontend/tests/core.test.cjs` | T1/T3/T5/T6/T9: tests logique + garde-fous |
| `frontend/tests/a11y.test.cjs` | T2/T4/T7: garde-fous a11y |

**Séquencement:** T1→T2→T3 (correctness d'abord), T4 (tokens), puis features T5→T6→T7→T8→T9. Chaque tâche est un commit(s) indépendant vérifiable.

---

### Task 1: Performance — boucles rAF, allocations, fuites GSAP

**Files:** Modify: `frontend/src/viz.js`, `frontend/src/cinema-canvas.js`, `frontend/src/cinema-viz.js`, `frontend/src/cinema-bg.js`, `frontend/src/cinema.js`, `frontend/src/app.js`, `frontend/tests/core.test.cjs`

Findings d'audit adressés : P1 (viz player-bar rend sous l'overlay cinéma), P2 (viz.js sans garde `document.hidden`), P4 (tweens GSAP `_waveBeatTw`/`_shootTweens` jamais tués), allocations de strings par frame (`cinema-viz.js:201,240,273` ; `cinema-canvas.js:117,260-264`), P3 (lecture `window.innerWidth/Height` chaque frame dans `cinema-bg.js:206`).

- [ ] **Step 1 (TDD): tests garde-fous dans core.test.cjs** — nouvelle section « cinema perf » : (a) `viz.js` contient une garde `document.hidden` dans sa boucle de rendu ; (b) `viz.js` exporte `suspendViz`/`resumeViz` (ou noms équivalents documentés) ; (c) `cinema.js` OU `app.js` câble la suspension à l'ouverture/fermeture ; (d) `cinema-canvas.js` exporte une fonction de kill des tweens ET elle est appelée dans le chemin de fermeture ; (e) les boucles draw de `cinema-viz.js`/`cinema-canvas.js` ne contiennent pas de template literal `rgb(${...})` construit inconditionnellement par frame (scan regex pragmatique : la string doit être derrière un check de changement ou hors boucle). Lancer → RED.
- [ ] **Step 2: viz.js** — ajouter `let _vizSuspended = false` + exports `suspendViz()`/`resumeViz()` ; dans `_draw` : si `_vizSuspended || document.hidden`, sauter le rendu (garder le rAF vivant, comme `cinema-viz.js:166`). `resumeViz()` force un redraw immédiat.
- [ ] **Step 3: câblage** — `openCinema()` → `suspendViz()`, `closeCinema()` → `resumeViz()`. Câblage via `app.js` (callbacks passés à `initCinema...`) OU import direct dans `cinema.js` uniquement si un import `viz.js`→`cinema.js` inverse n'existe pas (pas de cycle). Documenter le choix dans le rapport.
- [ ] **Step 4: cinema-canvas.js** — export `killCanvasTweens()` : kill `_waveBeatTw` + tous les `_shootTweens` (via `motionKill` de motion.js), vider le tableau, reset `_waveBeatObj`. Appelée depuis `stopCinemaViz`/chemin de fermeture (`cinema.js:348-390` ou `cinema-bg.js` stop).
- [ ] **Step 5: caches de strings couleur** — dans `cinema-viz.js` et `cinema-canvas.js` : mémoriser la dernière valeur RGB arrondie ; ne reconstruire `_lerpRGB`, `_glowFill`, `starFill`, `rgba(...)` QUE si les composantes arrondies ont changé depuis la frame précédente. Mettre à jour les commentaires « zéro allocation » pour qu'ils redeviennent vrais.
- [ ] **Step 6: cinema-bg.js** — cacher `innerWidth/innerHeight` dans des variables module mises à jour par le handler resize existant (`cinema.js:91`) et `_updateAmbientGradient` ; la boucle lit les variables, plus le DOM.
- [ ] **Step 7:** `npm test` complet → GREEN ; commit.

### Task 2: Accessibilité critique — aria-pressed, aria-live, reduced-motion canvas, auto-hide clavier

**Files:** Modify: `frontend/src/cinema.js`, `frontend/src/cinema-bg.js`, `frontend/src/cinema-viz.js`, `frontend/src/cinema-canvas.js`, `frontend/index.html`, `frontend/src/style.css`, `frontend/tests/a11y.test.cjs`

Findings adressés : A1/A2 (aria-pressed like/shuffle/repeat), A7 (aria-live), A4/A5 (reduced-motion canvas + `.cinema-bg` breathe), A9 (auto-hide masque le contrôle focalisé). Référence de pattern correct : `#cinema-radio` (`cinema.js:543`).

- [ ] **Step 1 (TDD): tests a11y.test.cjs** — (a) `index.html` : `#cinema-shuf`, `#cinema-rep`, `#cinema-lk` portent `aria-pressed` ; (b) `cinema.js` : `setAttribute('aria-pressed'` présent pour les 3 (scan source) ; (c) `index.html` contient une région `aria-live="polite"` dans l'overlay cinéma ; (d) `cinema-bg.js`, `cinema-viz.js`, `cinema-canvas.js` référencent `prefersReducedMotion` ; (e) le bloc CSS `prefers-reduced-motion` de `style.css` couvre `.cinema-bg` ; (f) `cinema.js` : le chemin de masquage des contrôles vérifie le focus (`activeElement`/`:focus-within` — scan source). RED.
- [ ] **Step 2: aria-pressed** — HTML : ajouter `aria-pressed="false"` sur `#cinema-shuf` et `#cinema-rep` (`index.html:1373,1393`) ; JS : dans la synchro d'état (`cinema.js:536-541`), refléter `aria-pressed` en même temps que `.on` pour shuffle, repeat ET like (imiter le pattern radio ligne 543).
- [ ] **Step 3: aria-live** — ajouter dans l'overlay un `<div id="cinema-announce" class="sr-only" aria-live="polite"></div>` (réutiliser la classe visually-hidden existante du projet ; vérifier son nom réel). Dans `updateCinema` au changement de piste : `textContent = "<titre> — <artiste>"`. Ne pas annoncer à chaque tick de progression.
- [ ] **Step 4: reduced-motion canvas** — dans `_startAmbientAnim` (`cinema-bg.js:176`), la boucle viz (`cinema-viz.js:164`) et les rendus waves/starfield : si `prefersReducedMotion()` (import depuis `motion.js`), peindre UNE frame statique puis ne pas replanifier de rAF. Re-render statique déclenché par : changement de piste, resize, changement de mode de fond. Le pulse `.beat` de la pochette est désactivé sous reduce (le keyframe CSS `cinema-beat-pulse` doit aussi être couvert par le bloc reduced-motion CSS s'il ne l'est pas).
- [ ] **Step 5: CSS reduced-motion** — étendre le bloc existant (`style.css:5086-5090`) : `.cinema-bg { animation: none }` (breathe 8s) + `cinema-beat-pulse` neutralisé.
- [ ] **Step 6: auto-hide vs clavier** — dans le callback du timer de masquage (`cinema.js:394-405`) : si `document.activeElement` est un élément focusable À L'INTÉRIEUR de l'overlay autre que l'overlay lui-même (contrôles, coins, pbar, slider), ne PAS masquer — réarmer le timer. Ajouter aussi `focusin` sur l'overlay comme signal d'activité (réarme + montre les contrôles), pour couvrir Shift+Tab depuis l'extérieur.
- [ ] **Step 7:** `node frontend/tests/a11y.test.cjs` + `npm test` → GREEN ; commit.

### Task 3: Santé du code — split des fonctions géantes, beat partagé, état couleur privé

**Files:** Modify: `frontend/src/cinema.js`, `frontend/src/cinema-viz.js`, `frontend/src/cinema-canvas.js`, `frontend/src/cinema-bg.js`, `frontend/tests/core.test.cjs` ; Create: `frontend/src/cinema-beat.js`

Findings adressés : `updateCinema()` 131 lignes (`cinema.js:434`), `_startViz()` 238 lignes (`cinema-viz.js:74`), beat dupliqué 3× (`cinema-viz.js:109`, `cinema-canvas.js:103,250`), état couleur muté par 3 modules via export par référence (`cinema-bg.js:47-50`), null-check seek manquant (`cinema.js:722`), `ac.resume()` sans `.catch` (`cinema-viz.js:90`). **Comportement strictement préservé — refactor pur.**

- [ ] **Step 1 (TDD): tests** — core.test.cjs : (a) `cinema-beat.js` existe, <200 lignes, exporte une factory (`createBeatDetector`) ; tests unitaires inline de la logique beat (énergie > moyenne×seuil, cooldown, historique borné) — porter la logique dans le test comme le style maison ; (b) scan : `cinema-viz.js` et `cinema-canvas.js` n'ont plus chacun leur propre boucle historique de beat (imports depuis `cinema-beat.js`) ; (c) `cinema-bg.js` n'exporte plus `_cinArtRGBCur`/`_cinArtRGBTarget` (arrays par référence) — exporte des fonctions ; (d) mise à jour de la section « cinema split » : ajouter le cap de lignes du nouveau fichier ; (e) aucune fonction >50 lignes dans `cinema.js` (scan pragmatique si le harnais de test le permet, sinon vérification par le reviewer). RED sur (a)-(d).
- [ ] **Step 2: cinema-beat.js** — factory `createBeatDetector({ history, threshold, cooldownMs })` retournant `{ sample(energy, nowMs) → bool }` avec buffers pré-alloués (zéro allocation en régime permanent). Les 3 sites (viz pochette, waves, starfield) l'utilisent avec leurs constantes actuelles respectives (43/1.35/650 ; 1.55/650 ; 1.55/720) — les valeurs ne changent PAS dans cette tâche.
- [ ] **Step 3: état couleur privé** — `cinema-bg.js` garde `_cinArtRGBCur/Target/_LERP_K` privés ; exporte `snapArtColor()` (utilisé par `cinema.js:465`), `stepArtColorLerp()` (fait le LERP, retourne la string `r,g,b` courante — appelé par la boucle de `cinema-viz.js`), en conservant `getArtColorStr`. Adapter les deux consommateurs.
- [ ] **Step 4: split updateCinema** — extraire des helpers <50 lignes chacun : couleur/fond, pochette+swap, métadonnées texte, synchro boutons/états, volume. `updateCinema` devient un orchestrateur court. Aucun changement de comportement ni d'ordre d'exécution.
- [ ] **Step 5: split _startViz** — sortir `_drawVolVis` et le corps de `draw()` en fonctions module-scope <50 lignes (passer l'état via paramètres ou module vars existantes). La détection beat vient de `cinema-beat.js` (Step 2).
- [ ] **Step 6: corrections mineures** — null-check `audio` dans le handler seek (`cinema.js:722`) ; `ac.resume().catch(()=>{})` avec commentaire (`cinema-viz.js:90`) ; stocker le timer heart-burst et le clear dans `closeCinema`.
- [ ] **Step 7:** `npm test` → GREEN (444+ verts, zéro régression) ; vérifier tailles fichiers (`wc -l`) toutes <800 ; commit.

### Task 4: Design system — tokens cinéma, constantes JS/CSS unifiées

**Files:** Modify: `frontend/src/design-system.css`, `frontend/src/style.css`, `frontend/src/cinema.js`, `frontend/src/cinema-viz.js`, `frontend/tests/a11y.test.cjs`, `frontend/tests/core.test.cjs`

Findings adressés : désync swap 440ms JS (`cinema.js:80`) vs 320ms CSS (`style.css:5068`) ; beat 600/620/650 divergents ; focus ring dupliqué 4× (`style.css:5013,5220,5260,5320`) ; ~16 opacités blanches ad hoc ; cubic-beziers inline répétés ; durées d'animations idle littérales.

- [ ] **Step 1 (TDD): test de cohérence JS↔CSS** — core.test.cjs : parser `design-system.css` pour extraire `--dur-cin-swap-out`, `--dur-cin-swap-in`, `--dur-cin-beat` et asserter l'égalité avec les constantes JS (`CIN_SWAP_OUT_MS`, `CIN_SWAP_IN_MS`, `BEAT_PULSE_MS`) extraites par regex du source. a11y.test.cjs : le focus ring cinéma utilise un token unique (plus de littéral répété — scan). token-source.test.cjs doit rester vert. RED.
- [ ] **Step 2: tokens dans design-system.css** — section « Cinema mode » : durées `--dur-cin-swap-out: 120ms`, `--dur-cin-swap-in: 440ms`, `--dur-cin-beat: 620ms`, `--dur-cin-breathe: 6s`, `--dur-cin-bg-breathe: 8s`, `--dur-cin-float: 9s`, `--dur-cin-glow: 5s` ; easings partagés `--ease-spring-soft: cubic-bezier(.34,1.2,.64,1)`, `--ease-spring-softer: cubic-bezier(.34,1.3,.64,1)`, `--ease-kenburns: cubic-bezier(.4,0,.6,1)`, `--ease-beat: cubic-bezier(.22,1,.36,1)` ; focus ring `--cin-focus-ring: 0 0 0 2px rgba(255,255,255,.8), 0 0 0 4px rgba(0,0,0,.25)` ; échelle d'opacités blanches pour les usages répétés uniquement : `--cin-text-hi: rgba(255,255,255,.95)`, `--cin-text-mid: rgba(255,255,255,.72)`, `--cin-text-dim: rgba(255,255,255,.42)`, `--cin-surface: rgba(255,255,255,.06)`, `--cin-surface-hover: rgba(255,255,255,.10)`, `--cin-hairline: rgba(255,255,255,.08)`.
- [ ] **Step 3: remplacement dans style.css** — remplacer les littéraux aux lignes citées par l'audit (4850, 4911, 4955, 4960, 5050, 5068, 5084, 5121, 5134-5137, 5248, 5025, 5207, 5013/5220/5260/5320, et les rgba blanches répétées). `cinema-art-swap` passe à `var(--dur-cin-swap-in)` — **c'est la correction du bug de désync 320↔440**. Ne PAS tokeniser les valeurs uniques propres au canvas (`cinema-canvas.js` constants bas-niveau restent en JS).
- [ ] **Step 4: unifier beat** — `BEAT_PULSE_MS = 620` (cinema-viz.js), keyframe CSS `cinema-beat-pulse` → `var(--dur-cin-beat)` (620ms), cooldown pochette reste 650 (> pulse, comportement inchangé, testé par a11y « ≤3 flashs/s »).
- [ ] **Step 5:** `npm test` + `node frontend/tests/a11y.test.cjs` + `node frontend/tests/token-source.test.cjs` → GREEN ; commit.

### Task 5: Scrubbing complet de la barre de progression

**Files:** Create: `frontend/src/cinema-seek.js` ; Modify: `frontend/src/cinema.js` (câblage + retrait du handler clic basique `cinema.js:717-724`), `frontend/index.html`, `frontend/src/style.css`, `frontend/tests/core.test.cjs`

UX cible : thumb visible quand `.ctrl-on` ou au hover/focus de la pbar ; drag au pointeur (pointerdown + setPointerCapture + pointermove + pointerup) avec mise à jour LIVE du fill et du temps affiché pendant le drag ; `audio.currentTime` commité au relâchement ET au clic simple ; tooltip flottante affichant le temps sous le curseur au hover ; clavier quand la pbar a le focus : Home→0, End→durée, PageUp/PageDown→±30s (les ←/→ ±5s globaux existants restent) ; `aria-valuenow/valuetext` tenus à jour pendant le drag.

- [ ] **Step 1 (TDD): logique pure** — extraire `seekPosFromPointer(clientX, rectLeft, rectWidth, duration)` → secondes clampées [0, duration] et `formatSeekTime(s)` ; tests inline core.test.cjs (bords : x<left, x>right, duration 0/NaN → null, clamp exact). RED.
- [ ] **Step 2: cinema-seek.js** — module <300 lignes : `initCinemaSeek({ audio, pbar, fill, timeEl, tooltip })` (injection de dépendances via init pour rester testable et éviter les cycles) ; gère pointerdown/move/up, hover tooltip, clavier Home/End/PageUp/PageDown, état `_dragging` (pendant le drag, `updateCinemaProgress` ne doit pas écraser le fill — exposer `isSeekDragging()` consommé par `cinema.js`). Null-safe si `audio.duration` absent.
- [ ] **Step 3: markup + CSS** — thumb `.cinema-pbar-thumb` (rond, ≥12px visuel, cible tactile ≥24px via zone étendue existante `inset:-8px`), tooltip `.cinema-seek-tip` (glass, tabular-nums) positionnée au-dessus du curseur. Tokens design-system uniquement, transitions avec `--motion-*`/easings de T4. Curseur `cursor:pointer` sur la pbar.
- [ ] **Step 4: câblage** — remplacer le handler DOMContentLoaded basique par `initCinemaSeek(...)` appelé depuis `cinema.js` (ou `app.js`) ; `updateCinemaProgress` saute la mise à jour du fill quand `isSeekDragging()`.
- [ ] **Step 5:** `npm test` GREEN ; mettre à jour la section « cinema split » (cap lignes du nouveau fichier) ; commit.

### Task 6: Transitions de piste, état pause, skeleton pochette

**Files:** Modify: `frontend/src/cinema.js`, `frontend/src/style.css`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`, `frontend/tests/core.test.cjs`

Findings/UX : texte remplacé brutalement par `textContent` pendant que la pochette a un swap animé ; Ken Burns/float/breathe continuent en pause ; flash vide pendant le décodage de l'image ; écran noir plat sans pochette ; panneau « Suivant » disparaît en shuffle sans explication.

- [ ] **Step 1 (TDD):** tests scan core.test.cjs : (a) classes `.cin-txt-swap*` présentes dans style.css avec durées tokenisées ; (b) `cinema.js` référence `img.decode` ; (c) overlay reçoit une classe pause (`is-paused` — scan) et style.css contient `animation-play-state: paused` pour Ken Burns/float/breathe sous cette classe ; (d) clés i18n `cinema_shuffle_on` présentes fr+en. RED.
- [ ] **Step 2: transition texte** — au changement de piste, appliquer aux `#cinema-title/#cinema-artist/#cinema-album` un swap synchronisé avec la pochette : sortie fade+translateY(-6px) sur `--dur-cin-swap-out`, remplacement du texte, entrée fade+translateY depuis +10px sur `--dur-cin-swap-in` avec `--ease-spring-soft`. Sous reduced-motion : remplacement sec (le bloc CSS reduce neutralise les transitions). Réutiliser les timers de swap existants (`_cinSwapOut/InTimer`) — ne pas créer une deuxième horloge.
- [ ] **Step 3: état pause** — classe `is-paused` sur l'overlay, basculée là où l'icône play/pause est déjà synchronisée. CSS : `animation-play-state: paused` pour `cin-kb-*`, `cinema-float`, `cinema-art-glow`, `cinema-art-breathe`, `cinema-ambient-breathe` + légère désaturation du fond (`filter: saturate(.7)` sur `#cinema-bg`, transition douce tokenisée). Les fonds canvas gèlent déjà via `isPlaying` — ne pas y toucher.
- [ ] **Step 4: skeleton + fallback pochette** — pendant le chargement : placeholder gradient basé sur la couleur dominante courante (`--cin-rgb`) au lieu du vide ; `img.decode().then(fondu d'entrée).catch(fallback)`. Sans pochette : `#cinema-art-em` conservé MAIS le fond de l'overlay reçoit un gradient dérivé de `--cin-rgb` (pas d'aplat noir) — réutiliser le chemin ambient existant.
- [ ] **Step 5: hint shuffle** — quand le panneau « Suivant » est masqué pour cause de shuffle, afficher à la place un libellé discret `i18n('cinema_shuffle_on')` (fr: « Lecture aléatoire », en: "Shuffle on") avec l'icône shuffle, même position/style que le panneau next.
- [ ] **Step 6:** `npm test` GREEN ; commit.

### Task 7: Cohésion chromatique garde-fou contraste + mute cliquable

**Files:** Modify: `frontend/src/cinema-bg.js` (ou `artcolor.js` si plus naturel), `frontend/src/cinema.js`, `frontend/index.html`, `frontend/src/style.css`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`, `frontend/tests/core.test.cjs`, `frontend/tests/a11y.test.cjs`

Findings/UX : `--cin-rgb` sous-exploitée (états actifs sur `--g` global figé), risque de contraste sur `.cinema-album` teinté (A6), icône volume non cliquable (affordance cassée).

- [ ] **Step 1 (TDD): garde-fou contraste** — fonction pure `ensureContrastOnDark([r,g,b], minRatio)` → éclaircit linéairement vers le blanc jusqu'à ratio ≥ minRatio contre noir (#000) ; logique WCAG relative-luminance identique à `tests/_wcag.cjs`. Tests inline : couleur déjà OK inchangée ; couleur sombre remontée à ≥4.5 ; noir pur → gris clair ; idempotence. RED.
- [ ] **Step 2: `--cin-rgb-ui`** — au calcul de la couleur dominante (là où `--cin-rgb` est posée, `cinema.js:468`/`cinema-bg.js`), poser AUSSI `--cin-rgb-ui` = `ensureContrastOnDark(rgb, 4.5)`. `--cin-rgb` (brute) reste pour les fonds/viz.
- [ ] **Step 3: teinter l'UI** — style.css : `.cbtn.on` (couleur + drop-shadow), badge `rep-one`, cœur like actif, fill de la pbar au hover, thumb (T5), accent du slider volume → `rgb(var(--cin-rgb-ui))` au lieu de `var(--g)`. `.cinema-album` → `rgb(var(--cin-rgb-ui))`. Le focus ring reste le token dual-tone de T4 (ne PAS le teinter — AAA 2.4.13 exige la stabilité du contraste).
- [ ] **Step 4: mute cliquable** — `#cinema-vol-icon` devient un vrai `<button>` (ou reçoit `role`/`tabindex` corrects) avec `data-action="cinema-mute"` + `aria-pressed` + `aria-label` i18n (`cinema_mute` fr: « Couper le son », en: "Mute") ; toggle : mémoriser la valeur courante du slider, mettre les sliders (#cinema-vol-slider + #vol via le chemin `setMasterGain`/bus existant `_syncCinVol`) à 0 ; re-clic → restaurer. Icône barrée quand muet (SVG existant du projet si dispo, sinon variante). INTERDIT : `audio.volume = 0` littéral — passer par le chemin slider→setMasterGain existant.
- [ ] **Step 5: tests a11y** — bouton mute : aria-label + aria-pressed + cible ≥24px (scan). `npm test` + a11y GREEN ; commit.

### Task 8: Fonds — cross-fade entre modes, cap amoled, responsive

**Files:** Modify: `frontend/src/cinema-bg.js`, `frontend/src/design-system.css`, `frontend/src/style.css`, `frontend/tests/core.test.cjs`

UX : bascule de fond (touche B) = cut sec ; amoled tourne à 60fps sans raison ; insets de coin en px fixes ; un seul breakpoint 600px ; chevauchements possibles sur petites hauteurs.

- [ ] **Step 1 (TDD):** core.test.cjs : (a) `cinema-bg.js` : le switch de mode passe par le mécanisme de cross-fade (scan de l'appel) ; (b) amoled soumis au même cap 30fps que les autres modes (scan de la condition) ; (c) design-system.css : `--cinema-corner-top/x`, `--cinema-clock-inset` utilisent `clamp(` . RED.
- [ ] **Step 2: cross-fade entre modes** — réutiliser le mécanisme de cross-fade ambient existant (`AMBIENT_CROSSFADE_MS`, snapshot) pour la bascule de mode dans `applyCinemaBg` : snapshot du canvas courant → fondu vers le nouveau mode (durée 600ms, nouvelle constante `MODE_CROSSFADE_MS`). Sous reduced-motion : bascule sèche.
- [ ] **Step 3: cap amoled 30fps** — retirer l'exception amoled du cap (`cinema-bg.js:190-193`) ; vérifier visuellement qu'un halo à 30fps reste fluide (mouvement très lent — oui).
- [ ] **Step 4: responsive** — design-system.css : `--cinema-corner-top: clamp(16px, 2vh, 32px)`, `--cinema-corner-x: clamp(20px, 2.5vw, 48px)`, `--cinema-clock-inset: clamp(40px, 5vh, 80px)` ; @media dans design-system.css : ≥1600px → `--art-cinema-max: 520px` ; style.css : `@media (max-height: 640px)` → masquer `#cinema-clock` et `#cinema-next` (anti-chevauchement) ; breakpoint intermédiaire 601-1023px → pill compacte (volume conservé, vol-vis masqué).
- [ ] **Step 5:** `npm test` + token-source GREEN ; commit.

### Task 9: Panneau file d'attente dépliable

**Files:** Create: `frontend/src/cinema-queue.js` ; Modify: `frontend/src/cinema.js` (le panneau next existant devient le déclencheur), `frontend/index.html`, `frontend/src/style.css`, `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`, `frontend/tests/core.test.cjs`, `frontend/tests/a11y.test.cjs`

UX cible : le panneau « Suivant » (bas-droite) devient cliquable (bouton, `aria-expanded`) ; clic/Enter → panneau glass scrollable listant les 8 prochaines pistes (file explicite d'abord, puis suite de la liste filtrée, ou file radio si radio active — même source de vérité que `_updateNextTrack` `cinema.js:656`) ; chaque rangée (bouton, ≥24px, titre + artiste ellipsés) → clic joue la piste ; Échap ou clic hors panneau referme (Échap dans le panneau NE ferme PAS le cinéma — stopPropagation ciblé) ; focus géré (ouverture → première rangée, fermeture → retour au déclencheur).

- [ ] **Step 1 (TDD): logique pure** — `buildUpcoming({ explicitQueue, filtered, curFilteredIdx, shuffle, radioActive, radioQueue, limit })` → array de tracks (≤ limit) : radio active → tête de file radio + suite ; sinon file explicite (IDs valides) puis pistes suivantes de la liste filtrée à partir de curIdx+1 ; shuffle sans file explicite → array vide (le panneau montre le hint de T6). Tests inline exhaustifs (bords : queue stale IDs, fin de liste, limit, radio). RED.
- [ ] **Step 2: cinema-queue.js** — <300 lignes ; `initCinemaQueue({ getUpcoming, onPlayTrack, panel, trigger })` — injection de dépendances : `cinema.js` fournit `getUpcoming` (branché sur ses imports existants search/queue/radio — AUCUN nouvel import cross-feature dans cinema-queue.js) et `onPlayTrack` (délègue au chemin de lecture existant de player via l'import déjà présent). Rendu des rangées en `textContent` (jamais innerHTML avec des tags — §13). Gestion clavier : flèches ↑/↓ entre rangées, Échap ferme, Tab piégé dans le panneau ouvert.
- [ ] **Step 3: markup + CSS** — le panneau next existant devient `<button id="cinema-next" aria-expanded="false" aria-controls="cinema-queue-panel">` ; nouveau `#cinema-queue-panel` (hidden par défaut, `role="menu"` ou liste de boutons — choisir le pattern le plus simple correct), glass cohérent avec `.cinema-next`, max-height + scroll, animation d'ouverture tokenisée (translateY + fade, `--motion-base`), scrollbar discrète.
- [ ] **Step 4: invariants lecture** — la lecture d'une piste passe par le même chemin que next/prev existants (player gère `radioRefillQueue()` avant `updateBar` — ne pas court-circuiter). `keepQueue` respecté si lecture depuis la file explicite (même sémantique que le panneau queue principal — vérifier `queue.js`/`player.js` et documenter dans le rapport).
- [ ] **Step 5: tests a11y** — `aria-expanded` sur le déclencheur, rangées = boutons avec nom accessible, Échap ne ferme pas le cinéma quand le panneau est ouvert (scan du stopPropagation/garde). Mettre à jour « cinema split » (cap nouveau fichier). `npm test` + a11y GREEN ; commit.

---

### Task 10: Réglage d'animations in-app (Système / Complètes / Réduites, défaut Complètes)

**Files:** Modify: `frontend/src/motion.js`, `frontend/src/app.js`, `frontend/src/settings.js`, `frontend/src/style.css`, `frontend/src/design-system.css` (si blocs concernés), `frontend/src/i18n.fr.js`, `frontend/src/i18n.en.js`, `frontend/tests/core.test.cjs`, `frontend/tests/a11y.test.cjs`

**Contexte / bug produit :** sous Windows avec « Effets d'animation » désactivé (cas de l'utilisateur : `MinAnimate=0`), WebView2 rapporte `prefers-reduced-motion: reduce` → depuis la Task 2, TOUT le cinéma est figé (frame statique canvas, Ken Burns/float/breathe coupés, GSAP en set() instantané). Décision utilisateur : réglage in-app à 3 états, **défaut `full`** (lecteur musical visuel mono-utilisateur ; l'option Réduites conserve la conformité WCAG via contrôle explicite).

- [ ] **Step 1 (TDD):** tests — (a) core: table de vérité de la préférence effective (pure) : `full`→false, `reduce`→true, `system`→OS ; défaut `full` ; (b) scan : `motion.js` exporte `setMotionPref` et `prefersReducedMotion` consulte la préférence app AVANT le media query ; (c) scan : plus AUCUN bloc `@media (prefers-reduced-motion` dans style.css (remplacés par `html[data-motion="reduce"]`) ; (d) scan : app.js pose `data-motion` sur `<html>` au boot et écoute le changement du media query ; (e) i18n fr+en parité des nouvelles clés ; (f) a11y : le select du réglage a un label accessible. RED.
- [ ] **Step 2: motion.js** — variable module `_motionPref` (`'full'` par défaut) + export `setMotionPref(pref)` (valide `'system'|'full'|'reduce'`). `prefersReducedMotion()` : `'reduce'`→true, `'full'`→false, `'system'`→`_rmQuery.matches`. AUCUN nouvel import dans motion.js (app.js pousse la valeur — zéro risque de cycle).
- [ ] **Step 3: app.js (boot + réactivité)** — lit la clé cfg `motionPref` (défaut `'full'`), appelle `setMotionPref`, pose `document.documentElement.dataset.motion = effectif ? 'reduce' : 'full'`. Écoute `_rmQuery` `change` (exposer un hook depuis motion.js, ex. `onMotionPrefChange(cb)` ou l'ajout du listener dans app.js via un export du query) : recalcul de l'effectif → maj `data-motion` + si cinéma ouvert, relancer/arrêter les boucles (`applyCinemaBg()` + refresh viz — réutiliser le chemin existant de changement de mode). Même recalcul quand le réglage change depuis settings.
- [ ] **Step 4: CSS** — remplacer TOUS les blocs `@media (prefers-reduced-motion: reduce)` de style.css par un scoping `html[data-motion="reduce"]` équivalent (sweep global, pas seulement cinéma — le réglage est app-wide). Vérifier design-system.css.
- [ ] **Step 5: settings.js** — contrôle « Animations » (select ou segmenté, pattern existant du panneau réglages) : Système / Complètes / Réduites ; écrit `motionPref` en cfg (debounced via saveCfg), applique immédiatement (Step 3 recalcul). i18n : `settings_motion` (fr « Animations », en "Animations"), `motion_system` (« Système »/"System"), `motion_full` (« Complètes »/"Full"), `motion_reduce` (« Réduites »/"Reduced").
- [ ] **Step 6:** suites complètes vertes ; commit.

### Task 11: Défrizz — fluidité 60fps en cinéma actif, cross-fade spectrum, compositing

**Files:** Modify: `frontend/src/cinema-bg.js`, `frontend/src/style.css`, `frontend/tests/core.test.cjs`

- [ ] **Step 1 (TDD):** scans — (a) la condition de frame-skip de cinema-bg.js dépend de l'état focus/visibilité (pas un cap 30fps inconditionnel) ; (b) le chemin cross-fade de mode gère spectrum (snapshot consommé ou libéré, jamais retenu) ; (c) `will-change` présent sur les éléments animés en continu du cinéma (art-wrap) et NULLE PART ailleurs en ajout non justifié. RED.
- [ ] **Step 2: 60fps en cinéma actif** — dans la boucle de cinema-bg.js : cap 30fps (skip 1/2) UNIQUEMENT quand `document.hasFocus()` est false ; fenêtre focalisée → 60fps pour tous les modes (le viz player-bar est suspendu sous l'overlay depuis T1, le budget est là). L'accumulation temporelle (`_ambientT += now-last`) garantit déjà une vitesse d'animation identique.
- [ ] **Step 3: cross-fade spectrum** — bascule VERS spectrum : consommer le snapshot via un fondu CSS/canvas court OU le libérer immédiatement (`_ambientCross = null`) — jamais de rétention multi-Mo pendant tout le mode spectrum. Bascule DEPUIS spectrum : snapshot d'un canvas vide toléré (fondu depuis noir, déjà le cas).
- [ ] **Step 4: compositing** — `will-change: transform` sur `.cinema-art-wrap` (Ken Burns + float en continu) ; vérifier que toutes les animations cinéma restent transform/opacity-only (aucune propriété layout animée) ; retirer tout `will-change` superflu ajouté.
- [ ] **Step 5:** suites vertes ; `npm run bench` non régressé ; commit.

---

## Addendum 2 (2026-07-03) — Qualité des fonds cinéma (audit)

Audit utilisateur : « les vagues doivent être 7 vagues de bonne qualité, dynamiques, en ambientUI ». Findings #1-12 de l'audit du 2026-07-03 (profondeur vagues inversée, monochrome, dynamique en bloc, allocations rAF ambient, gel pause incohérent, teinte starfield mono-canal, barres graves dupliquées).

### Task 12: Vagues — refonte qualité (profondeur, palette ambient, dynamique par bande)

**Files:** Create: `frontend/src/cinema-waves.js` (pur, <200 lignes, testé par import ESM) ; Modify: `frontend/src/cinema-canvas.js`, `frontend/tests/core.test.cjs`

- [x] **Step 1 (TDD): module pur `cinema-waves.js`** — trois fonctions pures, tests par `await import()` (pattern moveByOne/ensureContrastOnDark) :
  (a) `waveLayerGeom(l, layers)` → `{ yBase, ampBase, fillAlpha, crestAlpha, lineWidth }` normalisés — modèle de profondeur COHÉRENT : `l=0` = arrière (haut ~0.30h, amplitude min, crête faible/fine, remplissage léger), `l=layers-1` = avant (bas ~0.86h, amplitude max, crête lumineuse/épaisse, remplissage dense). Tests : monotonicité stricte des 5 champs sur l ∈ [0,6].
  (b) `waveLayerPalette(r, g, b, layers)` → array de `[r,g,b]` par couche : hue-shift progressif (≈ ±14°/couche, cohérent avec `_buildAmbientColors` ±38/−32), saturation boostée (`boostSat`), rampe de luminance arrière→avant, PLANCHER de luminance pour pochettes sombres (art gris 30,30,30 → couche avant lisible). Tests : longueur, luminance croissante vers l'avant, plancher sur entrée sombre, teintes distinctes entre couches.
  (c) `computeBandEnergies(fftBuf, out, smooth)` → énergies par bande log-espacées (out.length bandes, basses→index 0), EMA lissée dans `out` (zéro allocation). Tests : silence → 0 partout, impulsion basses → bande 0 dominante, lissage EMA effectif. RED.
- [x] **Step 2: consommer dans `drawWavesFrame`** — géométrie par couche depuis `waveLayerGeom` (cachée module-scope), palette par couche cachée (clé lerpRGB), énergies par bande dans un `Float32Array(7)` pré-alloué : couche AVANT pilotée par les basses, arrière par les aigus (amplitude ET vitesse de phase par couche). Buffer `Float32Array(_WAVE_STEPS+1)` partagé : les `y` calculés UNE fois par couche, rejoués pour le remplissage et la crête (sin divisé par 2). Gradients/crêtes recalculés seulement sur invalidation (clé couleur+h, comme aujourd'hui).
- [x] **Step 3: fallback sans analyser** — `!eqAnalyser` ne retourne plus à vide : énergies à 0, vagues statiques dessinées quand même (plus d'écran noir cinéma-avant-lecture). Idem starfield (scintillement à énergie 0).
- [x] **Step 4:** scans (cinema-canvas.js importe cinema-waves.js ; « cinema split » mis à jour avec le cap du nouveau fichier) ; suites vertes ; `npm run bench` ; commit.

### Task 13: Ambient/AMOLED — zéro allocation par frame (§10)

**Files:** Modify: `frontend/src/ambientRenderer.js`, `frontend/src/cinema-bg.js`, `frontend/src/nowplaying.js`, `frontend/tests/core.test.cjs`

- [x] **Step 1 (TDD): scans** — (a) `ambientRenderer.js` ne lit plus `window.innerWidth/innerHeight` (W/H paramètres) ; (b) les `createRadialGradient` du chemin par-frame sont derrière une clé d'invalidation (couleur/W/H), le drift passe par `ctx.translate`/`scale` ; (c) les deux appelants (cinema-bg, nowplaying) passent W/H. RED.
- [x] **Step 2: gradients cachés + transform** — les 4 gradients ambient (g1-g4) + halo amoled créés à l'origine (0,0) avec rayon fixe, cachés keyed (couleurs, W, H) ; par frame : `ctx.save()` → `translate(cx,cy)` (+ `scale(k,k)` pour la respiration de g1) → `fillRect` en coordonnées locales (rect = écran transformé inverse) → `restore()`. Zéro `createRadialGradient`/string par frame en régime stable.
- [x] **Step 3: signature** — `renderAmbientFrame(t, canvas, ctx, mode, colorStr, ambientColors, W, H)` ; cinema-bg passe `_winW/_winH`, nowplaying son propre cache.
- [x] **Step 4:** suites vertes ; bench ; commit.

### Task 14: Cohérence — gel en pause pour tous les fonds + teinte starfield 3 canaux

**Files:** Modify: `frontend/src/cinema-bg.js`, `frontend/src/cinema-canvas.js`, `frontend/src/style.css` (commentaire), `frontend/tests/core.test.cjs`

- [x] **Step 1 (TDD): scans** — (a) l'accumulation `_ambientT += now - last` est conditionnée à `_getIsPlaying()` (gel ambient/amoled/starfield en pause — waves déjà gelées via isPlaying) ; (b) le fond starfield teinte les 3 canaux depuis la couleur d'art (plus de `rgba(0,0,` mono-canal bleu). RED.
- [x] **Step 2:** implémentation + corriger le commentaire style.css (« les fonds canvas gèlent via isPlaying » — désormais vrai pour les 4 modes). Les cross-fades (start/dur sur `performance.now()`) continuent de se terminer pendant la pause — voulu.
- [x] **Step 3:** suites vertes ; commit.

### Task 15: Spectrum — mapping log monotone + fade d'entrée

**Files:** Modify: `frontend/src/cinema-viz.js`, `frontend/src/cinema-bg.js`, `frontend/src/style.css`, `frontend/src/design-system.css` (si token), `frontend/tests/core.test.cjs`

- [x] **Step 1 (TDD):** (a) scan : les mappings log des 3 renderers de barres (`_drawSpectrumBars`, `_drawStandardBars`, `_drawVolVis`) forcent des bins strictement croissants (plus de barres jumelles dans les graves) ; (b) scan : bascule vers spectrum → classe de fade d'entrée sur `#cinema-viz`, animation tokenisée, inerte sous `html[data-motion="reduce"]`. RED.
- [x] **Step 2: bins monotones** — `bin = Math.max(prevBin + 1, bin)` (cap `totalBins-1`) dans les trois boucles de barres.
- [x] **Step 3: fade spectrum** — `applyCinemaBg` (bascule VERS spectrum, hors reduced-motion) pose une classe `viz-fade-in` sur `#cinema-viz` (animation opacity tokenisée `--dur-cinema`, retirée sur `animationend`) — remplace le cut sec documenté en Task 11.
- [x] **Step 4:** suites vertes ; commit.

### Task 16: Vagues — cohérence visuelle position/taille (audit chiffré 2026-07-04)

**Files:** Modify: `frontend/src/cinema-waves.js`, `frontend/src/cinema-canvas.js`, `frontend/tests/core.test.cjs`

Audit chiffré : la mer occupe 0.30h-0.86h (intrusion zone pochette dès le silence) ; excursions jusqu'à ±0.59h vs espacement 0.093h (étagement détruit dès que la musique joue) ; énergie comptée 3× (bande + scalaire global + boost beat 1.65) ; facteur harmonique caché ×1.67 ; progression des longueurs d'onde inversée depuis le flip de profondeur T12 (avant = clapot serré au lieu de houle large).

- [x] **Step 1 (TDD): invariants numériques purs** — (a) `waveLayerGeom` : `yBase` ∈ [0.55, 0.92] (mer sous la zone contenu), espacement uniforme, nouveau champ `freq` STRICTEMENT décroissant vers l'avant (arrière ≈ 3.8 → avant ≈ 1.8, perspective naturelle) ; (b) nouvelle fonction pure `waveY(nx, ph, freq, amp)` — harmoniques à poids normalisés (somme = 1) : `|waveY| ≤ amp` sur une grille (nx, ph) ; (c) export `WAVE_BEAT_BOOST_MAX` (1.25) et invariant pire-cas : `yBase_avant − (ampBase+ampEnergy)_avant × WAVE_BEAT_BOOST_MAX ≥ horizon + 0.10h` (jamais de crête au-dessus de l'horizon, jamais d'intrusion contenu) ; (d) scans : `_drawWaveLayer` consomme `waveY`/`geo.freq`, plus de terme `_waveEnergy` dans l'amplitude (triple comptage retiré), boost beat dérivé de `WAVE_BEAT_BOOST_MAX`. RED.
- [x] **Step 2: cinema-waves.js** — geom rebudgeté (`yBase 0.58+0.30t`, `ampBase 0.012+0.030t`, `ampEnergy 0.022+0.066t`, `freq 3.8−2.0t`) ; `waveY` avec poids [0.62, 0.26, 0.08, 0.04] et multiplicateurs de fréquence [1, 0.62, 2.4, 1.7].
- [x] **Step 3: cinema-canvas.js** — `_drawWaveLayer` : `amp = (ampBase + bande×ampEnergy) × h × boost` (terme énergie globale supprimé — le halo de fond le garde), courbe via `waveY` ; `boostMult = 1 + v × (WAVE_BEAT_BOOST_MAX − 1)`.
- [x] **Step 4:** suites vertes ; bench ; commit.

---

## Vérification finale (après toutes les tâches)

- `npm test` — toutes suites vertes (core + les .cjs individuels : a11y, token-source, theme-palette, sidebar)
- `npm run bench` — pas de régression >5%
- Revue whole-branch (superpowers:requesting-code-review) sur `master..feat/cinema-overhaul`
- Smoke manuel recommandé à l'utilisateur : `npm run dev` → ouvrir cinéma, changer de piste, scrubber, muter, cycler les 5 fonds, ouvrir la file, tester reduced-motion OS, redimensionner
