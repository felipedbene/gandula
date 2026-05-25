use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};
use gandula_core::{
    League, Match, SeasonRecord, Team, TeamId, simulate, simulate_season,
};

mod persistence;
use persistence::Store;

#[derive(Parser)]
#[command(
    name = "gandula",
    version,
    about = "Simulador de futebol em texto — homenagem aos jogos PT-BR dos anos 90."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Simula uma partida entre dois times a partir de arquivos JSON.
    Play {
        #[arg(long)]
        home: PathBuf,
        #[arg(long)]
        away: PathBuf,
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
    /// Simula uma temporada inteira (turno e returno) entre N times.
    Season {
        /// Caminho para um arquivo de time JSON. Repita o flag para cada time.
        #[arg(long = "team", required = true)]
        teams: Vec<PathBuf>,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value = "Liga Gandula")]
        name: String,
        #[arg(long, value_enum, default_value_t = ShowMode::Table)]
        show: ShowMode,
        /// Opcional: caminho de um arquivo SQLite onde salvar a temporada
        /// (e os times usados nela).
        #[arg(long)]
        save_to: Option<PathBuf>,
    },
    /// Importa um time JSON para o banco de dados.
    SaveTeam {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        from: PathBuf,
    },
    /// Lista os times salvos no banco.
    ListTeams {
        #[arg(long)]
        db: PathBuf,
    },
    /// Lista as temporadas salvas no banco.
    ListSeasons {
        #[arg(long)]
        db: PathBuf,
    },
    /// Mostra uma temporada salva pelo ID.
    ShowSeason {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        id: i64,
        #[arg(long, value_enum, default_value_t = ShowMode::Table)]
        show: ShowMode,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum ShowMode {
    Table,
    Matches,
    Both,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("gandula: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.cmd {
        Cmd::Play { home, away, seed } => run_play(home, away, seed),
        Cmd::Season {
            teams,
            seed,
            name,
            show,
            save_to,
        } => run_season(teams, seed, name, show, save_to),
        Cmd::SaveTeam { db, from } => run_save_team(db, from),
        Cmd::ListTeams { db } => run_list_teams(db),
        Cmd::ListSeasons { db } => run_list_seasons(db),
        Cmd::ShowSeason { db, id, show } => run_show_season(db, id, show),
    }
}

// ─── Commands ───────────────────────────────────────────────────────────────

fn run_play(
    home: PathBuf,
    away: PathBuf,
    seed: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let home_team: Team = serde_json::from_str(&fs::read_to_string(&home)?)?;
    let away_team: Team = serde_json::from_str(&fs::read_to_string(&away)?)?;
    let m = simulate(&home_team, &away_team, seed)?;

    println!(
        "=== {} {} x {} {} (semente {}) ===",
        home_team.name, m.result.home_goals, m.result.away_goals, away_team.name, seed
    );
    for event in &m.events {
        println!("{}", event.text);
    }
    Ok(())
}

fn run_season(
    team_paths: Vec<PathBuf>,
    seed: u64,
    name: String,
    show: ShowMode,
    save_to: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut teams: Vec<Team> = Vec::with_capacity(team_paths.len());
    for path in &team_paths {
        let raw = fs::read_to_string(path)?;
        let team: Team = serde_json::from_str(&raw)?;
        teams.push(team);
    }
    let league = League { name, teams };
    let record = simulate_season(&league, seed)?;

    println!("=== {} (semente {}) ===", record.league_name, seed);

    let names: HashMap<TeamId, String> = league
        .teams
        .iter()
        .map(|t| (t.id, t.name.clone()))
        .collect();
    let resolver = |id: TeamId| name_or_fallback(&names, id);

    if matches!(show, ShowMode::Matches | ShowMode::Both) {
        print_matches(&record, &resolver);
    }
    if matches!(show, ShowMode::Table | ShowMode::Both) {
        print_table(&record, &resolver);
    }

    if let Some(db_path) = save_to {
        let mut store = Store::open(&db_path)?;
        for team in &league.teams {
            store.save_team(team)?;
        }
        let season_id = store.save_season(&record, seed)?;
        println!("\nTemporada salva em {} (id {})", db_path.display(), season_id);
    }

    Ok(())
}

fn run_save_team(db: PathBuf, from: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let team: Team = serde_json::from_str(&fs::read_to_string(&from)?)?;
    team.validate()?;
    let mut store = Store::open(&db)?;
    store.save_team(&team)?;
    println!(
        "Time \"{}\" (id {}) salvo em {}.",
        team.name,
        team.id.0,
        db.display()
    );
    Ok(())
}

fn run_list_teams(db: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::open(&db)?;
    let teams = store.list_teams()?;
    if teams.is_empty() {
        println!("(nenhum time salvo)");
        return Ok(());
    }
    println!("{:<6}  {:<28}  {}", "ID", "Nome", "Criado em");
    for t in teams {
        println!("{:<6}  {:<28}  {}", t.id.0, t.name, t.created_at);
    }
    Ok(())
}

fn run_list_seasons(db: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::open(&db)?;
    let seasons = store.list_seasons()?;
    if seasons.is_empty() {
        println!("(nenhuma temporada salva)");
        return Ok(());
    }
    println!(
        "{:<4}  {:<32}  {:>5}  {:>9}  {}",
        "ID", "Liga", "Times", "Semente", "Criado em"
    );
    for s in seasons {
        println!(
            "{:<4}  {:<32}  {:>5}  {:>9}  {}",
            s.id, s.league_name, s.team_count, s.seed, s.created_at
        );
    }
    Ok(())
}

fn run_show_season(
    db: PathBuf,
    id: i64,
    show: ShowMode,
) -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::open(&db)?;
    let record = store.load_season(id)?;

    // Look up team names for every TeamId that appears in matches or standings.
    let mut needed: HashSet<TeamId> = HashSet::new();
    for m in &record.matches {
        needed.insert(m.home);
        needed.insert(m.away);
    }
    for s in &record.standings {
        needed.insert(s.team_id);
    }
    let mut names: HashMap<TeamId, String> = HashMap::new();
    for tid in needed {
        if let Ok(team) = store.load_team(tid) {
            names.insert(tid, team.name);
        }
    }
    let resolver = |id: TeamId| name_or_fallback(&names, id);

    println!(
        "=== {} (semente {}, id {}) ===",
        record.league_name, find_seed(&record, &store, id).unwrap_or(0), id
    );

    if matches!(show, ShowMode::Matches | ShowMode::Both) {
        print_matches(&record, &resolver);
    }
    if matches!(show, ShowMode::Table | ShowMode::Both) {
        print_table(&record, &resolver);
    }
    Ok(())
}

fn find_seed(_record: &SeasonRecord, store: &Store, id: i64) -> Option<u64> {
    store
        .list_seasons()
        .ok()?
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.seed)
}

// ─── Shared printers (work for live or loaded seasons) ──────────────────────

fn name_or_fallback(names: &HashMap<TeamId, String>, id: TeamId) -> String {
    names
        .get(&id)
        .cloned()
        .unwrap_or_else(|| format!("Time {}", id.0))
}

fn print_matches<F: Fn(TeamId) -> String>(record: &SeasonRecord, name_of: &F) {
    let mut by_round: BTreeMap<u16, Vec<usize>> = BTreeMap::new();
    for (i, f) in record.fixtures.iter().enumerate() {
        by_round.entry(f.round).or_default().push(i);
    }
    for (round, indices) in by_round {
        println!("\n--- Rodada {} ---", round + 1);
        for i in indices {
            let m: &Match = &record.matches[i];
            println!(
                "{:<22} {} - {} {}",
                name_of(m.home),
                m.result.home_goals,
                m.result.away_goals,
                name_of(m.away)
            );
        }
    }
}

fn print_table<F: Fn(TeamId) -> String>(record: &SeasonRecord, name_of: &F) {
    println!();
    println!(
        "{:<4}  {:<22}  {:>3}  {:>3}  {:>3}  {:>3}  {:>4}  {:>4}  {:>4}  {:>4}",
        "Pos", "Time", "P", "V", "E", "D", "GP", "GC", "SG", "Pts"
    );
    for (i, stats) in record.standings.iter().enumerate() {
        let gd = stats.goal_difference();
        let gd_str = if gd > 0 {
            format!("+{gd}")
        } else {
            gd.to_string()
        };
        println!(
            "{:<4}  {:<22}  {:>3}  {:>3}  {:>3}  {:>3}  {:>4}  {:>4}  {:>4}  {:>4}",
            format!("{}.", i + 1),
            name_of(stats.team_id),
            stats.played,
            stats.won,
            stats.drawn,
            stats.lost,
            stats.goals_for,
            stats.goals_against,
            gd_str,
            stats.points()
        );
    }
}

