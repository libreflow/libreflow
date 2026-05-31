// @ts-check
// LibreFlow — motion.js
//
// Animation facade over GSAP 3 (core + Flip + CustomEase).
//
// Why a facade and not direct `import { gsap } from 'gsap'`:
//   1. ONE place to register plugins (registerPlugin is a side-effect import;
//      doing it in every consumer would duplicate setup and bloat tree-shaking)
//   2. ONE place to enforce `prefers-reduced-motion` — every animation collapses
//      to an instant set() when the OS asks for reduced motion (a11y)
//   3. Future swap-out (custom rAF engine, Motion One, etc.) touches one file
//   4. Co-locates the named eases so callers never hardcode strings
//
// CLAUDE.md alignment:
//   §15 offline-only — GSAP ships zero network calls
//   §16 one module = one responsibility
//   §20 minimalism > abstraction — surface kept to what we actually use
//
// Usage:
//   import { tween, timeline, set, flip, eases } from './motion.js';
//
//   tween('#pl-art', { opacity: 1, duration: 0.4, ease: eases.PREMIUM });
//
//   const tl = timeline({ defaults: { ease: eases.PREMIUM } });
//   tl.to('#pl-title', { y: 0, opacity: 1, duration: 0.3 })
//     .to('#pl-artist', { y: 0, opacity: 1, duration: 0.3 }, '-=0.15');
//
//   // FLIP — animate layout changes after DOM reorder
//   const state = flip.getState('.track-row');
//   reorderRows();                              // mutate DOM
//   flip.from(state, { duration: 0.45, ease: eases.PREMIUM, stagger: 0.02 });

import { gsap }       from 'gsap';
import { Flip }       from 'gsap/Flip';
import { CustomEase } from 'gsap/CustomEase';

// Register once at module load — registerPlugin is idempotent and tree-shake safe.
gsap.registerPlugin(Flip, CustomEase);

// ── Reduced motion ───────────────────────────────────────────────────────────
// Respect OS pref. Re-read on each tween call so a runtime change (rare but
// possible via DevTools or accessibility tooling) takes effect immediately.
const _rmQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

/** @returns {boolean} */
export function prefersReducedMotion() {
  return !!(_rmQuery && _rmQuery.matches);
}

// ── Named eases ──────────────────────────────────────────────────────────────
// CustomEase paths use SVG cubic bezier syntax: M0,0 C<cp1x>,<cp1y> <cp2x>,<cp2y> 1,1
// Calibrated for premium player UI: snappy in, smooth out, no overshoot on text.
CustomEase.create('lf-premium',   'M0,0 C0.22,1 0.36,1 1,1');         // gentle, native-feel
CustomEase.create('lf-snap',      'M0,0 C0.4,0 0.2,1 1,1');           // quick decision (clicks)
CustomEase.create('lf-overshoot', 'M0,0 C0.34,1.56 0.64,1 1,1');      // playful overshoot (icons)

/** Re-exported ease tokens. Use these, never string literals at call sites. */
export const eases = Object.freeze({
  PREMIUM:   'lf-premium',
  SNAP:      'lf-snap',
  OVERSHOOT: 'lf-overshoot',
  LINEAR:    'none',
});

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Animate `target` to the given props. Collapses to an instant set when
 * reduced-motion is on. Returns the gsap Tween for chaining/kill.
 * @param {gsap.TweenTarget} target
 * @param {gsap.TweenVars}   vars
 * @returns {gsap.core.Tween}
 */
export function tween(target, vars) {
  if (prefersReducedMotion()) {
    const { duration: _d, delay: _dl, ease: _e, stagger: _s, onUpdate: _o, ...end } = vars;
    return gsap.set(target, end);
  }
  return gsap.to(target, vars);
}

/**
 * Animate `target` from the given props to its current values.
 * @param {gsap.TweenTarget} target
 * @param {gsap.TweenVars}   vars
 * @returns {gsap.core.Tween}
 */
export function from(target, vars) {
  if (prefersReducedMotion()) return gsap.set(target, {});
  return gsap.from(target, vars);
}

/**
 * Set props instantly (no animation, regardless of reduced-motion).
 * @param {gsap.TweenTarget} target
 * @param {gsap.TweenVars}   vars
 * @returns {gsap.core.Tween}
 */
export function set(target, vars) {
  return gsap.set(target, vars);
}

/**
 * Create a timeline. Collapses to a zero-duration timeline when reduced-motion is on
 * so caller `.to()`/`.from()` calls still chain but resolve instantly.
 * @param {gsap.TimelineVars} [vars]
 * @returns {gsap.core.Timeline}
 */
export function timeline(vars) {
  if (prefersReducedMotion()) {
    const base = vars ? { ...vars } : {};
    base.defaults = { ...(base.defaults || {}), duration: 0 };
    return gsap.timeline(base);
  }
  return gsap.timeline(vars);
}

/**
 * Cancel all tweens on the given target(s). Safe before re-tweening the same
 * element to avoid overlapping transitions.
 * @param {gsap.TweenTarget} target
 */
export function kill(target) {
  gsap.killTweensOf(target);
}

// ── Flip plugin (layout animations) ──────────────────────────────────────────
// Flip = First/Last/Invert/Play. Capture state, mutate DOM, animate from prior
// position. Perfect for list reordering, view switches, expand/collapse.

export const flip = Object.freeze({
  getState: (targets, opts) => Flip.getState(targets, opts),
  /**
   * Animate from a previously captured state to current DOM.
   * Collapses to an instant Flip when reduced-motion is on.
   */
  from(state, vars) {
    if (prefersReducedMotion()) {
      return Flip.from(state, { ...vars, duration: 0 });
    }
    return Flip.from(state, vars);
  },
  fit: (targets, opts) => Flip.fit(targets, opts),
});

// ── Diagnostic surface ───────────────────────────────────────────────────────
// Exposed for the perf-bundle script and devtools poking, not for app logic.
export const _meta = Object.freeze({
  gsapVersion: gsap.version,
  plugins: ['Flip', 'CustomEase'],
});

// ── View presets ─────────────────────────────────────────────────────────────

/**
 * Animate a view element entering the screen.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewEnter(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, y: 6, duration: 0.32, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * Animate a view element leaving the screen. Returns a thenable tween.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewExit(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, y: -8, duration: 0.18, ease: 'power2.in' });
}

// ── Panel presets ─────────────────────────────────────────────────────────────

/**
 * @param {Element} el — panel inner element (not the backdrop)
 * @returns {gsap.core.Tween}
 */
export function panelOpen(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, y: 12, scale: 0.97, duration: 0.26, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function panelClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, y: 8, scale: 0.97, duration: 0.16, ease: 'power2.in' });
}

/**
 * @param {Element} el — dialog element inside the backdrop
 * @returns {gsap.core.Tween}
 */
export function modalOpen(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.from(el, { opacity: 0, duration: 0 });
  return gsap.from(el, { opacity: 0, scale: 0.94, duration: 0.28, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function modalClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.16, ease: 'power2.in' });
}

// ── Player presets ────────────────────────────────────────────────────────────

/** Active timeline ref — allows rapid track changes to kill the previous sequence. */
let _trackSwapTl = null;

/**
 * Animate art + title + artist on track change.
 * Call AFTER DOM content (src, text) has already been updated.
 * @param {Element} artEl    — `.pl-art` container
 * @param {Element} titleEl  — `#pl-n`
 * @param {Element} artistEl — `#pl-a`
 */
export function trackSwap(artEl, titleEl, artistEl) {
  if (_trackSwapTl) { _trackSwapTl.kill(); _trackSwapTl = null; }
  if (prefersReducedMotion()) {
    gsap.from([artEl, titleEl, artistEl], { opacity: 0, duration: 0 });
    return;
  }
  _trackSwapTl = gsap.timeline({ onComplete() { _trackSwapTl = null; } })
    .from(artEl,    { opacity: 0, scale: 1.08, filter: 'blur(4px)', duration: 0.26, ease: eases.PREMIUM, clearProps: 'filter,transform' }, 0)
    .from(titleEl,  { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform' }, 0)
    .from(artistEl, { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform' }, 0.04);
}

/**
 * Tactile spring bounce for the play/pause button on press.
 * @param {Element} btn — `.pcplay`
 */
export function playPausePress(btn) {
  if (prefersReducedMotion()) return;
  kill(btn);
  gsap.fromTo(btn, { scale: 0.91 }, { scale: 1, duration: 0.20, ease: eases.OVERSHOOT });
}

// ── List presets ──────────────────────────────────────────────────────────────

const STAGGER_CAP = 12;

/**
 * Stagger-in a NodeList/Array of elements (first render of a view list).
 * @param {NodeList|Element[]} items
 */
export function staggerIn(items) {
  const els  = Array.from(items).slice(0, STAGGER_CAP);
  const rest = Array.from(items).slice(STAGGER_CAP);
  kill(els);
  if (rest.length) gsap.set(rest, { opacity: 1 });
  if (prefersReducedMotion()) { gsap.set(els, { opacity: 1 }); return; }
  gsap.from(els, { opacity: 0, x: -8, duration: 0.24, ease: eases.PREMIUM, stagger: 0.018, clearProps: 'transform' });
}

/**
 * Stagger-out before a list is replaced.
 * @param {NodeList|Element[]} items
 * @returns {gsap.core.Tween}
 */
export function staggerOut(items) {
  const els = Array.from(items).slice(0, STAGGER_CAP);
  kill(els);
  if (prefersReducedMotion()) { gsap.set(els, { opacity: 0 }); return gsap.set(els, {}); }
  return gsap.to(els, { opacity: 0, x: -4, duration: 0.14, ease: 'power2.in', stagger: 0.010 });
}
