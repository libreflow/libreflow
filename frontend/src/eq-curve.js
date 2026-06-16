// eq-curve.js — EQ frequency response curve renderer (extracted from eq.js §16)
// Renders the canvas curve inside #eq-curve-wrap.

// Grid dB lines — module-level to avoid per-frame allocation
const EQ_GRID_DB = Object.freeze([-12, -6, 0, 6, 12]);
// Pre-allocated snapshot buffer — avoids spread in draw loop
const _gainsSnapshot = new Float64Array(10); // EQ_BAND_COUNT = 10
// Cached CanvasGradient — recreated only on canvas resize or accent color change
let _eqGradCache = null, _eqGradKey = '';  // "W|H|ar|ag|ab"

function _getArtRgb() {
  const styles = getComputedStyle(document.documentElement);
  for (const prop of ['--art-color', '--g']) {
    const raw = styles.getPropertyValue(prop).trim();
    if (!raw) continue;
    const m = raw.match(/\d+/g);
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  }
  return [99, 102, 241]; // fallback indigo
}

// ── drawEQCurve ──────────────────────────────────────────────────────────────
/**
 * Render the EQ frequency response curve onto the canvas in #eq-curve-wrap.
 * @param {ArrayLike<number> | null} _currentGains  Current intentional EQ gains
 * @param {BiquadFilterNode[]} eqNodes              Live EQ filter nodes
 * @param {number[]} EQ_FREQS                       Centre frequencies per band
 * @param {number} EQ_BAND_COUNT                    Number of bands (10)
 */
export function drawEQCurve(_currentGains, eqNodes, EQ_FREQS, EQ_BAND_COUNT) {
  const wrap = document.getElementById('eq-curve-wrap');
  if (!wrap || !eqNodes) return;

  let canvas = wrap.querySelector('.eq-curve-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'eq-curve-canvas';
    wrap.appendChild(canvas);
  }

  const W  = wrap.offsetWidth  || 260;
  const H  = wrap.offsetHeight || 116;
  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  if (_currentGains?.length === EQ_BAND_COUNT) {
    _gainsSnapshot.set(_currentGains);
  } else if (eqNodes.length) {
    for (let i = 0; i < EQ_BAND_COUNT; i++) _gainsSnapshot[i] = eqNodes[i]?.gain.value ?? 0;
  } else {
    _gainsSnapshot.fill(0);
  }
  const gains = _gainsSnapshot;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  EQ_GRID_DB.forEach(db => {
    const y = H / 2 - (db / 12) * (H / 2 - 8);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const freqAt = x => Math.pow(10, logMin + (x / W) * (logMax - logMin));

  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const freq = freqAt(x);
    let db = 0;
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      const f0     = EQ_FREQS[i];
      const sigma  = 0.5;
      const dist   = Math.log2(freq / f0);
      db += gains[i] * Math.exp(-0.5 * (dist / sigma) ** 2);
    }
    const y = H / 2 - (db / 12) * (H / 2 - 8);
    if (x === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }

  const [ar, ag, ab] = _getArtRgb();
  const gradKey = `${W}|${H}|${ar}|${ag}|${ab}`;
  if (!_eqGradCache || _eqGradKey !== gradKey) {
    _eqGradCache = ctx.createLinearGradient(0, 0, 0, H);
    _eqGradCache.addColorStop(0,   `rgba(${ar},${ag},${ab},0.35)`);
    _eqGradCache.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.12)`);
    _eqGradCache.addColorStop(1,   `rgba(${ar},${ag},${ab},0.02)`);
    _eqGradKey = gradKey;
  }
  const grad = _eqGradCache;

  ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.9)`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();

  // _updateCurveHeight — inlined; _currentGains, eqNodes, EQ_BAND_COUNT are parameters above
  const panel = document.getElementById('eq-panel');
  if (panel) {
    const active = (_currentGains?.length === EQ_BAND_COUNT)
      ? _currentGains.some(g => Math.abs(g) > 0.05)
      : (eqNodes.length ? eqNodes.some(n => Math.abs(n.gain.value) > 0.05) : false);
    panel.classList.toggle('eq-curve-active', active);
  }

  // A11Y : résumé textuel SR (graves/médiums/aigus moyens), mis à jour à chaque redraw.
  if (!wrap.getAttribute('role')) wrap.setAttribute('role', 'img');
  const _avg = (a, b) => {
    let s = 0; for (let i = a; i <= b; i++) s += gains[i] || 0;
    return s / (b - a + 1);
  };
  const _fmt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
  const bass = _avg(0, 2);
  const mids = _avg(3, 6);
  const treb = _avg(7, 9);
  wrap.setAttribute(
    'aria-label',
    `Courbe EQ : graves ${_fmt(bass)}, médiums ${_fmt(mids)}, aigus ${_fmt(treb)}`
  );
}
