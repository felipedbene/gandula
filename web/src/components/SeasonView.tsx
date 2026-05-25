import { useMemo, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { SAMPLE_TEAMS, teamById } from "../teams";
import type { SeasonRecord, TeamStats } from "../types";
import { goalDifference, points } from "../types";

export function SeasonView() {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(SAMPLE_TEAMS.map((t) => t.id))
  );
  const [seed, setSeed] = useState<number>(1998);
  const [name, setName] = useState<string>("Brasileirão Imaginário 2026");
  const [record, setRecord] = useState<SeasonRecord | null>(null);
  const [showMatches, setShowMatches] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run() {
    setError(null);
    setRecord(null);
    try {
      const teams = SAMPLE_TEAMS.filter((t) => selected.has(t.id));
      if (teams.length < 2) throw new Error("Selecione pelo menos 2 times.");
      const raw = run_season(teams, BigInt(seed), name);
      setRecord(raw as SeasonRecord);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="season-view">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <fieldset>
          <legend>Times</legend>
          {SAMPLE_TEAMS.map((t) => (
            <label key={t.id} className="checkbox">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
        <label>
          <span>Liga</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>Semente</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <button type="submit" disabled={selected.size < 2}>
          Rodar temporada
        </button>
      </form>

      {error && <pre className="error">{error}</pre>}

      {record && <SeasonResult record={record} showMatches={showMatches} onToggleMatches={() => setShowMatches((v) => !v)} />}
    </div>
  );
}

function SeasonResult({
  record,
  showMatches,
  onToggleMatches,
}: {
  record: SeasonRecord;
  showMatches: boolean;
  onToggleMatches: () => void;
}) {
  const byRound = useMemo(() => {
    const map = new Map<number, number[]>();
    record.fixtures.forEach((f, i) => {
      const arr = map.get(f.round) ?? [];
      arr.push(i);
      map.set(f.round, arr);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [record]);

  return (
    <div className="season-result">
      <h2>{record.league_name}</h2>
      <table className="standings">
        <thead>
          <tr>
            <th>Pos</th>
            <th className="left">Time</th>
            <th>P</th>
            <th>V</th>
            <th>E</th>
            <th>D</th>
            <th>GP</th>
            <th>GC</th>
            <th>SG</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {record.standings.map((s, i) => (
            <StandingsRow key={s.team_id} pos={i + 1} stats={s} />
          ))}
        </tbody>
      </table>

      <button className="link-button" onClick={onToggleMatches}>
        {showMatches ? "Esconder partidas" : "Mostrar partidas"}
      </button>

      {showMatches && (
        <div className="rounds">
          {byRound.map(([round, indices]) => (
            <div key={round} className="round">
              <h3>Rodada {round + 1}</h3>
              <ul className="matches">
                {indices.map((i) => {
                  const m = record.matches[i];
                  return (
                    <li key={i} className="match-line">
                      <span className="team-name">{teamById(m.home)?.name ?? `Time ${m.home}`}</span>
                      <span className="score">
                        {m.result.home_goals} - {m.result.away_goals}
                      </span>
                      <span className="team-name">{teamById(m.away)?.name ?? `Time ${m.away}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StandingsRow({ pos, stats }: { pos: number; stats: TeamStats }) {
  const team = teamById(stats.team_id);
  const gd = goalDifference(stats);
  const gdStr = gd > 0 ? `+${gd}` : String(gd);
  return (
    <tr>
      <td>{pos}.</td>
      <td className="left">{team?.name ?? `Time ${stats.team_id}`}</td>
      <td>{stats.played}</td>
      <td>{stats.won}</td>
      <td>{stats.drawn}</td>
      <td>{stats.lost}</td>
      <td>{stats.goals_for}</td>
      <td>{stats.goals_against}</td>
      <td>{gdStr}</td>
      <td className="pts">{points(stats)}</td>
    </tr>
  );
}
