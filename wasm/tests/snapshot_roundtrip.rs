//! WASM round-trip coverage for the half-time snapshot through the REAL
//! production serializer (`serde-wasm-bindgen` + the BigInt config), not
//! `serde_json`. This is the path that actually ships:
//!
//!   play_first_half → JsValue (snapshot, with the RNG's u128 `word_pos` as a
//!   JS BigInt) → play_second_half → Match
//!
//! A serde_json round-trip passing does NOT prove this works: JSON and
//! serde-wasm-bindgen are different serializers, and the `word_pos` u128 only
//! becomes a BigInt on the wasm-bindgen path. If that BigInt round-trip lost
//! precision, the second-half RNG stream would drift and the result would
//! silently diverge in production while the core JSON test stayed green.
//!
//! Run with: `wasm-pack test --node wasm` (or --headless --firefox).

#![cfg(target_arch = "wasm32")]

use gandula_core::{
    Attributes, Formation, Match, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team,
    TeamId, Tempo, Width, simulate,
};
use gandula_wasm::{play_first_half, play_second_half};
use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

fn bigint_serializer() -> Serializer {
    Serializer::new().serialize_large_number_types_as_bigints(true)
}

fn to_js<T: Serialize>(v: &T) -> JsValue {
    v.serialize(&bigint_serializer()).expect("serialize to JsValue")
}

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
    let xi: [PlayerId; 11] = core::array::from_fn(|i| PlayerId(id * 100 + (i as u32) + 1));
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

/// Drive the full WASM split path for `seed` and assert the resulting `Match`
/// equals the one-shot `simulate` — proving the snapshot (incl. the u128 RNG
/// `word_pos`) survives the serde-wasm-bindgen BigInt round-trip exactly.
fn assert_wasm_split_matches_oneshot(home: &Team, away: &Team, seed: u64) {
    let home_js = to_js(home);
    let away_js = to_js(away);

    let snap_js = play_first_half(home_js.clone(), away_js.clone(), seed)
        .expect("play_first_half");
    let match_js =
        play_second_half(snap_js, home_js, away_js).expect("play_second_half");

    let via_wasm: Match =
        serde_wasm_bindgen::from_value(match_js).expect("Match from JsValue");
    let one_shot = simulate(home, away, seed).expect("one-shot");

    assert_eq!(
        serde_json::to_string(&one_shot).unwrap(),
        serde_json::to_string(&via_wasm).unwrap(),
        "WASM split (snapshot through serde-wasm-bindgen BigInt) must equal one-shot for seed {seed}"
    );
}

#[wasm_bindgen_test]
fn wasm_split_matches_oneshot_basic() {
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    for seed in [0u64, 1, 7, 42, 99] {
        assert_wasm_split_matches_oneshot(&home, &away, seed);
    }
}

#[wasm_bindgen_test]
fn wasm_split_matches_oneshot_with_pending_penalty() {
    // Seed 687 leaves a penalty pending at 45' (see core/tests/half_split.rs).
    // This is the path where the snapshot's pending_penalty AND the RNG state
    // both must survive the BigInt boundary for the kick to resolve identically
    // at minute 46.
    let home = team_with_bench("Home", 1, 72);
    let away = team_with_bench("Away", 2, 64);
    assert_wasm_split_matches_oneshot(&home, &away, 687);
}
