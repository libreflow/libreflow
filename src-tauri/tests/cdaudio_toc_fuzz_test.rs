//! Property-based tests for the CD-ROM TOC parser.
//!
//! The parser ingests bytes that come from a Windows IOCTL call against a CD-ROM
//! device. Damaged discs, buggy drives, or hostile peripherals can return any
//! shape of buffer — including truncated, oversized, or all-0xFF data. These
//! tests verify the parser **never panics** and produces output that satisfies
//! basic invariants regardless of input.
//!
//! Uses proptest to generate millions of random inputs in seconds.

use libreflow_lib::cdaudio_toc::{parse_toc_lba, frames_to_seconds};
use proptest::prelude::*;

// ─────────────────────────────────────────────────────────────────────────────
// Property 1 : no panic on ARBITRARY bytes
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    /// Fuzz the parser with completely random byte buffers up to 2 KB (the IOCTL
    /// buffer is 1 KB in production — 2 KB gives margin). The parser must return
    /// Result<…>, never panic. catch_unwind is not needed because parse_toc_lba
    /// is a regular function; if it panics in test mode, the test fails.
    #[test]
    fn never_panics_on_random_bytes(buf in proptest::collection::vec(any::<u8>(), 0..=2048)) {
        let _ = parse_toc_lba(&buf);
    }

    /// Specifically target buffers in the "almost valid" range (HEADER + 1-2 entries).
    /// Bugs around boundary conditions usually live here.
    #[test]
    fn never_panics_on_boundary_size_bytes(buf in proptest::collection::vec(any::<u8>(), 4..=20)) {
        let _ = parse_toc_lba(&buf);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 2 : valid generated TOCs parse correctly with bounded output
// ─────────────────────────────────────────────────────────────────────────────

/// Generator for a well-formed TOC entry payload.
/// Produces entries with monotonically increasing LBAs and a lead-out marker.
fn arb_valid_toc()
    -> impl Strategy<Value = (u8, u8, Vec<(u8, u8, u32)>)>
{
    // 1 to 99 audio tracks (CD spec max is 99)
    (1u8..=20).prop_flat_map(|num_tracks| {
        let first_track = 1u8;
        let last_track  = num_tracks;

        // Generate `num_tracks` monotonic LBA values + 1 lead-out
        let lba_steps = prop::collection::vec(100u32..50_000, (num_tracks + 1) as usize);
        let controls  = prop::collection::vec(prop::sample::select(vec![0x10u8, 0x14u8]), num_tracks as usize);

        (Just(first_track), Just(last_track), lba_steps, controls)
            .prop_map(move |(first, last, steps, ctls)| {
                // Convert step deltas into absolute LBAs (always increasing).
                let mut lba = 0u32;
                let mut entries = Vec::with_capacity((num_tracks + 1) as usize);
                for i in 0..num_tracks as usize {
                    lba = lba.saturating_add(steps[i]);
                    entries.push((first + i as u8, ctls[i], lba));
                }
                // Lead-out
                lba = lba.saturating_add(steps[num_tracks as usize]);
                entries.push((0xAA, 0x10, lba));
                (first, last, entries)
            })
    })
}

/// Encode a TOC entry list into the binary IOCTL format.
fn encode_toc(first: u8, last: u8, entries: &[(u8, u8, u32)]) -> Vec<u8> {
    let entries_bytes = entries.len() * 8;
    let length        = (entries_bytes + 2) as u16; // length excludes its own 2 bytes
    let mut buf       = Vec::with_capacity(entries_bytes + 4);
    buf.extend_from_slice(&length.to_be_bytes());
    buf.push(first);
    buf.push(last);
    for (track_no, control_adr, lba) in entries {
        buf.push(0x00);                  // [0] reserved
        buf.push(*control_adr);          // [1] adr|control
        buf.push(*track_no);             // [2] track number
        buf.push(0x00);                  // [3] reserved
        buf.extend_from_slice(&lba.to_be_bytes()); // [4..7] LBA BE
    }
    buf
}

proptest! {
    /// A valid-looking TOC must parse Ok with at most num_tracks parsed tracks.
    /// Verify : every parsed track has frames > 0 (LBAs were monotonic), is_audio = true,
    /// and idx is in [first_track, last_track].
    #[test]
    fn valid_toc_parses_with_bounded_output((first, last, entries) in arb_valid_toc()) {
        let buf = encode_toc(first, last, &entries);
        let parsed = parse_toc_lba(&buf).expect("valid TOC must parse");

        // Bounded by the audio tracks generated (data tracks 0x14 are filtered out)
        let expected_audio_count = entries.iter()
            .filter(|(track_no, ctl, _)| *track_no != 0xAA && (ctl & 0x04) == 0)
            .count();
        prop_assert_eq!(parsed.len(), expected_audio_count);

        for t in &parsed {
            prop_assert!(t.is_audio, "is_audio must be true for parsed tracks");
            prop_assert!(t.idx >= first && t.idx <= last,
                         "idx {} out of [first={}, last={}]", t.idx, first, last);
            prop_assert!(t.frames > 0, "frames must be > 0");
        }
    }

    /// LBAs in the parsed output must be strictly increasing (since the generator
    /// produced monotonic input).
    #[test]
    fn parsed_tracks_have_monotonic_lba((first, last, entries) in arb_valid_toc()) {
        let buf = encode_toc(first, last, &entries);
        let parsed = parse_toc_lba(&buf).expect("valid TOC must parse");
        for w in parsed.windows(2) {
            prop_assert!(w[0].lba_start < w[1].lba_start,
                         "LBAs not strictly increasing: {} -> {}",
                         w[0].lba_start, w[1].lba_start);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 3 : length-field attacks
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    /// A buffer whose declared length field exceeds the actual buffer size must
    /// be rejected with Err, never cause an out-of-bounds read or panic.
    #[test]
    fn rejects_length_field_overflow(
        declared_len in 100u16..=u16::MAX,
        first        in 1u8..=99,
        last         in 1u8..=99,
        actual_size  in 20usize..=200,
    ) {
        prop_assume!(last >= first);
        prop_assume!((declared_len as usize) > actual_size);

        let mut buf = vec![0u8; actual_size];
        buf[0..2].copy_from_slice(&declared_len.to_be_bytes());
        buf[2] = first;
        buf[3] = last;

        let result = parse_toc_lba(&buf);
        prop_assert!(result.is_err(),
                     "TOC with declared_len={} but actual_size={} should fail, got Ok",
                     declared_len, actual_size);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 4 : frames_to_seconds is total + non-negative for non-negative input
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn frames_to_seconds_is_total(frames in 0u32..=u32::MAX) {
        let s = frames_to_seconds(frames);
        prop_assert!(s.is_finite(), "frames {} produced non-finite seconds {}", frames, s);
        prop_assert!(s >= 0.0,      "frames {} produced negative seconds {}", frames, s);
    }
}
