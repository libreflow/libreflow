# Search mode — premium harmonisation (Spotify-like)

**Date:** 2026-05-30
**Status:** Approved (design) — pending implementation plan
**Scope:** Remove the ugly in-search chrome (yellow highlight, coloured count badge), improve result relevance + responsiveness, and harmonise the remaining search-mode elements (clear button, clear-filters button, empty state) with the minimal-luxe look. No new design tokens.

---

## 1. Problem

When the user types in the sidebar search field, the result presentation looks unpolished compared to the rest of the app:

- Matched characters are highlighted with a **browser-default yellow** background — not premium.
- A **filled accent-coloured count badge** sits inside the search pill — visually heavy.
- Result ordering is plain alphabetical, ignoring relevance.
- The clear button, the "clear all filters" button, and the empty state are not fully harmonised with the new minimal-luxe search field.

Goal: a clean, elegant, Spotify-like search experience.

## 2. Root cause of the "yellow" (important finding)

`hlText()` (`frontend/src/renderer.js:133-149`) wraps matches in `<mark>…</mark>` **without** any class. The intended premium style lives on `mark.srch-hl` (`frontend/src/style.css:1374-1378`) — an accent-tinted background — but the class is never applied. The browser therefore renders the UA-default `<mark>` style: a bright yellow background. The styled rule has always been dead code.

Decision: remove highlighting entirely (Spotify shows no per-character highlight), which also removes this latent bug.

## 3. Current state (reference)

- **Highlight:** `hlText(text, query, re)` — `renderer.js:133`. Builds a per-word alternation regex and wraps matches in bare `<mark>`. Called from the track-row template (`thtml`) and grid renderers.
- **Dead CSS:** `mark.srch-hl` + light override — `style.css:1374-1378`.
- **Count badge:** `_updateSrchBadge(count)` — `views.js:180-202`. Lazily creates `<span id="srch-badge" class="srch-ct">` inside `.srch`, sets text (`"42"`, `"≈ 42"` for fuzzy, `"0 résultats"`), toggles `.on` for visibility, and is `aria-live="polite"`. CSS `.srch-ct` — `style.css:1143-1151` (filled accent pill).
- **Sort:** `getFiltered()` (`search.js`) filters then sorts **alphabetically** via `_sortTracks` regardless of query. Fuzzy fallback (`_trigramScore`) only when exact match is empty and query >= 3 chars.
- **Debounce:** `CFG.SEARCH_DEBOUNCE = 150` ms (`cfg.js:10`), used by `onSearch` (`views.js:275`).
- **Clear button:** `#srch-clear` / `.srch-clear` — handler `views.js:255` (shows when query non-empty); CSS `style.css:~1140`.
- **Clear-filters button:** `#clear-filters` / `.clear-filters-btn` — `views.js:206` (`updateClearFiltersBtn`); CSS `style.css:~902`.
- **Empty state:** built in `renderLib()` (`renderer.js:642-688`) with classes `.empty / .empty-ico / .empty-h / .empty-s / .empty-cta`.

## 4. Target design

### 4.1 Remove highlight (Section 1)

`hlText()` returns escaped plain text only — no `<mark>`. Signature kept (callers unchanged) but the `re`/`query` params become unused; simplify the body to `return esc(text)`. Remove dead CSS `mark.srch-hl` + its light override (`style.css:1374-1378`). Any pre-compiled-regex plumbing feeding `hlText` purely for highlighting is removed if it becomes dead (verify call sites in `renderer.js`; do not remove regex still used by the filter).

### 4.2 Remove count badge, keep a11y announcement (Section 2)

No visible badge. `_updateSrchBadge(count)` keeps a **visually hidden** live region for screen readers:
- The element keeps `id="srch-badge"` and `aria-live="polite"` but uses an `.sr-only` style class instead of `.srch-ct` (so it is invisible but announced).
- Text content: `"<n> résultats"` / `"aucun résultat"` (drop the `"≈"` fuzzy marker — it was tied to the visible pill; keep wording plain).
- Remove the `.on` opacity toggle (no longer visual). Remove CSS `.srch-ct` (`style.css:1143-1151`).
- `.sr-only` utility: reuse if one already exists in the codebase; otherwise add a single canonical `.sr-only` rule in `style.css` (clip-rect pattern). Verify before adding to avoid duplication.

### 4.3 Relevance scoring (Section 3)

When a query is present, replace the alphabetical sort of the exact-match set with a **relevance score**, descending; ties fall back to the existing collator alpha order. Implemented as a pure, testable helper in `search.js`.

Score combines **match position** and **field weight**, computed per track against the trimmed lowercased query `q`:

- **Position rank** (best wins), evaluated on each candidate field string `s`:
  - `s` starts with `q` -> prefix (highest)
  - a word boundary in `s` starts with `q` (`/\b q/`) -> word-start
  - `s` contains `q` elsewhere -> substring (lowest)
- **Field weight:** name (title) > artist/artistFull > album > genre.

Concretely: `score = fieldWeight * K + positionRank` (with K chosen so field dominates ties only after position within the same field is considered — exact ordering rule fixed in the plan with table-driven tests). Multi-term queries: score on the full trimmed query for ranking purposes; the existing multi-term `includes` test still governs **membership** (what is in the set), scoring only governs **order**. Fuzzy fallback path is unchanged (already sorted by trigram score).

`getFiltered()` already special-cases manual playlists / recent / album-detail — those keep their ordering; relevance sort applies only where the normal `_sortTracks` path runs **and** a query is active.

### 4.4 Responsiveness (Section 4)

`CFG.SEARCH_DEBOUNCE`: `150` -> `90` ms. Single-line change in `cfg.js`.

### 4.5 Harmonise remaining elements (Section 5)

CSS-only, tokens only:
- **`.srch-clear`**: discreet at rest (`--t3`), accent or `--t` on hover, centred, keeps 24x24 target (`--target-min`). Verify it sits correctly inside the new minimal-luxe pill.
- **`.clear-filters-btn`**: sober styling consistent with the sidebar (token bg/border, hover accent), no loud colour.
- **Empty state** (`.empty*`): magnifier icon + heading + sub centred, muted token colours, premium spacing. Verify it reads well in both themes.

## 5. Out of scope (YAGNI)

- No scoped query syntax (`artist:`, `album:`) or extra fields (year, track no.) — relevance/ordering only.
- No change to the fuzzy (trigram) algorithm itself.
- No markup change to `index.html` search structure.
- No change to the search field's own rest/hover/focus visuals (shipped in the prior minimal-luxe redesign).

## 6. Files touched

- `frontend/src/renderer.js` — simplify `hlText` (drop `<mark>`); remove now-dead highlight regex plumbing if unused; verify empty-state markup.
- `frontend/src/views.js` — `_updateSrchBadge` -> hidden a11y live region (no visible pill).
- `frontend/src/search.js` — relevance scoring helper + wire into `getFiltered` query path.
- `frontend/src/cfg.js` — `SEARCH_DEBOUNCE` 150 -> 90.
- `frontend/src/style.css` — remove `mark.srch-hl` (+light), remove `.srch-ct`, add `.sr-only` if absent, harmonise `.srch-clear` / `.clear-filters-btn` / `.empty*`.

No new design tokens -> `token-source.test.cjs` stays green.

## 7. Verification

- `npm test` — green; **add** unit tests for the relevance scorer in `core.test.cjs` (table-driven: prefix vs word-start vs substring; title vs artist vs album; tie -> alpha). TDD: red -> green.
- `node frontend/tests/a11y.test.cjs` — green; confirm the hidden live region still satisfies the result-announcement assertion (badge `aria-live`).
- `node frontend/tests/token-source.test.cjs` + theme suites — green.
- Manual smoke (`npm run dev`): type a query -> no yellow marks, no coloured badge, results ordered by relevance, snappy (~90 ms); clear (x) + clear-filters + empty state look harmonised in dark **and** light; screen-reader still hears the result count.

## 8. Open decisions (defaults chosen)

- Debounce target: **90 ms** (alt 60 ms if still feels laggy). **Default 90.**
- Fuzzy badge marker `"≈"`: **dropped** (badge no longer visible).
- a11y count wording: **"<n> résultats" / "aucun résultat"**.
