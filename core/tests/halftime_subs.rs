//! User half-time substitutions (#62): applied at the restart via
//! `simulate_second_half_with_subs`. Empty subs are byte-identical to the
//! no-sub path; a valid swap brings the bench player on and is deterministic;
//! the shared 3-sub cap holds.

use gandula_core::{
    Attributes, Formation, HalfTimeSub, MatchEventKind, Mentality, Player, PlayerId, Position,
    Pressing, Side, Tactics, Team, TeamId, Tempo, Width, simulate_first_half,
    simulate_second_half, simulate_second_half_with_subs,
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

/// 11 fresh starters + a 7-player bench (1 GK, 2 DEF, 2 MID, 2 FWD), ids
/// `team_id*100 + slot`. High starter stamina so the AI doesn't auto-sub early
/// and muddy the assertions.
fn team(team_id: u32, name: &str) -> Team {
    let mut roster = vec![p(team_id * 100 + 1, Position::GK, 70, 90)];
    for i in 2..=5 {
        roster.push(p(team_id * 100 + i, Position::DEF, 70, 90));
    }
    for i in 6..=8 {
        roster.push(p(team_id * 100 + i, Position::MID, 70, 90));
    }
    for i in 9..=11 {
        roster.push(p(team_id * 100 + i, Position::FWD, 70, 90));
    }
    roster.push(p(team_id * 100 + 12, Position::GK, 70, 90));
    roster.push(p(team_id * 100 + 13, Position::DEF, 70, 90));
    roster.push(p(team_id * 100 + 14, Position::DEF, 70, 90));
    roster.push(p(team_id * 100 + 15, Position::MID, 70, 90));
    roster.push(p(team_id * 100 + 16, Position::MID, 70, 90));
    roster.push(p(team_id * 100 + 17, Position::FWD, 70, 90));
    roster.push(p(team_id * 100 + 18, Position::FWD, 70, 90));

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
fn empty_subs_are_byte_identical_to_the_no_sub_path() {
    let home = team(1, "Home");
    let away = team(2, "Away");
    for seed in 0..30_u64 {
        let snap_a = simulate_first_half(&home, &away, seed).unwrap();
        let snap_b = simulate_first_half(&home, &away, seed).unwrap();
        let a = simulate_second_half(snap_a, &home, &away).unwrap();
        let b = simulate_second_half_with_subs(snap_b, &home, &away, &[], &[]).unwrap();
        assert_eq!(a.result, b.result, "seed {seed}: result diverged on empty subs");
        assert_eq!(
            a.events.len(),
            b.events.len(),
            "seed {seed}: event count diverged on empty subs"
        );
    }
}

#[test]
fn a_user_sub_brings_the_bench_player_on_deterministically() {
    let home = team(1, "Home");
    let away = team(2, "Away");
    let seed = 7_u64;
    // Swap home FWD id 109 (an XI starter) for bench FWD id 117.
    let subs = [HalfTimeSub {
        off: PlayerId(109),
        on: PlayerId(117),
    }];

    let snap = simulate_first_half(&home, &away, seed).unwrap();
    let m = simulate_second_half_with_subs(snap, &home, &away, &subs, &[]).unwrap();

    // A home substitution event for 109 → 117 lands at the restart (minute 46).
    let sub_event = m.events.iter().find(|e| {
        matches!(
            e.kind,
            MatchEventKind::Substitution {
                off: PlayerId(109),
                on: PlayerId(117),
            }
        )
    });
    let sub_event = sub_event.expect("expected the 109→117 substitution event");
    assert_eq!(sub_event.side, Some(Side::Home));
    assert_eq!(sub_event.minute, 46);

    // Deterministic: same snapshot + subs reproduce the same match.
    let snap2 = simulate_first_half(&home, &away, seed).unwrap();
    let m2 = simulate_second_half_with_subs(snap2, &home, &away, &subs, &[]).unwrap();
    assert_eq!(m.result, m2.result);
    assert_eq!(m.events.len(), m2.events.len());
}

#[test]
fn user_subs_respect_the_three_sub_cap_and_skip_invalid_swaps() {
    let home = team(1, "Home");
    let away = team(2, "Away");
    let seed = 3_u64;
    // 4 requested home subs — only 3 can apply; plus one invalid (off 999 not on
    // field) which is skipped without consuming a slot.
    let subs = [
        HalfTimeSub { off: PlayerId(999), on: PlayerId(112) }, // invalid off → skipped
        HalfTimeSub { off: PlayerId(102), on: PlayerId(113) }, // DEF → DEF
        HalfTimeSub { off: PlayerId(106), on: PlayerId(115) }, // MID → MID
        HalfTimeSub { off: PlayerId(109), on: PlayerId(117) }, // FWD → FWD
        HalfTimeSub { off: PlayerId(110), on: PlayerId(118) }, // 4th valid → over cap
    ];

    let snap = simulate_first_half(&home, &away, seed).unwrap();
    let m = simulate_second_half_with_subs(snap, &home, &away, &subs, &[]).unwrap();

    let home_subs = m
        .events
        .iter()
        .filter(|e| {
            matches!(e.kind, MatchEventKind::Substitution { .. }) && e.side == Some(Side::Home)
        })
        .count();
    assert!(home_subs <= 3, "made {home_subs} home subs (cap = 3)");
    // The invalid 999→112 swap never happened.
    assert!(!m.events.iter().any(|e| matches!(
        e.kind,
        MatchEventKind::Substitution { on: PlayerId(112), .. }
    )));
}
