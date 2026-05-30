# Search Mode Premium Harmonisation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make search mode look and feel premium (Spotify-like): remove the yellow match highlight, remove the coloured count badge (keep a hidden a11y announcement), order results by relevance, lower the debounce, and harmonise the clear button / clear-filters button / empty state.

**Architecture:** Surgical changes across `renderer.js` (drop `<mark>`), `views.js` (badge → hidden live region), `search.js` (relevance scorer + wire into `getFiltered` query path), `cfg.js` (debounce), and `style.css` (remove dead/heavy rules, harmonise). The relevance scorer is a pure exported function unit-tested in `core.test.cjs` (TDD). No new design tokens.

**Tech Stack:** Vanilla ESM JS, Node CJS test runner, existing design-system tokens.

**Spec:** `docs/superpowers/specs/2026-05-30-search-mode-premium-design.md`

**Test commands (confirmed against package.json):**
- `npm test` runs ONLY `frontend/tests/core.test.cjs` (has a `pretest` regenerating `cdaudio_pure.cjs`).
- Guardrails are separate files: `node frontend/tests/a11y.test.cjs`, `node frontend/tests/token-source.test.cjs`, `node frontend/tests/theme-palette.test.cjs`, `node frontend/tests/theme-light-coverage.test.cjs`, `node frontend/tests/theme-tokens.test.cjs`.

**Confirmed facts from code read (master):**
- `hlText(text, query, re)` defined at `renderer.js:133`; re-exported via `app.js:91`. Call sites: track row `tn`/`ts` (`renderer.js:238-239`, 3-arg with `hlRe`); album cards (`803-804`), artist card (`882`), playlist card (`961`) — all 2-arg `hlText(x, query)`. The per-loop highlight regex `hlRe` is built at `renderer.js:312-314` and threaded through `thtml`.
- `.sr-only` ALREADY EXISTS at `style.css:44` (clip-rect pattern) — REUSE it, do not add a new one.
- `getFiltered` final sort branch at `search.js:417-419`; fuzzy path returns earlier at `382-388`; manual-playlist / recent / album-detail handled at `403-416`.

> Line numbers are from current `master`; if drifted, locate by the quoted selector/function text.

---

## File Structure

- `frontend/src/search.js` — NEW pure export `relevanceScore(t, q)` + internal `_relevanceSort`; wire into `getFiltered()` query path.
- `frontend/tests/core.test.cjs` — NEW table-driven tests for `relevanceScore`.
- `frontend/src/renderer.js` — simplify `hlText` to plain escaped text; remove now-dead `hlRe` construction + threading.
- `frontend/src/views.js` — `_updateSrchBadge` → hidden `.sr-only` live region.
- `frontend/src/cfg.js` — `SEARCH_DEBOUNCE` 150 → 90.
- `frontend/src/style.css` — remove `mark.srch-hl` (+light) and `.srch-ct`; harmonise `.srch-clear`, `.clear-filters-btn`, `.empty*`.

---

## Task 1: Remove the yellow highlight (`hlText` → plain text)

**Files:** Modify `frontend/src/renderer.js` (`hlText` l.133-149; `hlRe` l.312-314; call sites l.238-239).

- [ ] **Step 1: Simplify `hlText`.** Replace the whole function (l.133-149) so it never emits `<mark>`:
```js
/** Returns HTML-escaped text. (Search highlighting removed — premium/Spotify-like plain results.) */
export function hlText(text) {
  return text ? esc(text) : '';
}
```

- [ ] **Step 2: Remove the dead per-loop regex.** In the list render loop, delete the `hlRe` construction at l.312-314:
```js
  const hlRe = query
    ? new RegExp(`(${query.trim().split(/\s+/).filter(Boolean).map(escapeRegex).join('|')})`, 'gi')
    : null;
```
Then in the `thtml(...)` call (l.358) remove the `hlRe` argument from the options object. In `thtml`'s signature (l.203) remove `hlRe` from the destructured options. The track-row template lines (l.238-239) become:
```js
    <div class="tn" title="${esc(t.name || '')}">${hlText(t.name || '')}</div>
    <div class="ts" title="${esc(t.artistFull || t.artist || '')}">${hlText(t.artistFull || t.artist || '')}</div>
```

- [ ] **Step 3: Trim 2-arg call sites.** The card call sites (l.803-804, 882, 961) pass `hlText(x, query)`; the extra `query` arg is now harmless but drop it for cleanliness: `hlText(a.name || i18n('unknown_album') || '?')`, `hlText(a.artist)`, `hlText(a.name || '?')`, `hlText(pl.name || '?')`.

- [ ] **Step 4: Check `escapeRegex` usage.** Grep `escapeRegex` in `renderer.js`. If it is now unused (was only for `hlRe`), remove its import/definition too. If still used elsewhere, leave it.

- [ ] **Step 5: Verify.** Run `npm test` and `node frontend/tests/a11y.test.cjs`. Expected: PASS. Grep `<mark>` in `renderer.js` → 0 matches.

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/renderer.js
git commit -m "feat(search): remove match highlight (plain premium results)"
```

---

## Task 2: Remove dead/heavy CSS (`mark.srch-hl`, `.srch-ct`)

**Files:** Modify `frontend/src/style.css` (`mark.srch-hl` l.1373-1378; `.srch-ct` l.1143-1151).

- [ ] **Step 1: Remove highlight CSS.** Delete (dead after Task 1):
```css
/* Highlight termes de recherche */
mark.srch-hl {
  background: rgba(var(--g-rgb), .30); color: inherit;
  border-radius: var(--r-xs); padding: 0 var(--sp-nano); font-style: normal;
}
html[data-mode="light"] mark.srch-hl { background: rgba(var(--g-rgb), .22); }
```

- [ ] **Step 2: Remove the badge pill CSS.** Delete the `.srch-ct { ... }` block AND `.srch-ct.on { ... }` (the filled accent pill + its UX comment, ~l.1142-1151).

- [ ] **Step 3: Verify guardrails.** Run `node frontend/tests/token-source.test.cjs`, `node frontend/tests/theme-palette.test.cjs`. Expected: PASS. (a11y handled in Task 3 — if it fails here referencing `srch-badge`, proceed to Task 3.)

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/style.css
git commit -m "style(search): remove dead highlight CSS + coloured count badge pill"
```

---

## Task 3: Count badge → hidden a11y live region

**Files:** Modify `frontend/src/views.js` (`_updateSrchBadge`, l.180-202).

- [ ] **Step 1: Rewrite `_updateSrchBadge`.** `.sr-only` already exists (`style.css:44`) — reuse it. Replace the function:
```js
function _updateSrchBadge(count) {
  let badge = document.getElementById('srch-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'srch-badge';
    badge.className = 'sr-only';
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');
    document.querySelector('.srch')?.appendChild(badge);
  }
  const hasQuery = !!_q();
  if (!hasQuery)        badge.textContent = '';
  else if (count === 0) badge.textContent = 'aucun résultat';
  else                  badge.textContent = `${count} résultats`;
  updateClearFiltersBtn();
}
```
This drops the visible `.srch-ct`/`.on` pill and the `"≈"` fuzzy marker; keeps the live announcement + `updateClearFiltersBtn()`.

- [ ] **Step 2: Confirm `wasFuzzySearch` import.** If `wasFuzzySearch` (used only by the old badge text) is now unused in `views.js`, remove its import. Grep first; if used elsewhere, leave it.

- [ ] **Step 3: Confirm `app.js` reset still valid.** `app.js:1018` `getElementById('srch-badge')?.remove()` still works (lazy recreation). No change.

- [ ] **Step 4: Verify.** Run `npm test` and `node frontend/tests/a11y.test.cjs`. Expected: PASS (live region keeps `aria-live`). If a11y asserts a specific class/attr, align to it without weakening the requirement.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/views.js
git commit -m "feat(search): replace count badge with hidden a11y live region"
```

---

## Task 4: Relevance scorer (pure function + tests, TDD)

**Files:** Modify `frontend/src/search.js`; `frontend/tests/core.test.cjs`.

- [ ] **Step 1: Write failing tests** in `core.test.cjs`. Import `relevanceScore` from `../src/search.js` mirroring how other `search.js` exports are already imported in that file (check the top of `core.test.cjs` for the existing import pattern; reuse it). Convention: higher score = more relevant.
```js
test('relevanceScore: title prefix beats title substring', () => {
  assert.ok(relevanceScore({ name: 'Discovery' }, 'dis') > relevanceScore({ name: 'The Distance' }, 'dis'));
});
test('relevanceScore: title word-start beats title substring', () => {
  assert.ok(relevanceScore({ name: 'Endless Discovery' }, 'dis') > relevanceScore({ name: 'Misdiagnosed' }, 'dis'));
});
test('relevanceScore: title match beats artist match', () => {
  assert.ok(relevanceScore({ name: 'Dance', artist: 'X' }, 'dan') > relevanceScore({ name: 'X', artist: 'Dance' }, 'dan'));
});
test('relevanceScore: artist match beats album match', () => {
  assert.ok(relevanceScore({ artist: 'Daft Punk', album: 'X' }, 'daf') > relevanceScore({ artist: 'X', album: 'Daft Album' }, 'daf'));
});
test('relevanceScore: no match scores 0', () => {
  assert.strictEqual(relevanceScore({ name: 'Zzz', artist: 'Yyy' }, 'dis'), 0);
});
```

- [ ] **Step 2: Run tests, confirm fail.** `npm test` → FAIL (`relevanceScore is not defined`).

- [ ] **Step 3: Implement in `search.js`** near `_sortTracks`:
```js
// Field weights (title > artist > album > genre). Higher = more important.
const _FIELD_W = [['name', 4], ['artist', 3], ['artistFull', 3], ['album', 2], ['genre', 1]];
// Position rank within a field: prefix(3) > word-start(2) > substring(1) > none(0).
function _posRank(s, q) {
  if (!s) return 0;
  const l = s.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(l)) return 2;
  if (l.includes(q)) return 1;
  return 0;
}
/** Relevance of track t for query q (caller passes trimmed+lowercased q). Higher = better; 0 = no match. */
export function relevanceScore(t, q) {
  let best = 0;
  for (const [field, w] of _FIELD_W) {
    const r = _posRank(t[field], q);
    if (r) best = Math.max(best, w * 4 + r); // field dominates; position breaks within-field ties
  }
  return best;
}
function _relevanceSort(list, q) {
  const qq = q.trim().toLowerCase();
  return [...list].sort((a, b) => {
    const d = relevanceScore(b, qq) - relevanceScore(a, qq);
    return d !== 0 ? d : _compare(a.name, b.name);
  });
}
```
Rationale for `w * 4 + r`: weights are 4/3/2/1 and r in 1..3, so a higher field always outranks a lower field, and within a field, position rank orders. If a test reveals an inversion, raise the multiplier above max(r)=3 only.

- [ ] **Step 4: Run tests, confirm pass.** `npm test` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/search.js frontend/tests/core.test.cjs
git commit -m "feat(search): relevance scorer (prefix/word/substring x field weight)"
```

---

## Task 5: Wire relevance sort into `getFiltered`

**Files:** Modify `frontend/src/search.js` (`getFiltered` final branch, l.417-419).

- [ ] **Step 1: Replace the final sort branch.** Change:
```js
  } else {
    result = _sortTracks(filtered, sort, recentPlays);
  }
```
to:
```js
  } else if (query) {
    // Query active → order by relevance (prefix/word/substring × field weight),
    // alpha tie-break. Non-query path keeps the user-chosen sort.
    result = _relevanceSort(filtered, query);
  } else {
    result = _sortTracks(filtered, sort, recentPlays);
  }
```
The manual-playlist / recent / album-detail branches (l.403-416) and the fuzzy early-return (l.382-388) are untouched.

- [ ] **Step 2: Verify.** Run `npm test`, `node frontend/tests/a11y.test.cjs`, `node frontend/tests/token-source.test.cjs`. Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/search.js
git commit -m "feat(search): order results by relevance when a query is active"
```

---

## Task 6: Lower the debounce (snappier)

**Files:** Modify `frontend/src/cfg.js` (l.10).

- [ ] **Step 1: Change the value.** `SEARCH_DEBOUNCE: 150,` → `90`:
```js
  SEARCH_DEBOUNCE:          90,   // ms — debounce sur la barre de recherche
```

- [ ] **Step 2: Verify.** `npm test` → PASS.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/cfg.js
git commit -m "perf(search): debounce 150ms -> 90ms for snappier typing"
```

---

## Task 7: Harmonise clear button / clear-filters button / empty state

**Files:** Modify `frontend/src/style.css` (`.srch-clear` ~l.1140; `.clear-filters-btn` ~l.902; `.empty*`; light overrides ~l.368, ~l.445-446).

- [ ] **Step 1: Read current rules.** Read `style.css` for `.srch-clear` / `.srch-clear:hover`, `.clear-filters-btn` (+ light overrides), and `.empty / .empty-ico / .empty-h / .empty-s / .empty-cta`. Note token usage. For each, if it already meets the bar below, leave it and note "already harmonised" in the report.

- [ ] **Step 2: `.srch-clear`.** Ensure rest `color: var(--t3)`; hover `color: var(--t)` + subtle token bg (`var(--bg5)` dark / light equiv already at l.445-446); centred flex; `min-width/min-height: var(--target-min)`; `border-radius: var(--r-sm)`; `transition` on color+background. Token-only, no literals.

- [ ] **Step 3: `.clear-filters-btn`.** Make sober: token bg (`transparent` or `--border-1`), token border, `color: var(--t3)`, hover `color: var(--t)`/accent + subtle bg, and `:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }` if missing. No loud fills. Keep dark+light consistent.

- [ ] **Step 4: `.empty*`.** Confirm `.empty` centred (flex column, centered, gap via `--space-*`); `.empty-ico` muted (`--t3`/`--t4`), calm size; `.empty-h` `--t`/`--text-primary`; `.empty-s` `--t3`/`--text-secondary`. Adjust only what is off; token-only.

- [ ] **Step 5: Verify guardrails.** Run `node frontend/tests/token-source.test.cjs`, `node frontend/tests/a11y.test.cjs`, `node frontend/tests/theme-palette.test.cjs`, `node frontend/tests/theme-light-coverage.test.cjs`, `node frontend/tests/theme-tokens.test.cjs`. Expected: all PASS. Do NOT weaken any a11y/theme assertion; if one fails on a real requirement, fix the CSS.

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/style.css
git commit -m "style(search): harmonise clear button, clear-filters button, empty state"
```

---

## Task 8: Final verification + manual smoke

- [ ] **Step 1: Full suite.**
```
npm test && node frontend/tests/token-source.test.cjs && node frontend/tests/a11y.test.cjs && node frontend/tests/theme-palette.test.cjs && node frontend/tests/theme-light-coverage.test.cjs && node frontend/tests/theme-tokens.test.cjs
```
Expected: all PASS.

- [ ] **Step 2: Manual smoke (`npm run dev`).** Type a query and confirm:
  - No yellow marks on matched characters; results are plain text.
  - No coloured count badge in the search pill.
  - Results ordered by relevance (a few letters of a known title → that title near the top; prefix beats mid-word; title beats artist/album).
  - Typing feels snappy (~90 ms).
  - ✕ clear button, "clear all filters" button, and "no results" empty state look harmonised + centred — dark **and** light.
  - (If a screen reader available) result count still announced.

- [ ] **Step 3:** No commit unless a smoke issue required a fix.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4.1 highlight → Tasks 1-2; §4.2 badge→a11y → Tasks 2-3; §4.3 relevance → Tasks 4-5; §4.4 debounce → Task 6; §4.5 harmonise → Task 7; §7 tests/verification → Tasks 4, 8. All covered.
- **Placeholder scan:** none — every code step shows full code or an exact read-then-adjust instruction with the bar defined.
- **Type/naming consistency:** `relevanceScore(t, q)` and `_relevanceSort(list, q)` consistent between Tasks 4 and 5; `hlText(text)` single-arg consistent between Task 1 def and call-site cleanup; `.sr-only` reused (confirmed exists l.44), not redefined.
- **Corrections vs first draft:** `.sr-only` already exists (no new rule); `hlText` call sites enumerated exactly (6 sites); `hlRe`/`escapeRegex` dead-code cleanup made explicit with grep-guard.
