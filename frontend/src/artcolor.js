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
