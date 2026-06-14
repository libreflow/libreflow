// LibreFlow — cinema.js — Mode Cinéma : overlay plein-écran, fond flou, contrôles masquables.
import { fmt, extEmoji }                      from './utils.js';
import { eqCtx, masterGainNode, setMasterGain } from './eq.js';
import { i18n }                                from './i18n.js';
import { get }                                 from './store.js';
import { getFiltered, filteredIdx }            from './search.js';
import { audio, toggleLike, next, prev }       from './player.js';
import { radioActive, stopRadio, startRadio, getRadioQueue } from './radio.js';
import { toast }                               from './ui.js';
import { saveCfg }                             from './cfgsave.js';
import { updateVolSlider }                     from './playerbar.js';
import { timeline, set as motionSet, kill as motionKill, eases } from './motion.js';

import { startCinemaViz, stopCinemaViz, initCinemaVizModule } from './cinema-viz.js';
import {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  stopAmbientAnim, updateAmbientGradient, restartAmbientIfNeeded,
  initCinemaBgModule,
  startWelcomeAmbient, stopWelcomeAmbient,
} from './cinema-bg.js';

// Re-exports pour rétrocompatibilité — tous les consommateurs importent depuis cinema.js
export {
  cinemaBg, CINEMA_BG_MODES, CINEMA_BG_LABELS,
  initCinemaBg, setCinemaBg, cycleCinemaBg, applyCinemaBg,
  syncCinemaBgSettings, updateCinemaBgBtn,
  startWelcomeAmbient, stopWelcomeAmbient,
};

// ── State ───────────────────────────────────────────────────
export let cinemaOpen     = false;
let cinemaHideTimer       = null;
let _heartTimer           = null;

// A11Y A.8 — focus captured before open, restored on close.
let _cinemaLastFocus = null;

// DOM cache peuplé dans openCinema, vidé dans closeCinema.
let _cinFill    = null;
let _cinTc      = null;
let _cinTd      = null;
let _lastCinArt  = null; // évite le bug de normalisation url("…")

let _cinArtRGB       = '255,255,255';
let _cinArtRGBTarget = [255,255,255];
let _cinArtRGBCur    = [255,255,255];
let _kbVariant  = 0;
let _lastCinIdx = -1;

let _clockInterval = null;

// Timers de swap pochette — stockés pour annulation dans closeCinema().
let _cinSwapOutTimer = null;
let _cinSwapInTimer  = null;

// GSAP timeline d'ouverture — kill au close + au re-open (évite les séquences superposées).
let _openTl = null;

// ── Init inter-modules ───────────────────────────────────────
initCinemaBgModule(
  () => ({ cinemaOpen, cinArtRGB: _cinArtRGB }),
  () => updateCinema(),
);
initCinemaVizModule(
  () => ({ cinemaOpen, cinemaBg, cinArtRGBTarget: _cinArtRGBTarget }),
);

// ── Constantes d'animation ──────────────────────────────────
const CINEMA_CONTROLS_HIDE_MS  = 3000;  // délai avant masquage des contrôles

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
  if (_heartTimer) { clearTimeout(_heartTimer); }
  _heartTimer = setTimeout(() => { heart.remove(); _heartTimer = null; }, 750);
}

/** Lit le volume depuis le slider DOM #vol (source de vérité — §2). Fallback : 0.8. */
function _readVol() {
  const dom = parseFloat(document.getElementById('vol')?.value ?? '');
  return Number.isFinite(dom) ? dom : 0.8;
}

function _onCinKey(e) {
  if (!cinemaOpen) return;
  const _ct = e.target.tagName;
  if (_ct === 'INPUT' || _ct === 'TEXTAREA' || _ct === 'SELECT' || e.target.isContentEditable) return;
  _showControls();
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (audio) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); updateCinema(); }
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
      toggleCinemaRadio();
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

// A11Y A.8 — Tab trap; separate from _onCinKey for clean removal in closeCinema().
function _onCinemaTrapKey(e) {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;

  if (e.key === 'Tab') {
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

function _syncCinVol(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; updateVolSlider(cvol, `rgb(${_cinArtRGB})`); }
  const vel = document.getElementById('vol');
  if (vel) { vel.value = v; updateVolSlider(vel); }
  saveCfg();
}

function _onCinWheel(e) {
  e.preventDefault();
  e.stopPropagation();
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
  // A11Y A.8 — capture focus before open; overlay has tabindex="-1" so it is focusable.
  _cinemaLastFocus = document.activeElement;
  requestAnimationFrame(() => overlay.focus());
  overlay.classList.add('active');
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.add('on'); tbtCinema.setAttribute('aria-pressed', 'true'); }
  // Cache pour updateCinemaProgress (timeupdate à 60 fps)
  _cinFill = document.getElementById('cinema-fill');
  _cinTc   = document.getElementById('cinema-tc');
  _cinTd   = document.getElementById('cinema-td');
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider) volSlider.value = _readVol();
  applyCinemaBg();
  updateCinema();
  _startClock();
  startCinemaViz();
  const artWrap = document.querySelector('.cinema-art-wrap');
  if (artWrap) {
    artWrap.classList.remove('cin-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      artWrap.classList.add('cin-enter');
      _startKenBurns();
    }));
  }
  overlay.removeEventListener('mousemove', onCinemaMouseMove);
  overlay.addEventListener('mousemove', onCinemaMouseMove);
  overlay.removeEventListener('click',     onCinemaMouseMove);
  overlay.addEventListener('click',     onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  overlay.addEventListener('wheel',     _onCinWheel, { passive: false });
  document.removeEventListener('keydown',  _onCinKey);
  document.addEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown', _onCinemaTrapKey);
  document.addEventListener('keydown', _onCinemaTrapKey);
  document.removeEventListener('fullscreenchange', _onFullscreenChange);
  document.addEventListener('fullscreenchange', _onFullscreenChange);
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  document.addEventListener('visibilitychange', _onVisibilityChange);
  // Double-clic pochette → like/unlike (removeEventListener d'abord : évite les listeners zombies).
  const _artWrapDb = document.querySelector('.cinema-art-wrap');
  _artWrapDb?.removeEventListener('dblclick', _onArtDblClick);
  _artWrapDb?.addEventListener('dblclick', _onArtDblClick);
  _showControls();
  _runOpenChoreography();
}

// Re-mesure l'overflow du titre après que #cinema-info est pleinement visible
// (appelée depuis onComplete de _openTl — autoAlpha:0 pendant l'animation donne scrollWidth=0).
function _recheckTitleScroll() {
  const elT = document.getElementById('cinema-title');
  if (!elT) return;
  const overflow = elT.scrollWidth - elT.clientWidth;
  if (overflow > 4) {
    // Durée proportionnelle à l'overflow → vitesse constante ~45 px/s (Spotify-like).
    // 17.1 = 45 px/s × 0.38 (fraction de l'animation dédiée au défilement aller).
    const dur = Math.max(8, overflow / 17.1).toFixed(2);
    elT.style.setProperty('--cinema-title-scroll', `-${overflow}px`);
    elT.style.setProperty('--cinema-title-dur', `${dur}s`);
    elT.classList.add('is-scrolling');
  } else {
    elT.style.removeProperty('--cinema-title-scroll');
    elT.style.removeProperty('--cinema-title-dur');
    elT.classList.remove('is-scrolling');
  }
}

function _runOpenChoreography() {
  if (_openTl) { _openTl.kill(); _openTl = null; }
  const targets = [
    '#cinema-info',
    '#cinema-pbar', '#cinema-tc', '#cinema-td',
    '#cinema-controls',
    '#cinema-clock',
  ];
  for (const sel of targets) motionKill(sel);

  motionSet('#cinema-info',     { y: 24, autoAlpha: 0 });
  motionSet('#cinema-pbar',     { scaleX: 0.7, transformOrigin: 'left center', autoAlpha: 0 });
  motionSet('#cinema-tc',       { autoAlpha: 0 });
  motionSet('#cinema-td',       { autoAlpha: 0 });
  motionSet('#cinema-controls > *', { y: 14, autoAlpha: 0 });
  motionSet('#cinema-clock',    { autoAlpha: 0 });

  _openTl = timeline({
    defaults: { ease: eases.PREMIUM },
    onComplete() {
      motionSet('#cinema-info, #cinema-pbar, #cinema-controls > *', { clearProps: 'transform' });
      _openTl = null;
      _recheckTitleScroll();
    },
  });

  _openTl
    .to('#cinema-info', { y: 0, autoAlpha: 1, duration: 0.45 }, 0.08)
    .to('#cinema-pbar', { scaleX: 1, autoAlpha: 1, duration: 0.50 }, '-=0.30')
    .to('#cinema-tc',   { autoAlpha: 1, duration: 0.35 }, '<')
    .to('#cinema-td',   { autoAlpha: 1, duration: 0.35 }, '<')
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
  const tbtCinema = document.getElementById('tbt-cinema');
  if (tbtCinema) { tbtCinema.classList.remove('on'); tbtCinema.setAttribute('aria-pressed', 'false'); }
  const _aw = document.querySelector('.cinema-art-wrap');
  _aw?.classList.remove('cin-enter', 'cin-swap-out', 'cin-swap');
  overlay.removeEventListener('mousemove', onCinemaMouseMove);
  overlay.removeEventListener('click',     onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  document.removeEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown',  _onCinemaTrapKey);
  document.removeEventListener('fullscreenchange', _onFullscreenChange);
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  _aw?.removeEventListener('dblclick', _onArtDblClick);
  if (cinemaHideTimer) { clearTimeout(cinemaHideTimer); cinemaHideTimer = null; }
  clearTimeout(_cinSwapOutTimer); _cinSwapOutTimer = null;
  clearTimeout(_cinSwapInTimer);  _cinSwapInTimer  = null;
  if (_openTl) { _openTl.kill(); _openTl = null; }
  motionSet('#cinema-info, #cinema-pbar, #cinema-tc, #cinema-td, #cinema-controls > *, #cinema-clock',
    { clearProps: 'transform,opacity,visibility,display' });
  _cinFill = _cinTc = _cinTd = null;
  _lastCinArt = null;
  _lastCinIdx = -1;
  // A11Y A.8 — restore focus to the element that was focused before cinema opened.
  if (_cinemaLastFocus && document.contains(_cinemaLastFocus) && typeof _cinemaLastFocus.focus === 'function') {
    _cinemaLastFocus.focus();
  }
  _cinemaLastFocus = null;
  _stopKenBurns();
  stopAmbientAnim();
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

function onCinemaMouseMove() {
  _showControls();
}

// ── Rendu cinéma ─────────────────────────────────────────────

/** Retourne la couleur dominante courante "r,g,b". */
export function getCinArtRGB() { return _cinArtRGB; }

export function updateCinArtColor(hex) {
  const rgb = _parseColorToRGB(hex);
  if (rgb) {
    _cinArtRGBTarget = rgb.split(',').map(Number);
    _cinArtRGB = rgb; // mise à jour immédiate du fallback statique
  } else {
    _cinArtRGBTarget = [255, 255, 255];
    _cinArtRGB = '255,255,255';
  }
}

function _parseColorToRGB(str) {
  if (!str || str === 'transparent') return null;
  if (str.startsWith('rgb')) {
    const m = str.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return `${m[1]},${m[2]},${m[3]}`;
  }
  if (str.startsWith('#') && str.length >= 7) {
    const r = parseInt(str.slice(1, 3), 16);
    const g = parseInt(str.slice(3, 5), 16);
    const b = parseInt(str.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }
  return null;
}

function _updateCinArtRGB(t) {
  const parsed = _parseColorToRGB(t?.artColor);
  if (parsed) { _cinArtRGB = parsed; _cinArtRGBTarget = parsed.split(',').map(Number); return; }
  const css = getComputedStyle(document.documentElement).getPropertyValue('--art-color').trim();
  const parsed2 = _parseColorToRGB(css);
  if (parsed2) { _cinArtRGB = parsed2; _cinArtRGBTarget = parsed2.split(',').map(Number); return; }
  _cinArtRGB = '255,255,255'; _cinArtRGBTarget = [255, 255, 255];
}

// ── Ken Burns ───────────────────────────────────────────────
function _startKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img || img.style.display === 'none') return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
  _kbVariant = Math.floor(Math.random() * 4);
  void img.offsetWidth; // force reflow pour redémarrer l'animation
  img.classList.add('cin-kb-' + _kbVariant);
}

function _stopKenBurns() {
  const img = document.getElementById('cinema-art-img');
  if (!img) return;
  img.classList.remove('cin-kb-0', 'cin-kb-1', 'cin-kb-2', 'cin-kb-3');
}

export function updateCinema() {
  if (!cinemaOpen) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks');
  if (!audio) return;
  const t = curIdx >= 0 ? tracks[curIdx] : null;
  const title  = t ? t.name : '–';
  const artist = t ? (t.artistFull || t.artist || '–') : '–';
  const art    = t ? (t.art || null) : null;

  // ARCH-5 : snap couleur LERP à la cible sur changement de piste (évite les artefacts résiduels).
  const _trackChanged = curIdx !== _lastCinIdx;
  _lastCinIdx = curIdx;
  if (_trackChanged) {
    // Snap couleur LERP → couleur cible immédiatement (pas de fondu depuis l'ancienne piste)
    _cinArtRGBCur[0] = _cinArtRGBTarget[0];
    _cinArtRGBCur[1] = _cinArtRGBTarget[1];
    _cinArtRGBCur[2] = _cinArtRGBTarget[2];
    // Effacer le canvas visualiseur pour éviter les artefacts de persistance entre pistes
    const vizCanvas = document.getElementById('cinema-viz');
    if (vizCanvas) {
      const vCtx = vizCanvas.getContext('2d');
      if (vCtx) vCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
    }
  }

  // Mettre à jour la couleur dominante pour le visualiseur (même logique que viz.js/_vizRGB)
  // Fallback : lire la CSS var --art-color posée par applyArtColor() dans app.js
  _updateCinArtRGB(t);
  // Après _updateCinArtRGB, si la piste a changé, synchroniser aussi _cinArtRGBCur avec la nouvelle valeur
  if (_trackChanged) {
    _cinArtRGBCur[0] = _cinArtRGBTarget[0];
    _cinArtRGBCur[1] = _cinArtRGBTarget[1];
    _cinArtRGBCur[2] = _cinArtRGBTarget[2];
  }
  // Propager --cin-rgb → teinte CSS du sous-titre artiste et album
  document.getElementById('cinema-overlay')?.style.setProperty('--cin-rgb', _cinArtRGB);
  // Mettre à jour le gradient de la barre de volume cinéma avec la couleur de la pochette
  const _cvol = document.getElementById('cinema-vol');
  if (_cvol) updateVolSlider(_cvol, `rgb(${_cinArtRGB})`);

  const elT = document.getElementById('cinema-title');
  const elA = document.getElementById('cinema-artist');
  const img  = document.getElementById('cinema-art-img');
  const em   = document.getElementById('cinema-art-em');
  const bg   = document.getElementById('cinema-bg');

  if (elT) {
    if (_trackChanged) {
      elT.classList.remove('is-scrolling');
      elT.style.removeProperty('--cinema-title-scroll');
      elT.style.removeProperty('--cinema-title-dur');
    }
    // Span interne réutilisé — le parent garde overflow:hidden fixe,
    // c'est le span qui se translate (sinon la zone de clip bouge avec l'élément).
    let inner = elT.querySelector('.cin-title-inner');
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'cin-title-inner';
      elT.replaceChildren(inner);
    }
    inner.textContent = title;
    // Mesure après reflow — _recheckTitleScroll() calcule aussi la durée proportionnelle.
    // Skip rAF check while open-animation is running (_openTl active) — autoAlpha:0 gives scrollWidth=0.
    // onComplete calls _recheckTitleScroll() once #cinema-info is fully visible.
    requestAnimationFrame(() => { if (elT.isConnected && !_openTl) _recheckTitleScroll(); });
  }
  if (elA) elA.textContent = artist;
  // Ligne album + année — absente si données manquantes (masquée via display:none)
  const elAlb = document.getElementById('cinema-album');
  if (elAlb) {
    const parts = [t?.album, (t?.year && t.year !== 1970) ? `(${t.year})` : null].filter(Boolean);
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
          _cinSwapInTimer = setTimeout(() => artWrap.classList.remove('cin-swap'), 440);
        }
        _startKenBurns(); // nouvelle piste → nouvelle direction Ken Burns
        if (cinemaBg === 'ambient' || cinemaBg === 'amoled') updateAmbientGradient();
      };

      if (hadArt && artWrap) {
        // Animation sortante (120ms) puis entrante — transition bi-directionnelle
        clearTimeout(_cinSwapOutTimer); clearTimeout(_cinSwapInTimer); // M7 (audit 2026-06-11) : timers en vol — skip rapide A→B→C flashait la pochette B avant C
        artWrap.classList.add('cin-swap-out');
        _cinSwapOutTimer = setTimeout(_doSwapIn, 120);
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
    if (em)  {
      em.style.display = 'flex';
      // t.ext = donnée lofty → textContent ; SVG de fallback = HTML statique trusted (§13)
      if (t) em.textContent = extEmoji(t.ext);
      else {
        const _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        _svg.setAttribute('viewBox', '0 0 24 24');
        _svg.setAttribute('width', '48');
        _svg.setAttribute('height', '48');
        _svg.setAttribute('fill', 'none');
        _svg.setAttribute('stroke', 'currentColor');
        _svg.setAttribute('stroke-width', '1');
        _svg.setAttribute('stroke-linecap', 'round');
        _svg.setAttribute('opacity', '.3');
        const _path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        _path.setAttribute('d', 'M9 18V5l12-2v13');
        const _c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        _c1.setAttribute('cx', '6'); _c1.setAttribute('cy', '18'); _c1.setAttribute('r', '3');
        const _c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        _c2.setAttribute('cx', '18'); _c2.setAttribute('cy', '16'); _c2.setAttribute('r', '3');
        _svg.appendChild(_path); _svg.appendChild(_c1); _svg.appendChild(_c2);
        em.replaceChildren(_svg);
      }
    }
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

/**
 * Mise à jour légère de la progression — appelée depuis le handler timeupdate
 * de app.js à ~60 fps (evite getElementById par cycle grâce au cache _cinFill/Tc/Td).
 */
export function updateCinemaProgress(p, cur, dur) {
  if (!cinemaOpen) return;
  if (_cinFill) _cinFill.style.transform = 'scaleX(' + p + ')';
  if (_cinTc)   _cinTc.textContent = cur;
  if (_cinTd)   _cinTd.textContent = dur;
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
  try {
    if (radioActive) {
      await stopRadio();
    } else {
      const t = get('tracks')?.[get('curIdx')]; // Phase 4
      if (!t) { toast?.(i18n('radio_no_seed'), 'warning'); return; }
      await startRadio(t.id);
    }
    updateCinema();
  } catch(e) {
    toast(i18n('radio_error') || 'Radio error', 'error');
    console.warn('[cinema:toggleCinemaRadio]', e);
  }
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
  _clockInterval = setInterval(_updateClock, 1000); // toutes les 1s
}

function _stopClock() {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
}

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
function _onVisibilityChange() {
  if (!document.hidden && cinemaOpen) {
    restartAmbientIfNeeded();
    const cinVizCanvas = document.getElementById('cinema-viz');
    if ((cinemaBg === 'liquid' || cinemaBg === 'aurora') && cinVizCanvas?.style.opacity === '0') {
      startCinemaViz();
    }
  }
}

// ── Barre de progression cinéma (click pour seek) ───────────
document.addEventListener('DOMContentLoaded', function() {
  const cpbar = document.getElementById('cinema-pbar');
  if (cpbar) {
    cpbar.addEventListener('click', function(e) {
      // audio imported from player.js
      if (!audio || !audio.duration) return;
      const r = cpbar.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });
  }
});
