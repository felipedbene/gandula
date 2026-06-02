//! One-minute simulation step.
//!
//! Inputs: current `MatchState`, the home/away teams, the shared RNG. Outputs:
//! zero or one `MatchEvent` appended to the log. Tunable constants live at the
//! top.

use crate::domain::{
    Match, MatchEvent, MatchEventKind, MatchResult, NearMissKind, Player, PlayerId, Position,
    Side, Team,
};
use crate::engine::narration::{self, NarrationContext};
use crate::engine::strength::{
    self, TeamStrength, event_prob, possession_home, pressing_disrupt, pressing_foul_factor,
    pressing_stamina_factor, raw_player_stats, shot_prob, stamina_effectiveness,
    tempo_stamina_factor, width_shot_factor,
};
use crate::rng::MatchRng;
use serde::{Deserialize, Serialize};

// ─── Tunables ───────────────────────────────────────────────────────────────
// Possession / event / shot probabilities and their constants now live in
// `strength.rs` (shared with the analytic projection); imported below.
pub const BASE_STAMINA_DRAIN: f64 = 0.30;

pub const FOUL_BASE_WITHIN_EVENT: f64 = 0.15;

pub const ON_TARGET_BASE: f64 = 0.35;
pub const ON_TARGET_TECHNIQUE_SCALE: f64 = 1.0 / 200.0;
pub const ON_TARGET_MIN: f64 = 0.10;
pub const ON_TARGET_MAX: f64 = 0.85;

pub const GOAL_BASE: f64 = 0.32;
pub const GOAL_FINISHING_GK_SCALE: f64 = 1.0 / 200.0;
pub const GOAL_MIN: f64 = 0.05;
pub const GOAL_MAX: f64 = 0.70;

pub const ASSIST_PROB: f64 = 0.60;

pub const CARD_NONE: f64 = 0.70;
pub const CARD_YELLOW: f64 = 0.25;
pub const CARD_RED: f64 = 0.05;

/// Probability that a foul is "inside the box" and therefore awarded as a
/// penalty. With foul rate ≈ 0.027/min × 95 min ≈ 2.7 fouls per match,
/// 0.04 → ~1 penalty every 9 matches, inside the 8–12 range the brief asked
/// for. If `stronger_wins.rs` starts failing because penalties skew toward
/// weaker teams (they tend to defend more, foul more in their own box —
/// realistic but tilts a balance-test), the right response is to surface
/// that tension in a code comment, not silently lower this constant.
pub const PENALTY_FOUL_RATE: f64 = 0.04;

/// Base conversion rate for a taken penalty, adjusted by the taker's
/// finishing minus the keeper's defending. Real-world penalty conversion
/// hovers around 75%; this stays in that neighborhood after clamping.
pub const PENALTY_CONVERSION_BASE: f64 = 0.75;
pub const PENALTY_CONVERSION_SCALE: f64 = 0.005;
pub const PENALTY_CONVERSION_MIN: f64 = 0.50;
pub const PENALTY_CONVERSION_MAX: f64 = 0.95;

/// Fraction of off-target shots that get promoted to a `NearMiss` event
/// (post, crossbar, or just wide). Wide shots fire ~7-8 times per match on
/// average, so 0.50 yields ~3.5-4 near-misses per match — sits at the upper
/// half of the brief's "1.5-2× goal rate" range (avg ~2.5 goals/match).
/// Doesn't affect score or cards; purely drama density.
pub const NEAR_MISS_PROMOTION_RATE: f64 = 0.50;

// ─── State ──────────────────────────────────────────────────────────────────
/// Penalty awarded last tick, kick to be taken next tick. The intervening
/// minute is the dramatic beat between award and outcome.
///
/// `pub` (not `pub(crate)`) because it's reachable through the public
/// `HalfTimeSnapshot::pending_penalty` field — a penalty awarded at 45' rides
/// across the break in the snapshot and resolves at minute 46.
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct PendingPenalty {
    pub side: Side,
    pub taker: PlayerId,
}

pub(crate) struct MatchState<'a> {
    pub home: &'a Team,
    pub away: &'a Team,
    /// Mutable XI — starts as `team.starting_xi`, changes when subs come on.
    pub home_current_xi: [PlayerId; 11],
    pub away_current_xi: [PlayerId; 11],
    pub home_stamina: [f64; 11],
    pub away_stamina: [f64; 11],
    pub home_on_field: [bool; 11],
    pub away_on_field: [bool; 11],
    /// Parallel to `team.bench` — true once that bench player has come on.
    pub home_bench_used: Vec<bool>,
    pub away_bench_used: Vec<bool>,
    pub home_subs_used: u8,
    pub away_subs_used: u8,
    pub home_goals: u8,
    pub away_goals: u8,
    pub events: Vec<MatchEvent>,
    /// Penalty awarded in the previous tick, resolved at the start of the
    /// next tick. `None` outside the one-minute resolution window.
    pub pending_penalty: Option<PendingPenalty>,
}

impl<'a> MatchState<'a> {
    pub fn new(home: &'a Team, away: &'a Team) -> Self {
        let mut home_stamina = [0.0; 11];
        let mut away_stamina = [0.0; 11];
        for (i, id) in home.starting_xi.iter().enumerate() {
            home_stamina[i] = home
                .lookup(*id)
                .map(|p| p.attributes.stamina as f64)
                .unwrap_or(0.0);
        }
        for (i, id) in away.starting_xi.iter().enumerate() {
            away_stamina[i] = away
                .lookup(*id)
                .map(|p| p.attributes.stamina as f64)
                .unwrap_or(0.0);
        }
        Self {
            home,
            away,
            home_current_xi: home.starting_xi,
            away_current_xi: away.starting_xi,
            home_stamina,
            away_stamina,
            home_on_field: [true; 11],
            away_on_field: [true; 11],
            home_bench_used: vec![false; home.bench.len()],
            away_bench_used: vec![false; away.bench.len()],
            home_subs_used: 0,
            away_subs_used: 0,
            home_goals: 0,
            away_goals: 0,
            events: Vec::new(),
            pending_penalty: None,
        }
    }

    pub fn into_match(self, seed: u64) -> Match {
        Match {
            home: self.home.id,
            away: self.away.id,
            seed,
            result: MatchResult {
                home_goals: self.home_goals,
                away_goals: self.away_goals,
            },
            events: self.events,
        }
    }

    /// Capture the live mid-match state plus the RNG stream position at the
    /// half-time break, into a serializable snapshot (no `&Team` held). The
    /// `rng` passed must be the match RNG at the exact point the second half
    /// will resume from — i.e. *after* half-time narration has been narrated.
    pub fn snapshot_at_half(&self, seed: u64, rng: &MatchRng) -> HalfTimeSnapshot {
        HalfTimeSnapshot {
            seed,
            home_id: self.home.id,
            away_id: self.away.id,
            home_goals: self.home_goals,
            away_goals: self.away_goals,
            home_current_xi: self.home_current_xi,
            away_current_xi: self.away_current_xi,
            home_stamina: self.home_stamina,
            away_stamina: self.away_stamina,
            home_on_field: self.home_on_field,
            away_on_field: self.away_on_field,
            home_bench_used: self.home_bench_used.clone(),
            away_bench_used: self.away_bench_used.clone(),
            home_subs_used: self.home_subs_used,
            away_subs_used: self.away_subs_used,
            pending_penalty: self.pending_penalty,
            first_half_events: self.events.clone(),
            rng_state: rng.clone(),
        }
    }

    /// Rebuild a `MatchState` from a half-time snapshot for the second half.
    /// All mutable match state (XI / stamina / on-field / bench / subs / goals
    /// / pending penalty / events) comes from the snapshot; `home`/`away` are
    /// the (possibly tactically-edited) teams passed in. Because `tick` re-reads
    /// `state.<side>.tactics` every minute, swapping in an edited `Team` here is
    /// exactly how a half-time tactics change takes effect — but in this commit
    /// the same teams are passed, so behavior is unchanged.
    pub fn resume_from(snap: &HalfTimeSnapshot, home: &'a Team, away: &'a Team) -> Self {
        Self {
            home,
            away,
            home_current_xi: snap.home_current_xi,
            away_current_xi: snap.away_current_xi,
            home_stamina: snap.home_stamina,
            away_stamina: snap.away_stamina,
            home_on_field: snap.home_on_field,
            away_on_field: snap.away_on_field,
            home_bench_used: snap.home_bench_used.clone(),
            away_bench_used: snap.away_bench_used.clone(),
            home_subs_used: snap.home_subs_used,
            away_subs_used: snap.away_subs_used,
            home_goals: snap.home_goals,
            away_goals: snap.away_goals,
            events: snap.first_half_events.clone(),
            pending_penalty: snap.pending_penalty,
        }
    }
}

/// Serializable mid-match state captured at the half-time break, so the second
/// half can be run as a separate call (and, in later commits, with edited
/// tactics). Crucially holds NO `&Team` — only ids and the derived mutable
/// state — and carries the full `MatchRng` so the second half resumes the
/// exact keystream rather than re-seeding.
#[derive(Clone, Serialize, Deserialize)]
pub struct HalfTimeSnapshot {
    pub seed: u64,
    pub home_id: crate::domain::TeamId,
    pub away_id: crate::domain::TeamId,
    pub home_goals: u8,
    pub away_goals: u8,
    pub home_current_xi: [PlayerId; 11],
    pub away_current_xi: [PlayerId; 11],
    pub home_stamina: [f64; 11],
    pub away_stamina: [f64; 11],
    pub home_on_field: [bool; 11],
    pub away_on_field: [bool; 11],
    pub home_bench_used: Vec<bool>,
    pub away_bench_used: Vec<bool>,
    pub home_subs_used: u8,
    pub away_subs_used: u8,
    /// A penalty pending across the break. `simulate_first_half` force-resolves
    /// any 45'-penalty before snapshotting, so this is `None` for snapshots it
    /// produces; the field is retained so a hand-built snapshot can still carry
    /// a pending kick into the second half if a caller wants that.
    pub pending_penalty: Option<PendingPenalty>,
    /// All first-half events, including the synthetic `HalfTime` marker.
    pub first_half_events: Vec<MatchEvent>,
    pub rng_state: MatchRng,
}

// ─── Per-tick drive ─────────────────────────────────────────────────────────
pub(crate) fn tick(state: &mut MatchState, rng: &mut MatchRng, minute: u16) {
    drain_stamina(state);

    // A pending penalty awarded last tick consumes this entire minute —
    // play is stopped while the kick is taken, no other events fire.
    if let Some(pen) = state.pending_penalty.take() {
        resolve_penalty(state, rng, minute, pen);
        return;
    }

    let home_str = current_strength(state, Side::Home);
    let away_str = current_strength(state, Side::Away);

    let p_home = possession_home(&home_str, &away_str);
    let attacker_side = if rng.chance(p_home) {
        Side::Home
    } else {
        Side::Away
    };

    let attacker_team = team_for(state, attacker_side);
    let event_p = event_prob(attacker_team.tactics.tempo);
    if !rng.chance(event_p) {
        return;
    }

    let (att_str, def_str) = match attacker_side {
        Side::Home => (&home_str, &away_str),
        Side::Away => (&away_str, &home_str),
    };
    let defender_team = team_for(state, attacker_side.flip());

    let shot_p = shot_prob(att_str, def_str);
    let foul_p = FOUL_BASE_WITHIN_EVENT * pressing_foul_factor(defender_team.tactics.pressing);

    let r = rng.unit();
    if r < shot_p {
        resolve_shot(state, rng, minute, attacker_side);
    } else if r < shot_p + foul_p {
        resolve_foul(state, rng, minute, attacker_side);
    }
}

/// Force-resolve a penalty that was awarded at 45' but hasn't been taken,
/// *before* the half-time break — so the half-time score is closed (the UI
/// shows a real scoreline at the interval) rather than leaving the kick to
/// straddle into minute 46. Consumes the RNG for the kick at the given minute
/// and clears `pending_penalty`. No-op if nothing is pending.
///
/// This is the one deliberate behavior change of the half-split work: it
/// reorders RNG consumption relative to the former one-shot `simulate` for the
/// rare match that earns a penalty exactly at 45'. See `half_split.rs`.
pub(crate) fn force_resolve_pending_penalty(
    state: &mut MatchState,
    rng: &mut MatchRng,
    minute: u16,
) {
    if let Some(pen) = state.pending_penalty.take() {
        resolve_penalty(state, rng, minute, pen);
    }
}

fn team_for<'a>(state: &MatchState<'a>, side: Side) -> &'a Team {
    match side {
        Side::Home => state.home,
        Side::Away => state.away,
    }
}

/// Build a [`NarrationContext`] from the current score, from the perspective
/// of `side`. Call this *after* any score increment so a `score_diff == 0`
/// flag on a goal event genuinely means "this goal just equalized."
fn ctx_for(state: &MatchState, side: Side, minute: u16) -> NarrationContext {
    let (own, theirs) = match side {
        Side::Home => (state.home_goals, state.away_goals),
        Side::Away => (state.away_goals, state.home_goals),
    };
    NarrationContext {
        minute,
        score_diff: own as i8 - theirs as i8,
    }
}

// ─── Stamina ────────────────────────────────────────────────────────────────
fn drain_stamina(state: &mut MatchState) {
    let home_drain = BASE_STAMINA_DRAIN
        * tempo_stamina_factor(state.home.tactics.tempo)
        * pressing_stamina_factor(state.home.tactics.pressing);
    let away_drain = BASE_STAMINA_DRAIN
        * tempo_stamina_factor(state.away.tactics.tempo)
        * pressing_stamina_factor(state.away.tactics.pressing);
    for i in 0..11 {
        if state.home_on_field[i] {
            state.home_stamina[i] = (state.home_stamina[i] - home_drain).max(0.0);
        }
        if state.away_on_field[i] {
            state.away_stamina[i] = (state.away_stamina[i] - away_drain).max(0.0);
        }
    }
}

// ─── Strength snapshot using current XI + stamina ───────────────────────────
// `pub(crate)` so the analytic projection (`project_second_half`) can compose
// the same strengths the tick sees, from a snapshot-reconstructed state.
pub(crate) fn current_strength(state: &MatchState, side: Side) -> TeamStrength {
    let (team, current_xi, stamina, on_field, opp_pressing) = match side {
        Side::Home => (
            state.home,
            &state.home_current_xi,
            &state.home_stamina,
            &state.home_on_field,
            state.away.tactics.pressing,
        ),
        Side::Away => (
            state.away,
            &state.away_current_xi,
            &state.away_stamina,
            &state.away_on_field,
            state.home.tactics.pressing,
        ),
    };
    let mut effective: Vec<(Position, f64, f64, f64)> = Vec::with_capacity(11);
    for (i, id) in current_xi.iter().enumerate() {
        if !on_field[i] {
            continue;
        }
        let Some(player) = team.lookup(*id) else {
            continue;
        };
        let eff = stamina_effectiveness(stamina[i]);
        let (a, m, d) = raw_player_stats(
            player.attributes.finishing,
            player.attributes.technique,
            player.attributes.pace,
            player.attributes.passing,
            player.attributes.defending,
            player.attributes.stamina,
        );
        effective.push((player.position, a * eff, m * eff, d * eff));
    }
    strength::compose(
        &effective,
        team.formation,
        team.tactics.mentality,
        pressing_disrupt(opp_pressing),
    )
}

/// Kickoff-state strength for a team standing alone (no live `MatchState`): the
/// starting XI at FULL stamina, with formation/mentality from the team and the
/// opponent's pressing disrupting the midfield. This is the pre-match analogue
/// of [`current_strength`] — same `compose` over the same per-player stats, just
/// sourcing the XI from `team.starting_xi` and stamina from each player's base
/// attribute (exactly what `MatchState::new` seeds at minute 0). Used by the
/// RNG-free pre-match projection.
pub(crate) fn kickoff_strength(
    team: &Team,
    opp_pressing: crate::domain::Pressing,
) -> TeamStrength {
    let mut effective: Vec<(Position, f64, f64, f64)> = Vec::with_capacity(11);
    for id in team.starting_xi.iter() {
        let Some(player) = team.lookup(*id) else {
            continue;
        };
        let eff = stamina_effectiveness(player.attributes.stamina as f64);
        let (a, m, d) = raw_player_stats(
            player.attributes.finishing,
            player.attributes.technique,
            player.attributes.pace,
            player.attributes.passing,
            player.attributes.defending,
            player.attributes.stamina,
        );
        effective.push((player.position, a * eff, m * eff, d * eff));
    }
    strength::compose(
        &effective,
        team.formation,
        team.tactics.mentality,
        pressing_disrupt(opp_pressing),
    )
}

// ─── Picking players ────────────────────────────────────────────────────────
fn pick_index_by_position(
    team: &Team,
    current_xi: &[PlayerId; 11],
    on_field: &[bool; 11],
    weights: [f64; 4], // [GK, DEF, MID, FWD]
    rng: &mut MatchRng,
    exclude: Option<PlayerId>,
) -> Option<usize> {
    let mut ws = [0.0_f64; 11];
    for (i, id) in current_xi.iter().enumerate() {
        if !on_field[i] {
            continue;
        }
        if Some(*id) == exclude {
            continue;
        }
        let Some(player) = team.lookup(*id) else {
            continue;
        };
        let w = match player.position {
            Position::GK => weights[0],
            Position::DEF => weights[1],
            Position::MID => weights[2],
            Position::FWD => weights[3],
        };
        ws[i] = w;
    }
    if ws.iter().sum::<f64>() <= 0.0 {
        return None;
    }
    Some(rng.weighted_pick(&ws))
}

fn goalkeeper<'a>(
    team: &'a Team,
    current_xi: &[PlayerId; 11],
    on_field: &[bool; 11],
) -> Option<&'a Player> {
    for (i, id) in current_xi.iter().enumerate() {
        if !on_field[i] {
            continue;
        }
        if let Some(p) = team.lookup(*id) {
            if p.position == Position::GK {
                return Some(p);
            }
        }
    }
    None
}

// ─── Penalty taker + resolution ─────────────────────────────────────────────
/// Best available finisher on `side` — picks the on-field outfielder with the
/// highest `finishing` attribute. Designated-taker logic (team-defined kicker)
/// is future work; for v1 the algorithmic best-finisher is plenty.
fn pick_penalty_taker(state: &MatchState, side: Side) -> Option<PlayerId> {
    let (team, current_xi, on_field) = match side {
        Side::Home => (state.home, &state.home_current_xi, &state.home_on_field),
        Side::Away => (state.away, &state.away_current_xi, &state.away_on_field),
    };
    let mut best: Option<(PlayerId, u8)> = None;
    for (i, id) in current_xi.iter().enumerate() {
        if !on_field[i] {
            continue;
        }
        let Some(p) = team.lookup(*id) else { continue };
        if p.position == Position::GK {
            continue;
        }
        if best
            .map(|(_, f)| p.attributes.finishing > f)
            .unwrap_or(true)
        {
            best = Some((*id, p.attributes.finishing));
        }
    }
    best.map(|(id, _)| id)
}

fn resolve_penalty(
    state: &mut MatchState,
    rng: &mut MatchRng,
    minute: u16,
    pen: PendingPenalty,
) {
    let (att_team, def_team, def_current_xi, def_on_field) = match pen.side {
        Side::Home => (
            state.home,
            state.away,
            state.away_current_xi,
            state.away_on_field,
        ),
        Side::Away => (
            state.away,
            state.home,
            state.home_current_xi,
            state.home_on_field,
        ),
    };
    let Some(taker) = att_team.lookup(pen.taker) else {
        return;
    };
    let gk = goalkeeper(def_team, &def_current_xi, &def_on_field);
    let keeper_def = gk.map(|g| g.attributes.defending as f64).unwrap_or(50.0);
    let keeper_name = gk.map(|g| g.name.clone()).unwrap_or_else(|| "o goleiro".to_string());
    let taker_name = taker.name.clone();
    let team_name = att_team.name.clone();

    let mut conv_p = PENALTY_CONVERSION_BASE
        + (taker.attributes.finishing as f64 - keeper_def) * PENALTY_CONVERSION_SCALE;
    if conv_p < PENALTY_CONVERSION_MIN {
        conv_p = PENALTY_CONVERSION_MIN;
    } else if conv_p > PENALTY_CONVERSION_MAX {
        conv_p = PENALTY_CONVERSION_MAX;
    }

    if rng.chance(conv_p) {
        match pen.side {
            Side::Home => state.home_goals = state.home_goals.saturating_add(1),
            Side::Away => state.away_goals = state.away_goals.saturating_add(1),
        }
        let ctx = ctx_for(state, pen.side, minute);
        let text = narration::narrate_penalty_scored(&ctx, rng, minute, &team_name, &taker_name);
        state.events.push(MatchEvent {
            minute,
            side: Some(pen.side),
            kind: MatchEventKind::Goal {
                scorer: pen.taker,
                assist: None,
            },
            text,
        });
    } else {
        let ctx = ctx_for(state, pen.side, minute);
        let text = narration::narrate_penalty_missed(&ctx, rng, minute, &taker_name, &keeper_name);
        state.events.push(MatchEvent {
            minute,
            side: Some(pen.side),
            kind: MatchEventKind::PenaltyMissed { taker: pen.taker },
            text,
        });
    }
}

// ─── Shot resolution ────────────────────────────────────────────────────────
fn resolve_shot(state: &mut MatchState, rng: &mut MatchRng, minute: u16, side: Side) {
    let (att_team, def_team, att_current_xi, att_on_field, def_current_xi, def_on_field) =
        match side {
            Side::Home => (
                state.home,
                state.away,
                state.home_current_xi,
                state.home_on_field,
                state.away_current_xi,
                state.away_on_field,
            ),
            Side::Away => (
                state.away,
                state.home,
                state.away_current_xi,
                state.away_on_field,
                state.home_current_xi,
                state.home_on_field,
            ),
        };

    let shooter_idx = pick_index_by_position(
        att_team,
        &att_current_xi,
        &att_on_field,
        [0.05, 1.0, 3.0, 5.0],
        rng,
        None,
    );
    let Some(shooter_idx) = shooter_idx else {
        return;
    };
    let shooter_id = att_current_xi[shooter_idx];
    let Some(shooter) = att_team.lookup(shooter_id) else {
        return;
    };

    let width_f = width_shot_factor(att_team.tactics.width);
    let mut on_target_p = ON_TARGET_BASE
        + (shooter.attributes.technique as f64 - 50.0) * ON_TARGET_TECHNIQUE_SCALE;
    on_target_p *= width_f;
    if on_target_p < ON_TARGET_MIN {
        on_target_p = ON_TARGET_MIN;
    } else if on_target_p > ON_TARGET_MAX {
        on_target_p = ON_TARGET_MAX;
    }
    let on_target = rng.chance(on_target_p);

    if !on_target {
        let ctx = ctx_for(state, side, minute);
        if rng.chance(NEAR_MISS_PROMOTION_RATE) {
            let kind = match rng.range_u32(0, 3) {
                0 => NearMissKind::Post,
                1 => NearMissKind::Crossbar,
                _ => NearMissKind::JustWide,
            };
            let text = narration::narrate_near_miss(&ctx, rng, minute, &shooter.name, kind);
            state.events.push(MatchEvent {
                minute,
                side: Some(side),
                kind: MatchEventKind::NearMiss {
                    shooter: shooter_id,
                    kind,
                },
                text,
            });
        } else {
            let text = narration::narrate_shot_wide(&ctx, rng, minute, &shooter.name);
            state.events.push(MatchEvent {
                minute,
                side: Some(side),
                kind: MatchEventKind::Shot {
                    shooter: shooter_id,
                    on_target: false,
                },
                text,
            });
        }
        return;
    }

    let gk = goalkeeper(def_team, &def_current_xi, &def_on_field);
    let gk_def = gk.map(|g| g.attributes.defending as f64).unwrap_or(50.0);
    let gk_name = gk.map(|g| g.name.as_str()).unwrap_or("o goleiro");
    let mut goal_p =
        GOAL_BASE + (shooter.attributes.finishing as f64 - gk_def) * GOAL_FINISHING_GK_SCALE;
    if goal_p < GOAL_MIN {
        goal_p = GOAL_MIN;
    } else if goal_p > GOAL_MAX {
        goal_p = GOAL_MAX;
    }

    if rng.chance(goal_p) {
        let assist = if rng.chance(ASSIST_PROB) {
            pick_index_by_position(
                att_team,
                &att_current_xi,
                &att_on_field,
                [0.0, 0.5, 3.0, 2.0],
                rng,
                Some(shooter_id),
            )
            .map(|i| att_current_xi[i])
        } else {
            None
        };

        match side {
            Side::Home => state.home_goals = state.home_goals.saturating_add(1),
            Side::Away => state.away_goals = state.away_goals.saturating_add(1),
        }

        let ctx = ctx_for(state, side, minute);
        let assist_name = assist.and_then(|id| att_team.lookup(id)).map(|p| p.name.as_str());
        let text = narration::narrate_goal(&ctx, rng, minute, &att_team.name, &shooter.name, assist_name);
        state.events.push(MatchEvent {
            minute,
            side: Some(side),
            kind: MatchEventKind::Goal {
                scorer: shooter_id,
                assist,
            },
            text,
        });
    } else {
        let ctx = ctx_for(state, side, minute);
        let text = narration::narrate_shot_saved(&ctx, rng, minute, &shooter.name, gk_name);
        state.events.push(MatchEvent {
            minute,
            side: Some(side),
            kind: MatchEventKind::Shot {
                shooter: shooter_id,
                on_target: true,
            },
            text,
        });
    }
}

// ─── Foul resolution ────────────────────────────────────────────────────────
fn resolve_foul(state: &mut MatchState, rng: &mut MatchRng, minute: u16, attacker_side: Side) {
    let (att_team, def_team, att_current_xi, att_on_field, def_current_xi, def_on_field) =
        match attacker_side {
            Side::Home => (
                state.home,
                state.away,
                state.home_current_xi,
                state.home_on_field,
                state.away_current_xi,
                state.away_on_field,
            ),
            Side::Away => (
                state.away,
                state.home,
                state.away_current_xi,
                state.away_on_field,
                state.home_current_xi,
                state.home_on_field,
            ),
        };

    let offender_idx = pick_index_by_position(
        def_team,
        &def_current_xi,
        &def_on_field,
        [0.1, 3.0, 2.0, 1.0],
        rng,
        None,
    );
    let victim_idx = pick_index_by_position(
        att_team,
        &att_current_xi,
        &att_on_field,
        [0.1, 1.0, 2.0, 3.0],
        rng,
        None,
    );
    let (Some(offender_idx), Some(victim_idx)) = (offender_idx, victim_idx) else {
        return;
    };
    let offender_id = def_current_xi[offender_idx];
    let victim_id = att_current_xi[victim_idx];
    let Some(offender) = def_team.lookup(offender_id) else {
        return;
    };
    let Some(victim) = att_team.lookup(victim_id) else {
        return;
    };

    let defender_side = attacker_side.flip();
    let foul_ctx = ctx_for(state, defender_side, minute);
    let foul_text = narration::narrate_foul(&foul_ctx, rng, minute, &offender.name, &victim.name);
    state.events.push(MatchEvent {
        minute,
        side: Some(defender_side),
        kind: MatchEventKind::Foul {
            offender: offender_id,
            victim: victim_id,
        },
        text: foul_text,
    });

    // Penalty check: a small fraction of fouls are "inside the box" and get
    // awarded as penalties. The penalty replaces the card roll for this foul
    // (real football routes the consequence to the spot kick, not a yellow).
    if rng.chance(PENALTY_FOUL_RATE) {
        if let Some(taker_id) = pick_penalty_taker(state, attacker_side) {
            let taker_team = team_for(state, attacker_side);
            let taker_name = taker_team
                .lookup(taker_id)
                .map(|p| p.name.clone())
                .unwrap_or_default();
            let pen_ctx = ctx_for(state, attacker_side, minute);
            let text = narration::narrate_penalty_awarded(&pen_ctx, rng, minute, &taker_name);
            state.events.push(MatchEvent {
                minute,
                side: Some(attacker_side),
                kind: MatchEventKind::PenaltyAwarded { taker: taker_id },
                text,
            });
            state.pending_penalty = Some(PendingPenalty {
                side: attacker_side,
                taker: taker_id,
            });
            return;
        }
        // No eligible taker (degenerate case — all FWDs/MIDs off, GK only):
        // fall through to regular card logic so the foul still gets resolved.
    }

    let r = rng.unit();
    let pressing_bias = match def_team.tactics.pressing {
        crate::domain::Pressing::High => 0.05,
        _ => 0.0,
    };
    if r < CARD_NONE - pressing_bias {
        return;
    } else if r < CARD_NONE - pressing_bias + CARD_YELLOW {
        let card_ctx = ctx_for(state, defender_side, minute);
        let text = narration::narrate_yellow(&card_ctx, rng, minute, &offender.name);
        state.events.push(MatchEvent {
            minute,
            side: Some(defender_side),
            kind: MatchEventKind::YellowCard {
                player: offender_id,
            },
            text,
        });
    } else if r < CARD_NONE - pressing_bias + CARD_YELLOW + CARD_RED + pressing_bias {
        let card_ctx = ctx_for(state, defender_side, minute);
        let text = narration::narrate_red(&card_ctx, rng, minute, &offender.name);
        state.events.push(MatchEvent {
            minute,
            side: Some(defender_side),
            kind: MatchEventKind::RedCard {
                player: offender_id,
            },
            text,
        });
        match defender_side {
            Side::Home => state.home_on_field[offender_idx] = false,
            Side::Away => state.away_on_field[offender_idx] = false,
        }
    }
}
