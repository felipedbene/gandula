//! Statistical sanity: a meaningfully stronger team should beat a weaker one
//! in clearly more than half of seeded matches.

use gandula_core::{
    Attributes, Formation, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team, TeamId,
    Tempo, Width, simulate,
};

fn team(name: &str, team_id: u32, base: u8) -> Team {
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
fn stronger_team_wins_majority() {
    let strong = team("Forte", 1, 82);
    let weak = team("Fraco", 2, 50);

    let trials = 100;
    let mut strong_wins = 0;
    let mut draws = 0;
    let mut weak_wins = 0;
    for seed in 0..trials {
        let m = simulate(&strong, &weak, seed).expect("sim");
        if m.result.home_goals > m.result.away_goals {
            strong_wins += 1;
        } else if m.result.home_goals < m.result.away_goals {
            weak_wins += 1;
        } else {
            draws += 1;
        }
    }
    assert!(
        strong_wins > 70,
        "expected strong > 70/{}, got strong={} draws={} weak={}",
        trials,
        strong_wins,
        draws,
        weak_wins
    );
}
