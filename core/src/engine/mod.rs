mod manager;
mod strength;
mod tick;

use crate::domain::{Match, MatchEvent, MatchEventKind, Team};
use crate::error::GandulaError;
use crate::rng::MatchRng;

use tick::MatchState;

/// Simulate a single match end-to-end. Pure function of `(home, away, seed)` —
/// identical inputs produce a byte-identical `Match`.
pub fn simulate(home: &Team, away: &Team, seed: u64) -> Result<Match, GandulaError> {
    home.validate()?;
    away.validate()?;

    let mut rng = MatchRng::new(seed);
    let mut state = MatchState::new(home, away);

    for minute in 1..=45 {
        tick::tick(&mut state, &mut rng, minute);
        manager::run_managers(&mut state, minute);
    }
    let half_text = format!(
        "45' Fim do primeiro tempo. {} {}x{} {}.",
        state.home.name, state.home_goals, state.away_goals, state.away.name
    );
    state.events.push(MatchEvent {
        minute: 45,
        side: None,
        kind: MatchEventKind::HalfTime,
        text: half_text,
    });

    for minute in 46..=90 {
        tick::tick(&mut state, &mut rng, minute);
        manager::run_managers(&mut state, minute);
    }

    // 0..=4 minutes of injury time at the end of the second half.
    let injury = rng.range_u32(0, 5) as u16;
    for i in 1..=injury {
        tick::tick(&mut state, &mut rng, 90 + i);
        manager::run_managers(&mut state, 90 + i);
    }

    let final_minute: u16 = 90 + injury;
    let full_text = format!(
        "{}' Fim de jogo. {} {}x{} {}.",
        final_minute, state.home.name, state.home_goals, state.away_goals, state.away.name
    );
    state.events.push(MatchEvent {
        minute: final_minute,
        side: None,
        kind: MatchEventKind::FullTime,
        text: full_text,
    });

    Ok(state.into_match(seed))
}
