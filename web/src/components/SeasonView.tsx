import { useMemo, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { SAMPLE_TEAMS, teamById } from "../teams";
import type { SeasonRecord, TeamStats } from "../types";
import { goalDifference, points } from "../types";
import { AsciiBox } from "./AsciiBox";

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
        <button type="submit" className="btn" disabled={selected.size < 2}>
          [ RODAR TEMPORADA ]
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
      <StandingsTable standings={record.standings} leagueName={record.league_name} />

      <button className="link-button" onClick={onToggleMatches}>
        {showMatches ? "[ ESCONDER PARTIDAS ]" : "[ MOSTRAR PARTIDAS ]"}
      </button>

      {showMatches && (
        <div className="rounds">
          {byRound.map(([round, indices]) => (
            <AsciiBox key={round} title={`RODADA ${round + 1}`}>
              {indices.map((i) => {
                const m = record.matches[i];
                const home = teamById(m.home)?.name ?? `Time ${m.home}`;
                const away = teamById(m.away)?.name ?? `Time ${m.away}`;
                return (
                  <div key={i} className="round-match">
                    {pad(home, 30)}
                    {"  "}
                    <span className="round-match__score">
                      {String(m.result.home_goals).padStart(2)}
                      {" - "}
                      {String(m.result.away_goals).padEnd(2)}
                    </span>
                    {"  "}
                    {pad(away, 30, "L")}
                  </div>
                );
              })}
            </AsciiBox>
          ))}
        </div>
      )}
    </div>
  );
}

function pad(v: string | number, w: number, dir: "L" | "R" = "R"): string {
  return dir === "L" ? String(v).padEnd(w) : String(v).padStart(w);
}

const COL_GAP = "  ";

function StandingsTable({
  standings,
  leagueName,
}: {
  standings: TeamStats[];
  leagueName: string;
}) {
  const headerLine = [
    pad("POS", 3),
    pad("TIME", 24, "L"),
    pad("P", 3),
    pad("V", 3),
    pad("E", 3),
    pad("D", 3),
    pad("GP", 3),
    pad("GC", 3),
    pad("SG", 4),
    pad("PTS", 3),
  ].join(COL_GAP);

  const dividerLine = [
    "───",
    "─".repeat(24),
    "──",
    "──",
    "──",
    "──",
    "──",
    "──",
    "───",
    "──",
  ].map((s, i) => (i === 1 ? s : pad(s, [3, 24, 3, 3, 3, 3, 3, 3, 4, 3][i])))
    .join(COL_GAP);

  return (
    <AsciiBox title={`TABELA — ${leagueName}`}>
      <pre className="standings">
        <span className="standings-dim">{headerLine}</span>
        {"\n"}
        <span className="standings-dim">{dividerLine}</span>
        {"\n"}
        {standings.map((s, i) => {
          const team = teamById(s.team_id);
          const name = team?.name ?? `Time ${s.team_id}`;
          const gd = goalDifference(s);
          const gdStr = gd > 0 ? `+${gd}` : String(gd);
          const pts = points(s);
          const hi = i === 0 ? "standings-hi" : "";
          return (
            <span key={s.team_id}>
              {pad(`${i + 1}.`, 3)}
              {COL_GAP}
              <span className={hi}>{pad(name, 24, "L")}</span>
              {COL_GAP}
              {pad(s.played, 3)}
              {COL_GAP}
              {pad(s.won, 3)}
              {COL_GAP}
              {pad(s.drawn, 3)}
              {COL_GAP}
              {pad(s.lost, 3)}
              {COL_GAP}
              {pad(s.goals_for, 3)}
              {COL_GAP}
              {pad(s.goals_against, 3)}
              {COL_GAP}
              {pad(gdStr, 4)}
              {COL_GAP}
              <span className={hi}>{pad(pts, 3)}</span>
              {"\n"}
            </span>
          );
        })}
      </pre>
    </AsciiBox>
  );
}
