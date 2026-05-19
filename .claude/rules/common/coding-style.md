# Coding Style

## Immutability (Default)

Prefer immutable updates: create new objects rather than mutate in place.

```
WRONG:  modify(original, field, value)  // changes in place
CORRECT: update(original, field, value)  // returns new copy
```

**Documented exception**: `tracks[]` is mutated in place by design (CLAUDE.md §7 — single runtime source of truth). Any mutation MUST be followed by `rebuildTrackIdxMap()` to keep the derived projection in sync. No other arrays in the codebase get this exemption.

## Core Principles

- **KISS** — simplest solution that actually works
- **DRY** — extract real repetition, not speculative shared abstractions
- **YAGNI** — no features ahead of demand
- **Minimalism > abstraction** (CLAUDE.md §20)

## File Organization

- 200–400 lines typical, 800 max
- One module = one responsibility (CLAUDE.md §16)
- ESM modules under `frontend/src/`; cross-module wiring goes through `app.js`
- Rust modules under `src-tauri/src/`

## Error Handling

- Handle errors at every level
- IPC errors mapped from `Result<T, String>` to user-visible messages on the JS side
- Never silently swallow — log to `console.warn` at minimum (CLAUDE.md §14)
- Use timeouts on the JS side for any IPC call

## Input Validation

- Validate at every system boundary: IPC entry (Rust side), DOM events, IDB read
- Cap any user-controlled length (paths, search terms, tag fields)
- Never trust file contents — `lofty` parses arbitrary audio
- Reject `..` and null bytes in paths

## Naming Conventions

- Variables, functions: `camelCase`
- Booleans: prefix `is`, `has`, `should`, `can`
- Types, classes, constructors: `PascalCase`
- Constants and CFG keys: `UPPER_SNAKE_CASE` (e.g., `VIRT_ROW_H`, `TAG_LOAD_CONCURRENCY`)
- Private helpers: leading `_` (e.g., `_trackIdxMap`)

## Code Smells to Avoid

- Deep nesting (>4 levels) — use early returns
- Magic numbers — promote to `CFG`
- Long functions (>50 lines) — split
- Implicit cross-module state access (CLAUDE.md §6)
- CSS mixing id and class selectors (CLAUDE.md §13)
- Inline logic in HTML (CLAUDE.md §13)

## Pre-Commit Checklist

- [ ] Functions <50 lines, files <800 lines
- [ ] No deep nesting (>4 levels)
- [ ] Errors handled at IPC boundary
- [ ] No magic numbers (use CFG)
- [ ] Immutable by default; `tracks[]` mutations followed by `rebuildTrackIdxMap()`
- [ ] No allocation inside `requestAnimationFrame`
