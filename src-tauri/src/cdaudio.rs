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

// windows_impl module will be filled in subsequent tasks. For now, declare an
// empty stub so the cfg gates above compile on Windows without errors.
#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{CdTrack, CdToc};
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use tauri::AppHandle;

    pub(super) fn read_toc(_drive: &str) -> Result<CdToc, String> {
        Err("cd_read_toc not yet implemented".to_string())
    }

    pub(super) fn rip_track(
        _app: &AppHandle,
        _drive: &str,
        _track_idx: u8,
        _dest_path: &str,
        _rip_id: &str,
        _cancel: Arc<AtomicBool>,
    ) -> Result<(), String> {
        Err("cd_rip_track not yet implemented".to_string())
    }

    #[allow(dead_code)]
    fn _silence_unused_imports() -> (CdTrack, CdToc) {
        (
            CdTrack { idx: 0, lba_start: 0, frames: 0, duration_sec: 0.0 },
            CdToc { drive: String::new(), tracks: vec![], total_duration_sec: 0.0 },
        )
    }
}
