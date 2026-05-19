# Code Review (libreflow)

## Purpose

Catch invariant violations, audio glitches, and offline-policy breaches before they reach master.

## Pre-Review Requirements

- `cargo check` passes
- `cargo test` green (proptest included)
- `npm test` green
- No unrelated files modified
- CLAUDE.md §19 auto-verification walked

## Review Checklist (libreflow-specific)

Critical invariants (CLAUDE.md §2, §13):

- [ ] Any mutation of `tracks[]` → `rebuildTrackIdxMap()` called immediately after
- [ ] `audio.volume` reads from `#vol` DOM, never assigned literally
- [ ] No external network calls (`fetch`, `XMLHttpRequest`, `WebSocket`)
- [ ] IDB writes are debounced
- [ ] Audio param changes via `setTargetAtTime`, never direct `.value =`
- [ ] IPC calls go through `ipc.js` with a timeout, after `__TAURI__` is ready
- [ ] Virtual scroll constants (`CFG.VIRT_ROW_H`, `CFG.VIRT_GRP_H`) referenced, not duplicated
- [ ] `radioRefillQueue()` called BEFORE UI update tied to the new track

General quality:

- [ ] Functions <50 lines, files <800 lines
- [ ] No deep nesting (>4 levels) — use early returns
- [ ] Errors mapped at IPC boundary, not silently swallowed
- [ ] No console.log left in committed code (console.warn for documented signals is OK)
- [ ] Tests added for the changed path

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Invariant violation, audio glitch, IDB corruption risk, network leak | **BLOCK** |
| HIGH | Perf regression, accessibility regression, missing test | **WARN** |
| MEDIUM | Maintainability concern | **INFO** |
| LOW | Naming, doc nit | **NOTE** |

## Stop Triggers — escalate to a specialized reviewer

| Surface | Reviewer |
|---------|----------|
| Tauri command added/changed (`src-tauri/`) | **security-reviewer** + **rust-reviewer** |
| Web Audio graph wiring | **architect** + **code-reviewer** |
| `virt.js` constants or render loop | **code-reviewer** (perf focus) |
| `tracks[]` mutation logic | **code-reviewer** (invariant focus) |
| Boot sequence in `app.js` | **architect** |
| Rust crate borrow/lifetime work | **rust-reviewer** |

## Common Issues to Catch

### Correctness (libreflow-specific)

- `tracks.splice()` without `rebuildTrackIdxMap()` (CLAUDE.md §2)
- `audio.volume = 1` or any literal volume assignment (CLAUDE.md §13)
- External `fetch()` (CLAUDE.md §15)
- Hardcoded `VIRT_ROW_H` / `VIRT_GRP_H` in render code (CLAUDE.md §10)
- Direct cross-module state read (must go through `app.js` global wiring)

### Performance

- Allocation inside `requestAnimationFrame`
- Synchronous IDB write (must be debounced)
- Tag-load batch > `TAG_LOAD_CONCURRENCY` (4)
- Full DOM rerender instead of virtual scroll for >1k items

### UI / Style

- CSS mixing id and class selectors (CLAUDE.md §13)
- Inline event handlers in HTML
- Imported web font instead of local `@fontsource` (CLAUDE.md §12)

## Approval Criteria

- **Approve** — no CRITICAL or HIGH; §19 checklist green
- **Warning** — HIGH issues only; merge with explicit acknowledgement
- **Block** — any CRITICAL invariant violation

## Integration

- [testing.md](testing.md) — runners and coverage targets
- [security.md](security.md) — IPC + offline guarantees
- [git-workflow.md](git-workflow.md) — commit format
- [agents.md](agents.md) — reviewer selection
