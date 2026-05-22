use libreflow_lib::cdaudio_toc::{parse_toc_lba, ParsedTrack};

#[test]
fn parses_three_audio_tracks_plus_leadout() {
    // Header: length=0x22, first=1, last=3, then 4 entries × 8 bytes
    // Each entry: [reserved, control|adr, track_no, reserved, lba_be×4]
    let buf: Vec<u8> = vec![
        0x00, 0x22, 0x01, 0x03, 0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x02,
        0x00, 0x00, 0x00, 0x4E, 0x20, 0x00, 0x10, 0x03, 0x00, 0x00, 0x00, 0x9C, 0x40, 0x00, 0x10,
        0xAA, 0x00, 0x00, 0x00, 0xEA, 0x60,
    ];
    let tracks = parse_toc_lba(&buf).unwrap();
    assert_eq!(tracks.len(), 3);
    assert_eq!(
        tracks[0],
        ParsedTrack {
            idx: 1,
            lba_start: 0,
            frames: 20000,
            is_audio: true
        }
    );
    assert_eq!(
        tracks[1],
        ParsedTrack {
            idx: 2,
            lba_start: 20000,
            frames: 20000,
            is_audio: true
        }
    );
    assert_eq!(
        tracks[2],
        ParsedTrack {
            idx: 3,
            lba_start: 40000,
            frames: 20000,
            is_audio: true
        }
    );
}

#[test]
fn filters_data_tracks() {
    // Header: length=0x1A, first=1, last=2, then 3 entries × 8 bytes
    // Entry 2 has control=0x14 (bit 2 set) marking it as data track
    let buf: Vec<u8> = vec![
        0x00, 0x1A, 0x01, 0x02, 0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0x02,
        0x00, 0x00, 0x00, 0x4E, 0x20, 0x00, 0x10, 0xAA, 0x00, 0x00, 0x00, 0x9C, 0x40,
    ];
    let tracks = parse_toc_lba(&buf).unwrap();
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].idx, 1);
    assert_eq!(tracks[0].lba_start, 0);
    assert_eq!(tracks[0].frames, 20000);
}

#[test]
fn rejects_short_buffer() {
    let buf = vec![0x00, 0x02, 0x01, 0x01];
    assert!(parse_toc_lba(&buf).is_err());
}
