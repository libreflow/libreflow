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
//   applyCinText(t, title, artist)   — écrit titre/artiste/album (Task 6, stateless)
//   decodeArtImage(img, em, art)     — skeleton/fondu/fallback décodage pochette (Task 6, stateless)

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

/**
 * Écrit titre/artiste/album dans le DOM — texte brut uniquement (jamais innerHTML, §13).
 * Stateless : ne touche à aucun état privé de cinema.js (pas de timer, pas de _lastCinArt) —
 * appelée par cinema.js au bon moment de la séquence de swap (Task 6).
 */
export function applyCinText(t, title, artist) {
  const elT   = document.getElementById('cinema-title');
  const elA   = document.getElementById('cinema-artist');
  const elAlb = document.getElementById('cinema-album');
  if (elT) elT.textContent = title;
  if (elA) elA.textContent = artist;
  if (elAlb) {
    const parts = [t?.album, t?.year ? `(${t.year})` : null].filter(Boolean);
    elAlb.textContent = parts.join(' ');
    elAlb.style.display = parts.length ? '' : 'none';
  }
}

/**
 * Applique `art` à `img` avec un fondu d'entrée une fois le décodage terminé (Task 6) —
 * évite le flash d'image vide/à-moitié-peinte. Le skeleton visible pendant le décodage
 * est purement CSS (gradient --cin-rgb sur .cinema-art-wrap, cf. style.css) : rien à
 * faire ici pour l'afficher, seulement à cacher l'image tant qu'elle n'est pas prête.
 * En cas d'échec de décodage (fichier corrompu / format non supporté) : repli sur
 * l'icône #cinema-art-em plutôt qu'une image cassée — jamais de rejet non géré.
 */
export function decodeArtImage(img, em, art) {
  if (!img) return;
  img.style.opacity = '0'; // masqué pendant le décodage — le skeleton reste visible dessous
  img.src = art;
  img.style.display = 'block';
  img.decode().then(() => {
    if (img.src === art) img.style.opacity = ''; // fondu d'entrée via la transition CSS de #cinema-art-img
  }).catch(() => {
    if (img.src !== art) return; // dépassé par une piste plus récente entre-temps
    img.style.display = 'none';
    if (em) em.style.display = 'flex';
  });
}

/**
 * Applique le contenu (texte + image) au moment du swap-in et démarre les classes CSS
 * d'entrée. Ne gère PAS le minuteur de nettoyage (CIN_SWAP_IN_MS) — cinema.js reste seul
 * propriétaire de _cinSwapInTimer (Task 6, réutilise le timer existant, pas de 2ème horloge).
 * @returns {HTMLElement[]} txtEls — pour que l'appelant retire 'cin-txt-swap-in' plus tard.
 */
export function beginCinSwapIn(artWrap, img, em, t, title, artist, art) {
  const txtEls = ['cinema-title', 'cinema-artist', 'cinema-album']
    .map(id => document.getElementById(id)).filter(Boolean);
  applyCinText(t, title, artist);
  // Retrait des DEUX classes — miroir du traitement artWrap ci-dessous. Sans le retrait de
  // cin-txt-swap-in : un rapid-skip qui interrompt un swap-in en vol laisserait la classe
  // en place, et un classList.add() du même nom au rAF suivant ne redémarre JAMAIS
  // l'animation CSS (il faut une frame sans la classe) → texte qui saute sans animation.
  txtEls.forEach(el => el.classList.remove('cin-txt-swap-out', 'cin-txt-swap-in'));
  decodeArtImage(img, em, art);
  if (artWrap) {
    artWrap.classList.remove('cin-swap-out', 'cin-swap');
    requestAnimationFrame(() => {
      artWrap.classList.add('cin-swap');
      txtEls.forEach(el => el.classList.add('cin-txt-swap-in'));
    });
  }
  return txtEls;
}

/**
 * Affiche le panneau "Suivant" pour `nt`, ou retombe sur le hint shuffle si `shuffle` et
 * `nt` absent (Task 6, Step 5). Stateless — la priorité (explicite > radio > shuffle >
 * séquentiel) est arbitrée par l'appelant (cinema.js/_updateNextTrack), qui fournit déjà
 * la bonne piste `nt` (ou null).
 */
export function renderCinNextPanel(panel, hint, nt, shuffle) {
  if (!nt) {
    panel.classList.remove('cin-has-next');
    hint?.classList.toggle('cin-has-next', !!shuffle);
    return;
  }
  hint?.classList.remove('cin-has-next');
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
