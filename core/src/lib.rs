pub mod domain;
pub mod engine;
pub mod error;
pub mod rng;
pub mod season;

pub use domain::{
    Attributes, Formation, Match, MatchEvent, MatchEventKind, MatchResult, Mentality, Player,
    PlayerId, Position, Pressing, Side, Tactics, Team, TeamId, Tempo, Width,
};
pub use engine::simulate;
pub use error::GandulaError;
pub use season::{Fixture, League, SeasonRecord, TeamStats, match_seed, simulate_season};
