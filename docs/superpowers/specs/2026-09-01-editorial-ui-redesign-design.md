# Editorial UI redesign — design spec

Date: 2026-09-01
Status: Approved (pending spec review)

## Context

A full UI audit (conducted in-conversation) confirmed that LibreFlow's
design-token *engine* is mature: `design-system.css` is an enforced single
source of truth (`token-source.test.cjs`), the dark/light axis and the
8-slot `[data-theme]` accent map are stable, dynamic album-art accent
(`artcolor.js` → `--art-color` / `--g-rgb`) is wired to ~18 surfaces, and a
strict WCAG 2.1 AA + 2.2 AA + selective AAA test suite
(`a11y.test.cjs`, `theme-palette.test.cjs`) locks contrast, target size,
focus appearance and landmarks.

Thirteen prior design specs already chased "Spotify/Deezer/Apple Music"
*parity* through incremental polish. This project is different in kind: a
**new visual identity** — new signature colour, a single typeface, and an
editorial component language — applied to the surfaces the user sees every
day. It is deliberately *not* a from-scratch token rebuild; the token
architecture is kept, only values and component-level token consumption
change.

The user's brief (verbatim): *"Audit toute l'UI et avec les bonnes
pratiques il me faut une meilleure UI d'application similaire / inspiré de
Spotify sans reprendre leurs couleur, juste la simplicité et le design
moderne des éléments."*

### Direction decisions (locked in brainstorming)

| Axis | Decision |
|---|---|
| Deliverable | This spec + an implementation plan. No CSS/token change lands before spec review. |
| Ambition | New visual identity (new signature colour, new component language, single typeface). |
| Colour | New signature colour: **warm brass amber** (replaces Electric Indigo as the default accent). |
| Personality | **Editorial / airy** — generous whitespace, assertive display type, strong hierarchy, sparse accent, minimal borders. Reference feel: Apple Music / print magazine. Dark-first, very dark ground kept. |
| Typography | **One typeface everywhere** — Hanken Grotesk, played on 3 weights. |
| Scope | **Daily-core surfaces only**: sidebar, virtualised track list, player bar, album/artist/playlist grids, search, view header. |

## Scope

Six phased changes, each a verifiable checkpoint. Every change reuses the
existing token *names* and the existing SVG icon language (stroke-width
1.7); values change, structure does not. No new dependencies except a font
swap (vendored `.woff2` files, not a package). No new Lit components. No JS
logic changes. No IPC / audio-chain changes.

1. **Foundations** — font swap + colour/typography/space/shadow token
   values in `design-system.css`; update the two a11y/theme test suites'
   expected values; `npm test` green.
2. **Shell** — `#app` layout, sidebar, view header, search.
3. **Track list** — row grid, density steps, playing/hover/selected states.
4. **Player bar** — three zones, amber play disc, progress, neutral volume.
5. **Grids** — albums / artists / playlists cards.
6. **Polish + verification** — `npm test`, `npm run bench` (not regressed),
   manual smoke.

### Out of scope (deferred, separately brainstormed later)

- Cinema mode, Now Playing view, EQ panel, queue panel, statistics, radio
  view, settings panels, all modals, context menu, toasts, mini-player.
  These inherit the new tokens by cascade but get **no bespoke redraw** this
  round.
- Removal of legacy alias tokens (`--sp-*`, `--r-*`, `--fs-*`, `--dur-*`).
  They stay recabled onto the canonical scales, as today.
- Any restructuring of `design-system.css` into new layers.
- `style.css` global magic-number hunt (only literals *inside refactored
  sections* get tokenised in passing).

## 1. Foundations

### 1.1 Signature colour — brass amber

`--accent` moves from Electric Indigo `#8B6BFF` to a warm brass amber
(target `#E7A33D`, final value tuned during implementation to satisfy the
contrast gates below).

Rationale: non-Spotify, editorial/premium, warm — creates tension with the
cool-neutral shell; clears AAA (≥7:1) at small sizes on the near-black
ground so it can carry the focus ring, playing state, primary action and
selection without a contrast waiver.

Derived tokens recomputed from the new hue:

- `--accent-glow` (currently `rgba(139,107,255,0.45)`) → amber at same alpha.
- `--accent-subtle` (`rgba(139,107,255,0.12)` dark / `0.14` light) → amber.
- `--g` / `--g-rgb` / `--gd` / `--gg` operational aliases follow (`--g-rgb`
  becomes the amber triplet). **`settings.js` must not inline-set `--g-rgb`**
  — the CSS map remains the only writer (guarded by `theme-palette.test.cjs`).
- New alias `--accent-selected` — amber at ~12% alpha, for the multi-select
  row fill. May reuse `--accent-subtle` if the value matches; otherwise a
  distinct token in `design-system.css`.

### 1.2 Semantic-collision fix — warning token

`--amber #f59e0b` / `--amber-rgb 245,158,11` (the "warning" semantic) would
be visually confusable with the new signature amber. Resolution: reposition
the warning semantic to a distinct yellow-green (target `#C7B037`-ish, tuned
for ≥4.5:1 on `--bg-surface`). `--state-error #FF5A5F` (coral) and
`--like-active #e0304a` (crimson) stay clearly separated from the signature
amber and are unchanged.

Because the a11y suite already forbids colour-only status signalling
(icon + text required), the practical risk of the repositioning is low; the
change is mostly about not having two ambers that read as the same brand
mark.

### 1.3 Neutral ramp — cool micro-tint

Keep luminance essentially unchanged (shifts below are ≤1–4 points per
channel, imperceptible in isolation) and preserve every inter-step ΔRGB
gate. The tests currently lock `--bg-base #030303`, `--bg-surface #121214`,
`--bg-elevated #1C1C20`, `--bg-raised #1C1C20` as exact hexes and require
ΔRGB ≥ 8 base→surface and surface→elevated plus `--bg-raised ==
--bg-elevated` — the exact-hex assertions get updated (see Testing impact),
the ΔRGB and equality gates must keep passing. Inject a **cool slate
micro-tint** (a few points more blue than red on the elevated surfaces) so
the shell has character and the warm accent pops:

| Token | Current | Target (tuned in impl) |
|---|---|---|
| `--bg-base` | `#030303` | `#030304` |
| `--bg-surface` | `#121214` | `#111318` |
| `--bg-elevated` | `#1C1C20` | `#1A1B22` |
| `--bg-raised` | `#1C1C20` | `#1A1B22` (stays == elevated) |
| `--bg-sunken` | `#000000` | `#000000` |

Exact hexes are chosen in implementation to keep: ΔRGB gates, `--bg-raised
== --bg-elevated`, and the AAA 7:1 text checks below. The light-mode
chromatic block (`html[data-mode="light"]`) gets the same role treatment
with a matching cool tint on its surfaces.

### 1.4 Text tiers

Values re-verified, not restructured. The suite requires `--text-primary`,
`--text-secondary`, `--text-muted` (`--t` / `--t2` / `--t3`) to hit **7:1
on `--bg` in both themes**, with the scoped 2026-07 exception on
`--bg-elevated` / `--bg-raised` where `--text-muted` / `--t3` and
accent-as-text may drop to AA. New neutral hexes must preserve this. `--t4`
stays decorative/placeholder only (contrast-exempt).

### 1.5 Typography — Hanken Grotesk, one family

- Fonts are **vendored `.woff2` files**, not an npm dep:
  `frontend/public/fonts/` currently holds `syne-{400,500,600,700,800}.woff2`
  and `dm-sans-{300,300i,400,500}.woff2` (9 files), referenced as
  `/fonts/…` by the `@font-face` block in `style.css` l.2–10.
- Add `hanken-grotesk-{400,500,700}.woff2` to `frontend/public/fonts/`
  (source: the Hanken Grotesk OFL release, subset to latin), delete the 9
  Syne + DM Sans files, rewrite the `@font-face` block. Net font-file count
  drops (9 → 3). Offline guarantee intact — no CDN, no runtime fetch.
- CLAUDE.md §12 wording ("self-hosted via `@fontsource`") is a convention
  label; the actual mechanism is vendored files under `public/fonts/`. Keep
  that mechanism; `doc-updater` may refresh the §12 wording afterwards.
- `--font-display`, `--font-body`, `--font` all resolve to
  `'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`.
- Weights: `--fw-medium 500`, `--fw-bold 700` unchanged; titling uses 700,
  body 400, labels/nav/buttons 500.
- Drop the uppercase + `letter-spacing: .06em` treatment on labels
  (`--ls-label`): labels become sentence-case, 500, `--ls-reset`. The
  `--ls-label` token stays defined (legacy consumers) but core components
  stop using it.

Fluid scale — keep `clamp()` and the 7 semantic steps, widen the top:

| Token | Current | Target |
|---|---|---|
| `--text-xs` | `clamp(10px, 1vw, 12px)` | `clamp(11px, 1vw, 12px)` |
| `--text-sm` | `clamp(12px, 1.2vw, 14px)` | unchanged |
| `--text-base` | `clamp(13px, 1.4vw, 15px)` | unchanged |
| `--text-md` | `clamp(15px, 1.6vw, 18px)` | unchanged |
| `--text-lg` | `clamp(18px, 2vw, 24px)` | `clamp(19px, 2.1vw, 26px)` |
| `--text-xl` | `clamp(22px, 2.8vw, 32px)` | `clamp(24px, 3vw, 38px)` |
| `--text-display` | `clamp(28px, 4vw, 48px)` | `clamp(34px, 5vw, 60px)` |

Legacy `--fs-*` aliases stay recabled onto these 7 steps; their target
values follow the new scale. Line-height anchors (`--lh-tight 1.2` …) and
`--ls-display -0.02em` unchanged; titling uses `--lh-tight` +
`--ls-display`.

### 1.6 Spacing

Add `--space-8: 64px` for view-top breathing room. `--space-1…7`
(4/8/12/16/20/24/48) unchanged. Legacy `--sp-*` stays recabled.

Rhythm applied by later phases:

- `#main` / view-header top padding → `--space-8` (was ~24).
- Track-list default row height `--tr-h` → **64px**; zoom steps become
  Compact 48 / Comfortable 64 / Spacious 76 (`--tart-size` follows:
  32 / 40 / 56).
- Album grid gutter `--space-5` (20) → `--space-6` (24).

### 1.7 Elevation & shadows

Flat-in-flow doctrine kept verbatim (`--elev-1…4` transparent). Soften
floating shadows:

| Token | Current | Target |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,.25)` | `0 1px 3px rgba(0,0,0,.20)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,.30)` | `0 4px 16px rgba(0,0,0,.24)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,.35)` | `0 8px 28px rgba(0,0,0,.30)` |
| `--shadow-xl` | `0 16px 48px rgba(0,0,0,.45)` | `0 16px 52px rgba(0,0,0,.40)` |

Aliases (`--shadow-pop → md`, etc.) unchanged.

### 1.8 Motion

Durations unchanged (`--motion-press 70`, `--motion-fast 120`,
`--motion-base 200`, `--motion-slow 320`). Restrict the spring:
`--ease-spring` is used only by the Now Playing artwork transition and the
"like" heart pop; every other transition in refactored sections uses
`--ease-standard`. `data-motion="reduce"` zeroing is untouched (no
`@media (prefers-reduced-motion)` blocks — enforced).

### 1.9 `[data-theme]` map

The default slot (currently `indigo`, unlisted in the settings swatches)
becomes **`amber`** and matches the new `:root` `--accent`. The other 7
swatches (green, blue, purple, red, orange, pink, cyan) keep their hexes.
Every block still: sets `--g` / `--g-rgb` / `--gd` / `--gg`; has a `--g-rgb`
triplet equal to its own `--g` hex (test-checked); clears ≥4.5:1 on
`#121214` (test-checked, iterated over all blocks). Amber passes
comfortably.

## 2. Shell

### 2.1 Sidebar (`#sb`, `.ni`, `#ni-indicator`)

- Ground `--bg-surface`, **no right border** — the value change against
  `#main` is the separation.
- Nav items: icon + label, 500, `--text-sm`. Active = `--text-primary`
  label + `#ni-indicator` (vertical bar) in `--accent`; **no coloured
  pill / no item background**. Inactive = `--text-secondary`. Hover =
  `--text-primary` + `--row-hover` tint.
- `#ni-indicator` width ~3px → **2px**, `--accent`, `--ease-standard`.
  Stays `aria-hidden`, no `tabindex` (test-locked).
- Section headers ("Ma bibliothèque", "Playlists"): `--text-xs`, 500,
  sentence case, `--text-muted`; `--space-6` above. No uppercase / no wide
  tracking.
- `--sidebar-width 260` and `#sb-resize` (role=separator, keyboard + double
  click) unchanged.

### 2.2 View header (`.vh`, `.vh-title`, `.lib-tabs`)

- Title `--text-xl` (24→38 fluid), **700**, `--ls-display`, `--lh-tight`.
  Optional subtitle ("1 248 titres") directly under, `--text-sm`,
  `--text-muted`.
- `--space-8` (64) above the title, `--space-6` below.
- Tabs (`.lib-tab` — Titres / Artistes / Albums / Genres): label 500,
  `--text-secondary`; active = `--text-primary` + 2px `--accent`
  underline; no tab background. `role="tablist"` / `role="tab"` /
  `aria-selected` sync unchanged (test-locked).
- Header buttons (sort, dupes badge, search toggle): ghost icon,
  `--text-secondary`.

### 2.3 Search (`.srch`, `#srch`, `#srch-badge`)

- Field `--bg-sunken`, `--radius-sm` (6), `--border-default` (interactive
  boundary → the ≥3:1-locked token is correct here), magnifier icon
  `--text-muted` leading.
- Focus: `--input-focus-ring` (existing — `0 0 0 2px` amber 35%).
- `#srch-badge` result count: `--text-xs`, 500, `--bg-elevated`,
  `--radius-pill`.
- `role="search"` wrapper kept (landmark, test-locked).

### 2.4 `#app` layout

Grid template unchanged (`var(--tb) 1fr var(--pb)` rows,
`var(--sb) 1fr` cols, areas `tb tb / sb main / pl pl`). `#tb` keeps
`color-mix(in srgb, var(--art-color) 16%, var(--bg1))`. Only paddings and
the sidebar/main seam treatment change.

## 3. Track list

Row (`.tr`, `.tart`, `.ti`, `.ta`, `.tlk`, `.tr-add-btn`):

- **3-column grid**: `[art 40 + title/artist] · [album — hidden below the
  existing `@container main (max-width: 820px)` query] · [duration +
  actions]`. Column header `#tlist-col-hdr` underlined with `--sep`,
  `--text-xs`, muted, sentence case (no uppercase / no wide tracking).
- Row height `--tr-h` 64. Art `--tart-size` 40, `--radius-xs` (4). **No
  card, no row border**; optional `--sep` hairline separator, toggled by
  density.
- Title `--text-base`, 500, `--text-primary`; artist on the line below,
  `--text-sm`, 400, `--text-secondary`.
- **Playing**: title → `--accent`; animated `.eq-bars` (in `--accent`)
  replaces the row number. `aria-current="true"` stays mirrored on the
  `.act` class exactly (invariant §2.9).
- **Hover**: `--row-hover` tint; art `scale(1.04)` (`--ease-standard`,
  transform only); play ▷ overlay on the art; `.tr-add-btn` + `.tlk`
  reveal at the right. All hit targets stay ≥ `--target-min` (24px). `.tlk`
  rest opacity stays ≥ 0.45 (test-locked). `.tlk.on` keeps a non-colour cue
  (test-locked).
- **Selected (multi)**: fill `--accent-selected`; no border.
- `virt.js`: the render loop is **not** touched. Row height continues to
  flow from `CFG.VIRT_ROW_H`; the `--tr-h` token change is a CSS value
  change only. `aria-setsize` / `aria-posinset` on rows unchanged
  (test-locked). Binary-search scroll→index mapping unchanged.

## 4. Player bar (`#pl`)

- `--player-height 80` unchanged. Ground `--bg-surface`; top seam →
  `--sep` (drop the current white inset `--player-shadow`).
- **Three zones**: left `.pl-info` (art 56 / `--radius-sm` + title/artist +
  `#pl-lk`) · centre `.pl-c` (transport + `.pl-prog`) · right `.pl-r` (EQ,
  cinema, queue + `#queue-badge`, volume).
- Central `.pcplay`: filled `--accent` disc, icon `--text-on-accent`,
  `--control-size` 36 → **40**.
- Prev / next / shuffle / repeat: ghost, `--text-secondary`; active
  (shuffle/repeat on) = `--text-primary` + a dot beneath the icon (the
  non-colour cue the tests require for `.pc.on`). **No amber here.**
- Progress `.pbar` / `.pfill`: rail `--sep` 3px, fill `--accent`, handle
  revealed on hover only; vertical hit-target stays ≥ 24px.
- Volume `#vol`: same rail; fill **neutral `--text-secondary`** (amber is
  reserved for "playing"). `audio.volume` continues to read from the
  `#vol` DOM slider only (invariant §2 / §13).
- Title marquee `.mq`: keeps `animation-play-state: paused` on hover/focus
  (SC 2.2.2, test-locked).

## 5. Grids (`.card`, `.card-art`, `.card-info`)

- **Album**: square art, `--radius-md` (10); below it title `--text-sm`
  500, one line + ellipsis, then artist `--text-xs` `--text-muted`. **No
  card background, no border** — the art is the card.
- Hover: art `scale(1.03)` + softened `--shadow-md`; floating play ▷ disc
  (`--accent`) bottom-right.
- **Artist**: round art (`--radius-pill`), centred label below.
- **Playlist**: existing 2×2 mosaic, `--radius-md` (10); smart / pin badges
  `--text-xs` on `--glass-panel`.
- Grid: gutter `--space-6` (24),
  `grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr))`.

## 6. Polish + verification

- Tokenise any magic numbers encountered inside the sections refactored by
  phases 2–5 (not a global sweep).
- `npm test` green (`core` + `a11y` + `theme-palette` + `token-source`).
- `npm run bench` within 5% of baseline.
- Manual smoke: `npm run dev` → load a real 1k+ folder → seek, EQ change,
  crossfade, playlist switch, watch-folder add/remove — listen for audio
  glitches, watch for dropped frames on scroll.

## Testing impact — explicit

### `theme-palette.test.cjs`

- **Will be edited**: the exact-hex assertions for `--bg-base`,
  `--bg-surface`, `--bg-elevated`, `--bg-raised` change to the new
  cool-tinted values. The "light override must re-declare `--bg`" check
  stays.
- **Must stay green unchanged**: AAA 7:1 (`--t` / `--t2` / `--t3` on
  `--bg`, both themes); AA 4.5:1 rows (including `--t3` on `--bg-raised`,
  accent on `--bg-raised`); ΔRGB ≥ 8 per step; `--bg-raised == --bg-elevated`;
  every `[data-theme] --g` ≥ 4.5:1 on `#121214`; each `[data-theme]`
  `--g-rgb` == its own `--g`; `.theme-swatch { background: var(--g) }`;
  `settings.js` must not inline-set `--g-rgb`. New neutral + amber values
  are chosen to satisfy all of these.

### `a11y.test.cjs`

- **Must stay green unchanged**: `--target-min` ≥ 24 and the per-selector
  min-size declarations; `--focus-ring` ≥ 2px solid + `--focus-ring-contrast`
  in both themes; `.tlk` / `.tr-add-btn` `:focus-visible` box-shadow uses
  `var(--g)`; non-colour cues on `.tlk.on` / `.pc.on`; content-text
  selectors use `--t3` not `--t4`; `.tlk` rest opacity ≥ 0.45;
  `--border-*` not re-aliased to sub-AA `--border-1/2/3`;
  `#content-area #tlist` `scroll-padding-top`; landmarks (`role=main` +
  `role=search` + `nav[aria-label]`, `#sb` not `role=navigation`);
  `data-action` non-button elements have role + tabindex; `#ni-indicator`
  `aria-hidden`, no tabindex; marquee pause; `data-motion` reduce, zero
  `@media (prefers-reduced-motion)`.
- **New assertion to add**: `--accent` (amber) as playing-state text meets
  ≥ 7:1 on `--bg-base` and `--bg-surface`.

### `core.test.cjs`, `bench.cjs`

No expected impact — no JS logic changes.

## High-risk zones (CLAUDE.md §11)

| Zone | Exposure this project |
|---|---|
| `virt.js` | `--tr-h` token value only; render loop, `CFG.VIRT_ROW_H` sourcing, binary search all untouched. |
| `player.js` / `eq.js` / `replaygain.js` | None — no audio-chain change. |
| `app.js` | None — no boot-order or wiring change. |
| `ipc.js` | None — no command added/changed, no `fetch`. |
| `tracks[]` mutation sites | None. |
| `cinema.js` | Out of scope; inherits tokens by cascade only. |

## Rollback

Each phase is an independent commit. Phase 1 (foundations) is the only
one that edits test expectations; reverting it reverts the identity. Phases
2–5 are additive CSS section rewrites and revert cleanly per-commit.
