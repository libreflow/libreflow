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

#[allow(dead_code)]
fn register_cancel(rip_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut guard = rip_cancel_lock();
    guard.as_mut().unwrap().insert(rip_id.to_string(), flag.clone());
    flag
}

#[allow(dead_code)]
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
        let rip_id_inner = rip_id.clone();
        let result = tokio::task::spawn_blocking(move || {
            windows_impl::rip_track(&app, &drive, track_idx, &dest_path, &rip_id_inner, cancel)
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
mod windows_impl {
    use super::{CdTrack, CdToc};
    use crate::cdaudio_toc::{parse_toc_lba, frames_to_seconds};
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use tauri::AppHandle;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    // GENERIC_READ as a raw u32 (GENERIC_ACCESS_RIGHTS(2147483648u32).0)
    const GENERIC_READ_U32: u32 = 0x80000000u32;
    const IOCTL_CDROM_READ_TOC: u32 = 0x00024000;

    /// Opens a CD drive as a raw block device. Caller must call `CloseHandle` on the returned HANDLE.
    /// `drive` must be a Windows drive root like "D:\\" — only the first letter is used.
    fn open_drive(drive: &str) -> Result<HANDLE, String> {
        // drive comes in as "D:\\" — convert to "\\\\.\\D:"
        let letter = drive.chars().next().ok_or_else(|| "empty drive string".to_string())?;
        let path = format!("\\\\.\\{}:", letter);
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                GENERIC_READ_U32,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        }
        .map_err(|e| format!(
            "CreateFileW({}) failed: {} (os: {})",
            path, e, std::io::Error::last_os_error()
        ))?;
        Ok(handle)
    }

    pub(super) fn read_toc(drive: &str) -> Result<CdToc, String> {
        let handle = open_drive(drive)?;

        // CD TOC max ~804 bytes (100 tracks × 8 + 4-byte header); 1KB has margin
        let mut out_buf = vec![0u8; 1024];
        let mut bytes_returned: u32 = 0;

        let result = unsafe {
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

        let _ = unsafe { CloseHandle(handle) };

        result.map_err(|e| format!(
            "IOCTL_CDROM_READ_TOC failed: {:?} (os: {})",
            e, std::io::Error::last_os_error()
        ))?;

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

    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    const IOCTL_CDROM_RAW_READ: u32 = 0x0002403E;
    const TRACK_MODE_CDDA: u32 = 2;
    const SECTOR_BYTES: usize = 2352;       // CD audio sector size
    const FRAMES_PER_CHUNK: u32 = 50;        // ~117KB per IOCTL call
    const FRAMES_PER_SECTOR: usize = 588;    // 588 stereo PCM frames per CDDA sector
    const MAX_SECTORS_GUARD: u32 = 400_000;  // ~88 min — longer than any real CD; OOM safety

    /// RAW_READ_INFO struct expected by IOCTL_CDROM_RAW_READ (ntddcdrm.h).
    #[repr(C)]
    struct RawReadInfo {
        disk_offset_lo: u32,
        disk_offset_hi: u32,
        sector_count: u32,
        track_mode: u32,
    }

    fn read_audio_sectors(
        handle: HANDLE,
        start_lba: u32,
        sector_count: u32,
    ) -> Result<Vec<u8>, String> {
        // IOCTL expects DiskOffset = LBA * 2048 (logical sector size), not byte offset
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
            return Err(format!(
                "IOCTL_CDROM_RAW_READ failed at LBA {}: {:?} (os: {})",
                start_lba, ok.err(), std::io::Error::last_os_error()
            ));
        }

        out.truncate(bytes_returned as usize);
        Ok(out)
    }

    fn encode_flac(samples: &[i32], dest_path: &str) -> Result<(), String> {
        use flacenc::bitsink::ByteSink;
        use flacenc::component::BitRepr;
        use flacenc::config::Encoder as EncoderConfig;
        use flacenc::error::Verify;
        use flacenc::source::MemSource;

        let channels = 2;
        let bits_per_sample = 16;
        let sample_rate = 44100;

        let config = EncoderConfig::default()
            .into_verified()
            .map_err(|e| format!("flacenc config verify failed: {:?}", e))?;
        let block_size = config.block_size;

        let source = MemSource::from_samples(samples, channels, bits_per_sample, sample_rate);

        let stream = flacenc::encode_with_fixed_block_size(&config, source, block_size)
            .map_err(|e| format!("flacenc encode failed: {:?}", e))?;

        let mut sink = ByteSink::new();
        stream.write(&mut sink)
            .map_err(|e| format!("flacenc write failed: {:?}", e))?;

        std::fs::write(dest_path, sink.as_slice())
            .map_err(|e| format!("write FLAC file failed: {}", e))?;

        Ok(())
    }

    pub(super) fn rip_track(
        app: &AppHandle,
        drive: &str,
        track_idx: u8,
        dest_path: &str,
        rip_id: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        let toc = read_toc(drive)?;
        let track = toc.tracks.iter()
            .find(|t| t.idx == track_idx)
            .ok_or_else(|| format!("track {} not in TOC", track_idx))?;

        let total_sectors = track.frames;
        if total_sectors == 0 {
            return Err(format!("track {} has 0 frames", track_idx));
        }
        if total_sectors > MAX_SECTORS_GUARD {
            return Err(format!(
                "track {} reports {} sectors (> {} cap) — refusing to allocate",
                track_idx, total_sectors, MAX_SECTORS_GUARD
            ));
        }

        let handle = open_drive(drive)?;

        // CD audio: 44100 Hz, 16-bit signed LE, 2 channels (stereo interleaved)
        // 1 sector = 2352 bytes = FRAMES_PER_SECTOR stereo frames × 2 channels × 2 bytes
        let mut all_samples: Vec<i32> = Vec::with_capacity((total_sectors as usize) * FRAMES_PER_SECTOR * 2);
        let mut sectors_done: u32 = 0;
        let mut last_emit = std::time::Instant::now();

        while sectors_done < total_sectors {
            if cancel.load(Ordering::SeqCst) {
                let _ = unsafe { CloseHandle(handle) };
                let _ = std::fs::remove_file(dest_path);
                return Err("cancelled".to_string());
            }

            let chunk = FRAMES_PER_CHUNK.min(total_sectors - sectors_done);
            let lba = track.lba_start + sectors_done;

            let pcm = match read_audio_sectors(handle, lba, chunk) {
                Ok(b) => b,
                Err(e) => {
                    // Retry up to 3 times with backoff
                    let mut retry_pcm = None;
                    for attempt in 1..=3u64 {
                        std::thread::sleep(std::time::Duration::from_millis(100 * attempt));
                        if let Ok(b) = read_audio_sectors(handle, lba, chunk) {
                            retry_pcm = Some(b);
                            break;
                        }
                    }
                    match retry_pcm {
                        Some(b) => b,
                        None => {
                            // Permanent read failure — pad with silence to keep track time-aligned.
                            // The FLAC will have a noticeable gap; user should refer to the WARN
                            // log if the output sounds wrong.
                            eprintln!(
                                "[cdaudio] WARN: LBA {} — read failed after 3 retries; padding {} sectors with silence",
                                lba, chunk
                            );
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

        encode_flac(&all_samples, dest_path)?;

        let _ = app.emit("cd-rip-progress", serde_json::json!({
            "rip_id": rip_id,
            "percent": 100,
            "sector_current": total_sectors,
            "sector_total": total_sectors,
        }));

        Ok(())
    }
}
