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
    let last_track = buf[3];
    if first_track == 0 || last_track < first_track {
        return Err(format!(
            "Invalid track range: {}..={}",
            first_track, last_track
        ));
    }

    let entries_bytes = (length + 2).saturating_sub(HEADER_SIZE);
    let entry_count = entries_bytes / TRACK_ENTRY_SIZE;
    if entry_count < 2 {
        return Err("TOC must contain at least 1 track + lead-out".to_string());
    }

    let mut all: Vec<(u8, u32, bool)> = Vec::with_capacity(entry_count);
    // Per-entry byte layout (8 bytes, big-endian addresses):
    //   [0] reserved
    //   [1] ADR(high nibble) | CONTROL(low nibble)  — CONTROL bit 2 (0x04) set = data track
    //   [2] track number (0xAA = lead-out marker)
    //   [3] reserved
    //   [4..7] LBA u32 big-endian (since IOCTL was called with Msf=FALSE)
    for i in 0..entry_count {
        let off = HEADER_SIZE + i * TRACK_ENTRY_SIZE;
        let control_adr = buf[off + 1];
        let track_no = buf[off + 2];
        let lba = u32::from_be_bytes([buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]]);
        let control = control_adr & 0x0F;
        let is_audio = (control & 0x04) == 0;
        all.push((track_no, lba, is_audio));
    }

    let mut audio_tracks = Vec::new();
    // B26 FIX : la fin d'une piste = la plus petite LBA strictement supérieure
    // parmi TOUTES les entrées (piste suivante ou lead-out), pas all[i+1]. Un TOC
    // malformé (octets contrôlés par le device) peut placer le lead-out 0xAA
    // ailleurs qu'en dernière position — all[i+1] donnerait alors frames = 0.
    for i in 0..all.len() {
        let (track_no, lba, is_audio) = all[i];
        if track_no == 0xAA {
            continue;
        } // lead-out : pas une vraie piste
        if !is_audio {
            continue;
        }
        let next_lba = all.iter().map(|&(_, l, _)| l).filter(|&l| l > lba).min();
        let frames = match next_lba {
            Some(n) => n.saturating_sub(lba),
            None => continue, // aucune entrée après — piste sans fin connue
        };
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
