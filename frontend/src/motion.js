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
//   import { tween, timeline, set, eases } from './motion.js';
//
//   tween('#pl-art', { opacity: 1, duration: 0.4, ease: eases.PREMIUM });
//
//   const tl = timeline({ defaults: { ease: eases.PREMIUM } });
//   tl.to('#pl-title', { y: 0, opacity: 1, duration: 0.3 })
//     .to('#pl-artist', { y: 0, opacity: 1, duration: 0.3 }, '-=0.15');

import { gsap }       from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CFG }        from './cfg.js';

// Register once at module load — registerPlugin is idempotent and tree-shake safe.
gsap.registerPlugin(CustomEase);

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

/**
 * Crée une fonction de tween rapide pour animation frame-par-frame.
 * Intentionnellement sans vérification reduced-motion — réservé aux visualiseurs temps-réel.
 * @returns {Function} setter(value) → tweene target[prop] vers value
 */
export const quickTo = (target, prop, vars) => gsap.quickTo(target, prop, vars);

// ── View presets ─────────────────────────────────────────────────────────────

/**
 * Animate a view element entering the screen.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewEnter(el) {
  kill(el);
  // fromTo avec "to" explicite opacity:1 — évite que gsap.from lise l'opacity stale
  // laissée par un viewExit tué à mi-course (ex. double-clic open→close).
  if (prefersReducedMotion()) return gsap.set(el, { opacity: 1 });
  return gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' });
}

/**
 * Animate a view element leaving the screen. Returns a thenable tween.
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function viewExit(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, duration: 0.14, ease: 'power2.in' });
}

// ── Panel presets ─────────────────────────────────────────────────────────────

/**
 * @param {Element} el — panel inner element (not the backdrop)
 * @returns {gsap.core.Tween}
 */
export function panelOpen(el) {
  kill(el);
  // fromTo avec "to" explicite opacity:1 — evite que gsap.from lise l'opacity:0 inline
  // laisse par panelClose (stale) et anime de 0→0, rendant le panneau invisible.
  if (prefersReducedMotion()) return gsap.set(el, { opacity: 1, clearProps: 'transform' });
  return gsap.fromTo(el,
    { opacity: 0, y: 6 },
    { opacity: 1, y: 0, duration: 0.24, ease: eases.PREMIUM, clearProps: 'transform' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function panelClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, y: 4, duration: 0.16, ease: 'power2.in' });
}

/**
 * @param {Element} el — dialog element inside the backdrop
 * @returns {gsap.core.Tween}
 */
export function modalOpen(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.set(el, { opacity: 1 });
  return gsap.from(el, { opacity: 0, duration: 0.22, ease: eases.PREMIUM, clearProps: 'opacity' });
}

/**
 * @param {Element} el
 * @returns {gsap.core.Tween}
 */
export function modalClose(el) {
  kill(el);
  if (prefersReducedMotion()) return gsap.to(el, { opacity: 0, duration: 0 });
  return gsap.to(el, { opacity: 0, duration: 0.16, ease: 'power2.in' });
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
    .from(artEl,    { opacity: 0, scale: 1.08, filter: 'blur(4px)', duration: 0.26, ease: eases.PREMIUM, clearProps: 'filter,transform,opacity' }, 0)
    .from(titleEl,  { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform,opacity' }, 0)
    .from(artistEl, { opacity: 0, y: 6, duration: 0.20, ease: eases.PREMIUM, clearProps: 'transform,opacity' }, 0.04);
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

const STAGGER_CAP = CFG.STAGGER_CAP;

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
  gsap.from(els, { opacity: 0, duration: 0.20, ease: eases.PREMIUM, stagger: 0.018, clearProps: 'opacity' });
}

// ── View transition preset ────────────────────────────────────────────────────

/**
 * Transition between two top-level view panels.
 *
 * VT API path  → called inside document.startViewTransition; just swaps .on,
 *                the browser handles the visual cross-fade.
 * Fallback path → "exit on top" GSAP cross-fade: old view fades out as an
 *                absolute overlay while new view fades in from below.
 *
 * @param {Element|null} prev  Currently visible .view (may be null on first load)
 * @param {Element}      next  Target .view to show
 */
export function transitionViews(prev, next) {
  if (!prev || prev === next) {
    next.classList.add('on');
    return;
  }

  // Kill any in-progress tweens so rapid nav doesn't stack
  gsap.killTweensOf(prev);
  gsap.killTweensOf(next);

  // Always show the new view in normal flow first
  next.classList.add('on');

  if (prefersReducedMotion()) {
    // Instant swap — no animation
    prev.classList.remove('on');
    prev.style.display = '';
    return;
  }

  // Anchored to #main (position:relative), not .view (contain:layout ≠ containing block)
  gsap.set(prev, { position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' });

  // Exit: old view fades out (shorter, quieter)
  gsap.to(prev, {
    opacity: 0,
    duration: 0.15,
    ease: eases.SNAP,
    onComplete() {
      gsap.set(prev, { clearProps: 'position,inset,zIndex,pointerEvents,opacity' });
      prev.classList.remove('on');
      prev.style.display = '';
    },
  });

  // Enter: new view fades in with upward lift (longer)
  gsap.fromTo(
    next,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.22, ease: eases.PREMIUM, clearProps: 'transform,opacity' }
  );
}
