# GSAP Animation Enhancement — Design Spec
**Date:** 2026-05-30
**Branch:** feat/search-mode-premium
**Status:** Approved for implementation

---

## 1. Goal

Replace all CSS-based narrative animations in LibreFlow with GSAP-orchestrated equivalents, while keeping CSS for interactive states (hover, active, focus, colour). The result is a single, coherent animation language: cinematic entrance / exit sequences for views and panels, precise tactile micro-interactions for controls, zero-jank 60fps on modest hardware.

---

## 2. Guiding Principles

| Priority | Constraint |
|---|---|
| 1 | **Performance** — compositor-friendly properties only (`opacity`, `transform`). No layout-triggering props (width, height, top, left). `will-change` preserved on animated elements. Max 12 staggered items; remainder renders instantly. |
| 2 | **Accessibility** — all presets respect `prefers-reduced-motion`. When detected: `duration → 0`, translate/scale/blur removed, opacity transitions only. Uses the existing reduced-motion wrapper in `motion.js`. |
| 3 | **Coherence** — no numeric duration or easing values in calling code. All values live in `motion.js` preset definitions. |

**Division of responsibility:**

```
CSS owns                        GSAP owns
─────────────────────────────   ────────────────────────────────
:hover states                   View enter / exit
:active / :focus-visible        Panel open / close
Colour transitions              Modal open / close
--art-color / --g pulse         Track swap (art + metadata)
accent keyframe animations      Stagger list entry on view change
                                Play/pause press feedback
```

---

## 3. Architecture

### 3.1 `motion.js` expansion

`motion.js` already exists as a GSAP facade (GSAP 3.15.0) with custom eases `lf-premium`, `lf-snap`, `lf-overshoot` and a `reducedMotion` guard. It is expanded with four preset namespaces:

```
motion.js
├── primitives (unchanged): tween(), from(), set(), timeline(), kill(), flip
├── views:   viewEnter(el), viewExit(el)
├── panels:  panelOpen(el), panelClose(el), modalOpen(el), modalClose(el)
├── player:  trackSwap(artEl, titleEl, artistEl), playPausePress(btn)
└── lists:   staggerIn(items), staggerOut(items)
```

Each preset function returns the GSAP tween/timeline so callers can chain `.then()` or kill it by reference.

### 3.2 Preset definitions

#### `views`
```
viewEnter(el)
  opacity: 0 → 1
  y: +18px → 0
  duration: 380ms
  ease: lf-premium

viewExit(el)
  opacity: 1 → 0
  y: 0 → -8px
  duration: 180ms   (exit is always shorter than enter)
  ease: power2.in
```

#### `panels`
```
panelOpen(el)
  opacity: 0 → 1
  y: +12px → 0
  scale: 0.97 → 1
  duration: 260ms
  ease: lf-premium

panelClose(el)
  opacity: 1 → 0
  y: 0 → 8px
  scale: 1 → 0.97
  duration: 160ms
  ease: power2.in

modalOpen(el)
  opacity: 0 → 1
  scale: 0.94 → 1
  duration: 280ms
  ease: lf-premium

modalClose(el)
  opacity: 1 → 0
  scale: 1 → 0.96
  duration: 160ms
  ease: power2.in
```

#### `player`
```
trackSwap(artEl, titleEl, artistEl)
  Timeline:
  0ms   art: opacity 1→0, scale 1→0.88, blur 0→4px, 200ms
  0ms   title: opacity 1→0, y 0→-6px, 160ms
  40ms  artist: opacity 1→0, y 0→-6px, 160ms
  220ms art: opacity 0→1, scale 1.08→1, blur 4px→0, 260ms, lf-premium
  220ms title: opacity 0→1, y +6px→0, 200ms, lf-premium
  260ms artist: opacity 0→1, y +6px→0, 200ms, lf-premium

playPausePress(btn)
  scale: 1 → 0.91 → 1
  duration: 200ms
  ease: lf-overshoot (spring bounce on return)
  Note: replaces CSS :active scale(.91) which has no return animation
```

#### `lists`
```
staggerIn(items)
  opacity: 0 → 1
  x: -8px → 0
  stagger: 18ms per item
  duration per item: 240ms
  ease: lf-premium
  cap: first 12 items only; remaining items: opacity 0→1 instantly

staggerOut(items)
  opacity: 1 → 0
  x: 0 → -4px
  stagger: 10ms per item
  duration per item: 140ms
  ease: power2.in
  cap: first 12 items only
```

### 3.3 `prefers-reduced-motion` guard

All presets run through the existing helper:

```js
const dur = (ms) => reducedMotion ? 0 : ms / 1000;
const props = (obj) => reducedMotion ? { opacity: obj.opacity } : obj;
```

When reduced motion is active, only `opacity` changes, all spatial transforms are stripped, duration is 0 (instant).

---

## 4. Integration map

### CSS to remove per surface

| Surface | File | CSS removed |
|---|---|---|
| View transitions | `views.js` | `transition: opacity` + `animation: viewSlideIn` on `.view` |
| Queue panel | `queue.js` | `transition: opacity, transform` on `#queue-panel` |
| EQ panel | `eq.js` | Same pattern as queue |
| Settings panel | `settings.js` | `transition: opacity, transform` on `#settings-box` / overlay |
| Modales | `ui.js` | `transition: opacity` + `animation: overlayIn / modalBoxIn` on `#modal-bg`, `#pl-modal-bg`, `#confirm-modal-bg`, `#organize-modal-bg`, `#usb-modal-bg`, `#cd-modal-bg` |
| Track swap art | `playerbar.js` | `animation: artIn` on `.pl-art img` |
| Play/pause press | `player.js` | `transform: scale(.91)` on `.pcplay:active` |
| List entry | `views.js` | No existing CSS to remove — new capability |

### Calling conventions

```js
// views.js — view change (GSAP tweens are thenable in v3)
async function setView(name) {
  if (current) await motion.viewExit(current);
  show(next);
  motion.viewEnter(next);
}

// ui.js — modal
function openModal(bg) {
  bg.classList.add('on');
  motion.modalOpen(bg.querySelector('[role=dialog]'));
}
function closeModal(bg) {
  motion.modalClose(bg.querySelector('[role=dialog]')).then(() => {
    bg.classList.remove('on');
  });
}

// playerbar.js — track swap
motion.trackSwap(artEl, titleEl, artistEl);

// player.js — play/pause press (on pointerdown)
motion.playPausePress(pcplayBtn);
```

---

## 5. Out of scope

- Cinema mode open choreography — already GSAP, left untouched
- Canvas / RAF animations (ambient gradient, visualizer) — not GSAP territory
- CSS hover/active/focus states — intentionally kept in CSS
- Mini player — separate surface, deferred
- Scroll animations / ScrollTrigger — not applicable (virtual scroll handles list rendering)

---

## 6. Testing

- `npm test` must remain green — no logic changes, only visual layer
- Manual smoke after implementation:
  - Navigate all views: check enter/exit fluidity, no flicker
  - Open/close all panels and modals: verify no stuck opacity
  - Change tracks rapidly: verify `trackSwap` kills previous timeline before starting new one
  - Toggle play/pause 10× fast: verify no accumulated scale drift
  - Enable `prefers-reduced-motion` in OS: verify all animations reduce to instant opacity
- Perf: Chrome DevTools Performance tab — confirm no layout thrash, 60fps on view transitions

---

## 7. File change summary

| File | Change type |
|---|---|
| `frontend/src/motion.js` | Expand — add 4 preset namespaces |
| `frontend/src/views.js` | Update — call `viewEnter` / `viewExit` |
| `frontend/src/queue.js` | Update — call `panelOpen` / `panelClose` |
| `frontend/src/eq.js` | Update — call `panelOpen` / `panelClose` |
| `frontend/src/settings.js` | Update — call `panelOpen` / `panelClose` |
| `frontend/src/ui.js` | Update — call `modalOpen` / `modalClose` |
| `frontend/src/playerbar.js` | Update — call `trackSwap` |
| `frontend/src/player.js` | Update — call `playPausePress` on pointerdown |
| `frontend/src/style.css` | Remove CSS transitions/animations replaced by GSAP |
