use crate::domain::{PlayerId, TeamId};

#[derive(Debug, thiserror::Error)]
pub enum GandulaError {
    #[error("league must have at least 2 teams, got {0}")]
    TooFewTeams(usize),

    #[error("duplicate team id in league: {0:?}")]
    DuplicateTeamId(TeamId),

    #[error("attribute out of range: {field} = {value} (must be 1..=99)")]
    AttributeOutOfRange { field: &'static str, value: u8 },

    #[error("player age out of range: {0} (must be 15..=50)")]
    AgeOutOfRange(u8),

    #[error("starting XI references player {0:?} not in roster")]
    UnknownPlayerInXI(PlayerId),

    #[error("starting XI must have exactly 11 unique players, got {0} unique entries")]
    InvalidXI(usize),

    #[error("bench too large: {count} (max {max})")]
    BenchTooLarge { count: usize, max: usize },

    #[error("duplicate player in bench")]
    DuplicateInBench,

    #[error("player {0:?} appears in both starting XI and bench")]
    PlayerInBothXIAndBench(PlayerId),

    #[error("bench references player {0:?} not in roster")]
    UnknownPlayerInBench(PlayerId),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}
