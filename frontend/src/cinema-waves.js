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

/**
 * Géométrie d'une couche de vague, normalisée.
 * @param {number} l       index de couche, 0 = arrière … layers-1 = avant
 * @param {number} layers  nombre total de couches
 * @returns {{yBase:number, ampBase:number, ampEnergy:number,
 *            fillAlpha:number, crestAlpha:number, lineWidth:number}}
 *   yBase/ampBase/ampEnergy en fraction de la hauteur canvas ; alphas 0-1 ;
 *   lineWidth en px CSS.
 */
export function waveLayerGeom(l, layers) {
  const t = layers > 1 ? l / (layers - 1) : 1; // 0 = arrière, 1 = avant
  return {
    yBase:      0.30 + t * 0.56,   // 0.30h (horizon) → 0.86h (premier plan)
    ampBase:    0.018 + t * 0.052, // houle de base — plate au loin, ample devant
    ampEnergy:  0.045 + t * 0.115, // gain appliqué à l'énergie de bande
    fillAlpha:  0.10 + t * 0.24,   // remplissage léger arrière → dense avant
    crestAlpha: 0.14 + t * 0.60,   // crête discrète arrière → brillante avant
    lineWidth:  0.7 + t * 1.6,     // 0.7px arrière → 2.3px avant
  };
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
export function computeBandEnergies(fftBuf, out, smooth = 0.35) {
  const bands  = out.length;
  const usable = Math.max(bands + 1, Math.floor(fftBuf.length * 0.72));
  for (let k = 0; k < bands; k++) {
    const start = k === 0 ? 0 : Math.floor(Math.pow(usable, k / bands));
    const end   = Math.max(start + 1, Math.floor(Math.pow(usable, (k + 1) / bands)));
    let sum = 0;
    for (let i = start; i < end; i++) sum += fftBuf[i];
    const e = sum / ((end - start) * 255);
    out[k] += (e - out[k]) * smooth;
  }
  return out;
}
