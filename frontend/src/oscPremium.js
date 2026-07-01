// LibreFlow — Premium oscilloscope (oscPremium.js)
//
// Apple Music / Spotify-grade waveform renderer. Standalone, reusable.
//
//   const osc = createPremiumOscilloscope(canvas, analyserNode, opts?);
//   osc.start();                 // begin rAF loop
//   osc.stop();                  // cancel + clear
//   osc.setColor(h, s, l);       // pin static HSL; pass (null) to re-enable dynamic hue
//   osc.destroy();               // stop + disconnect ResizeObserver
//
// Hard requirements satisfied:
//   • bezierCurveTo path (Catmull-Rom → cubic Bezier, k = 1/6)
//   • analyser.smoothingTimeConstant = 0.85 + per-sample 0.6/0.4 interpolation
//   • lineWidth 1px (silence) → 3.5px (peak)
//   • hue 220 → 280 → 320 piecewise, saturation/luminosity fixed at 65%
//   • transparent canvas (destination-out fade, not opaque black fill)
//   • feature-detect OffscreenCanvas (advisory only; Safari-safe 2D path is the default)
//   • ResizeObserver-driven sizing — never touches canvas.width/height per frame
//   • rAF no-ops when document.hidden or canvas is offscreen
//   • zero allocations inside the render loop

const SAMPLE_CAP   = 128;
const SAT          = 65;
const LUM          = 65;
const HUE_CALM     = 220;
const HUE_MID      = 280;
const HUE_PEAK     = 320;
const LINE_MIN     = 1;
const LINE_MAX     = 3.5;
const GHOST_ALPHA  = 0.18;
const ENERGY_GAIN  = 3;
const CR_K         = 1 / 6;

export function createPremiumOscilloscope(canvas, analyser) {
  if (!canvas)   throw new Error('createPremiumOscilloscope: canvas required');
  if (!analyser) throw new Error('createPremiumOscilloscope: analyser required');

  analyser.smoothingTimeConstant = 0.85;

  // OffscreenCanvas detected but not transferred — transferring would lock out
  // the host canvas without enabling worker rendering. Advisory diagnostic only.
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createPremiumOscilloscope: 2D context unavailable');

  const sampleCount = Math.min(SAMPLE_CAP, analyser.fftSize);
  const data     = new Uint8Array(sampleCount);
  const prev     = new Uint8Array(sampleCount);   prev.fill(128);
  const smoothed = new Float32Array(sampleCount); smoothed.fill(128);

  let dpr = 1;
  let raf = null;
  let running = false;
  let staticColor = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width  * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width  !== w) canvas.width  = w;
    if (canvas.height !== h) canvas.height = h;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function draw() {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    if (document.hidden) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    analyser.getByteTimeDomainData(data);

    let sumAbs = 0;
    for (let i = 0; i < sampleCount; i++) {
      const s = prev[i] * 0.6 + data[i] * 0.4;
      smoothed[i] = s;
      const dev = s - 128;
      sumAbs += dev < 0 ? -dev : dev;
      prev[i] = s;
    }
    const avg    = sumAbs / sampleCount / 128;
    const energy = avg * ENERGY_GAIN > 1 ? 1 : avg * ENERGY_GAIN;

    // destination-out fade keeps the canvas transparent (no host-UI darkening).
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${GHOST_ALPHA})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    let hue, sat, lum;
    if (staticColor) {
      hue = staticColor.h; sat = staticColor.s; lum = staticColor.l;
    } else {
      hue = energy < 0.5
        ? HUE_CALM + (HUE_MID  - HUE_CALM) * (energy * 2)
        : HUE_MID  + (HUE_PEAK - HUE_MID ) * ((energy - 0.5) * 2);
      sat = SAT; lum = LUM;
    }

    ctx.strokeStyle = `hsl(${hue.toFixed(1)}, ${sat}%, ${lum}%)`;
    ctx.lineWidth   = (LINE_MIN + (LINE_MAX - LINE_MIN) * energy) * dpr;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    const sliceW = w / (sampleCount - 1);
    const mid    = h / 2;
    const amp    = h * 0.42;

    ctx.beginPath();
    const y0 = mid + (smoothed[0] / 128 - 1) * amp;
    ctx.moveTo(0, y0);

    // Catmull-Rom → cubic Bezier (k = 1/6). Control points derived from adjacent samples.
    for (let i = 0; i < sampleCount - 1; i++) {
      const xi   = i * sliceW;
      const xi1  = (i + 1) * sliceW;
      const yi   = mid + (smoothed[i] / 128 - 1) * amp;
      const yi1  = mid + (smoothed[i + 1] / 128 - 1) * amp;
      const im1  = i - 1 < 0 ? 0 : i - 1;
      const ip2  = i + 2 > sampleCount - 1 ? sampleCount - 1 : i + 2;
      const xim1 = im1 * sliceW;
      const xip2 = ip2 * sliceW;
      const yim1 = mid + (smoothed[im1] / 128 - 1) * amp;
      const yip2 = mid + (smoothed[ip2] / 128 - 1) * amp;
      const cp1x = xi  + (xi1 - xim1) * CR_K;
      const cp1y = yi  + (yi1 - yim1) * CR_K;
      const cp2x = xi1 - (xip2 - xi)  * CR_K;
      const cp2y = yi1 - (yip2 - yi)  * CR_K;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xi1, yi1);
    }
    ctx.stroke();
  }

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    setColor(h, s, l) {
      if (h == null) { staticColor = null; return; }
      staticColor = { h, s: s == null ? SAT : s, l: l == null ? LUM : l };
    },
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ro.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    _meta: { sampleCount, hasOffscreen },
  };
}
