//! Season layer — sits on top of `engine::simulate`.
//!
//! A `League` is just a name + a list of `Team`s. `simulate_season` generates
//! a double round-robin schedule (circle method, with a virtual BYE for odd
//! team counts), simulates each fixture deterministically, and assembles the
//! standings.
//!
//! Determinism: identical `(league, seed)` → byte-identical `SeasonRecord`.
//! Each match gets its own seed derived from the season seed and the fixture
//! index, so changing the order of fixtures changes the matches.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::domain::{Match, Team, TeamId};
use crate::engine::simulate;
use crate::error::GandulaError;

// ─── Public types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct League {
    pub name: String,
    pub teams: Vec<Team>,
}

impl League {
    pub fn validate(&self) -> Result<(), GandulaError> {
        if self.teams.len() < 2 {
            return Err(GandulaError::TooFewTeams(self.teams.len()));
        }
        let mut seen: HashSet<TeamId> = HashSet::new();
        for team in &self.teams {
            if !seen.insert(team.id) {
                return Err(GandulaError::DuplicateTeamId(team.id));
            }
            team.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Fixture {
    /// Zero-based round number.
    pub round: u16,
    /// Index into `League.teams`.
    pub home_idx: usize,
    /// Index into `League.teams`.
    pub away_idx: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TeamStats {
    pub team_id: TeamId,
    pub played: u16,
    pub won: u16,
    pub drawn: u16,
    pub lost: u16,
    pub goals_for: u16,
    pub goals_against: u16,
}

impl TeamStats {
    pub fn goal_difference(&self) -> i32 {
        self.goals_for as i32 - self.goals_against as i32
    }

    /// 3 points for a win, 1 for a draw — modern CBF rules.
    pub fn points(&self) -> u16 {
        self.won * 3 + self.drawn
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonRecord {
    pub league_name: String,
    pub fixtures: Vec<Fixture>,
    /// One per fixture, same order. Full event logs are kept — cheap for the
    /// small leagues Phase 3 ships with; we'll revisit when persistence lands.
    pub matches: Vec<Match>,
    /// Sorted: Pts desc, GD desc, GF desc, finally team_id asc for stability.
    pub standings: Vec<TeamStats>,
}

// ─── Public entry point ─────────────────────────────────────────────────────

pub fn simulate_season(league: &League, seed: u64) -> Result<SeasonRecord, GandulaError> {
    league.validate()?;

    let fixtures = generate_fixtures(league.teams.len());
    let mut matches: Vec<Match> = Vec::with_capacity(fixtures.len());
    for (idx, fixture) in fixtures.iter().enumerate() {
        let home = &league.teams[fixture.home_idx];
        let away = &league.teams[fixture.away_idx];
        let m_seed = match_seed(seed, idx as u32);
        let m = simulate(home, away, m_seed)?;
        matches.push(m);
    }

    let standings = compute_standings(league, &matches);

    Ok(SeasonRecord {
        league_name: league.name.clone(),
        fixtures,
        matches,
        standings,
    })
}

// ─── Fixture generation: circle method, double round-robin ──────────────────

/// Round-robin schedule via the classic circle method. For odd team counts an
/// internal BYE slot is inserted; fixtures involving the BYE are dropped, so
/// one team rests each round.
///
/// Output ordering: rounds in ascending order, fixtures within a round in the
/// order produced by the algorithm. Deterministic.
fn generate_fixtures(n_teams: usize) -> Vec<Fixture> {
    if n_teams < 2 {
        return Vec::new();
    }

    // Make the working size even; BYE = `n_teams` (an index that isn't a real
    // team, so any fixture touching it gets filtered out).
    let effective = if n_teams.is_multiple_of(2) {
        n_teams
    } else {
        n_teams + 1
    };
    let bye = n_teams; // first invalid team index
    let rounds_per_half = effective - 1;
    let mut positions: Vec<usize> = (0..effective).collect();
    let mut fixtures: Vec<Fixture> = Vec::new();

    for round in 0..rounds_per_half {
        for i in 0..(effective / 2) {
            let a = positions[i];
            let b = positions[effective - 1 - i];
            // Alternate home/away within the round and across rounds — over
            // the full season this evens out to equal home games per team.
            let (home, away) = if (i + round).is_multiple_of(2) {
                (a, b)
            } else {
                (b, a)
            };
            if home == bye || away == bye {
                continue;
            }
            fixtures.push(Fixture {
                round: round as u16,
                home_idx: home,
                away_idx: away,
            });
        }
        // Circle rotation: keep position 0 fixed, slide last → position 1.
        if effective >= 3 {
            let last = positions[effective - 1];
            for i in (2..effective).rev() {
                positions[i] = positions[i - 1];
            }
            positions[1] = last;
        }
    }

    // Second half: flip home/away, offset round numbers.
    let first_half_len = fixtures.len();
    for i in 0..first_half_len {
        let f = fixtures[i];
        fixtures.push(Fixture {
            round: f.round + rounds_per_half as u16,
            home_idx: f.away_idx,
            away_idx: f.home_idx,
        });
    }

    fixtures
}

// ─── Per-match seed derivation ──────────────────────────────────────────────
//
// Deterministic, fixture-unique. Same season_seed + same fixture index always
// gives the same match seed. Changing the order of fixtures (e.g., adding a
// team) reshuffles the matches.
pub fn match_seed(season_seed: u64, fixture_idx: u32) -> u64 {
    let mut s = season_seed.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    s = s.wrapping_add((fixture_idx as u64).wrapping_mul(0xD1B5_4A32_D192_ED03));
    s.wrapping_mul(0xC6BC_2796_92B5_C323)
}

// ─── Standings ──────────────────────────────────────────────────────────────

fn compute_standings(league: &League, matches: &[Match]) -> Vec<TeamStats> {
    let mut stats: Vec<TeamStats> = league
        .teams
        .iter()
        .map(|t| TeamStats {
            team_id: t.id,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goals_for: 0,
            goals_against: 0,
        })
        .collect();

    let index_of = |team_id: TeamId| -> Option<usize> {
        league.teams.iter().position(|t| t.id == team_id)
    };

    for m in matches {
        let Some(home_idx) = index_of(m.home) else {
            continue;
        };
        let Some(away_idx) = index_of(m.away) else {
            continue;
        };
        let hg = m.result.home_goals as u16;
        let ag = m.result.away_goals as u16;

        let home = &mut stats[home_idx];
        home.played += 1;
        home.goals_for += hg;
        home.goals_against += ag;
        if hg > ag {
            home.won += 1;
        } else if hg < ag {
            home.lost += 1;
        } else {
            home.drawn += 1;
        }

        let away = &mut stats[away_idx];
        away.played += 1;
        away.goals_for += ag;
        away.goals_against += hg;
        if ag > hg {
            away.won += 1;
        } else if ag < hg {
            away.lost += 1;
        } else {
            away.drawn += 1;
        }
    }

    // Sort: Pts desc, GD desc, GF desc, then team_id asc to make ties stable.
    stats.sort_by(|a, b| {
        b.points()
            .cmp(&a.points())
            .then_with(|| b.goal_difference().cmp(&a.goal_difference()))
            .then_with(|| b.goals_for.cmp(&a.goals_for))
            .then_with(|| a.team_id.0.cmp(&b.team_id.0))
    });
    stats
}

// ─── Tests for pure helpers ─────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixtures_for_two_teams_is_two_matches() {
        let fx = generate_fixtures(2);
        assert_eq!(fx.len(), 2);
        // Home/away should flip.
        assert_eq!(fx[0].home_idx, 0);
        assert_eq!(fx[0].away_idx, 1);
        assert_eq!(fx[1].home_idx, 1);
        assert_eq!(fx[1].away_idx, 0);
    }

    #[test]
    fn fixtures_for_three_teams_is_six_matches() {
        let fx = generate_fixtures(3);
        assert_eq!(fx.len(), 6);
        // No team plays itself.
        for f in &fx {
            assert_ne!(f.home_idx, f.away_idx);
            assert!(f.home_idx < 3);
            assert!(f.away_idx < 3);
        }
    }

    #[test]
    fn match_seed_is_deterministic_and_varies() {
        let s = 42;
        assert_eq!(match_seed(s, 0), match_seed(s, 0));
        assert_ne!(match_seed(s, 0), match_seed(s, 1));
        assert_ne!(match_seed(s, 0), match_seed(s + 1, 0));
    }
}
