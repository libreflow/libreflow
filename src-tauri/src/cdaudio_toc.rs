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
            None => {
                // TOC malformé : aucune entrée (lead-out inclus) n'a une LBA > lba.
                // Piste ignorée plutôt que de retourner une durée 0 trompeuse.
                eprintln!(
                    "[cdaudio_toc] WARN: track {} (LBA {}) has no subsequent TOC entry — skipped",
                    track_no, lba
                );
                continue;
            }
        };
        audio_tracks.push(ParsedTrack {
            idx: track_no,
            lba_start: lba,
            frames,
        });
    }

    Ok(audio_tracks)
}

/// Convert frames (1/75 second each) into seconds.
pub fn frames_to_seconds(frames: u32) -> f32 {
    frames as f32 / 75.0
}

#[cfg(test)]
mod tests {
    use super::*;

    // Construit un buffer TOC minimal à partir d'une liste d'entrées
    // (track_no, lba_be: u32, control: u8). Le header length est calculé auto.
    fn make_toc(first: u8, last: u8, entries: &[(u8, u32, u8)]) -> Vec<u8> {
        let entry_bytes = entries.len() * TRACK_ENTRY_SIZE;
        // length field = total data after first 2 bytes = HEADER_SIZE - 2 + entries
        let length = (HEADER_SIZE - 2 + entry_bytes) as u16;
        let mut buf = vec![
            (length >> 8) as u8,
            (length & 0xFF) as u8,
            first,
            last,
        ];
        for &(track_no, lba, control) in entries {
            buf.push(0x00); // reserved
            buf.push(0x10 | (control & 0x0F)); // ADR=1, CONTROL
            buf.push(track_no);
            buf.push(0x00); // reserved
            buf.push(((lba >> 24) & 0xFF) as u8);
            buf.push(((lba >> 16) & 0xFF) as u8);
            buf.push(((lba >>  8) & 0xFF) as u8);
            buf.push((lba & 0xFF) as u8);
        }
        buf
    }

    #[test]
    fn standard_two_track_cd() {
        // Tracks 1 (LBA 0) and 2 (LBA 15000), lead-out at 30000
        let buf = make_toc(1, 2, &[
            (1,    0,     0x00), // audio
            (2,    15000, 0x00), // audio
            (0xAA, 30000, 0x00), // lead-out
        ]);
        let tracks = parse_toc_lba(&buf).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0], ParsedTrack { idx: 1, lba_start: 0,     frames: 15000 });
        assert_eq!(tracks[1], ParsedTrack { idx: 2, lba_start: 15000, frames: 15000 });
    }

    #[test]
    fn lead_out_not_last_in_buffer() {
        // Lead-out placé avant la dernière piste (TOC malformé — B26 regression)
        let buf = make_toc(1, 2, &[
            (1,    0,     0x00), // audio
            (0xAA, 30000, 0x00), // lead-out en 2e position
            (2,    15000, 0x00), // audio en 3e position
        ]);
        let tracks = parse_toc_lba(&buf).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].frames, 15000); // track 1 : prochain LBA > 0 = 15000
        assert_eq!(tracks[1].frames, 15000); // track 2 : prochain LBA > 15000 = 30000
    }

    #[test]
    fn data_track_excluded() {
        // Piste 2 est une piste de données (CONTROL bit 0x04)
        let buf = make_toc(1, 3, &[
            (1,    0,     0x00), // audio
            (2,    15000, 0x04), // data — doit être exclue
            (3,    20000, 0x00), // audio
            (0xAA, 30000, 0x00),
        ]);
        let tracks = parse_toc_lba(&buf).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].idx, 1);
        assert_eq!(tracks[1].idx, 3);
        // Track 1 : prochain LBA > 0 = 15000 (même si c'est une piste data)
        assert_eq!(tracks[0].frames, 15000);
        // Track 3 : prochain LBA > 20000 = 30000
        assert_eq!(tracks[1].frames, 10000);
    }

    #[test]
    fn no_lead_out_last_track_silently_dropped() {
        // Pas de lead-out : la dernière piste n'a pas d'entrée ultérieure → ignorée (B-R2)
        let buf = make_toc(1, 2, &[
            (1, 0,     0x00),
            (2, 15000, 0x00),
        ]);
        let tracks = parse_toc_lba(&buf).unwrap();
        // Track 1 a bien une suite (track 2 à LBA 15000)
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0], ParsedTrack { idx: 1, lba_start: 0, frames: 15000 });
        // Track 2 est silencieusement ignorée — c'est le comportement documenté (B-R2).
    }

    #[test]
    fn buffer_too_short_rejected() {
        assert!(parse_toc_lba(&[0u8; 3]).is_err());
    }

    #[test]
    fn length_field_exceeds_buffer_rejected() {
        let mut buf = make_toc(1, 1, &[(1, 0, 0x00), (0xAA, 1000, 0x00)]);
        buf[0] = 0xFF; // length = 0xFF00+xx >> buf.len()
        buf[1] = 0x00;
        assert!(parse_toc_lba(&buf).is_err());
    }

    #[test]
    fn frames_to_seconds_basic() {
        assert!((frames_to_seconds(75) - 1.0).abs() < 1e-5);
        assert!((frames_to_seconds(0) - 0.0).abs() < 1e-5);
        assert!((frames_to_seconds(150) - 2.0).abs() < 1e-5);
    }

    // NOTE: property-based fuzzing (proptest) for `parse_toc_lba` already lives
    // in `src-tauri/tests/cdaudio_toc_fuzz_test.rs` (never-panics on random/
    // boundary bytes, valid-TOC invariants, monotonic LBA, length-field
    // overflow attack, `frames_to_seconds` totality). Not duplicated here —
    // see that file for the fuzz coverage of this parser.
}
