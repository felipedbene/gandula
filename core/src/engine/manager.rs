//! Heuristic manager: a small rule-based brain that, between minutes, may
//! emit a substitution. One implementation for now — when a learned manager
//! lands later, that's when we extract a trait. Until then: concrete.

use crate::domain::{MatchEvent, MatchEventKind, PlayerId, Position, Side, Team};
use crate::engine::narration::{self, NarrationContext};
use crate::engine::tick::MatchState;
use crate::rng::MatchRng;

// ─── Tunables ───────────────────────────────────────────────────────────────
pub const MAX_SUBS_PER_MATCH: u8 = 3;
pub const STAMINA_SUB_THRESHOLD: f64 = 40.0;
pub const STAMINA_FRESH_THRESHOLD: f64 = 70.0;
pub const STAMINA_RULE_MIN_MINUTE: u16 = 55;
pub const GAME_STATE_RULE_MIN_MINUTE: u16 = 70;

/// Knobs that parameterize the heuristic manager — the search space self-play
/// (E.3.c) will tune, and the basis for per-club styles (E.3.b). `balanced()`
/// reproduces the historical constants above exactly, so the default in-match
/// behavior is unchanged.
#[derive(Clone, Copy, Debug)]
pub struct ManagerConfig {
    pub max_subs_per_match: u8,
    pub stamina_sub_threshold: f64,
    pub stamina_fresh_threshold: f64,
    pub stamina_rule_min_minute: u16,
    pub game_state_rule_min_minute: u16,
}

impl ManagerConfig {
    /// The canonical balanced style — the rules as originally tuned.
    pub fn balanced() -> Self {
        Self {
            max_subs_per_match: MAX_SUBS_PER_MATCH,
            stamina_sub_threshold: STAMINA_SUB_THRESHOLD,
            stamina_fresh_threshold: STAMINA_FRESH_THRESHOLD,
            stamina_rule_min_minute: STAMINA_RULE_MIN_MINUTE,
            game_state_rule_min_minute: GAME_STATE_RULE_MIN_MINUTE,
        }
    }

    /// Conservative style: pulls tired players sooner and reacts to the
    /// scoreline earlier (locks in leads / chases from earlier in the half).
    pub fn cautious() -> Self {
        Self {
            stamina_sub_threshold: 45.0,
            stamina_rule_min_minute: 50,
            game_state_rule_min_minute: 65,
            ..Self::balanced()
        }
    }

    /// Bold style: rides the starters longer (only swaps the truly gassed,
    /// accepts slightly-less-fresh subs) and commits to a game-state change
    /// late rather than early.
    pub fn bold() -> Self {
        Self {
            stamina_sub_threshold: 35.0,
            stamina_fresh_threshold: 65.0,
            stamina_rule_min_minute: 60,
            game_state_rule_min_minute: 75,
            ..Self::balanced()
        }
    }
}

/// Deterministic per-club manager style (E.3.b). Clubs are partitioned by id
/// so rivals manage differently; self-play (E.3.c) will later assign/tune these
/// per club instead of bucketing by id.
pub fn manager_config_for(team_id: u32) -> ManagerConfig {
    match team_id % 3 {
        0 => ManagerConfig::balanced(),
        1 => ManagerConfig::cautious(),
        _ => ManagerConfig::bold(),
    }
}

// ─── Read-only view into one team's state ───────────────────────────────────
pub(crate) struct ManagerView<'a> {
    pub team: &'a Team,
    pub current_xi: &'a [PlayerId; 11],
    pub on_field: &'a [bool; 11],
    pub stamina: &'a [f64; 11],
    pub subs_used: u8,
    pub bench_used: &'a [bool],
    pub minute: u16,
    pub our_goals: u8,
    pub their_goals: u8,
}

pub(crate) enum ManagerAction {
    Substitute {
        off_slot: usize,
        on_bench_idx: usize,
    },
}

// ─── Entry point — runs both teams' managers after each minute ──────────────
// The RNG is threaded only so the substitution narration can draw phrasings —
// the heuristic-decide logic itself stays pure / deterministic without it.
pub(crate) fn run_managers(state: &mut MatchState, rng: &mut MatchRng, minute: u16) {
    for side in [Side::Home, Side::Away] {
        let action = {
            let view = build_view(state, side, minute);
            // E.3.b: each club manages in its own style, keyed off team id.
            let cfg = manager_config_for(view.team.id.0);
            heuristic_decide(&view, &cfg)
        };
        if let Some(action) = action {
            apply_action(state, rng, side, action, minute);
        }
    }
}

fn build_view<'a>(state: &'a MatchState<'_>, side: Side, minute: u16) -> ManagerView<'a> {
    match side {
        Side::Home => ManagerView {
            team: state.home,
            current_xi: &state.home_current_xi,
            on_field: &state.home_on_field,
            stamina: &state.home_stamina,
            subs_used: state.home_subs_used,
            bench_used: &state.home_bench_used,
            minute,
            our_goals: state.home_goals,
            their_goals: state.away_goals,
        },
        Side::Away => ManagerView {
            team: state.away,
            current_xi: &state.away_current_xi,
            on_field: &state.away_on_field,
            stamina: &state.away_stamina,
            subs_used: state.away_subs_used,
            bench_used: &state.away_bench_used,
            minute,
            our_goals: state.away_goals,
            their_goals: state.home_goals,
        },
    }
}

// ─── Heuristic rules (pure, no RNG — order matters: first match wins) ───────
pub(crate) fn heuristic_decide(
    view: &ManagerView,
    cfg: &ManagerConfig,
) -> Option<ManagerAction> {
    if view.subs_used >= cfg.max_subs_per_match {
        return None;
    }
    if let Some(action) = gk_emergency(view) {
        return Some(action);
    }
    if view.minute >= cfg.stamina_rule_min_minute {
        if let Some(action) = stamina_swap(view, cfg) {
            return Some(action);
        }
    }
    if view.minute >= cfg.game_state_rule_min_minute {
        let diff = view.our_goals as i32 - view.their_goals as i32;
        if diff < 0 {
            if let Some(action) = chase_with_fresh_fwd(view) {
                return Some(action);
            }
        } else if diff > 0 {
            if let Some(action) = lock_in_with_def(view) {
                return Some(action);
            }
        }
    }
    None
}

// Rule 1: GK has been red-carded — bring on a bench GK if any (sacrifices
// the first on-field FWD; falls back to MID).
fn gk_emergency(view: &ManagerView) -> Option<ManagerAction> {
    let gk_slot = (0..11).find(|&i| {
        let id = view.current_xi[i];
        view.team
            .lookup(id)
            .map(|p| p.position == Position::GK)
            .unwrap_or(false)
    })?;
    if view.on_field[gk_slot] {
        return None;
    }
    let bench_idx = find_bench(view, Position::GK)?;
    let off_slot = find_on_field(view, Position::FWD)
        .or_else(|| find_on_field(view, Position::MID))?;
    Some(ManagerAction::Substitute {
        off_slot,
        on_bench_idx: bench_idx,
    })
}

// Rule 2: After STAMINA_RULE_MIN_MINUTE, swap an exhausted outfielder for a
// fresh same-position bench player (GK excluded — rule 1 handles GK).
fn stamina_swap(view: &ManagerView, cfg: &ManagerConfig) -> Option<ManagerAction> {
    for slot in 0..11 {
        if !view.on_field[slot] {
            continue;
        }
        if view.stamina[slot] >= cfg.stamina_sub_threshold {
            continue;
        }
        let id = view.current_xi[slot];
        let Some(player) = view.team.lookup(id) else {
            continue;
        };
        if player.position == Position::GK {
            continue;
        }
        if let Some(bench_idx) =
            find_bench_with_min_stamina(view, player.position, cfg.stamina_fresh_threshold)
        {
            return Some(ManagerAction::Substitute {
                off_slot: slot,
                on_bench_idx: bench_idx,
            });
        }
    }
    None
}

// Rule 3a: Losing late — swap the most-tired on-field FWD for a fresh bench
// FWD.
fn chase_with_fresh_fwd(view: &ManagerView) -> Option<ManagerAction> {
    let off_slot = (0..11)
        .filter(|&i| {
            view.on_field[i] && {
                let id = view.current_xi[i];
                view.team
                    .lookup(id)
                    .map(|p| p.position == Position::FWD)
                    .unwrap_or(false)
            }
        })
        .min_by(|&a, &b| {
            view.stamina[a]
                .partial_cmp(&view.stamina[b])
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
    let bench_idx = find_bench(view, Position::FWD)?;
    Some(ManagerAction::Substitute {
        off_slot,
        on_bench_idx: bench_idx,
    })
}

// Rule 3b: Winning late — swap a FWD for a fresh DEF (shut up shop).
fn lock_in_with_def(view: &ManagerView) -> Option<ManagerAction> {
    let off_slot = find_on_field(view, Position::FWD)?;
    let bench_idx = find_bench(view, Position::DEF)?;
    Some(ManagerAction::Substitute {
        off_slot,
        on_bench_idx: bench_idx,
    })
}

// ─── Helpers ────────────────────────────────────────────────────────────────
fn find_bench(view: &ManagerView, pos: Position) -> Option<usize> {
    find_bench_with_min_stamina(view, pos, 0.0)
}

fn find_bench_with_min_stamina(
    view: &ManagerView,
    pos: Position,
    min_stamina: f64,
) -> Option<usize> {
    view.team.bench.iter().enumerate().find_map(|(i, id)| {
        if view.bench_used[i] {
            return None;
        }
        let p = view.team.lookup(*id)?;
        if p.position != pos {
            return None;
        }
        if (p.attributes.stamina as f64) < min_stamina {
            return None;
        }
        Some(i)
    })
}

fn find_on_field(view: &ManagerView, pos: Position) -> Option<usize> {
    (0..11).find(|&i| {
        if !view.on_field[i] {
            return false;
        }
        let id = view.current_xi[i];
        view.team
            .lookup(id)
            .map(|p| p.position == pos)
            .unwrap_or(false)
    })
}

// ─── Apply the chosen action ────────────────────────────────────────────────
fn apply_action(
    state: &mut MatchState,
    rng: &mut MatchRng,
    side: Side,
    action: ManagerAction,
    minute: u16,
) {
    match action {
        ManagerAction::Substitute {
            off_slot,
            on_bench_idx,
        } => apply_substitution(state, rng, side, off_slot, on_bench_idx, minute),
    }
}

fn apply_substitution(
    state: &mut MatchState,
    rng: &mut MatchRng,
    side: Side,
    off_slot: usize,
    on_bench_idx: usize,
    minute: u16,
) {
    match side {
        Side::Home => {
            let off_id = state.home_current_xi[off_slot];
            let on_id = state.home.bench[on_bench_idx];
            let on_stamina = state.home.lookup(on_id).map(|p| p.attributes.stamina as f64);
            let off_name = state.home.lookup(off_id).map(|p| p.name.clone());
            let on_name = state.home.lookup(on_id).map(|p| p.name.clone());
            let team_name = state.home.name.clone();
            let (Some(on_stamina), Some(off_name), Some(on_name)) = (on_stamina, off_name, on_name)
            else {
                return;
            };

            state.home_current_xi[off_slot] = on_id;
            state.home_on_field[off_slot] = true;
            state.home_stamina[off_slot] = on_stamina;
            state.home_bench_used[on_bench_idx] = true;
            state.home_subs_used += 1;
            let ctx = NarrationContext {
                minute,
                score_diff: state.home_goals as i8 - state.away_goals as i8,
            };
            let text = narration::narrate_substitution(
                &ctx, rng, minute, &team_name, &off_name, &on_name,
            );
            state.events.push(MatchEvent {
                minute,
                side: Some(Side::Home),
                kind: MatchEventKind::Substitution {
                    off: off_id,
                    on: on_id,
                },
                text,
            });
        }
        Side::Away => {
            let off_id = state.away_current_xi[off_slot];
            let on_id = state.away.bench[on_bench_idx];
            let on_stamina = state.away.lookup(on_id).map(|p| p.attributes.stamina as f64);
            let off_name = state.away.lookup(off_id).map(|p| p.name.clone());
            let on_name = state.away.lookup(on_id).map(|p| p.name.clone());
            let team_name = state.away.name.clone();
            let (Some(on_stamina), Some(off_name), Some(on_name)) = (on_stamina, off_name, on_name)
            else {
                return;
            };

            state.away_current_xi[off_slot] = on_id;
            state.away_on_field[off_slot] = true;
            state.away_stamina[off_slot] = on_stamina;
            state.away_bench_used[on_bench_idx] = true;
            state.away_subs_used += 1;
            let ctx = NarrationContext {
                minute,
                score_diff: state.away_goals as i8 - state.home_goals as i8,
            };
            let text = narration::narrate_substitution(
                &ctx, rng, minute, &team_name, &off_name, &on_name,
            );
            state.events.push(MatchEvent {
                minute,
                side: Some(Side::Away),
                kind: MatchEventKind::Substitution {
                    off: off_id,
                    on: on_id,
                },
                text,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        Attributes, Formation, Mentality, Player, Pressing, Tactics, TeamId, Tempo, Width,
    };

    fn player(id: u32, position: Position, stamina_attr: u8) -> Player {
        Player {
            id: PlayerId(id),
            name: format!("P{id}"),
            age: 25,
            position,
            attributes: Attributes {
                pace: 70,
                technique: 70,
                passing: 70,
                defending: 70,
                finishing: 70,
                stamina: stamina_attr,
            },
        }
    }

    // XI = GK + 4 DEF + 3 MID + 3 FWD (ids 1..=11) with a fresh bench FWD (12).
    fn scenario_team() -> Team {
        let mut roster = vec![player(1, Position::GK, 90)];
        for i in 2..=5 {
            roster.push(player(i, Position::DEF, 90));
        }
        for i in 6..=8 {
            roster.push(player(i, Position::MID, 90));
        }
        for i in 9..=11 {
            roster.push(player(i, Position::FWD, 90));
        }
        roster.push(player(12, Position::FWD, 95)); // fresh bench FWD
        let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId((i as u32) + 1));
        Team {
            id: TeamId(1),
            name: "T".to_string(),
            roster,
            formation: Formation::F442,
            tactics: Tactics {
                mentality: Mentality::Balanced,
                tempo: Tempo::Normal,
                pressing: Pressing::Medium,
                width: Width::Normal,
            },
            starting_xi: xi,
            bench: vec![PlayerId(12)],
        }
    }

    // One tired FWD (slot 8 = id 9), everyone else fresh.
    const ON_FIELD: [bool; 11] = [true; 11];
    fn tired_fwd_stamina() -> [f64; 11] {
        let mut s = [90.0f64; 11];
        s[8] = 30.0;
        s
    }
    fn xi() -> [PlayerId; 11] {
        std::array::from_fn(|i| PlayerId((i as u32) + 1))
    }

    fn view<'a>(
        team: &'a Team,
        current_xi: &'a [PlayerId; 11],
        stamina: &'a [f64; 11],
        bench_used: &'a [bool],
        minute: u16,
    ) -> ManagerView<'a> {
        ManagerView {
            team,
            current_xi,
            on_field: &ON_FIELD,
            stamina,
            subs_used: 0,
            bench_used,
            minute,
            our_goals: 0,
            their_goals: 0,
        }
    }

    #[test]
    fn balanced_subs_tired_fwd_only_after_the_stamina_minute() {
        let team = scenario_team();
        let xi = xi();
        let stamina = tired_fwd_stamina();
        let bench_used = [false];
        let cfg = ManagerConfig::balanced();

        let early = view(&team, &xi, &stamina, &bench_used, cfg.stamina_rule_min_minute - 1);
        assert!(heuristic_decide(&early, &cfg).is_none());

        let late = view(&team, &xi, &stamina, &bench_used, cfg.stamina_rule_min_minute);
        assert!(matches!(
            heuristic_decide(&late, &cfg),
            Some(ManagerAction::Substitute { .. })
        ));
    }

    #[test]
    fn config_drives_behavior() {
        let team = scenario_team();
        let xi = xi();
        let stamina = tired_fwd_stamina();
        let bench_used = [false];
        let minute = 40; // below balanced's stamina_rule_min_minute (55)

        let balanced = ManagerConfig::balanced();
        let eager = ManagerConfig {
            stamina_rule_min_minute: 30,
            ..ManagerConfig::balanced()
        };

        assert!(heuristic_decide(&view(&team, &xi, &stamina, &bench_used, minute), &balanced).is_none());
        assert!(matches!(
            heuristic_decide(&view(&team, &xi, &stamina, &bench_used, minute), &eager),
            Some(ManagerAction::Substitute { .. })
        ));
    }

    #[test]
    fn manager_config_for_partitions_clubs_by_id() {
        // Deterministic id → style, covering all three buckets.
        assert_eq!(
            manager_config_for(0).stamina_rule_min_minute,
            ManagerConfig::balanced().stamina_rule_min_minute
        );
        assert_eq!(
            manager_config_for(3).stamina_rule_min_minute,
            ManagerConfig::balanced().stamina_rule_min_minute
        );
        assert_eq!(
            manager_config_for(1).stamina_rule_min_minute,
            ManagerConfig::cautious().stamina_rule_min_minute
        );
        assert_eq!(
            manager_config_for(2).stamina_rule_min_minute,
            ManagerConfig::bold().stamina_rule_min_minute
        );
        // The presets are genuinely distinct.
        assert_ne!(
            ManagerConfig::cautious().stamina_rule_min_minute,
            ManagerConfig::bold().stamina_rule_min_minute
        );
    }
}
