//! WASM bindings — thin shim over `gandula_core`.
//!
//! Two exported functions: `play_match` and `run_season`. Inputs and outputs
//! are converted via `serde-wasm-bindgen`, so the JS side sees plain JS
//! objects matching the existing JSON shapes (same shape the CLI uses to load
//! team files).

use gandula_core::{
    HalfTimeSnapshot, League, Team, match_seed, project_second_half, simulate, simulate_first_half,
    simulate_second_half, simulate_season,
};
use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

/// Serializer that emits u64/i64 as JS BigInt instead of trying to fit them
/// into a Number. Required because per-match derived seeds easily exceed
/// 2^53.
fn bigint_serializer() -> Serializer {
    Serializer::new().serialize_large_number_types_as_bigints(true)
}

/// Run a single match between two teams. `home` and `away` must be objects
/// matching the `Team` JSON shape; returns a `Match` object.
#[wasm_bindgen]
pub fn play_match(home: JsValue, away: JsValue, seed: u64) -> Result<JsValue, JsError> {
    let home: Team = serde_wasm_bindgen::from_value(home)
        .map_err(|e| JsError::new(&format!("home: {e}")))?;
    let away: Team = serde_wasm_bindgen::from_value(away)
        .map_err(|e| JsError::new(&format!("away: {e}")))?;
    let m = simulate(&home, &away, seed).map_err(|e| JsError::new(&e.to_string()))?;
    m.serialize(&bigint_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Run the first half (1..=45 + half-time) and return a `HalfTimeSnapshot`
/// object — the serializable mid-match state plus the RNG stream position. The
/// second half is run separately via [`play_second_half`], optionally with
/// edited teams (a half-time tactics change). The snapshot's `seed` is u64 and
/// the embedded RNG state carries a u128 `word_pos`, so it's serialized with
/// the BigInt serializer.
#[wasm_bindgen]
pub fn play_first_half(home: JsValue, away: JsValue, seed: u64) -> Result<JsValue, JsError> {
    let home: Team = serde_wasm_bindgen::from_value(home)
        .map_err(|e| JsError::new(&format!("home: {e}")))?;
    let away: Team = serde_wasm_bindgen::from_value(away)
        .map_err(|e| JsError::new(&format!("away: {e}")))?;
    let snap = simulate_first_half(&home, &away, seed).map_err(|e| JsError::new(&e.to_string()))?;
    snap.serialize(&bigint_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Resume from a `HalfTimeSnapshot` (as returned by [`play_first_half`]) and run
/// the second half, returning the complete `Match`. `home`/`away` supply
/// tactics — pass edited teams to apply a half-time tactics change.
#[wasm_bindgen]
pub fn play_second_half(snapshot: JsValue, home: JsValue, away: JsValue) -> Result<JsValue, JsError> {
    let snapshot: HalfTimeSnapshot = serde_wasm_bindgen::from_value(snapshot)
        .map_err(|e| JsError::new(&format!("snapshot: {e}")))?;
    let home: Team = serde_wasm_bindgen::from_value(home)
        .map_err(|e| JsError::new(&format!("home: {e}")))?;
    let away: Team = serde_wasm_bindgen::from_value(away)
        .map_err(|e| JsError::new(&format!("away: {e}")))?;
    let m = simulate_second_half(snapshot, &home, &away)
        .map_err(|e| JsError::new(&e.to_string()))?;
    m.serialize(&bigint_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Analytic, RNG-free projection of the second half from a `HalfTimeSnapshot`
/// (as returned by [`play_first_half`]). Returns a `SecondHalfProjection`
/// object — expected possession + per-side pressure — with no goals computed,
/// so JS can recompute it live as the user edits half-time tactics. The
/// `home`/`away` teams carry the (possibly edited) tactics to project.
#[wasm_bindgen]
pub fn project_second_half_js(
    snapshot: JsValue,
    home: JsValue,
    away: JsValue,
) -> Result<JsValue, JsError> {
    let snapshot: HalfTimeSnapshot = serde_wasm_bindgen::from_value(snapshot)
        .map_err(|e| JsError::new(&format!("snapshot: {e}")))?;
    let home: Team = serde_wasm_bindgen::from_value(home)
        .map_err(|e| JsError::new(&format!("home: {e}")))?;
    let away: Team = serde_wasm_bindgen::from_value(away)
        .map_err(|e| JsError::new(&format!("away: {e}")))?;
    let proj = project_second_half(&snapshot, &home, &away)
        .map_err(|e| JsError::new(&e.to_string()))?;
    proj.serialize(&bigint_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Run a full double round-robin between the given teams. `teams` must be an
/// array of objects matching the `Team` JSON shape; returns a `SeasonRecord`.
#[wasm_bindgen]
pub fn run_season(teams: JsValue, seed: u64, name: String) -> Result<JsValue, JsError> {
    let teams: Vec<Team> = serde_wasm_bindgen::from_value(teams)
        .map_err(|e| JsError::new(&format!("teams: {e}")))?;
    let league = League { name, teams };
    let r = simulate_season(&league, seed).map_err(|e| JsError::new(&e.to_string()))?;
    r.serialize(&bigint_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Derive the deterministic per-match seed from a season seed and a fixture
/// index. Mirrors the internal derivation the engine uses when running a
/// full season — exposed so JS can re-simulate individual matches when the
/// player customizes tactics mid-season and the rest of the league needs
/// to be re-simulated from a fixture onward. u64 → JS bigint automatically.
#[wasm_bindgen]
pub fn derive_match_seed(season_seed: u64, fixture_idx: u32) -> u64 {
    match_seed(season_seed, fixture_idx)
}
