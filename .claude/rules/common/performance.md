# Performance (libreflow)

## Runtime Performance (Application)

### Audio Pipeline

- Chain: Source → EQ → Analyser → Output (do not reorder)
- All param transitions via `setTargetAtTime` (no zipper noise)
- Crossfade preserves volume — no reset (CLAUDE.md §9)
- Analyser limited to 30s windows max
- ReplayGain applied at source, not output

### Virtual Scroll

- Mandatory for lists > 1k items
- Constants in `CFG.VIRT_ROW_H` and `CFG.VIRT_GRP_H`; never duplicated in render code
- Binary search for scroll → index mapping
- ±8 row buffer above/below viewport
- Zero allocations inside the render loop

### IDB

- ALL writes debounced (no per-keystroke commits)
- Group multi-field updates into one transaction
- Tag hydration batched at `TAG_LOAD_CONCURRENCY = 4`
- Boot uses `Promise.all([dall('playlists'), dall('playlog'), dall('tracks')])` for 3x speedup

### Rendering

- No full rerender — virtual scroll + targeted updates only
- Artwork loads async post-render (never blocks first paint)
- DOM mutations batched per rAF tick

### Anti-Patterns

- Allocation inside `requestAnimationFrame`
- Synchronous IDB write
- `audio.volume = N` direct assignment (always read from `#vol`)
- Hardcoded virtual scroll constants in render code
- Linear scan over `tracks[]` (use `_trackIdxMap`)
- Duplicating state across modules

## Build & Dev Performance

### Cargo

- Release profile: `opt-level=3, lto=true, codegen-units=1, strip=true` (already set in `Cargo.toml`)
- Dev profile: `incremental=true` (already set)
- `cargo test` runs proptest fuzz cases — keep it fast
- `cargo build --release` for benchmarking

### Vite / Tauri

- Multi-entry config (main + mini player)
- Dev: `npm run dev` (delegates to `tauri dev`)
- Prod: `npm run build`

## Benchmarks

- `npm run bench` runs `frontend/tests/bench.cjs` (synthetic 50k-track scroll/render)
- Treat any bench regression > 5% as HIGH severity
- Add a bench case before introducing perf-sensitive code

## Tooling Performance (Claude Code)

### Model Selection

- **Haiku 4.5** — frequent lightweight tasks (one-off reviews, single-file edits)
- **Sonnet 4.6** — main development work, multi-file changes
- **Opus 4.5** — architectural decisions, complex Rust borrow-checker debugging

### Context Window

- Keep 20% headroom for: large refactors, multi-file features, deep debugging
- Single-file edits and doc updates can run closer to the limit

### Extended Thinking

- Enabled by default (up to 31,999 tokens)
- Toggle: Alt+T (Windows)
- Budget cap: `MAX_THINKING_TOKENS` env var
