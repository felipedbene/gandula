use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::domain::player::{Player, PlayerId};
use crate::error::GandulaError;

pub const MAX_BENCH: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TeamId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Formation {
    F442,
    F433,
    F352,
    F4231,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mentality {
    VeryDefensive,
    Defensive,
    Balanced,
    Attacking,
    VeryAttacking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tempo {
    Slow,
    Normal,
    Fast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Pressing {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Width {
    Narrow,
    Normal,
    Wide,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Tactics {
    pub mentality: Mentality,
    pub tempo: Tempo,
    pub pressing: Pressing,
    pub width: Width,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: TeamId,
    pub name: String,
    pub roster: Vec<Player>,
    pub formation: Formation,
    pub tactics: Tactics,
    pub starting_xi: [PlayerId; 11],
    #[serde(default)]
    pub bench: Vec<PlayerId>,
}

impl Team {
    pub fn validate(&self) -> Result<(), GandulaError> {
        for player in &self.roster {
            player.validate()?;
        }

        let xi_set: HashSet<PlayerId> = self.starting_xi.iter().copied().collect();
        if xi_set.len() != 11 {
            return Err(GandulaError::InvalidXI(xi_set.len()));
        }
        for id in self.starting_xi {
            if !self.roster.iter().any(|p| p.id == id) {
                return Err(GandulaError::UnknownPlayerInXI(id));
            }
        }

        if self.bench.len() > MAX_BENCH {
            return Err(GandulaError::BenchTooLarge {
                count: self.bench.len(),
                max: MAX_BENCH,
            });
        }
        let bench_set: HashSet<PlayerId> = self.bench.iter().copied().collect();
        if bench_set.len() != self.bench.len() {
            return Err(GandulaError::DuplicateInBench);
        }
        for id in &self.bench {
            if xi_set.contains(id) {
                return Err(GandulaError::PlayerInBothXIAndBench(*id));
            }
            if !self.roster.iter().any(|p| p.id == *id) {
                return Err(GandulaError::UnknownPlayerInBench(*id));
            }
        }

        Ok(())
    }

    pub(crate) fn lookup(&self, id: PlayerId) -> Option<&Player> {
        self.roster.iter().find(|p| p.id == id)
    }
}
