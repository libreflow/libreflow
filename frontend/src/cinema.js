// LibreFlow — cinema.js
// Mode Cinéma : overlay plein-écran, fond flou, contrôles masquables.
// Extrait de app.js.
//
// Dépendances :
//   import  : fmt  (utils.js)
//   import  : saveCfg (cfgsave.js), updateVolSlider (playerbar.js)
//   window  : audio, curIdx, tracks, liked, shuffle, repeat, getFiltered (getters), toast
//
// Exports publics (utilisés par app.js) :
//   cinemaOpen, cinemaBg
//   toggleCinema, openCinema, closeCinema, updateCinema, updateCinemaProgress
//   setCinemaBg, cycleCinemaBg, applyCinemaBg, syncCinemaBgSettings, updateCinemaBgBtn
//   toggleCinemaFullscreen, toggleCinemaRadio
//   CINEMA_BG_MODES, CINEMA_BG_LABELS

import { fmt }                               from './utils.js';
import { eqCtx, eqAnalyser, masterGainNode, setMasterGain } from './eq.js'; // réutiliser le graphe EQ existant
import { i18n }                               from './i18n.js';
import { get, set }                           from './store.js';
import { getFiltered, filteredIdx }            from './search.js';
import { audio, toggleLike, next, prev }      from './player.js';
import { radioActive, stopRadio, startRadio, getRadioQueue } from './radio.js';
import { toast }                                        from './ui.js';
import { saveCfg }                   from './cfgsave.js';
import { rgbToHsl, hslToRgb, boostSat, regionAvg, sampleArtColors } from './artcolor.js';
import { emit, on, EVENTS }          from './bus.js';
import { timeline, tween, set as motionSet, kill as motionKill, eases } from './motion.js';
import { cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS, applyCinemaBg, setCinemaBg, cycleCinemaBg,
         syncCinemaBgSettings, updateCinemaBgBtn, initCinemaBg, initCinemaBgModule,
         updateCinArtColor, updateCinArtRGBFromTrack, getArtColorStr,
         _cinArtRGBCur, _cinArtRGBTarget, _LERP_K,
         startAmbientAnim, stopAmbientAnim, resetAmbientColors, updateAmbientGradient } from './cinema-bg.js';
import { startCinemaViz, stopCinemaViz, initCinemaVizModule } from './cinema-viz.js';

export { cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS, applyCinemaBg, setCinemaBg, cycleCinemaBg,
         syncCinemaBgSettings, updateCinemaBgBtn, initCinemaBg, updateCinArtColor };

// Radio demande le toggle cinéma — évite le cycle d'import cinema.js ↔ radio.js.
on(EVENTS.CINEMA_RADIO_TOGGLE, () => { if (cinemaOpen) toggleCinemaRadio(); });

// ── State ───────────────────────────────────────────────────
export let cinemaOpen     = false;
let cinemaHideTimer       = null;

// ── A11Y: focus management (A.8) ────────────────────────────
// Stores the element that had focus before cinema opened so it
// can be restored when the overlay closes.
let _cinemaLastFocus = null;

// DOM cache (peuplé dans openCinema, vidé dans closeCinema)
// Utilisé par updateCinemaProgress() pour les mises à jour timeupdate à 60 fps.
let _cinFill    = null;
let _cinTc      = null;
let _cinTd      = null;
let _cinPbar    = null;
let _lastCinArt  = null; // dernière URL d'art — évite le bug de normalisation url("…")
// _cinBgCtx → cinema-bg.js

// Visualiseur : _cinVizRaf et _beatTimer vivent dans cinema-viz.js
// Couleur dominante : _cinArtRGB*, _cinArtRGBTarget, _cinArtRGBCur, _LERP_K vivent dans cinema-bg.js
let _kbVariant  = 0;                  // variante Ken Burns courante (0-3)
let _lastCinIdx = -1;                 // dernier curIdx vu dans updateCinema — détecte le changement de piste

// Horloge
let _clockInterval = null;

// Timers pour l'animation de swap pochette — stockés pour annulation dans closeCinema()
let _cinSwapOutTimer = null;
let _cinSwapInTimer  = null;

// GSAP timeline pour la chorégraphie d'ouverture — kill au close + au re-open
// (évite que deux séquences se superposent si l'utilisateur toggle vite).
let _openTl = null;

// ── Constantes ──────────────────────────────────────────────
// Modes, labels, AMBIENT_CROSSFADE_MS → cinema-bg.js
const CINEMA_CONTROLS_HIDE_MS  = 3000;  // délai avant masquage des contrôles
const CIN_SWAP_OUT_MS          =  120;  // durée animation pochette sortante
const CIN_SWAP_IN_MS           =  440;  // durée animation pochette entrante
const HEART_BURST_MS           =  750;  // durée de la particule coeur
const CLOCK_TICK_MS            = 1000;  // intervalle de mise à jour de l'horloge

// ── Init modules ─────────────────────────────────────────────
// Doit être posé après la déclaration de cinemaOpen et updateCinema.
// Ces deux appels sont effectués après le bloc de déclarations.
// (voir plus bas, juste après la déclaration de updateCinema)

// ── Resize handler — redessine blur/ambient si dimensions changent ──
let _resizeTimer = null;
window.addEventListener('resize', () => {
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


// ── Raccourcis clavier cinema ────────────────────────────────
function _onArtDblClick(e) {
  e.stopPropagation();
  // Appeler toggleLike du player principal (window scope)
  toggleLike();
  // Feedback visuel : cœur qui pulse sur la pochette
  const wrap = document.querySelector('.cinema-art-wrap');
  const overlay = document.getElementById('cinema-overlay');
  if (!wrap || !overlay) return;
  const r = wrap.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const heart = document.createElement('div');
  heart.className = 'cin-heart-burst';
  heart.textContent = '❤';
  heart.style.left = cx + 'px';
  heart.style.top  = cy + 'px';
  overlay.appendChild(heart);
  setTimeout(() => heart.remove(), HEART_BURST_MS);
}

/** Lit le volume depuis le slider DOM #vol (source de vérité — §2). Fallbacks : master gain puis 1. */
function _readVol() {
  const dom = parseFloat(document.getElementById('vol')?.value);
  if (Number.isFinite(dom)) return dom;
  return masterGainNode?.gain.value ?? 1;
}

function _onCinKey(e) {
  if (!cinemaOpen) return;
  // Ignorer si focus sur un input/slider
  const _ct = e.target.tagName;
  if (_ct === 'INPUT' || _ct === 'TEXTAREA' || _ct === 'SELECT' || e.target.isContentEditable) return;
  _showControls(); // reset idle timer sur toute touche
  // audio imported from player.js
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (audio) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); updateCinema(); } // B33 FIX : .catch — évite un rejet non géré si autoplay refuse
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (audio) { audio.currentTime = Math.max(0, audio.currentTime - 5); }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (audio) { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (audio) { const v = Math.min(1, _readVol() + 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (audio) { const v = Math.max(0, _readVol() - 0.05); setMasterGain(v); _syncCinVol(v); updateCinema(); }
      break;
    case 'KeyN': case 'KeyL':
      e.preventDefault();
      next();
      break;
    case 'KeyP':
      e.preventDefault();
      prev();
      break;
    case 'KeyF':
      e.preventDefault();
      toggleCinemaFullscreen();
      break;
    case 'KeyB':
      e.preventDefault();
      cycleCinemaBg();
      break;
    case 'KeyR':
      e.preventDefault();
      toggleCinemaRadio().catch(err => console.warn('[cinema] radio toggle:', err));
      break;
    case 'Escape':
      // Si plein écran actif → quitter le plein écran uniquement (pas fermer le cinéma)
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        closeCinema();
      }
      break;
  }
}

// ── A11Y A.8 — Tab trap ──────────────────────────────────────
// Separate from _onCinKey so it can be removed cleanly in closeCinema().
// Traps Tab focus within the overlay. ESC and all other keys are handled
// exclusively by _onCinKey (which also manages fullscreen exit).
function _onCinemaTrapKey(e) {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;

  if (e.key === 'Tab') {
    _showControls(); // A11Y : rendre les contrôles visibles lors de la navigation clavier
    const focusables = overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) { e.preventDefault(); return; }
    const first  = focusables[0];
    const last   = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ── Scroll molette → volume ──────────────────────────────────
function _syncCinVol(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'cinema-vol' }); }
  const vel = document.getElementById('vol');
  if (vel) { vel.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'vol' }); }
  saveCfg();
}

function _onCinWheel(e) {
  e.preventDefault();
  e.stopPropagation();
  // audio imported from player.js
  if (!audio) return;
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const v = Math.min(1, Math.max(0, _readVol() + delta));
  setMasterGain(v);
  _syncCinVol(v);
  updateCinema();
}

export function openCinema() {
  if (cinemaOpen) return;
  cinemaOpen = true;
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  // A11Y A.8 — capture previous focus; move focus into overlay on next paint
  // (overlay has tabindex="-1" from A.7, so it is programmatically focusable)
  _cinemaLastFocus = document.activeElement;
  requestAnimationFrame(() => overlay.focus());
  overlay.classList.add('active');
  // Marquer le bouton toolbar comme actif (état toggle visible)
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.add('on'); tbtCinema.setAttribute('aria-pressed', 'true'); }
  // Mettre en cache les refs cinéma pour updateCinemaProgress (timeupdate à 60 fps)
  _cinFill = document.getElementById('cinema-fill');
  _cinTc   = document.getElementById('cinema-tc');
  _cinTd   = document.getElementById('cinema-td');
  _cinPbar = document.getElementById('cinema-pbar');
  // Synchroniser le slider volume avec l'état courant de l'audio
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider) volSlider.value = _readVol();
  applyCinemaBg();
  updateCinema();
  _startClock();
  startCinemaViz();
  // Animation d'entrée : scale 0.88 → 1 + fade-in
  const artWrap = document.querySelector('.cinema-art-wrap');
  if (artWrap) {
    artWrap.classList.remove('cin-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      artWrap.classList.add('cin-enter');
      _startKenBurns(); // démarrer Ken Burns à l'ouverture du mode cinéma
    }));
  }
  overlay.removeEventListener('mousemove', _onCinemaMouseMove);
  overlay.addEventListener('mousemove', _onCinemaMouseMove);
  overlay.removeEventListener('click',     _onCinemaMouseMove);
  overlay.addEventListener('click',     _onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  overlay.addEventListener('wheel',     _onCinWheel, { passive: false });
  document.removeEventListener('keydown',  _onCinKey);
  document.addEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown', _onCinemaTrapKey);
  document.addEventListener('keydown', _onCinemaTrapKey);
  // Double-clic pochette → like/unlike (removeEventListener d'abord : évite les listeners zombies)
  const _artWrapDb = document.querySelector('.cinema-art-wrap');
  _artWrapDb?.removeEventListener('dblclick', _onArtDblClick);
  _artWrapDb?.addEventListener('dblclick', _onArtDblClick);
  _showControls();
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
  overlay.removeEventListener('mousemove', _onCinemaMouseMove);
  overlay.removeEventListener('click',     _onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  document.removeEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown',  _onCinemaTrapKey);
  _aw?.removeEventListener('dblclick', _onArtDblClick);
  if (cinemaHideTimer) { clearTimeout(cinemaHideTimer); cinemaHideTimer = null; } // Bug 5 fix
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  clearTimeout(_resizeTimer);     _resizeTimer     = null; // évite applyCinemaBg() orphelin après fermeture
  // Killer la timeline d'ouverture si elle est encore en vol + reset des inline
  // styles laissés par gsap (autoAlpha posé display:none / opacity:0 sur l'élément).
  if (_openTl) { _openTl.kill(); _openTl = null; }
  motionSet('#cinema-info, #cinema-title, #cinema-artist, #cinema-pbar, #cinema-tc, #cinema-td, #cinema-controls > *, #cinema-clock',
    { clearProps: 'transform,opacity,visibility,display' });
  // Libérer les refs cachées
  _cinFill = _cinTc = _cinTd = _cinPbar = null;
  _lastCinArt = null; // reset pour forcer le swap à la prochaine ouverture
  _lastCinIdx = -1;   // reset pour détecter le changement de piste à la prochaine ouverture
  // A11Y A.8 — restore focus to the element that was focused before cinema opened
  if (_cinemaLastFocus && document.contains(_cinemaLastFocus) && typeof _cinemaLastFocus.focus === 'function') {
    _cinemaLastFocus.focus();
  }
  _cinemaLastFocus = null;
  _stopKenBurns();
  stopAmbientAnim();
  resetAmbientColors();
  _stopClock();
  stopCinemaViz();
  // Quitter le plein écran si actif
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ── Contrôles — visibilité unifiée via .ctrl-on sur l'overlay ──

function _showControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.add('ctrl-on');
  if (cinemaHideTimer) clearTimeout(cinemaHideTimer);
  cinemaHideTimer = setTimeout(_hideControls, CINEMA_CONTROLS_HIDE_MS);
}

function _hideControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (overlay) overlay.classList.remove('ctrl-on');
}

function _onCinemaMouseMove() {
  _showControls();
}

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

export function updateCinema() {
  if (!cinemaOpen) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  // audio imported from player.js
  if (!audio) return; // Bug 4 fix : audio peut être null avant l'init du player
  const t = curIdx >= 0 ? tracks[curIdx] : null;
  const title  = t ? t.name : '–';
  const artist = t ? (t.artistFull || t.artist || '–') : '–';
  const art    = t ? (t.art || null) : null;

  // ARCH-5 : Réinitialiser l'état interne lors d'un changement de piste.
  // Snap immédiat de la couleur LERP vers la nouvelle cible — évite les artefacts visuels
  // de couleur résiduelle de la piste précédente dans le visualiseur spectrum.
  const _trackChanged = curIdx !== _lastCinIdx;
  _lastCinIdx = curIdx;
  if (_trackChanged) {
    // Effacer le canvas visualiseur pour éviter les artefacts de persistance entre pistes
    const vizCanvas = document.getElementById('cinema-viz');
    if (vizCanvas) {
      const vCtx = vizCanvas.getContext('2d');
      if (vCtx) vCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
    }
  }

  // Mettre à jour la couleur dominante pour le visualiseur (même logique que viz.js/_vizRGB)
  // Fallback : lire la CSS var --art-color posée par applyArtColor() dans app.js
  const _artRgb = updateCinArtRGBFromTrack(t);
  // Snap instantané sur changement de piste — évite le fondu depuis l'ancienne couleur
  if (_trackChanged) {
    const parts = _artRgb.split(',').map(Number);
    _cinArtRGBCur[0] = parts[0]; _cinArtRGBCur[1] = parts[1]; _cinArtRGBCur[2] = parts[2];
  }
  // Propager --cin-rgb → teinte CSS du sous-titre artiste et album
  document.getElementById('cinema-overlay')?.style.setProperty('--cin-rgb', _artRgb);

  const elT = document.getElementById('cinema-title');
  const elA = document.getElementById('cinema-artist');
  const img  = document.getElementById('cinema-art-img');
  const em   = document.getElementById('cinema-art-em');
  const bg   = document.getElementById('cinema-bg');

  if (elT) elT.textContent = title;
  if (elA) elA.textContent = artist;
  // Ligne album + année — absente si données manquantes (masquée via display:none)
  const elAlb = document.getElementById('cinema-album');
  if (elAlb) {
    const parts = [t?.album, t?.year ? `(${t.year})` : null].filter(Boolean);
    elAlb.textContent = parts.join(' ');
    elAlb.style.display = parts.length ? '' : 'none';
  }

  if (art) {
    if (em) em.style.display = 'none';
    const artWrap = document.querySelector('.cinema-art-wrap');
    // Fond flou pour pochettes non carrées — custom property lue par ::before
    // (plus fiable que style.backgroundImage + background-image:inherit dans WebView2)
    if (artWrap) artWrap.style.setProperty('--cin-bg-url', `url("${art}")`);

    if (art !== _lastCinArt) {
      const hadArt = _lastCinArt !== null;
      _lastCinArt = art; // préempter : évite le re-déclenchement si updateCinema rappelé pendant la transition

      // Fonction de swap-in partagée entre premier chargement et changement de piste
      const _doSwapIn = () => {
        if (!cinemaOpen) return;
        if (img) { img.src = art; img.style.display = 'block'; }
        if (artWrap) {
          artWrap.classList.remove('cin-swap-out', 'cin-swap');
          requestAnimationFrame(() => artWrap.classList.add('cin-swap'));
          _cinSwapInTimer = setTimeout(() => artWrap.classList.remove('cin-swap'), CIN_SWAP_IN_MS);
        }
        _startKenBurns(); // nouvelle piste → nouvelle direction Ken Burns
        if (cinemaBg === 'ambient' || cinemaBg === 'amoled') updateAmbientGradient();
      };

      if (hadArt && artWrap) {
        // Animation sortante (120ms) puis entrante — transition bi-directionnelle
        artWrap.classList.add('cin-swap-out');
        _cinSwapOutTimer = setTimeout(_doSwapIn, CIN_SWAP_OUT_MS);
      } else {
        // Premier chargement : pas d'animation sortante, swap immédiat
        _doSwapIn();
      }
    } else {
      // Même pochette (play/pause, volume…) — juste s'assurer que l'image est visible
      if (img) { img.src = art; img.style.display = 'block'; }
    }
  } else {
    if (img) img.style.display = 'none';
    if (em)  { em.style.display = 'flex'; em.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'; }
    document.querySelector('.cinema-art-wrap')?.style.removeProperty('--cin-bg-url');
    _lastCinArt = null;
  }

  const playing = !audio.paused;
  const iplay  = document.getElementById('cinema-ico-play');
  const ipause = document.getElementById('cinema-ico-pause');
  if (iplay)  iplay.style.display  = playing ? 'none'  : 'block';
  if (ipause) ipause.style.display = playing ? 'block' : 'none';

  // Sync états shuffle / repeat / like / radio
  document.getElementById('cinema-shuf')?.classList.toggle('on', get('shuffle'));
  const _cinRep = document.getElementById('cinema-rep');
  _cinRep?.classList.toggle('on',      get('repeat') !== 'none');
  _cinRep?.classList.toggle('rep-one', get('repeat') === 'one');
  const isLiked = curIdx >= 0 && get('liked').has(get('tracks')?.[curIdx]?.id); // Phase 4
  document.getElementById('cinema-lk')?.classList.toggle('on', isLiked);
  document.getElementById('cinema-radio')?.classList.toggle('on', !!radioActive);
  document.getElementById('cinema-radio')?.setAttribute('aria-pressed', radioActive ? 'true' : 'false');

  // Piste suivante
  _updateNextTrack();

  // Sync volume slider + icône (muet / bas / haut)
  const vol = _readVol();
  const muted = audio.muted || vol === 0;
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider && !volSlider.matches(':active')) volSlider.value = vol;
  const w1 = document.getElementById('cinema-vol-wave1');
  const w2 = document.getElementById('cinema-vol-wave2');
  if (w1) w1.style.display = muted ? 'none' : '';
  if (w2) w2.style.display = (muted || vol < 0.5) ? 'none' : '';

  // Sync progress
  const fill = document.getElementById('cinema-fill');
  const tc   = document.getElementById('cinema-tc');
  const td   = document.getElementById('cinema-td');
  if (fill && audio.duration) fill.style.transform = 'scaleX(' + (audio.currentTime / audio.duration) + ')';
  if (tc)  tc.textContent = fmt(audio.currentTime);
  if (td)  td.textContent = audio.duration ? fmt(audio.duration) : '–:––';
}

// ── Init sub-modules (posé ici : cinemaOpen et updateCinema sont désormais déclarés) ──
initCinemaBgModule({ getCinemaOpen: () => cinemaOpen, onUpdateCinema: () => updateCinema(), getIsPlaying: () => !audio.paused });
initCinemaVizModule({ getCinemaOpen: () => cinemaOpen });

/**
 * Mise à jour légère de la progression — appelée depuis le handler timeupdate
 * de app.js à ~60 fps (evite getElementById par cycle grâce au cache _cinFill/Tc/Td).
 */
export function updateCinemaProgress(p, cur, dur) {
  if (!cinemaOpen) return;
  if (_cinFill) _cinFill.style.transform = 'scaleX(' + p + ')';
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

// _startViz / _stopViz → cinema-viz.js (startCinemaViz / stopCinemaViz)

// ═══════════════════════════════════════════════════════════
// ── Piste suivante ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function _updateNextTrack() {
  const panel = document.getElementById('cinema-next');
  if (!panel) return;
  const tracks  = get('tracks'); // Phase 4 — store alimenté depuis Jalon 3
  const curIdx  = get('curIdx');
  const shuffle = get('shuffle');

  // En mode radio : piste suivante = tête de file radio
  if (radioActive && getRadioQueue) {
    const rq = getRadioQueue();
    const nt = rq && rq.length ? rq[0] : null;
    if (!nt) { panel.classList.remove('cin-has-next'); return; }
    panel.classList.add('cin-has-next');
    const titleEl  = document.getElementById('cinema-next-title');
    const artistEl = document.getElementById('cinema-next-artist');
    const imgEl    = document.getElementById('cinema-next-img');
    if (titleEl)  titleEl.textContent  = nt.name || '–';
    if (artistEl) artistEl.textContent = nt.artistFull || nt.artist || '–';
    if (imgEl) { if (nt.art) { imgEl.src = nt.art; imgEl.style.display = 'block'; } else imgEl.style.display = 'none'; }
    return;
  }

  // En mode aléatoire on ne peut pas prédire la piste suivante
  if (shuffle || !tracks || curIdx < 0) {
    panel.classList.remove('cin-has-next'); return;
  }

  // Chercher dans la liste filtrée si disponible, sinon tracks bruts
  let nt = null;
  const filtered = getFiltered();
  if (filtered && filtered.length) {
    const curTrack = tracks[curIdx];
    const posInFiltered = filteredIdx(curTrack); // O(1) via posMap
    nt = posInFiltered >= 0 && posInFiltered + 1 < filtered.length ? filtered[posInFiltered + 1] : null;
  } else {
    nt = curIdx + 1 < tracks.length ? tracks[curIdx + 1] : null;
  }

  if (!nt) { panel.classList.remove('cin-has-next'); return; }
  panel.classList.add('cin-has-next');

  const titleEl  = document.getElementById('cinema-next-title');
  const artistEl = document.getElementById('cinema-next-artist');
  const imgEl    = document.getElementById('cinema-next-img');

  if (titleEl)  titleEl.textContent  = nt.name || '–';
  if (artistEl) artistEl.textContent = nt.artistFull || nt.artist || '–';
  if (imgEl) {
    if (nt.art) { imgEl.src = nt.art; imgEl.style.display = 'block'; }
    else          imgEl.style.display = 'none';
  }
}

// ── Visibilité onglet — relancer le loop ambient si l'onglet redevient visible ──
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cinemaOpen && (cinemaBg === 'ambient' || cinemaBg === 'amoled' || cinemaBg === 'waves' || cinemaBg === 'starfield')) {
    startAmbientAnim();
  }
});

// ── Barre de progression cinéma (click pour seek) ───────────
document.addEventListener('DOMContentLoaded', function() {
  const cpbar = document.getElementById('cinema-pbar');
  if (cpbar) {
    cpbar.addEventListener('click', function(e) {
      // audio imported from player.js
      if (!audio.duration) return;
      const r = cpbar.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });
  }
});
