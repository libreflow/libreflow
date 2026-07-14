# Flagship polish pass — design spec

Date: 2026-07-14
Status: Approved (pending spec review)

## Context

A design audit (conducted in-conversation, casquette "designer Spotify/Deezer")
identified concrete gaps between LibreFlow's current UI and flagship
streaming-app polish. The underlying design-token engineering is already
strong (centralized tokens, ambient color extraction via `artcolor.js`,
custom sliders/scrollbars, AAA focus rings) — the gaps are in secondary
moments: loading, empty, and first-run states, plus tactile feedback
consistency.

One item from the original audit — extending `--art-color` (ambient
color-from-artwork) to more surfaces — turned out to already be implemented
comprehensively (titlebar, sidebar tint, Now Playing hero, EQ panel, cinema
mode, mini-player, all wired via `artcolor.js` + 18+ usage sites in
`style.css`). Navigation/active-row elements intentionally keep the static
`--g` (Electric Indigo) accent rather than the dynamic art color, which is
correct — nav identity should not shift per track. No work item results from
this; it's dropped from scope.

## Scope

Four independent, additive UI polish items. Each reuses existing design
tokens (`--motion-*`, `--accent-glow`, `--accent-subtle`, `--ease-standard`,
`--spring-soft`) and the existing SVG icon language (stroke-width 1.7). No
new dependencies, no new Lit components, no architectural changes.

1. **Skeleton loading** — shimmer placeholder for artwork while tag
   hydration (`loadTagsBg`) is in flight.
2. **Welcome screen redesign** — replace the 4-feature landing-page grid
   with a hero-centric first-run screen.
3. **Empty states** — a single reusable `.empty-state` pattern applied to
   4 contexts (search no-results, empty playlist, empty queue, no
   favorites).
4. **Active/press states audit** — ensure every high-frequency interactive
   control (`.pc`, `.pcplay`, `.pl-lk`, `.ni`, `.sel-action`) has a tactile
   `:active` transform, not just a color change.

Out of scope (deferred to a future, separately-brainstormed project):
editorial/asymmetric card layouts for library/radio views.

## 1. Skeleton loading

### Problem

A track's title (derived from filename) renders immediately at scan time,
but `t.art` and extended tags (album, genre) resolve asynchronously via
`loadTagsBg` (batched at `TAG_LOAD_CONCURRENCY = 4`, CLAUDE.md §5). Until
`t.metaDone` is true, artwork slots show a static music-note icon with no
loading affordance — reads as "stuck", not "loading".

### Design

- New CSS shimmer keyframe (diagonal gradient sweep, `background-position`
  animation) gated by a `.art-loading` class, applied to:
  - `.tart` (track-row thumbnail, list view)
  - `#pl-art` (player bar artwork)
  - playlist/album card covers awaiting a cover image
- Toggled by existing render paths: the class is added when
  `!t.metaDone`/no cover yet, removed (replaced by the existing
  `.art-loaded` fade-in class) once `t.art` resolves — no new state
  variable, reuses `metaDone`.
- Timing: the shimmer sweep loops continuously (independent cycle,
  ~1.4s) while `!t.metaDone`; `--motion-slow` (320ms) governs only the
  handoff — the crossfade from shimmer to the real image once it arrives,
  reusing the existing `.art-loaded` fade-in transition.
- `prefers-reduced-motion` / `data-motion="reduce"`: shimmer animation
  disabled, falls back to a static dim `--bg-elevated` block (no motion,
  same information: "this is a placeholder").
- No IPC or state-shape changes. Pure CSS + one class toggle at existing
  render call sites (`renderer.js` / `renderer-grids.js` track-row render
  functions).

### Files touched (implementation-phase estimate)

- `frontend/src/style.css` (new `.art-loading` rules + shimmer keyframes)
- `frontend/src/renderer.js`, `frontend/src/renderer-grids.js` (class
  toggle at render time, reading `t.metaDone`)

## 2. Welcome screen redesign

### Problem

The current `#vw` welcome view (`frontend/index.html`) is a 4-card icon
grid with title + description per card — a generic SaaS-landing-page
pattern, not an app-native first-run moment.

### Design

- Keep both existing CTAs (`Choisir mon dossier Musique`,
  `Importer une playlist M3U`) and the drag-drop hint — these are load-
  bearing, not cosmetic.
- Replace the 4-card grid with:
  - A large centered hero icon (reuse the existing folder/scan SVG,
    scaled up) sitting inside a soft pulsing halo using
    `--accent-glow` (already defined, currently used for playback glow
    effects) — subtle, `prefers-reduced-motion`-aware (pulse disabled →
    static halo).
  - H1 + subtitle (unchanged copy).
  - The 4 feature blurbs collapse into a single compact row below the
    CTAs: icon (16px, existing SVGs) + short label only (no long
    description) — e.g. "Scan & tags auto · Playlists & Smart Radio ·
    EQ 10 bandes · Stats". Information preserved, no longer the visual
    focus.
- No new SVG assets, no new color tokens. Pure HTML restructure in
  `frontend/index.html` (`#vw` block) + CSS in `style.css` (`.wl`, `.wf*`
  rule set gets a corresponding `.wl-hero`/`.wf-row` treatment,
  superseding — not duplicating — the current `.wfeats` grid rules).

## 3. Empty states

### Problem

Only ~15 `empty-state`-adjacent references exist across `style.css` for an
app with several list-like contexts. Where they exist they're plain text
(`.empty-h` / `.empty-s`), no visual weight, no context-specific action.

### Design

One reusable pattern, one CSS block (`.empty-state`, extending the existing
`.empty-h`/`.empty-s` classes rather than replacing them):

```
.empty-state
  .empty-ico     ← existing SVG, 48-64px, sits in a soft --accent-subtle
                    circular halo (radius-pill token)
  .empty-h       ← short title (existing class, reused)
  .empty-s       ← one-line subtext (existing class, reused)
  [.empty-cta]   ← optional button, only rendered when an action exists
```

Applied to 4 concrete contexts, each with its own icon/copy but the same
markup skeleton:

| Context | Icon | Copy direction | CTA |
|---|---|---|---|
| Search, no results | search glass (existing) | "Aucun résultat pour «…»" | "Effacer la recherche" (reuses existing `clear-search` action) |
| Playlist vide | playlist icon (existing) | "Cette playlist est vide" | "Ajouter des titres" (opens library selection, existing flow) |
| Queue vide | queue icon (existing) | "Aucun titre en file" | none (informational) |
| Aucun favori | heart icon (existing) | "Pas encore de favoris" | none (informational) |

No new SVGs — every icon already exists in `index.html`'s inline SVG set
or the nav icon set. No new IPC/state; purely a render-time conditional
(render the empty-state block when the underlying list/array is empty,
matching each view's existing "is this empty?" check).

### Files touched (implementation-phase estimate)

- `frontend/src/style.css` (`.empty-state`, `.empty-ico` rules)
- `frontend/src/search.js`, `frontend/src/playlists.js`,
  `frontend/src/renderer.js` (queue), wherever "liked" filtering renders —
  each adds the empty-state render branch for its own list.

## 4. Active/press states audit

### Problem

241 `:hover` / 53 `:active` rules exist in `style.css` — reasonable
coverage, but not verified per-control. High-frequency playback controls
are the least forgiving surface for a "flat click" (color-only) feedback
because they're the most-clicked elements in the whole app.

### Design

An audit-and-patch pass, not a new pattern: for each of `.pc` (prev/
shuffle/repeat), `.pcplay` (play/pause), `.pl-lk` (like), `.ni` (sidebar
nav item), `.sel-action` (batch selection bar buttons), confirm/add:

```css
.control:active {
  transform: scale(0.96);
  transition-property: transform, background-color, color;
  transition-duration: var(--motion-fast); /* 120ms */
}
```

- Reuses the existing `--motion-fast` token and the `scale(0.96)`
  convention already used elsewhere (e.g. `.vslider:hover::-webkit-slider-
  thumb { transform: scale(1.25) }` shows the codebase already presses
  this pattern for sliders — extending it to buttons is consistent, not
  novel).
- `prefers-reduced-motion`: scale transform suppressed (color/background
  change only), consistent with existing reduced-motion handling
  elsewhere in `style.css`.
- No `transition: all` (already a house rule — confirmed zero occurrences
  in current `style.css`); explicit `transition-property` per the
  make-interfaces-feel-better guidance.

### Files touched (implementation-phase estimate)

- `frontend/src/style.css` only — no JS changes, no new classes (uses
  existing selectors `.pc`, `.pcplay`, `.pl-lk`, `.ni`, `.sel-action`).

## Testing

- No new runtime logic beyond class toggles driven by existing state
  (`t.metaDone`, empty-array checks) — covered by manual smoke per
  CLAUDE.md workflow (`npm run dev`, load a real folder, watch tag
  hydration, trigger each empty state, click through playback controls).
- `frontend/tests/a11y.test.cjs` / `theme-palette.test.cjs`: re-run to
  confirm no contrast regression from new `--accent-subtle`/
  `--accent-glow` usage on existing AA/AAA-audited surfaces.
- `npm run bench`: re-run to confirm the shimmer animation (item 1) adds
  no allocation inside the virtual-scroll render loop (CLAUDE.md §10) —
  it's a CSS-only class toggle, no JS animation loop, so no regression
  expected, but bench confirms.

## Flagship quality bar checklist (per agents.md)

- Motion: shimmer + press states use `--motion-*` tokens, transform/
  background only, `prefers-reduced-motion` handled — item 1 and 4.
- Interaction states: item 4 is exactly this line item.
- Visual consistency: all four items reuse existing tokens exclusively —
  zero new magic values.
- Empty/loading states: items 1 and 3 directly close this gate.
- Accessibility: empty-state CTAs get proper `aria-label`/button
  semantics; skeleton placeholders get `aria-hidden` (decorative,
  screen readers should not announce shimmering placeholders — the real
  content announcement happens once it's ready, consistent with existing
  `aria-live` regions).

## Review routing (per CLAUDE.md §11 / agents.md)

- **design-system-engineer** — token reuse audit (no new tokens
  introduced).
- **accessibility-specialist** — empty-state semantics, reduced-motion
  fallback, focus order unaffected by welcome-screen restructure.
- **code-reviewer** — general JS/CSS review.
- **make-interfaces-feel-better** skill — final polish pass before calling
  each item done.
