# Development Workflow

> Extends [common/git-workflow.md](./git-workflow.md). Covers planning, TDD, review before the git step.

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **Walk CLAUDE.md first** — the libreflow invariants (§2, §9, §10) often answer the question
   - **GitHub code search next** — `gh search code "tauri" "lofty"` for prior art on similar audio/IPC patterns
   - **Context7 for library APIs** — Tauri 2 (`@tauri-apps/api`), `lofty`, `rayon`, `notify`, `idb` — version-specific
   - **crates.io and npm** — prefer a maintained crate/package over hand-rolled code, provided it stays offline
   - **No external network deps** — anything that phones home is auto-rejected (CLAUDE.md §15)

1. **Plan First**
   - Use **planner** agent for non-trivial features
   - Identify which invariants the change touches (§2 list)
   - Identify the high-risk zone (§11): virt.js, audio pipeline, tracks mutation, cinema.js, ipc.js
   - Break into phases; one phase = one verifiable checkpoint

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Rust: write a proptest case for any new input-handling code; `cargo test` red → green
   - JS: add to `frontend/tests/core.test.cjs`; `npm test` red → green
   - Bench impact suspected? Add to `frontend/tests/bench.cjs` and run `npm run bench`

3. **Code Review**
   - **rust-reviewer** for crate / Tauri command changes
   - **code-reviewer** for JS / CSS
   - **security-reviewer** for any IPC surface change, FS scope change, plugin update
   - Walk CLAUDE.md §19 auto-verification checklist

4. **Commit**
   - Conventional commits enforced by `commitlint.config.js`
   - See [git-workflow.md](./git-workflow.md)

5. **Pre-Review Checks**
   - `cargo build --release` succeeds
   - `cargo test` green (proptest included)
   - `npm test` green
   - `npm run bench` not regressed beyond baseline
   - Manual smoke: `npm run dev` → load a real folder → seek / EQ / crossfade
