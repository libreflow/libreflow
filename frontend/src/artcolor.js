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

/** k-means++ initialisation: selects k diverse seed centers from the pixel buffer. */
function _kmeansInitCenters(pixels, n, k) {
  const centers = [];
  const fp = Math.floor(Math.random() * n) * 4;
  centers.push([pixels[fp], pixels[fp+1], pixels[fp+2]]);
  for (let c = 1; c < k; c++) {
    const dists = new Float32Array(n); let total = 0;
    for (let i = 0; i < n; i++) {
      const pi = i*4; let minD2 = Infinity;
      for (const ct of centers) {
        const d=(pixels[pi]-ct[0])**2+(pixels[pi+1]-ct[1])**2+(pixels[pi+2]-ct[2])**2;
        if (d < minD2) minD2 = d;
      }
      dists[i] = minD2; total += minD2;
    }
    if (total === 0) {
      const cp2 = Math.floor(Math.random() * n) * 4;
      centers.push([pixels[cp2], pixels[cp2+1], pixels[cp2+2]]);
      continue;
    }
    let r2 = Math.random() * total, chosen = n - 1;
    for (let i = 0; i < n; i++) { r2 -= dists[i]; if (r2 <= 0) { chosen = i; break; } }
    const cp = chosen * 4; centers.push([pixels[cp], pixels[cp+1], pixels[cp+2]]);
  }
  return centers;
}

/**
 * K-means++ colour clustering on a flat RGBA pixel buffer.
 * Pure function — no DOM. Exported for testability.
 * @param {Uint8ClampedArray} pixels - flat RGBA buffer
 * @param {number} k     - clusters (default 5)
 * @param {number} iters - EM iterations (default 8)
 * @returns {{ center:[r,g,b], size:number, score:number }[]} sorted by score desc
 */
export function _kmeansColors(pixels, k = 5, iters = 8) {
  const n = pixels.length >> 2;
  if (n === 0 || k <= 0) return [];
  const centers = _kmeansInitCenters(pixels, n, k);
  const assign = new Int32Array(n);
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      const pi = i*4; let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d=(pixels[pi]-centers[c][0])**2+(pixels[pi+1]-centers[c][1])**2+(pixels[pi+2]-centers[c][2])**2;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const acc = Array.from({length: k}, () => [0,0,0,0]);
    for (let i = 0; i < n; i++) {
      const pi = i*4, a = acc[assign[i]];
      a[0] += pixels[pi]; a[1] += pixels[pi+1]; a[2] += pixels[pi+2]; a[3]++;
    }
    for (let c = 0; c < k; c++) {
      const a = acc[c];
      if (a[3] > 0) { centers[c] = [a[0]/a[3]|0, a[1]/a[3]|0, a[2]/a[3]|0]; continue; }
      // empty cluster — reinitialize to a pixel from the largest non-empty cluster
      let bigC = 0;
      for (let j = 1; j < k; j++) { if (acc[j][3] > acc[bigC][3]) bigC = j; }
      if (acc[bigC][3] === 0) continue; // all clusters empty (degenerate case)
      for (let i = 0; i < n; i++) {
        if (assign[i] === bigC) { const pi=i*4; centers[c]=[pixels[pi],pixels[pi+1],pixels[pi+2]]; break; }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const pi = i * 4; let best = 0, bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d=(pixels[pi]-centers[c][0])**2+(pixels[pi+1]-centers[c][1])**2+(pixels[pi+2]-centers[c][2])**2;
      if (d < bestD) { bestD = d; best = c; }
    }
    assign[i] = best;
  }
  const sizes = new Int32Array(k);
  for (let i = 0; i < n; i++) sizes[assign[i]]++;
  return centers.map((ct, i) => {
    const [, s] = rgbToHsl(ct[0], ct[1], ct[2]);
    return { center: ct, size: sizes[i], score: (sizes[i] / n) * s };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Sample 5 dominant colours from an artwork image via k-means++.
 * DOM wrapper around _kmeansColors. Returns array of 5 boosted [r,g,b] sorted
 * by prominence×saturation, or null on failure.
 * @param {HTMLImageElement} img
 * @param {number} size - sampling canvas size in pixels (default 64)
 */
export function sampleArtColors5(img, size = 64) {
  if (!img || !img.naturalWidth) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const tc = c.getContext('2d', { willReadFrequently: true });
    tc.drawImage(img, 0, 0, size, size);
    const { data } = tc.getImageData(0, 0, size, size);
    const clusters = _kmeansColors(data, 5, 8);
    if (!clusters.length) return null;
    return clusters.map(cl => boostSat(...cl.center));
  } catch (e) { console.warn('[artcolor] sampleArtColors5 failed:', e); return null; }
}
