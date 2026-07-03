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
//   toggleCinemaMute()               — mute cliquable #cinema-vol-icon (Task 7 — vit ici
//                                      et non dans cinema.js, resté sous le cap 800 lignes)
//   getCinemaQueueUpcoming()         — Task 9 : agrège search.js/player.js(façade queue.js)/
//                                      radio.js pour buildUpcoming() (cinema-queue.js, fonction pure)
//   playCinemaQueueTrack(t)          — Task 9 : lecture depuis une rangée du panneau

import { fmt }                                  from './utils.js';
import { audio, playAt,
         peekExplicitQueue, removeFromQueue }   from './player.js';
import { i18n }                                 from './i18n.js';
import { setMasterGain }                        from './eq.js';
import { saveCfg }                              from './cfgsave.js';
import { get }                                  from './store.js';
import { CFG }                                  from './cfg.js';
import { getFiltered, filteredIdx }             from './search.js';
import { radioActive, getRadioQueue }           from './radio.js';
import { emit, EVENTS }                         from './bus.js';
import { updateCinArtRGBFromTrack, snapArtColor, startAmbientAnim } from './cinema-bg.js';
import { startCinemaViz }                       from './cinema-viz.js';
import { prefersReducedMotion }                 from './motion.js';
import { isSeekDragging }                       from './cinema-seek.js';
import { ensureContrastOnDark }                 from './artcolor.js';
import { buildUpcoming }                        from './cinema-queue.js';

// Task 7 — ratio AA (4.5:1) exigé pour --cin-rgb-ui contre le fond quasi-noir du cinéma.
const CIN_UI_MIN_CONTRAST = 4.5;

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
  // Propager --cin-rgb (brute, pour fonds/viz) + --cin-rgb-ui (garde-fou contraste
  // WCAG AA 4.5:1 vs noir, Task 7 — SEULE teinte utilisée pour texte/contrôles).
  const overlay = document.getElementById('cinema-overlay');
  if (overlay) {
    overlay.style.setProperty('--cin-rgb', artRgb);
    const rgbParts = artRgb.split(',').map(Number);
    const uiRgb = ensureContrastOnDark(rgbParts, CIN_UI_MIN_CONTRAST);
    overlay.style.setProperty('--cin-rgb-ui', uiRgb.join(','));
  }
}

/**
 * Slider volume + icône (muet / bas / haut) + bouton mute (Task 7). `vol` est lu
 * depuis #vol par l'appelant (§2) — c'est la SEULE source de vérité pour l'état
 * "muet" affiché (pas de flag séparé) : cohérent même si le slider #cinema-vol
 * est bougé manuellement pendant que le son est coupé (handlers.js appelle
 * cette même fonction sur 'input', cf. Task 7 self-review).
 */
export function syncCinVolumeUI(vol) {
  const muted = audio.muted || vol === 0;
  const volSlider = document.getElementById('cinema-vol');
  if (volSlider && !volSlider.matches(':active')) volSlider.value = vol;
  const w1 = document.getElementById('cinema-vol-wave1');
  const w2 = document.getElementById('cinema-vol-wave2');
  if (w1) w1.style.display = muted ? 'none' : '';
  if (w2) w2.style.display = (muted || vol < 0.5) ? 'none' : '';
  const x1  = document.getElementById('cinema-vol-x1');
  const x2  = document.getElementById('cinema-vol-x2');
  const btn = document.getElementById('cinema-vol-icon');
  if (x1) x1.style.display = muted ? '' : 'none';
  if (x2) x2.style.display = muted ? '' : 'none';
  if (btn) {
    btn.setAttribute('aria-pressed', String(muted));
    btn.setAttribute('aria-label', i18n(muted ? 'aria_cinema_unmute' : 'aria_cinema_mute'));
    btn.title = i18n(muted ? 't_cinema_unmute' : 't_cinema_mute');
  }
}

// ── Mute cliquable (Task 7) ──────────────────────────────────
// Mémorise le volume courant avant mute — restauré au re-clic (même principe que
// _preMuteVol dans handlers.js pour #btn-vol-mute, mémoire dédiée cinéma — elle
// survit aux changements de piste : rien ne la réécrit hors de toggleCinemaMute).
// L'état affiché (icône barrée, aria-pressed) N'EST PAS un flag séparé : il est
// dérivé du volume réel par syncCinVolumeUI(), appelée ici ET par handlers.js sur
// tout mouvement manuel de #cinema-vol — donc toujours cohérent.
let _cinPreMuteVol = 1;

/** Lit le volume depuis le slider DOM #vol — source de vérité unique (§2). */
function _readVolDom() {
  const dom = parseFloat(document.getElementById('vol')?.value);
  return Number.isFinite(dom) ? dom : 1;
}

/** Pose `v` sur les DEUX sliders (#cinema-vol + #vol) via le bus existant (même
 *  chemin que _syncCinVol dans cinema.js) + saveCfg() debounced (§8). */
function _setVolSliders(v) {
  const cvol = document.getElementById('cinema-vol');
  if (cvol) { cvol.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'cinema-vol' }); }
  const vel = document.getElementById('vol');
  if (vel) { vel.value = v; emit(EVENTS.VOL_SLIDER_UPDATE, { elId: 'vol' }); }
  saveCfg();
}

/** Toggle mute du cinéma — passe par slider→setMasterGain (§2/§9 : JAMAIS
 *  d'assignation littérale d'audio.volume). Idempotent au double-clic :
 *  mute/unmute ramène exactement au volume mémorisé. */
export function toggleCinemaMute() {
  const v = _readVolDom();
  if (v > 0) {
    _cinPreMuteVol = v;
    setMasterGain(0);
    _setVolSliders(0);
  } else {
    const restore = _cinPreMuteVol > 0 ? _cinPreMuteVol : 1;
    setMasterGain(restore);
    _setVolSliders(restore);
  }
  syncCinVolumeUI(_readVolDom());
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
    panel.disabled = true; // Task 9 — #cinema-next est un <button> : pas de focus fantôme sans piste prévisible
    hint?.classList.toggle('cin-has-next', !!shuffle);
    return;
  }
  hint?.classList.remove('cin-has-next');
  panel.classList.add('cin-has-next');
  panel.disabled = false; // Task 9
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

/**
 * Task 9 — construit la liste des ≤ CFG.CINEMA_QUEUE_LIMIT prochaines pistes pour le
 * panneau file d'attente cinéma : même source de vérité que _updateNextTrack()
 * (cinema.js) et buildUpcoming() (cinema-queue.js, fonction pure qui porte la priorité
 * explicite > radio > shuffle-hint > séquentiel). Cette fonction ne fait que rassembler
 * les entrées depuis search.js/radio.js + la file explicite via la façade player.js
 * (peekExplicitQueue/removeFromQueue réexportées, Finding 3 post-review — le cluster
 * cinéma ne réimporte jamais queue.js directement, CLAUDE.md §6), à la différence de
 * cinema-queue.js qui reste zéro-import (DI pure).
 * @returns {object[]}
 */
export function getCinemaQueueUpcoming() {
  const tracks   = get('tracks');
  const curIdx   = get('curIdx');
  if (!tracks) return []; // garde défensive (même pattern que _updateNextTrack, cinema.js)
  const curTrack = curIdx >= 0 ? tracks[curIdx] : null;
  const filtered = getFiltered();
  return buildUpcoming({
    explicitQueue:  peekExplicitQueue(),
    filtered,
    curFilteredIdx: curTrack ? filteredIdx(curTrack) : -1,
    shuffle:        get('shuffle'),
    radioActive,
    radioQueue:     radioActive ? getRadioQueue() : [],
    // repeat==='all' → wrap séquentiel (parité getNextIdx()/player.js qui boucle sur
    // filtered[0] — sinon le déclencheur "Suivant" et le panneau ouvert se contredisent
    // en fin de liste). Même source que _syncCinButtons (cinema.js) : get('repeat').
    repeatAll:      get('repeat') === 'all',
    limit:          CFG.CINEMA_QUEUE_LIMIT,
  });
}

/**
 * Task 9 — joue une piste choisie dans le panneau file d'attente cinéma. Même
 * sémantique que playQueueItem() (queue.js) : keepQueue:true (ne vide pas le reste de
 * la file explicite, seulement cette piste) + retrait de CETTE seule piste si elle y
 * était. No-op silencieux si la piste a disparu entre le rendu du panneau et le clic
 * (supprimée de la bibliothèque ou sortie de la vue filtrée).
 * @param {object} t
 */
export function playCinemaQueueTrack(t) {
  if (!t) return;
  const fi = filteredIdx(t);
  if (fi < 0) return;
  removeFromQueue(t.id);
  playAt(fi, { keepQueue: true });
}
