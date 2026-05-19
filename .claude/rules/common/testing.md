# Testing (libreflow)

## Test Runners

| Layer | Command | What it covers |
|---|---|---|
| Frontend (Vanilla JS) | `npm test` | `node frontend/tests/core.test.cjs` — unit tests for core helpers |
| Frontend (perf) | `npm run bench` | `node frontend/tests/bench.cjs` — synthetic 50k-track scroll/render |
| Rust crate | `cargo test` | Unit + integration + proptest fuzz cases |
| Rust coverage | `cargo llvm-cov` | Run periodically; not gating |
| SBOM | `npm run sbom` | Generates CycloneDX for npm + cargo |

## Target Coverage

- **Rust**: 80%+ on logic modules; proptest covers edge-of-spec inputs
- **JS**: practical coverage over numeric target — critical paths are virtual scroll, IDB serialization, EQ math, `_trackIdxMap` rebuild

## TDD Loop

1. Write failing test (RED)
2. `cargo test` / `npm test` → confirm FAIL
3. Minimal implementation (GREEN)
4. Re-run → confirm PASS
5. Refactor without breaking the suite
6. Rust input-handling code → add a `proptest!` case before merging

## E2E

- No Playwright wired up yet
- `npm run bench` exercises a 50k-track render path end-to-end (synthetic)
- Manual smoke required before release:
  - `npm run dev` → load a real folder of 1k+ tracks
  - Seek, EQ change, crossfade, playlist switch — listen for glitches
  - Watch-folder add/remove a file → confirm IDB sync

## Test Structure (AAA)

```js
// Arrange
const tracks = makeTracks(3)
tracks.splice(1, 1)

// Act
rebuildTrackIdxMap()

// Assert
assert.deepStrictEqual(_trackIdxMap[tracks[0].id], 0)
assert.deepStrictEqual(_trackIdxMap[tracks[1].id], 1)
```

## Test Naming

```js
test('rebuildTrackIdxMap reflects splice removal')
test('debounced IDB write coalesces 100 rapid calls into 1')
test('virtual scroll buffer keeps ±8 rows alive on fast scroll')
test('audio.volume reads from #vol DOM, never internal state')
test('radioRefillQueue runs before updateBar on track change')
```

## What to Test Hard (CLAUDE.md §2 invariants)

- `_trackIdxMap` matches `tracks[]` projection after any mutation
- `audio.volume` == `#vol` slider value at all times
- IDB writes always debounced
- `radioRefillQueue()` called BEFORE bar update tied to the new track
- No external network calls
- Virtual scroll respects `CFG.VIRT_ROW_H` / `CFG.VIRT_GRP_H` exactly

## Troubleshooting

1. Reset IDB state between tests — `indexedDB.deleteDatabase(NAME)` in setup
2. Tauri IPC mocks must match the real signature in `src-tauri/`
3. Fix the implementation, not the test — unless the test contradicts CLAUDE.md (then the test wins)
