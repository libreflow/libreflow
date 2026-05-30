// ambientRenderer.js — Shared canvas ambient/amoled frame renderer.
// Extracted from cinema.js. Used by cinema.js and nowplaying.js.

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

// ── Module-level caches ─────────────────────────────────────────────────────
let _noiseCanvas  = null;
let _noiseFrame   = 0;
let _vignetteGrad = null;
let _vignetteW    = 0;
let _vignetteH    = 0;
let _lastCtx      = null; // track ctx changes to invalidate vignette cache

// NOTE: _noiseCanvas, _vignetteGrad, _lastCtx are shared module-level singletons.
// This is safe because cinema and nowplaying are never rendered simultaneously.

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

/**
 * Render one ambient or amoled frame onto canvas.
 * @param {number}  t             - Animation time in ms
 * @param {HTMLCanvasElement} canvas - Reserved; drawing is done through ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'ambient'|'amoled'} mode
 * @param {string}  colorStr      - "r,g,b" — dominant art colour (used by amoled halo)
 * @param {{cT:[r,g,b], cL:[r,g,b], cR:[r,g,b]}|null} ambientColors
 * @precondition The caller must apply `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` for HiDPI.
 *   This function reads window.innerWidth/innerHeight in CSS px — correct only when the
 *   transform is set. See cinema.js _updateAmbientGradient for reference.
 */
export function renderAmbientFrame(t, canvas, ctx, mode, colorStr, ambientColors) {
  const W = window.innerWidth  || 1280;
  const H = window.innerHeight || 800;
  if (!ctx) return;

  // M-03 : invalider les caches dépendants du contexte quand celui-ci change
  // (cinema ↔ nowplaying partagent ces singletons). _vignetteGrad est un
  // CanvasGradient lié à son ctx d'origine ; _noiseCanvas est régénéré par cohérence.
  if (ctx !== _lastCtx) { _vignetteGrad = null; _noiseCanvas = null; _lastCtx = ctx; }

  // ── AMOLED : minimal halo, reuses ambient loop ──────────────────────────
  if (mode === 'amoled') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const ax = W * 0.5 + Math.sin(t * AMOLED_DRIFT_FREQ) * W * AMOLED_DRIFT_AMP;
    const ay = H * 0.22;
    const ga = ctx.createRadialGradient(ax, ay, 0, ax, ay, H * 0.55);
    ga.addColorStop(0,   `rgba(${colorStr},.09)`);
    ga.addColorStop(0.5, `rgba(${colorStr},.02)`);
    ga.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = ga;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (!ambientColors) return;

  const { cT, cL, cR, cB1 = null, cB2 = null } = ambientColors;
  const [rT, gT, bT] = cT;
  const [rL, gL, bL] = cL;
  const [rR, gR, bR] = cR;
  const rM = (rL + rR) >> 1, gM = (gL + gR) >> 1, bM = (bL + bR) >> 1;

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

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const cx1 = W * 0.5 + driftX;
  const g1 = ctx.createRadialGradient(cx1, 0, 0, cx1, 0, H * 1.15 * breathR);
  g1.addColorStop(0,    `rgb(${rT},${gT},${bT})`);
  g1.addColorStop(0.22, `rgb(${rT * .75 | 0},${gT * .75 | 0},${bT * .75 | 0})`);
  g1.addColorStop(0.48, `rgb(${rT * .30 | 0},${gT * .30 | 0},${bT * .30 | 0})`);
  g1.addColorStop(0.76, `rgb(${rT * .07 | 0},${gT * .07 | 0},${bT * .07 | 0})`);
  g1.addColorStop(1,    'rgb(0,0,0)');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(driftLX, H, 0, driftLX, H, W * .60);
  g2.addColorStop(0,    `rgba(${rL},${gL},${bL},.65)`);
  g2.addColorStop(0.50, `rgba(${rL},${gL},${bL},.12)`);
  g2.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

  const g3 = ctx.createRadialGradient(driftRX, H, 0, driftRX, H, W * .55);
  g3.addColorStop(0,    `rgba(${rR},${gR},${bR},.55)`);
  g3.addColorStop(0.50, `rgba(${rR},${gR},${bR},.09)`);
  g3.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);

  const g4 = ctx.createRadialGradient(W * .5, driftCY, 0, W * .5, driftCY, W * .48);
  g4.addColorStop(0,    `rgba(${rM},${gM},${bM},.38)`);
  g4.addColorStop(0.55, `rgba(${rM},${gM},${bM},.06)`);
  g4.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g4; ctx.fillRect(0, 0, W, H);

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

  // ── Noise dithering — film grain ───────────────────────────────────────
  _noiseFrame++;
  if (_noiseFrame % 3 === 0 || !_noiseCanvas) _regenerateNoise();
  if (!_noiseCanvas) return; // _regenerateNoise failed (context unavailable)
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = NOISE_OVERLAY_OPACITY;
  ctx.drawImage(_noiseCanvas, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ── Vignette — cached, recréé si W ou H changent ───────────────────────
  if (!_vignetteGrad || W !== _vignetteW || H !== _vignetteH) {
    _vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, H * .18, W / 2, H / 2, H * .88);
    _vignetteGrad.addColorStop(0,    'rgba(0,0,0,0)');
    _vignetteGrad.addColorStop(0.65, 'rgba(0,0,0,.08)');
    _vignetteGrad.addColorStop(1,    'rgba(0,0,0,.62)');
    _vignetteW = W; _vignetteH = H;
  }
  ctx.fillStyle = _vignetteGrad; ctx.fillRect(0, 0, W, H);
}
