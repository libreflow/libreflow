# Ambient Premium — Refined Ambient Background

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Cinema mode ambient background with richer colour extraction (k-means++), true cinematic film grain, organic multi-harmonic drift, and two extra accent gradient layers.

**Architecture:** Three isolated changes in three files. `artcolor.js` gains a pure k-means function + a DOM wrapper. `ambientRenderer.js` gets temporal noise regeneration, multi-harmonic drift, and two optional accent gradient passes. `cinema.js` wires the new extractor and passes the two new colour slots. All changes are additive and backward-compatible — `nowplaying.js` is not touched.

**Tech Stack:** Vanilla JS (ESM), Canvas 2D, no new dependencies.

---

## Task 1 — `artcolor.js`: k-means++ colour extractor

**Files:**
- Modify: `frontend/src/artcolor.js` (append at end — currently 84 lines)
- Modify: `frontend/tests/core.test.cjs` (append new section at end)

---

- [ ] **Step 1.1 — Write the failing test**

Append this block to the end of `frontend/tests/core.test.cjs`:

```js
// =============================================================================
// N. artcolor.js — _kmeansColors (k-means++ clustering, pure function)
// =============================================================================
section('artcolor.js -- _kmeansColors');

// Inline rgbToHsl (same logic as artcolor.js — test is self-contained per project convention)
function _artRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g-b)/d + (g<b?6:0)) / 6;
    else if (max === g) h = ((b-r)/d + 2) / 6;
    else h = ((r-g)/d + 4) / 6;
  }
  return [h * 360, s, l];
}

// Inline _kmeansColors (same logic as artcolor.js)
function _kmeansColorsTest(pixels, k, iters) {
  const n = pixels.length >> 2;
  if (n === 0 || k <= 0) return [];
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
    let r2 = Math.random()*total, chosen = n-1;
    for (let i = 0; i < n; i++) { r2 -= dists[i]; if (r2 <= 0) { chosen=i; break; } }
    const cp = chosen*4; centers.push([pixels[cp], pixels[cp+1], pixels[cp+2]]);
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      const pi = i*4; let best=0, bestD=Infinity;
      for (let c = 0; c < k; c++) {
        const d=(pixels[pi]-centers[c][0])**2+(pixels[pi+1]-centers[c][1])**2+(pixels[pi+2]-centers[c][2])**2;
        if (d < bestD) { bestD=d; best=c; }
      }
      assign[i] = best;
    }
    const acc = Array.from({length:k}, ()=>[0,0,0,0]);
    for (let i = 0; i < n; i++) {
      const pi=i*4, a=acc[assign[i]];
      a[0]+=pixels[pi]; a[1]+=pixels[pi+1]; a[2]+=pixels[pi+2]; a[3]++;
    }
    for (let c = 0; c < k; c++) {
      const a = acc[c];
      if (a[3]>0) centers[c] = [a[0]/a[3]|0, a[1]/a[3]|0, a[2]/a[3]|0];
    }
  }
  const sizes = new Int32Array(k);
  for (let i = 0; i < n; i++) sizes[assign[i]]++;
  return centers.map((ct,i) => {
    const [,s] = _artRgbToHsl(ct[0],ct[1],ct[2]);
    return { center:ct, size:sizes[i], score:(sizes[i]/n)*s };
  }).sort((a,b) => b.score - a.score);
}

(function() {
  // 2048 pure-red pixels + 2048 pure-blue pixels in flat RGBA
  const px = new Uint8ClampedArray(4096 * 4);
  for (let i = 0; i < 2048; i++) { px[i*4]=255; px[i*4+1]=0;   px[i*4+2]=0;   px[i*4+3]=255; }
  for (let i = 2048; i < 4096; i++) { px[i*4]=0; px[i*4+1]=0; px[i*4+2]=255; px[i*4+3]=255; }

  const res = _kmeansColorsTest(px, 2, 8);

  assert(res.length === 2, '_kmeansColors: retourne k=2 clusters');
  assert(res[0].score >= res[1].score, '_kmeansColors: trié score desc');
  assert(res[0].size > 0 && res[1].size > 0, '_kmeansColors: clusters non vides');
  assert(res[0].size + res[1].size === 4096, '_kmeansColors: tous pixels assignés');

  // Les deux centres doivent être clairement rouge ou clairement bleu (tolérance ±40)
  const ctrs = res.map(r => r.center);
  const hasRed  = ctrs.some(c => c[0] > 200 && c[2] < 60);
  const hasBlue = ctrs.some(c => c[2] > 200 && c[0] < 60);
  assert(hasRed,  '_kmeansColors: identifie le cluster rouge');
  assert(hasBlue, '_kmeansColors: identifie le cluster bleu');

  // Edge case : pixels tous identiques → k clusters valides (centres ≈ égaux)
  const mono = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) { mono[i*4]=128; mono[i*4+1]=64; mono[i*4+2]=32; mono[i*4+3]=255; }
  const monoRes = _kmeansColorsTest(mono, 5, 8);
  assert(monoRes.length === 5, '_kmeansColors: edge case mono → k=5 clusters');
  assert(monoRes.every(r => r.center.every(v => v >= 0 && v <= 255)),
    '_kmeansColors: centres valides RGB 0-255 sur mono');
}());
```

- [ ] **Step 1.2 — Run test to confirm FAIL**

```
node frontend/tests/core.test.cjs
```

Expected: `✗ _kmeansColors: retourne k=2 clusters` (function not defined yet), zero prior tests broken.

- [ ] **Step 1.3 — Implement `_kmeansColors` + `sampleArtColors5` in `artcolor.js`**

Append at the end of `frontend/src/artcolor.js` (after the closing brace of `sampleArtColors`, line 83):

```js
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
    let r2 = Math.random() * total, chosen = n - 1;
    for (let i = 0; i < n; i++) { r2 -= dists[i]; if (r2 <= 0) { chosen = i; break; } }
    const cp = chosen * 4; centers.push([pixels[cp], pixels[cp+1], pixels[cp+2]]);
  }
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
      if (a[3] > 0) centers[c] = [a[0]/a[3]|0, a[1]/a[3]|0, a[2]/a[3]|0];
    }
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
```

- [ ] **Step 1.4 — Run test to confirm PASS**

```
node frontend/tests/core.test.cjs
```

Expected: all `_kmeansColors` assertions show `✓`. Zero new `✗`.

- [ ] **Step 1.5 — Commit**

```
git add frontend/src/artcolor.js frontend/tests/core.test.cjs
git commit -m "feat(ambient): k-means++ 5-colour extractor in artcolor.js"
```

---

## Task 2 — `ambientRenderer.js`: temporal grain + multi-harmonic drift + accent layers

**Files:**
- Modify: `frontend/src/ambientRenderer.js` (currently 139 lines)

No unit test possible for canvas rendering — visual validation in Step 2.5.

---

- [ ] **Step 2.1 — Add new constants at top of file**

Replace the constants block (lines 4–12) in `frontend/src/ambientRenderer.js`:

```js
// ── Animation constants ─────────────────────────────────────────────────────
const PHI                    = 1.6180339887; // golden ratio — irrational freq multiplier
const AMOLED_DRIFT_FREQ      = 0.000350;
const AMOLED_DRIFT_AMP       = 0.04;
const AMBIENT_DRIFT_FREQ_X   = 0.000524;
const AMBIENT_DRIFT_FREQ_Y   = 0.000370;
const AMBIENT_DRIFT_AMP      = 0.06;
const AMBIENT_DRIFT_PHASE_X  = 1.8;   // 2nd harmonic phase — driftX
const AMBIENT_DRIFT_PHASE_LX = 1.1;   // 2nd harmonic phase — driftLX
const AMBIENT_DRIFT_PHASE_RX = 2.3;   // 2nd harmonic phase — driftRX
const AMBIENT_DRIFT_PHASE_CY = 0.7;   // 2nd harmonic phase — driftCY
const AMBIENT_DRIFT_FREQ_B1  = 0.000413; // accent layer 1 freq
const AMBIENT_DRIFT_FREQ_B2  = 0.000478; // accent layer 2 freq
const AMBIENT_DRIFT_PHASE_B1 = 0.9;
const AMBIENT_DRIFT_PHASE_B2 = 2.7;
const NOISE_DITHER_AMPLITUDE = 22;
const NOISE_OVERLAY_OPACITY  = 0.055;
```

- [ ] **Step 2.2 — Add `_noiseFrame` counter and extract `_regenerateNoise()`**

Replace the module-level caches block (lines 13–18) with:

```js
// ── Module-level caches ─────────────────────────────────────────────────────
let _noiseCanvas  = null;
let _noiseFrame   = 0;      // incremented each frame; triggers regen every 3rd frame
let _vignetteGrad = null;
let _vignetteW    = 0;
let _vignetteH    = 0;
let _lastCtx      = null; // track ctx changes to invalidate vignette cache

// NOTE: _noiseCanvas, _vignetteGrad, _lastCtx are shared module-level singletons.
// This is safe because cinema and nowplaying are never rendered simultaneously.
```

Then add `_regenerateNoise()` as a new function immediately before `export function renderAmbientFrame`:

```js
function _regenerateNoise() {
  const NS = 256;
  if (!_noiseCanvas) {
    _noiseCanvas = document.createElement('canvas');
    _noiseCanvas.width = NS;
    _noiseCanvas.height = NS;
  }
  const nc = _noiseCanvas.getContext('2d');
  if (!nc) { _noiseCanvas = null; return; }
  const id = nc.createImageData(NS, NS);
  const px = id.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = (Math.random() * 2 - 1) * NOISE_DITHER_AMPLITUDE;
    px[i] = px[i+1] = px[i+2] = 128 + v;
    px[i+3] = 255;
  }
  nc.putImageData(id, 0, 0);
}
```

- [ ] **Step 2.3 — Replace drift lines + add accent positions, upgrade destructuring, add g5/g6**

**2.3a — Upgrade destructuring** (line 62 in the original file):

Replace:
```js
  const { cT, cL, cR } = ambientColors;
```
With:
```js
  const { cT, cL, cR, cB1 = null, cB2 = null } = ambientColors;
```

**2.3b — Replace drift lines** (lines 68–72 in original). Replace:
```js
  const driftX  = Math.sin(t * AMBIENT_DRIFT_FREQ_X) * W * AMBIENT_DRIFT_AMP;
  const breathR = 1 + Math.sin(t * AMBIENT_DRIFT_FREQ_Y) * AMBIENT_DRIFT_AMP;
  const driftLX = W * (0.10 + Math.sin(t * 0.000419 + 1.0) * 0.05);
  const driftRX = W * (0.90 + Math.sin(t * 0.000449 + 2.1) * 0.05);
  const driftCY = H * (1.02 + Math.sin(t * 0.000287 + 0.5) * 0.03);
```
With:
```js
  const driftX  = (Math.sin(t * AMBIENT_DRIFT_FREQ_X) * 0.68 +
                   Math.sin(t * AMBIENT_DRIFT_FREQ_X * PHI + AMBIENT_DRIFT_PHASE_X) * 0.32) * W * AMBIENT_DRIFT_AMP;
  const breathR = 1 + (Math.sin(t * AMBIENT_DRIFT_FREQ_Y) * 0.68 +
                       Math.sin(t * AMBIENT_DRIFT_FREQ_Y * PHI + 0.6) * 0.32) * AMBIENT_DRIFT_AMP;
  const driftLX = W * (0.10 + (Math.sin(t * 0.000419 + 1.0) * 0.68 +
                                Math.sin(t * 0.000419 * PHI + AMBIENT_DRIFT_PHASE_LX) * 0.32) * 0.05);
  const driftRX = W * (0.90 + (Math.sin(t * 0.000449 + 2.1) * 0.68 +
                                Math.sin(t * 0.000449 * PHI + AMBIENT_DRIFT_PHASE_RX) * 0.32) * 0.05);
  const driftCY = H * (1.02 + (Math.sin(t * 0.000287 + 0.5) * 0.68 +
                                Math.sin(t * 0.000287 * PHI + AMBIENT_DRIFT_PHASE_CY) * 0.32) * 0.03);
  const driftB1X = W * (0.30 + (Math.sin(t * AMBIENT_DRIFT_FREQ_B1 + AMBIENT_DRIFT_PHASE_B1) * 0.68 +
                                 Math.sin(t * AMBIENT_DRIFT_FREQ_B1 * PHI + 1.5) * 0.32) * 0.08);
  const driftB1Y = H * (0.45 + (Math.sin(t * AMBIENT_DRIFT_FREQ_B1 * 0.7 + 0.3) * 0.68 +
                                 Math.sin(t * AMBIENT_DRIFT_FREQ_B1 * 1.2 + 2.0) * 0.32) * 0.06);
  const driftB2X = W * (0.70 + (Math.sin(t * AMBIENT_DRIFT_FREQ_B2 + AMBIENT_DRIFT_PHASE_B2) * 0.68 +
                                 Math.sin(t * AMBIENT_DRIFT_FREQ_B2 * PHI + 3.1) * 0.32) * 0.08);
  const driftB2Y = H * (0.55 + (Math.sin(t * AMBIENT_DRIFT_FREQ_B2 * 0.8 + 1.4) * 0.68 +
                                 Math.sin(t * AMBIENT_DRIFT_FREQ_B2 * 1.3 + 0.8) * 0.32) * 0.06);
```

**2.3c — Add g5/g6 accent passes** immediately after the line `ctx.fillStyle = g4; ctx.fillRect(0, 0, W, H);`:
```js
  if (cB1) {
    const [rB1, gB1, bB1] = cB1;
    const g5 = ctx.createRadialGradient(driftB1X, driftB1Y, 0, driftB1X, driftB1Y, W * 0.38);
    g5.addColorStop(0,    `rgba(${rB1},${gB1},${bB1},.28)`);
    g5.addColorStop(0.60, `rgba(${rB1},${gB1},${bB1},.05)`);
    g5.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g5; ctx.fillRect(0, 0, W, H);
  }
  if (cB2) {
    const [rB2, gB2, bB2] = cB2;
    const g6 = ctx.createRadialGradient(driftB2X, driftB2Y, 0, driftB2X, driftB2Y, W * 0.32);
    g6.addColorStop(0,    `rgba(${rB2},${gB2},${bB2},.22)`);
    g6.addColorStop(0.60, `rgba(${rB2},${gB2},${bB2},.04)`);
    g6.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g6; ctx.fillRect(0, 0, W, H);
  }
```

- [ ] **Step 2.4 — Replace static noise block with temporal noise call**

In `renderAmbientFrame`, replace the entire `if (!_noiseCanvas) { ... nc.putImageData(id, 0, 0);\n  }` block with:

```js
  _noiseFrame++;
  if (_noiseFrame % 3 === 0 || !_noiseCanvas) _regenerateNoise();
  if (!_noiseCanvas) return; // _regenerateNoise failed (context unavailable)
```

- [ ] **Step 2.5 — Run tests and visual check**

```
node frontend/tests/core.test.cjs
```

Expected: all previous tests still `✓`, zero new `✗`.

Then open the app:
```
npm run dev
```
Open Cinema mode, switch to `ambient` background. Verify on 3 albums:
- Colours feel richer and more varied than before
- Grain is subtly animated (not stroboscopic — film texture feel, not flickering)
- Movement is smooth and never traces an obvious repeating loop

- [ ] **Step 2.6 — Commit**

```
git add frontend/src/ambientRenderer.js
git commit -m "feat(ambient): temporal grain, multi-harmonic drift, accent gradient layers"
```

---

## Task 3 — `cinema.js`: wire `sampleArtColors5` and pass `cB1/cB2`

**Files:**
- Modify: `frontend/src/cinema.js:27` (import line)
- Modify: `frontend/src/cinema.js` — `_buildAmbientColors` function (~line 170)

---

- [ ] **Step 3.1 — Update import in `cinema.js`**

On line 27, replace:
```js
import { rgbToHsl, hslToRgb, boostSat, regionAvg, sampleArtColors } from './artcolor.js';
```
With:
```js
import { rgbToHsl, hslToRgb, boostSat, regionAvg, sampleArtColors, sampleArtColors5 } from './artcolor.js';
```

- [ ] **Step 3.2 — Replace `_buildAmbientColors()` body**

Find the function `_buildAmbientColors` and replace its entire body with:

```js
function _buildAmbientColors() {
  const img = document.getElementById('cinema-art-img');
  if (img && img.naturalWidth && img.style.display !== 'none') {
    const colors = sampleArtColors5(img, 64);
    if (colors && colors.length >= 3) {
      return {
        cT:  colors[0],
        cL:  colors[1],
        cR:  colors[2],
        cB1: colors[3] || null,
        cB2: colors[4] || null,
      };
    }
  }
  const [rF, gF, bF] = _cinArtRGB.split(',').map(Number);
  const cT = boostSat(rF, gF, bF);
  const [hF, sF, lF] = rgbToHsl(...cT);
  return {
    cT,
    cL:  hslToRgb((hF + 38) % 360, Math.min(1, sF), lF),
    cR:  hslToRgb((hF - 32 + 360) % 360, Math.min(1, sF), lF),
    cB1: null,
    cB2: null,
  };
}
```

- [ ] **Step 3.3 — Run tests**

```
node frontend/tests/core.test.cjs
```

Expected: all `✓`, zero `✗`.

- [ ] **Step 3.4 — Manual end-to-end visual verification**

```
npm run dev
```

Open Cinema mode on at least 5 albums with different visual styles:
1. Dark monochrome cover → ambient should show subtle accent tones, not flat black
2. Vivid coloured cover → ambient should show 4–5 distinct colour spots drifting
3. Gradient cover → gradient colours should appear in the background
4. Switch tracks quickly × 3 → cross-fade smooth, no colour artefacts
5. Leave on same album 3 minutes → movement feels non-repeating

- [ ] **Step 3.5 — Commit**

```
git add frontend/src/cinema.js
git commit -m "feat(ambient): wire sampleArtColors5 in _buildAmbientColors, pass cB1/cB2"
```

---

## Invariants checklist (CLAUDE.md §19)

Before each commit, confirm:
- [ ] No `fetch`, `XMLHttpRequest`, `WebSocket` added (§15)
- [ ] No new IDB writes — colour extraction is in-memory only (§8)
- [ ] No `console.log` — only `console.warn` in catch blocks (§14)
- [ ] `_kmeansColors` ≤ 50 lines (§16)
- [ ] `sampleArtColors5` ≤ 50 lines (§16)
- [ ] `_regenerateNoise` ≤ 50 lines (§16)
- [ ] `ambientRenderer.js` total < 800 lines (§16) — starts at 139, ends ~210
- [ ] No `innerHTML` with untrusted content — colours are `[r,g,b]` numeric arrays (§13)
