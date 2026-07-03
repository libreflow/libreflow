// artcolor.js — Shared colour-extraction utilities for artwork sampling.
// Used by cinema.js (full-screen ambient) and mini.html (mini-player ambient).

/** RGB → [h°, s, l] */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

/** [h°, s, l] → [r, g, b] */
export function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2 = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [Math.round(hue2(h + 1/3) * 255), Math.round(hue2(h) * 255), Math.round(hue2(h - 1/3) * 255)];
}

/**
 * Boost saturation of an RGB colour.
 * lMin prevents near-black colours from producing invisible gradients.
 */
export function boostSat(r, g, b, sFactor = 1.5, lMin = 0.12) {
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.min(1, s * sFactor);
  l = Math.max(lMin, l);
  return hslToRgb(h, s, l);
}

/** Relative luminance of an RGB colour, per WCAG 2.1 (same formula as frontend/tests/_wcag.cjs). */
function _relLuminance(r, g, b) {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast ratio of an RGB colour against pure black (#000, luminance 0). */
function _contrastVsBlack(r, g, b) {
  return (_relLuminance(r, g, b) + 0.05) / 0.05;
}

/**
 * Lightens [r,g,b] linearly toward white until its contrast ratio against pure
 * black (#000 — the cinema backdrop is near-black, so black is the conservative
 * reference) reaches at least minRatio. Same relative-luminance math as
 * frontend/tests/_wcag.cjs (contrastRatio).
 *
 * Idempotent: a colour already at/above minRatio is returned unchanged (bit-
 * identical), so re-applying the guard to an already-guarded colour is a no-op.
 * Bounded bisection (24 steps toward white, which is always >= any valid
 * minRatio <= 21:1) — always converges, never loops, regardless of input.
 *
 * @param {number[]} rgb - [r, g, b], each 0-255
 * @param {number} minRatio - target contrast ratio, e.g. 4.5
 * @returns {number[]} [r, g, b], each 0-255, contrast-safe against #000
 */
export function ensureContrastOnDark([r, g, b], minRatio) {
  if (_contrastVsBlack(r, g, b) >= minRatio) return [r, g, b];
  const lerp = (c, t) => c + (255 - c) * t;
  let lo = 0, hi = 1; // hi=1 (pure white, ratio 21:1) satisfies any minRatio <= 21
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (_contrastVsBlack(lerp(r, mid), lerp(g, mid), lerp(b, mid)) >= minRatio) hi = mid; else lo = mid;
  }
  // Math.ceil (not round): always rounds toward white, so the integer result's
  // contrast is >= the continuous bisection value — never undershoots minRatio.
  return [r, g, b].map((c, i) => Math.min(255, Math.ceil(lerp(c, hi))));
}

/** Average RGB of a canvas region */
export function regionAvg(tc, x, y, w, h) {
  const d = tc.getImageData(x | 0, y | 0, w | 0, h | 0).data;
  let r = 0, g = 0, b = 0;
  const n = d.length >> 2;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return [r / n | 0, g / n | 0, b / n | 0];
}

/**
 * K-means++ colour clustering on RGBA pixel data.
 * Returns k clusters sorted by score (saturation × size) descending.
 *
 * @param {Uint8ClampedArray} px      RGBA pixel data
 * @param {number}            k       number of clusters
 * @param {number}            maxIter max iterations (default 8)
 * @returns {{ center: number[], size: number, score: number }[]}
 */
export function _kmeansColors(px, k, maxIter = 8) {
  const n = px.length >> 2;
  if (n === 0 || k <= 0) return [];

  // K-means++ initialisation: pick first center from pixel 0, then farthest
  const centers = [[px[0], px[1], px[2]]];
  for (let c = 1; c < k; c++) {
    let totalDist = 0;
    const dists = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = px[i*4], g = px[i*4+1], b = px[i*4+2];
      let minD = Infinity;
      for (const ct of centers) {
        const d = (r-ct[0])**2 + (g-ct[1])**2 + (b-ct[2])**2;
        if (d < minD) minD = d;
      }
      dists[i] = minD;
      totalDist += minD;
    }
    if (totalDist === 0) {
      centers.push([...centers[0]]);
    } else {
      let maxD = -1, maxI = 0;
      for (let i = 0; i < n; i++) { if (dists[i] > maxD) { maxD = dists[i]; maxI = i; } }
      centers.push([px[maxI*4], px[maxI*4+1], px[maxI*4+2]]);
    }
  }

  // K-means iterations: assign then update
  const assign = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      const r = px[i*4], g = px[i*4+1], b = px[i*4+2];
      let minD = Infinity, minC = 0;
      for (let c = 0; c < k; c++) {
        const d = (r-centers[c][0])**2 + (g-centers[c][1])**2 + (b-centers[c][2])**2;
        if (d < minD) { minD = d; minC = c; }
      }
      assign[i] = minC;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c][0] += px[i*4]; sums[c][1] += px[i*4+1]; sums[c][2] += px[i*4+2]; sums[c][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0]/sums[c][3]|0, sums[c][1]/sums[c][3]|0, sums[c][2]/sums[c][3]|0];
      }
    }
  }

  const sizes = new Int32Array(k);
  for (let i = 0; i < n; i++) sizes[assign[i]]++;

  return Array.from({ length: k }, (_, c) => {
    const [r, g, b] = centers[c];
    const [, sat] = rgbToHsl(r, g, b);
    return { center: [r, g, b], size: sizes[c], score: sat * sizes[c] };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Sample 3 colour zones from an artwork image and return boosted colours.
 * Returns { cT, cL, cR } as [r,g,b], or null on failure.
 * @param {HTMLImageElement} img  - Already-loaded image element
 * @param {number}           size - Sampling canvas size in pixels (typically 64)
 */
export function sampleArtColors(img, size) {
  if (!img || !img.naturalWidth) return null;
  try {
    const SZ = size;
    const c = document.createElement('canvas');
    c.width = c.height = SZ;
    const tc = c.getContext('2d', { willReadFrequently: true });
    tc.drawImage(img, 0, 0, SZ, SZ);
    const hw = SZ >> 1;               // half width
    const q  = SZ >> 2;               // quarter width
    const th = SZ / 3 | 0;           // top-strip height
    const by = SZ * 2 / 3 | 0;       // bottom-strip y
    const bh = SZ - by;               // bottom-strip height
    return {
      cT: boostSat(...regionAvg(tc, q,  0,  hw, th)),   // top-center
      cL: boostSat(...regionAvg(tc, 0,  by, hw, bh)),   // bottom-left
      cR: boostSat(...regionAvg(tc, hw, by, hw, bh)),   // bottom-right
    };
  } catch(e) { console.warn('[artcolor] sampleArtColors failed:', e); return null; }
}
