# Generator State — Iteration 002

## What Was Built
- Standalone LibreFlow UI mockup at `gan-harness/output/index.html` (sidebar + track list + player bar)
- Vantablack surfaces + Electric Indigo accent, Syne/DM Sans typography

## What Changed This Iteration (addressing all Evaluator feedback)

### Originality (the big change) — dynamic ambient lighting tied to the now-playing track hue
- Each generative cover palette now declares a dominant `hue`; JS pipes the active track's hue into `--np-hue` on `:root`
- Derived HSL token chain (`--np-color`, `--np-color-lo/hi`, `--np-glow`, `--np-wash`, `--np-spill`) so every indigo surface defers to the live hue
- The following all breathe with the current track: `.app::before` ambient wash, player `::before` hairline, `.np-art .ring`, active nav pill, playing-row background/border, equalizer bars, bottom depth fade
- Double-clicking any row re-lights the whole canvas to that track's hue (smooth 0.45–1.1s transitions)
- Activated `.np-art .ring`: rotating conic-gradient at opacity 0.6, 7s linear spin, pauses with playback
- 28×28 generative cover thumbnails on ALL track rows (was only now-playing)
- "NOW PLAYING" badge chip with a live pulse dot above the track name in the player bar

### Design Quality — differentiated the three glow gestures
- Gesture 1 (ambient): wide 1100–1300px low-opacity radial wash, slow 13s breathe, slight hue offset between sources — atmosphere
- Gesture 2 (hairline): crisp 1px luminous centered edge with soft box-shadow — the most defined gesture
- Gesture 3 (bottom): true multi-stop depth ramp (4 opacity stops) + thin hue spill, no longer a flat single gradient

### Craft
- Global `:focus-visible` dual-halo ring on all interactive elements; circular variant for play/ctrl buttons
- Seek/volume fill glow now uses `filter: drop-shadow` and removed `overflow:hidden` on the rail (no more clipped glow)
- Replaced all `transition: all` with explicit property lists
- Fixed queue button SVG dead paths (removed `r="0"`, `opacity="0"`, duplicate paths) — now a clean list+download-arrow glyph
- Added `:active` press feedback to hearts, util, np-like buttons

### Additional pushes
- Hover on non-playing rows swaps the row number for a play triangle
- Sidebar dot-grid texture at ~2% opacity (replaced line-grid)
- `<!-- DEMO ONLY: ... @fontsource ... -->` comment near the font link
- `prefers-reduced-motion` guard disables all decorative animation
- Keyboard support: nav items focusable + Enter/Space activation, ARIA labels on icon buttons

## Known Issues
- None known. Demo is cosmetic-only per spec; no Tauri/audio logic by design.

## Dev Server
- URL: http://localhost:3000/index.html
- Status: running (http-server, background id bwhinileo)
- Command: npx http-server -p 3000 -c-1 (from gan-harness/output)
