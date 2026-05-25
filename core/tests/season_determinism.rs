//! Season-level determinism: same `(League, seed)` → byte-identical record.

use gandula_core::{
    Attributes, Formation, League, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team,
    TeamId, Tempo, Width, simulate_season,
};

fn team(team_id: u32, name: &str, base: u8) -> Team {
    let roster: Vec<Player> = (1..=11)
        .map(|i| Player {
            id: PlayerId(team_id * 100 + i),
            name: format!("P{team_id}_{i}"),
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
                stamina: 85,
            },
        })
        .collect();
    let starting_xi: [PlayerId; 11] =
        std::array::from_fn(|i| PlayerId(team_id * 100 + (i as u32) + 1));
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
        starting_xi,
        bench: vec![],
    }
}

#[test]
fn same_seed_same_season() {
    let league = League {
        name: "Liga Teste".to_string(),
        teams: vec![
            team(1, "A", 75),
            team(2, "B", 70),
            team(3, "C", 65),
            team(4, "D", 60),
        ],
    };
    let s1 = simulate_season(&league, 42).expect("sim 1");
    let s2 = simulate_season(&league, 42).expect("sim 2");
    let j1 = serde_json::to_string(&s1).expect("ser 1");
    let j2 = serde_json::to_string(&s2).expect("ser 2");
    assert_eq!(j1, j2, "same seed must yield identical SeasonRecord");
}

#[test]
fn different_seeds_diverge() {
    let league = League {
        name: "Liga Teste".to_string(),
        teams: vec![team(1, "A", 70), team(2, "B", 70), team(3, "C", 70)],
    };
    let s1 = simulate_season(&league, 1).expect("sim 1");
    let s2 = simulate_season(&league, 2).expect("sim 2");
    let j1 = serde_json::to_string(&s1).expect("ser 1");
    let j2 = serde_json::to_string(&s2).expect("ser 2");
    assert_ne!(j1, j2, "different seeds should produce different seasons");
}
