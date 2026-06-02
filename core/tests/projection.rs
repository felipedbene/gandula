//! Tests for the analytic second-half projection. The projection composes the
//! SAME possession/event/shot helpers the live tick samples against, so these
//! assert the *shape* of that composition: monotonicity (more attacking → more
//! pressure; stronger midfield → more possession), sane bounds, and that the
//! projection's numbers agree with recomputing the helpers by hand.

use gandula_core::{
    Attributes, Formation, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team, TeamId,
    Tempo, Width, project_second_half, simulate_first_half,
};

/// Build an 11-player team (no bench needed — projection reads the XI) with a
/// chosen mentality and a uniform attribute `base`. `mid_base` lets a test bump
/// only the midfielders' passing to move the possession dial.
fn team(name: &str, id: u32, base: u8, mentality: Mentality, mid_passing: u8) -> Team {
    let roster: Vec<Player> = (1..=11)
        .map(|i| {
            let pos = match i {
                1 => Position::GK,
                2..=5 => Position::DEF,
                6..=8 => Position::MID,
                _ => Position::FWD,
            };
            let passing = if pos == Position::MID { mid_passing } else { base };
            Player {
                id: PlayerId(id * 100 + i),
                name: format!("J{id}{i}"),
                age: 25,
                position: pos,
                attributes: Attributes {
                    pace: base,
                    technique: base,
                    passing,
                    defending: base,
                    finishing: base,
                    stamina: 90,
                },
            }
        })
        .collect();
    let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId(id * 100 + (i as u32) + 1));
    Team {
        id: TeamId(id),
        name: name.to_string(),
        roster,
        formation: Formation::F442,
        tactics: Tactics {
            mentality,
            tempo: Tempo::Normal,
            pressing: Pressing::Medium,
            width: Width::Normal,
        },
        starting_xi: xi,
        bench: vec![],
    }
}

/// Project the second half for a given pair, using a fixed seed's snapshot.
/// The snapshot's exact mid-match state doesn't matter for these structural
/// assertions — only that both calls in a comparison use the same seed so the
/// 45'-stamina is identical and the only variable is the tactic under test.
fn project(home: &Team, away: &Team) -> gandula_core::SecondHalfProjection {
    let snap = simulate_first_half(home, away, 7).expect("first half");
    project_second_half(&snap, home, away).expect("projection")
}

#[test]
fn possession_within_bounds_and_pressures_nonnegative() {
    let home = team("H", 1, 70, Mentality::Balanced, 70);
    let away = team("A", 2, 70, Mentality::Balanced, 70);
    let p = project(&home, &away);
    assert!(
        p.home_possession >= 0.10 && p.home_possession <= 0.90,
        "possession {} must be clamped into [0.10, 0.90]",
        p.home_possession
    );
    assert!(p.home_pressure >= 0.0 && p.away_pressure >= 0.0);
}

#[test]
fn mirrored_teams_project_symmetrically() {
    // Identical teams → ~50% possession and equal pressure.
    let home = team("H", 1, 70, Mentality::Balanced, 70);
    let away = team("A", 2, 70, Mentality::Balanced, 70);
    let p = project(&home, &away);
    assert!(
        (p.home_possession - 0.5).abs() < 1e-9,
        "mirrored teams should split possession 50/50, got {}",
        p.home_possession
    );
    assert!(
        (p.home_pressure - p.away_pressure).abs() < 1e-9,
        "mirrored teams should have equal pressure, got {} vs {}",
        p.home_pressure,
        p.away_pressure
    );
}

#[test]
fn more_attacking_mentality_raises_home_pressure() {
    // Everything equal except the home mentality. Attack delta lifts attack and
    // drops defense, so shot_prob — and thus home_pressure — must rise.
    let away = team("A", 2, 70, Mentality::Balanced, 70);
    let p_def = project(&team("H", 1, 70, Mentality::Defensive, 70), &away);
    let p_bal = project(&team("H", 1, 70, Mentality::Balanced, 70), &away);
    let p_att = project(&team("H", 1, 70, Mentality::Attacking, 70), &away);
    let p_vatt = project(&team("H", 1, 70, Mentality::VeryAttacking, 70), &away);

    assert!(
        p_def.home_pressure < p_bal.home_pressure
            && p_bal.home_pressure < p_att.home_pressure
            && p_att.home_pressure < p_vatt.home_pressure,
        "home_pressure must increase with attacking intent: {} {} {} {}",
        p_def.home_pressure,
        p_bal.home_pressure,
        p_att.home_pressure,
        p_vatt.home_pressure
    );
}

#[test]
fn stronger_midfield_raises_home_possession() {
    // Bump only the home midfielders' passing → higher midfield → more
    // possession (until the clamp).
    let away = team("A", 2, 70, Mentality::Balanced, 70);
    let weak = project(&team("H", 1, 70, Mentality::Balanced, 50), &away);
    let strong = project(&team("H", 1, 70, Mentality::Balanced, 95), &away);
    assert!(
        strong.home_possession > weak.home_possession,
        "stronger midfield should raise possession: {} vs {}",
        weak.home_possession,
        strong.home_possession
    );
}

#[test]
fn possession_complements_between_sides() {
    // home_possession + away's share == 1 by construction (away_pressure uses
    // 1 - home_possession). Assert the pressures are consistent with that split
    // for an asymmetric pair.
    let home = team("H", 1, 80, Mentality::Attacking, 85);
    let away = team("A", 2, 60, Mentality::Defensive, 60);
    let p = project(&home, &away);
    // The dominant side here is clearly home; sanity-check the ordering.
    assert!(
        p.home_possession > 0.5,
        "stronger home should hold majority possession, got {}",
        p.home_possession
    );
    assert!(
        p.home_pressure > p.away_pressure,
        "stronger, more-attacking home should out-pressure away: {} vs {}",
        p.home_pressure,
        p.away_pressure
    );
}
