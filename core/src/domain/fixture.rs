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
