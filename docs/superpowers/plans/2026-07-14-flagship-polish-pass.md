# Flagship Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining flagship-polish gaps identified in
`docs/superpowers/specs/2026-07-14-flagship-polish-pass-design.md`: wire up
already-built-but-unused skeleton shimmer CSS for artwork loading, replace
the welcome screen's generic feature-grid with a hero-centric layout, give
the queue panel's empty state the same treatment already used elsewhere,
and add a missing `:active` press state to the batch-selection toolbar.

**Architecture:** Pure CSS + minimal render-time class toggles. No new
components, no new state variables — every task reads an existing flag
(`t.metaDone`, `a.artUrl`/`a.artTrack`, `explicit.length`/`natural.length`)
that already drives other rendering decisions in the same functions.

**Tech Stack:** Vanilla ESM JS, existing `design-system.css` tokens, Node
`node:assert`-style CJS tests (`frontend/tests/core.test.cjs`).

## Global Constraints

- No new CSS custom properties — every value must resolve to an existing
  token (verified during research: `--anim-shim`, `--g-rgb`,
  `--accent-glow`/`--accent-subtle`, `--motion-fast`, `--dur-*`, `--sp-*`,
  `--r-*` all already exist).
- No `transition: all` (house rule, currently zero occurrences in
  `style.css` — must stay zero).
- Every new/changed interactive element keeps its existing
  `aria-*`/`role` attributes; decorative elements (shimmer, halo) get
  `aria-hidden="true"`.
- `prefers-reduced-motion` / `html[data-motion="reduce"]`: every new
  animation must have a reduced-motion fallback, matching the existing
  pattern (`html[data-motion="reduce"] .foo { animation: none; }`).
- `tracks[]` is not mutated by any task in this plan — no
  `rebuildTrackIdxMap()` call is needed anywhere here.
- Functions stay under 50 lines, files under 800 lines (CLAUDE.md §16).

## Important scope correction from the spec

The spec (written from a code-blind design audit) assumed items 3
(empty states) and 4 (active/press states) needed broad new work. Deeper
investigation while writing this plan found most of that infrastructure
**already built and already wired up**:

- `.tart.loading` / `.card-art.loading` shimmer CSS + `@keyframes shim`
  already exist (`style.css:1263-1281`) — but nothing in JS ever adds the
  `loading` class. **Real gap: wiring, not CSS.**
- `.ni:active`, `.pc:active`, `.pcplay:active`, `.pl-lk:active` already
  have `scale()` press transforms. **Only `.sel-action` is missing one.**
- The main track list (`#tlist`) already renders a fully-designed empty
  state (icon + halo pulse + heading + subtitle + contextual CTA) for
  search/library/liked/recent/playlist-detail — see
  `renderer.js:373-406`. The playlist nav sidebar has its own polished
  empty state (`playlists.js:636-641`, `.pl-nav-empty`). **Only the queue
  panel (`queue.js:357`, `.queue-empty`) is still plain text.**

This plan targets the real gaps only. Tasks are ordered cheapest/lowest-risk
first.

---

### Task 1: Track-row artwork skeleton (list view)

**Files:**
- Modify: `frontend/src/renderer.js:107-141` (the `thtml()` function)
- Modify: `frontend/tests/core.test.cjs` (new section 30, appended after
  the existing section 29 at line 935)

**Interfaces:**
- Consumes: `t.metaDone` (boolean, already set by `loadTagsBg()` in
  `library.js` once tag hydration resolves — CLAUDE.md §5), `t.art`
  (string URL or falsy), existing `artPlaceholder(t)` (exported from
  `renderer.js`, unchanged signature).
- Produces: no new exports — `thtml()`'s existing signature and return
  type (HTML string) are unchanged, only its internal branching changes.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/core.test.cjs`, after the `artPlaceholder` section
(ends at line 758, before section 24 at line 762):

```js
// =============================================================================
// 30. Renderer — thtml artwork state (loading / placeholder / image)
// =============================================================================
section('renderer.js -- thtml artwork state (reproduced inline)');

(function () {
  // Reproduces the artInner/class selection logic from thtml() —
  // matches the artPlaceholder inline-reproduction convention above.
  function artState(t) {
    if (!t.metaDone) return { tartClass: 'tart loading', hasImg: false, hasPh: false };
    if (t.art)       return { tartClass: 'tart', hasImg: true, hasPh: false };
    return { tartClass: 'tart', hasImg: false, hasPh: true };
  }

  const pending = artState({ metaDone: false, art: null });
  assert(pending.tartClass === 'tart loading', 'thtml: !metaDone → classe "tart loading"');
  assert(!pending.hasImg && !pending.hasPh, 'thtml: !metaDone → ni <img> ni placeholder (shimmer seul)');

  const resolvedWithArt = artState({ metaDone: true, art: 'blob:abc' });
  assert(resolvedWithArt.tartClass === 'tart', 'thtml: metaDone + art → classe "tart" (pas loading)');
  assert(resolvedWithArt.hasImg, 'thtml: metaDone + art → <img> rendu');

  const resolvedNoArt = artState({ metaDone: true, art: null });
  assert(resolvedNoArt.tartClass === 'tart', 'thtml: metaDone sans art → classe "tart" (pas loading)');
  assert(resolvedNoArt.hasPh, 'thtml: metaDone sans art → placeholder monogramme permanent');
}());
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/core.test.cjs`
Expected: the new section 30 assertions don't exist yet as a concept in
`thtml()` — this step is a logic-design check, not a red/green gate on
`thtml()` itself (the inline reproduction is self-contained). Confirm the
new assertions print and pass in isolation (they test the reproduction,
not the real function yet) — this locks the intended behavior before
touching `renderer.js`.

- [ ] **Step 3: Implement in `renderer.js`**

Replace lines 108-111:

```js
  // Artwork — img avec fade-in (.art-img → .art-loaded au onload) OU placeholder
  const artInner = t.art
    ? `<img class="art-img" src="${esc(t.art)}" alt="" aria-hidden="true">`
    : artPlaceholder(t);
```

with:

```js
  // Artwork — pendant l'hydratation des tags (!metaDone), on ne sait pas
  // encore si une pochette existe : shimmer (classe .tart.loading) plutôt
  // que le monogramme, qui doit rester réservé à l'état final "pas d'art".
  const artInner = !t.metaDone
    ? ''
    : t.art
      ? `<img class="art-img" src="${esc(t.art)}" alt="" aria-hidden="true">`
      : artPlaceholder(t);
  const tartClass = t.metaDone ? 'tart' : 'tart loading';
```

Then replace line 134 (`  ${trackNum}<div class="tart">`) with:

```js
  ${trackNum}<div class="${tartClass}">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node frontend/tests/core.test.cjs`
Expected: all section 30 assertions PASS, and the full suite still reports
0 failures (check the final summary line).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer.js frontend/tests/core.test.cjs
git commit -m "feat: shimmer skeleton for track-row artwork while tags load" -m "Wires the existing .tart.loading shimmer CSS (previously dead) to t.metaDone so pending artwork shows a loading state instead of jumping straight to the permanent monogram placeholder."
```

---

### Task 2: Album/artist/playlist grid card-art skeleton

**Files:**
- Modify: `frontend/src/renderer-grids.js:55-86` (`_hydrateArtPlaceholders`)
- Modify: `frontend/src/renderer-grids.js:333-357` (album card template —
  the same `isPending` pattern also applies to the artist template at
  ~398-427 and playlist template at ~493-512, listed as sub-steps)
- Modify: `frontend/src/style.css:1269-1281` (extend the shimmer selector)
- Modify: `frontend/src/style.css:1654` (`.card-art-ph`, add a loading
  override)

**Interfaces:**
- Consumes: `a.artUrl` (string or falsy), `a.artTrack` (track object or
  falsy) — both already computed upstream in the album/artist/playlist
  aggregation before this template runs; unchanged.
- Produces: `_hydrateArtPlaceholders()` keeps its existing signature
  `(rootEl, { observe })`; its internal `hydrate()` closure now also
  clears the `loading` class it no longer needs once art resolves (or
  definitively doesn't).

- [ ] **Step 1: Extend the shimmer CSS selector**

In `frontend/src/style.css`, change lines 1269-1270:

```css
.tart.loading,
.card-art.loading {
```

This selector is unchanged (it already covers `.card-art.loading`) — no
edit needed here. Instead, add a new rule directly after the existing
block (after line 1281, before the `/* ── Skeleton rows */` comment at
line 1283):

```css
/* Masque le glyphe 💿 pendant le shimmer — évite la superposition
   emoji + gradient animé (bruit visuel, cf. spec flagship-polish-pass). */
.card-art.loading .card-art-ph { opacity: 0; }
```

- [ ] **Step 2: Update `_hydrateArtPlaceholders` to manage the class**

In `frontend/src/renderer-grids.js`, replace the `hydrate` closure
(lines 57-69):

```js
  const hydrate = (ph) => {
    const t = _artTrackById.get(ph.getAttribute('data-art-tid'));
    if (!t) return;
    getArtUrl(t).then(url => {
      if (!url || !ph.isConnected) return;
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      if (ph.dataset.artImgClass) img.className = ph.dataset.artImgClass;
      img.src = url;
      ph.replaceWith(img);
    }).catch(e => console.warn('[getArtUrl]', t?.id, e));
  };
```

with:

```js
  const hydrate = (ph) => {
    const t = _artTrackById.get(ph.getAttribute('data-art-tid'));
    if (!t) return;
    getArtUrl(t).then(url => {
      if (!ph.isConnected) return;
      // Fetch resolved to nothing (no embedded art) — settle into the
      // permanent 💿 placeholder state instead of shimmering forever.
      if (!url) { ph.closest('.card-art')?.classList.remove('loading'); return; }
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      if (ph.dataset.artImgClass) img.className = ph.dataset.artImgClass;
      img.src = url;
      ph.closest('.card-art')?.classList.remove('loading');
      ph.replaceWith(img);
    }).catch(e => console.warn('[getArtUrl]', t?.id, e));
  };
```

- [ ] **Step 3: Mark the album card wrapper as loading (write the failing test first)**

Add to `frontend/tests/core.test.cjs`, right after the section-30 block
added in Task 1:

```js
// =============================================================================
// 31. Renderer grids — card-art "loading" flag (reproduced inline)
// =============================================================================
section('renderer-grids.js -- card-art isPending (reproduced inline)');

(function () {
  // Reproduces the isPending predicate used by the album/artist/playlist
  // card templates: shimmer only while a fetch is genuinely in flight.
  function isPending(entry) {
    return !entry.artUrl && !!entry.artTrack;
  }

  assert(isPending({ artUrl: null, artTrack: { id: 't1' } }) === true,
    'isPending: pas encore résolu + track candidate → true (shimmer)');
  assert(isPending({ artUrl: 'blob:x', artTrack: { id: 't1' } }) === false,
    'isPending: déjà résolu → false');
  assert(isPending({ artUrl: null, artTrack: null }) === false,
    'isPending: aucune track avec art → false (état permanent, pas de shimmer)');
}());
```

Run: `node frontend/tests/core.test.cjs` — expect these 3 assertions to
PASS immediately (pure function, no wiring needed yet); this locks the
predicate before it's inlined into three templates.

- [ ] **Step 4: Apply `isPending` to the album template**

In `frontend/src/renderer-grids.js`, replace lines 338-342:

```js
    const artHtml = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">💿</div>`
        : `<div class="card-art-ph" aria-hidden="true">💿</div>`;
```

with:

```js
    const isPending = !a.artUrl && !!a.artTrack;
    const artHtml = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">💿</div>`
        : `<div class="card-art-ph" aria-hidden="true">💿</div>`;
```

Then replace line 348 (`      <div class="card-art">${artHtml}`) with:

```js
      <div class="card-art${isPending ? ' loading' : ''}">${artHtml}
```

- [ ] **Step 5: Apply the same pattern to the artist template**

In `frontend/src/renderer-grids.js`, replace lines 417-421:

```js
    const artHtml  = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph card-art-circle" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`
        : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`;
```

with:

```js
    const isPending = !a.artUrl && !!a.artTrack;
    const artHtml  = a.artUrl
      ? `<img src="${esc(a.artUrl)}" alt="" aria-hidden="true">`
      : a.artTrack
        ? `<div class="card-art-ph card-art-circle" aria-hidden="true" data-art-tid="${esc(a.artTrack.id)}">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`
        : `<div class="card-art-ph card-art-circle" aria-hidden="true">${esc(a.name?.[0]?.toUpperCase() || '?')}</div>`;
```

Then replace line 427 (`      <div class="card-art card-art-round">${artHtml}`) with:

```js
      <div class="card-art card-art-round${isPending ? ' loading' : ''}">${artHtml}
```

Note: `.card-art.loading` already matches this element regardless of
class order (`card-art card-art-round loading`), since CSS class
selectors don't depend on attribute order — no extra selector needed.

- [ ] **Step 6: Apply the same pattern to the playlist mosaic template**

Around line 493-512, the playlist card uses `arts` (an array of up to 4
track arts) rather than a single `artTrack`/`artUrl` pair — it does not
go through `_hydrateArtPlaceholders`'s single-track path, so it is **not**
in scope for this task (no `data-art-tid` placeholder to hydrate — the
mosaic either has thumbnails already in `plTracks` or shows the static
`🎵` fallback). Leave this template unchanged; note it explicitly here so
a future worker doesn't assume it was missed.

- [ ] **Step 7: Run the full test suite**

Run: `node frontend/tests/core.test.cjs`
Expected: sections 30 and 31 pass, full suite reports 0 failures.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`, scan a folder with 50+ tracks that have embedded
artwork. Watch the album grid (Bibliothèque → Albums) during initial
load: covers should shimmer briefly then fade to the real image, never
show a static 💿 disc for tracks that do have embedded art.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/renderer-grids.js frontend/src/style.css frontend/tests/core.test.cjs
git commit -m "feat: shimmer skeleton for album/artist grid covers" -m "Extends the metaDone-driven loading pattern from Task 1 to grid cards: shimmer while a cover fetch is in flight, permanent disc placeholder only once resolved as absent."
```

---

### Task 3: Player-bar artwork skeleton

**Files:**
- Modify: `frontend/src/playerbar.js:156-158` (`updateBar()`)
- Modify: `frontend/src/style.css:1269-1270` (extend shimmer selector to
  `.pl-art`)

**Interfaces:**
- Consumes: `t.metaDone`, `t.art` — same fields as Task 1, read from the
  `tracks[curIdx]` object already resolved at the top of `updateBar()`
  (`const t = tracks[curIdx]`, line 145).
- Produces: no new exports; `updateBar()`'s signature (`() => void`) is
  unchanged.

- [ ] **Step 1: Extend the shimmer CSS selector**

In `frontend/src/style.css`, change lines 1269-1270 from:

```css
.tart.loading,
.card-art.loading {
```

to:

```css
.tart.loading,
.card-art.loading,
.pl-art.loading {
```

- [ ] **Step 2: Wire the class in `updateBar()`**

In `frontend/src/playerbar.js`, replace lines 156-158:

```js
  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  if (t.art) { img.src = t.art; img.alt = t.album || t.name || ''; img.style.display = 'block'; em.style.display = 'none'; animateArtChange(); }
  else       { img.alt = ''; img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext); }
```

with:

```js
  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  const plArt = document.getElementById('pl-art');
  plArt?.classList.toggle('loading', !t.metaDone);
  if (!t.metaDone) {
    img.style.display = 'none'; em.style.display = 'none';
  } else if (t.art) {
    img.src = t.art; img.alt = t.album || t.name || ''; img.style.display = 'block'; em.style.display = 'none'; animateArtChange();
  } else {
    img.alt = ''; img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext);
  }
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, scan a folder, immediately play the first track that
appears (before its tags finish hydrating — on a large folder this is a
visible window). Confirm the player-bar artwork slot shimmers rather than
jumping straight to the extension-emoji fallback, then settles to the
real cover or the emoji once `metaDone` resolves.

No automated test for this step: `updateBar()` reads and writes live DOM
via `document.getElementById`, and `frontend/tests/core.test.cjs` has no
DOM shim (confirmed: no `jsdom`/`happy-dom` dependency in
`package.json`, and every existing renderer test in that file uses the
"reproduce the pure logic inline" convention instead of exercising real
DOM functions) — consistent with existing project convention, verified
by manual smoke per CLAUDE.md §testing.md ("Manual smoke required before
release").

- [ ] **Step 4: Commit**

```bash
git add frontend/src/playerbar.js frontend/src/style.css
git commit -m "feat: shimmer skeleton for player-bar artwork while tags load"
```

---

### Task 4: Welcome screen redesign

**Files:**
- Modify: `frontend/index.html:180-201` (`#vw` welcome view block)
- Modify: `frontend/src/style.css:1988-2081` (`.wl`/`.wl-logo`/`.wfeats`/
  `.wf*` rules)
- Modify: `frontend/src/style.css:584-604` (light-theme `.wf` overrides)
- Modify: `frontend/src/style.css:5998` (`#vw.on .wfeats` entrance
  animation selector)

**Interfaces:**
- Consumes: existing i18n-free static copy (this view has no
  `data-i18n` attributes today — confirmed by reading the current block;
  not introduced by this task), existing `open-folder`/`import-m3u`
  actions (unchanged `data-action` values, still wired by the existing
  `app.js` action dispatcher).
- Produces: no JS exports — this is a pure HTML/CSS restructure. No
  render function reads `.wfeats`/`.wf` elsewhere (confirmed: only
  `style.css` references those class names — `index.html` is the sole
  HTML producer for this static view, not generated at runtime).

- [ ] **Step 1: Restructure the HTML**

In `frontend/index.html`, replace the `#vw` block (lines 180-201):

```html
  <div class="view on" id="vw" role="region" aria-label="Bienvenue">
    <div class="wl">
      <img src="/icon-512.png" alt="LibreFlow logo" class="wl-logo">
      <h1 class="wh1">Bienvenue sur LibreFlow</h1>
    </div>
    <p class="wsub">Ton lecteur audio local. Tes musiques, sans streaming, sans pub.</p>
    <div class="wfeats">
      <div class="wf"><span class="wf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></span><div><div class="wf-t">Scan & tags auto</div><div class="wf-d">Dossiers, pochettes et métadonnées extraits automatiquement</div></div></div>
      <div class="wf"><span class="wf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span><div><div class="wf-t">Playlists & Smart Radio</div><div class="wf-d">Playlists manuelles, intelligentes et radio par affinité</div></div></div>
      <div class="wf"><span class="wf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="13"/><line x1="12" y1="9" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="17"/><line x1="20" y1="13" x2="20" y2="3"/><rect x="1.5" y="12.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/><rect x="9.5" y="7.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/><rect x="17.5" y="15.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/></svg></span><div><div class="wf-t">EQ & qualité audio</div><div class="wf-d">Égaliseur 10 bandes, ReplayGain, crossfade et visualiseur</div></div></div>
      <div class="wf"><span class="wf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg></span><div><div class="wf-t">Stats & historique</div><div class="wf-d">Artistes, albums, genres et calendrier d'écoute</div></div></div>
    </div>
    <button class="wbtn wbtn-scan" data-action="open-folder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      Choisir mon dossier Musique
    </button>
    <button class="wbtn wbtn-m3u" data-action="import-m3u">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Importer une playlist M3U
    </button>
    <span class="whint">ou glisse-dépose des fichiers audio dans la fenêtre</span>
  </div>
```

with:

```html
  <div class="view on" id="vw" role="region" aria-label="Bienvenue">
    <div class="wl">
      <div class="wl-hero" aria-hidden="true">
        <img src="/icon-512.png" alt="" class="wl-logo">
      </div>
      <h1 class="wh1">Bienvenue sur LibreFlow</h1>
    </div>
    <p class="wsub">Ton lecteur audio local. Tes musiques, sans streaming, sans pub.</p>
    <button class="wbtn wbtn-scan" data-action="open-folder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
      Choisir mon dossier Musique
    </button>
    <button class="wbtn wbtn-m3u" data-action="import-m3u">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Importer une playlist M3U
    </button>
    <span class="whint">ou glisse-dépose des fichiers audio dans la fenêtre</span>
    <div class="wf-row" role="list" aria-label="Fonctionnalités principales">
      <span class="wf-chip" role="listitem"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>Scan & tags auto</span>
      <span class="wf-chip" role="listitem"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>Playlists & Smart Radio</span>
      <span class="wf-chip" role="listitem"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="13"/><line x1="12" y1="9" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="17"/><line x1="20" y1="13" x2="20" y2="3"/><rect x="1.5" y="12.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/><rect x="9.5" y="7.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/><rect x="17.5" y="15.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none"/></svg>EQ 10 bandes</span>
      <span class="wf-chip" role="listitem"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>Stats & historique</span>
    </div>
  </div>
```

The `Dossiers, pochettes et métadonnées...`-style long descriptions are
dropped (the short chip label carries the meaning; full sentences belong
in Paramètres/onboarding tooltips, not a first-run screen). The logo
`alt` text moves to `""` (decorative) since `.wl-hero` is `aria-hidden`
and the adjacent `<h1>` already announces "Bienvenue sur LibreFlow" —
avoids a duplicate screen-reader announcement.

- [ ] **Step 2: Replace the CSS — hero halo + compact chip row**

In `frontend/src/style.css`, delete the `.wfeats`/`.wf*` rule block
(lines 2028-2081, from the `/* Feature cards grid */` comment through
the end of the `.wf-d` rule) and replace it with:

```css
/* Hero halo behind the welcome logo — reuses the emptyPulse keyframe
   already defined for empty-state icons (§1913), same visual language. */
.wl-hero {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.wl-hero::before,
.wl-hero::after {
  content: '';
  position: absolute;
  inset: -14px;
  border-radius: 50%;
  background: rgba(var(--g-rgb), 0.10);
  animation: emptyPulse 2.4s ease-in-out infinite;
}
.wl-hero::after {
  inset: -20px;
  animation-delay: 1.2s;
}
html[data-motion="reduce"] .wl-hero::before,
html[data-motion="reduce"] .wl-hero::after { animation: none; opacity: 0; }

/* Compact feature row — replaces the 4-card description grid. Icon +
   short label only; full descriptions belong in Paramètres, not a
   first-run screen (flagship-polish-pass spec, item B). */
.wf-row {
  display: flex; flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-6);
  max-width: var(--welcome-content-max);
}
.wf-chip {
  display: inline-flex; align-items: center; gap: var(--sp-1h);
  padding: var(--sp-1h) var(--sp-3);
  background: rgba(var(--g-rgb), .08);
  border: var(--border-w-sm) solid rgba(var(--g-rgb), .16);
  border-radius: var(--r-pill, 999px);
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--t2);
}
.wf-chip svg { stroke: var(--g); flex-shrink: 0; }
```

- [ ] **Step 3: Update the light-theme override**

In `frontend/src/style.css`, replace lines 584-585:

```css
html[data-mode="light"] .wf           { background:var(--bg2); border:var(--border-w-sm) solid var(--bg5); }
html[data-mode="light"] .wf:hover     { background:var(--bg3); border-color:var(--bg6); }
```

with:

```css
html[data-mode="light"] .wf-chip      { background:var(--bg2); border-color:var(--bg5); color:var(--t2); }
```

and replace line 604:

```css
html[data-mode="light"] .wf-d           { color: var(--t3); }
```

by deleting it (no `.wf-d` element exists anymore after Step 1).

- [ ] **Step 4: Update the entrance animation selector**

In `frontend/src/style.css`, replace line 5998:

```css
#vw.on .wfeats  { animation: wlFadeIn .34s var(--decelerate) .24s both; }
```

with:

```css
#vw.on .wf-row  { animation: wlFadeIn .34s var(--decelerate) .24s both; }
```

- [ ] **Step 5: Grep-verify no orphaned references remain**

Run: `grep -rn "wfeats\|\"wf \|'wf '\|class=\"wf\"\|\.wf-ico\|\.wf-t\b\|\.wf-d\b" frontend/src frontend/index.html`

Expected: zero matches (all four class names — `wfeats`, `wf`, `wf-ico`,
`wf-t`, `wf-d` — fully removed from both HTML and CSS).

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev` with no library loaded (or clear the library via
Paramètres to force the welcome screen). Confirm: logo sits inside a
slow pulsing halo, both CTAs work unchanged, the 4 feature chips render
in a row below the drag-drop hint, and toggling `prefers-reduced-motion`
(or `data-motion="reduce"`) stops the halo pulse without breaking layout.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/style.css
git commit -m "feat: redesign welcome screen — hero logo halo, compact feature row" -m "Replaces the 4-card feature-description grid (generic SaaS landing pattern) with a hero-centric first-run screen: pulsing halo behind the logo (reuses the existing emptyPulse keyframe) and a single compact chip row for feature discovery."
```

---

### Task 5: Queue panel empty state

**Files:**
- Modify: `frontend/src/queue.js:356-361`
- Modify: `frontend/src/i18n.fr.js:438` (add `queue_empty_s`)
- Modify: `frontend/src/i18n.en.js:438` (add `queue_empty_s`)
- Modify: `frontend/tests/core.test.cjs` (new section 32)

**Interfaces:**
- Consumes: existing `.empty`/`.empty-ico`/`.empty-h`/`.empty-s` CSS
  classes (already defined at `style.css:1885-1924`, already used by
  `renderer.js:405` and reused as-is here — no new CSS needed).
- Produces: no new exports — the queue-render function's signature is
  unchanged.

- [ ] **Step 1: Add the subtitle i18n key**

In `frontend/src/i18n.fr.js`, after line 438
(`queue_empty: "File vide",`), add:

```js
  queue_empty_s:        "Ajoute des titres depuis ta bibliothèque pour les voir apparaître ici.",
```

In `frontend/src/i18n.en.js`, after line 438
(`queue_empty: 'Queue empty',`), add:

```js
  queue_empty_s:        'Add tracks from your library to see them here.',
```

- [ ] **Step 2: Write the failing test**

Add to `frontend/tests/core.test.cjs`, after section 31 (added in
Task 2):

```js
// =============================================================================
// 32. Queue — empty-state markup (reproduced inline)
// =============================================================================
section('queue.js -- empty-state markup (reproduced inline)');

(function () {
  // Reproduces the queue-empty HTML block from queue.js — same .empty
  // pattern already used by renderer.js's main-list empty state.
  function queueEmptyHTML(icoSvg, h, s) {
    return `<div class="empty"><div class="empty-ico">${icoSvg}</div>`
      + `<div class="empty-h">${h}</div><div class="empty-s">${s}</div></div>`;
  }

  const html = queueEmptyHTML('<svg></svg>', 'File vide', 'Ajoute des titres…');
  assert(html.includes('class="empty"'),     'queue empty: classe .empty (réutilise le pattern existant)');
  assert(html.includes('class="empty-ico"'), 'queue empty: icône présente (pas de texte seul)');
  assert(html.includes('class="empty-h"'),   'queue empty: titre présent');
  assert(html.includes('class="empty-s"'),   'queue empty: sous-titre présent');
}());
```

Run: `node frontend/tests/core.test.cjs` — expect PASS (pure string
function, locks the target markup shape before touching `queue.js`).

- [ ] **Step 3: Implement in `queue.js`**

Replace line 357:

```js
    el.innerHTML = html + `<div class="queue-empty">${i18n('queue_empty')}</div>`;
```

with:

```js
    const _qIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>';
    el.innerHTML = html + `<div class="empty"><div class="empty-ico">${_qIco}</div>`
      + `<div class="empty-h">${esc(i18n('queue_empty'))}</div><div class="empty-s">${esc(i18n('queue_empty_s'))}</div></div>`;
```

`esc` is already imported in `frontend/src/queue.js` (line 16:
`import { esc, extEmoji, fmtd, moveByOne } from './utils.js';`) — no new
import needed.

- [ ] **Step 4: Run tests**

Run: `node frontend/tests/core.test.cjs`
Expected: section 32 passes, full suite reports 0 failures.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, clear the queue (or start fresh with nothing queued),
open the queue panel. Confirm: icon + "File vide" + subtitle render
centered, matching the visual weight of the main library's empty state
(same icon halo pulse, same typography scale) rather than the old
plain centered text.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/queue.js frontend/src/i18n.fr.js frontend/src/i18n.en.js frontend/tests/core.test.cjs
git commit -m "feat: give the queue panel's empty state icon+subtitle treatment" -m "Reuses the existing .empty/.empty-ico/.empty-h/.empty-s pattern (already used by the main track list) instead of the queue panel's previous plain-text-only empty state."
```

---

### Task 6: `.sel-action` press state

**Files:**
- Modify: `frontend/src/style.css:5872-5883`

**Interfaces:**
- Consumes: nothing new — pure CSS addition to an existing selector
  block, no JS/HTML changes.
- Produces: nothing consumed elsewhere — purely additive CSS.

- [ ] **Step 1: Add the `:active` rule**

In `frontend/src/style.css`, after line 5879
(`.sel-action:hover { background: var(--bg4); color: var(--t); border-color: var(--sep); }`),
add:

```css
.sel-action:active {
  transform: scale(.96);
  transition-property: transform, background-color, color, border-color;
  transition-duration: var(--motion-fast);
}
html[data-motion="reduce"] .sel-action:active { transform: none; }
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`, select 2+ tracks in the library (checkbox / shift-
click), confirm the batch selection bar (`#sel-bar`) appears, click and
hold "Liker" / "Playlist" / "Tags" / "Supprimer" — confirm a visible
press-down scale on click, matching the feel of `.pc`/`.pcplay` already
in the player bar.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "fix: add missing :active press state to batch-selection toolbar buttons" -m "Brings .sel-action in line with .pc/.pcplay/.pl-lk/.ni, which already have scale(.96)-style tactile feedback — .sel-action was the one remaining high-frequency control without it."
```

---

## Final verification (after all 6 tasks)

- [ ] Run `node frontend/tests/core.test.cjs` — full suite, 0 failures.
- [ ] Run `cargo test` — unaffected by this plan (no Rust files touched),
  confirm still green (regression guard).
- [ ] Run `npm run bench` — confirm no regression; none of these changes
  touch the virtual-scroll render loop's allocation profile (CLAUDE.md
  §10) — the shimmer/class-toggle work is O(1) per row, same as the
  code it replaces.
- [ ] `grep -rn "transition: all" frontend/src/style.css` — expect zero
  matches (house rule preserved).
- [ ] Walk CLAUDE.md §19 pre-commit checklist once for the whole branch.
- [ ] Route to **design-system-engineer** (token reuse — confirm no new
  custom properties were introduced across all 6 tasks) and
  **accessibility-specialist** (welcome-screen restructure, queue empty
  state semantics, reduced-motion fallbacks) per the spec's review
  routing section, before merging.
