//! SQLite save/load for teams and season records.
//!
//! Each domain object is stored as a JSON blob alongside a few
//! query-friendly columns (name, seed, team_count). The schema is created on
//! `Store::open` if missing — no migration framework yet. When we need one,
//! add a `_schema_version` table and per-version `UP` scripts.

use std::path::Path;

use gandula_core::{SeasonRecord, Team, TeamId};
use rusqlite::{Connection, OptionalExtension, params};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS teams (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    json        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS seasons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    league_name  TEXT NOT NULL,
    seed         INTEGER NOT NULL,
    team_count   INTEGER NOT NULL,
    json         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found")]
    NotFound,
}

pub struct Store {
    conn: Connection,
}

#[derive(Debug)]
pub struct TeamSummary {
    pub id: TeamId,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct SeasonSummary {
    pub id: i64,
    pub league_name: String,
    pub seed: u64,
    pub team_count: u32,
    pub created_at: String,
}

impl Store {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, StorageError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn save_team(&mut self, team: &Team) -> Result<(), StorageError> {
        let json = serde_json::to_string(team)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO teams (id, name, json) VALUES (?1, ?2, ?3)",
            params![team.id.0 as i64, team.name, json],
        )?;
        Ok(())
    }

    pub fn load_team(&self, id: TeamId) -> Result<Team, StorageError> {
        let json: Option<String> = self
            .conn
            .query_row(
                "SELECT json FROM teams WHERE id = ?1",
                params![id.0 as i64],
                |row| row.get(0),
            )
            .optional()?;
        let Some(json) = json else {
            return Err(StorageError::NotFound);
        };
        Ok(serde_json::from_str(&json)?)
    }

    pub fn list_teams(&self) -> Result<Vec<TeamSummary>, StorageError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, created_at FROM teams ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            Ok(TeamSummary {
                id: TeamId(id as u32),
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn save_season(
        &mut self,
        record: &SeasonRecord,
        seed: u64,
    ) -> Result<i64, StorageError> {
        let json = serde_json::to_string(record)?;
        let team_count = record.standings.len() as i64;
        self.conn.execute(
            "INSERT INTO seasons (league_name, seed, team_count, json) VALUES (?1, ?2, ?3, ?4)",
            params![record.league_name, seed as i64, team_count, json],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn load_season(&self, id: i64) -> Result<SeasonRecord, StorageError> {
        let json: Option<String> = self
            .conn
            .query_row(
                "SELECT json FROM seasons WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(json) = json else {
            return Err(StorageError::NotFound);
        };
        Ok(serde_json::from_str(&json)?)
    }

    pub fn list_seasons(&self) -> Result<Vec<SeasonSummary>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, league_name, seed, team_count, created_at FROM seasons ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let league_name: String = row.get(1)?;
            let seed: i64 = row.get(2)?;
            let team_count: i64 = row.get(3)?;
            let created_at: String = row.get(4)?;
            Ok(SeasonSummary {
                id,
                league_name,
                seed: seed as u64,
                team_count: team_count as u32,
                created_at,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use gandula_core::{
        Attributes, Formation, League, Mentality, Player, PlayerId, Position, Pressing, Tactics,
        Team, TeamId, Tempo, Width, simulate_season,
    };

    fn mk_team(team_id: u32, name: &str) -> Team {
        let roster: Vec<Player> = (1..=11)
            .map(|i| Player {
                id: PlayerId(team_id * 100 + i),
                name: format!("P{team_id}_{i}"),
                age: 25,
                position: match i {
                    1 => Position::GK,
                    2..=5 => Position::DEF,
                    6..=8 => Position::MID,
                    _ => Position::FWD,
                },
                attributes: Attributes {
                    pace: 70,
                    technique: 70,
                    passing: 70,
                    defending: 70,
                    finishing: 70,
                    stamina: 85,
                },
            })
            .collect();
        let starting_xi: [PlayerId; 11] =
            std::array::from_fn(|i| PlayerId(team_id * 100 + (i as u32) + 1));
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
            bench: vec![],
        }
    }

    #[test]
    fn team_roundtrip() {
        let mut store = Store::open_in_memory().expect("open");
        let original = mk_team(1, "Round-Trip FC");
        store.save_team(&original).expect("save");
        let loaded = store.load_team(TeamId(1)).expect("load");

        let j1 = serde_json::to_string(&original).expect("ser orig");
        let j2 = serde_json::to_string(&loaded).expect("ser loaded");
        assert_eq!(j1, j2);
    }

    #[test]
    fn load_unknown_team_returns_not_found() {
        let store = Store::open_in_memory().expect("open");
        match store.load_team(TeamId(999)) {
            Err(StorageError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn save_team_is_idempotent() {
        let mut store = Store::open_in_memory().expect("open");
        let t = mk_team(1, "Idem FC");
        store.save_team(&t).expect("save 1");
        store.save_team(&t).expect("save 2");
        let listed = store.list_teams().expect("list");
        assert_eq!(listed.len(), 1, "duplicate save should overwrite, not append");
    }

    #[test]
    fn list_teams_returns_all_in_id_order() {
        let mut store = Store::open_in_memory().expect("open");
        store.save_team(&mk_team(3, "C")).expect("save c");
        store.save_team(&mk_team(1, "A")).expect("save a");
        store.save_team(&mk_team(2, "B")).expect("save b");
        let listed = store.list_teams().expect("list");
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0].id, TeamId(1));
        assert_eq!(listed[1].id, TeamId(2));
        assert_eq!(listed[2].id, TeamId(3));
    }

    #[test]
    fn season_roundtrip() {
        let mut store = Store::open_in_memory().expect("open");
        let league = League {
            name: "Liga de Teste".to_string(),
            teams: vec![mk_team(1, "A"), mk_team(2, "B"), mk_team(3, "C")],
        };
        let record = simulate_season(&league, 42).expect("sim");
        let id = store.save_season(&record, 42).expect("save");
        let loaded = store.load_season(id).expect("load");

        let j1 = serde_json::to_string(&record).expect("ser orig");
        let j2 = serde_json::to_string(&loaded).expect("ser loaded");
        assert_eq!(j1, j2);

        let summaries = store.list_seasons().expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].league_name, "Liga de Teste");
        assert_eq!(summaries[0].seed, 42);
        assert_eq!(summaries[0].team_count, 3);
    }
}
