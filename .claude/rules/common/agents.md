# Agent Orchestration

## Available Agents

Loaded via the ECC plugin (cache path managed automatically). Relevant to libreflow:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| architect | System design | Tauri/audio/virt architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing JS/CSS |
| rust-reviewer | Rust code review | After writing Tauri commands or crate logic |
| security-reviewer | Security analysis | IPC surface changes, FS access, plugin updates |
| build-error-resolver | Fix build errors | `cargo` or `vite` build failures |
| rust-build-resolver | Rust-specific build/borrow errors | cargo build / borrow checker |
| refactor-cleaner | Dead code cleanup | Maintenance passes |
| doc-updater | Documentation | Updating CLAUDE.md sections, READMEs |
| performance-optimizer | Perf profiling, bottleneck removal | `virt.js`, audio pipeline, bundle size, bench regressions |
| accessibility-specialist (maestro) | WCAG 2.2 AA/AAA audit | Any new interactive control, modal, or list |
| design-system-engineer (maestro) | Token/theming/CSS architecture consistency | New components, `design-system.css` or `style.css` changes |
| make-interfaces-feel-better (skill) | Spacing, motion, hit-area, state polish | Any visible UI change, before calling it done |
| frontend-design (skill) | Aesthetic direction, typography, visual identity | New screens/views, visual redesigns |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent
5. UI/visual/animation change - Use **make-interfaces-feel-better** + **accessibility-specialist**, and **performance-optimizer** if it touches `virt.js`, `cinema.js`, `viz.js`, or `motion.js` (see Flagship Quality Bar below)

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker

## Flagship Quality Bar (Spotify / Deezer / Apple Music standard)

libreflow is a music player; the reference point for "done" is not "it works" but "it feels like a
flagship streaming app." Every UI/UX-touching change is measured against these criteria, not just
correctness. This is what elevates a change from CLAUDE.md-compliant to production-grade.

| Criterion | Concrete bar | Enforced by | Verified against |
|---|---|---|---|
| Motion quality | Transitions use `--motion-*` tokens (150–400ms), transform/opacity only (no layout thrash), 60fps under DevTools perf trace, respects `prefers-reduced-motion` | make-interfaces-feel-better, performance-optimizer | `cinema.js`, `viz.js`, `motion.js`, nav wipes |
| Perceived performance | Input → visible feedback <100ms; skeleton/optimistic state for anything IPC/IDB-bound; scroll never drops frames on a 50k-track library | performance-optimizer | `frontend/tests/bench.cjs`, virtual scroll (§10) |
| Interaction states | Every interactive control has distinct hover/active/focus-visible/disabled states; press feedback feels tactile, not just a color swap | make-interfaces-feel-better, accessibility-specialist | `style.css`, Lit component `static styles` |
| Visual consistency | One typographic scale, one spacing grid (`--space-*`), one radius/shadow system — no one-off magic values | design-system-engineer | `design-system.css` single-source rule (§17) |
| Audio fidelity | Crossfade/EQ changes are inaudible as edits — no zipper noise, no volume jump, ReplayGain-normalized loudness across tracks | architect, code-reviewer (audio focus) | CLAUDE.md §9, §2.5 |
| Empty / loading / error states | No view is ever a blank white/black rectangle — every list, panel, and modal defines its empty, loading (skeleton), and error/recovery state | make-interfaces-feel-better | New/changed views in `frontend/src/components/`, `playlists.js`, `queue.js` |
| Accessibility | WCAG 2.2 AA minimum, AAA where CLAUDE.md §2.9 already commits to it (contrast, focus ring, target size, reduced motion) | accessibility-specialist | `frontend/tests/a11y.test.cjs`, `theme-palette.test.cjs` |

**Gate**: a UI/UX change is not "done" until it has been reviewed against this table, not merely
against the CLAUDE.md §19 invariant checklist. Invariant compliance is necessary but not sufficient
for flagship-tier polish.
