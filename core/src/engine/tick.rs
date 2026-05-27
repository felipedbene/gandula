//! One-minute simulation step.
//!
//! Inputs: current `MatchState`, the home/away teams, the shared RNG. Outputs:
//! zero or one `MatchEvent` appended to the log. Tunable constants live at the
//! top.

use crate::domain::{
    Match, MatchEvent, MatchEventKind, MatchResult, Player, PlayerId, Position, Side, Team,
};
use crate::engine::narration::{self, NarrationContext};
use crate::engine::strength::{
    self, TeamStrength, pressing_disrupt, pressing_foul_factor, pressing_stamina_factor,
    raw_player_stats, stamina_effectiveness, tempo_event_factor, tempo_stamina_factor,
    width_shot_factor,
};
use crate::rng::MatchRng;

// ─── Tunables ───────────────────────────────────────────────────────────────
pub const BASE_STAMINA_DRAIN: f64 = 0.30;
pub const BASE_EVENT_RATE: f64 = 0.18;
pub const POSSESSION_MID_SCALE: f64 = 0.005;
pub const POSSESSION_MIN: f64 = 0.10;
pub const POSSESSION_MAX: f64 = 0.90;

pub const SHOT_BASE_WITHIN_EVENT: f64 = 0.70;
pub const SHOT_ATTACK_DEFENSE_SCALE: f64 = 1.0 / 200.0;
pub const SHOT_PROB_MIN: f64 = 0.20;
pub const SHOT_PROB_MAX: f64 = 0.95;

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

// ─── State ──────────────────────────────────────────────────────────────────
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
}

// ─── Per-tick drive ─────────────────────────────────────────────────────────
pub(crate) fn tick(state: &mut MatchState, rng: &mut MatchRng, minute: u16) {
    drain_stamina(state);

    let home_str = current_strength(state, Side::Home);
    let away_str = current_strength(state, Side::Away);

    let mut p_home = 0.5 + POSSESSION_MID_SCALE * (home_str.midfield - away_str.midfield);
    if p_home < POSSESSION_MIN {
        p_home = POSSESSION_MIN;
    } else if p_home > POSSESSION_MAX {
        p_home = POSSESSION_MAX;
    }
    let attacker_side = if rng.chance(p_home) {
        Side::Home
    } else {
        Side::Away
    };

    let attacker_team = team_for(state, attacker_side);
    let event_p = BASE_EVENT_RATE * tempo_event_factor(attacker_team.tactics.tempo);
    if !rng.chance(event_p) {
        return;
    }

    let (att_str, def_str) = match attacker_side {
        Side::Home => (&home_str, &away_str),
        Side::Away => (&away_str, &home_str),
    };
    let defender_team = team_for(state, attacker_side.flip());

    let mut shot_p = SHOT_BASE_WITHIN_EVENT
        * (1.0 + (att_str.attack - def_str.defense) * SHOT_ATTACK_DEFENSE_SCALE);
    if shot_p < SHOT_PROB_MIN {
        shot_p = SHOT_PROB_MIN;
    } else if shot_p > SHOT_PROB_MAX {
        shot_p = SHOT_PROB_MAX;
    }
    let foul_p = FOUL_BASE_WITHIN_EVENT * pressing_foul_factor(defender_team.tactics.pressing);

    let r = rng.unit();
    if r < shot_p {
        resolve_shot(state, rng, minute, attacker_side);
    } else if r < shot_p + foul_p {
        resolve_foul(state, rng, minute, attacker_side);
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
fn current_strength(state: &MatchState, side: Side) -> TeamStrength {
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
