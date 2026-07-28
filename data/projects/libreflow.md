# libreflow — Project Context

## Summary
Offline desktop music player. Tauri 2 + Vanilla JS + Lit 3. No network. Single user.

## Stack
- Frontend: Vanilla ESM JS, Lit 3.x Web Components, Vite 8
- Backend: Rust (Tauri 2, lofty, notify)
- Persistence: IndexedDB via `idb`
- Tests: `npm test` (vanilla assert), `cargo test` (proptest), `npm run bench`

## Current Branch
master

## Active Agents
- @js-dev — frontend JS / CSS / Lit work
- @rust-dev — Tauri commands, Rust crates
- @audio-eng — Web Audio pipeline, EQ, crossfade
- @perf-eng — virtual scroll, IDB throughput, bench
- @reviewer — code review, CLAUDE.md §19 checklist
- @writer — specs, plans, ADRs, docs
- @design-eng — premium dark UI, design token coherence

## Critical Invariants (summary)
See CLAUDE.md §2 for full list. Top 3:
1. `rebuildTrackIdxMap()` after every `tracks[]` mutation
2. `audio.volume` from `#vol` DOM only — never assigned literally
3. No external network calls — offline app

## Key Files
- `frontend/src/design-system.css` — single source for all CSS tokens
- `frontend/src/app.js` — boot sequence, cross-module wiring
- `frontend/src/virt.js` — virtual scroll engine (perf-critical)
- `src-tauri/src/` — Rust commands and IPC handlers

## Recent History
- GAN design iterations (001–004): dynamic hue lighting, self-hosted fonts, palette system
- Full UI audit and deep security review
- Lit Web Components phase 0 (lf-toast-stack)
