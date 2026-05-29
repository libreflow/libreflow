# libreflow — CLAUDE.md

Project conventions, invariants, and architectural decisions for Claude Code agents working on **libreflow** (Tauri 2 + Vanilla JS offline music player).

---

## 1. Project snapshot

| Item | Value |
|---|---|
| App type | Desktop (Tauri 2), offline, single-user, no network |
| Frontend | Vanilla ESM JS (~65 modules under `frontend/src/`) + Lit Web Components (`frontend/src/components/`) |
| Backend | Rust (`src-tauri/`), `lofty` for tag parsing, `notify` for FS watching |
| Persistence | IndexedDB via `idb` wrapper (`frontend/src/db.js`) |
| Bundler | Vite 8 (multi-entry: main + mini player) |
| Node | 20 |
| Test runners | `npm test` (vanilla assert, CJS), `cargo test` (Rust + proptest), `npm run bench` (synthetic 50k-track perf) |

---

## 2. Critical invariants — must never be violated

Any commit touching these areas must verify each invariant before merge.

1. **`rebuildTrackIdxMap()` after every `tracks[]` mutation** — `tracks[]` is the runtime source of truth; `_trackIdxMap` is a derived projection. Splice, push, or any mutation without the rebuild silently corrupts all track lookups.
2. **`audio.volume` reads from `#vol` DOM only** — never assign `audio.volume` literally. The DOM slider is the single source of volume truth (CLAUDE.md §13).
3. **No external network calls** — `fetch`, `XMLHttpRequest`, `WebSocket` are banned. libreflow is offline-only (§15).
4. **IDB writes are always debounced** — no synchronous or per-keystroke IDB commits.
5. **Audio param changes via `setTargetAtTime`** — direct `.value =` assignment causes zipper noise (§9).
6. **IPC calls go through `ipc.js` with a timeout** — no bare `__TAURI__.invoke()` in feature modules (§4).
7. **`radioRefillQueue()` called BEFORE UI update tied to the new track** — order of operations in the playback change path is load-bearing.
8. **Virtual scroll constants referenced from `CFG`** — `CFG.VIRT_ROW_H` and `CFG.VIRT_GRP_H` are never duplicated in render code (§10).
9. **WCAG 2.1 AA + 2.2 AA accessibility** — every interactive element exposes accessible name/role/value; non-text contrast ≥3:1 on flat-Vantablack; modals declare `role=dialog` + `aria-modal` and trap focus (released + focus restored on close); single-key shortcuts ignore typing targets; `aria-current="true"` mirrors the playing-row `.act` class exactly; the virtualized track list announces position via `aria-setsize`/`aria-posinset` on `role="listitem"` rows. **WCAG 2.2 additions:** inline icon buttons meet the 24×24px target floor via `--target-min` (SC 2.5.8); `#tlist` sets `scroll-padding-top` so keyboard focus is never hidden under sticky group headers (SC 2.4.11); every drag-to-reorder surface (playlist tracks, queue, sidebar) has a single-pointer alternative — context-menu/button **and** Alt+↑/↓ for the track list — built on the pure `moveByOne()` helper (SC 2.5.7). **AAA:** focus indicator is a dual-tone ring (2px accent `--focus-ring` + opaque neutral `--focus-ring-contrast`) so it stays ≥3:1 regardless of the user-chosen accent, and every focusable control — including the inline icon buttons — paints a ≥2px ring on `:focus-visible` (SC 2.4.13 Focus Appearance). Guardrails live in `frontend/tests/a11y.test.cjs`.

---

## 3. Directory layout

```
libreflow/
├── frontend/
│   ├── src/
│   │   ├── components/          ← Lit Web Components (lf-* prefix, Phase 0+)
│   │   ├── app.js               ← Boot sequence + cross-module wiring (imperative, stays)
│   │   ├── ipc.js               ← Tauri IPC transport layer
│   │   ├── ui.js                ← Toast façade + modal helpers
│   │   ├── virt.js              ← Virtual scroll engine (perf-critical, stays imperative)
│   │   ├── player.js / eq.js / replaygain.js ← Web Audio pipeline (stays imperative)
│   │   ├── cinema.js / viz.js / motion.js / oscPremium.js ← Canvas/GSAP animations (stays imperative)
│   │   └── *.js                 ← Feature modules, one responsibility each
│   ├── tests/
│   │   ├── core.test.cjs        ← Vanilla assert unit tests
│   │   ├── bench.cjs            ← Synthetic 50k-track perf benchmark
│   │   └── visual/              ← Playwright snapshot tests
│   └── index.html
├── src-tauri/                   ← Rust backend (Tauri 2 commands, lofty, notify)
├── docs/
│   └── superpowers/specs/ plans/ ← Design specs and implementation plans
└── .claude/rules/               ← Agent conventions (code-review, testing, security, …)
```

---

## 4. IPC contract

Every Tauri command exposed to the frontend must satisfy:

- Input typed and validated in Rust before any FS or system call
- Output is a typed struct or array; absent fields use `Option<T>`
- Errors returned as `Result<T, String>` with documented error codes (permission denied, format unsupported, etc.)
- All JS callers invoke via `ipc.js` — never bare `__TAURI__.invoke()`
- JS callers always set a timeout; never await indefinitely
- Wait for `__TAURI__` readiness before the first `invoke`
- Adding a command requires corresponding entry in `src-tauri/tauri.conf.json` allowlist
- Removing a command is a breaking change → bump version

---

## 5. Boot sequence (`app.js`)

`app.js` is the single orchestration point. It:

1. Reads cfg + all IDB stores in parallel (`Promise.all([dall('playlists'), dall('playlog'), dall('tracks')])`)
2. Calls `rebuildTrackIdxMap()` after hydrating `tracks[]`
3. Wires event listeners
4. Calls `radioRefillQueue()` before the first `updateBar()`
5. Triggers `loadTagsBg()` for incremental tag hydration (batched at concurrency 4)

Do not add cross-module logic outside `app.js` (§6).

---

## 6. Cross-module state access

Modules do not read each other's internal state directly. All wiring goes through `app.js`. The exceptions are:

- `db.js` — the single IDB façade, imported by any module that needs persistence
- `cfg.js` / `cfgsave.js` — the single cfg store, imported by any module that reads settings
- `ipc.js` — the single transport layer, imported by any module that needs Rust commands

No module imports from another feature module (e.g., `playlists.js` must not import from `queue.js`).

---

## 7. `tracks[]` — mutable source of truth

`tracks[]` is intentionally mutable (exception to the immutability default). Rationale: it is the single runtime list of all loaded tracks, holding up to 50k+ items; copying on every mutation would be prohibitive.

**Rule**: every mutation (`splice`, `push`, direct index assignment) must be immediately followed by `rebuildTrackIdxMap()`. No exception. This is the most common source of bugs.

---

## 8. IDB store pattern

Stores: `tracks`, `playlists`, `playlog`, `cfg`.

- `dget(key)` — single record (cfg)
- `dall(store)` — full-store read at boot
- `dput(store, obj)` — upsert, **always debounced**
- One logical writer per store; never two modules writing the same store concurrently

---

## 9. Web Audio pipeline invariants

**No direct `.value =` on AudioParam.** Use `setTargetAtTime` with a short time constant (~20 ms):

```js
// WRONG
gainNode.gain.value = 0.8;
// RIGHT
gainNode.gain.setTargetAtTime(0.8, ctx.currentTime, 0.02);
```

Audio chain order: Source → EQ → Analyser → Output. Never reorder.

**Crossfade**: new source ramps in, old source ramps out concurrently. `audio.volume` (the gain of the output node) is never reset during crossfade — it always reflects the `#vol` DOM slider.

ReplayGain applied at source, not output.

---

## 10. Virtual scroll

Mandatory for any list exceeding 1k items.

- Row height: `CFG.VIRT_ROW_H` — never hard-code in render code
- Group header height: `CFG.VIRT_GRP_H` — never hard-code
- Scroll → index mapping: binary search, not linear scan
- ±8 row buffer above/below viewport
- Zero allocations inside the render loop (`requestAnimationFrame`)
- Any change to constants must also update the binary-search mapping in `virt.js`

---

## 11. High-risk zones

Changes to these modules require extra care (and the matching specialized reviewer):

| Module | Risk | Reviewer |
|---|---|---|
| `virt.js` | Virtual scroll correctness + perf | code-reviewer (perf focus) |
| `player.js`, `eq.js`, `replaygain.js` | Audio glitch, zipper noise | architect + code-reviewer |
| `app.js` | Boot order, invariant wiring | architect |
| `tracks[]` mutation sites | `_trackIdxMap` divergence | code-reviewer (invariant focus) |
| `ipc.js` | Rust ↔ JS contract stability | security-reviewer |
| `cinema.js` | GSAP timeline ordering | code-reviewer |

---

## 12. Fonts

Web fonts must be self-hosted via `@fontsource`. Never import from Google Fonts, Bunny Fonts, or any external CDN. The offline guarantee (§15) prohibits any external resource load at runtime.

---

## 13. CSS and DOM discipline

- No CSS selector mixing element IDs and classes on the same rule (`.foo#bar { }` is banned)
- Inline event handlers in HTML are banned (`onclick="..."`)
- `audio.volume` is never assigned a literal value in JS — the `#vol` DOM slider owns it
- Tag content (title, artist, album from `lofty`) always rendered as text, never as `innerHTML`
- No `eval`, `new Function`, or `innerHTML` with untrusted strings

---

## 14. Error handling

Never silently swallow errors.

- IPC `Result<T, String>` errors are mapped to user-visible messages on the JS side
- JS-side errors at module boundaries: `console.warn` at minimum, with context
- Fatal boot failures: surface to user via `toast('...', 'error')`
- `console.log` is not committed — `console.warn` for documented signals is acceptable

---

## 15. Offline guarantee — no external network

libreflow is an offline desktop app. The following are permanently banned:

- `fetch()` to any URL
- `XMLHttpRequest`
- `WebSocket`
- Any npm package that phones home at runtime
- External font/icon CDN links in HTML or CSS

`npm audit` and `cargo audit` run on every dependency update. Any new dep that makes network calls at runtime is auto-rejected.

---

## 16. Module responsibility

One module = one responsibility. Files should stay between 200–400 lines (800 lines hard cap). Functions should stay under 50 lines.

If a module grows beyond 800 lines, extract a focused sub-module. Do not create speculative shared abstractions — extract only real duplication (DRY, not YAGNI violations).

---

## 17. Frontend stack

### Language and modules

- Vanilla JavaScript (ESM), no TypeScript
- No framework for the core app (React / Vue / Svelte excluded)
- Lit 3.x for new reusable UI components (see §18 below)
- Vite 8 bundler, multi-entry (`main` + `miniplayer`)
- Node 20 runtime for tooling/tests

### Styling

- **Single source of truth for tokens:** `frontend/src/design-system.css` declares all colors, typography, spacing, radius, shadows, motion, z-index, breakpoints, layout. **No `:root { --... }` block elsewhere.**
- Component styles live in `frontend/src/style.css` (vanilla selectors) and inside Lit `static styles = css\`...\`` (Shadow DOM, `lf-*` components).
- CSS custom properties (`--g`, `--bg*`, `--t*`, `--space-*`, `--radius-*`, `--text-*`, `--motion-*`, `--elev-*`) for theming, defined on `:root`.
- Shadow DOM encapsulation for Lit components (§18). Lit components inherit `:root` tokens by CSS inheritance.
- No CSS-in-JS, no utility frameworks (Tailwind, etc.).
- Legacy alias tokens (`--sp-*`, `--r-*`, `--fs-*`, `--dur-*`) remain in `style.css` for one release cycle, then get removed. New code MUST use canonical names.

### State management

- No state library. State lives in module-level variables (`tracks[]`, `cfg`, `state.js`).
- Derived state rebuilt on mutation (§7, `_trackIdxMap`).
- Persistence via IDB (§8).

---

## 18. Web Components — Lit (Phase 0+)

Depuis 2026-05-28, libreflow utilise [Lit](https://lit.dev) (3.x, JS pur, sans decorators) pour les nouveaux composants UI réutilisables, hébergés dans `frontend/src/components/`. Convention :

- Préfixe `lf-` pour tous les Custom Elements (`<lf-toast-stack>`, …).
- Un fichier = un composant. Side-effect import depuis `app.js` ou via une façade (`ui.js` pour `<lf-toast-stack>`).
- Logique pure extraite dans `<nom>.logic.js` (testable depuis `core.test.cjs`).
- Shadow DOM par défaut ; thématisation via CSS custom properties (`--lf-*`) définies sur `:root`.

**Exclusions permanentes** : `virt.js`, chaîne Web Audio (`player.js`, `eq.js`, `replaygain.js`), `app.js` boot sequence, animations canvas (`cinema.js`, `viz.js`, `motion.js`, `oscPremium.js`), `ipc.js` — restent impératifs (cf. spec `docs/superpowers/specs/2026-05-28-lit-integration-design.md` §4).

Migration phasée — Phase 0 : `<lf-toast-stack>` uniquement. Phases ultérieures (modales, panneaux, sidebar) feront chacune l'objet d'une spec et d'un plan distincts.

---

## 19. Pre-commit auto-verification checklist

Walk this checklist before every commit touching the invariant zones:

- [ ] `rebuildTrackIdxMap()` called after every `tracks[]` mutation (§2, §7)
- [ ] `audio.volume` never assigned literally — reads from `#vol` DOM slider (§2, §9, §13)
- [ ] No `fetch`, `XMLHttpRequest`, `WebSocket` calls added (§15)
- [ ] All new IDB writes are debounced (§2, §8)
- [ ] Audio param changes use `setTargetAtTime`, not `.value =` (§9)
- [ ] IPC calls go through `ipc.js` with timeout (§4)
- [ ] Virtual scroll constants come from `CFG`, not hard-coded (§10)
- [ ] `radioRefillQueue()` called before `updateBar()` in playback change path (§2)
- [ ] No `console.log` in committed code (§14)
- [ ] No external network call added (§15)
- [ ] No font imported from external CDN (§12)
- [ ] No `innerHTML` with untrusted content (§13)
- [ ] Functions <50 lines, files <800 lines (§16)
- [ ] Errors handled at IPC boundary and surface to user (§14)
- [ ] New Tauri commands added to allowlist and covered by a JS-side timeout (§4)
- [ ] Lit components: `lf-` prefix, logic in `.logic.js`, no shadow-DOM escape (§18)

---

## 20. Minimalism over abstraction

When in doubt, keep it simple. libreflow does not use:

- A state management library
- A routing library
- A component framework (except Lit for new UI components — §18)
- A CSS-in-JS solution
- A monorepo tool

New dependencies require a strong justification: the problem cannot be solved inline, the library is actively maintained, and it does not make network calls at runtime (§15).

Prefer a maintained crate/package over hand-rolled code — provided it stays offline.
