# Common Patterns (libreflow)

## Research Before Implementation

When adding new functionality:

1. Check CLAUDE.md for an existing invariant or pattern that covers the case
2. `gh search code` for the same problem solved in other Tauri / audio apps
3. Context7 lookup for `@tauri-apps/api`, `lofty`, `idb`, `notify`, etc. — confirm current API
4. crates.io / npm — adopt a maintained library if it stays offline
5. Build inside the existing repo structure (`frontend/src/` ESM modules, `src-tauri/src/` Rust modules)

## Repo Patterns

### IDB Store Pattern

All persistence goes through the `idb` wrapper, never direct IndexedDB:

- `dget(key)` — single record (cfg)
- `dall(store)` — full-store read at boot (tracks, playlists, playlog)
- `dput(store, obj)` — upsert, ALWAYS debounced
- Stores: `tracks`, `playlists`, `playlog`, `cfg` — one writer per logical unit

### IPC Contract Pattern

Tauri commands have stable contracts (CLAUDE.md §4):

- Input typed and validated in Rust before any FS or system call
- Output a typed struct or array; covers absent fields with `Option`
- Errors as `Result<T, String>` with documented codes (permission denied, format unsupported, etc.)
- All JS callers go through `ipc.js` with a timeout
- Wait for `__TAURI__` before the first `invoke`

### Derived State Pattern

Single source of truth + projection:

- `tracks[]` — runtime source of truth, mutable
- `_trackIdxMap` — derived cache, rebuilt via `rebuildTrackIdxMap()` after every mutation
- `cfg` — persisted state, debounced write
- UI components read from these; they never duplicate or cache locally

### Async Hydration Pattern

Boot fast with skeleton, hydrate detail in the background:

1. Boot reads minimal record from IDB (path + title)
2. `loadTagsBg()` batches IPC `read_tags` calls at concurrency 4
3. UI updates incrementally as tags resolve
4. Per-track failure does not stop the batch

### Audio Param Pattern

Web Audio params must transition smoothly:

```
WRONG:  gainNode.gain.value = 0.8
RIGHT:  gainNode.gain.setTargetAtTime(0.8, ctx.currentTime, 0.02)
```

Direct assignment causes zipper noise (CLAUDE.md §9).

### Virtual Scroll Pattern

For any list > 1k items (CLAUDE.md §10):

- `CFG.VIRT_ROW_H` and `CFG.VIRT_GRP_H` are the only allowed row/group heights
- Binary search maps scroll offset → start index (no linear scan)
- ±8 row buffer above/below viewport
- Zero allocations in the render loop
- Any change to constants → adapt `virt.js` mapping in the same commit

### Crossfade Pattern

Crossfade preserves volume — no reset (CLAUDE.md §9):

- New source ramps in via `setTargetAtTime`
- Old source ramps out concurrently
- The DOM `#vol` slider remains the single source of `audio.volume`
