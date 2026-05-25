//! Fixture invariant: each ordered (home, away) pair appears exactly once;
//! each unordered pair plays exactly twice. No team plays itself.

use std::collections::HashMap;

use gandula_core::{
    Attributes, Formation, League, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team,
    TeamId, Tempo, Width, simulate_season,
};

fn team(team_id: u32, name: &str) -> Team {
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
                pace: 70,
                technique: 70,
                passing: 70,
                defending: 70,
                finishing: 70,
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

fn check_double_round_robin(n: usize) {
    let teams: Vec<Team> = (1..=n as u32).map(|i| team(i, &format!("T{i}"))).collect();
    let league = League {
        name: format!("Liga{n}"),
        teams,
    };
    let record = simulate_season(&league, 1).expect("sim");

    // Every team plays (n - 1) home + (n - 1) away = 2(n-1) matches total.
    let expected_fixtures = n * (n - 1);
    assert_eq!(
        record.fixtures.len(),
        expected_fixtures,
        "N={n}: expected {expected_fixtures} fixtures, got {}",
        record.fixtures.len()
    );

    // Tally ordered and unordered pairs.
    let mut ordered: HashMap<(usize, usize), u32> = HashMap::new();
    let mut unordered: HashMap<(usize, usize), u32> = HashMap::new();
    for f in &record.fixtures {
        assert_ne!(f.home_idx, f.away_idx, "team plays itself");
        assert!(f.home_idx < n);
        assert!(f.away_idx < n);
        *ordered.entry((f.home_idx, f.away_idx)).or_default() += 1;
        let lo = f.home_idx.min(f.away_idx);
        let hi = f.home_idx.max(f.away_idx);
        *unordered.entry((lo, hi)).or_default() += 1;
    }

    let expected_unordered = n * (n - 1) / 2;
    assert_eq!(
        unordered.len(),
        expected_unordered,
        "N={n}: expected {expected_unordered} unordered pairs, got {}",
        unordered.len()
    );
    for (pair, count) in &unordered {
        assert_eq!(*count, 2, "N={n}: pair {pair:?} should play 2x, got {count}");
    }
    for (pair, count) in &ordered {
        assert_eq!(
            *count, 1,
            "N={n}: ordered fixture {pair:?} should appear 1x, got {count}"
        );
    }
}

#[test]
fn n2_round_robin() {
    check_double_round_robin(2);
}

#[test]
fn n3_round_robin() {
    check_double_round_robin(3);
}

#[test]
fn n4_round_robin() {
    check_double_round_robin(4);
}

#[test]
fn n5_round_robin() {
    check_double_round_robin(5);
}

#[test]
fn n6_round_robin() {
    check_double_round_robin(6);
}
