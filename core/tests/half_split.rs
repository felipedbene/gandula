//! Half-split equivalence: `simulate` == `simulate_first_half` →
//! (serde round-trip) → `simulate_second_half`, byte-for-byte. This is the
//! proof that splitting the one-shot simulator into two halves changed no
//! behavior — the whole reason the split lands as its own commit.
//!
//! Coverage is deliberately layered:
//!   - a property test over many seeds (the common path),
//!   - a MANDATORY named case (seed 687) where a penalty is awarded exactly at
//!     45' and force-resolved before the break — pinned so a statistical sweep
//!     can't skip the riskiest path, and
//!   - a hand-carried pending-penalty snapshot round-tripped directly, asserting
//!     it resolves identically after serialization (the field is retained even
//!     though the engine no longer populates it).

use gandula_core::{
    Attributes, Formation, HalfTimeSnapshot, Mentality, PendingPenalty, Player, PlayerId, Position,
    Pressing, Side, Tactics, Team, TeamId, Tempo, Width, simulate, simulate_first_half,
    simulate_second_half,
};

/// A team WITH a 7-player bench, fast tempo + high pressing — so the property
/// test actually exercises substitutions (which mutate the snapshot's XI /
/// stamina / on_field / bench_used / subs_used across the break) and produces
/// penalties. The empty-bench `determinism.rs` helper would leave those
/// snapshot fields trivial.
fn team_with_bench(name: &str, id: u32, base: u8) -> Team {
    let roster: Vec<Player> = (1..=18)
        .map(|i| Player {
            id: PlayerId(id * 100 + i),
            name: format!("J{id}{i}"),
            age: 25,
            position: match i {
                1 => Position::GK,
                2..=6 => Position::DEF,
                7..=12 => Position::MID,
                _ => Position::FWD,
            },
            attributes: Attributes {
                pace: base,
                technique: base,
                passing: base,
                defending: base,
                finishing: base,
                stamina: 70,
            },
        })
        .collect();
    let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId(id * 100 + (i as u32) + 1));
    let bench: Vec<PlayerId> = (12..=18).map(|i| PlayerId(id * 100 + i)).collect();
    Team {
        id: TeamId(id),
        name: name.to_string(),
        roster,
        formation: Formation::F442,
        tactics: Tactics {
            mentality: Mentality::Balanced,
            tempo: Tempo::Fast,
            pressing: Pressing::High,
            width: Width::Normal,
        },
        starting_xi: xi,
        bench,
    }
}

/// Run the split path with a serde_json round-trip of the snapshot in the
/// middle, and assert byte-identity with the one-shot `simulate`. The
/// round-trip is the point: it proves the snapshot (and the embedded ChaCha8
/// RNG state — seed, stream, and the u128 `word_pos`) survives serialization
/// without drifting the second-half stream.
fn assert_split_matches_oneshot(home: &Team, away: &Team, seed: u64) {
    let one_shot = simulate(home, away, seed).expect("one-shot sim");

    let snap = simulate_first_half(home, away, seed).expect("first half");
    let json = serde_json::to_string(&snap).expect("snapshot serialize");
    let snap2: HalfTimeSnapshot = serde_json::from_str(&json).expect("snapshot deserialize");
    let split = simulate_second_half(snap2, home, away).expect("second half");

    let s_one = serde_json::to_string(&one_shot).expect("ser one-shot");
    let s_split = serde_json::to_string(&split).expect("ser split");
    assert_eq!(
        s_one, s_split,
        "split (with snapshot round-trip) must be byte-identical to one-shot for seed {seed}"
    );
}

#[test]
fn split_is_byte_identical_to_oneshot_over_many_seeds() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    // A spread of seeds; the engine is deterministic so this set is fixed.
    for seed in 0u64..200 {
        assert_split_matches_oneshot(&home, &away, seed);
    }
}

/// MANDATORY coverage of the penalty-at-45' path. Seed 687 (found by an offline
/// scan over team_with_bench(72 vs 64)) awards a penalty exactly at minute 45.
/// As of commit 3 that kick is FORCE-RESOLVED before the break, so the
/// half-time score is closed: the snapshot carries no pending penalty, and the
/// first-half log ends with PenaltyAwarded → (Goal|PenaltyMissed) → HalfTime,
/// all at minute 45. Still the single most fragile path — pinned so a purely
/// statistical seed sweep can't silently skip it.
#[test]
fn penalty_at_45_is_resolved_before_the_break() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    let seed = 687u64;

    let snap = simulate_first_half(&home, &away, seed).expect("first half");
    assert!(
        snap.pending_penalty.is_none(),
        "seed {seed}'s 45' penalty must be force-resolved before the break, leaving \
         no pending kick in the snapshot"
    );
    // The award AND its outcome are both in the first-half log at minute 45.
    let kinds_at_45: Vec<String> = snap
        .first_half_events
        .iter()
        .filter(|e| e.minute == 45)
        .map(|e| format!("{:?}", e.kind))
        .collect();
    assert!(
        kinds_at_45.iter().any(|k| k.contains("PenaltyAwarded")),
        "expected a PenaltyAwarded at 45' for seed {seed}; got {kinds_at_45:?} \
         (if engine tuning changed, re-scan for a new penalty-at-45 seed rather \
         than deleting this — the path must stay covered)"
    );
    assert!(
        kinds_at_45
            .iter()
            .any(|k| k.contains("Goal") || k.contains("PenaltyMissed")),
        "the 45' penalty must be TAKEN before the break (Goal or PenaltyMissed at \
         45'); got {kinds_at_45:?}"
    );
    // And the split is still byte-identical to the one-shot for this seed: the
    // force-resolve lives inside simulate_first_half, which simulate() also
    // calls, so the equivalence is preserved — only the snapshot's content moved.
    assert_split_matches_oneshot(&home, &away, seed);
}

/// The snapshot's `pending_penalty` field is retained (the engine no longer
/// populates it, but a caller may hand-build one). Assert a hand-carried
/// pending penalty still resolves into an identical second half whether the
/// snapshot is used directly or after a serde round-trip — proving the field +
/// the RNG that resolves it at 46' round-trip exactly.
#[test]
fn handbuilt_pending_penalty_snapshot_resolves_identically() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);

    // Start from a real snapshot, then inject a pending penalty by hand (the
    // taker is the home GK's slot-1 id — any valid on-field player works).
    let mut snap = simulate_first_half(&home, &away, 7).expect("first half");
    snap.pending_penalty = Some(PendingPenalty {
        side: Side::Home,
        taker: snap.home_current_xi[10], // a forward slot
    });

    let direct = simulate_second_half(snap.clone(), &home, &away).expect("direct second half");
    let json = serde_json::to_string(&snap).expect("ser snapshot");
    let restored: HalfTimeSnapshot = serde_json::from_str(&json).expect("de snapshot");
    let via_serde = simulate_second_half(restored, &home, &away).expect("serde second half");

    assert_eq!(
        serde_json::to_string(&direct).expect("ser direct"),
        serde_json::to_string(&via_serde).expect("ser via_serde"),
        "a hand-carried pending penalty must resolve identically whether the \
         snapshot is used directly or after a serde round-trip"
    );
}
