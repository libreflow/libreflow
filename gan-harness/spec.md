# LibreFlow — Design Evaluation Brief

## Context
LibreFlow is a premium offline desktop music player built with Tauri 2 + Vanilla JS.
Target: audiophiles and music lovers who want a beautiful, distraction-free local player.

## Design Language (existing)
- **Palette:** Vantablack surfaces (#030303 base → #060606 cards → #0A0A0A modals)
- **Accent:** Electric Indigo #8B6BFF (hover: #A084FF, active: #6F4DEB, glow: rgba(139,107,255,0.45))
- **Text:** --text-primary #F5F6F8 (19:1) / --text-secondary #B4B7C2 (10.3:1) / --text-muted #979CAC (7.5:1)
- **Fonts:** Syne (display/brand) + DM Sans (body/UI), self-hosted via @fontsource
- **Radius:** 8px cards, 12px modals, 6px buttons
- **Layout:** Fixed sidebar 240px | Main scrollable | Player bar bottom 72px

## Key UI Surfaces
1. **Player Bar (bottom)** — album art 48×48, track name/artist, play/prev/next/shuffle/repeat controls, seek bar, volume slider, queue/EQ/cinema/speed buttons
2. **Sidebar** — LibreFlow logo + dot, search input, nav items (All Tracks, Liked, Recent, Playlists, Artists, Albums, Radio, Stats), scan folder button
3. **Track List** — virtual-scroll rows with title/artist/album/duration, hover state, active (playing) row with indigo accent
4. **Album/Artist grid** — card grid with cover art, name, sub-info

## Design Task
Create a **standalone HTML demo** (`output/index.html`) that showcases the LibreFlow UI at its absolute visual peak. This is a **static mockup** — no Tauri, no JS logic needed beyond cosmetic interactions.

Focus areas for maximum design impact:
1. **Player bar** — center the play button perfectly; ensure the circular play button feels premium
2. **Track list row** — the "now playing" row with animated equalizer bars, album art thumbnail
3. **Sidebar navigation** — active state with indigo pill/accent, hover states
4. **Overall spatial rhythm** — breathing room, alignment, micro-details that signal quality

## Constraints
- Self-contained HTML (inline CSS + minimal inline JS for hover states)
- No external network resources (fonts via @fontsource CDN is acceptable for demo purposes since this is a mockup, not the actual app)
- Must reproduce the exact color palette above
- Target 1280×800 viewport (desktop PC)
- Dark mode only (the theme is always dark)

## Inspiration References
- Apple Music desktop (spatial rhythm, album art integration)
- Spotify desktop (sidebar hierarchy, track row density)
- Vinyls app (tactile feel of controls)
- But: MORE distinctive, MORE premium, MORE character than any of the above
