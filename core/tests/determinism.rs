//! Determinism guarantee: same seed + identical inputs → byte-identical match.

use gandula_core::{
    Attributes, Formation, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team, TeamId,
    Tempo, Width, simulate,
};

fn test_team(name: &str, team_id: u32, base: u8) -> Team {
    let roster: Vec<Player> = (1..=11)
        .map(|i| Player {
            id: PlayerId(team_id * 100 + i),
            name: format!("J{}{}", team_id, i),
            age: 25,
            position: match i {
                1 => Position::GK,
                2..=5 => Position::DEF,
                6..=8 => Position::MID,
                _ => Position::FWD,
            },
            attributes: Attributes {
                pace: base,
                technique: base,
                passing: base,
                defending: base,
                finishing: base,
                stamina: 90,
            },
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
fn same_seed_same_match() {
    let home = test_team("Home", 1, 70);
    let away = test_team("Away", 2, 60);
    let m1 = simulate(&home, &away, 42).expect("first sim");
    let m2 = simulate(&home, &away, 42).expect("second sim");
    let s1 = serde_json::to_string(&m1).expect("ser m1");
    let s2 = serde_json::to_string(&m2).expect("ser m2");
    assert_eq!(s1, s2, "same seed must yield identical match");
}

#[test]
fn different_seeds_diverge() {
    let home = test_team("Home", 1, 70);
    let away = test_team("Away", 2, 60);
    let m1 = simulate(&home, &away, 1).expect("sim s1");
    let m2 = simulate(&home, &away, 2).expect("sim s2");
    let s1 = serde_json::to_string(&m1).expect("ser m1");
    let s2 = serde_json::to_string(&m2).expect("ser m2");
    assert_ne!(s1, s2, "different seeds should diverge");
}
