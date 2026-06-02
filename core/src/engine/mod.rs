mod manager;
mod narration;
mod strength;
mod tick;

use crate::domain::{Match, MatchEvent, MatchEventKind, Side, Team};
use crate::error::GandulaError;
use crate::rng::MatchRng;

use strength::{event_prob, possession_home, shot_prob};
use tick::{MatchState, current_strength};

pub use tick::{HalfTimeSnapshot, PendingPenalty};

/// Simulate a single match end-to-end. Pure function of `(home, away, seed)` —
/// identical inputs produce a byte-identical `Match`.
///
/// Now a thin composition of [`simulate_first_half`] + [`simulate_second_half`];
/// the half-split property test proves this is byte-for-byte identical to the
/// former one-shot implementation.
pub fn simulate(home: &Team, away: &Team, seed: u64) -> Result<Match, GandulaError> {
    let snap = simulate_first_half(home, away, seed)?;
    simulate_second_half(snap, home, away)
}

/// Run minutes 1..=45 plus the half-time narration, then capture a serializable
/// [`HalfTimeSnapshot`] at the exact RNG stream position the second half resumes
/// from. A penalty awarded at 45' is left pending in the snapshot — it resolves
/// on the first tick of the second half (minute 46), exactly as in the former
/// one-shot loop (no force-resolve at the break in this commit).
pub fn simulate_first_half(
    home: &Team,
    away: &Team,
    seed: u64,
) -> Result<HalfTimeSnapshot, GandulaError> {
    home.validate()?;
    away.validate()?;

    let mut rng = MatchRng::new(seed);
    let mut state = MatchState::new(home, away);

    for minute in 1..=45 {
        tick::tick(&mut state, &mut rng, minute);
        manager::run_managers(&mut state, &mut rng, minute);
    }
    let half_text = narration::narrate_half_time(
        &mut rng,
        &state.home.name,
        state.home_goals,
        &state.away.name,
        state.away_goals,
    );
    state.events.push(MatchEvent {
        minute: 45,
        side: None,
        kind: MatchEventKind::HalfTime,
        text: half_text,
    });

    // Snapshot *after* half-time narration consumed the RNG — this is precisely
    // where the second half picks the stream back up.
    Ok(state.snapshot_at_half(seed, &rng))
}

/// Resume from a [`HalfTimeSnapshot`] and run minutes 46..=90, second-half
/// injury time, and the full-time narration, returning the complete `Match`.
/// `home`/`away` supply tactics/formation (re-read every tick); passing edited
/// teams here is how a half-time tactics change takes effect in later commits.
/// The returned `Match` has the same shape as the one-shot `simulate`.
pub fn simulate_second_half(
    snap: HalfTimeSnapshot,
    home: &Team,
    away: &Team,
) -> Result<Match, GandulaError> {
    // Resume the exact ChaCha8 keystream from the break — no re-seeding.
    let mut rng = snap.rng_state.clone();
    let mut state = MatchState::resume_from(&snap, home, away);

    for minute in 46..=90 {
        tick::tick(&mut state, &mut rng, minute);
        manager::run_managers(&mut state, &mut rng, minute);
    }

    // 0..=4 minutes of injury time at the end of the second half. Drawn here,
    // after the 46..=90 loop, mirroring the former one-shot ordering exactly.
    let injury = rng.range_u32(0, 5) as u16;
    for i in 1..=injury {
        tick::tick(&mut state, &mut rng, 90 + i);
        manager::run_managers(&mut state, &mut rng, 90 + i);
    }

    let final_minute: u16 = 90 + injury;
    let full_text = narration::narrate_full_time(
        &mut rng,
        final_minute,
        &state.home.name,
        state.home_goals,
        &state.away.name,
        state.away_goals,
    );
    state.events.push(MatchEvent {
        minute: final_minute,
        side: None,
        kind: MatchEventKind::FullTime,
        text: full_text,
    });

    Ok(state.into_match(snap.seed))
}

/// Analytic, RNG-free projection of how the second half is shaped, computed
/// from the half-time snapshot. Returns *expected values* — it never simulates
/// a minute or scores a goal, so it's deterministic and cheap, suitable for
/// recomputing live as the user edits tactics at the break.
///
/// `home_possession` is the expected share of minutes the home side controls;
/// `home_pressure` / `away_pressure` are the expected shooting rate per minute
/// for each side (`possession × event × shot`), the closest single number to
/// "who will create danger". All three are built from the SAME
/// `possession_home` / `event_prob` / `shot_prob` helpers the live tick samples
/// against, so the projection can't drift from the engine.
///
/// Strength is taken as a single snapshot at the break (stamina as of 45') —
/// it intentionally does NOT model the stamina the sides will lose over the
/// coming 45 minutes, so this is "what it looks like right now", not a forecast
/// of the average second-half state.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct SecondHalfProjection {
    /// Expected home possession share, in `[POSSESSION_MIN, POSSESSION_MAX]`.
    pub home_possession: f64,
    /// Expected home shots per minute (≥ 0).
    pub home_pressure: f64,
    /// Expected away shots per minute (≥ 0).
    pub away_pressure: f64,
}

pub fn project_second_half(
    snap: &HalfTimeSnapshot,
    home: &Team,
    away: &Team,
) -> Result<SecondHalfProjection, GandulaError> {
    home.validate()?;
    away.validate()?;

    // Reconstruct the break state (XI / stamina / on-field as of 45') without
    // advancing the match or touching an RNG.
    let state = MatchState::resume_from(snap, home, away);
    let home_str = current_strength(&state, Side::Home);
    let away_str = current_strength(&state, Side::Away);

    let home_possession = possession_home(&home_str, &away_str);
    let home_pressure =
        home_possession * event_prob(home.tactics.tempo) * shot_prob(&home_str, &away_str);
    let away_pressure =
        (1.0 - home_possession) * event_prob(away.tactics.tempo) * shot_prob(&away_str, &home_str);

    Ok(SecondHalfProjection {
        home_possession,
        home_pressure,
        away_pressure,
    })
}
