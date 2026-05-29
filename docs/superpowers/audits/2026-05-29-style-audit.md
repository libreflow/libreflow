# libreflow — Global Style Audit (2026-05-29)

> Scope: **audit only, no code changed.** Produced after the user request to
> "optimise le style global… audit complet de tout ce qui est moche… améliorer
> avec Lit comme base." Remediation of any finding is a separate brainstorm →
> spec → plan cycle.

---

## 1. Method

**Structural pass (objective, from code)**
- `frontend/src/design-system.css` (444 lines, token source of truth)
- `frontend/src/style.css` (7,643 lines)
- `frontend/index.html` (inline styles), plus `.style.cssText` call-sites in JS

**Visual pass (live)**
- `npm run vite` → `http://localhost:1420`, driven by the project's installed
  Chromium (offline). Seeded 200 synthetic tracks + cfg (mirrors
  `frontend/tests/visual/seed.js`). 25 screens captured under
  `docs/superpowers/audits/screens/` via `scripts/_style-audit-shots.mjs`.
- Matrix: dark + light at 1440×900 (pc) for all major views + panels;
  dark at 414×896 (mobile) for library/albums/artists.

**Caveats (read findings with these in mind)**
- **Synthetic data**: every track has `noArt:true`, so all artwork is
  placeholders — real covers would replace most of them. Placeholder *system*
  is still in scope; individual empty covers are not.
- **Accent theme = `blue`**: the seed sets `cfg.theme:'blue'`, so screenshots
  show the blue accent, not the "Electric Indigo #8B6BFF" signature that
  `design-system.css`/`CLAUDE.md` describe. See **I1**.
- **Tauri stubbed**: IPC returns empty; counts like "0 écoutes" are expected.

**Severity legend** (matches `.claude/rules/common/code-review.md`):
`CRITICAL` (block) · `HIGH` (warn) · `MEDIUM` (info) · `LOW` (note) · `INFO`.

Any remediation must preserve existing invariants: a11y (`CLAUDE.md §2#9`, AAA
contrast/focus, theme-palette tests), offline (`§15`), single-token-source
(`§17`), and Lit phasing (`§18`).

---

## 2. Structural findings

### S1 — HIGH · Parallel token systems; canonical migration stalled
`style.css` declares legacy aliases (`--sp-*`, `--r-*`, `--fs-*`, `--dur-*`) that
just forward to canonical tokens — e.g. `style.css:171` `--sp-1: var(--space-1)`,
`style.css:425` `--fs-base: var(--text-md)` — and then **uses them 1,133 times**.
`CLAUDE.md §17` says these "remain for one release cycle, then get removed; new
code MUST use canonical names." In practice `design-system.css` is the nominal
single source of truth while `style.css` runs almost entirely on the legacy
layer. This is the root debt that should be paid before any componentization.
- Evidence: `--sp-/--r-/--fs-/--dur-` → 1,133 occurrences in `style.css`.

### S2 — HIGH · `style.css` is a 7,643-line monolith
~9.5× the `§16` 800-line cap, ~100 feature sections in one file (track list, EQ,
queue, modals, welcome, playlists, genres, cinema, …). Hard to own, review, or
split work across. Recommend a module split (per-feature CSS partials, and/or
co-location into Lit component `static styles` as components are extracted).

### S3 — MEDIUM · `design-system.css` defines token scales twice, divergent values
Several scales are declared in two places; the cascade silently keeps the later
one, leaving dead/misleading declarations:
- `--space-5`: `24px` (§2bis, L111) → **overridden** to `20px` (§4, L211).
- `--radius-sm`: `8px` (§2bis, L117) → `6px` (§6, L265); `--radius-md` `12px` → `10px`.
- `--text-*`: pixel scale (§2bis, L123–129) **fully overridden** by the `clamp()`
  scale (§3, L177–183) → the pixel block is dead.

For a file whose banner is "source de vérité unique… aucune valeur hardcodée,"
duplicate-and-override is the opposite of authoritative.

### S4 — MEDIUM · Hardcoded values bypass tokens
- 36 raw hex colors in `style.css` (rule: "aucune valeur hardcodée" → all via tokens).
- Inline `.style.cssText` with hardcoded values in JS: `selection.js:120`
  (`border:1px solid rgba(255,255,255,.1)` instead of `--border-*`),
  `queue.js:368` (ghost), `ui.js:235` (ripple).

### S5 — MEDIUM · 42 inline `style="…"` attributes in `index.html`
Maintainability + CSP smell. Several are static layout and belong in CSS;
a few are legitimate dynamic placeholders (e.g. `position:relative`).

### S6 — LOW · 68 `!important` in `style.css`
Mostly light-theme overrides — a symptom of specificity battles between the two
token layers (S1) and the light-mode block. Largely reducible once tokens unify.

---

## 3. Visual findings

### V1 — HIGH · Track-row columns waste horizontal space at wide widths
On the flat track list, the title/artist sit far-left, the **album column is
stranded mid-row** with a large empty gap before it, and duration/actions sit
far-right. Weak column rhythm, poor scannability; it gets worse the wider the
window. With the queue panel open (narrower main area) the columns tighten and
read better — confirming the layout neither caps content width nor distributes
columns. Screens: `dark-pc-library`, `light-pc-library`, vs `dark-pc-queue`.

### V2 — HIGH · Album cards: run-on metadata + weak hierarchy
Card meta renders as a run-on line "**Album 0** Artiste 0 2000 5 titres" with
mixed weights/sizes and "5 titres" **wrapping to a second line**, producing
uneven card heights and an unclear title → artist → meta hierarchy. The
placeholder cover (washed disc) also dominates each card. Screens:
`dark-pc-albums`, `light-pc-albums`.

### V3 — HIGH · Inconsistent empty states (some screens are blank voids)
`Favoris` and `Récemment écoutés` render an **empty void** — just a title and
blank space — while `Playlists` and `Radio` have polished empty states
(icon + heading + subtext + CTA). The blank screens read as broken. Screens:
`dark-pc-liked`, `dark-pc-recent` vs `dark-pc-playlists`, `dark-pc-radio`.

### V4 — MEDIUM · Orphan single-letter group header in the track list
The A–Z sort shows a lone "**T**" in a tall, otherwise-empty header strip —
wasted vertical space, looks unfinished/broken. Screen: `dark-pc-library`.

### V5 — MEDIUM · Three inconsistent placeholder-artwork styles
Track rows/player use a **teal music-note** tile, album cards use a **grey disc**
icon, artist cards use a **letter avatar**. No unified placeholder system; the
teal note also clashes tonally with the accent. (Real covers replace most, but
the fallback system should be coherent.) Screens: `*-library`, `*-albums`, `*-artists`.

### V6 — MEDIUM (desktop-first) · Mobile layout not truly adaptive
At 414px with `data-platform="mobile"`, track rows and the album grid **overflow
and clip off the right edge**, and the sidebar collapses to a thin icon rail
rather than the bottom-nav the design-system describes
(`--layout-areas` mobile = `"main" "player" "nav"`). Gap between the mobile
token intent and the rendered reality. The app is desktop-first (`§1`), so this
is only relevant if mobile is a real target. Screens: `dark-mob-library`,
`dark-mob-albums`.

### V7 — LOW · EQ preset chips are dense/noisy
Many tiny wrapping pills (Flat, Bass+, Treble+, Vocal, Phonk, Trap, Drill,
Hardstyle, Electronic, Ambient, LoFi, Rap, R&B, Soul, Afrobeats, Rock…) make the
panel header busy. Screen: `dark-pc-eq`.

### V8 — LOW · Volume "100%" label floats disconnected
The percentage sits above-right of the volume slider, detached from the control.
Screen: `dark-pc-library` (player bar, top-right).

### V9 — LOW · Settings & Stats leave large empty regions
Content fills only the top-left ~half; the rest is void. Consider a centered
reading column or richer use of the space. Screens: `dark-pc-settings`, `dark-pc-stats`.

---

## 4. What's already good (keep)
- **Settings**, **Statistics**, and the **Radio**/**Playlists** empty states are
  clean and well-composed (clear hierarchy, good spacing, nice color-swatch picker).
- **Light/dark parity** is strong; the AAA contrast/focus work is visible.
- **Sidebar nav** is clean; count badges read well.

---

## 5. INFO

### I1 — Verify the shipped default accent
Screens are in the `blue` theme (seed artifact). `design-system.css`/`CLAUDE.md`
present **Electric Indigo `#8B6BFF`** as the signature accent. Confirm the
default `cfg.theme`/accent that ships matches the intended signature; the
7-swatch picker itself works well.

---

## 6. Prioritized remediation roadmap

| Prio | Items | Why first |
|---|---|---|
| **P0 — Foundation** | S1 (migrate to canonical tokens) + S3 (dedupe scales) → then S2 (split monolith) | Low visual risk, unblocks everything, and **must precede** any Lit work — components should inherit clean tokens. |
| **P1 — High-impact visual** | V1 track-row grid, V2 album cards, V3 empty states | Most visible "moche" wins; V3 is a near-broken state. |
| **P2** | V4 group header, V5 placeholder system, V6 mobile (only if mobile is a target) | Coherence + responsive correctness. |
| **P3 — Polish/cleanup** | V7 EQ chips, V8 volume label, V9 settings/stats space, S4/S5/S6 hardcode/inline/`!important` cleanup | Lower individual impact; cheap once P0 lands. |

---

## 7. "Lit comme base" — recommendation (within `§18`)

`CLAUDE.md §18` makes Lit **phased** (one spec/phase) and **permanently excludes**
`virt.js`, the Web Audio chain, `app.js` boot, canvas animations, and `ipc.js`.
So "rebuild everything on Lit" is off the table — but Lit is the right base for a
specific, high-value slice:

**Good Lit candidates (self-contained, reusable, fixes a finding):**
- `lf-empty-state` — one component, props `{icon, title, subtitle, cta}` → fixes
  **V3** everywhere (Favoris/Récents/Playlists/Radio) and guarantees consistency.
- `lf-media-card` — album/artist/playlist card → fixes **V2** (hierarchy, meta
  layout, placeholder) in one place.
- Settings rows / toggles, and the modal shell (already slated as later §18 phases).

**Not Lit:**
- The **track list** stays imperative (`virt.js` is excluded by `§18`) — V1/V4 are
  CSS-grid/layout fixes, not componentization.
- The **token debt (S1–S3)** is plain CSS and must be fixed *before* Lit, not by it.

**Recommended sequence:** P0 token unification → then introduce `lf-empty-state`
and `lf-media-card` as the next Lit phase (each its own spec per `§18`). That is
"Lit as a base" done correctly: extract the card/empty-state/modal layer onto
clean tokens, leave the perf-critical imperative core alone.

---

## 8. Next step
Choose the remediation scope (suggest **P0 first**). Each chosen batch becomes its
own brainstorm → spec → implementation-plan cycle. Repro for the screenshots:
`scripts/_style-audit-shots.mjs` (temporary; delete when no longer needed).

### 8bis. Status & deferred follow-ups (updated 2026-05-29)
- **DONE (P0 — token unification):** S3 (dead duplicate scales) + the S1 "single
  source" goal shipped on `theme-overhaul` per
  `docs/superpowers/plans/2026-05-29-token-unification.md`. The `style.css` `:root`
  token layer + `[data-theme]` map now live in `design-system.css`; the runtime
  A11Y-03 border regression (silently defeated by a relocated alias) is fixed and
  guarded by `frontend/tests/token-source.test.cjs` + an `a11y.test.cjs` regression check.
- **Deferred to separate plans:**
  - **S2** — split the ~7.6k-line `style.css` monolith into focused modules.
  - **Full canonical-name migration** (audit S1 full form) — rewrite the ~1,133
    `--sp-*/--r-*/--fs-*/--dur-*` consumers onto canonical names, then drop the aliases.
  - **Token rationalization now visible in one file** — `--text-display: 32px` vs the
    §3 `clamp()` peer, and the `--accent`/`--g` near-circular alias.
- **Visual-gate caveat:** the screenshot driver is **non-deterministic** run-to-run
  (animated canvases + `Date.now()` seed), so the zero-diff PNG gate the
  token-unification plan assumed was **not usable**. The token work was instead
  verified with a `getComputedStyle` token-value diff (dark+light, all ~559 tokens).
  Any future visual-regression gating must make the driver deterministic first
  (freeze canvas rAF, fixed seed timestamp, robust settle).
