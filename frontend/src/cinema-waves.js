// LibreFlow — cinema-waves.js
// Logique PURE du mode Vagues (Task 12) : modèle de profondeur, palette par
// couche, énergies par bande de fréquences. Aucun accès DOM/canvas — le module
// est importé par cinema-canvas.js et testé par import ESM (core.test.cjs).
//
// Modèle de profondeur (audit 2026-07-03, finding #1) : l=0 = ARRIÈRE (haut de
// l'écran, plat, discret), l=layers-1 = AVANT (bas, ample, lumineux) — les trois
// signaux de profondeur (position, amplitude, luminosité) sont alignés, là où
// l'ancien rendu les inversait entre eux.

import { rgbToHsl, hslToRgb } from './artcolor.js';

// Boost d'amplitude maximal au beat (Task 16) — contenu : le punch visuel du beat
// est porté par le halo de fond et les crêtes, pas par un gonflement des vagues.
// Exporté pour que l'invariant pire-cas (crête avant sous l'horizon) soit testable.
export const WAVE_BEAT_BOOST_MAX = 1.25;

/**
 * Géométrie d'une couche de vague, normalisée (Task 16 : mer bornée au bas de
 * l'écran — la zone pochette/titre occupe ~0.20h-0.65h, l'horizon est à 0.58h).
 * Invariant pire-cas garanti par construction (testé) :
 *   yBase_avant − (ampBase+ampEnergy)_avant × WAVE_BEAT_BOOST_MAX ≥ horizon + 0.10h
 * → même bande saturée + beat, la vague avant ne monte jamais sur l'horizon.
 * @param {number} l       index de couche, 0 = arrière … layers-1 = avant
 * @param {number} layers  nombre total de couches
 * @returns {{yBase:number, ampBase:number, ampEnergy:number, freq:number,
 *            fillAlpha:number, crestAlpha:number, lineWidth:number}}
 *   yBase/ampBase/ampEnergy en fraction de la hauteur canvas (ampBase+ampEnergy =
 *   excursion max réelle, cf. waveY normalisée) ; freq sans unité ; alphas 0-1 ;
 *   lineWidth en px CSS.
 */
export function waveLayerGeom(l, layers) {
  const t = layers > 1 ? l / (layers - 1) : 1; // 0 = arrière, 1 = avant
  return {
    yBase:      0.58 + t * 0.30,   // 0.58h (horizon) → 0.88h (premier plan)
    ampBase:    0.012 + t * 0.030, // houle de base — plate au loin, ample devant
    ampEnergy:  0.022 + t * 0.066, // gain appliqué à l'énergie de bande
    // Perspective naturelle : houle LARGE devant (freq basse), frémissement fin
    // au loin (freq haute) — le flip de profondeur T12 avait laissé l'inverse.
    freq:       3.8 - t * 2.0,     // 3.8 arrière → 1.8 avant
    fillAlpha:  0.10 + t * 0.24,   // remplissage léger arrière → dense avant
    crestAlpha: 0.14 + t * 0.60,   // crête discrète arrière → brillante avant
    lineWidth:  0.7 + t * 1.6,     // 0.7px arrière → 2.3px avant
  };
}

// Harmoniques de waveY — poids NORMALISÉS (somme = 1) : `amp` est l'excursion
// maximale réelle, plus de facteur caché ×1.67 comme dans l'ancien modèle.
const _W1 = 0.62, _W2 = 0.26, _W3 = 0.08, _W4 = 0.04;

/**
 * Déplacement vertical d'une vague au point nx ∈ [0,1] — 4 harmoniques
 * (fondamentale + houle lente + clapot + médium) désynchronisées en phase.
 * |waveY| ≤ amp par construction (poids sommant à 1, testé sur grille).
 * @param {number} nx    position horizontale normalisée 0-1
 * @param {number} ph    phase de la couche (radians, avance dans le rAF)
 * @param {number} freq  fréquence de base de la couche (waveLayerGeom().freq)
 * @param {number} amp   excursion maximale (px ou fraction de h — unité libre)
 * @returns {number} déplacement signé, |retour| ≤ amp
 */
export function waveY(nx, ph, freq, amp) {
  return amp * (
    Math.sin(nx * Math.PI * freq + ph)              * _W1 +
    Math.sin(nx * Math.PI * freq * 0.62 + ph * 1.3) * _W2 +
    Math.sin(nx * Math.PI * freq * 2.4 + ph * 0.55) * _W3 +
    Math.sin(nx * Math.PI * freq * 1.7 + ph * 0.77) * _W4
  );
}

/**
 * Palette par couche dérivée de la couleur dominante de la pochette (finding #2/#3).
 * Hue-shift progressif arrière→avant (cohérent avec la dérive ±38°/−32° du mode
 * ambient), saturation contenue, rampe de luminance avec PLANCHER : l'avant reste
 * lisible sur fond noir même pour une pochette gris sombre.
 * @param {number} r  @param {number} g  @param {number} b  couleur d'art 0-255
 * @param {number} layers
 * @returns {Array<[number,number,number]>} une couleur [r,g,b] par couche
 */
export function waveLayerPalette(r, g, b, layers) {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Saturation : boost contenu pour les arts ternes, mais un gris pur (s≈0) reste
  // gris — on n'invente pas une teinte à partir d'un hue indéfini.
  const sat = s < 0.05 ? s : Math.min(0.92, Math.max(0.40, s * 1.30));
  // Rampe de luminance : arrière sombre (fond), avant relevé et borné (pas de
  // blanc éclatant sur les arts très clairs). lFront > lBack garanti par les bornes.
  const lBack  = Math.max(0.16, l * 0.45);
  const lFront = Math.min(0.62, Math.max(0.44, l));
  const out = new Array(layers);
  for (let i = 0; i < layers; i++) {
    const t = layers > 1 ? i / (layers - 1) : 1;
    const hue = (h + (t - 0.5) * 28 + 360) % 360; // ±14° autour de la teinte d'art
    out[i] = hslToRgb(hue, sat, lBack + (lFront - lBack) * t);
  }
  return out;
}

/**
 * Répartit le spectre FFT (Uint8Array 0-255) en `out.length` bandes log-espacées
 * (index 0 = basses) et lisse chaque bande par EMA in-place — zéro allocation
 * (finding #4 : chaque couche de vague est pilotée par SA bande, plus par un
 * scalaire global).
 * Seuls les ~72 % inférieurs du spectre sont utilisés (au-delà : quasi vide).
 * @param {Uint8Array}   fftBuf  données getByteFrequencyData
 * @param {Float32Array} out     énergies lissées 0-1, mutées in-place
 * @param {number}       smooth  coefficient EMA 0-1 (1 = pas de lissage)
 * @returns {Float32Array} le même `out`
 */
/**
 * AGC par bande (Task 17) : normalise chaque bande par son PIC GLISSANT.
 * Le spectre musical est incliné (~−6 dB/octave) — sans AGC, les bandes aiguës
 * (qui pilotent les vagues arrière) restent quasi immobiles quel que soit le
 * morceau. Mutation in-place (peaks + out), zéro allocation.
 * @param {Float32Array} bands  énergies brutes 0-1 (computeBandEnergies)
 * @param {Float32Array} peaks  pics glissants par bande, mutés in-place
 * @param {Float32Array} out    sorties normalisées 0-1, mutées in-place
 * @param {number} decay  décroissance du pic par appel (0.995 ≈ demi-vie 2.3s à 60fps)
 * @param {number} floor  pic minimal — en dessous, sortie 0 (pas d'amplification du bruit)
 * @returns {Float32Array} le même `out`
 */
export function agcNormalize(bands, peaks, out, decay = 0.995, floor = 0.04) {
  for (let k = 0; k < bands.length; k++) {
    peaks[k] = Math.max(bands[k], peaks[k] * decay);
    out[k] = peaks[k] > floor ? Math.min(1, bands[k] / peaks[k]) : 0;
  }
  return out;
}

export function computeBandEnergies(fftBuf, out, smooth = 0.35) {
  const bands  = out.length;
  const usable = Math.max(bands + 1, Math.floor(fftBuf.length * 0.72));
  for (let k = 0; k < bands; k++) {
    // Bornes défensives (fix revue) : un buffer plus court que bands+1 ferait
    // déborder end → lecture undefined → NaN. Bande hors buffer → énergie 0.
    const start = Math.min(fftBuf.length, k === 0 ? 0 : Math.floor(Math.pow(usable, k / bands)));
    const end   = Math.min(fftBuf.length, Math.max(start + 1, Math.floor(Math.pow(usable, (k + 1) / bands))));
    let sum = 0;
    for (let i = start; i < end; i++) sum += fftBuf[i];
    const e = end > start ? sum / ((end - start) * 255) : 0;
    out[k] += (e - out[k]) * smooth;
  }
  return out;
}
