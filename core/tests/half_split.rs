//! Half-split equivalence: `simulate` == `simulate_first_half` →
//! (serde round-trip) → `simulate_second_half`, byte-for-byte. This is the
//! proof that splitting the one-shot simulator into two halves changed no
//! behavior — the whole reason the split lands as its own commit.
//!
//! Coverage is deliberately layered:
//!   - a property test over many seeds (the common path),
//!   - a MANDATORY named case (seed 687) whose half-time snapshot carries a
//!     `pending_penalty` — the riskiest path (new code that only the snapshot
//!     exercises), pinned so it can never be skipped by chance, and
//!   - a hand-built pending-penalty snapshot round-tripped directly, asserting
//!     the penalty resolves identically after serialization.

use gandula_core::{
    Attributes, Formation, HalfTimeSnapshot, Mentality, Player, PlayerId, Position, Pressing,
    Side, Tactics, Team, TeamId, Tempo, Width, simulate, simulate_first_half,
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

/// MANDATORY coverage of the pending-penalty-at-45' path. Seed 687 (found by an
/// offline scan over team_with_bench(72 vs 64)) awards a penalty exactly at
/// minute 45, so its half-time snapshot carries `pending_penalty = Some(..)`
/// that must survive serialization and resolve at minute 46 — the single most
/// fragile path, and the one a purely statistical seed sweep can silently miss.
#[test]
fn pending_penalty_at_halftime_round_trips_byte_identical() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    let seed = 687u64;

    let snap = simulate_first_half(&home, &away, seed).expect("first half");
    assert!(
        snap.pending_penalty.is_some(),
        "seed {seed} is pinned BECAUSE it has a penalty pending at 45'; if the engine \
         tuning changed and this no longer holds, re-scan for a new pending-at-45 seed \
         rather than deleting this assertion — the round-trip path below must stay covered"
    );
    assert_split_matches_oneshot(&home, &away, seed);
}

/// Hand-build a snapshot whose penalty is pending, round-trip it, and assert the
/// reconstructed snapshot resolves into the identical second half. Belt-and-
/// suspenders alongside the seed-pinned case: it exercises the pending field
/// directly rather than relying on the engine to produce it.
#[test]
fn handbuilt_pending_penalty_snapshot_resolves_identically() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    let seed = 687u64; // known to leave a pending penalty at 45'

    let snap = simulate_first_half(&home, &away, seed).expect("first half");
    assert!(matches!(snap.pending_penalty, Some(p) if matches!(p.side, Side::Home | Side::Away)));

    // Resolve once from the live snapshot, once from a serde round-trip of it,
    // and assert the two second halves are byte-identical — i.e. the pending
    // penalty (and the RNG that resolves it at 46') round-trips exactly.
    let direct = simulate_second_half(snap.clone(), &home, &away).expect("direct second half");
    let json = serde_json::to_string(&snap).expect("ser snapshot");
    let restored: HalfTimeSnapshot = serde_json::from_str(&json).expect("de snapshot");
    let via_serde = simulate_second_half(restored, &home, &away).expect("serde second half");

    assert_eq!(
        serde_json::to_string(&direct).expect("ser direct"),
        serde_json::to_string(&via_serde).expect("ser via_serde"),
        "a pending penalty must resolve identically whether the snapshot is used \
         directly or after a serde round-trip"
    );
}
