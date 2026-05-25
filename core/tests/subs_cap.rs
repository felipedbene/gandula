//! Substitution cap: no team makes more than 3 subs in a match, even when
//! every player is exhausted and the bench is full of fresh players.

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

/// Eleven exhausted starters + 7 fresh bench players.
fn exhausted_starters_full_bench(team_id: u32, name: &str) -> Team {
    let mut roster: Vec<Player> = Vec::new();

    // Starters — all near-empty stamina (35).
    roster.push(p(team_id * 100 + 1, Position::GK, 70, 40));
    for i in 2..=5 {
        roster.push(p(team_id * 100 + i, Position::DEF, 70, 35));
    }
    for i in 6..=8 {
        roster.push(p(team_id * 100 + i, Position::MID, 70, 35));
    }
    for i in 9..=11 {
        roster.push(p(team_id * 100 + i, Position::FWD, 70, 35));
    }

    // 7 fresh bench players: 1 GK, 2 DEF, 2 MID, 2 FWD.
    roster.push(p(team_id * 100 + 12, Position::GK, 70, 95));
    roster.push(p(team_id * 100 + 13, Position::DEF, 70, 95));
    roster.push(p(team_id * 100 + 14, Position::DEF, 70, 95));
    roster.push(p(team_id * 100 + 15, Position::MID, 70, 95));
    roster.push(p(team_id * 100 + 16, Position::MID, 70, 95));
    roster.push(p(team_id * 100 + 17, Position::FWD, 70, 95));
    roster.push(p(team_id * 100 + 18, Position::FWD, 70, 95));

    let xi: [PlayerId; 11] = std::array::from_fn(|i| PlayerId(team_id * 100 + (i as u32) + 1));
    let bench: Vec<PlayerId> = (12..=18).map(|i| PlayerId(team_id * 100 + i)).collect();
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
        bench,
    }
}

#[test]
fn never_more_than_three_subs_per_team() {
    let home = exhausted_starters_full_bench(1, "Home");
    let away = exhausted_starters_full_bench(2, "Away");

    for seed in 0..50_u64 {
        let m = simulate(&home, &away, seed).expect("sim");
        let mut home_subs = 0_u32;
        let mut away_subs = 0_u32;
        for e in &m.events {
            if matches!(e.kind, MatchEventKind::Substitution { .. }) {
                match e.side {
                    Some(Side::Home) => home_subs += 1,
                    Some(Side::Away) => away_subs += 1,
                    None => {}
                }
            }
        }
        assert!(
            home_subs <= 3,
            "seed {seed}: home made {home_subs} subs (cap = 3)"
        );
        assert!(
            away_subs <= 3,
            "seed {seed}: away made {away_subs} subs (cap = 3)"
        );
    }
}
