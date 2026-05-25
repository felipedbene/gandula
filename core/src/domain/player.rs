use serde::{Deserialize, Serialize};

use crate::error::GandulaError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlayerId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Position {
    GK,
    DEF,
    MID,
    FWD,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Attributes {
    pub pace: u8,
    pub technique: u8,
    pub passing: u8,
    pub defending: u8,
    pub finishing: u8,
    pub stamina: u8,
}

impl Attributes {
    pub fn validate(&self) -> Result<(), GandulaError> {
        let pairs: [(&'static str, u8); 6] = [
            ("pace", self.pace),
            ("technique", self.technique),
            ("passing", self.passing),
            ("defending", self.defending),
            ("finishing", self.finishing),
            ("stamina", self.stamina),
        ];
        for (field, value) in pairs {
            if !(1..=99).contains(&value) {
                return Err(GandulaError::AttributeOutOfRange { field, value });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: PlayerId,
    pub name: String,
    pub age: u8,
    pub position: Position,
    pub attributes: Attributes,
}

impl Player {
    pub fn validate(&self) -> Result<(), GandulaError> {
        if !(15..=50).contains(&self.age) {
            return Err(GandulaError::AgeOutOfRange(self.age));
        }
        self.attributes.validate()
    }
}
