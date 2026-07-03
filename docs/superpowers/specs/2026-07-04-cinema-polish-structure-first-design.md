# Mode cinéma — Polish « structure d'abord » (cycle 2)

**Date :** 2026-07-04
**Statut :** validé en brainstorming (architecture, séquencement, stratégie de test approuvés)
**Précédent :** `docs/superpowers/plans/2026-07-02-cinema-overhaul.md` (17 tâches, terminé)

## 1. Contexte et objectif

Le premier cycle d'overhaul a livré le gros œuvre (perf zéro-alloc, a11y, tokens, scrubbing, file d'attente, vagues 7 couches AGC). Un audit à 4 dimensions (visuel/rendu, santé code/robustesse, UX/a11y, performance) mené le 2026-07-04 sur le cluster complet (~3 340 lignes, 10 modules) a produit ~60 findings dont 14 HIGH.

**Objectif du cycle 2 :** restructurer d'abord le cœur du rendu (boucles, FFT, input), puis poser dessus les corrections de robustesse, les gains de perf, le polish visuel premium et les finitions UX/a11y. Approche retenue : **C — structure d'abord** (vs vagues séquencées correctness-first, vs sprint focalisé top-5).

**Cadrage :** audit complet + polish visuel premium + dette & robustesse. **Aucune nouvelle fonctionnalité UX.**

## 2. Architecture cible

### 2.1 Boucle rAF maître — `cinema-loop.js` (nouveau, ~150 lignes)

Constat : 4-5 boucles rAF concurrentes en cinéma (bg, viz, stub viz.js, ticker GSAP, oscPremium fuité), politiques de cadence divergentes (bg cape à 30 fps sans focus, viz jamais ; gel pause partiel).

Cible : une seule boucle, propriété de `cinema-loop.js`, qui par frame :

1. calcule `dt` (clampé, ex. ≤ 100 ms pour absorber les reprises d'onglet) ;
2. remplit le **snapshot FFT partagé** (un seul `getByteFrequencyData`) ;
3. fait tourner le **détecteur de beat unique** (un événement beat par frame, consommé par pochette + fond — remplace les 3 détecteurs désynchronisés `cinema-viz.js:18-20`, `cinema-canvas.js:40`, `:70`) ;
4. appelle `drawBgFrame(dt, fft)` puis `drawVizFrame(dt, fft)`.

Politique de cadence centralisée dans la boucle (et nulle part ailleurs) :

| État | Cadence |
|---|---|
| Focalisé, lecture, waves/starfield/spectrum | 60 fps |
| Focalisé, lecture, ambient/amoled (drift 15-30 s) | 30 fps |
| Fenêtre non focalisée | 30 fps (tous modes) |
| Pause, couleur convergée, énergies ≈ 0, pas de cross-fade | 1 frame statique puis **arrêt** (reprise sur `play`/resize/changement de mode) |
| Reduced-motion | 1 frame statique puis arrêt (comportement existant conservé) |

`cinema-bg.js` et `cinema-viz.js` deviennent des **renderers passifs** : ils exposent `drawFrame(dt, fft)` et ne planifient plus jamais leur propre rAF. `document.hasFocus()` est mis en cache via listeners `focus`/`blur` (plus d'appel par frame).

### 2.2 `dt` propagé partout

Toutes les intégrations par-frame deviennent framerate-indépendantes : `_wavePhases[l] += speed * dt/16.67` (`cinema-canvas.js:300`), `f.life -= 0.035 * dt/16.67` (`:170`), LERP couleur `1 - (1-K)^(dt/16.67)` (`cinema-bg.js:52`). Corrige la mer 2-2.4× trop rapide en 120/144 Hz et rend le cap 30 fps invisible (vitesse constante, comme `_ambientT` le fait déjà pour ambient).

### 2.3 Extraction `cinema-input.js` (nouveau, ~170 lignes)

Tout l'input utilisateur sort de `cinema.js` (797/800 lignes) : `_onCinKey`, `_onCinemaTrapKey`, `_onCinWheel`, `_onArtDblClick`, `_readVol`/`_syncCinVol`, auto-hide des contrôles (`_showControls`/`_hideControls`/`_isKeyboardFocusInOverlay` + timer). Pattern DI éprouvé (`cinema-seek.js`/`cinema-queue.js`) : `initCinemaInput({ getCinemaOpen, closeCinema, toggleCinemaFullscreen, cycleCinemaBg, toggleCinemaRadio, showControls, … })`. Les 4 bugs d'input connus se corrigent **pendant** l'extraction (voir Phase 1). `cinema.js` redescend à ~620 lignes : orchestrateur open/close/update uniquement.

### 2.4 Cycle d'import `player.js ↔ cinema.js` cassé

`player.js:44` importe `updateCinemaProgress` depuis cinema.js pendant que cinema.js/cinema-render.js importent `audio/next/prev/playAt` depuis player.js — dernier cycle du cluster. Cible : `updateCinemaProgress` routé par le bus d'événements (pattern radio.js, `cinema.js:46`). Plus : purge des ~9 imports morts de cinema.js (`eqCtx`, `eqAnalyser`, ligne artcolor complète, `tween`, `set`) et en-têtes périmés ; dédoublonnage `_syncCinVol`/`_setVolSliders` et `_readVol`/`_readVolDom` vers `cinema-render.js` exporté.

## 3. Phases

Chaque phase = commits indépendants vérifiables ; suites complètes vertes + bench non régressé à chaque fin de phase.

### Phase 1 — Fondations structurelles

Tout le §2 ci-dessus, plus :

- **Suspension oscPremium** : `suspendViz()`/`resumeViz()` (viz.js:213-217) pilotent aussi le moteur `createPremiumOscilloscope` (oscPremium.js) — aujourd'hui une boucle 60 fps complète continue sous l'overlay si le viz player-bar est en mode oscilloscope.
- Bugs d'input corrigés pendant l'extraction :
  - touche `C` morte en cinéma alors que le tooltip promet « Fermer [C / Échap] » (`shortcuts.js:160` + absence de `case 'KeyC'` dans `_onCinKey`) ;
  - molette-volume capture le scroll du panneau file (`cinema.js:254-264`, `preventDefault` inconditionnel) → early-return si `e.target.closest('#cinema-queue-panel')` ;
  - seek clavier avec durée NaN → restart de piste (`cinema.js:174`) → garde `isFinite(audio.duration)` ;
  - rAF d'ouverture non annulés dans `closeCinema` (`cinema.js:274,297`) → garde `if (!cinemaOpen) return`.
- Timer cœur dblclick : `clearTimeout` avant réassignation (`cinema.js:146`).

**Risque principal du cycle** : la fusion des boucles touche cinema-bg/cinema-viz en profondeur. Filet : garde-fous de tests + smoke manuel obligatoire (checklist §5) avant de passer en Phase 2.

### Phase 2 — Robustesse

- **Viz mort si cinéma ouvert avant la 1ʳᵉ lecture** (`cinema-viz.js:209-211` : `_startViz` sort si `eqAnalyser` null, l'EQ étant lazy au premier `play`) : événement bus `EQ_READY` émis par `initEQ()`, cinema.js relance `startCinemaViz()` si ouvert.
- Gardes `isFinite(duration)` : `fmt()` (utils.js:30-32, `Infinity:NaN` affiché) ; `formatSeekTime(0)` → `0:00` (cinema-seek.js:54, `–:––` au début de pbar).
- **DPR dynamique** : comparer `devicePixelRatio` dans le check resize de la boucle viz (`cinema-viz.js:219,263-267` + `_drawVolVis`) ; ajouter le mode `spectrum` au handler resize de cinema.js:112-119. (Flou après déplacement multi-écrans.)
- **Gradient ambient post-décodage** : `_cinSwapIn` construit le gradient avant que `img.decode()` résolve (`naturalWidth` = 0 → palette fallback jamais recalculée) → callback post-decode ré-invoque `updateAmbientGradient()` si mode ambient.
- **Snapshot `_ambientCross` retenu cinéma fermé** (`cinema-bg.js:178-191`, ~8 Mo) : sauter le snapshot ou le libérer dans la branche de sortie.
- État couleur : passer `r,g,b` scalaires à `drawWavesFrame`/`drawStarfieldFrame` au lieu du tableau par référence (`cinema-bg.js:265-267`).
- Panneau queue fermé proprement au passage de breakpoint/resize (`_open` orphelin, `aria-expanded` faux).
- `_foamPool` reset dans `killCanvasTweens` (écume fantôme à la réouverture) ; suppression du dead state `_waveBeatTw`.

### Phase 3 — Performance

- **Cap DPR du fond** : backing store de `#cinema-bg` à `min(dpr, 1)` (contenu basse fréquence, ~2-4× de fill-rate GPU gagné en HiDPI) ; plein DPR conservé pour `#cinema-viz` (barres nettes).
- **Arrêt du repaint en pause** : fourni par la politique de la boucle maître (§2.1) — le cinéma en pause passe de « pipeline 60 fps complet + `filter: saturate(.7)` réappliqué » à ~0 % CPU/GPU.
- **Glow pochette compositor-only** : le keyframe `cinema-art-glow` anime `box-shadow` (re-raster main-thread continu, `style.css:4867-4874`) → glow peint une fois dans un `::after`, seule son `opacity` est animée.
- Allocations résiduelles : arrays de radii `[rr,rr,0,0]` pré-alloués module-scope (jusqu'à 144/frame, `cinema-viz.js:138-190`, pattern viz.js:70-71) ; LUT `Int16Array` des bins log (150 `pow`/frame, invalidées si `frequencyBinCount` change).
- Animations CSS scopées : `cinema-art-breathe` et `cinema-ambient-breathe` préfixées `#cinema-overlay.active` (elles tickent cinéma fermé, `style.css:5059-5061`, `4753-4757`).
- Backdrop-filter : retiré des 3 `.cinema-corner-btn` (fond `--cin-surface-hover` plus opaque) — de 6-7 régions de blur re-filtrées par frame à 3-4.
- `_drawVolVis` : ref DOM cachée, mesure au toggle `.ctrl-on`/ResizeObserver, draw sauté quand l'overlay n'a pas `.ctrl-on` ; mesures `clientWidth/Height` de la boucle viz via ResizeObserver.
- Ref canvas + `hasFocus()` cachés dans la boucle (`cinema-bg.js:314`).

Non retenu (documenté) : Path2D pour `_traceWavePath` (trade-off assumé, audit : « ne pas toucher ») ; dirty rects (contenu plein écran, non pertinent).

### Phase 4 — Polish visuel premium

- **Compositing additif `lighter`** sur crêtes de vagues, écume, halos d'étoiles, traînées, glow spectrum (`cinema-canvas.js:246-250`, `:157-173`, `:419-426`, `cinema-viz.js:146-152`) — restauré à `source-over` après chaque usage. Le différenciateur « lumière émise » du rendu Apple Music/Tidal.
- **Grain anti-banding partagé** : `_drawNoise` extrait d'`ambientRenderer.js:101-123` et appliqué en fin de `drawWavesFrame`/`drawStarfieldFrame` (banding garanti sur les grands dégradés sombres, `cinema-canvas.js:281-292`, `:386-396`).
- **Halo réactif dé-clippé** : `min(1, 0.50 + energy*1.1 + beat*0.5)` plaque au plafond dès qu'un morceau est dense → compression douce `0.35 + 0.45*energy + 0.20*beat` + option +3-4 % de rayon au beat (translate/scale, gradient déjà caché).
- **Phases de vagues à l'angle d'or** : `_wavePhases[l] = l * 2.399` à l'init (fini l'effet « calques clonés » à l'ouverture).
- **Étoile filante** : traînée en `createLinearGradient` blanc→transparent (caché par slot, créé au launch — hors hot path) + tête à micro-halo en `lighter` ; decay en `expo.out` (idem beat waves `:135-138`).
- **Scintillement organique** : double sinus non commensurable + réaction modulée par étoile (`hiEnergy·(0.3 + 0.7·_starBri[i])`) — fini le pompage du ciel en bloc (`cinema-canvas.js:402-403`).
- **Reflet d'horizon vivant** : `globalAlpha` modulé par `_waveBandsNorm[0]` (±30 %) + passage en `lighter` (`cinema-canvas.js:308-310`).
- **Écume crédible** : spawn près des crêtes locales (échantillonner `waveY` sur ~8 positions), naissances étalées (life 0.85-1.0 aléatoire), teintée couleur de crête, en `lighter` (`cinema-canvas.js:144-173`).
- **Calibration de luminance des 5 fonds** : stop-0 ambient ~85 %, halo amoled ~.14 — le cycle [B] ne saute plus d'exposition ; ambient/amoled légèrement audio-réactifs (respiration ±1 %, alpha lobes ±10 % pilotés par l'énergie basse du snapshot partagé) — les 5 fonds parlent le même langage.
- **Glow spectrum** : gradient vertical caché au lieu du fillRect quantisé (`Math.round(v*14)/100` supprimé).
- **Mode light** : overrides texte sombre scopés hors `bg-waves/starfield/amoled` (texte quasi illisible sur canvas noir, `style.css:5419-5431`).
- Constantes magiques de cinema-canvas nommées en tête de fichier ; token pour la transition 800 ms de `.cinema-viz` (`style.css:4817`) ; étoiles en jitter stratifié sur grille (init) ; vignette canvas ambient supprimée (doublon avec la vignette CSS).
- Le **beat unifié** (Phase 1, §2.1) est aussi un fix visuel : pochette et fond pulsent enfin sur la même horloge.

### Phase 5 — UX & a11y

- **Cibles** : slider volume `min-height: var(--target-min)` (piste dessinée en background centré — aujourd'hui ~3 px, SC 2.5.8) ; hit-area pbar `inset:-10px 0` (20 px → 24 px).
- **Contraste** : `.cinema-time` de `.38` (≈3.4:1) à `--cin-text-mid` — verrouillé dans `theme-palette.test.cjs`.
- **Ordre de focus** : réordonner le DOM (contrôles → pbar → next/queue → coins) — positionnement absolu, zéro impact visuel ; play/pause passe de 9ᵉ à 1ʳᵉ position Tab.
- **ARIA slider pbar complet** : ↑/↓ = ±5 s avec `stopPropagation` (aujourd'hui ils changent le volume — contraire APG).
- **Panneau queue** : ←/→ stoppés (plus de seek accidentel), Home/End dans la liste, auto-hide du curseur gelé tant que `_open`.
- **Interactions héros** : clic pochette = play/pause (dblclick like conservé — la plus grande zone morte de l'écran devient le contrôle principal) ; morph play↔pause avec cross-fade 120 ms + `playPausePress('#cinema-play')` (spring existant de motion.js).
- **Cœur-burst unifié** : déclenché sur tout like=true (bouton, dblclick — aujourd'hui dblclick seulement).
- **Découvrabilité** : `?` actif en cinéma (→ `toggleShortcuts()`), micro-hint « ? — raccourcis » en fin de chorégraphie d'ouverture (fade-out ~4 s) ; `KeyS` → shuffle ; alias `KeyL`-next retiré au profit de `KeyL` → like.
- **Molette** : `_showControls()` appelé (feedback visible) + annonce du volume via `#cinema-announce`.
- **i18n** : `cinema_next_label` (« Suivant » hardcodé, `index.html:1356`) ; `data-i18n-title="t_cinema_bg"` retiré (affiche « undefined » à `applyLang`) — `updateCinemaBgBtn()` seul propriétaire, rappelé depuis `applyLang` ; `title="Volume"` hardcodé supprimé ; aria-label du bouton fond annonce le mode courant.
- **Fermeture chorégraphiée** : mini-timeline de sortie (art scale 1→0.94 + fade, ~180 ms) symétrique de l'ouverture — inerte sous reduced-motion.

### Phase 6 — Tests & garde-fous (filet final)

- Tests par **import ESM réel** pour `createBeatDetector`, `_parseColorToRGB`, `_monotonicBin`, `stepArtColorLerp` (les copies inline actuelles dérivent sans casser).
- Section « cinema split » : caps `cinema-loop.js` ≤ 200, `cinema-input.js` ≤ 250, `cinema.js` ≤ 650 ; surface d'exports.
- Garde-fous nouveaux : un seul `getByteFrequencyData` dans le cluster ; aucun `requestAnimationFrame` dans cinema-bg/cinema-viz ; `lighter` toujours appairé d'une restauration ; intégrations temporelles × dt (tests purs : 1 frame à 33 ms ≡ 2 frames à 16.5 ms).
- JSDoc orphelin de `computeBandEnergies` corrigé (cinema-waves.js:97-107) ; commentaire `decodeArtImage` sur la comparaison `img.src` documenté.

## 4. Hors périmètre (assumé)

- **Parallax souris** multi-couches (nouvelle feature — beau candidat pour un cycle 3).
- WebGL (l'audit confirme : `lighter` + grain couvrent ~90 % du gap pour une fraction de l'effort).
- Path2D `_traceWavePath`, dirty rects (voir Phase 3).
- Toute nouvelle fonctionnalité UX (paroles, layouts alternatifs, personnalisation).

## 5. Stratégie de test et vérification

- **TDD au fil de l'eau, style maison** : chaque tâche commence par ses tests (RED→GREEN) dans `core.test.cjs`/`a11y.test.cjs`. Logique pure par import ESM réel ; scans regex réservés aux invariants structurels.
- **Checkpoints de phase** : `npm test` + `node frontend/tests/a11y.test.cjs` + `token-source` + `theme-palette` verts ; `npm run bench` non régressé (>5 % = bloquant).
- **Smoke manuel obligatoire fin de Phase 1** (le plus risqué) : `npm run dev` → matrice 5 fonds × {lecture, pause, fenêtre non focalisée, reduced-motion, resize, changement de piste, cycle [B]} ; vérifier : vitesse des vagues identique 60/30 fps, beat pochette+fond synchrones, ~0 % CPU en pause après convergence, reprise propre au `play`.
- **Revues** (table §11 CLAUDE.md) : revue perf sur `cinema-loop.js`, revue invariants sur l'état couleur/FFT partagé, revue whole-branch en fin de cycle.

## 6. Risques

| Risque | Mitigation |
|---|---|
| Fusion des boucles = régression subtile de rendu (ordre bg/viz, cadence) | Phase 1 isolée + smoke matrix obligatoire avant Phase 2 ; renderers passifs testés indépendamment |
| Beat unifié change le ressenti (3 seuils → 1) | Conserver le seuil pochette (1.35/650) comme référence, exposer un multiplicateur par consommateur si le rendu fond souffre |
| Cap DPR fond visible sur certains contenus | Limité au fond basse fréquence ; viz plein DPR ; réversible en 1 constante |
| Arrêt total en pause rate un réveil (edge case cross-fade/resize) | Reprise sur `play`, resize, mode change, visibilitychange ; garde-fou test sur les 4 chemins de reprise |
| `cinema.js` re-gonfle pendant le câblage | Cap test abaissé à 650 dès la Phase 1 (pression structurelle) |
