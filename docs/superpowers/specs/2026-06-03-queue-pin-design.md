# Queue Pin — Design Spec
**Date:** 2026-06-03
**Branch:** feat/search-mode-premium
**Status:** Approved

---

## Problem

The queue panel is a fixed right-side overlay that closes on every session restart. Users who keep the queue open habitually must re-open it each time. There is no way to say "always show the queue".

---

## Goal

Add a **pin toggle** to the queue panel header. When pinned, the queue stays open across sessions and the main content area permanently makes room for it (≥ 720 px). On compact screens (< 720 px) the pin is silently ignored and the queue behaves as a normal overlay.

---

## Approach: cfg flag + `#app` class

A single boolean `queuePinned` in cfg drives everything. No new module, no layout refactor.

---

## Architecture & Data Flow

```
cfg.queuePinned (boolean, default false)
       │
       ├── boot (app.js)
       │     if queuePinned && innerWidth ≥ 720 → openQueue()
       │                                         + #app.panel-queue-pinned
       │                                         + pin btn aria-pressed=true
       │
       ├── pin icon click → toggleQueuePin() (queue.js)
       │     flip queuePinned → debouncedCfgSave()
       │     toggle #app.panel-queue-pinned
       │     update btn aria-pressed + aria-label
       │
       └── closeQueue() (queue.js)
             if queuePinned → clear pin (class + cfg) first, then close normally
```

---

## Components

### HTML — `frontend/index.html`

Add one button inside `.queue-head-actions`, before the existing close button:

```html
<button class="queue-pin-btn queue-util-btn"
        data-action="toggle-queue-pin"
        aria-label="Épingler la file d'attente"
        aria-pressed="false"
        title="Épingler">
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
  </svg>
</button>
```

### CSS — `frontend/src/style.css`

```css
/* Pin button — active state */
#app.panel-queue-pinned .queue-pin-btn { color: var(--g); }

/* Permanent main padding (same value as panel-queue-open) */
#app.panel-queue-pinned #main { padding-right: clamp(260px, 28vw, 400px); }

/* Compact: ignore pin */
@media (max-width: 719px) {
  #app.panel-queue-pinned #main { padding-right: 0; }
}
```

### JS — `frontend/src/cfg.js`

Add to defaults:
```js
queuePinned: false,
```

### JS — `frontend/src/queue.js`

**New function `toggleQueuePin()`** (~15 lines):
```js
function toggleQueuePin() {
  const pinned = !get('queuePinned');
  set('queuePinned', pinned);
  debouncedCfgSave();
  document.getElementById('app').classList.toggle('panel-queue-pinned', pinned);
  const btn = document.querySelector('.queue-pin-btn');
  btn?.setAttribute('aria-pressed', String(pinned));
  btn?.setAttribute('aria-label',
    pinned ? 'Désépingler la file d\'attente' : 'Épingler la file d\'attente');
}
```

**Patch `closeQueue()`** — add at the start:
```js
if (get('queuePinned')) {
  set('queuePinned', false);
  debouncedCfgSave();
  document.getElementById('app').classList.remove('panel-queue-pinned');
  document.querySelector('.queue-pin-btn')?.setAttribute('aria-pressed', 'false');
  document.querySelector('.queue-pin-btn')?.setAttribute('aria-label', 'Épingler la file d\'attente');
}
```

**Register handler** in `handlers.js`:
```js
'toggle-queue-pin': () => toggleQueuePin(),
```

### JS — `frontend/src/app.js`

Boot restore after cfg hydration:
```js
if (cfg.queuePinned && window.innerWidth >= 720) {
  openQueue();
  document.getElementById('app').classList.add('panel-queue-pinned');
  document.querySelector('.queue-pin-btn')?.setAttribute('aria-pressed', 'true');
  document.querySelector('.queue-pin-btn')?.setAttribute('aria-label', 'Désépingler la file d\'attente');
}
```

---

## Accessibility

- Pin button: `aria-pressed` reflects pin state; `aria-label` updates on toggle.
- Meets 24×24 px touch target floor via existing `.queue-util-btn` styles (SC 2.5.8).
- No new focus trap or modal — queue panel accessibility unchanged.

---

## Constraints Respected

| CLAUDE.md | How |
|---|---|
| §2 — IDB writes debounced | `debouncedCfgSave()` used |
| §6 — cross-module wiring via app.js | boot restore in app.js only |
| §13 — no inline handlers | `data-action` delegation |
| §15 — offline | no network |
| §16 — functions < 50 lines | `toggleQueuePin` ~15 lines |
| §17 — single token source | no new `:root` tokens |

---

## Out of Scope

- Resize handle between queue and main content (full split-view = separate spec)
- i18n keys for pin aria-labels (can be added in a follow-up)
- Animation difference for pinned vs temporary open state
