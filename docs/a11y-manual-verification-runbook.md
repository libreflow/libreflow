# LibreFlow — Accessibility Manual Verification Runbook

> The automated suites (`npm test` → a11y 22 checks + palette 20 checks) lock the
> **code-side** WCAG conformance. This runbook covers what a headless run **cannot**
> verify: screen-reader announcements, keyboard flow, 400% reflow, text-spacing, and
> visual focus/contrast. Run it before each release; record pass/fail in the sign-off
> table at the bottom.

**Target conformance:** WCAG 2.2 **Level AA** (with AAA for 1.4.6, 2.3.3, 2.4.12, 2.4.13).
**Screen reader:** NVDA (Windows — the libreflow target). **Browser engine:** the Tauri WebView (Chromium).
**Themes:** run every visual check in **both** dark (Vantablack) and light mode (toggle: titlebar theme button or `Ctrl+,` → Apparence).

---

## 0. Setup

1. Build/run the app: `npm run dev` → load a real folder of **1k+ tracks** (needed for virtual scroll + group headers).
2. Start **NVDA** (Insert+Q to quit later). Use **NVDA+F7** for the elements list (headings/landmarks/links).
3. **Text-spacing bookmarklet** (for §13) — paste in DevTools console:
   ```js
   document.querySelectorAll('*').forEach(e=>{e.style.lineHeight='1.5';e.style.letterSpacing='.12em';e.style.wordSpacing='.16em';});
   ```
4. **Zoom** for reflow (§12): Ctrl++ to 400%, or resize the window narrow.

Legend: ✅ pass · ⚠️ minor · ❌ fail (file an issue with the SC + step).

---

## 1. Boot & global structure — SC 1.3.1, 4.1.2, 2.4.1

| # | Step | Expected |
|---|------|----------|
| 1.1 | Launch app, listen | NVDA announces the app; `#boot-spinner` has `role="status"` ("Chargement…") |
| 1.2 | Press **Tab** once from top | First stop is the **skip link** ("Aller au contenu"); Enter jumps focus into the track list |
| 1.3 | NVDA+F7 → Landmarks | Exactly one **search**, one **navigation** ("Navigation principale"), one **main**, plus region "Contrôles de lecture" and complementary "File d'attente". **No nested/duplicate navigation.** |
| 1.4 | NVDA+F7 → Headings | The active view exposes a heading (welcome `h1`, or view title `role=heading aria-level=1`). Only one level-1 in the live view. |

## 2. Sidebar navigation & search — SC 1.3.1, 4.1.2, 2.5.8

| # | Step | Expected |
|---|------|----------|
| 2.1 | Tab to search box | NVDA: "Rechercher dans la bibliothèque, zone de recherche" (search landmark) |
| 2.2 | Tab through nav items | Each announces name + "élément de navigation"; current view item has **aria-current** ("page") |
| 2.3 | Hover/measure nav + toolbar icon buttons | Hit target ≥ **24×24px** (SC 2.5.8) |

## 3. Track list (virtual scroll) — SC 1.3.1, 4.1.2, 2.4.3, 2.4.7

| # | Step | Expected |
|---|------|----------|
| 3.1 | Focus list, **Arrow Down/Up** | Focus moves row to row; virtual scroll advances at edges; only the active row is the tab stop (roving tabindex) |
| 3.2 | On a row, listen | NVDA reads title + artist + **"X sur Y"** (aria-setsize/aria-posinset) |
| 3.3 | Play a track, arrow to it | Active row announces **"en cours"** (aria-current="true") — and it's a filled-icon cue, not color-only |
| 3.4 | **Home / End / PageUp / PageDown** | Jump to first / last / by viewport; focus follows |
| 3.5 | Tab to a row's **like / add / edit** icon buttons | Each has a name; visible **focus ring**; target ≥24px |

## 4. Player bar — SC 4.1.2, 1.4.1, 2.1.1, 2.5.8

| # | Step | Expected |
|---|------|----------|
| 4.1 | Tab through transport | play/pause, prev, next, shuffle, repeat each announce name + **pressed state** where toggle |
| 4.2 | Focus **seek bar**, Arrow/PageUp/Home/End | Announces "Position de lecture", value as **time** ("1:23 / 3:45"); keys seek |
| 4.3 | Focus **volume**, Arrow Up/Down | Announces **percentage** ("74 pour cent / %"), not "0.74" |
| 4.4 | Toggle **like** in bar | State flips; AT announces liked/unliked; non-color cue present |
| 4.5 | Long title in bar → hover or focus `.pl-info` | Marquee scroll **pauses** (SC 2.2.2); full title also in tooltip + Now Playing view |

## 5. Reorder alternatives (no drag required) — SC 2.5.7

| # | Step | Expected |
|---|------|----------|
| 5.1 | Open a **manual playlist** (no filter), right-click a track | Context menu shows **"Déplacer vers le haut/bas"**; clicking reorders |
| 5.2 | Focus a track in that playlist, **Alt+↑ / Alt+↓** | Track moves one step; focus follows the moved row |
| 5.3 | Open the **Queue**, hover an explicit item | **▲ / ▼** buttons appear (also on focus); click reorders |
| 5.4 | Right-click a **playlist in the sidebar** | Menu shows **"Déplacer vers le haut/bas"**; reorders the sidebar |
| 5.5 | Smart playlist / filtered view | Move items **not** offered (correct — order is derived) |

## 6. Modals & overlays — SC 2.1.2, 2.4.3, 1.3.1

For **each** modal — Settings, Organize, USB import, CD audio, Tag editor, Smart playlist, Doublons, Playlist create/rename, Shortcuts (`?`), Confirm dialogs:

| # | Step | Expected |
|---|------|----------|
| 6.1 | Open it | NVDA announces "boîte de dialogue / modal"; focus moves inside; first control focused |
| 6.2 | **Tab / Shift+Tab** repeatedly | Focus **stays trapped** inside; never reaches background |
| 6.3 | Press **Escape** (or close button) | Modal closes; **focus returns to the trigger** |
| 6.4 | Backdrop click | Closes (where applicable); backdrop is `aria-hidden` (not a tab stop) |

## 7. Cinema mode — SC 4.1.2, 2.1.2, 2.4.3, 2.3.1

| # | Step | Expected |
|---|------|----------|
| 7.1 | Play a track, open cinema (`C`) | NVDA: "Mode cinéma, boîte de dialogue, modal" |
| 7.2 | Tab through controls | Focus trapped inside; Escape closes and restores focus |
| 7.3 | Watch the beat pulse on busy music | Art **scales/glows** with beats but never strobes (cooldown ≥650ms ⇒ ≤~1.5/s) — no flashing |

## 8. EQ panel — SC 4.1.2, 2.5.8

| # | Step | Expected |
|---|------|----------|
| 8.1 | Open EQ, Tab to a band slider | NVDA: "Bande Z Hz, curseur, **orientation verticale**, X dB" (aria-orientation + aria-valuetext) |
| 8.2 | Adjust with arrows | dB value updates in the announcement; the visible dB value/scale text is **legible** (not near-invisible) |

## 9. Keyboard shortcuts hygiene — SC 2.1.1, 2.1.2

| # | Step | Expected |
|---|------|----------|
| 9.1 | Click in search, type "play space stop" | Single-key shortcuts (Space/s/r/f/c…) **do not** fire while typing |
| 9.2 | Press **Escape** in the search field | Field blurs (doesn't trigger global Escape chain unexpectedly) |
| 9.3 | Outside any field, single keys | Shortcuts work (Space play, ←/→ prev/next, etc.) |

## 10. Destructive action recovery — SC 2.2.1

| # | Step | Expected |
|---|------|----------|
| 10.1 | Multi-select 3 tracks → Remove | Toast lasts **15s**, mentions **Ctrl+Z** |
| 10.2 | Press **Ctrl+Z** within 15s (not in a field) | Tracks restored, playlists order preserved |

## 11. Language & motion — SC 3.1.2, 2.3.3, 2.3.1

| # | Step | Expected |
|---|------|----------|
| 11.1 | Settings → switch to English | `<html lang>` becomes `en` (DevTools); NVDA switches voice/pronunciation |
| 11.2 | OS setting "reduce motion" ON → relaunch | Cinema/visualizer/marquee/spring animations **do not loop** (global kill-switch) |
| 11.3 | Play loud music, watch visualizer + cinema | No area flashes **> 3×/sec** (SC 2.3.1) |

## 12. Reflow @ 400% — SC 1.4.10  *(visual)*

Zoom to **400%** (or narrow the window). For **each** view — Library, Album detail, Artist, Genres, Playlists, Stats, Now Playing, Settings, Queue, EQ:

| # | Step | Expected |
|---|------|----------|
| 12.1 | Inspect each view at 400% | Content reflows to one column; **no horizontal scrollbar**; no clipped/overlapping controls (sidebar → icon-only, panels → overlays, grids → fewer columns) |
| 12.2 | Note the `--app-min-w: 520px` edge | Below ~520px effective width some 2D scroll may appear — confirm it's acceptable for the desktop window min (600px) |

## 13. Text spacing override — SC 1.4.12  *(visual)*

Apply the §0.3 bookmarklet (line-height 1.5, letter 0.12em, word 0.16em):

| # | Step | Expected |
|---|------|----------|
| 13.1 | Scan all views + modals | No clipped or overlapping text; truncated labels (`…`) still expose full text via tooltip |
| 13.2 | Check fixed-height containers (cards, modal bodies) | Text not cut off |

## 14. Focus appearance & contrast — SC 2.4.13, 2.4.11, 1.4.6  *(visual, both themes)*

| # | Step | Expected |
|---|------|----------|
| 14.1 | Tab through the whole app, both themes | Focus indicator always visible: 2px accent ring + **neutral contrast ring** + halo; never hidden under sticky headers/player bar |
| 14.2 | Switch accent to a low-contrast color | The **neutral** ring keeps focus visible (≥3:1) regardless of accent |
| 14.3 | Read primary/secondary/muted text, both themes | All three tiers clearly legible (≥7:1) yet visually distinct (hierarchy preserved) |

---

## Sign-off

| Section | Dark | Light | Notes |
|---|---|---|---|
| 1 Boot & structure | ☐ | ☐ | |
| 2 Sidebar & search | ☐ | ☐ | |
| 3 Track list | ☐ | ☐ | |
| 4 Player bar | ☐ | ☐ | |
| 5 Reorder alternatives | ☐ | ☐ | |
| 6 Modals | ☐ | ☐ | |
| 7 Cinema | ☐ | ☐ | |
| 8 EQ | ☐ | ☐ | |
| 9 Shortcuts hygiene | ☐ | ☐ | |
| 10 Destructive recovery | ☐ | ☐ | |
| 11 Language & motion | ☐ | ☐ | |
| 12 Reflow @400% | ☐ | ☐ | |
| 13 Text spacing | ☐ | ☐ | |
| 14 Focus & contrast | ☐ | ☐ | |

**Tester:** ______  **Date:** ______  **Build/commit:** ______  **Result:** ☐ AA sign-off  ☐ AA + AAA (1.4.6/2.3.3/2.4.12/2.4.13)

> Code-side guardrails: `frontend/tests/a11y.test.cjs` (22), `frontend/tests/theme-palette.test.cjs` (20).
> Conformance tags: `v-a11y-aa`, `v-a11y-2.2`, `v-a11y-2.2-aaa-focus`, `v-a11y-aaa-contrast`.
