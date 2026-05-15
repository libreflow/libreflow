// LibreFlow — Visualiseur audio (viz.js)
//
// Canvas en arrière-plan de la player bar (#pl).
// Branché sur l'AnalyserNode de l'EQ (eqAnalyser) — partage le même AudioContext.
// Le canal passe par les deux sources (main + crossfade) car l'analyser est en fin
// de chaîne EQ, avant la destination.
//
// API publique (window.*) :
//   window.initViz()              — à appeler une fois après initEQ()
//   window.startViz()             — démarrer le rendu rAF (au play)
//   window.stopViz()              — arrêter le rendu + effacer (au pause/stop)
//   window.updateVizColor(color)  — mettre à jour la couleur (artColor → string rgb/hex)
//   window.setVizMode(mode)       — 'bars' | 'oscilloscope' | 'circle'
//   window.getVizMode()           — retourner le mode courant

import { eqAnalyser, eqCtx } from './eq.js';
import { audio }               from './player.js';
import { saveCfg } from './cfgsave.js';

/* ── Mode ─────────────────────────────────────────────────── */
let vizMode    = 'bars'; // 'bars' | 'oscilloscope' | 'circle'
let vizEnabled = false;  // false par défaut → économie GPU/CPU au démarrage

/* ── État interne ─────────────────────────────────────────── */
let canvas, canvasCtx;
let raf         = null;
let running     = false;
let smoothed    = null;   // Float32Array lissé entre frames
// PERF : Uint8Array pré-alloué — évite new Uint8Array(128) à chaque frame (7680 bytes/s de GC)
let _vizData    = null;
let _timeData      = null;   // Uint8Array pour l'oscilloscope (domaine temporel)
let _ghostTimeData = null;   // copie du frame précédent — effet traîne fantôme oscilloscope
let _circleAngle   = 0;      // offset de rotation du cercle (rad) — incrémenté chaque frame
let _circlecx      = null;   // X centre du cercle en px canvas — aligné sur #pcplay (calculé au resize)
let _circlecy      = null;   // Y centre du cercle en px canvas — aligné sur #pcplay (calculé au resize)
let vizR = 59, vizG = 130, vizB = 246; // couleur courante (défaut : --g bleu)
// PERF : chaîne RGB mise en cache pour éviter le template literal à chaque barre × frame
let _vizRGB     = '59,130,246';
let _resizeObs  = null;   // ResizeObserver — stocké pour pouvoir le déconnecter
let _vizBins    = 0;      // P8 — cache de eqAnalyser.frequencyBinCount (immuable après init)
let _dpr        = 1;      // devicePixelRatio mis en cache au resize (évite property access par frame)

/* ── P2 FIX : Circle mode — buckets pré-alloués ──────────── */
// Évite 60 stroke()+strokeStyle par frame → max 8 GPU draw calls (1 par bucket d'alpha).
// Les tableaux sont réutilisés chaque frame (.length = 0) — zéro allocation dans la boucle.
const _ALPHA_BUCKETS = 8;
const _circleBuckets = Array.from({ length: _ALPHA_BUCKETS }, () => []);

/* ── Peaks (mode bars) ────────────────────────────────────── */
const BAR_COUNT  = 60;     // bins FFT utilisés (0..~10 kHz)
const PEAK_HOLD  = 18;     // frames de maintien au sommet avant chute
const PEAK_GRAV  = 0.0007; // accélération de la chute (par frame²)
let _peaks       = null;   // Float32Array — valeur peak courante (0..1) par barre
let _peakVel     = null;   // Float32Array — vitesse de chute courante
let _peakHold    = null;   // Uint8Array   — compteur de maintien
// Gradient mis en cache — invalidé si hauteur canvas ou couleur change
let _grad        = null;
let _gradH       = 0;
let _gradRGB     = '';

/* ── Init ─────────────────────────────────────────────────── */

/** Attache le visualiseur au canvas #pl-viz.
 *  Doit être appelée APRÈS initEQ() (eqAnalyser doit exister). */
export function initViz() {
  // Guard : déjà initialisé → pas besoin de re-patcher ni de recréer l'observer
  if (canvas && canvasCtx && _resizeObs) return;
  canvas = document.getElementById('pl-viz');
  if (!canvas) return;
  canvasCtx = canvas.getContext('2d');
  if (!canvasCtx) return;

  // Polyfill roundRect — absent dans certaines versions de WebView2 (< Chromium 99)
  if (!canvasCtx.roundRect) {
    canvasCtx.roundRect = function(x, y, w, h, radii) {
      const r = Array.isArray(radii) ? radii : [radii||0, radii||0, radii||0, radii||0];
      const [tl, tr, br, bl] = r.map(v => v || 0);
      this.moveTo(x + tl, y);
      this.lineTo(x + w - tr, y);
      this.quadraticCurveTo(x + w, y,     x + w, y + tr);
      this.lineTo(x + w, y + h - br);
      this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
      this.lineTo(x + bl, y + h);
      this.quadraticCurveTo(x,     y + h, x, y + h - bl);
      this.lineTo(x, y + tl);
      this.quadraticCurveTo(x,     y,     x + tl, y);
      this.closePath();
    };
  }

  // Adapter la résolution au devicePixelRatio (évite le rendu flou sur HiDPI)
  // Déconnecter l'éventuel observer précédent avant d'en créer un nouveau
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  _resizeObs = new ResizeObserver(_resizeCanvas);
  _resizeObs.observe(canvas.parentElement);
  // Différer le premier resize — offsetWidth peut être 0 avant le premier layout
  requestAnimationFrame(_resizeCanvas);
  // Si viz désactivé par défaut, masquer le canvas immédiatement
  if (!vizEnabled) canvas.style.display = 'none';
}

function _resizeCanvas() {
  if (!canvas) return;
  const pl   = canvas.parentElement;
  if (!pl) return;
  const dpr  = window.devicePixelRatio || 1;
  _dpr = dpr;
  canvas.width  = pl.offsetWidth  * dpr;
  canvas.height = pl.offsetHeight * dpr;
  // Les styles width/height sont gérés par CSS (width:100%; height:100%)
  // Invalider le gradient mis en cache après redimensionnement
  _grad = null;
  // Calculer le Y centre du bouton play dans le canvas (1 seul getBCR au resize, jamais pendant le rendu)
  const pcplay = document.getElementById('pcplay');
  if (pcplay) {
    const plRect  = pl.getBoundingClientRect();
    const btnRect = pcplay.getBoundingClientRect();
    const cssX    = (btnRect.left + btnRect.width  / 2) - plRect.left;
    const cssY    = (btnRect.top  + btnRect.height / 2) - plRect.top;
    _circlecx = cssX * dpr;
    _circlecy = cssY * dpr;
  } else {
    _circlecx = canvas.width  / 2;
    _circlecy = canvas.height / 2;
  }
}

/* ── Mode ─────────────────────────────────────────────────── */

/** Changer le mode de visualisation.
 *  @param {'bars'|'oscilloscope'|'circle'} mode */
export function setVizMode(mode) {
  if (!['bars', 'oscilloscope', 'circle'].includes(mode)) return;
  vizMode = mode;
  _grad = null; // invalider le cache gradient lors du changement de mode
  if (_ghostTimeData) _ghostTimeData.fill(128); // réinitialiser la traîne oscilloscope
  saveCfg();
}

export function getVizMode() { return vizMode; }

/** Activer ou désactiver complètement le visualiseur.
 *  @param {boolean} enabled */
export function setVizEnabled(enabled) {
  vizEnabled = !!enabled;
  if (!canvas) return;
  if (!vizEnabled) {
    // Masquer le canvas et arrêter le RAF
    stopViz();
    canvas.style.display = 'none';
  } else {
    // Réafficher le canvas
    canvas.style.display = '';
    // Re-démarrer si l'audio joue déjà (audio n'est pas pausé)
    if (audio && !audio.paused) startViz();
  }
  saveCfg();
}

export function getVizEnabled() { return vizEnabled; }

/* ── Contrôle ─────────────────────────────────────────────── */

export function startViz() {
  if (!vizEnabled) return;  // viz désactivé → rien à faire
  if (!canvas || !eqAnalyser) return;
  if (running) return;
  // Pré-allouer les buffers une seule fois — zéro allocation dans la boucle _draw
  const bins = eqAnalyser.frequencyBinCount;
  _vizBins = bins; // P8 — cache pour _draw() : eqAnalyser.frequencyBinCount est constant après init
  if (!smoothed  || smoothed.length  !== bins) smoothed  = new Float32Array(bins);
  if (!_vizData  || _vizData.length  !== bins) _vizData  = new Uint8Array(bins);
  if (!_timeData || _timeData.length !== bins) _timeData = new Uint8Array(bins);
  // Peaks — allouer/réinitialiser à chaque démarrage (nouvelle piste)
  _peaks   = new Float32Array(BAR_COUNT);
  _peakVel = new Float32Array(BAR_COUNT);
  _peakHold = new Uint8Array(BAR_COUNT);
  // Ghost oscilloscope — réinitialiser au silence (128 = ligne plate en domaine temporel)
  _ghostTimeData = new Uint8Array(bins);
  _ghostTimeData.fill(128);
  running = true;
  if (eqCtx && eqCtx.state === 'suspended') eqCtx.resume();
  _draw();
}

export function stopViz() {
  running = false;
  cancelAnimationFrame(raf);
  raf = null;
  // Ne pas déconnecter _resizeObs : le canvas doit continuer à se redimensionner pendant les pauses
  // (sinon la fenêtre redimensionnée pendant une pause laisse un canvas périmé jusqu'au play suivant)
  if (canvasCtx && canvas) {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    // Double-clear après 2 frames au cas où un rAF était déjà en vol au moment de l'appel
    setTimeout(() => {
      if (!running && canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }, 32);
  }
}

/** Met à jour la couleur des barres.
 *  @param {string|null} color — chaîne CSS rgb(...) ou null pour fallback accent */
export function updateVizColor(color) {
  if (!color || color === 'transparent') {
    // Fallback : lire la variable d'accent CSS courante (thème ou art color)
    // @property <color> → getComputedStyle peut retourner "rgb(r, g, b)" ou "#hex"
    const g    = getComputedStyle(document.documentElement).getPropertyValue('--g').trim();
    const mHex = g.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    const mRgb = !mHex && g.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (mHex) {
      vizR = parseInt(mHex[1], 16);
      vizG = parseInt(mHex[2], 16);
      vizB = parseInt(mHex[3], 16);
    } else if (mRgb) {
      vizR = +mRgb[1]; vizG = +mRgb[2]; vizB = +mRgb[3];
    } else {
      vizR = 59; vizG = 130; vizB = 246; // dernier recours
    }
    _vizRGB = `${vizR},${vizG},${vizB}`;
    _grad = null; // invalider le gradient mis en cache
    return;
  }
  // Format rgb(r,g,b)
  const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    vizR = +m[1]; vizG = +m[2]; vizB = +m[3];
    _vizRGB = `${vizR},${vizG},${vizB}`;
    _grad = null;
    return;
  }
  // Format #rrggbb — retourné par extractColor() dans app.js via canvas.getImageData
  const mHex = color.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (mHex) {
    vizR = parseInt(mHex[1], 16);
    vizG = parseInt(mHex[2], 16);
    vizB = parseInt(mHex[3], 16);
    _vizRGB = `${vizR},${vizG},${vizB}`;
    _grad = null;
  }
}

/* ── Rendu principal ──────────────────────────────────────── */

function _draw() {
  if (!running) return;
  // Vérifier eqAnalyser AVANT de planifier le prochain frame — évite une boucle infinie si l'analyser disparaît
  if (!eqAnalyser) { running = false; return; }

  // FIX : skip si le canvas n'est pas encore rendu (dimensions nulles) — évite le reschedule
  // infini quand le composant est invisible ou pas encore mis en page.
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) { raf = requestAnimationFrame(_draw); return; }

  // P8 FIX : bins, _vizData, _timeData, smoothed sont tous pré-alloués dans startViz()
  // → supprimé les guards de taille qui tournaient à chaque frame (480 checks/sec inutiles)
  const bins = _vizBins; // P8 — lecture du cache startViz(), jamais de re-read par frame

  canvasCtx.clearRect(0, 0, w, h);
  canvasCtx.globalAlpha = 1;

  if (vizMode === 'oscilloscope') {
    _drawOscilloscope(bins, w, h);
  } else if (vizMode === 'circle') {
    eqAnalyser.getByteFrequencyData(_vizData);
    for (let i = 0; i < bins; i++) {
      smoothed[i] = smoothed[i] * 0.72 + _vizData[i] * 0.28;
    }
    // Rotation lente : ~0.004 rad/frame → un tour complet en ≈26s à 60fps
    _circleAngle += 0.004;
    if (_circleAngle > Math.PI * 2) _circleAngle -= Math.PI * 2;
    _drawCircle(bins, w, h);
  } else {
    // 'bars' (défaut)
    eqAnalyser.getByteFrequencyData(_vizData);
    for (let i = 0; i < bins; i++) {
      smoothed[i] = smoothed[i] * 0.72 + _vizData[i] * 0.28;
    }
    _drawBars(bins, w, h);
  }

  canvasCtx.globalAlpha = 1; // reset — évite de teinter les autres composants canvas
  raf = requestAnimationFrame(_draw);
}

/* ── Mode bars ────────────────────────────────────────────── */

function _drawBars(bins, w, h) {
  const dpr = _dpr;

  const gap     = 2 * dpr;
  const barW    = Math.max(2 * dpr, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
  const radius  = Math.min(barW * 0.5, 2 * dpr);

  const barBase = h * 0.80;  // y where bars sit (top 80% used for bars)
  const maxBarH = barBase;   // max bar height
  const reflH   = h - barBase; // reflection zone = bottom 20%

  // Gradient: faded at tip (top) → full color at base, cached
  if (!_grad || h !== _gradH || _vizRGB !== _gradRGB) {
    _gradH   = h;
    _gradRGB = _vizRGB;
    _grad    = canvasCtx.createLinearGradient(0, 0, 0, barBase);
    _grad.addColorStop(0, `rgba(${_vizRGB}, 0.30)`);
    _grad.addColorStop(1, `rgba(${_vizRGB}, 0.88)`);
  }

  // Pass 1: main bars (bottom-up, within top 80%)
  canvasCtx.fillStyle   = _grad;
  canvasCtx.globalAlpha = 1;
  for (let i = 0; i < BAR_COUNT; i++) {
    const val = smoothed[i] / 255;
    const bH  = val * maxBarH;
    if (bH < 1) continue;
    const x = i * (barW + gap);
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, barBase - bH, barW, bH, [radius, radius, 0, 0]);
    canvasCtx.fill();
  }

  // Pass 2: reflection (mirror below barBase, capped to bottom 20%)
  canvasCtx.globalAlpha = 0.18;
  for (let i = 0; i < BAR_COUNT; i++) {
    const val = smoothed[i] / 255;
    const rH  = Math.min(val * maxBarH * 0.5, reflH);
    if (rH < 1) continue;
    const x = i * (barW + gap);
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, barBase, barW, rH, [0, 0, radius, radius]);
    canvasCtx.fill();
  }
  canvasCtx.globalAlpha = 1;
}

/* ── Mode oscilloscope ────────────────────────────────────── */

function _drawOscilloscope(bins, w, h) {
  eqAnalyser.getByteTimeDomainData(_timeData);
  const dpr = _dpr;
  const mid  = h / 2;
  const amp  = h * 0.38; // amplitude max = 38% du demi-canvas
  const sliceW = w / bins;

  // Traîne fantôme — frame précédent à faible opacité (dessiné avant le clear principal)
  if (_ghostTimeData) {
    canvasCtx.beginPath();
    canvasCtx.lineWidth   = 2 * dpr;
    canvasCtx.strokeStyle = `rgba(${_vizRGB}, 0.15)`;
    canvasCtx.lineJoin    = 'round';
    canvasCtx.lineCap     = 'round';
    canvasCtx.shadowBlur  = 0;
    for (let i = 0; i < bins; i++) {
      const v = _ghostTimeData[i] / 128 - 1;
      const y = mid + v * amp;
      const x = i * sliceW;
      if (i === 0) canvasCtx.moveTo(x, y);
      else         canvasCtx.lineTo(x, y);
    }
    canvasCtx.stroke();
  }

  // Ligne de base centrale (guide discret)
  canvasCtx.beginPath();
  canvasCtx.strokeStyle = `rgba(${_vizRGB}, 0.1)`;
  canvasCtx.lineWidth = 1 * dpr;
  canvasCtx.moveTo(0, mid);
  canvasCtx.lineTo(w, mid);
  canvasCtx.stroke();

  // P1 FIX : shadowBlur supprimé — forçait un composite GPU complet à chaque frame.
  // Le même effet de lueur est obtenu par 2 passes sur le même path (halo d'abord, trait fin dessus).
  // Construire le path une seule fois, le réutiliser pour les deux passes.
  canvasCtx.lineJoin = 'round';
  canvasCtx.lineCap  = 'round';
  canvasCtx.beginPath();
  for (let i = 0; i < bins; i++) {
    const v = _timeData[i] / 128 - 1;
    const y = mid + v * amp;
    const x = i * sliceW;
    if (i === 0) canvasCtx.moveTo(x, y);
    else         canvasCtx.lineTo(x, y);
  }
  // Passe 1 : halo large (glow simulé, aucun GPU composite layer)
  canvasCtx.lineWidth   = 10 * dpr;
  canvasCtx.strokeStyle = `rgba(${_vizRGB}, 0.18)`;
  canvasCtx.stroke();
  // Passe 2 : trait principal fin par-dessus
  canvasCtx.lineWidth   = 2 * dpr;
  canvasCtx.strokeStyle = `rgba(${_vizRGB}, 0.88)`;
  canvasCtx.stroke();

  // Sauvegarder le frame courant pour la traîne du prochain frame
  if (_ghostTimeData) _ghostTimeData.set(_timeData);
}

/* ── Mode circle ──────────────────────────────────────────── */

function _drawCircle(bins, w, h) {
  const dpr     = _dpr;
  const cx      = _circlecx ?? w / 2;  // centré sur #pcplay (calculé au resize)
  const cy      = _circlecy ?? h / 2;
  // inner + maxBar = 0.42 × h → marges 8 % en haut/bas — plus de débordement sur la player bar
  const minDim  = Math.min(w, h);
  const inner   = Math.max(10, minDim * 0.22);
  const maxBar  = minDim * 0.20;
  const COUNT   = Math.min(BAR_COUNT, bins);
  const barW    = Math.max(2 * dpr, (2 * Math.PI * inner / COUNT) * 0.55);

  // Cercle intérieur de référence (anneau discret)
  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, inner, 0, Math.PI * 2);
  canvasCtx.strokeStyle = `rgba(${_vizRGB}, 0.18)`;
  canvasCtx.lineWidth   = 1.5 * dpr;
  canvasCtx.stroke();

  // P2 FIX : alpha buckets — 60 stroke() → max 8 GPU draw calls par frame.
  // Passe 1 : répartir les rayons visibles dans les buckets (zéro allocation — .length = 0)
  for (let b = 0; b < _ALPHA_BUCKETS; b++) _circleBuckets[b].length = 0;
  for (let i = 0; i < COUNT; i++) {
    const val = smoothed[i] / 255;
    if (val * maxBar < 1) continue;
    const bucket = Math.min(_ALPHA_BUCKETS - 1, Math.floor((0.25 + val * 0.75) * _ALPHA_BUCKETS));
    _circleBuckets[bucket].push(i);
  }
  // Passe 2 : 1 beginPath/stroke par bucket non-vide (max 8 GPU state changes)
  canvasCtx.lineWidth = barW;
  canvasCtx.lineCap   = 'round';
  for (let b = 0; b < _ALPHA_BUCKETS; b++) {
    if (!_circleBuckets[b].length) continue;
    const alpha = ((b + 0.5) / _ALPHA_BUCKETS).toFixed(2);
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = `rgba(${_vizRGB}, ${alpha})`;
    for (const i of _circleBuckets[b]) {
      const angle = (i / COUNT) * Math.PI * 2 - Math.PI / 2 + _circleAngle;
      const val   = smoothed[i] / 255;
      const cosA  = Math.cos(angle);
      const sinA  = Math.sin(angle);
      canvasCtx.moveTo(cx + cosA * inner,              cy + sinA * inner);
      canvasCtx.lineTo(cx + cosA * (inner + val * maxBar), cy + sinA * (inner + val * maxBar));
    }
    canvasCtx.stroke();
  }

  // Point central
  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
  canvasCtx.fillStyle = `rgba(${_vizRGB}, 0.55)`;
  canvasCtx.fill();
}

/* ── Exports window.* ─────────────────────────────────────── */
// setVizMode / getVizMode sont intentionnellement absents ici :
// app.js les importe et les ré-exporte sur window — un seul point d'export.
Object.assign(window, { initViz, startViz, stopViz, updateVizColor, setVizEnabled, getVizEnabled });
