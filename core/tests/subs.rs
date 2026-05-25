//! Substitution rules: an exhausted FWD whose team has a fresh same-position
//! bench player should get subbed once the stamina rule's minute threshold
//! passes.

use gandula_core::{
    Attributes, Formation, MatchEventKind, Mentality, Player, PlayerId, Position, Pressing, Side,
    Tactics, Team, TeamId, Tempo, Width, simulate,
};

fn p(id: u32, position: Position, base: u8, stamina: u8) -> Player {
    Player {
        id: PlayerId(id),
        name: format!("P{id}"),
        age: 25,
        position,
        attributes: Attributes {
            pace: base,
            technique: base,
            passing: base,
            defending: base,
            finishing: base,
            stamina,
        },
    }
}

fn tired_attackers_team(team_id: u32, name: &str) -> Team {
    let mut roster: Vec<Player> = Vec::new();
    roster.push(p(team_id * 100 + 1, Position::GK, 70, 90));
    for i in 2..=5 {
        roster.push(p(team_id * 100 + i, Position::DEF, 70, 90));
    }
    for i in 6..=8 {
        roster.push(p(team_id * 100 + i, Position::MID, 70, 90));
    }
    for i in 9..=11 {
        // Three exhausted FWDs.
        roster.push(p(team_id * 100 + i, Position::FWD, 70, 30));
    }
    // Fresh bench FWD.
    roster.push(p(team_id * 100 + 12, Position::FWD, 70, 95));

    let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId(team_id * 100 + (i as u32) + 1));
    Team {
        id: TeamId(team_id),
        name: name.to_string(),
        roster,
        formation: Formation::F442,
        tactics: Tactics {
            mentality: Mentality::Balanced,
            tempo: Tempo::Normal,
            pressing: Pressing::Medium,
            width: Width::Normal,
        },
        starting_xi: xi,
        bench: vec![PlayerId(team_id * 100 + 12)],
    }
}

fn no_bench_team(team_id: u32, name: &str) -> Team {
    let roster: Vec<Player> = (1..=11)
        .map(|i| {
            p(
                team_id * 100 + i,
                match i {
                    1 => Position::GK,
                    2..=5 => Position::DEF,
                    6..=8 => Position::MID,
                    _ => Position::FWD,
                },
                65,
                80,
            )
        })
        .collect();
    let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId(team_id * 100 + (i as u32) + 1));
    Team {
        id: TeamId(team_id),
        name: name.to_string(),
        roster,
        formation: Formation::F442,
        tactics: Tactics {
            mentality: Mentality::Balanced,
            tempo: Tempo::Normal,
            pressing: Pressing::Medium,
            width: Width::Normal,
        },
        starting_xi: xi,
        bench: vec![],
    }
}

#[test]
fn tired_forward_gets_subbed_when_fresh_bench_available() {
    let home = tired_attackers_team(1, "Home");
    let away = no_bench_team(2, "Away");
    let m = simulate(&home, &away, 1).expect("sim");

    let home_subs = m
        .events
        .iter()
        .filter(|e| {
            matches!(e.kind, MatchEventKind::Substitution { .. }) && e.side == Some(Side::Home)
        })
        .count();
    assert!(
        home_subs >= 1,
        "expected at least one Home substitution, got {home_subs}"
    );
}

#[test]
fn empty_bench_means_no_subs() {
    let home = no_bench_team(1, "Home");
    let away = no_bench_team(2, "Away");
    let m = simulate(&home, &away, 1).expect("sim");

    let subs = m
        .events
        .iter()
        .filter(|e| matches!(e.kind, MatchEventKind::Substitution { .. }))
        .count();
    assert_eq!(subs, 0, "no bench should mean no subs, got {subs}");
}
