// ambientRenderer.js — Shared canvas ambient/amoled frame renderer.
// Extracted from cinema.js. Used by cinema.js and nowplaying.js.
//
// Task 13 (audit fonds #7/#8) : zéro allocation dans le chemin par-frame (§10).
// Les gradients radiaux sont construits À L'ORIGINE avec un rayon fixe et mis en
// cache (clé : couleurs/W/H/ctx) ; le drift et la respiration passent par
// ctx.translate/scale. W/H sont des paramètres (plus de getter DOM par frame).

// ── Animation constants ─────────────────────────────────────────────────────
const AMOLED_DRIFT_FREQ      = 0.000350;
const AMOLED_DRIFT_AMP       = 0.04;
const AMBIENT_DRIFT_FREQ_X   = 0.000524;
const AMBIENT_DRIFT_FREQ_Y   = 0.000370;
const AMBIENT_DRIFT_AMP      = 0.06;
const NOISE_DITHER_AMPLITUDE = 22;
const NOISE_OVERLAY_OPACITY  = 0.055;

// ── Module-level caches ─────────────────────────────────────────────────────
let _noiseCanvas  = null;
let _vignetteGrad = null;
let _vignetteW    = 0;
let _vignetteH    = 0;
let _lastCtx      = null; // track ctx changes to invalidate caches

// Gradients ambient (g1-g4) — invalidés par (référence ambientColors, W, H).
// ambientColors est reconstruit à chaque changement de piste → l'identité de
// l'objet est une clé d'invalidation fiable et gratuite.
let _ambKey = null, _ambW = 0, _ambH = 0;
let _g1 = null, _g2 = null, _g3 = null, _g4 = null;
// Halo amoled — invalidé par (colorStr, H).
let _amoledGrad = null, _amoledKey = '', _amoledKeyH = 0;

// NOTE: all caches are shared module-level singletons.
// This is safe because cinema and nowplaying are never rendered simultaneously.

function _resetGradCaches() {
  _ambKey = null; _g1 = _g2 = _g3 = _g4 = null;
  _amoledGrad = null; _amoledKey = ''; _amoledKeyH = 0;
}

// Peint un gradient radial CACHÉ (construit à l'origine) à la position (cx, cy)
// avec un facteur d'échelle k (respiration). Le rect local couvre exactement
// l'écran en coordonnées device — aucune recréation de CanvasGradient par frame.
function _fillRadial(ctx, grad, cx, cy, k, W, H) {
  ctx.save();
  ctx.translate(cx, cy);
  if (k !== 1) ctx.scale(k, k);
  ctx.fillStyle = grad;
  ctx.fillRect(-cx / k, -cy / k, W / k, H / k);
  ctx.restore();
}

// Reconstruit les 4 gradients ambient à l'origine — appelé seulement quand la
// piste change (nouvelle référence ambientColors) ou quand W/H changent.
function _rebuildAmbientGradients(ctx, ambientColors, W, H) {
  _ambKey = ambientColors; _ambW = W; _ambH = H;
  const { cT, cL, cR } = ambientColors;
  const [rT, gT, bT] = cT;
  const [rL, gL, bL] = cL;
  const [rR, gR, bR] = cR;
  const rM = (rL + rR) >> 1, gM = (gL + gR) >> 1, bM = (bL + bR) >> 1;

  _g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 1.15);
  _g1.addColorStop(0,    `rgb(${rT},${gT},${bT})`);
  _g1.addColorStop(0.22, `rgb(${rT * .75 | 0},${gT * .75 | 0},${bT * .75 | 0})`);
  _g1.addColorStop(0.48, `rgb(${rT * .30 | 0},${gT * .30 | 0},${bT * .30 | 0})`);
  _g1.addColorStop(0.76, `rgb(${rT * .07 | 0},${gT * .07 | 0},${bT * .07 | 0})`);
  _g1.addColorStop(1,    'rgb(0,0,0)');

  _g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, W * .60);
  _g2.addColorStop(0,    `rgba(${rL},${gL},${bL},.65)`);
  _g2.addColorStop(0.50, `rgba(${rL},${gL},${bL},.12)`);
  _g2.addColorStop(1,    'rgba(0,0,0,0)');

  _g3 = ctx.createRadialGradient(0, 0, 0, 0, 0, W * .55);
  _g3.addColorStop(0,    `rgba(${rR},${gR},${bR},.55)`);
  _g3.addColorStop(0.50, `rgba(${rR},${gR},${bR},.09)`);
  _g3.addColorStop(1,    'rgba(0,0,0,0)');

  _g4 = ctx.createRadialGradient(0, 0, 0, 0, 0, W * .48);
  _g4.addColorStop(0,    `rgba(${rM},${gM},${bM},.38)`);
  _g4.addColorStop(0.55, `rgba(${rM},${gM},${bM},.06)`);
  _g4.addColorStop(1,    'rgba(0,0,0,0)');
}

// AMOLED : halo minimal — gradient caché (clé colorStr/H), drift via translate.
function _drawAmoled(ctx, t, colorStr, W, H) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!_amoledGrad || colorStr !== _amoledKey || H !== _amoledKeyH) {
    _amoledKey = colorStr; _amoledKeyH = H;
    _amoledGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.55);
    _amoledGrad.addColorStop(0,   `rgba(${colorStr},.09)`);
    _amoledGrad.addColorStop(0.5, `rgba(${colorStr},.02)`);
    _amoledGrad.addColorStop(1,   'rgba(0,0,0,0)');
  }
  const ax = W * 0.5 + Math.sin(t * AMOLED_DRIFT_FREQ) * W * AMOLED_DRIFT_AMP;
  _fillRadial(ctx, _amoledGrad, ax, H * 0.22, 1, W, H);
}

// Noise dithering — film grain (généré une fois, réutilisé).
function _drawNoise(ctx, W, H) {
  if (!_noiseCanvas) {
    const NS = 256;
    _noiseCanvas = document.createElement('canvas');
    _noiseCanvas.width = NS; _noiseCanvas.height = NS;
    const nc = _noiseCanvas.getContext('2d');
    if (!nc) { _noiseCanvas = null; return; }
    const id = nc.createImageData(NS, NS);
    const px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = (Math.random() * 2 - 1) * NOISE_DITHER_AMPLITUDE;
      px[i] = px[i + 1] = px[i + 2] = 128 + v;
      px[i + 3] = 255;
    }
    nc.putImageData(id, 0, 0);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = NOISE_OVERLAY_OPACITY;
  ctx.drawImage(_noiseCanvas, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Vignette — cachée, recréée seulement si W/H changent.
function _drawVignette(ctx, W, H) {
  if (!_vignetteGrad || W !== _vignetteW || H !== _vignetteH) {
    _vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, H * .18, W / 2, H / 2, H * .88);
    _vignetteGrad.addColorStop(0,    'rgba(0,0,0,0)');
    _vignetteGrad.addColorStop(0.65, 'rgba(0,0,0,.08)');
    _vignetteGrad.addColorStop(1,    'rgba(0,0,0,.62)');
    _vignetteW = W; _vignetteH = H;
  }
  ctx.fillStyle = _vignetteGrad; ctx.fillRect(0, 0, W, H);
}

/**
 * Render one ambient or amoled frame onto canvas.
 * @param {number}  t             - Animation time in ms
 * @param {HTMLCanvasElement} canvas - Reserved; drawing is done through ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'ambient'|'amoled'} mode
 * @param {string}  colorStr      - "r,g,b" — dominant art colour (used by amoled halo)
 * @param {{cT:[r,g,b], cL:[r,g,b], cR:[r,g,b]}|null} ambientColors
 * @param {number}  W             - largeur CSS px (cache de l'appelant — pas de getter DOM ici)
 * @param {number}  H             - hauteur CSS px
 * @precondition The caller must apply `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` for HiDPI,
 *   and pass W/H in CSS px consistent with that transform.
 */
export function renderAmbientFrame(t, canvas, ctx, mode, colorStr, ambientColors, W, H) {
  if (!ctx) return;
  W = W || 1280;
  H = H || 800;

  // M-03 : invalider les caches dépendants du contexte quand celui-ci change
  // (cinema ↔ nowplaying partagent ces singletons). Les CanvasGradient sont liés
  // à leur ctx d'origine ; _noiseCanvas est régénéré par cohérence.
  if (ctx !== _lastCtx) { _vignetteGrad = null; _noiseCanvas = null; _resetGradCaches(); _lastCtx = ctx; }

  if (mode === 'amoled') { _drawAmoled(ctx, t, colorStr, W, H); return; }
  if (!ambientColors) return;

  if (ambientColors !== _ambKey || W !== _ambW || H !== _ambH) {
    _rebuildAmbientGradients(ctx, ambientColors, W, H);
  }

  const driftX  = Math.sin(t * AMBIENT_DRIFT_FREQ_X) * W * AMBIENT_DRIFT_AMP;
  const breathR = 1 + Math.sin(t * AMBIENT_DRIFT_FREQ_Y) * AMBIENT_DRIFT_AMP;
  const driftLX = W * (0.10 + Math.sin(t * 0.000419 + 1.0) * 0.05);
  const driftRX = W * (0.90 + Math.sin(t * 0.000449 + 2.1) * 0.05);
  const driftCY = H * (1.02 + Math.sin(t * 0.000287 + 0.5) * 0.03);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  _fillRadial(ctx, _g1, W * 0.5 + driftX, 0, breathR, W, H); // dôme haut — respire
  _fillRadial(ctx, _g2, driftLX, H, 1, W, H);                // lobe bas-gauche
  _fillRadial(ctx, _g3, driftRX, H, 1, W, H);                // lobe bas-droit
  _fillRadial(ctx, _g4, W * 0.5, driftCY, 1, W, H);          // cœur bas-centre

  _drawNoise(ctx, W, H);
  _drawVignette(ctx, W, H);
}
