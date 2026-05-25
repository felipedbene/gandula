//! Team strength composition and tactical modifiers.
//!
//! All magic numbers live at the top as `pub const` so they can be tuned from
//! one place. See `ARCHITECTURE.md` for the formulas these implement.

use crate::domain::{Formation, Mentality, Position, Pressing, Tempo, Width};

// ─── Per-player attribute blending into a "raw" stat ────────────────────────
pub const ATTACK_W_FINISHING: f64 = 0.5;
pub const ATTACK_W_TECHNIQUE: f64 = 0.3;
pub const ATTACK_W_PACE: f64 = 0.2;

pub const MID_W_PASSING: f64 = 0.5;
pub const MID_W_TECHNIQUE: f64 = 0.3;
pub const MID_W_STAMINA: f64 = 0.2;

pub const DEF_W_DEFENDING: f64 = 0.5;
pub const DEF_W_PACE: f64 = 0.2;
pub const DEF_W_STAMINA: f64 = 0.3;

// ─── How much each position contributes to each stat ────────────────────────
pub fn pos_weight_attack(p: Position) -> f64 {
    match p {
        Position::GK => 0.0,
        Position::DEF => 0.1,
        Position::MID => 0.3,
        Position::FWD => 0.6,
    }
}

pub fn pos_weight_mid(p: Position) -> f64 {
    match p {
        Position::GK => 0.0,
        Position::DEF => 0.2,
        Position::MID => 0.6,
        Position::FWD => 0.2,
    }
}

pub fn pos_weight_defense(p: Position) -> f64 {
    match p {
        Position::GK => 0.1,
        Position::DEF => 0.6,
        Position::MID => 0.3,
        Position::FWD => 0.0,
    }
}

// ─── Stamina → effectiveness mapping ────────────────────────────────────────
// A fully fresh player (stamina=99) is at 100%. A depleted player (stamina=0)
// is at 70%. Linear between.
pub const STAMINA_MIN_EFF: f64 = 0.7;
pub const STAMINA_RANGE_EFF: f64 = 0.3;

pub fn stamina_effectiveness(stamina: f64) -> f64 {
    STAMINA_MIN_EFF + STAMINA_RANGE_EFF * (stamina.clamp(0.0, 99.0) / 99.0)
}

// ─── Formation modifier: (attack, midfield, defense) deltas ─────────────────
pub fn formation_mod(f: Formation) -> (f64, f64, f64) {
    match f {
        Formation::F442 => (0.0, 0.0, 0.0),
        Formation::F433 => (5.0, -2.0, -5.0),
        Formation::F352 => (-2.0, 5.0, -3.0),
        Formation::F4231 => (3.0, 3.0, -3.0),
    }
}

// ─── Mentality: (attack, defense) deltas ────────────────────────────────────
pub fn mentality_mod(m: Mentality) -> (f64, f64) {
    match m {
        Mentality::VeryDefensive => (-10.0, 10.0),
        Mentality::Defensive => (-5.0, 5.0),
        Mentality::Balanced => (0.0, 0.0),
        Mentality::Attacking => (5.0, -5.0),
        Mentality::VeryAttacking => (10.0, -10.0),
    }
}

// ─── Tempo: event-rate and stamina-drain multipliers ────────────────────────
pub fn tempo_event_factor(t: Tempo) -> f64 {
    match t {
        Tempo::Slow => 0.85,
        Tempo::Normal => 1.0,
        Tempo::Fast => 1.15,
    }
}

pub fn tempo_stamina_factor(t: Tempo) -> f64 {
    match t {
        Tempo::Slow => 0.85,
        Tempo::Normal => 1.0,
        Tempo::Fast => 1.25,
    }
}

// ─── Pressing: midfield disruption + own stamina drain ──────────────────────
pub fn pressing_disrupt(p: Pressing) -> f64 {
    match p {
        Pressing::Low => 0.0,
        Pressing::Medium => 3.0,
        Pressing::High => 6.0,
    }
}

pub fn pressing_stamina_factor(p: Pressing) -> f64 {
    match p {
        Pressing::Low => 0.85,
        Pressing::Medium => 1.0,
        Pressing::High => 1.25,
    }
}

pub fn pressing_foul_factor(p: Pressing) -> f64 {
    match p {
        Pressing::Low => 0.8,
        Pressing::Medium => 1.0,
        Pressing::High => 1.3,
    }
}

// ─── Width: shot quality multiplier ─────────────────────────────────────────
pub fn width_shot_factor(w: Width) -> f64 {
    match w {
        Width::Narrow => 0.97,
        Width::Normal => 1.0,
        Width::Wide => 1.03,
    }
}

// ─── Aggregate stats per team ───────────────────────────────────────────────
pub struct TeamStrength {
    pub attack: f64,
    pub midfield: f64,
    pub defense: f64,
}

/// Compute strength from per-player effective attributes (already
/// stamina-scaled by the caller) and the team's formation + tactics.
pub fn compose(
    effective: &[(Position, f64, f64, f64)], // (pos, attack_attr, mid_attr, def_attr)
    formation: Formation,
    mentality: Mentality,
    pressing_disrupt_on_opponent: f64, // applied by *opponent* — passed in by caller
) -> TeamStrength {
    let mut a_num = 0.0;
    let mut a_den = 0.0;
    let mut m_num = 0.0;
    let mut m_den = 0.0;
    let mut d_num = 0.0;
    let mut d_den = 0.0;

    for (pos, attack_attr, mid_attr, def_attr) in effective {
        let wa = pos_weight_attack(*pos);
        let wm = pos_weight_mid(*pos);
        let wd = pos_weight_defense(*pos);
        a_num += wa * attack_attr;
        a_den += wa;
        m_num += wm * mid_attr;
        m_den += wm;
        d_num += wd * def_attr;
        d_den += wd;
    }

    let (fa, fm, fd) = formation_mod(formation);
    let (ma, md) = mentality_mod(mentality);

    let attack = (a_num / a_den.max(1e-6)) + fa + ma;
    let midfield = (m_num / m_den.max(1e-6)) + fm - pressing_disrupt_on_opponent;
    let defense = (d_num / d_den.max(1e-6)) + fd + md;

    TeamStrength {
        attack,
        midfield,
        defense,
    }
}

/// Per-player attack/mid/defense raw scores from base attributes.
pub fn raw_player_stats(
    finishing: u8,
    technique: u8,
    pace: u8,
    passing: u8,
    defending: u8,
    stamina: u8,
) -> (f64, f64, f64) {
    let attack = ATTACK_W_FINISHING * finishing as f64
        + ATTACK_W_TECHNIQUE * technique as f64
        + ATTACK_W_PACE * pace as f64;
    let mid = MID_W_PASSING * passing as f64
        + MID_W_TECHNIQUE * technique as f64
        + MID_W_STAMINA * stamina as f64;
    let def = DEF_W_DEFENDING * defending as f64
        + DEF_W_PACE * pace as f64
        + DEF_W_STAMINA * stamina as f64;
    (attack, mid, def)
}
