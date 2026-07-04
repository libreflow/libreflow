// LibreFlow — cinema.js
// Mode Cinéma : overlay plein-écran, fond flou, contrôles masquables.
// Extrait de app.js.
//
// Dépendances :
//   import  : cinema-render.js (helpers de rendu extraits de updateCinema)
//   import  : cinema-seek.js (scrubbing complet de la pbar, Task 5 — injection de deps)
//   import  : cinema-input.js (clavier/molette/dblclick/contrôles auto-masquables, Task 6 — injection de deps)
//   import  : saveCfg (cfgsave.js), updateVolSlider (playerbar.js)
//   window  : audio, curIdx, tracks, liked, shuffle, repeat, getFiltered (getters), toast
//
// Exports publics (utilisés par app.js) :
//   cinemaOpen, cinemaBg
//   toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress
//   setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn
//   toggleCinemaFullscreen, toggleCinemaRadio
//   CINEMA_BG_MODES, CINEMA_BG_LABELS
//   (toggleCinemaMute — Task 7 — vit dans cinema-render.js, cap 650 lignes ici depuis Task 6)
//   initCinemaVizSuspend (câblage viz.js suspendViz/resumeViz — appelé une fois depuis app.js)

import { eqCtx, eqAnalyser, masterGainNode, setMasterGain } from './eq.js'; // réutiliser le graphe EQ existant
import { i18n }                               from './i18n.js';
import { get, set }                           from './store.js';
import { audio, toggleLike, next, prev, getNextIdx, hasExplicitQueueNext } from './player.js';
import { radioActive, stopRadio, startRadio, getRadioQueue } from './radio.js';
import { toast }                                        from './ui.js';
import { saveCfg }                   from './cfgsave.js';
import { rgbToHsl, hslToRgb, boostSat, regionAvg, sampleArtColors } from './artcolor.js';
import { emit, on, EVENTS }          from './bus.js';
import { timeline, tween, set as motionSet, kill as motionKill, eases } from './motion.js';
import { cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS, applyCinemaBg, setCinemaBg, cycleCinemaBg,
         syncCinemaBgSettings, updateCinemaBgBtn, initCinemaBg, initCinemaBgModule,
         updateCinArtColor,
         stopAmbientAnim, resetAmbientColors, updateAmbientGradient,
         updateCachedWinSize, drawBgFrame } from './cinema-bg.js';
import { startCinemaViz, stopCinemaViz, initCinemaVizModule, drawVizFrame } from './cinema-viz.js';
import { initCinemaLoop, startCinemaLoop, stopCinemaLoop, wakeCinemaLoop } from './cinema-loop.js';
import { renderCinColor, syncCinVolumeUI, syncCinProgress, applyCinText, beginCinSwapIn, renderCinNextPanel,
         getCinemaQueueUpcoming, playCinemaQueueTrack } from './cinema-render.js';
import { initCinemaSeek, isSeekDragging, resetCinemaSeek } from './cinema-seek.js';
import { initCinemaQueue, refreshCinemaQueuePanel, closeCinemaQueuePanel } from './cinema-queue.js';
import { initCinemaInput, attachCinemaInput, detachCinemaInput, showCinemaControls } from './cinema-input.js';

export { cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS, applyCinemaBg, setCinemaBg, cycleCinemaBg,
         syncCinemaBgSettings, updateCinemaBgBtn, initCinemaBg, updateCinArtColor,
         startCinemaViz }; // Task 10 : app.js relance le viz spectre au retour 'full' (cinéma ouvert)

// Radio demande le toggle cinéma (cycle d'import) ; play/pause réveille la boucle maître.
on(EVENTS.CINEMA_RADIO_TOGGLE, () => { if (cinemaOpen) toggleCinemaRadio(); });
on(EVENTS.PLAY_STATE,          () => { if (cinemaOpen) wakeCinemaLoop(); });

// ── State ───────────────────────────────────────────────────
export let cinemaOpen     = false;
// cinemaHideTimer → cinema-input.js (Task 6 — timer d'auto-masquage des contrôles)

// ── A11Y: focus management (A.8) ────────────────────────────
// Stores the element that had focus before cinema opened so it
// can be restored when the overlay closes.
let _cinemaLastFocus = null;

// DOM cache (peuplé dans openCinema, vidé dans closeCinema)
// Utilisé par updateCinemaProgress() pour les mises à jour timeupdate à 60 fps.
let _cinFill    = null;
let _cinThumb   = null; // Task 5 — thumb de scrub (sibling de _cinFill, position en %)
let _cinTc      = null;
let _cinTd      = null;
let _cinPbar    = null;
let _lastCinArt  = null; // dernière URL d'art — évite le bug de normalisation url("…")
// _cinBgCtx → cinema-bg.js ; _beatTimer → cinema-viz.js (renderer passif, boucle dans cinema-loop.js)
// Couleur dominante : état privé dans cinema-bg.js — muté via snapArtColor()/stepArtColorLerp().
let _kbVariant  = 0;                  // variante Ken Burns courante (0-3)
let _lastCinIdx = -1;                 // dernier curIdx vu dans updateCinema — détecte le changement de piste

// Horloge
let _clockInterval = null;

// Timers pour l'animation de swap pochette — stockés pour annulation dans closeCinema()
let _cinSwapOutTimer = null;
let _cinSwapInTimer  = null;
// _heartTimer (particule cœur, dbl-clic like) → cinema-input.js (Task 6)

// GSAP timeline pour la chorégraphie d'ouverture — kill au close + au re-open
// (évite que deux séquences se superposent si l'utilisateur toggle vite).
let _openTl = null;

// ── Suspension du viz player-bar pendant le mode cinéma (P1 fix) ────────────
// Callbacks injectés depuis app.js (pattern initRadioPlCallbacks) — évite un
// import direct cinema.js → viz.js pour rester découplé (CLAUDE.md §6).
let _suspendViz = () => {};
let _resumeViz  = () => {};

/** À appeler une seule fois depuis app.js après l'import de viz.js. */
export function initCinemaVizSuspend({ suspendViz, resumeViz }) {
  _suspendViz = suspendViz || (() => {});
  _resumeViz  = resumeViz  || (() => {});
}

// ── Constantes ──────────────────────────────────────────────
// Modes, labels, AMBIENT_CROSSFADE_MS → cinema-bg.js
// CINEMA_CONTROLS_HIDE_MS, HEART_BURST_MS → cinema-input.js (Task 6)
const CIN_SWAP_OUT_MS          =  120;  // durée animation pochette sortante
const CIN_SWAP_IN_MS           =  440;  // durée animation pochette entrante
const CLOCK_TICK_MS            = 1000;  // intervalle de mise à jour de l'horloge

// ── Init modules ─────────────────────────────────────────────
// Doit être posé après la déclaration de cinemaOpen et updateCinema.
// Ces deux appels sont effectués après le bloc de déclarations.
// (voir plus bas, juste après la déclaration de updateCinema)

// ── Resize handler — redessine blur/ambient si dimensions changent ──
let _resizeTimer = null;
window.addEventListener('resize', () => {
  updateCachedWinSize(); // P3 fix — tient le cache innerWidth/innerHeight à jour pour la boucle RAF ambient
  if (!cinemaOpen) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (cinemaBg === 'ambient' || cinemaBg === 'amoled' || cinemaBg === 'waves' || cinemaBg === 'starfield') applyCinemaBg();
  }, 200);
});

// ── Ouverture / fermeture ────────────────────────────────────

export function toggleCinema() {
  if (cinemaOpen) closeCinema(); else openCinema();
}


// ── Volume : lecture DOM + sync (exposés à cinema-input.js via deps — Task 6) ──
/** Lit le volume depuis le slider DOM #vol (source de vérité — §2). Fallbacks : master gain puis 1. */
function _readVol() {
  const dom = parseFloat(document.getElementById('vol')?.value);
  if (Number.isFinite(dom)) return dom;
  return masterGainNode?.gain.value ?? 1;
}

function _syncCinVol(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'cinema-vol' }); }
  const vel = document.getElementById('vol');
  if (vel) { vel.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'vol' }); }
  saveCfg();
}

export function openCinema() {
  if (cinemaOpen) return;
  cinemaOpen = true;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  // A11Y A.8 — capture previous focus; move focus into overlay on next paint
  // (overlay has tabindex="-1" from A.7, so it is programmatically focusable)
  _cinemaLastFocus = document.activeElement;
  // FIX (Task 6) : garde `if (!cinemaOpen) return` -- un toggle rapide (ouvrir puis fermer
  // avant la prochaine frame) ne doit pas focaliser un overlay déjà refermé.
  requestAnimationFrame(() => { if (!cinemaOpen) return; overlay.focus(); });
  overlay.classList.add('active');
  // Marquer le bouton toolbar comme actif (état toggle visible)
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.add('on'); tbtCinema.setAttribute('aria-pressed', 'true'); }
  // Mettre en cache les refs cinéma pour updateCinemaProgress (timeupdate à 60 fps)
  _cinFill  = document.getElementById('cinema-fill');
  _cinThumb = document.getElementById('cinema-pbar-thumb');
  _cinTc    = document.getElementById('cinema-tc');
  _cinTd    = document.getElementById('cinema-td');
  _cinPbar  = document.getElementById('cinema-pbar');
  // Synchroniser le slider volume avec l'état courant de l'audio
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider) volSlider.value = _readVol();
  applyCinemaBg();
  updateCinema();
  _startClock();
  startCinemaViz();
  startCinemaLoop();
  _suspendViz(); // P1 fix — le viz player-bar est masqué sous l'overlay, rendu inutile
  // Animation d'entrée : scale 0.88 → 1 + fade-in
  const artWrap = document.querySelector('.cinema-art-wrap');
  if (artWrap) {
    artWrap.classList.remove('cin-enter');
    // FIX (Task 6) : même garde `if (!cinemaOpen) return` sur le double-rAF -- un
    // close() survenu entre les deux frames ne doit pas relancer Ken Burns ni
    // ré-ajouter .cin-enter sur un overlay déjà fermé.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cinemaOpen) return;
      artWrap.classList.add('cin-enter');
      _startKenBurns(); // démarrer Ken Burns à l'ouverture du mode cinéma
    }));
  }
  attachCinemaInput(overlay);
  showCinemaControls();
  _runOpenChoreography();
}

// Chorégraphie d'ouverture GSAP — complémente la CSS .cin-enter sur .cinema-art-wrap
// (qui gère le scale + fade de la pochette). Cette timeline anime title / artist /
// progress / contrôles / horloge avec un séquencement type Apple Music.
// L'animation collapse en gsap.set instantané si prefers-reduced-motion = reduce.
function _runOpenChoreography() {
  // Killer d'éventuelle timeline en vol (re-open rapide) + reset des inline styles
  // qu'elle aurait laissés pour éviter le drift visuel à la prochaine séquence.
  if (_openTl) { _openTl.kill(); _openTl = null; }
  const targets = [
    '#cinema-info', '#cinema-title', '#cinema-artist',
    '#cinema-pbar', '#cinema-tc', '#cinema-td',
    '#cinema-controls',
    '#cinema-clock',
  ];
  for (const sel of targets) motionKill(sel);

  // État initial : utiliser gsap.set (pas inline CSS) — évite tout flash visible
  // avant la première frame de la timeline (les éléments seraient sinon rendus
  // dans leur état CSS naturel pendant 1 frame).
  // Parent #cinema-info visible immédiatement — on anime chaque enfant texte séparément.
  motionSet('#cinema-info',     { y: 0, autoAlpha: 1 });
  motionSet('#cinema-title',    { y: 22, autoAlpha: 0 });
  motionSet('#cinema-artist',   { y: 16, autoAlpha: 0 });
  motionSet('#cinema-pbar',     { scaleX: 0.7, transformOrigin: 'left center', autoAlpha: 0 });
  motionSet('#cinema-tc',       { autoAlpha: 0 });
  motionSet('#cinema-td',       { autoAlpha: 0 });
  motionSet('#cinema-controls > *', { y: 14, autoAlpha: 0 });
  motionSet('#cinema-clock',    { autoAlpha: 0 });

  _openTl = timeline({
    defaults: { ease: eases.PREMIUM },
    onComplete() {
      // Supprime TOUS les styles GSAP inline posés pendant l'animation (opacity, visibility, transform)
      // pour que les règles CSS (.ctrl-on) reprennent le contrôle — sans ça, les éléments restent
      // visibles en permanence même quand ctrl-on est retiré (inline style > CSS specificity).
      motionSet(
        '#cinema-info, #cinema-title, #cinema-artist, #cinema-pbar, #cinema-tc, #cinema-td, #cinema-controls > *, #cinema-clock',
        { clearProps: 'transform,opacity,visibility' }
      );
      _openTl = null;
    },
  });

  _openTl
    .to('#cinema-title',  { y: 0, autoAlpha: 1, duration: 0.48 }, 0.06)
    .to('#cinema-artist', { y: 0, autoAlpha: 1, duration: 0.42 }, 0.14)
    .to('#cinema-pbar',   { scaleX: 1, autoAlpha: 1, duration: 0.50 }, '-=0.28')
    .to('#cinema-tc',     { autoAlpha: 1, duration: 0.35 }, '<')
    .to('#cinema-td',     { autoAlpha: 1, duration: 0.35 }, '<')
    .to('#cinema-controls > *', {
      y: 0, autoAlpha: 1, duration: 0.42, stagger: 0.035,
    }, '-=0.32')
    .to('#cinema-clock', { autoAlpha: 1, duration: 0.55, ease: eases.SNAP }, '-=0.40');
}

export function closeCinema() {
  cinemaOpen = false;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.remove('active', 'ctrl-on');
  // Retirer l'état actif du bouton toolbar
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.remove('on'); tbtCinema.setAttribute('aria-pressed', 'false'); }
  // Cache unique — évite 2 querySelector distincts sur la même requête
  const _aw = document.querySelector('.cinema-art-wrap');
  _aw?.classList.remove('cin-enter', 'cin-swap-out', 'cin-swap');
  // Task 6 : purger les classes de swap texte — sinon une fermeture mid-animation (Escape
  // pendant un changement de piste) laisse le titre/artiste à opacity:0 (cin-txt-swap-out
  // est `forwards`) à la prochaine ouverture, avant le premier changement de piste.
  _cinTxtEls().forEach(el => el.classList.remove('cin-txt-swap-out', 'cin-txt-swap-in'));
  detachCinemaInput(overlay); // Task 6 — retire listeners + cinemaHideTimer/_heartTimer + hearts résiduels
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  clearTimeout(_resizeTimer);     _resizeTimer     = null; // évite applyCinemaBg() orphelin après fermeture
  // Killer la timeline d'ouverture si elle est encore en vol + reset des inline
  // styles laissés par gsap (autoAlpha posé display:none / opacity:0 sur l'élément).
  if (_openTl) { _openTl.kill(); _openTl = null; }
  motionSet('#cinema-info, #cinema-title, #cinema-artist, #cinema-pbar, #cinema-tc, #cinema-td, #cinema-controls > *, #cinema-clock',
    { clearProps: 'transform,opacity,visibility,display' });
  // Libérer les refs cachées
  _cinFill = _cinThumb = _cinTc = _cinTd = _cinPbar = null;
  resetCinemaSeek(); // Task 5 — coupe un drag en cours + masque la tooltip (fermeture mid-scrub)
  closeCinemaQueuePanel(); // Task 9 — pas d'état orphelin (aria-expanded/listener) si le cinéma se ferme panneau ouvert
  _lastCinArt = null; // reset pour forcer le swap à la prochaine ouverture
  _lastCinIdx = -1;   // reset pour détecter le changement de piste à la prochaine ouverture
  // A11Y A.8 — restore focus to the element that was focused before cinema opened
  if (_cinemaLastFocus && document.contains(_cinemaLastFocus) && typeof _cinemaLastFocus.focus === 'function') {
    _cinemaLastFocus.focus();
  }
  _cinemaLastFocus = null;
  _stopKenBurns();
  stopCinemaLoop();
  stopAmbientAnim();
  resetAmbientColors();
  _stopClock();
  stopCinemaViz();
  _resumeViz(); // reprendre le viz player-bar maintenant que l'overlay cinéma est fermé
  // Quitter le plein écran si actif
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ── Contrôles auto-masquables (_showControls/_hideControls/_onCinema*) → cinema-input.js (Task 6) ──

// ── Rendu cinéma ─────────────────────────────────────────────

// updateCinArtColor, _parseColorToRGB, updateCinArtRGBFromTrack → cinema-bg.js

// ── Ken Burns — zoom+pan lent sur la pochette (direction aléatoire) ────────

/** Démarre une variante Ken Burns aléatoire sur #cinema-art-img. */
function _startKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img || img.style.display === 'none') return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
  _kbVariant = Math.floor(Math.random() * 4);
  void img.offsetWidth; // force reflow pour redémarrer l'animation
  img.classList.add('cin-kb-' + _kbVariant);
}

/** Stoppe le Ken Burns et remet l'image à son état neutre. */
function _stopKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img) return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
}

// updateCinema est un orchestrateur court (Task 3) : il détecte le changement de piste
// puis délègue à des helpers <50 lignes. L'ORDRE des appels est un invariant du chemin de
// rendu (couleur/fond avant meta avant pochette avant boutons) — ne pas réordonner.
export function updateCinema() {
  if (!cinemaOpen) return;
  wakeCinemaLoop(); // réveil si la boucle est endormie (ex. changement de piste en pause)
  const curIdx = get('curIdx');
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  // audio imported from player.js
  if (!audio) return; // Bug 4 fix : audio peut être null avant l'init du player
  const t = curIdx >= 0 ? tracks[curIdx] : null;
  const title  = t ? t.name : '–';
  const artist = t ? (t.artistFull || t.artist || '–') : '–';
  const art    = t ? (t.art || null) : null;
  // ARCH-5 : détecter le changement de piste avant tout rendu qui en dépend.
  const _trackChanged = curIdx !== _lastCinIdx;
  _lastCinIdx = curIdx;

  renderCinColor(t, _trackChanged);                    // canvas clear + couleur + snap + reduced-motion + --cin-rgb
  _renderCinMeta(title, artist, _trackChanged);         // annonce a11y (immédiate, découplée du swap visuel)
  _renderCinArt(art, _trackChanged, t, title, artist);  // pochette + texte : swap synchronisé, Ken Burns
  _syncCinButtons(curIdx);                        // play/pause + shuffle/repeat/like/radio (aria-pressed)
  _updateNextTrack();                             // panneau piste suivante / hint shuffle
  refreshCinemaQueuePanel();                      // Task 9 — re-rend le panneau file d'attente s'il est ouvert
  syncCinVolumeUI(_readVol());                    // slider volume + icônes
  syncCinProgress();                              // barre de progression + temps
}

// ── Métadonnées : annonce a11y (immédiate, indépendante du swap visuel du texte) ──
function _renderCinMeta(title, artist, _trackChanged) {
  // A11Y A7 : annoncer le changement de piste (poli) — jamais à chaque tick de progression,
  // updateCinemaProgress() (60fps) est un chemin séparé qui ne touche pas cinema-announce.
  // Ne doit pas attendre l'animation de swap texte (Task 6) : un lecteur d'écran est informé
  // sans délai même si le rendu visuel du titre/artiste est différé de CIN_SWAP_OUT_MS.
  if (_trackChanged) {
    const announceEl = document.getElementById('cinema-announce');
    if (announceEl) announceEl.textContent = `${title} — ${artist}`;
  }
}

/** Éléments texte cinéma (titre/artiste/album) — requêtés à chaque appel (DOM stable, coût négligeable). */
function _cinTxtEls() {
  return ['cinema-title', 'cinema-artist', 'cinema-album'].map(id => document.getElementById(id)).filter(Boolean);
}

// ── Pochette + texte : fond flou, swap synchronisé bi-directionnel, Ken Burns, skeleton ──
// Texte et pochette partagent les MÊMES timers (_cinSwapOutTimer/_cinSwapInTimer) — zéro
// horloge séparée (Task 6). L'écriture DOM (texte/décodage image) est déléguée à
// cinema-render.js (stateless) ; seule l'orchestration des timers reste ici.
function _renderCinArt(art, trackChanged, t, title, artist) {
  const img = document.getElementById('cinema-art-img');
  const em  = document.getElementById('cinema-art-em');
  if (!art) {
    if (img) { img.style.display = 'none'; img.style.opacity = ''; }
    if (em)  { em.style.display = 'flex'; em.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'; }
    document.querySelector('.cinema-art-wrap')?.style.removeProperty('--cin-bg-url');
    _lastCinArt = null;
    if (trackChanged) applyCinText(t, title, artist);
    return;
  }
  if (em) em.style.display = 'none';
  const artWrap = document.querySelector('.cinema-art-wrap');
  // Fond flou pour pochettes non carrées — custom property lue par ::before
  // (plus fiable que style.backgroundImage + background-image:inherit dans WebView2)
  if (artWrap) artWrap.style.setProperty('--cin-bg-url', `url("${art}")`);

  if (art === _lastCinArt) {
    // Même pochette (play/pause, volume…) — texte à jour si la piste a changé sans que
    // l'art ne diffère (cas rare : pochette identique entre deux pistes, pas d'animation)
    if (trackChanged) applyCinText(t, title, artist);
    if (img) { img.src = art; img.style.display = 'block'; }
    return;
  }

  // Rapid skip (next/next/next) : annuler tout swap en vol — évite texte/pochette périmés.
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  const hadArt = _lastCinArt !== null;
  _lastCinArt = art; // préempter : évite le re-déclenchement si updateCinema rappelé pendant la transition

  if (hadArt && artWrap) {
    // Animation sortante (120ms) puis entrante — transition bi-directionnelle, texte inclus.
    // Retirer une cin-txt-swap-in en vol AVANT de poser l'out : déclarée après l'out dans
    // style.css (spécificité égale), elle gagnerait la cascade et annulerait l'animation.
    artWrap.classList.add('cin-swap-out');
    _cinTxtEls().forEach(el => { el.classList.remove('cin-txt-swap-in'); el.classList.add('cin-txt-swap-out'); });
    _cinSwapOutTimer = setTimeout(() => _cinSwapIn(art, t, title, artist, artWrap, img, em), CIN_SWAP_OUT_MS);
  } else {
    // Premier chargement : pas d'animation sortante, swap immédiat
    _cinSwapIn(art, t, title, artist, artWrap, img, em);
  }
}

// ── Swap-in partagé : premier chargement (pas d'out) et changement de piste (après l'out) ──
// Contenu + classes d'entrée posés par cinema-render.js (beginCinSwapIn, stateless) ; seul
// le nettoyage CIN_SWAP_IN_MS reste ici, sur le timer existant _cinSwapInTimer.
function _cinSwapIn(art, t, title, artist, artWrap, img, em) {
  if (!cinemaOpen) return;
  const txtEls = beginCinSwapIn(artWrap, img, em, t, title, artist, art);
  if (artWrap) {
    _cinSwapInTimer = setTimeout(() => {
      artWrap.classList.remove('cin-swap');
      txtEls.forEach(el => el.classList.remove('cin-txt-swap-in'));
    }, CIN_SWAP_IN_MS);
  }
  _startKenBurns(); // nouvelle piste → nouvelle direction Ken Burns
  if (cinemaBg === 'ambient' || cinemaBg === 'amoled') updateAmbientGradient();
}

// ── Synchro boutons/états : play/pause + shuffle/repeat/like/radio (aria-pressed A1/A2) ──
function _syncCinButtons(curIdx) {
  const playing = !audio.paused;
  const iplay  = document.getElementById('cinema-ico-play');
  const ipause = document.getElementById('cinema-ico-pause');
  if (iplay)  iplay.style.display  = playing ? 'none'  : 'block';
  if (ipause) ipause.style.display = playing ? 'block' : 'none';
  // Task 6 : geler les animations idle (Ken Burns/float/glow/breathe/ambient) en pause —
  // basculée ici, là où l'état play/pause est déjà lu depuis audio.paused.
  document.getElementById('cinema-overlay')?.classList.toggle('is-paused', !playing);

  // A11Y A1/A2 : aria-pressed reflète .on partout, pas seulement la classe visuelle
  // (imite le pattern déjà correct de #cinema-radio ci-dessous).
  const _cinShuf = document.getElementById('cinema-shuf');
  const _shufOn  = get('shuffle');
  _cinShuf?.classList.toggle('on', _shufOn);
  _cinShuf?.setAttribute('aria-pressed', _shufOn ? 'true' : 'false');

  const _cinRep = document.getElementById('cinema-rep');
  const _repOn  = get('repeat') !== 'none';
  _cinRep?.classList.toggle('on',      _repOn);
  _cinRep?.classList.toggle('rep-one', get('repeat') === 'one');
  _cinRep?.setAttribute('aria-pressed', _repOn ? 'true' : 'false');

  const isLiked = curIdx >= 0 && get('liked').has(get('tracks')?.[curIdx]?.id); // Phase 4
  const _cinLk = document.getElementById('cinema-lk');
  _cinLk?.classList.toggle('on', isLiked);
  _cinLk?.setAttribute('aria-pressed', isLiked ? 'true' : 'false');

  document.getElementById('cinema-radio')?.classList.toggle('on', !!radioActive);
  document.getElementById('cinema-radio')?.setAttribute('aria-pressed', radioActive ? 'true' : 'false');
}

// ── Init sub-modules (posé ici : cinemaOpen et updateCinema sont désormais déclarés) ──
initCinemaBgModule({ getCinemaOpen: () => cinemaOpen, onUpdateCinema: () => updateCinema(), getIsPlaying: () => !audio.paused });
initCinemaVizModule({ getCinemaOpen: () => cinemaOpen });
initCinemaLoop({ getCinemaOpen: () => cinemaOpen, getIsPlaying: () => !audio.paused, getBgMode: () => cinemaBg, getAnalyser: () => eqAnalyser, drawBg: drawBgFrame, drawViz: drawVizFrame });
// Task 6 — cinema-input.js : clavier/molette/dblclick/contrôles auto-masquables.
initCinemaInput({
  getCinemaOpen: () => cinemaOpen,
  closeCinema, updateCinema,
  toggleCinemaFullscreen, cycleCinemaBg, toggleCinemaRadio,
  toggleLike, next, prev,
  audio,
  setMasterGain,
  readVol: _readVol,
  syncVol: _syncCinVol,
});

/**
 * Mise à jour légère de la progression — appelée depuis le handler timeupdate
 * de app.js à ~60 fps (evite getElementById par cycle grâce au cache _cinFill/Tc/Td).
 */
export function updateCinemaProgress(p, cur, dur) {
  if (!cinemaOpen) return;
  if (isSeekDragging()) return; // Task 5 — drag en cours : cinema-seek.js pilote déjà fill/thumb/temps/aria
  if (_cinFill)  _cinFill.style.transform = 'scaleX(' + p + ')';
  if (_cinThumb) _cinThumb.style.left = (p * 100) + '%';
  if (_cinTc)   _cinTc.textContent = cur;
  if (_cinTd)   _cinTd.textContent = dur;
  if (_cinPbar) {
    _cinPbar.setAttribute('aria-valuenow', Math.round(p * 100));
    _cinPbar.setAttribute('aria-valuetext', cur + ' / ' + dur);
  }
}

// ═══════════════════════════════════════════════════════════
// ── Plein écran ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

export function toggleCinemaFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ── Radio depuis le cinéma ───────────────────────────────────
export async function toggleCinemaRadio() {
  if (radioActive) {
    await stopRadio();
  } else {
    const t = get('tracks')?.[get('curIdx')]; // Phase 4
    if (!t) { toast?.(i18n('radio_no_seed'), 'warning'); return; }
    await startRadio(t.id);
  }
  updateCinema();
}

// Icônes expand / compress pour le bouton
const _FS_ICON_EXPAND  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const _FS_ICON_COMPRESS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;

const _onFullscreenChange = () => {
  if (!cinemaOpen) return;
  const full = !!document.fullscreenElement;
  const btn  = document.getElementById('cinema-fs-btn');
  if (!btn) return;
  btn.classList.toggle('on', full);
  btn.innerHTML = full ? _FS_ICON_COMPRESS : _FS_ICON_EXPAND;
  btn.title = full ? i18n('t_cin_fs_exit') : i18n('t_cin_fs_enter');
};
document.addEventListener('fullscreenchange', _onFullscreenChange);

// ═══════════════════════════════════════════════════════════
// ── Horloge idle ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function _updateClock() {
  const timeEl = document.getElementById('cinema-clock-time');
  const dateEl = document.getElementById('cinema-clock-date');
  if (!timeEl) return;
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

function _startClock() {
  _stopClock();   // Bug 2 fix : éviter un double intervalle si appelé plusieurs fois
  _updateClock(); // affichage immédiat sans attendre le premier tick
  _clockInterval = setInterval(_updateClock, CLOCK_TICK_MS);
}

function _stopClock() {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
}

// ═══════════════════════════════════════════════════════════
// ── Piste suivante ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

// Priorité identique à player.js/getNextIdx() (explicite > radio > shuffle > séquentiel) —
// le panneau affiche la piste RÉELLEMENT prévue par next(), sauf en shuffle pur (aucune file
// explicite) où deviner gâcherait la surprise : un hint discret la remplace (Task 6, Step 5).
function _updateNextTrack() {
  const panel = document.getElementById('cinema-next');
  const hint  = document.getElementById('cinema-shuffle-hint');
  if (!panel) return;
  const tracks  = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  const curIdx  = get('curIdx');
  const shuffle = get('shuffle');

  if (!tracks || curIdx < 0) {
    renderCinNextPanel(panel, hint, null, shuffle);
    return;
  }

  // File explicite : priorité 1 — même ordre que player.js/next(), avant radio ET shuffle
  // (un "lire ensuite" manuel doit gagner même quand la radio est aussi active).
  if (hasExplicitQueueNext()) {
    const ni = getNextIdx(); // vérifie l'explicite en premier — renvoie forcément cet item ici
    renderCinNextPanel(panel, hint, ni >= 0 ? tracks[ni] : null, shuffle);
    return;
  }

  // Radio : la tête de la file radio est la piste réelle suivante — prioritaire sur le shuffle
  if (radioActive && getRadioQueue) {
    const rq = getRadioQueue();
    renderCinNextPanel(panel, hint, rq && rq.length ? rq[0] : null, false);
    return;
  }

  // Shuffle actif (sans file explicite ni radio) : aucune piste prévisible → hint discret
  if (shuffle) {
    renderCinNextPanel(panel, hint, null, shuffle);
    return;
  }

  // Lecture séquentielle / repeat-all : piste réelle via getNextIdx()
  const ni = getNextIdx();
  renderCinNextPanel(panel, hint, ni >= 0 ? tracks[ni] : null, shuffle);
}

// ── Visibilité onglet — relancer la boucle maître (no-op interne si cinéma fermé) ──
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cinemaOpen) wakeCinemaLoop();
});

// ── Barre de progression cinéma — scrubbing complet (Task 5) ─
// Toute la logique de drag/hover/clavier vit dans cinema-seek.js ; câblage unique ici.
document.addEventListener('DOMContentLoaded', function() {
  initCinemaSeek({
    audio,
    pbar:    document.getElementById('cinema-pbar'),
    fill:    document.getElementById('cinema-fill'),
    thumb:   document.getElementById('cinema-pbar-thumb'),
    timeEl:  document.getElementById('cinema-tc'),
    tooltip: document.getElementById('cinema-seek-tip'),
  });
  // Task 9 — panneau file d'attente : getUpcoming/onPlayTrack fournis par cinema-render.js
  // (déjà câblé sur search.js/queue.js/radio.js — cinema-queue.js reste zéro-import, §6).
  initCinemaQueue({
    getUpcoming: getCinemaQueueUpcoming,
    onPlayTrack: playCinemaQueueTrack,
    panel:       document.getElementById('cinema-queue-panel'),
    trigger:     document.getElementById('cinema-next'),
  });
});
