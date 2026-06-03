//! Native Android JNI bridge — a thin shim over `gandula_core`, mirroring the
//! WASM bindings in `wasm/src/lib.rs`.
//!
//! Same contract as the web build: inputs and outputs cross the boundary as
//! JSON strings matching the existing `Team` / `Match` / `SeasonRecord` JSON
//! shapes (the same shapes the CLI loads from team files). Keeping the boundary
//! at JSON means the Kotlin side never has to mirror the engine's struct layout,
//! and the simulation stays the single source of truth.
//!
//! Each exported function maps 1:1 to an `external fun` on the Kotlin
//! `dev.debene.gandula.NativeEngine` object. On the happy path it returns a
//! Java `String`; on any error it throws a `java.lang.RuntimeException` carrying
//! the engine's error message and returns null.

use gandula_core::{
    match_seed, project_match, simulate, simulate_first_half, simulate_season,
    simulate_second_half, HalfTimeSnapshot, League, Team,
};
use jni::objects::{JClass, JString};
use jni::sys::{jint, jlong, jstring};
use jni::JNIEnv;

/// Pull a Java `String` argument into a Rust `String`.
fn read(env: &mut JNIEnv, s: &JString) -> Result<String, String> {
    env.get_string(s)
        .map(|js| js.into())
        .map_err(|e| format!("invalid string argument: {e}"))
}

/// Hand a Rust `String` result back to the JVM, or throw + return null on error.
/// `result` is the fallible body of an exported function; this is the single
/// place the JSON-string contract and the throw-on-error convention live.
fn finish(mut env: JNIEnv, result: Result<String, String>) -> jstring {
    match result {
        Ok(json) => match env.new_string(json) {
            Ok(s) => s.into_raw(),
            Err(e) => {
                let _ = env.throw_new("java/lang/RuntimeException", format!("alloc failed: {e}"));
                std::ptr::null_mut()
            }
        },
        Err(msg) => {
            let _ = env.throw_new("java/lang/RuntimeException", msg);
            std::ptr::null_mut()
        }
    }
}

/// Simulate a single match. `home_json` / `away_json` are `Team` JSON; the
/// `seed` is a u64 carried in a (signed) Java `long` — same bit pattern, the
/// engine only cares about the bits. Returns a `Match` JSON string.
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_playMatch<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    home_json: JString<'l>,
    away_json: JString<'l>,
    seed: jlong,
) -> jstring {
    let body = (|| {
        let home: Team =
            serde_json::from_str(&read(&mut env, &home_json)?).map_err(|e| format!("home: {e}"))?;
        let away: Team =
            serde_json::from_str(&read(&mut env, &away_json)?).map_err(|e| format!("away: {e}"))?;
        let m = simulate(&home, &away, seed as u64).map_err(|e| e.to_string())?;
        serde_json::to_string(&m).map_err(|e| e.to_string())
    })();
    finish(env, body)
}

/// Run the first half and return a `HalfTimeSnapshot` JSON string — the
/// serializable mid-match state. Resume with [`playSecondHalf`].
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_playFirstHalf<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    home_json: JString<'l>,
    away_json: JString<'l>,
    seed: jlong,
) -> jstring {
    let body = (|| {
        let home: Team =
            serde_json::from_str(&read(&mut env, &home_json)?).map_err(|e| format!("home: {e}"))?;
        let away: Team =
            serde_json::from_str(&read(&mut env, &away_json)?).map_err(|e| format!("away: {e}"))?;
        let snap = simulate_first_half(&home, &away, seed as u64).map_err(|e| e.to_string())?;
        serde_json::to_string(&snap).map_err(|e| e.to_string())
    })();
    finish(env, body)
}

/// Resume from a `HalfTimeSnapshot` JSON string and run the second half,
/// returning the complete `Match`. Pass edited teams to apply a half-time
/// tactics change.
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_playSecondHalf<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    snapshot_json: JString<'l>,
    home_json: JString<'l>,
    away_json: JString<'l>,
) -> jstring {
    let body = (|| {
        let snapshot: HalfTimeSnapshot = serde_json::from_str(&read(&mut env, &snapshot_json)?)
            .map_err(|e| format!("snapshot: {e}"))?;
        let home: Team =
            serde_json::from_str(&read(&mut env, &home_json)?).map_err(|e| format!("home: {e}"))?;
        let away: Team =
            serde_json::from_str(&read(&mut env, &away_json)?).map_err(|e| format!("away: {e}"))?;
        let m = simulate_second_half(snapshot, &home, &away).map_err(|e| e.to_string())?;
        serde_json::to_string(&m).map_err(|e| e.to_string())
    })();
    finish(env, body)
}

/// Analytic, RNG-free projection of a match from kickoff (expected possession +
/// per-side pressure, no goals). Returns a `MatchProjection` JSON string.
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_projectMatch<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    home_json: JString<'l>,
    away_json: JString<'l>,
) -> jstring {
    let body = (|| {
        let home: Team =
            serde_json::from_str(&read(&mut env, &home_json)?).map_err(|e| format!("home: {e}"))?;
        let away: Team =
            serde_json::from_str(&read(&mut env, &away_json)?).map_err(|e| format!("away: {e}"))?;
        let proj = project_match(&home, &away).map_err(|e| e.to_string())?;
        serde_json::to_string(&proj).map_err(|e| e.to_string())
    })();
    finish(env, body)
}

/// Run a full double round-robin. `teams_json` is a JSON array of `Team`
/// objects; returns a `SeasonRecord` JSON string.
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_runSeason<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    teams_json: JString<'l>,
    seed: jlong,
    name: JString<'l>,
) -> jstring {
    let body = (|| {
        let teams: Vec<Team> = serde_json::from_str(&read(&mut env, &teams_json)?)
            .map_err(|e| format!("teams: {e}"))?;
        let name = read(&mut env, &name)?;
        let league = League { name, teams };
        let r = simulate_season(&league, seed as u64).map_err(|e| e.to_string())?;
        serde_json::to_string(&r).map_err(|e| e.to_string())
    })();
    finish(env, body)
}

/// Derive the deterministic per-match seed from a season seed and fixture index.
/// Mirrors the engine's internal derivation so the app can re-simulate a single
/// fixture after a mid-season tactics edit. Pure, infallible — no exceptions.
#[no_mangle]
pub extern "system" fn Java_dev_debene_gandula_NativeEngine_deriveMatchSeed<'l>(
    _env: JNIEnv<'l>,
    _class: JClass<'l>,
    season_seed: jlong,
    fixture_idx: jint,
) -> jlong {
    match_seed(season_seed as u64, fixture_idx as u32) as jlong
}
