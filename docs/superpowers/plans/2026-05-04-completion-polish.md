# Completion & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring LibreFlow to Spotify/Deezer quality by completing three incomplete features: Now Playing panel, enriched Album/Artist drill pages, and technical track info display.

**Architecture:** Three independent sprints — Sprint 1 adds `nowplaying.js` (new module) wired via bus events and IPC; Sprint 2 adds `renderDrillHeader()` in renderer.js for album drill views; Sprint 3 extends that function for artist drill views with a mini album grid.

**Tech Stack:** Tauri 2.0 (Rust/lofty), Vanilla JS (ESM), bus.js events, IDB store, existing `read_audio_props` IPC command.

---

## Pre-work: Key facts about the existing codebase

- `read_audio_props(path)` already exists in `src-tauri/src/commands.rs:444` — returns `{ bitrate, sample_rate, channels, bit_depth }`. It does NOT currently return `file_size`.
- Album-detail sort by track number is **already implemented** in `frontend/src/search.js:293` — no change needed.
- Track tech data (`t.bitDepth`, `t.sampleRate`, `t.bitrate`, `t.ext`) is already stored in IDB after tag loading.
- Queue panel pattern: `panel.classList.toggle('open', open)` + `btn.classList.toggle('active', open)` + `app.classList.toggle('panel-X-open', open)`.
- `EVENTS.TRACK_CHANGE` payload: `{ track, idx }` — emitted by player.js.
- `_getAlbumMap()` and `_getArtistMap()` are private functions in renderer.js — they must be called from within renderer.js only.
- `drillDown(from, key, displayName)` is exported from renderer.js.
- handlers.js line 62 imports `{ playById, scrollToCurrentTrack }` from renderer.js — `drillDown` must be added to this import.

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Create | `frontend/src/nowplaying.js` | New module: formatters + panel logic |
| Modify | `src-tauri/src/commands.rs` | Add `file_size` to `AudioPropsResult` |
| Modify | `frontend/index.html` | `#now-playing-panel`, `#btn-nowplaying`, `data-action` on `.pl-info` |
| Modify | `frontend/src/handlers.js` | Import nowplaying + 4 new actions + `drillDown` import |
| Modify | `frontend/src/app.js` | Import nowplaying + expose 3 globals on window |
| Modify | `frontend/src/renderer.js` | `renderDrillHeader()` + track number in `thtml()` |
| Modify | `frontend/src/style.css` | Styles: `#now-playing-panel`, `.np-*`, `.drill-header`, `.dh-*` |
| Modify | `frontend/tests/core.test.cjs` | Sections 10 (nowplaying formatters) + 11 (filterAlbumsByArtist) |

---

## Task 1 — TDD: nowplaying formatter tests

**Files:**
- Modify: `frontend/tests/core.test.cjs` (append after `// -- Resultat ---`)
- Note: tests are appended BEFORE the `// -- Resultat ---` block

- [ ] **Step 1: Write the failing tests for formatter functions**

Open `frontend/tests/core.test.cjs` and append the following two sections BEFORE the `// -- Resultat ---` block:

```javascript
// ── Section 10 : nowplaying formatters ────────────────────────────────────
(function testNowPlayingFormatters() {
  // Inline pure re-implementations to test the logic without importing ESM
  function formatCodec(ext) {
    if (!ext) return '–';
    const upper = ext.toUpperCase();
    const MAP = { MP3:'MP3', FLAC:'FLAC', M4A:'AAC/ALAC', OGG:'OGG Vorbis',
                  OPUS:'Opus', WAV:'WAV', AIFF:'AIFF', AIF:'AIFF', APE:'APE', WMA:'WMA' };
    return MAP[upper] || upper;
  }
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '–';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }
  function formatBitDepth(bitDepth, sampleRate) {
    const parts = [];
    if (bitDepth)   parts.push(bitDepth + ' bit');
    if (sampleRate) parts.push((sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1) + ' kHz');
    return parts.join(' / ') || '–';
  }
  function formatBitrate(bitrate) {
    if (!bitrate) return '–';
    return bitrate + ' kbps';
  }

  assert(formatCodec('flac')  === 'FLAC',        'formatCodec: flac → FLAC');
  assert(formatCodec('mp3')   === 'MP3',         'formatCodec: mp3  → MP3');
  assert(formatCodec('m4a')   === 'AAC/ALAC',    'formatCodec: m4a  → AAC/ALAC');
  assert(formatCodec('ogg')   === 'OGG Vorbis',  'formatCodec: ogg  → OGG Vorbis');
  assert(formatCodec('opus')  === 'Opus',        'formatCodec: opus → Opus');
  assert(formatCodec('')      === '–',           'formatCodec: empty → –');
  assert(formatCodec(null)    === '–',           'formatCodec: null  → –');
  assert(formatCodec('xyz')   === 'XYZ',         'formatCodec: unknown ext uppercased');

  assert(formatFileSize(0)           === '–',          'formatFileSize: 0 → –');
  assert(formatFileSize(null)        === '–',          'formatFileSize: null → –');
  assert(formatFileSize(1024)        === '1.0 Ko',     'formatFileSize: 1024 → 1.0 Ko');
  assert(formatFileSize(1048576)     === '1.0 Mo',     'formatFileSize: 1 MiB → 1.0 Mo');
  assert(formatFileSize(44369920)    === '42.3 Mo',    'formatFileSize: 42.3 Mo');

  assert(formatBitDepth(24, 96000)  === '24 bit / 96 kHz',   'formatBitDepth: 24/96');
  assert(formatBitDepth(16, 44100)  === '16 bit / 44.1 kHz', 'formatBitDepth: 16/44.1');
  assert(formatBitDepth(null, null) === '–',                  'formatBitDepth: nulls → –');
  assert(formatBitDepth(16, null)   === '16 bit',             'formatBitDepth: depth only');
  assert(formatBitDepth(null, 48000)=== '48 kHz',             'formatBitDepth: rate only');

  assert(formatBitrate(320)  === '320 kbps', 'formatBitrate: 320');
  assert(formatBitrate(1024) === '1024 kbps','formatBitrate: 1024');
  assert(formatBitrate(null) === '–',        'formatBitrate: null → –');
  assert(formatBitrate(0)    === '–',        'formatBitrate: 0 → –');
}());

// ── Section 11 : filterAlbumsByArtist ─────────────────────────────────────
(function testFilterAlbumsByArtist() {
  function filterAlbumsByArtist(albums, artistKey) {
    return albums.filter(a => (a.artist || '').toLowerCase() === artistKey);
  }

  const albums = [
    { displayName: 'OK Computer', artist: 'Radiohead', key: 'ok computer' },
    { displayName: 'Kid A',       artist: 'Radiohead', key: 'kid a' },
    { displayName: 'Homework',    artist: 'Daft Punk', key: 'homework' },
    { displayName: 'Discovery',   artist: 'Daft Punk', key: 'discovery' },
  ];

  const rh = filterAlbumsByArtist(albums, 'radiohead');
  assert(rh.length === 2,                      'filter: 2 Radiohead albums');
  assert(rh[0].displayName === 'OK Computer',  'filter: first Radiohead album');

  const dp = filterAlbumsByArtist(albums, 'daft punk');
  assert(dp.length === 2,                      'filter: 2 Daft Punk albums');

  const none = filterAlbumsByArtist(albums, 'unknown artist');
  assert(none.length === 0,                    'filter: unknown artist → empty');

  const empty = filterAlbumsByArtist([], 'radiohead');
  assert(empty.length === 0,                   'filter: empty albums → empty');
}());
```

- [ ] **Step 2: Run the tests — expect PASS (logic is inline, no imports needed)**

```bash
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
node frontend/tests/core.test.cjs
```

Expected: All existing 94 tests pass + 22 new tests pass (total ≥ 116 OK, 0 KO).

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/core.test.cjs
git commit -m "test: add sections 10-11 for nowplaying formatters and filterAlbumsByArtist"
```

---

## Task 2 — Rust: add `file_size` to `AudioPropsResult`

**Files:**
- Modify: `src-tauri/src/commands.rs:437-465`

- [ ] **Step 1: Add `file_size` field to the struct and populate it**

In `src-tauri/src/commands.rs`, replace the `AudioPropsResult` struct and `read_audio_props` function:

```rust
#[derive(Serialize)]
pub struct AudioPropsResult {
    pub bitrate:     Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels:    Option<u8>,
    pub bit_depth:   Option<u8>,
    pub file_size:   Option<u64>,  // bytes
}

#[tauri::command]
pub async fn read_audio_props(path: String) -> Option<AudioPropsResult> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() { return None; }
        let file_size = std::fs::metadata(p).map(|m| m.len()).ok();
        let tagged = Probe::open(p)
            .ok()?
            .guess_file_type()
            .ok()?
            .read()
            .ok()?;
        let props = tagged.properties();
        Some(AudioPropsResult {
            bitrate:     props.audio_bitrate(),
            sample_rate: props.sample_rate(),
            channels:    props.channels(),
            bit_depth:   props.bit_depth(),
            file_size,
        })
    })
    .await
    .unwrap_or(None)
}
```

- [ ] **Step 2: Build to verify no Rust errors**

```bash
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(rust): add file_size to AudioPropsResult"
```

---

## Task 3 — Create `nowplaying.js`

**Files:**
- Create: `frontend/src/nowplaying.js`

- [ ] **Step 1: Create the file**

```javascript
// LibreFlow — nowplaying.js
// Panneau "Now Playing" : infos enrichies sur la piste en cours.
// Ouverture via click sur .pl-info ou #btn-nowplaying.
// Met à jour automatiquement via EVENTS.TRACK_CHANGE (pas de modif player.js).

import { invoke }        from './ipc.js';
import { on, EVENTS }   from './bus.js';
import { get }          from './store.js';
import { esc }          from './utils.js';
import { closeQueue }   from './queue.js';
import { closeEQ }      from './eq.js';

export let nowPlayingOpen = false;

const _techInfoCache = new Map(); // path → AudioPropsResult

// ── Formatters (pure — also tested in core.test.cjs section 10) ──────────

export function formatCodec(ext) {
  if (!ext) return '–';
  const upper = ext.toUpperCase();
  const MAP = {
    MP3: 'MP3', FLAC: 'FLAC', M4A: 'AAC/ALAC',
    OGG: 'OGG Vorbis', OPUS: 'Opus', WAV: 'WAV',
    AIFF: 'AIFF', AIF: 'AIFF', APE: 'APE', WMA: 'WMA',
  };
  return MAP[upper] || upper;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '–';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

export function formatBitDepth(bitDepth, sampleRate) {
  const parts = [];
  if (bitDepth)   parts.push(bitDepth + ' bit');
  if (sampleRate) parts.push((sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1) + ' kHz');
  return parts.join(' / ') || '–';
}

export function formatBitrate(bitrate) {
  if (!bitrate) return '–';
  return bitrate + ' kbps';
}

// ── IPC (lazy, cached) ────────────────────────────────────────────────────

async function _loadTechInfo(path) {
  if (_techInfoCache.has(path)) return _techInfoCache.get(path);
  try {
    const info = await invoke('read_audio_props', { path });
    _techInfoCache.set(path, info);
    return info;
  } catch { return null; }
}

// ── Render ────────────────────────────────────────────────────────────────

function _renderNowPlaying(t, info) {
  const panel = document.getElementById('now-playing-panel');
  if (!panel) return;

  const artH = t.art
    ? `<img src="${t.art}" class="np-art" alt="">`
    : `<div class="np-art np-art-ph"></div>`;

  const codec    = formatCodec(t.ext);
  const bitrate  = formatBitrate(info?.bitrate ?? t.bitrate ?? null);
  const quality  = formatBitDepth(info?.bit_depth ?? t.bitDepth ?? null, info?.sample_rate ?? t.sampleRate ?? null);
  const fileSize = info?.file_size ? formatFileSize(info.file_size) : '–';

  const isLiked    = get('liked').has(t.id);
  const artistKey  = (t.artist || '').toLowerCase();
  const albumKey   = (t.album  || '').toLowerCase();

  panel.innerHTML = `
    <div class="np-header">
      <button class="np-close" data-action="close-now-playing" aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="np-body">
      ${artH}
      <div class="np-meta">
        <div class="np-title">${esc(t.name || '–')}</div>
        <div class="np-sub">${esc(t.artist || '–')}${t.album ? ' · ' + esc(t.album) : ''}${t.year ? ' · ' + t.year : ''}</div>
        <button class="np-lk${isLiked ? ' active' : ''}" data-action="toggle-like"
                aria-label="Favori" aria-pressed="${isLiked}">
          <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.35l-.77-.77a5.4 5.4 0 0 0-7.65 7.65l.77.77L12 20.77l7.65-7.77.77-.77a5.4 5.4 0 0 0 0-7.65z"/>
          </svg>
        </button>
      </div>
      <div class="np-tech">
        <div class="np-tech-title">Infos techniques</div>
        <div class="np-tech-row"><span>Format</span><span>${esc(codec)}</span></div>
        <div class="np-tech-row"><span>Bitrate</span><span>${esc(bitrate)}</span></div>
        <div class="np-tech-row"><span>Qualité</span><span>${esc(quality)}</span></div>
        <div class="np-tech-row"><span>Taille</span><span>${esc(fileSize)}</span></div>
      </div>
      <div class="np-links">
        ${t.album  ? `<button class="np-link" data-action="np-drill-album"
                        data-album-key="${esc(albumKey)}"
                        data-album-name="${esc(t.album || '')}">→ Voir l'album</button>` : ''}
        ${t.artist ? `<button class="np-link" data-action="np-drill-artist"
                        data-artist-key="${esc(artistKey)}"
                        data-artist-name="${esc(t.artist || '')}">→ Voir l'artiste</button>` : ''}
      </div>
    </div>`;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function openNowPlaying() {
  nowPlayingOpen = true;
  document.getElementById('now-playing-panel')?.classList.add('open');
  document.getElementById('btn-nowplaying')?.classList.add('active');
  document.getElementById('app')?.classList.add('panel-np-open');
  closeQueue();
  closeEQ();
  const t = get('tracks')[get('curIdx')];
  if (!t) return;
  _renderNowPlaying(t, null);
  const info = await _loadTechInfo(t.path);
  if (nowPlayingOpen) _renderNowPlaying(t, info);
}

export function closeNowPlaying() {
  nowPlayingOpen = false;
  document.getElementById('now-playing-panel')?.classList.remove('open');
  document.getElementById('btn-nowplaying')?.classList.remove('active');
  document.getElementById('app')?.classList.remove('panel-np-open');
}

export function toggleNowPlaying() {
  if (nowPlayingOpen) closeNowPlaying(); else openNowPlaying();
}

export function updateNowPlaying(track) {
  if (!nowPlayingOpen || !track) return;
  _renderNowPlaying(track, _techInfoCache.get(track.path) ?? null);
  _loadTechInfo(track.path).then(info => {
    if (nowPlayingOpen) _renderNowPlaying(track, info);
  });
}

// Auto-update when track changes (no modification to player.js)
on(EVENTS.TRACK_CHANGE, ({ track }) => updateNowPlaying(track));
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/nowplaying.js
git commit -m "feat: add nowplaying.js module with panel logic and formatters"
```

---

## Task 4 — index.html: Now Playing panel + button

**Files:**
- Modify: `frontend/index.html`

Three changes needed:

**Change A** — Add `data-action="toggle-now-playing"` to `.pl-info` (line ~233):

- [ ] **Step 1: Add click trigger on `.pl-info`**

Find the line:
```html
  <div class="pl-info">
```
Replace with:
```html
  <div class="pl-info" data-action="toggle-now-playing" style="cursor:pointer">
```

**Change B** — Add `#btn-nowplaying` in `.pl-r` (after `#btn-speed`, before `#sleep-indicator`):

- [ ] **Step 2: Add the Now Playing button**

Find in `.pl-r`:
```html
      <button class="pl-queue-btn pl-speed-btn" id="btn-speed" data-action="cycle-speed"
```
Before that line, insert:
```html
      <button class="pl-queue-btn" id="btn-nowplaying" data-action="toggle-now-playing"
              title="Now Playing" aria-label="Now Playing">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </button>
```

**Change C** — Add `#now-playing-panel` as a sibling of `#queue-panel` (search for the queue panel and add after it):

- [ ] **Step 3: Add the panel element**

Find in index.html:
```html
<div id="queue-panel"
```
After the closing `</div>` of `#queue-panel`, add:
```html
<div id="now-playing-panel" role="dialog" aria-label="Now Playing"></div>
```

To find the exact closing tag of `#queue-panel`, search for `id="queue-panel"` in index.html and find its closing `</div>`. Add the new panel after it.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "feat(html): add now-playing panel element and trigger button"
```

---

## Task 5 — handlers.js: wire Now Playing actions

**Files:**
- Modify: `frontend/src/handlers.js`

- [ ] **Step 1: Add nowplaying import**

Find line 62:
```javascript
import { playById, scrollToCurrentTrack }                      from './renderer.js';
```
Replace with:
```javascript
import { playById, scrollToCurrentTrack, drillDown }           from './renderer.js';
```

- [ ] **Step 2: Add nowplaying module import**

After the last import line (before `// ── Registre d'actions`), add:
```javascript
import { toggleNowPlaying, closeNowPlaying }                   from './nowplaying.js';
```

- [ ] **Step 3: Add four new actions to `_ACTIONS`**

Find the section `// ── Queue` in `_ACTIONS` and add the Now Playing block before it:

```javascript
  // ── Now Playing ───────────────────────────────────────────
  'toggle-now-playing':    ()    => toggleNowPlaying(),
  'close-now-playing':     ()    => closeNowPlaying(),
  'np-drill-album':        btn  => { closeNowPlaying(); drillDown('albums', btn.dataset.albumKey, btn.dataset.albumName); },
  'np-drill-artist':       btn  => { closeNowPlaying(); drillDown('artists', btn.dataset.artistKey, btn.dataset.artistName); },
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/handlers.js
git commit -m "feat(handlers): wire Now Playing actions"
```

---

## Task 6 — app.js: import nowplaying + expose globals

**Files:**
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Add import**

After the last import block (find a suitable place near the other module imports, e.g., after the `./waveform.js` import on line ~62), add:

```javascript
import { toggleNowPlaying, closeNowPlaying, updateNowPlaying,
         nowPlayingOpen }                                      from './nowplaying.js';
```

- [ ] **Step 2: Expose globals**

Find the section in app.js where other globals are exposed via `window.*` (search for `window.toggleQueue` or `window.closeQueue` or similar). Add alongside those:

```javascript
window.toggleNowPlaying = toggleNowPlaying;
window.closeNowPlaying  = closeNowPlaying;
window.updateNowPlaying = updateNowPlaying;
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app.js
git commit -m "feat(app): import and expose nowplaying globals"
```

---

## Task 7 — style.css: Now Playing panel styles

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add styles for the panel**

Append the following block to `frontend/src/style.css` (at the end, or in the panels section near `#queue-panel` styles):

```css
/* ── Now Playing Panel ───────────────────────────────────────────────────── */
#now-playing-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: calc(100% - var(--pl-h, 72px));
  background: var(--bg2);
  border-left: 1px solid var(--bg4);
  z-index: 120;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform .25s cubic-bezier(.4,0,.2,1);
  overflow-y: auto;
}
#now-playing-panel.open {
  transform: translateX(0);
}
.np-header {
  display: flex;
  justify-content: flex-end;
  padding: 12px 12px 0;
  flex-shrink: 0;
}
.np-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--t2);
  padding: 6px;
  border-radius: var(--r);
  display: flex;
  align-items: center;
}
.np-close:hover { color: var(--t1); background: var(--bg3); }
.np-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 24px;
  gap: 16px;
}
.np-art {
  width: 220px;
  height: 220px;
  border-radius: var(--r);
  object-fit: cover;
  flex-shrink: 0;
  margin-top: 8px;
}
.np-art-ph {
  background: var(--bg3);
}
.np-meta {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}
.np-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-sub {
  font-size: 13px;
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-lk {
  position: absolute;
  top: 0;
  right: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--t3);
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
}
.np-lk:hover { color: var(--t1); }
.np-lk.active { color: var(--g); }
.np-tech {
  width: 100%;
  background: var(--bg3);
  border-radius: var(--r);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.np-tech-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--t3);
  margin-bottom: 4px;
}
.np-tech-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.np-tech-row span:first-child { color: var(--t2); }
.np-tech-row span:last-child  { color: var(--t1); font-weight: 500; }
.np-links {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.np-link {
  background: none;
  border: 1px solid var(--bg5);
  border-radius: var(--r);
  padding: 9px 14px;
  font-size: 13px;
  color: var(--t2);
  cursor: pointer;
  text-align: left;
  transition: background .15s, color .15s;
}
.np-link:hover { background: var(--bg3); color: var(--t1); }

/* Adjust main content when NP panel is open */
#app.panel-np-open #main    { margin-right: 320px; }
#app.panel-np-open #sidebar { /* sidebar stays — panel is over it */ }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(css): add Now Playing panel styles"
```

---

## Task 8 — Sprint 2: `renderDrillHeader()` for album-detail

**Files:**
- Modify: `frontend/src/renderer.js`

- [ ] **Step 1: Add `renderDrillHeader()` function**

Add the following function just before `renderLib()` (before line 222 `// ══ Rendu principal`):

```javascript
// ══ Drill header ═══════════════════════════════════════════════════════════

function _getOrCreateDrillHeader() {
  let el = document.getElementById('drill-header');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drill-header';
    const tlist = document.getElementById('tlist');
    tlist?.parentNode?.insertBefore(el, tlist);
  }
  return el;
}

function _removeDrillHeader() {
  document.getElementById('drill-header')?.remove();
}

function renderDrillHeader(view, key) {
  if (view === 'album-detail') {
    const albums = _getAlbumMap();
    const entry  = albums.find(a => a.key === key);
    if (!entry) { _removeDrillHeader(); return; }

    const el = _getOrCreateDrillHeader();
    const artH = entry.art
      ? `<img src="${entry.art}" class="dh-art" alt="">`
      : `<div class="dh-art dh-art-ph"></div>`;
    const mins = Math.floor((entry.totalDuration || 0) / 60);
    const artistKey = (entry.artist || '').toLowerCase();

    el.className = 'drill-header';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          ${entry.artist
            ? `<button class="dh-artist-link" data-action="dh-drill-artist"
                 data-artist-key="${esc(artistKey)}"
                 data-artist-name="${esc(entry.artist)}">${esc(entry.artist)}</button>`
            : ''}
          ${entry.year ? `<span>${entry.year}</span>` : ''}
          <span>${entry.count} titre${entry.count > 1 ? 's' : ''}</span>
          ${mins > 0 ? `<span>${mins} min</span>` : ''}
        </div>
        <div class="dh-actions">
          <button class="dh-btn dh-play" data-action="dh-play-all">▶ Lire tout</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all">⤮ Mélanger</button>
        </div>
      </div>`;
    return;
  }

  if (view === 'artist-detail') {
    const artists = _getArtistMap();
    const entry   = artists.find(a => a.key === key);
    if (!entry) { _removeDrillHeader(); return; }

    const albums = _getAlbumMap()
      .filter(a => (a.artist || '').toLowerCase() === key)
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 20);

    const el = _getOrCreateDrillHeader();
    const artH = entry.art
      ? `<img src="${entry.art}" class="dh-art dh-art-circle" alt="">`
      : `<div class="dh-art dh-art-ph dh-art-circle"></div>`;

    const albumCards = albums.map(a => {
      const cardArt = a.art
        ? `<img src="${a.art}" class="dh-mini-art" alt="">`
        : `<div class="dh-mini-art dh-mini-art-ph"></div>`;
      return `<button class="dh-mini-card" data-action="dh-drill-album"
                data-album-key="${esc(a.key)}" data-album-name="${esc(a.displayName)}">
        ${cardArt}
        <div class="dh-mini-name">${esc(a.displayName)}</div>
        ${a.year ? `<div class="dh-mini-year">${a.year}</div>` : ''}
      </button>`;
    }).join('');

    el.className = 'drill-header drill-header--artist';
    el.innerHTML = `
      <div class="dh-left">${artH}</div>
      <div class="dh-meta">
        <div class="dh-name">${esc(entry.displayName)}</div>
        <div class="dh-sub">
          <span>${albums.length} album${albums.length > 1 ? 's' : ''}</span>
          <span>${entry.count} titre${entry.count > 1 ? 's' : ''}</span>
        </div>
        <div class="dh-actions">
          <button class="dh-btn dh-play" data-action="dh-play-all">▶ Lire tout</button>
          <button class="dh-btn dh-shuf" data-action="dh-shuffle-all">⤮ Mélanger</button>
        </div>
      </div>
      ${albums.length > 0 ? `
        <div class="dh-albums-section">
          <div class="dh-albums-title">Albums</div>
          <div class="dh-albums-mini">${albumCards}</div>
        </div>` : ''}`;
    return;
  }

  // All other views: remove header if present
  _removeDrillHeader();
}
```

- [ ] **Step 2: Call `renderDrillHeader()` from `renderLib()`**

In `renderLib()`, find the line after `updateBreadcrumb()` (line ~248):
```javascript
  updateBreadcrumb();
  updatePlActionBar(fl);
```
Replace with:
```javascript
  updateBreadcrumb();
  renderDrillHeader(view, drillKey);
  updatePlActionBar(fl);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer.js
git commit -m "feat(renderer): add renderDrillHeader for album and artist drill views"
```

---

## Task 9 — renderer.js: track number in album-detail rows

**Files:**
- Modify: `frontend/src/renderer.js` — `thtml()` function (line ~780)

- [ ] **Step 1: Add track number display inside `thtml()`**

In `thtml()`, find the return statement that starts with:
```javascript
  return `<div class="tr${isAct?" act":""}${isSel?" selected":""}${extraCls}"${delayAttr}
```

The row currently renders: `.tart` + `.ti` + `.tr-r`.
Add a `.tr-num` element before `.tart` when in album-detail view:

Replace the return statement (starts at line ~780):
```javascript
  return `<div class="tr${isAct?" act":""}${isSel?" selected":""}${extraCls}"${delayAttr} id="tr-${t.id}" role="listitem" tabindex="0" aria-label="${ariaLbl}" data-action="track-click" data-track-id="${t.id}" draggable="true">
    <div class="tart${t.metaDone?'':' loading'}">${artHTML}<div class="tart-hover-play"><svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21"/></svg></div></div>
```

With:
```javascript
  const _isAlbumDetail = get('view') === 'album-detail';
  const _trackNum = _isAlbumDetail
    ? `<div class="tr-num">${t.track != null ? t.track : '–'}</div>`
    : '';
  return `<div class="tr${isAct?" act":""}${isSel?" selected":""}${_isAlbumDetail?" tr--album-detail":""}${extraCls}"${delayAttr} id="tr-${t.id}" role="listitem" tabindex="0" aria-label="${ariaLbl}" data-action="track-click" data-track-id="${t.id}" draggable="true">
    ${_trackNum}<div class="tart${t.metaDone?'':' loading'}">${artHTML}<div class="tart-hover-play"><svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21"/></svg></div></div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/renderer.js
git commit -m "feat(renderer): show track number in album-detail rows"
```

---

## Task 10 — handlers.js: drill header actions

**Files:**
- Modify: `frontend/src/handlers.js`

- [ ] **Step 1: Add drill header actions to `_ACTIONS`**

Add the following section to `_ACTIONS` (after the `// ── Library` section):

```javascript
  // ── Drill header ──────────────────────────────────────────
  'dh-play-all':    ()    => { const { playAt } = window; if (playAt) playAt(0); },
  'dh-shuffle-all': ()    => {
    const { set: storeSet, playAt: pa } = window;
    if (storeSet) storeSet('shuffle', true);
    if (pa) pa(0);
  },
  'dh-drill-album':  btn  => drillDown('albums',  btn.dataset.albumKey,  btn.dataset.albumName),
  'dh-drill-artist': btn  => drillDown('artists', btn.dataset.artistKey, btn.dataset.artistName),
```

**Note:** `playAt` and `set` (store) are exposed on `window` by app.js. If they are not already exposed, add the following to app.js (alongside the other `window.*` assignments):

Check app.js for existing `window.playAt` and `window.set` — if missing, add:
```javascript
window.playAt    = playAt;   // already exposed in most builds — confirm first
```

If `window.playAt` is already exposed by app.js (check by searching `window.playAt` in app.js), skip adding it. Use the existing global.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/handlers.js
git commit -m "feat(handlers): add drill header play/shuffle/drill actions"
```

---

## Task 11 — style.css: drill header + mini grid styles

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add drill header styles**

Append to `frontend/src/style.css`:

```css
/* ── Drill Header (album-detail / artist-detail) ─────────────────────────── */
#drill-header {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 20px 20px 16px;
  background: linear-gradient(to bottom, var(--bg2), transparent);
  flex-shrink: 0;
}
.dh-art {
  width: 120px;
  height: 120px;
  border-radius: var(--r);
  object-fit: cover;
  flex-shrink: 0;
}
.dh-art-circle { border-radius: 50%; }
.dh-art-ph { background: var(--bg3); }
.dh-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dh-name {
  font-size: 22px;
  font-weight: 800;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dh-sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--t2);
  align-items: center;
}
.dh-sub span { white-space: nowrap; }
.dh-sub span + span::before { content: '·'; margin-right: 6px; }
.dh-artist-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--t1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dh-artist-link:hover { color: var(--g); }
.dh-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.dh-btn {
  padding: 8px 18px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: opacity .15s;
}
.dh-btn:hover { opacity: .85; }
.dh-play { background: var(--g); color: #fff; }
.dh-shuf { background: var(--bg3); color: var(--t1); border: 1px solid var(--bg5); }

/* Artist drill: albums section */
.drill-header--artist { flex-wrap: wrap; }
.dh-albums-section {
  width: 100%;
  padding: 0 20px 16px;
}
.dh-albums-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--t3);
  margin-bottom: 10px;
}
.dh-albums-mini {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}
.dh-mini-card {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  width: 88px;
  padding: 8px;
  border-radius: var(--r);
  transition: background .15s;
}
.dh-mini-card:hover { background: var(--bg3); }
.dh-mini-art {
  width: 72px;
  height: 72px;
  border-radius: var(--r);
  object-fit: cover;
}
.dh-mini-art-ph { background: var(--bg4); }
.dh-mini-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--t1);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.dh-mini-year {
  font-size: 10px;
  color: var(--t3);
}

/* Track number in album-detail rows */
.tr-num {
  width: 28px;
  flex-shrink: 0;
  text-align: right;
  font-size: 12px;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
  padding-right: 4px;
  align-self: center;
}
.tr--album-detail { display: flex; align-items: center; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(css): add drill header and mini album grid styles"
```

---

## Task 12 — Integration: run tests + manual smoke test

- [ ] **Step 1: Run all tests**

```bash
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
node frontend/tests/core.test.cjs
```

Expected: 0 KO.

- [ ] **Step 2: Build the app**

```bash
cd C:\Users\Robinsonx\Desktop\Tauri\libreflow
cargo tauri dev 2>&1 | head -30
```

Expected: app starts without Rust errors, Vite bundles successfully.

- [ ] **Step 3: Smoke test checklist**

In the running app:

**Sprint 1 — Now Playing panel:**
- [ ] Click anywhere on the player bar info area (art/title/artist) → panel opens on the right
- [ ] Click `#btn-nowplaying` (info icon in `.pl-r`) → panel toggles
- [ ] Panel shows: track art (300×300 area), title, artist · album · year, like button, tech section (Format / Bitrate / Qualité / Taille)
- [ ] Play a different track → panel updates automatically
- [ ] Panel shows correct Format (FLAC/MP3/etc.)
- [ ] "→ Voir l'album" button → closes panel, opens album drill view
- [ ] "→ Voir l'artiste" button → closes panel, opens artist drill view
- [ ] Opening Now Playing while queue is open → queue closes
- [ ] Panel closes when clicking ✕ button

**Sprint 2 — Album drill header:**
- [ ] Navigate to Albums → click an album → header appears above track list
- [ ] Header shows: album art (120×120), album name, artist link, year · track count · duration
- [ ] Artist link in header → navigates to artist drill view
- [ ] "▶ Lire tout" → plays first track of album
- [ ] "⤮ Mélanger" → shuffles album tracks
- [ ] Track numbers shown in left column (–  for tracks without track number)
- [ ] Tracks ordered by track number (ascending)

**Sprint 3 — Artist drill header:**
- [ ] Navigate to Artists → click an artist → header appears
- [ ] Header shows: artist photo (circle), name, album count, track count
- [ ] Albums mini-grid shows artist's albums, sorted by year descending
- [ ] Click an album card → navigates to album drill view
- [ ] "▶ Lire tout" → plays all artist tracks
- [ ] Maximum 20 albums shown in mini-grid

- [ ] **Step 4: Final commit if any minor fixes needed**

```bash
git add -p  # review any tweaks
git commit -m "fix: sprint 1-3 smoke test fixes"
```

---

## Self-review checklist

Before marking this plan complete:

- [ ] No `audio.volume` assignment added anywhere
- [ ] No `tracks.splice()` without `rebuildTrackIdxMap()`
- [ ] No external fetch — all data from IDB or IPC
- [ ] `#drill-header` is inserted **before** `#tlist` (outside virtual scroll window)
- [ ] IPC `read_audio_props` is called lazily (only when panel opens) with per-path cache
- [ ] `nowPlayingOpen` flag checked before updating panel to prevent stale renders
- [ ] Album-detail sort already in search.js — confirmed not duplicated
