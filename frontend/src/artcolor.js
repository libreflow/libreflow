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
