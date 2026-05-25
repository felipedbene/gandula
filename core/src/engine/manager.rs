//! Heuristic manager: a small rule-based brain that, between minutes, may
//! emit a substitution. One implementation for now — when a learned manager
//! lands later, that's when we extract a trait. Until then: concrete.

use crate::domain::{MatchEvent, MatchEventKind, PlayerId, Position, Side, Team};
use crate::engine::tick::MatchState;

// ─── Tunables ───────────────────────────────────────────────────────────────
pub const MAX_SUBS_PER_MATCH: u8 = 3;
pub const STAMINA_SUB_THRESHOLD: f64 = 40.0;
pub const STAMINA_FRESH_THRESHOLD: f64 = 70.0;
pub const STAMINA_RULE_MIN_MINUTE: u16 = 55;
pub const GAME_STATE_RULE_MIN_MINUTE: u16 = 70;

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
pub(crate) fn run_managers(state: &mut MatchState, minute: u16) {
    for side in [Side::Home, Side::Away] {
        let action = {
            let view = build_view(state, side, minute);
            heuristic_decide(&view)
        };
        if let Some(action) = action {
            apply_action(state, side, action, minute);
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
pub(crate) fn heuristic_decide(view: &ManagerView) -> Option<ManagerAction> {
    if view.subs_used >= MAX_SUBS_PER_MATCH {
        return None;
    }
    if let Some(action) = gk_emergency(view) {
        return Some(action);
    }
    if view.minute >= STAMINA_RULE_MIN_MINUTE {
        if let Some(action) = stamina_swap(view) {
            return Some(action);
        }
    }
    if view.minute >= GAME_STATE_RULE_MIN_MINUTE {
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
fn stamina_swap(view: &ManagerView) -> Option<ManagerAction> {
    for slot in 0..11 {
        if !view.on_field[slot] {
            continue;
        }
        if view.stamina[slot] >= STAMINA_SUB_THRESHOLD {
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
            find_bench_with_min_stamina(view, player.position, STAMINA_FRESH_THRESHOLD)
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
fn apply_action(state: &mut MatchState, side: Side, action: ManagerAction, minute: u16) {
    match action {
        ManagerAction::Substitute {
            off_slot,
            on_bench_idx,
        } => apply_substitution(state, side, off_slot, on_bench_idx, minute),
    }
}

fn apply_substitution(
    state: &mut MatchState,
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
            state.events.push(MatchEvent {
                minute,
                side: Some(Side::Home),
                kind: MatchEventKind::Substitution {
                    off: off_id,
                    on: on_id,
                },
                text: format!(
                    "{minute}' Substituição no {team_name}: sai {off_name}, entra {on_name}."
                ),
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
            state.events.push(MatchEvent {
                minute,
                side: Some(Side::Away),
                kind: MatchEventKind::Substitution {
                    off: off_id,
                    on: on_id,
                },
                text: format!(
                    "{minute}' Substituição no {team_name}: sai {off_name}, entra {on_name}."
                ),
            });
        }
    }
}
