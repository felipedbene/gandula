//! C0 — Performance baseline for a 20-team double round-robin season.
//!
//! Throwaway benchmark, packaged as an ignored integration test so cargo's
//! auto-discovery picks it up. Run explicitly with:
//!
//!     cargo test --release -p gandula-core --test bench_20_teams -- --ignored --nocapture
//!
//! Answers: "does 380-match season finish fast enough to drive a per-round
//! Elifoot UI, and is the serialized SeasonRecord small enough for IndexedDB?"
//!
//! Decision thresholds (see docs/fio-c-rodada/STATE.md):
//!   - <500ms total and <5MB JSON → green, proceed to C1
//!   - 500ms-2s, or 5-15MB       → yellow, consider optimization
//!   - >2s or >15MB              → red, optimize before C1

use std::time::Instant;

use gandula_core::{
    Attributes, Formation, League, Mentality, Player, PlayerId, Position, Pressing, Tactics, Team,
    TeamId, Tempo, Width, simulate_season,
};

/// Build a synthetic 11-man squad + 6-man bench with all attributes set to
/// `base`. Mirrors the helper used across `core/tests/*` but adds a bench so
/// substitutions actually fire (more representative of real play).
fn make_team(team_id: u32, name: &str, base: u8) -> Team {
    let roster: Vec<Player> = (1..=17)
        .map(|i| Player {
            id: PlayerId(team_id * 100 + i),
            name: format!("P{team_id}_{i}"),
            age: 25,
            position: match i {
                1 => Position::GK,
                2..=5 => Position::DEF,
                6..=8 => Position::MID,
                9..=11 => Position::FWD,
                12 => Position::GK,
                13..=14 => Position::DEF,
                15 => Position::MID,
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
    let bench: Vec<PlayerId> = (12..=17).map(|i| PlayerId(team_id * 100 + i)).collect();
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
        bench,
    }
}

#[test]
#[ignore = "performance benchmark — run explicitly with --ignored"]
fn bench_20_team_season() {
    // Gradient from 80 down to 42 in steps of 2 — realistic strength spread,
    // not 20 identical teams (which would produce draw-heavy seasons with
    // artificially short event logs).
    let teams: Vec<Team> = (0..20)
        .map(|i| {
            let base = 80u8.saturating_sub((i as u8) * 2);
            make_team((i as u32) + 1, &format!("Time{:02}", i + 1), base)
        })
        .collect();

    let league = League {
        name: "Brasileirão Imaginário (bench)".to_string(),
        teams,
    };

    // Warm up the simulator once (excluded from measurement) so any
    // one-time allocator / page-fault cost doesn't pollute the headline.
    let _ = simulate_season(&league, 1).expect("warmup");

    // Measured run.
    let start = Instant::now();
    let record = simulate_season(&league, 1998).expect("sim");
    let elapsed = start.elapsed();

    // Serialize to JSON — what would land in IndexedDB on the web side.
    let ser_start = Instant::now();
    let json = serde_json::to_string(&record).expect("serialize");
    let ser_elapsed = ser_start.elapsed();

    // Per-match stats.
    let n_matches = record.matches.len();
    let total_events: usize = record.matches.iter().map(|m| m.events.len()).sum();
    let avg_events = total_events as f64 / n_matches as f64;
    let max_events = record
        .matches
        .iter()
        .map(|m| m.events.len())
        .max()
        .unwrap_or(0);

    println!();
    println!("=== C0 baseline: 20-team double round-robin ===");
    println!();
    println!("Fixtures:           {}", record.fixtures.len());
    println!("Matches simulated:  {}", n_matches);
    println!("Total events:       {}", total_events);
    println!("Avg events/match:   {:.1}", avg_events);
    println!("Max events/match:   {}", max_events);
    println!();
    println!("Simulation time:    {:?}", elapsed);
    println!("Serialization:      {:?}", ser_elapsed);
    println!(
        "JSON size:          {} bytes ({:.2} MB)",
        json.len(),
        json.len() as f64 / 1_048_576.0
    );
    println!();

    // Per-round cost projection — what matters for the Elifoot UX where
    // we'd simulate one round (10 matches) at a time, not the whole season.
    let per_match_ms = elapsed.as_secs_f64() * 1000.0 / n_matches as f64;
    let per_round_ms = per_match_ms * 10.0; // 10 matches per round in a 20-team league
    println!("Per-match cost:     {:.2} ms", per_match_ms);
    println!("Per-round cost:     {:.2} ms (10 matches)", per_round_ms);
    println!();

    // Quick traffic-light verdict.
    let total_ms = elapsed.as_millis();
    let mb = json.len() as f64 / 1_048_576.0;
    let verdict = match (total_ms, mb) {
        (t, m) if t < 500 && m < 5.0 => "🟢 GREEN — proceed to C1",
        (t, m) if t < 2000 && m < 15.0 => "🟡 YELLOW — consider optimization before C1",
        _ => "🔴 RED — optimize before C1",
    };
    println!("Verdict: {}", verdict);
    println!();
}
