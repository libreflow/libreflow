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
