//! Statistical sanity at the season level: with a clear strength gap, the
//! strongest team should finish first in well over half the seeded seasons.

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
fn strongest_team_finishes_first_in_most_seasons() {
    let strong_id = TeamId(1);
    let league = League {
        name: "Brasileirão de Teste".to_string(),
        teams: vec![
            team(1, "Forte", 82),
            team(2, "Médio", 65),
            team(3, "Fraco", 50),
        ],
    };

    let trials = 30;
    let mut strong_first = 0;
    for seed in 0..trials {
        let record = simulate_season(&league, seed).expect("sim");
        if record.standings[0].team_id == strong_id {
            strong_first += 1;
        }
    }
    assert!(
        strong_first > 21, // > 70% of 30
        "expected strong team to finish 1st in >70% of {trials} seasons, got {strong_first}"
    );
}
