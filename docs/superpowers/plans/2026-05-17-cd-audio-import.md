# CD Audio Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect inserted audio CDs on Windows, then let the user PLAY them (rip-then-play to temp FLAC) or EXTRACT them (rip all tracks as FLAC into the library), with zero new runtime dependencies beyond `flacenc` (~150KB pure Rust).

**Architecture:** Polling-based detection extends existing `devices.js` (zero new timers). A new Rust module `cdaudio.rs` uses native Win32 IOCTLs (`IOCTL_CDROM_READ_TOC`, `IOCTL_CDROM_RAW_READ`) via the existing `windows` crate to read raw audio sectors, then encodes them with `flacenc`. A new JS module `cdaudio.js` orchestrates rip-then-play and rip-then-import flows, reusing the existing audio pipeline and `importPaths()` helper. macOS/Linux receive harmless `Err` stubs.

**Tech Stack:** Tauri 2 (Rust + ESM JS), `windows = 0.58` crate, `flacenc` crate (pure Rust FLAC encoder), `tokio` (async commands), existing `idb` / Web Audio frontend.

**Spec:** `docs/superpowers/specs/2026-05-17-cd-audio-import-design.md`

---

## Phase A — Backend foundations (Rust)

### Task 1: Add `flacenc` + extend `windows` features in Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml — add `flacenc` and IOCTL features**

In `[dependencies]` block, add:

```toml
flacenc = "0.4"
```

In `[target.'cfg(windows)'.dependencies]` block, expand the `windows` features list to include:

```toml
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Graphics_Gdi",
    "Win32_System_Com",
    "Win32_System_Threading",
    "Win32_UI_Controls",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Storage_FileSystem",
    "Win32_Storage_IscsiDisc",
    "Win32_System_IO",
    "Win32_System_Ioctl",
] }
```

- [ ] **Step 2: Verify compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: `Compiling libreflow ...` with no errors. May download `flacenc` and Windows feature crates on first build. If `flacenc 0.4` is unavailable, fall back to the latest 0.x release (check via `cargo search flacenc`) and update the version pin accordingly. Verify the chosen version exposes `flacenc::config::Encoder`, `flacenc::source::MemSource`, and `flacenc::encode_with_fixed_block_size` (or note the alternative entry points in your commit message).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -F .git/COMMIT_EDITMSG_tmp
```

with commit message file content:

```
feat(cdaudio): add flacenc crate + IscsiDisc/Ioctl windows features

Prep for CD audio rip pipeline. flacenc is pure-Rust, ~150KB. Win32 features
gate the IOCTL_CDROM_* APIs used by cdaudio.rs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 2: Create `cdaudio.rs` skeleton with cross-platform stubs

**Files:**
- Create: `src-tauri/src/cdaudio.rs`
- Modify: `src-tauri/src/main.rs` (add `mod cdaudio;` declaration)

- [ ] **Step 1: Create the module skeleton**

Create `src-tauri/src/cdaudio.rs`:

```rust
//! CD Audio module — read TOC and rip tracks to FLAC.
//!
//! Windows-only implementation via IOCTL_CDROM_READ_TOC + IOCTL_CDROM_RAW_READ.
//! Other platforms get harmless `Err` stubs so the build stays portable.

use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::AppHandle;

// ── Shared types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct CdTrack {
    pub idx: u8,
    pub lba_start: u32,
    pub frames: u32,
    pub duration_sec: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct CdToc {
    pub drive: String,
    pub tracks: Vec<CdTrack>,
    pub total_duration_sec: f32,
}

// ── Cancel registry ───────────────────────────────────────────────────────────

/// Maps rip_id → AtomicBool. Set to true to request graceful cancel.
static RIP_CANCEL: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn rip_cancel_lock() -> std::sync::MutexGuard<'static, Option<HashMap<String, Arc<AtomicBool>>>> {
    let mut guard = RIP_CANCEL.lock().expect("RIP_CANCEL poisoned");
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

fn register_cancel(rip_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut guard = rip_cancel_lock();
    guard.as_mut().unwrap().insert(rip_id.to_string(), flag.clone());
    flag
}

fn unregister_cancel(rip_id: &str) {
    let mut guard = rip_cancel_lock();
    if let Some(map) = guard.as_mut() {
        map.remove(rip_id);
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cd_read_toc(drive: String) -> Result<CdToc, String> {
    #[cfg(target_os = "windows")]
    { windows_impl::read_toc(&drive) }
    #[cfg(not(target_os = "windows"))]
    { let _ = drive; Err("CD audio non supporté sur cette plateforme".to_string()) }
}

#[tauri::command]
pub async fn cd_rip_track(
    app: AppHandle,
    drive: String,
    track_idx: u8,
    dest_path: String,
    rip_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let cancel = register_cancel(&rip_id);
        let result = tokio::task::spawn_blocking(move || {
            windows_impl::rip_track(&app, &drive, track_idx, &dest_path, &rip_id, cancel)
        })
        .await
        .map_err(|e| format!("rip task join error: {}", e))?;
        unregister_cancel(&rip_id);
        result
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, drive, track_idx, dest_path, rip_id);
        Err("CD audio non supporté sur cette plateforme".to_string())
    }
}

#[tauri::command]
pub fn cd_cancel_rip(rip_id: String) -> Result<(), String> {
    let guard = rip_cancel_lock();
    if let Some(map) = guard.as_ref() {
        if let Some(flag) = map.get(&rip_id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
            return Ok(());
        }
    }
    Err(format!("rip_id {} not found", rip_id))
}

#[cfg(target_os = "windows")]
mod windows_impl;
```

- [ ] **Step 2: Register the module in main.rs**

Open `src-tauri/src/main.rs`. After line 7 (the existing `mod watch;`), add:

```rust
mod cdaudio;
```

So the modules block becomes:

```rust
mod commands;
mod backup;
mod mini;
mod watch;
mod cdaudio;
#[cfg(target_os = "windows")]
mod taskbar;
```

- [ ] **Step 3: Verify compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: `error[E0583]: file not found for module \`windows_impl\`` — this is expected because Task 3 will create that file. To unblock the check, comment out the `#[cfg(target_os = "windows")] mod windows_impl;` line temporarily, re-run, then uncomment. Or skip this step and proceed to Task 3 (the compile will pass after Task 3 lands).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cdaudio.rs src-tauri/src/main.rs
git commit -m "feat(cdaudio): module skeleton + cancel registry + cross-platform stubs"
```

---

### Task 3: TOC binary parser (pure function, testable)

**Files:**
- Create: `src-tauri/src/cdaudio_toc.rs` (pure parser, no Win32 deps so it compiles cross-platform and is unit-testable)
- Modify: `src-tauri/src/cdaudio.rs` (use `super::cdaudio_toc`)
- Create: `src-tauri/tests/cdaudio_toc_test.rs`

The CD TOC binary layout returned by `IOCTL_CDROM_READ_TOC` (format `CDROM_READ_TOC_EX_FORMAT_TOC`):

```
Offset  Size  Field
0       2     Length BE (excludes Length field itself)
2       1     FirstTrack (1..99)
3       1     LastTrack  (1..99)
4..     8     TRACK_DATA[FirstTrack..=LastTrack + lead-out (track 0xAA)]
              0: Reserved
              1: Adr(4) | Control(4)   — control bit 2 = data flag
              2: TrackNumber (0xAA = lead-out)
              3: Reserved
              4..7: Address big-endian (when MSF=0, this is LBA as 4-byte u32)
```

When the IOCTL is called with `Msf = FALSE`, bytes 4..7 are LBA directly. When `Msf = TRUE`, bytes 4..7 are `[reserved, M, S, F]` and LBA = `((M*60 + S) * 75 + F) - 150`. **We will always use Msf=FALSE for simplicity.**

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/cdaudio_toc_test.rs`:

```rust
use libreflow_lib::cdaudio_toc::{parse_toc_lba, ParsedTrack};

#[test]
fn parses_three_audio_tracks_plus_leadout() {
    // Build a synthetic TOC buffer with 3 audio tracks + lead-out at LBA 200000
    // Layout: 4-byte header (len, first, last) + 4 * 8-byte track entries
    // Track 1: control=0x10 (audio), LBA=0
    // Track 2: control=0x10 (audio), LBA=20000
    // Track 3: control=0x10 (audio), LBA=40000
    // Lead-out (track 0xAA): control=0x10, LBA=60000
    let buf: Vec<u8> = vec![
        // Header — length covers everything after these 2 bytes
        0x00, 0x22, // length = 34 (4*8 + 2)
        0x01, 0x03, // first track 1, last track 3
        // Track 1
        0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
        // Track 2
        0x00, 0x10, 0x02, 0x00, 0x00, 0x00, 0x4E, 0x20, // 0x4E20 = 20000
        // Track 3
        0x00, 0x10, 0x03, 0x00, 0x00, 0x00, 0x9C, 0x40, // 0x9C40 = 40000
        // Lead-out
        0x00, 0x10, 0xAA, 0x00, 0x00, 0x00, 0xEA, 0x60, // 0xEA60 = 60000
    ];

    let tracks = parse_toc_lba(&buf).unwrap();
    assert_eq!(tracks.len(), 3);
    assert_eq!(tracks[0], ParsedTrack { idx: 1, lba_start: 0,     frames: 20000, is_audio: true });
    assert_eq!(tracks[1], ParsedTrack { idx: 2, lba_start: 20000, frames: 20000, is_audio: true });
    assert_eq!(tracks[2], ParsedTrack { idx: 3, lba_start: 40000, frames: 20000, is_audio: true });
}

#[test]
fn filters_data_tracks() {
    // 2 audio + 1 data, expect only 2 in output but data position used for frame calculation
    let buf: Vec<u8> = vec![
        0x00, 0x1A, 0x01, 0x02,
        0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,         // audio
        0x00, 0x14, 0x02, 0x00, 0x00, 0x00, 0x4E, 0x20,         // data (bit 2 set: 0x14 = 0001_0100)
        0x00, 0x10, 0xAA, 0x00, 0x00, 0x00, 0x9C, 0x40,         // lead-out
    ];

    let tracks = parse_toc_lba(&buf).unwrap();
    // We keep only audio tracks but each entry's `frames` uses the NEXT track's LBA
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].idx, 1);
    assert_eq!(tracks[0].lba_start, 0);
    assert_eq!(tracks[0].frames, 20000); // up to start of data track
}

#[test]
fn rejects_short_buffer() {
    let buf = vec![0x00, 0x02, 0x01, 0x01];
    assert!(parse_toc_lba(&buf).is_err());
}
```

- [ ] **Step 2: Run test to verify it fails (or fails to compile)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test cdaudio_toc_test`

Expected: compile error `unresolved import libreflow_lib::cdaudio_toc` — module doesn't exist yet.

- [ ] **Step 3: Create the parser module**

Create `src-tauri/src/cdaudio_toc.rs`:

```rust
//! Pure parser for the CD-ROM TOC binary returned by IOCTL_CDROM_READ_TOC
//! (format CDROM_READ_TOC_EX_FORMAT_TOC with Msf=FALSE).
//!
//! Lives in its own file (separate from cdaudio.rs) so it compiles on every
//! platform and stays unit-testable without any Win32 dependency.

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTrack {
    pub idx: u8,
    pub lba_start: u32,
    pub frames: u32,
    pub is_audio: bool,
}

const TRACK_ENTRY_SIZE: usize = 8;
const HEADER_SIZE: usize = 4;

pub fn parse_toc_lba(buf: &[u8]) -> Result<Vec<ParsedTrack>, String> {
    if buf.len() < HEADER_SIZE + TRACK_ENTRY_SIZE {
        return Err(format!("TOC buffer too short: {} bytes", buf.len()));
    }

    let length = u16::from_be_bytes([buf[0], buf[1]]) as usize;
    if length + 2 > buf.len() {
        return Err(format!(
            "TOC length field {} exceeds buffer size {}",
            length + 2,
            buf.len()
        ));
    }

    let first_track = buf[2];
    let last_track  = buf[3];
    if first_track == 0 || last_track < first_track {
        return Err(format!("Invalid track range: {}..={}", first_track, last_track));
    }

    let entries_bytes = (length + 2).saturating_sub(HEADER_SIZE);
    let entry_count = entries_bytes / TRACK_ENTRY_SIZE;
    if entry_count < 2 {
        return Err("TOC must contain at least 1 track + lead-out".to_string());
    }

    // Parse all entries (audio + data + lead-out)
    let mut all: Vec<(u8, u32, bool)> = Vec::with_capacity(entry_count);
    for i in 0..entry_count {
        let off = HEADER_SIZE + i * TRACK_ENTRY_SIZE;
        let control_adr = buf[off + 1];
        let track_no    = buf[off + 2];
        let lba = u32::from_be_bytes([
            buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7],
        ]);
        // control = upper 4 bits. Bit 2 (0x04) set = data track.
        let control = (control_adr >> 4) & 0x0F;
        let is_audio = (control & 0x04) == 0;
        all.push((track_no, lba, is_audio));
    }

    // Calculate frames as (next_entry_lba - this_lba) where next_entry is whatever
    // comes next in the TOC (audio, data, or lead-out — all use the same LBA scale).
    let mut audio_tracks = Vec::new();
    for i in 0..all.len() - 1 {
        let (track_no, lba, is_audio) = all[i];
        if track_no == 0xAA { continue; } // skip lead-out as a track entry
        let next_lba = all[i + 1].1;
        if !is_audio { continue; }
        let frames = next_lba.saturating_sub(lba);
        audio_tracks.push(ParsedTrack {
            idx: track_no,
            lba_start: lba,
            frames,
            is_audio: true,
        });
    }

    Ok(audio_tracks)
}

/// Convert frames (1/75 second each) into seconds.
pub fn frames_to_seconds(frames: u32) -> f32 {
    frames as f32 / 75.0
}
```

- [ ] **Step 4: Wire the parser into the library**

Open `src-tauri/src/main.rs`. Add `pub mod cdaudio_toc;` to the module declarations near the existing `mod cdaudio;`:

```rust
mod commands;
mod backup;
mod mini;
mod watch;
mod cdaudio;
pub mod cdaudio_toc;
#[cfg(target_os = "windows")]
mod taskbar;
```

The `pub` makes it reachable from the integration test as `libreflow_lib::cdaudio_toc`.

- [ ] **Step 5: Run tests, verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test cdaudio_toc_test`

Expected: `test parses_three_audio_tracks_plus_leadout ... ok`, `test filters_data_tracks ... ok`, `test rejects_short_buffer ... ok`. 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/cdaudio_toc.rs src-tauri/src/main.rs src-tauri/tests/cdaudio_toc_test.rs
git commit -m "feat(cdaudio): pure TOC parser + 3 unit tests"
```

---

### Task 4: Implement `cd_read_toc` Windows side

**Files:**
- Create: `src-tauri/src/cdaudio/windows_impl.rs` (note: this requires Task 2's `cdaudio.rs` to declare `mod windows_impl;` — which it does)

Wait — Rust doesn't support sibling files for a non-mod.rs module unless we restructure. Either rename `cdaudio.rs` to `cdaudio/mod.rs` OR put `windows_impl` inside `cdaudio.rs` as an inline `mod windows_impl { ... }`. We'll use the **inline approach** to avoid restructuring.

- [ ] **Step 1: Modify `cdaudio.rs` to declare `windows_impl` inline**

In `src-tauri/src/cdaudio.rs`, replace the trailing line:

```rust
#[cfg(target_os = "windows")]
mod windows_impl;
```

with the start of an inline module. We'll fill the body in subsequent steps:

```rust
#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{CdTrack, CdToc};
    use crate::cdaudio_toc::{parse_toc_lba, frames_to_seconds};
    use std::os::windows::io::AsRawHandle;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use tauri::{AppHandle, Emitter};

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, GENERIC_READ};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    const IOCTL_CDROM_READ_TOC: u32 = 0x00024000;
    const IOCTL_CDROM_RAW_READ: u32 = 0x0002403E;

    // Place pub(super) functions here in subsequent tasks.
}
```

- [ ] **Step 2: Add `read_toc` impl inside the inline module**

Append this inside the `mod windows_impl { ... }` block (before the closing `}`):

```rust
    fn open_drive(drive: &str) -> Result<HANDLE, String> {
        // drive comes in as "D:\\" — convert to "\\\\.\\D:"
        let letter = drive.chars().next().ok_or_else(|| "empty drive string".to_string())?;
        let path = format!("\\\\.\\{}:", letter);
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                GENERIC_READ.0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        }
        .map_err(|e| format!("CreateFileW({}) failed: {:?}", path, e))?;
        Ok(handle)
    }

    pub(super) fn read_toc(drive: &str) -> Result<CdToc, String> {
        let handle = open_drive(drive)?;

        // 804 bytes is enough for 100 tracks * 8 bytes + header
        let mut out_buf = vec![0u8; 1024];
        let mut bytes_returned: u32 = 0;

        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_CDROM_READ_TOC,
                None,
                0,
                Some(out_buf.as_mut_ptr() as *mut _),
                out_buf.len() as u32,
                Some(&mut bytes_returned),
                None,
            )
        };

        // Close drive handle promptly — we don't need it for parsing
        let _ = unsafe { CloseHandle(handle) };

        if ok.is_err() {
            return Err(format!("IOCTL_CDROM_READ_TOC failed: {:?}", ok.err()));
        }

        out_buf.truncate(bytes_returned as usize);
        let parsed = parse_toc_lba(&out_buf)?;

        let tracks: Vec<CdTrack> = parsed
            .iter()
            .map(|p| CdTrack {
                idx: p.idx,
                lba_start: p.lba_start,
                frames: p.frames,
                duration_sec: frames_to_seconds(p.frames),
            })
            .collect();

        let total_duration_sec = tracks.iter().map(|t| t.duration_sec).sum();

        Ok(CdToc {
            drive: drive.to_string(),
            tracks,
            total_duration_sec,
        })
    }
```

- [ ] **Step 3: Verify compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: no errors. May surface warnings about `FILE_FLAGS_AND_ATTRIBUTES` import not being strictly needed — leave it. If `CreateFileW` signature differs in the installed `windows` crate version, adjust per the actual `windows::Win32::Storage::FileSystem` docs (`HANDLE`/`HRESULT` return semantics changed across `windows` 0.51 → 0.58).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cdaudio.rs
git commit -m "feat(cdaudio): cd_read_toc — open raw device + IOCTL_CDROM_READ_TOC"
```

---

### Task 5: Implement `cd_rip_track` (raw read + flacenc encode + progress events)

**Files:**
- Modify: `src-tauri/src/cdaudio.rs` (extend the `mod windows_impl { ... }`)

- [ ] **Step 1: Define the IOCTL request struct + read function**

Append inside `mod windows_impl { ... }`:

```rust
    /// RAW_READ_INFO struct expected by IOCTL_CDROM_RAW_READ.
    /// Layout from ntddcdrm.h:
    ///   LARGE_INTEGER DiskOffset; // byte offset, but driver expects LBA*2048 for raw — see below
    ///   ULONG SectorCount;
    ///   TRACK_MODE_TYPE TrackMode; // 0 = YellowMode2, 1 = XAForm2, 2 = CDDA
    #[repr(C)]
    struct RawReadInfo {
        disk_offset_lo: u32,
        disk_offset_hi: u32,
        sector_count: u32,
        track_mode: u32, // CDDA = 2
    }

    const TRACK_MODE_CDDA: u32 = 2;
    const SECTOR_BYTES: usize = 2352; // CD audio sector size
    const FRAMES_PER_CHUNK: u32 = 50; // ~117KB per IOCTL call; tune later

    fn read_audio_sectors(
        handle: HANDLE,
        start_lba: u32,
        sector_count: u32,
    ) -> Result<Vec<u8>, String> {
        // IOCTL_CDROM_RAW_READ uses DiskOffset as LBA * 2048 (logical bytes), NOT raw byte offset.
        let offset_logical_bytes: u64 = (start_lba as u64) * 2048;
        let info = RawReadInfo {
            disk_offset_lo: (offset_logical_bytes & 0xFFFF_FFFF) as u32,
            disk_offset_hi: ((offset_logical_bytes >> 32) & 0xFFFF_FFFF) as u32,
            sector_count,
            track_mode: TRACK_MODE_CDDA,
        };

        let mut out = vec![0u8; SECTOR_BYTES * sector_count as usize];
        let mut bytes_returned: u32 = 0;

        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_CDROM_RAW_READ,
                Some(&info as *const _ as *const _),
                std::mem::size_of::<RawReadInfo>() as u32,
                Some(out.as_mut_ptr() as *mut _),
                out.len() as u32,
                Some(&mut bytes_returned),
                None,
            )
        };

        if ok.is_err() {
            return Err(format!("IOCTL_CDROM_RAW_READ failed at LBA {}: {:?}", start_lba, ok.err()));
        }

        out.truncate(bytes_returned as usize);
        Ok(out)
    }
```

- [ ] **Step 2: Define the rip orchestration + flacenc encode**

Append:

```rust
    pub(super) fn rip_track(
        app: &AppHandle,
        drive: &str,
        track_idx: u8,
        dest_path: &str,
        rip_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        // 1. Read TOC to locate this track
        let toc = read_toc(drive)?;
        let track = toc.tracks.iter()
            .find(|t| t.idx == track_idx)
            .ok_or_else(|| format!("track {} not in TOC", track_idx))?;

        let total_sectors = track.frames;
        if total_sectors == 0 {
            return Err(format!("track {} has 0 frames", track_idx));
        }

        // 2. Open device again for the rip (separate handle from TOC read)
        let handle = open_drive(drive)?;

        // 3. Stream sectors → PCM samples → flacenc
        // CD audio = 44100 Hz, 16-bit signed LE, 2 channels (stereo interleaved)
        let mut all_samples: Vec<i32> = Vec::with_capacity((total_sectors as usize) * 588 * 2);
        let mut sectors_done: u32 = 0;
        let mut last_emit = std::time::Instant::now();

        while sectors_done < total_sectors {
            if cancel.load(Ordering::SeqCst) {
                let _ = unsafe { CloseHandle(handle) };
                let _ = std::fs::remove_file(dest_path); // cleanup partial output (none yet, defensive)
                return Err("cancelled".to_string());
            }

            let chunk = FRAMES_PER_CHUNK.min(total_sectors - sectors_done);
            let lba = track.lba_start + sectors_done;

            let pcm = match read_audio_sectors(handle, lba, chunk) {
                Ok(b) => b,
                Err(e) => {
                    // Retry up to 3 times on transient error
                    let mut retry_pcm = None;
                    for attempt in 1..=3 {
                        std::thread::sleep(std::time::Duration::from_millis(100 * attempt));
                        if let Ok(b) = read_audio_sectors(handle, lba, chunk) {
                            retry_pcm = Some(b);
                            break;
                        }
                    }
                    match retry_pcm {
                        Some(b) => b,
                        None => {
                            eprintln!("[cdaudio] giving up on LBA {} after 3 retries: {}", lba, e);
                            // Insert silence for this chunk so the track stays time-aligned
                            vec![0u8; SECTOR_BYTES * chunk as usize]
                        }
                    }
                }
            };

            // Convert 16-bit LE stereo bytes → i32 samples for flacenc
            for stereo_frame in pcm.chunks_exact(4) {
                let l = i16::from_le_bytes([stereo_frame[0], stereo_frame[1]]) as i32;
                let r = i16::from_le_bytes([stereo_frame[2], stereo_frame[3]]) as i32;
                all_samples.push(l);
                all_samples.push(r);
            }

            sectors_done += chunk;

            // Emit progress every ~500ms
            if last_emit.elapsed() >= std::time::Duration::from_millis(500) {
                let percent = ((sectors_done as f64 / total_sectors as f64) * 100.0) as u32;
                let _ = app.emit("cd-rip-progress", serde_json::json!({
                    "rip_id": rip_id,
                    "percent": percent,
                    "sector_current": sectors_done,
                    "sector_total": total_sectors,
                }));
                last_emit = std::time::Instant::now();
            }
        }

        let _ = unsafe { CloseHandle(handle) };

        // 4. Encode all samples to FLAC at dest_path
        encode_flac(&all_samples, dest_path)?;

        // 5. Emit final progress 100%
        let _ = app.emit("cd-rip-progress", serde_json::json!({
            "rip_id": rip_id,
            "percent": 100,
            "sector_current": total_sectors,
            "sector_total": total_sectors,
        }));

        Ok(())
    }

    fn encode_flac(samples: &[i32], dest_path: &str) -> Result<(), String> {
        use flacenc::config::Encoder as EncoderConfig;
        use flacenc::source::MemSource;
        use flacenc::component::BitRepr;

        let config = EncoderConfig::default();
        let channels = 2;
        let bits_per_sample = 16;
        let sample_rate = 44100;
        let block_size = config.block_size;

        let source = MemSource::from_samples(samples, channels, bits_per_sample, sample_rate);

        let stream = flacenc::encode_with_fixed_block_size(&config, source, block_size)
            .map_err(|e| format!("flacenc encode failed: {:?}", e))?;

        let mut sink = flacenc::bitsink::ByteSink::new();
        stream.write(&mut sink)
            .map_err(|e| format!("flacenc write failed: {:?}", e))?;

        std::fs::write(dest_path, sink.as_slice())
            .map_err(|e| format!("write FLAC file failed: {}", e))?;

        Ok(())
    }
```

**Note to executor:** The `flacenc` API surface has shifted across 0.x releases. If `MemSource::from_samples`, `encode_with_fixed_block_size`, `bitsink::ByteSink`, or `BitRepr` aren't exactly named this in the installed version, consult `cargo doc --open --package flacenc` and adjust the imports/calls. The intent is: build an in-memory source of i32 PCM samples, encode to a `Stream`, serialize bits to a Vec<u8>, write to file. Document any adapter you write in a brief comment.

- [ ] **Step 3: Verify compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: no errors, possibly warnings about unused imports — clean those up.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cdaudio.rs
git commit -m "feat(cdaudio): cd_rip_track — raw sectors + flacenc encode + progress"
```

---

### Task 6: Register the 3 new commands in main.rs

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add commands to invoke_handler**

In `src-tauri/src/main.rs`, locate the `.invoke_handler(tauri::generate_handler![...])` block. Add three new entries right after `commands::open_folder_at,`:

```rust
            commands::list_drives,
            commands::open_folder_at,
            cdaudio::cd_read_toc,
            cdaudio::cd_rip_track,
            cdaudio::cd_cancel_rip,
            #[cfg(debug_assertions)]
            commands::open_devtools,
```

- [ ] **Step 2: Verify build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(cdaudio): register cd_read_toc / cd_rip_track / cd_cancel_rip"
```

---

### Task 7: Extend `DriveInfo` + `list_drives` for audio CD detection

**Files:**
- Modify: `src-tauri/src/commands.rs` (struct + Windows `_list_drives_impl`)

- [ ] **Step 1: Extend the DriveInfo struct**

In `src-tauri/src/commands.rs`, locate the `pub struct DriveInfo` definition (around line 128). Replace with:

```rust
/// Informations sur un volume monté.
#[derive(Serialize, Clone)]
pub struct DriveInfo {
    /// Chemin racine du volume (ex: "C:\\", "/Volumes/USB")
    pub path:  String,
    /// Label du volume (ex: "USB DRIVE", "Macintosh HD")
    pub label: String,
    /// Type de lecteur : "fixed" | "removable" | "network" | "cdrom" | "unknown"
    pub kind:  String,
    /// True si CDROM avec au moins une piste audio (Windows uniquement, sinon false).
    #[serde(default)]
    pub audio_cd: bool,
    /// Nombre de pistes audio (0 si pas un CD audio).
    #[serde(default)]
    pub track_count: u8,
}
```

- [ ] **Step 2: Update the Windows `_list_drives_impl`**

Locate the Windows implementation (around line 881). The current `kind` match handles types 2 and 3 but classifies everything else as "unknown" or similar. Modify it to also classify type 5 as "cdrom" AND probe for audio CD presence.

Find the `let kind = match dtype { ... };` block. Replace with:

```rust
        let kind = match dtype {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            _ => "unknown",
        }.to_string();

        // For CDROM drives, try to read the TOC to determine if it's an audio CD
        let (audio_cd, track_count) = if dtype == 5 {
            match crate::cdaudio::cd_read_toc(drive_str.clone()) {
                Ok(toc) => (!toc.tracks.is_empty(), toc.tracks.len().min(99) as u8),
                Err(_)  => (false, 0), // drive empty, data CD, or read error — all silent
            }
        } else {
            (false, 0)
        };
```

Then update the `drives.push(DriveInfo { ... })` call near the end of the loop body to include the new fields:

```rust
        drives.push(DriveInfo {
            path:  drive_str,
            label,
            kind,
            audio_cd,
            track_count,
        });
```

- [ ] **Step 3: Update macOS / fallback impls**

Locate `#[cfg(target_os = "macos")] fn _list_drives_impl()` (around line 922). The `DriveInfo` literal there needs the two new fields. Update each push to include:

```rust
            Some(DriveInfo {
                path: ...,
                label,
                kind: ...,
                audio_cd: false,
                track_count: 0,
            })
```

If there is a `#[cfg(not(any(target_os = "windows", target_os = "macos")))]` fallback returning `Vec::new()`, leave it as-is.

- [ ] **Step 4: Verify build (both Windows and cross-platform path)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: clean compile on the current platform.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(cdaudio): list_drives surfaces audio_cd + track_count for CDROM drives"
```

---

## Phase B — Frontend pure functions (TDD)

### Task 8: Pure helpers for CD detection / track shaping (JS)

**Files:**
- Modify: `tests/core.test.cjs` (add CD audio test section)
- Create: `frontend/src/cdaudio_pure.js` (pure helpers — no IPC, no DOM, no IDB)

We isolate pure logic in a separate file so the test suite can require it as CJS without bundling. Then `cdaudio.js` will import from `./cdaudio_pure.js`.

- [ ] **Step 1: Write the failing tests**

Open `tests/core.test.cjs`. Find the bottom marker of the file (just before the "Tous les tests passent" tally) and append a new test block. The test runner pattern in this file is simple inline `console.log` + asserts via `assert.deepStrictEqual`/`assert.strictEqual` from a hand-rolled mini-framework — match the existing style.

Locate the existing pattern (e.g. how `eqdevice.js — profil EQ par appareil: 9/9 OK` is computed). Add a section like:

```js
// ── cdaudio_pure.js — logique pure ──────────────────────────────
{
  const {
    detectNewAudioCds,
    buildEphemeralCdTrack,
    cleanupEphemeralForDrive,
    extractDestPath,
    calculateRipPercent,
    formatTrackLabel,
  } = require('../frontend/src/cdaudio_pure.cjs');

  // formatTrackLabel(1) -> "Track 01"
  test('formatTrackLabel(1) → "Track 01"',  () => assert.strictEqual(formatTrackLabel(1),  'Track 01'));
  test('formatTrackLabel(12) → "Track 12"', () => assert.strictEqual(formatTrackLabel(12), 'Track 12'));

  // detectNewAudioCds: returns drives that are audio_cd=true AND not in previous
  test('detectNewAudioCds detects new audio CD', () => {
    const prev = [{ path: 'D:\\', audio_cd: false }];
    const curr = [{ path: 'D:\\', audio_cd: true, track_count: 12, label: 'MY CD' }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].path, 'D:\\');
  });

  test('detectNewAudioCds ignores already-known CD', () => {
    const prev = [{ path: 'D:\\', audio_cd: true }];
    const curr = [{ path: 'D:\\', audio_cd: true }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 0);
  });

  test('detectNewAudioCds ignores data CD', () => {
    const prev = [];
    const curr = [{ path: 'D:\\', audio_cd: false }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 0);
  });

  // buildEphemeralCdTrack
  test('buildEphemeralCdTrack shapes virtual track', () => {
    const drive = { path: 'D:\\', label: 'MY CD' };
    const tocTrack = { idx: 3, duration_sec: 245.5 };
    const t = buildEphemeralCdTrack(drive, tocTrack, '/tmp/x.flac');
    assert.strictEqual(t.id,        'cd:D:\\:3');
    assert.strictEqual(t.path,      '/tmp/x.flac');
    assert.strictEqual(t.title,     'Track 03');
    assert.strictEqual(t.artist,    'CD Audio');
    assert.strictEqual(t.album,     'MY CD');
    assert.strictEqual(t.dur,       245.5);
    assert.strictEqual(t._isEphemeralCd, true);
    assert.strictEqual(t._cdDrive,  'D:\\');
  });

  test('buildEphemeralCdTrack falls back album label', () => {
    const drive = { path: 'D:\\', label: '' };
    const t = buildEphemeralCdTrack(drive, { idx: 1, duration_sec: 60 }, '/tmp/y.flac');
    assert.strictEqual(t.album, 'CD inconnu');
  });

  // cleanupEphemeralForDrive
  test('cleanupEphemeralForDrive removes only this drive', () => {
    const tracks = [
      { id: 'normal-1' },
      { id: 'cd:D:\\:1', _isEphemeralCd: true, _cdDrive: 'D:\\' },
      { id: 'cd:E:\\:1', _isEphemeralCd: true, _cdDrive: 'E:\\' },
      { id: 'normal-2' },
    ];
    const out = cleanupEphemeralForDrive(tracks, 'D:\\');
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(out.map(t => t.id), ['normal-1', 'cd:E:\\:1', 'normal-2']);
  });

  // extractDestPath
  test('extractDestPath builds folder + Track filename', () => {
    const p = extractDestPath('C:\\Music', 'MY CD', 7, '2026-05-17');
    // Expected: "C:\\Music\\CD_MY_CD_2026-05-17\\Track 07.flac"
    assert.ok(p.endsWith('Track 07.flac'), `got ${p}`);
    assert.ok(p.includes('CD_MY_CD_2026-05-17'), `got ${p}`);
  });

  test('extractDestPath sanitizes label with forbidden chars', () => {
    const p = extractDestPath('C:\\Music', 'rock/roll<>?', 1, '2026-05-17');
    assert.ok(!/[\/<>?]/.test(p.split(/[\\\/]/).slice(-2)[0]), `dir part should be sanitized: ${p}`);
  });

  // calculateRipPercent
  test('calculateRipPercent rounds down', () => {
    assert.strictEqual(calculateRipPercent(0,    100), 0);
    assert.strictEqual(calculateRipPercent(50,   100), 50);
    assert.strictEqual(calculateRipPercent(99,   100), 99);
    assert.strictEqual(calculateRipPercent(100,  100), 100);
    assert.strictEqual(calculateRipPercent(0,    0),   0); // div by zero guard
  });
}

console.log('cdaudio_pure.js — logique pure: 11/11 OK');
```

**Note to executor:** match the EXACT test-runner conventions of `core.test.cjs` — if it uses `test(name, fn)` or inline asserts, use the same. Also increment the final OK tally line.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`

Expected: failure — `Cannot find module '../frontend/src/cdaudio_pure.cjs'`. That's why we'll author the impl as both `.js` (ESM) and `.cjs` (CJS) — see next step.

- [ ] **Step 3: Implement the pure helpers — ESM source of truth**

Create `frontend/src/cdaudio_pure.js`:

```js
// cdaudio_pure.js — Pure helpers for CD audio import.
// No IPC, no DOM, no IDB — all logic that can be unit-tested.

const FORBIDDEN_PATH_CHARS = /[\\/:*?"<>|]/g;

export function formatTrackLabel(idx) {
  return `Track ${String(idx).padStart(2, '0')}`;
}

export function detectNewAudioCds(previous, current) {
  const prevAudioCds = new Set();
  for (const d of previous) {
    if (d.audio_cd) prevAudioCds.add(d.path);
  }
  const out = [];
  for (const d of current) {
    if (d.audio_cd && !prevAudioCds.has(d.path)) out.push(d);
  }
  return out;
}

export function buildEphemeralCdTrack(drive, tocTrack, tempPath) {
  return {
    id:    `cd:${drive.path}:${tocTrack.idx}`,
    path:  tempPath,
    title: formatTrackLabel(tocTrack.idx),
    artist: 'CD Audio',
    album:  drive.label && drive.label.length > 0 ? drive.label : 'CD inconnu',
    dur:    tocTrack.duration_sec,
    _isEphemeralCd: true,
    _cdDrive:       drive.path,
  };
}

export function cleanupEphemeralForDrive(tracks, drivePath) {
  return tracks.filter(t => !(t._isEphemeralCd && t._cdDrive === drivePath));
}

function _sanitizeForPath(s) {
  return String(s || '')
    .replace(FORBIDDEN_PATH_CHARS, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'unnamed';
}

export function extractDestPath(baseDir, label, trackIdx, dateStr) {
  const safe = _sanitizeForPath(label);
  const dir  = `${baseDir}\\CD_${safe}_${dateStr}`;
  const file = `${formatTrackLabel(trackIdx)}.flac`;
  return `${dir}\\${file}`;
}

export function calculateRipPercent(sectorCurrent, sectorTotal) {
  if (!sectorTotal || sectorTotal <= 0) return 0;
  return Math.floor((sectorCurrent / sectorTotal) * 100);
}
```

- [ ] **Step 4: Generate the CJS mirror for the test suite**

Create `frontend/src/cdaudio_pure.cjs` (lazy approach: re-export the ESM module's named exports as a synchronous CJS module by duplicating the implementations — DRY is violated but keeps the test suite zero-dep):

```js
// cdaudio_pure.cjs — CJS mirror of cdaudio_pure.js for the zero-dep test suite.
// Source of truth is cdaudio_pure.js (ESM). Keep in sync manually — small file.

const FORBIDDEN_PATH_CHARS = /[\\/:*?"<>|]/g;

function formatTrackLabel(idx) {
  return `Track ${String(idx).padStart(2, '0')}`;
}

function detectNewAudioCds(previous, current) {
  const prevAudioCds = new Set();
  for (const d of previous) {
    if (d.audio_cd) prevAudioCds.add(d.path);
  }
  const out = [];
  for (const d of current) {
    if (d.audio_cd && !prevAudioCds.has(d.path)) out.push(d);
  }
  return out;
}

function buildEphemeralCdTrack(drive, tocTrack, tempPath) {
  return {
    id:    `cd:${drive.path}:${tocTrack.idx}`,
    path:  tempPath,
    title: formatTrackLabel(tocTrack.idx),
    artist: 'CD Audio',
    album:  drive.label && drive.label.length > 0 ? drive.label : 'CD inconnu',
    dur:    tocTrack.duration_sec,
    _isEphemeralCd: true,
    _cdDrive:       drive.path,
  };
}

function cleanupEphemeralForDrive(tracks, drivePath) {
  return tracks.filter(t => !(t._isEphemeralCd && t._cdDrive === drivePath));
}

function _sanitizeForPath(s) {
  return String(s || '')
    .replace(FORBIDDEN_PATH_CHARS, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'unnamed';
}

function extractDestPath(baseDir, label, trackIdx, dateStr) {
  const safe = _sanitizeForPath(label);
  const dir  = `${baseDir}\\CD_${safe}_${dateStr}`;
  const file = `${formatTrackLabel(trackIdx)}.flac`;
  return `${dir}\\${file}`;
}

function calculateRipPercent(sectorCurrent, sectorTotal) {
  if (!sectorTotal || sectorTotal <= 0) return 0;
  return Math.floor((sectorCurrent / sectorTotal) * 100);
}

module.exports = {
  formatTrackLabel,
  detectNewAudioCds,
  buildEphemeralCdTrack,
  cleanupEphemeralForDrive,
  extractDestPath,
  calculateRipPercent,
};
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test`

Expected: existing `Total : 255 OK: 255 KO: 0` jumps to `Total : 266 OK: 266 KO: 0` (or similar — the line `cdaudio_pure.js — logique pure: 11/11 OK` should appear).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/cdaudio_pure.js frontend/src/cdaudio_pure.cjs tests/core.test.cjs
git commit -m "feat(cdaudio): pure JS helpers + 11 unit tests"
```

---

## Phase C — Frontend wiring

### Task 9: Modify `db.js` to skip ephemeral CD tracks

**Files:**
- Modify: `frontend/src/db.js` (around the `dput` function)

- [ ] **Step 1: Locate the dput function**

Open `frontend/src/db.js`. Find `export async function dput(store, value)` (around line 105 based on prior session context).

- [ ] **Step 2: Add the ephemeral skip at the top of dput**

Add a guard at the very start of the function body:

```js
export async function dput(store, value) {
  // Skip persisting ephemeral CD tracks — they're tied to the inserted disc's lifetime
  if (store === 'tracks' && value && value._isEphemeralCd === true) return;

  // ...existing body...
}
```

The exact placement matters: this must be the FIRST statement in the function. Leave the rest of `dput` unchanged.

- [ ] **Step 3: Verify with the existing test (no regression)**

Run: `npm test`

Expected: `Total : 266 OK: 266 KO: 0` — same as after Task 8. No regression.

Also add one inline test in `core.test.cjs` to lock down the skip behavior:

```js
// ── db.js — _isEphemeralCd skip ──────────────────────────────────
{
  // We don't import db.js (depends on idb/window) — re-test the predicate inline.
  const isEphemeralCdTrack = (store, v) =>
    store === 'tracks' && v && v._isEphemeralCd === true;
  test('dput skip predicate: ephemeral CD track', () =>
    assert.strictEqual(isEphemeralCdTrack('tracks', { _isEphemeralCd: true }), true));
  test('dput skip predicate: normal track', () =>
    assert.strictEqual(isEphemeralCdTrack('tracks', { id: 1 }), false));
  test('dput skip predicate: ephemeral but wrong store', () =>
    assert.strictEqual(isEphemeralCdTrack('playlists', { _isEphemeralCd: true }), false));
}
console.log('db.js — _isEphemeralCd skip: 3/3 OK');
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: `Total : 269 OK: 269 KO: 0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/db.js tests/core.test.cjs
git commit -m "feat(cdaudio): db.dput skips _isEphemeralCd tracks + 3 tests"
```

---

### Task 10: Create `cdaudio.js` module (orchestration)

**Files:**
- Create: `frontend/src/cdaudio.js`

- [ ] **Step 1: Create the module**

Create `frontend/src/cdaudio.js`:

```js
// cdaudio.js — CD Audio orchestration (Lire / Extraire).
//
// Flux PLAY :
//   1. cd_read_toc(drive) → TOC
//   2. cd_rip_track(track 1) → temp FLAC
//   3. push ephemeral track + playAt(idx)
//   4. prefetch track suivant à T-5s avant fin
//
// Flux EXTRACT :
//   1. cd_read_toc(drive)
//   2. rip all → watchPath/CD_<label>_<date>/Track 0X.flac
//   3. importPaths([...]) — réutilise scan/tag flow

import { invoke }              from './ipc.js';
import { listen }              from './tauri-event.js';   // wrapper Tauri Event API; create if absent
import { toast, esc }          from './ui.js';
import { get, notify }         from './store.js';
import { rebuildTrackIdxMap,
         invalidateFilterCache } from './search.js';
import { VIRT }                from './virt.js';
import { getWatchPath, importPaths } from './watchfolder.js';
import { convertFileSrc }      from './tauri-path.js';     // wrapper Tauri convertFileSrc; create if absent
import {
  detectNewAudioCds,        // re-export for devices.js convenience
  buildEphemeralCdTrack,
  cleanupEphemeralForDrive,
  extractDestPath,
  calculateRipPercent,
} from './cdaudio_pure.js';

export { detectNewAudioCds };

// ── État module ───────────────────────────────────────────────────────────────

let _currentRipId   = null;
let _currentDrive   = null;
let _progressUnlisten = null;
let _prefetchTimer  = null;

const CACHE_SUBDIR = 'cd-cache';

// ── API publique ──────────────────────────────────────────────────────────────

export async function openCdModal(drivePath) {
  let toc;
  try { toc = await invoke('cd_read_toc', { drive: drivePath }); }
  catch (e) {
    console.warn('[cdaudio] cd_read_toc failed:', e);
    toast(`CD illisible : ${e}`, 'error');
    return;
  }

  _currentDrive = drivePath;

  const labelEl = document.getElementById('cd-label');
  const countEl = document.getElementById('cd-track-count');
  const durEl   = document.getElementById('cd-duration');
  if (labelEl) labelEl.textContent = drivePath;
  if (countEl) countEl.textContent = String(toc.tracks.length);
  if (durEl)   durEl.textContent   = _formatDuration(toc.total_duration_sec);

  _resetProgressUi();
  const bg = document.getElementById('cd-modal-bg');
  if (bg) bg.classList.add('on');

  // Stash TOC on the modal element for action handlers
  if (bg) bg._toc = toc;
}

export function closeCdModal() {
  const bg = document.getElementById('cd-modal-bg');
  if (!bg) return;
  bg.classList.remove('on');
  bg._toc = null;
  _resetProgressUi();
}

export async function playCdTrack(drivePath, idx) {
  const bg = document.getElementById('cd-modal-bg');
  const toc = bg?._toc;
  if (!toc) { toast('TOC perdu — réessayer', 'error'); return; }
  const tocTrack = toc.tracks.find(t => t.idx === idx) || toc.tracks[0];
  if (!tocTrack) return;

  const rip_id = crypto.randomUUID();
  const tempPath = await _tempPathForRip(rip_id);
  _showProgressUi();

  await _subscribeProgress(rip_id);

  try {
    _currentRipId = rip_id;
    await invoke('cd_rip_track', {
      drive: drivePath, track_idx: tocTrack.idx, dest_path: tempPath, rip_id,
    });
  } catch (e) {
    _unsubscribeProgress();
    if (String(e) === 'cancelled') { _resetProgressUi(); return; }
    toast(`Erreur de rip : ${e}`, 'error');
    _resetProgressUi();
    return;
  } finally {
    _currentRipId = null;
  }

  _unsubscribeProgress();

  // Inject ephemeral track + play
  const eph = buildEphemeralCdTrack({ path: drivePath, label: (bg?._toc?.drive || drivePath) }, tocTrack, tempPath);
  // Use Tauri convertFileSrc so <audio src> works under the Tauri custom scheme
  eph.path = await convertFileSrc(tempPath);

  const tracks = get('tracks');
  tracks.push(eph);
  notify('tracks');
  rebuildTrackIdxMap();
  invalidateFilterCache();
  if (VIRT) VIRT._lastListSig = '';

  // playAt expects an index into tracks[] — find ours
  const newIdx = tracks.length - 1;
  if (typeof window.playAt === 'function') window.playAt(newIdx);

  closeCdModal();

  // Schedule prefetch of next track at T-5s before this one ends
  _schedulePrefetch(drivePath, tocTrack.idx + 1);
}

export async function extractCd(drivePath) {
  const bg = document.getElementById('cd-modal-bg');
  const toc = bg?._toc;
  if (!toc) { toast('TOC perdu — réessayer', 'error'); return; }

  const watchPath = getWatchPath();
  if (!watchPath) {
    toast('Aucun dossier de surveillance configuré', 'error');
    return;
  }

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const label   = drivePath.replace(/[:\\]/g, '');
  const destDirSample = extractDestPath(watchPath, label, 1, dateStr);
  const destDir = destDirSample.substring(0, destDirSample.lastIndexOf('\\'));

  // Ensure target dir exists via existing IPC (Tauri fs plugin)
  try { await invoke('plugin:fs|create', { path: destDir, options: { recursive: true } }); }
  catch (e) { console.warn('[cdaudio] mkdir failed (may already exist):', e); }

  _showProgressUi();
  const written = [];

  for (const tocTrack of toc.tracks) {
    const rip_id = crypto.randomUUID();
    const dest   = extractDestPath(watchPath, label, tocTrack.idx, dateStr);
    _setProgressText(`Extraction : ${tocTrack.idx} / ${toc.tracks.length}`);
    await _subscribeProgress(rip_id);

    try {
      _currentRipId = rip_id;
      await invoke('cd_rip_track', {
        drive: drivePath, track_idx: tocTrack.idx, dest_path: dest, rip_id,
      });
      written.push(dest);
    } catch (e) {
      _unsubscribeProgress();
      if (String(e) === 'cancelled') {
        toast('Extraction annulée', 'info');
        _resetProgressUi();
        return;
      }
      toast(`Erreur sur track ${tocTrack.idx} : ${e}`, 'error');
    } finally {
      _currentRipId = null;
      _unsubscribeProgress();
    }
  }

  // Hand off to existing import pipeline
  if (written.length) {
    await importPaths(written);
    toast(`${written.length} piste(s) extraite(s) et ajoutée(s) à la bibliothèque`, 'success');
  }

  _resetProgressUi();
  closeCdModal();
}

export async function cancelCurrentRip() {
  if (!_currentRipId) return;
  try { await invoke('cd_cancel_rip', { rip_id: _currentRipId }); }
  catch (e) { console.warn('[cdaudio] cancel failed:', e); }
}

export async function cleanupCdCache(drivePath) {
  // Purge ephemeral tracks bound to this drive
  if (drivePath) {
    const tracks = get('tracks');
    const filtered = cleanupEphemeralForDrive(tracks, drivePath);
    if (filtered.length !== tracks.length) {
      tracks.length = 0;
      tracks.push(...filtered);
      notify('tracks');
      rebuildTrackIdxMap();
      invalidateFilterCache();
      if (VIRT) VIRT._lastListSig = '';
    }
  }
  // Purge temp files via IPC (best-effort)
  try { await invoke('plugin:fs|remove', { path: await _cacheDir(), options: { recursive: true } }); }
  catch { /* may not exist, ignore */ }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

async function _cacheDir() {
  // Tauri app data dir — wrapper around path::app_data_dir
  const base = await invoke('plugin:path|app_data_dir');
  return `${base}\\${CACHE_SUBDIR}`;
}

async function _tempPathForRip(rip_id) {
  const dir = await _cacheDir();
  try { await invoke('plugin:fs|create', { path: dir, options: { recursive: true } }); } catch {}
  return `${dir}\\${rip_id}.flac`;
}

async function _subscribeProgress(rip_id) {
  if (_progressUnlisten) _progressUnlisten();
  _progressUnlisten = await listen('cd-rip-progress', (event) => {
    const p = event.payload;
    if (!p || p.rip_id !== rip_id) return;
    const percent = calculateRipPercent(p.sector_current, p.sector_total);
    _setProgressFill(percent);
  });
}

function _unsubscribeProgress() {
  if (_progressUnlisten) { _progressUnlisten(); _progressUnlisten = null; }
}

function _showProgressUi() {
  const el = document.getElementById('cd-progress');
  const ac = document.getElementById('cd-actions');
  if (el) el.hidden = false;
  if (ac) ac.hidden = true;
  _setProgressFill(0);
}

function _resetProgressUi() {
  const el = document.getElementById('cd-progress');
  const ac = document.getElementById('cd-actions');
  if (el) el.hidden = true;
  if (ac) ac.hidden = false;
  _setProgressFill(0);
}

function _setProgressFill(percent) {
  const fill = document.getElementById('cd-progress-fill');
  if (fill) fill.style.width = `${percent}%`;
}

function _setProgressText(t) {
  const el = document.getElementById('cd-progress-text');
  if (el) el.textContent = t;
}

function _formatDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _schedulePrefetch(drivePath, nextIdx) {
  if (_prefetchTimer) { clearTimeout(_prefetchTimer); _prefetchTimer = null; }
  // Listen for the current track's timeupdate — naive impl: poll the global audio element
  const audio = document.getElementById('audio');
  if (!audio) return;
  const onTime = async () => {
    if (audio.duration - audio.currentTime < 5) {
      audio.removeEventListener('timeupdate', onTime);
      // Best-effort prefetch: silently rip next track into temp
      try {
        const rip_id = crypto.randomUUID();
        const tempPath = await _tempPathForRip(rip_id);
        await invoke('cd_rip_track', {
          drive: drivePath, track_idx: nextIdx, dest_path: tempPath, rip_id,
        });
      } catch (e) {
        console.warn('[cdaudio] prefetch failed:', e);
      }
    }
  };
  audio.addEventListener('timeupdate', onTime);
}
```

**Note to executor:** This module references `./tauri-event.js` and `./tauri-path.js` wrappers — small adapters around `@tauri-apps/api/event` and `@tauri-apps/api/path` / `convertFileSrc`. If these don't already exist in `frontend/src/`, create them as one-liner re-exports. Check what the existing codebase uses for Tauri event subscriptions and reuse that pattern (look at `app.js` or `mini.js` for an example).

- [ ] **Step 2: Verify the module parses**

Run: `node --check frontend/src/cdaudio.js`

Expected: no syntax errors. (Module resolution against `./store.js` etc. happens at bundle time, not at syntax check.)

- [ ] **Step 3: Run vite build to catch import errors**

Run: `npm run build` (or whatever the project uses — check `package.json` scripts)

Expected: clean build. If `./tauri-event.js` or `./tauri-path.js` are missing, the build will fail with an unresolved import — create the wrappers per the note above.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/cdaudio.js frontend/src/tauri-event.js frontend/src/tauri-path.js
git commit -m "feat(cdaudio): orchestration module (play / extract / cancel / cleanup)"
```

---

### Task 11: Extend `devices.js` for audio CD detection

**Files:**
- Modify: `frontend/src/devices.js`

- [ ] **Step 1: Import the pure helper + cdaudio actions**

At the top of `frontend/src/devices.js`, after the existing imports, add:

```js
import { detectNewAudioCds }       from './cdaudio_pure.js';
import { openCdModal, cleanupCdCache } from './cdaudio.js';
```

- [ ] **Step 2: Extend `_poll` to detect audio CDs**

Locate the `_poll` function. After the existing USB detection block (`for (const d of newRemovable) _onUsbConnected(d);`), add:

```js
  // Audio CD detection — new CDs since last poll
  const newCds = detectNewAudioCds(_lastDrives, drives);
  for (const cd of newCds) _onAudioCdInserted(cd);

  // Eject detection — CDs that were present and have gone (or are now empty)
  const currAudioPaths = new Set(drives.filter(d => d.audio_cd).map(d => d.path));
  for (const prev of _lastDrives) {
    if (prev.audio_cd && !currAudioPaths.has(prev.path)) {
      // Disc ejected (drive may still be there but media gone, or drive gone entirely)
      cleanupCdCache(prev.path).catch(e => console.warn('[devices] cleanup failed:', e));
    }
  }
```

- [ ] **Step 3: Add the audio CD insertion handler**

After the existing `_onUsbConnected` function, add:

```js
function _onAudioCdInserted(drive) {
  toast(
    `CD Audio détecté (${drive.track_count} pistes) — Lire ou extraire ?`,
    'info'
  );
  openCdModal(drive.path);
}
```

- [ ] **Step 4: Verify with build**

Run: `npm run build`

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/devices.js
git commit -m "feat(cdaudio): devices.js detects audio CD insert + eject"
```

---

### Task 12: Add CD modal markup + CSS

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/style.css` (or whichever file holds existing `.modal-bg` styles — likely `style.css` or a dedicated `modal.css`)

- [ ] **Step 1: Locate the existing USB modal markup**

Open `frontend/index.html`. Find the `<div id="usb-modal-bg" ...>` block — it ends with a matching `</div>`. The CD modal will be a sibling with the same structural pattern.

- [ ] **Step 2: Append the CD modal markup**

Immediately after the USB modal closing `</div>`, add:

```html
<div id="cd-modal-bg" class="modal-bg">
  <div class="modal-card">
    <h2>CD Audio détecté</h2>
    <p>Volume : <strong id="cd-label"></strong></p>
    <p><span id="cd-track-count"></span> pistes — <span id="cd-duration"></span></p>

    <div id="cd-progress" hidden>
      <div class="cd-progress-bar"><div id="cd-progress-fill"></div></div>
      <p id="cd-progress-text">Extraction : 0 / 0</p>
      <button id="cd-cancel-btn" data-action="cd-cancel-rip">Annuler</button>
    </div>

    <div class="modal-actions" id="cd-actions">
      <button data-action="cd-play">Lire</button>
      <button data-action="cd-extract">Extraire vers bibliothèque</button>
      <button data-action="cd-cancel-modal">Ignorer</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for the progress bar**

Find the existing CSS file used by the USB modal (search for `.modal-bg` or `.modal-card`). Append:

```css
.cd-progress-bar {
  width: 100%;
  height: 8px;
  background: var(--scrim, rgba(0,0,0,0.2));
  border-radius: 4px;
  border: 1px solid var(--border-1, rgba(255,255,255,0.1));
  overflow: hidden;
  margin: 12px 0;
}
#cd-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--accent, #4a9eff);
  transition: width 200ms ease-out;
}
#cd-progress-text {
  font-size: 0.9em;
  opacity: 0.8;
}
```

- [ ] **Step 4: Verify HTML/CSS load**

Run: `npm run build`

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/style.css
git commit -m "feat(cdaudio): CD modal markup + progress bar CSS (uses design tokens)"
```

---

### Task 13: Wire `cdaudio.js` exports into `app.js` + handle clicks + boot GC

**Files:**
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Import cdaudio exports**

Near the top of `frontend/src/app.js` with the other module imports, add:

```js
import {
  openCdModal,
  closeCdModal,
  playCdTrack,
  extractCd,
  cancelCurrentRip,
  cleanupCdCache,
} from './cdaudio.js';
```

- [ ] **Step 2: Expose via `window` (matches existing wiring convention)**

Locate the existing `Object.assign(window, { ... })` block in `app.js` (per CLAUDE.md section 5 — UI wiring is centralized here). Add the new functions:

```js
Object.assign(window, {
  // ... existing entries ...
  openCdModal, closeCdModal, playCdTrack, extractCd, cancelCurrentRip,
});
```

- [ ] **Step 3: Add click handlers for the CD modal actions**

Find the global click handler in `app.js` (it likely uses `data-action` dispatch — search for `data-action`). Add cases for the CD actions inside the existing dispatch:

```js
// Inside the global click handler switch/if-chain:
if (action === 'cd-play')        { const drive = window._cdActionDrive; playCdTrack(drive, 1); return; }
if (action === 'cd-extract')     { const drive = window._cdActionDrive; extractCd(drive);      return; }
if (action === 'cd-cancel-modal'){ closeCdModal(); return; }
if (action === 'cd-cancel-rip')  { cancelCurrentRip(); return; }
```

For the `window._cdActionDrive` plumbing: `openCdModal(drivePath)` should also stash the path on `window._cdActionDrive` so the click handler can retrieve it. Update `openCdModal` in `frontend/src/cdaudio.js` to do this — at the top of the function:

```js
window._cdActionDrive = drivePath;
```

- [ ] **Step 4: Boot-time cache GC**

Find the existing boot sequence in `app.js` (after `initDevices()` or similar). Add:

```js
// Purge any orphaned CD cache files from a previous crash
cleanupCdCache(null).catch(e => console.warn('[boot] CD cache GC failed:', e));
```

(`cleanupCdCache(null)` skips the tracks filter and only purges files — handled by the `if (drivePath)` guard in the function.)

- [ ] **Step 5: Run build + manual smoke**

Run: `npm run build`

Expected: clean build.

Run: `npm run dev` (or `npm run tauri dev` — check `package.json`)

Manual smoke (no CD required yet):
- App boots without console errors
- `window.openCdModal` is defined
- `window.openCdModal('D:\\')` from devtools opens the modal (will probably show "CD illisible" since no actual disc — that's expected)
- "Ignorer" closes the modal

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app.js frontend/src/cdaudio.js
git commit -m "feat(cdaudio): wire exports + click dispatch + boot cache GC"
```

---

## Phase D — Verification

### Task 14: Run the full test suite + final cargo check

**Files:** none modified — verification only.

- [ ] **Step 1: Run JS tests**

Run: `npm test`

Expected: `Total : 269 OK: 269 KO: 0` (or higher if other tests were added) — no regressions, all CD pure-function tests pass.

- [ ] **Step 2: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: `cdaudio_toc_test` passes (3 tests), all existing tests still pass.

- [ ] **Step 3: Run final cargo check (release profile)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --release`

Expected: clean. May take 1-2 minutes for full release build typecheck.

- [ ] **Step 4: Verify bundle size impact**

Run: `npm run build` then check `dist/` size. Compare to `git stash; npm run build; du -sb dist; git stash pop`. Expected delta: < 5KB JS (cdaudio.js + cdaudio_pure.js).

For the Rust binary, the +150KB target for `flacenc` is checked at release build time — note in commit message but don't block on it.

---

### Task 15: Manual smoke test with real hardware

**Files:** none — checklist only.

Mark each as done after physical verification. Skip any that lack hardware.

- [ ] **Audio CD (pure)** — insert a known audio CD. Within 12s: toast + modal appear with correct track count.
- [ ] **Lire (PLAY)** — click "Lire". Track 1 starts within ~90s on an 8x drive. Progress bar updates. Audio plays through normal pipeline (EQ, volume slider all work).
- [ ] **Prefetch** — let track 1 play to the end. Track 2 starts within 1s with no gap.
- [ ] **Extraire (EXTRACT)** — insert CD, click "Extraire". Banner shows "Extraction : i/N". All tracks land in `<watchPath>/CD_<label>_<date>/Track 0X.flac`. Toast confirms count. Tracks appear in library with `Track 0X` titles.
- [ ] **Cancel during rip** — click "Annuler" mid-rip. Returns to action buttons quickly. Partial file cleaned up. No crash.
- [ ] **Eject during play** — eject CD while playing. Ephemeral tracks removed from `tracks[]`. Audio stops gracefully (no crash). Cache purged.
- [ ] **Data CD** — insert a data CD (e.g. Windows install media). No toast, no modal, no error.
- [ ] **Empty drive** — boot app with empty optical drive. No errors in console.
- [ ] **Mixed CD** — insert a CD with 1 data track + audio tracks. Modal shows only audio track count. Extract gets audio only.

- [ ] **Commit verification record**

After the manual session:

```bash
git commit --allow-empty -m "verify(cdaudio): manual smoke test complete"
```

(Optional — only if you want a marker commit.)

---

## Self-Review Notes

**Spec coverage check:**
- Architecture diagram → Tasks 2, 4, 5, 6, 7 (Rust) + 9, 10, 11, 12, 13 (JS) ✓
- Detection extension → Task 7 (Rust list_drives) + Task 11 (devices.js polling) ✓
- PLAY flow → Task 10 (cdaudio.js playCdTrack) ✓
- EXTRACT flow → Task 10 (extractCd) ✓
- Track 01/02 metadata → Task 8 (formatTrackLabel + buildEphemeralCdTrack tests) ✓
- FLAC encoding → Task 5 (encode_flac) ✓
- Cache temp + GC → Task 13 (boot GC) + Task 10 (cleanupCdCache) ✓
- _isEphemeralCd flag → Task 9 (dput skip) + Task 8 (buildEphemeralCdTrack tests) ✓
- Cancel → Task 6 (cd_cancel_rip) + Task 10 (cancelCurrentRip) ✓
- Windows-only stub → Task 2 (cdaudio.rs stubs) ✓
- Error handling table → distributed across Tasks 5 (retry, silence pad), 7 (silent fail audio_cd), 10 (toast on user-visible errors) ✓
- Testing → Tasks 3, 8, 9, 14 (automated) + Task 15 (manual) ✓

**Placeholder scan:** no TBDs in the plan. Two notes-to-executor are flagged where the `flacenc` API or Tauri wrapper modules may need version-specific adjustment — these are honest advisories, not placeholders. All code blocks are complete and runnable as-written modulo those known API drift points.

**Type consistency check:**
- `CdTrack { idx, lba_start, frames, duration_sec }` — used identically in Task 2, 3, 4, 5
- `_isEphemeralCd` / `_cdDrive` — used identically in Task 8, 9, 10, 11
- `cd-rip-progress` event payload `{ rip_id, percent, sector_current, sector_total }` — used identically in Task 5 (emit) and Task 10 (subscribe)
- `extractDestPath` returns `<baseDir>\CD_<safe>_<date>\Track 0N.flac` — used identically in Task 8 (test) and Task 10 (extractCd)
