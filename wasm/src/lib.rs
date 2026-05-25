//! WASM bindings — thin shim over `gandula_core`.
//!
//! Two exported functions: `play_match` and `run_season`. Inputs and outputs
//! are converted via `serde-wasm-bindgen`, so the JS side sees plain JS
//! objects matching the existing JSON shapes (same shape the CLI uses to load
//! team files).

use gandula_core::{League, Team, simulate, simulate_season};
use wasm_bindgen::prelude::*;

/// Run a single match between two teams. `home` and `away` must be objects
/// matching the `Team` JSON shape; returns a `Match` object.
#[wasm_bindgen]
pub fn play_match(home: JsValue, away: JsValue, seed: u64) -> Result<JsValue, JsError> {
    let home: Team = serde_wasm_bindgen::from_value(home)
        .map_err(|e| JsError::new(&format!("home: {e}")))?;
    let away: Team = serde_wasm_bindgen::from_value(away)
        .map_err(|e| JsError::new(&format!("away: {e}")))?;
    let m = simulate(&home, &away, seed).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&m).map_err(|e| JsError::new(&e.to_string()))
}

/// Run a full double round-robin between the given teams. `teams` must be an
/// array of objects matching the `Team` JSON shape; returns a `SeasonRecord`.
#[wasm_bindgen]
pub fn run_season(teams: JsValue, seed: u64, name: String) -> Result<JsValue, JsError> {
    let teams: Vec<Team> = serde_wasm_bindgen::from_value(teams)
        .map_err(|e| JsError::new(&format!("teams: {e}")))?;
    let league = League { name, teams };
    let r = simulate_season(&league, seed).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&r).map_err(|e| JsError::new(&e.to_string()))
}
