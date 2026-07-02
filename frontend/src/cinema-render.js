// LibreFlow — cinema-render.js
// Helpers de rendu du mode Cinéma extraits de updateCinema() (cinema.js) pour
// garder l'orchestrateur court (< 50 lignes, CLAUDE.md §16) et cinema.js < 800 lignes.
// Intra-cluster cinéma : importe cinema-bg.js / cinema-viz.js / cinema-seek.js (câblage
// explicite, même discipline que le reste du cluster ; ne réimporte pas cinema.js → pas de cycle).
//
// Exports :
//   renderCinColor(t, trackChanged)  — couleur dominante + fond + reduced-motion
//   syncCinVolumeUI(vol)             — slider volume + icônes muet/bas/haut
//   syncCinProgress()                — barre de progression + temps (chemin updateCinema)

import { fmt }                                  from './utils.js';
import { audio }                                from './player.js';
import { updateCinArtRGBFromTrack, snapArtColor, startAmbientAnim } from './cinema-bg.js';
import { startCinemaViz }                       from './cinema-viz.js';
import { prefersReducedMotion }                 from './motion.js';
import { isSeekDragging }                       from './cinema-seek.js';

/**
 * Couleur dominante de la pochette pour le visualiseur + teinte CSS.
 * Ordre d'exécution préservé depuis updateCinema (invariant du chemin de rendu) :
 *   1. changement de piste → clear du canvas viz (artefacts de persistance)
 *   2. recalcul de la couleur cible depuis la piste
 *   3. changement de piste → snap instantané (évite le fondu depuis l'ancienne couleur)
 *   4. reduced-motion → redessin statique forcé (A11Y A4/A5)
 *   5. propagation de --cin-rgb
 */
export function renderCinColor(t, trackChanged) {
  // ARCH-5 : réinitialiser l'état visuel lors d'un changement de piste.
  if (trackChanged) {
    const vizCanvas = document.getElementById('cinema-viz');
    if (vizCanvas) {
      const vCtx = vizCanvas.getContext('2d');
      if (vCtx) vCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
    }
  }
  // Mettre à jour la couleur dominante pour le visualiseur (fallback --art-color en interne).
  const artRgb = updateCinArtRGBFromTrack(t);
  // Snap instantané sur changement de piste — évite le fondu depuis l'ancienne couleur.
  if (trackChanged) snapArtColor();
  // A11Y A4/A5 : sous reduced-motion les boucles rAF ne se replanifient pas ; forcer un
  // redessin statique avec la couleur à jour (ce point est atteint sur les 3 déclencheurs
  // requis : changement de piste, resize, changement de mode — tous invoquent updateCinema()).
  if (prefersReducedMotion()) { startCinemaViz(); startAmbientAnim(); }
  // Propager --cin-rgb → teinte CSS du sous-titre artiste et album.
  document.getElementById('cinema-overlay')?.style.setProperty('--cin-rgb', artRgb);
}

/** Slider volume + icône (muet / bas / haut). `vol` est lu depuis #vol par l'appelant (§2). */
export function syncCinVolumeUI(vol) {
  const muted = audio.muted || vol === 0;
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider && !volSlider.matches(':active')) volSlider.value = vol;
  const w1 = document.getElementById('cinema-vol-wave1');
  const w2 = document.getElementById('cinema-vol-wave2');
  if (w1) w1.style.display = muted ? 'none' : '';
  if (w2) w2.style.display = (muted || vol < 0.5) ? 'none' : '';
}

/** Barre de progression + temps courant/total (chemin updateCinema, pas le 60fps). */
export function syncCinProgress() {
  if (isSeekDragging()) return; // Task 5 — ne pas écraser le fill/thumb pendant un drag manuel
  const fill  = document.getElementById('cinema-fill');
  const thumb = document.getElementById('cinema-pbar-thumb');
  const tc    = document.getElementById('cinema-tc');
  const td    = document.getElementById('cinema-td');
  if (fill  && audio.duration) fill.style.transform = 'scaleX(' + (audio.currentTime / audio.duration) + ')';
  if (thumb && audio.duration) thumb.style.left = (audio.currentTime / audio.duration * 100) + '%';
  if (tc)  tc.textContent = fmt(audio.currentTime);
  if (td)  td.textContent = audio.duration ? fmt(audio.duration) : '–:––';
}
