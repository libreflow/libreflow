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
    // Validation chemin destination (défense en profondeur — JS construit dest_path
    // depuis cd_cache_dir ou watchPath, mais on revalide côté Rust).
    validate_rip_dest(&dest_path)?;

    #[cfg(target_os = "windows")]
    {
        let cancel = register_cancel(&rip_id);
        let rip_id_inner = rip_id.clone();
        // CancelGuard garantit l'unregister même si spawn_blocking panique.
        let _guard = CancelGuard(&rip_id);
        let result = tokio::task::spawn_blocking(move || {
            windows_impl::rip_track(&app, &drive, track_idx, &dest_path, &rip_id_inner, cancel)
        })
        .await
        .map_err(|e| format!("rip task join error: {}", e))?;
        result
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, drive, track_idx, dest_path, rip_id);
        Err("CD audio non supporté sur cette plateforme".to_string())
    }
}

#[cfg(target_os = "windows")]
struct CancelGuard<'a>(&'a str);
#[cfg(target_os = "windows")]
impl<'a> Drop for CancelGuard<'a> {
    fn drop(&mut self) { unregister_cancel(self.0); }
}

/// Vérifie qu'un `dest_path` est sûr :
/// - extension `.flac` (case-insensitive)
/// - pas de composant `..` ni de chemin vide
/// - parent dans un dossier autorisé par `is_safe_dir` (rejette `C:\Windows\…` etc.)
fn validate_rip_dest(dest_path: &str) -> Result<(), String> {
    use std::path::{Component, Path};
    if dest_path.is_empty() {
        return Err("dest_path vide".to_string());
    }
    let p = Path::new(dest_path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("flac")) {
        return Err(format!("dest_path doit se terminer par .flac : {}", dest_path));
    }
    for c in p.components() {
        if matches!(c, Component::ParentDir) {
            return Err(format!("dest_path contient '..' : {}", dest_path));
        }
    }
    let parent = p.parent().ok_or_else(|| format!("dest_path sans parent : {}", dest_path))?;
    // Le parent peut ne pas exister encore (encode_flac le crée). Si canonicalize échoue,
    // on remonte jusqu'à un ancêtre existant pour la validation.
    let mut check = parent.to_path_buf();
    let canon = loop {
        if let Ok(c) = std::fs::canonicalize(&check) { break c; }
        let Some(p) = check.parent() else {
            return Err(format!("aucun ancêtre existant pour : {}", dest_path));
        };
        check = p.to_path_buf();
    };
    if !crate::commands::is_safe_dir(&canon) {
        return Err(format!("dest_path dans un dossier système refusé : {}", dest_path));
    }
    Ok(())
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

/// Returns the absolute path of the CD ephemeral-rip cache directory,
/// creating it on first call. Lives under the app data dir as `cd-cache/`.
#[tauri::command]
pub fn cd_cache_dir(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {}", e))?;
    let dir = base.join("cd-cache");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create cd-cache dir failed: {}", e))?;
    dir.into_os_string()
        .into_string()
        .map_err(|s| format!("non-UTF8 cache path: {:?}", s))
}

/// Recursively deletes the CD ephemeral-rip cache directory.
/// Missing directory is treated as success.
#[tauri::command]
pub fn cd_purge_cache(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {}", e))?;
    let dir = base.join("cd-cache");
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove cd-cache failed: {}", e)),
    }
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

    /// RAII guard pour HANDLE — appelle CloseHandle au Drop, garantissant zéro fuite
    /// même si une fonction panique entre l'ouverture et la fermeture.
    pub(super) struct DriveHandle(pub HANDLE);
    impl DriveHandle {
        pub fn raw(&self) -> HANDLE { self.0 }
    }
    impl Drop for DriveHandle {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                let _ = unsafe { CloseHandle(self.0) };
            }
        }
    }

    /// Opens a CD drive as a raw block device. The returned `DriveHandle` closes the handle on drop.
    /// `drive` must be a Windows drive root like "D:\\" — only the first letter is used.
    fn open_drive(drive: &str) -> Result<DriveHandle, String> {
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
        Ok(DriveHandle(handle))
    }

    pub(super) fn read_toc(drive: &str) -> Result<CdToc, String> {
        let handle = open_drive(drive)?;

        // CD TOC max ~804 bytes (100 tracks × 8 + 4-byte header); 1KB has margin
        let mut out_buf = vec![0u8; 1024];
        let mut bytes_returned: u32 = 0;

        let result = unsafe {
            DeviceIoControl(
                handle.raw(),
                IOCTL_CDROM_READ_TOC,
                None,
                0,
                Some(out_buf.as_mut_ptr() as *mut _),
                out_buf.len() as u32,
                Some(&mut bytes_returned),
                None,
            )
        };

        // handle est fermé automatiquement au drop en fin de fonction

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

    // ── Streaming source : lit les secteurs CD à la demande pour l'encodeur FLAC ──
    //
    // Au lieu de pré-allouer un Vec<i32> pour TOUS les samples du track (~1.76 GB
    // dans le pire cas), cette Source garde un petit buffer de FRAMES_PER_CHUNK
    // secteurs (~235 KB) et le re-remplit à chaque appel `read_samples`. Mémoire
    // O(chunk) au lieu de O(track).
    //
    // - Cancellation propagée via Arc<AtomicBool>. Quand activée, read_samples
    //   retourne Ok(0) (EOF gracieux) ; le caller détecte le flag après l'encode
    //   pour retourner "cancelled" et supprimer le fichier partiel.
    // - Read errors retry × 3 avec backoff, fallback silence-pad pour préserver
    //   l'alignement temporel du track.
    // - Progress event émis toutes les 500 ms.
    struct CdRipSource<'a> {
        handle: DriveHandle,
        lba_start: u32,
        sectors_total: u32,
        lba_cursor: u32,
        sample_buf: Vec<i32>,       // interleaved L,R,L,R...
        sample_cursor: usize,
        cancel: Arc<AtomicBool>,
        app: &'a AppHandle,
        rip_id: &'a str,
        last_emit: std::time::Instant,
    }

    impl<'a> CdRipSource<'a> {
        fn new(
            handle: DriveHandle,
            lba_start: u32,
            sectors_total: u32,
            cancel: Arc<AtomicBool>,
            app: &'a AppHandle,
            rip_id: &'a str,
        ) -> Self {
            Self {
                handle,
                lba_start,
                sectors_total,
                lba_cursor: 0,
                sample_buf: Vec::with_capacity(FRAMES_PER_CHUNK as usize * FRAMES_PER_SECTOR * 2),
                sample_cursor: 0,
                cancel,
                app,
                rip_id,
                last_emit: std::time::Instant::now(),
            }
        }

        /// Lit le prochain chunk de secteurs et remplit sample_buf.
        /// Retourne true si des données ont été produites, false si EOF.
        fn refill_buffer(&mut self) -> bool {
            if self.lba_cursor >= self.sectors_total { return false; }
            let chunk = FRAMES_PER_CHUNK.min(self.sectors_total - self.lba_cursor);
            let lba = self.lba_start + self.lba_cursor;

            let pcm = match read_audio_sectors(self.handle.raw(), lba, chunk) {
                Ok(b) => b,
                Err(_e) => {
                    // Retry × 3 avec backoff
                    let mut retry_pcm = None;
                    for attempt in 1..=3u64 {
                        std::thread::sleep(std::time::Duration::from_millis(100 * attempt));
                        if let Ok(b) = read_audio_sectors(self.handle.raw(), lba, chunk) {
                            retry_pcm = Some(b);
                            break;
                        }
                    }
                    retry_pcm.unwrap_or_else(|| {
                        eprintln!(
                            "[cdaudio] WARN: LBA {} — read failed after 3 retries; padding {} sectors with silence",
                            lba, chunk
                        );
                        vec![0u8; SECTOR_BYTES * chunk as usize]
                    })
                }
            };

            self.sample_buf.clear();
            for stereo_frame in pcm.chunks_exact(4) {
                let l = i16::from_le_bytes([stereo_frame[0], stereo_frame[1]]) as i32;
                let r = i16::from_le_bytes([stereo_frame[2], stereo_frame[3]]) as i32;
                self.sample_buf.push(l);
                self.sample_buf.push(r);
            }
            self.sample_cursor = 0;
            self.lba_cursor += chunk;

            if self.last_emit.elapsed() >= std::time::Duration::from_millis(500) {
                let percent = ((self.lba_cursor as f64 / self.sectors_total as f64) * 100.0) as u32;
                let _ = self.app.emit("cd-rip-progress", serde_json::json!({
                    "rip_id":         self.rip_id,
                    "percent":        percent,
                    "sector_current": self.lba_cursor,
                    "sector_total":   self.sectors_total,
                }));
                self.last_emit = std::time::Instant::now();
            }
            true
        }
    }

    impl<'a> flacenc::source::Source for CdRipSource<'a> {
        fn channels(&self) -> usize { 2 }
        fn bits_per_sample(&self) -> usize { 16 }
        fn sample_rate(&self) -> usize { 44100 }
        fn len_hint(&self) -> Option<usize> {
            Some((self.sectors_total as usize) * FRAMES_PER_SECTOR)
        }

        fn read_samples<F: flacenc::source::Fill>(
            &mut self,
            block_size: usize,
            dest: &mut F,
        ) -> Result<usize, flacenc::error::SourceError> {
            // block_size = frames per channel ; on a besoin de block_size * 2 i32 interleaved.
            let needed_samples = block_size * 2;
            // Buffer de sortie : pas d'allocation par appel grâce à un Vec réutilisé serait possible,
            // mais block_size est petit (~4096 frames = 8192 i32 = 32 KB) donc l'alloc est négligeable.
            let mut out: Vec<i32> = Vec::with_capacity(needed_samples);

            while out.len() < needed_samples {
                if self.cancel.load(Ordering::SeqCst) {
                    break; // EOF gracieux — l'encode courant se termine sur ce qu'on a déjà
                }
                if self.sample_cursor >= self.sample_buf.len() && !self.refill_buffer() {
                    break; // fin du track
                }
                let take = (needed_samples - out.len()).min(self.sample_buf.len() - self.sample_cursor);
                out.extend_from_slice(&self.sample_buf[self.sample_cursor..self.sample_cursor + take]);
                self.sample_cursor += take;
            }

            if out.is_empty() { return Ok(0); }
            dest.fill_interleaved(&out)
                .map_err(|_| flacenc::error::SourceError::from_unknown())?;
            // Nombre de frames par-canal délivrés
            Ok(out.len() / 2)
        }
    }

    fn encode_flac_streaming(
        source: CdRipSource<'_>,
        dest_path: &str,
    ) -> Result<bool, String> {
        use flacenc::bitsink::ByteSink;
        use flacenc::component::BitRepr;
        use flacenc::config::Encoder as EncoderConfig;
        use flacenc::error::Verify;

        let config = EncoderConfig::default()
            .into_verified()
            .map_err(|e| format!("flacenc config verify failed: {:?}", e))?;
        let block_size = config.block_size;

        // Note : encode_with_fixed_block_size prend ownership de la Source.
        // L'encodeur appelle Source::read_samples en boucle jusqu'à EOF (return 0).
        // La cancellation produit aussi un EOF gracieux.
        //
        // Mémoire ici : ByteSink accumule la sortie FLAC compressée. Pour un track CD
        // typique de 5 minutes ≈ 25-35 MB compressé. Acceptable. (Pour streamer aussi
        // l'OUTPUT vers un fichier, il faudrait implémenter BitSink sur BufWriter<File>.
        // Hors scope actuel — la majorité de l'économie était côté input PCM.)
        // On capture le flag cancel via une référence atomique partagée avec la source —
        // mais comme la source est moved, on doit aussi tracer le flag via le retour
        // de cancellation. On utilise un Arc cloné pour le check post-encode.
        let cancel_check = source.cancel.clone();

        let stream = flacenc::encode_with_fixed_block_size(&config, source, block_size)
            .map_err(|e| format!("flacenc encode failed: {:?}", e))?;

        if cancel_check.load(Ordering::SeqCst) {
            return Ok(true); // cancelled — caller skip écriture disque
        }

        let mut sink = ByteSink::new();
        stream.write(&mut sink)
            .map_err(|e| format!("flacenc write failed: {:?}", e))?;

        let bytes = sink.as_slice();
        if bytes.is_empty() {
            return Err("encode_flac: flux FLAC vide produit par l'encodeur".to_string());
        }

        if let Some(parent) = std::path::Path::new(dest_path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create FLAC parent dir failed: {}", e))?;
            }
        }
        std::fs::write(dest_path, bytes)
            .map_err(|e| format!("write FLAC file failed: {}", e))?;

        Ok(false) // not cancelled
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
                "track {} reports {} sectors (> {} cap) — refusing",
                track_idx, total_sectors, MAX_SECTORS_GUARD
            ));
        }

        let handle = open_drive(drive)?;

        // Source streaming : lit les secteurs à la demande au lieu de pré-allouer
        // ~1.76 GB de PCM. Mémoire bornée à ~235 KB (FRAMES_PER_CHUNK * 588 * 2 * i32).
        let source = CdRipSource::new(handle, track.lba_start, total_sectors, cancel.clone(), app, rip_id);
        let was_cancelled = encode_flac_streaming(source, dest_path)?;
        if was_cancelled {
            let _ = std::fs::remove_file(dest_path); // pas de fichier partiel laissé sur disque
            return Err("cancelled".to_string());
        }

        let _ = app.emit("cd-rip-progress", serde_json::json!({
            "rip_id": rip_id,
            "percent": 100,
            "sector_current": total_sectors,
            "sector_total": total_sectors,
        }));

        Ok(())
    }
}
