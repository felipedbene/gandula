use serde::{Deserialize, Serialize};

use crate::domain::player::PlayerId;
use crate::domain::team::TeamId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    Home,
    Away,
}

impl Side {
    pub fn flip(self) -> Self {
        match self {
            Side::Home => Side::Away,
            Side::Away => Side::Home,
        }
    }
}

/// Kind of near-miss. Carries no score or card impact; purely narrative
/// flavour. Kept separate from `Shot` so the UI / stats layer can distinguish
/// a forgettable wide shot from a "carimbou a trave" beat without parsing the
/// narration string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NearMissKind {
    /// Bola na trave (post).
    Post,
    /// Bola no travessão (crossbar).
    Crossbar,
    /// Passou raspando — ball goes just wide.
    JustWide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchEventKind {
    Shot {
        shooter: PlayerId,
        on_target: bool,
    },
    Goal {
        scorer: PlayerId,
        assist: Option<PlayerId>,
    },
    Foul {
        offender: PlayerId,
        victim: PlayerId,
    },
    YellowCard {
        player: PlayerId,
    },
    RedCard {
        player: PlayerId,
    },
    Substitution {
        off: PlayerId,
        on: PlayerId,
    },
    /// Referee has pointed to the spot — taker named, no outcome yet. Always
    /// paired with either a `Goal` or a `PenaltyMissed` event one tick later.
    PenaltyAwarded {
        taker: PlayerId,
    },
    /// Penalty kick taken but didn't result in a goal — either saved or off
    /// target. The narration string distinguishes which; the data model keeps
    /// them merged because no consumer needs to branch on the difference yet.
    PenaltyMissed {
        taker: PlayerId,
    },
    /// "Almost" moment — shot hit the woodwork or went just wide. Promoted
    /// from what would otherwise have been an off-target `Shot`. No score
    /// impact, no card impact; purely narrative drama density.
    NearMiss {
        shooter: PlayerId,
        kind: NearMissKind,
    },
    HalfTime,
    FullTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchEvent {
    pub minute: u16,
    pub side: Option<Side>,
    pub kind: MatchEventKind,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchResult {
    pub home_goals: u8,
    pub away_goals: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Match {
    pub home: TeamId,
    pub away: TeamId,
    pub seed: u64,
    pub result: MatchResult,
    pub events: Vec<MatchEvent>,
}
