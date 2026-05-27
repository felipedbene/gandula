import { useState } from "react";
import { play_match } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, SAMPLE_TEAMS, teamById } from "../teams";
import type { Match, Player, Team } from "../types";
import Card from "../srcl/Card";
import MatchReveal from "./MatchReveal";

type MatchViewProps = {
  onStatus: (msg: string) => void;
};

export function MatchView({ onStatus }: MatchViewProps) {
  const [homeId, setHomeId] = useState<number>(SAMPLE_TEAMS[0].id);
  const [awayId, setAwayId] = useState<number>(SAMPLE_TEAMS[1].id);
  const [seed, setSeed] = useState<number>(1998);
  const [result, setResult] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);

  function play() {
    setError(null);
    setResult(null);
    try {
      const home = teamById(homeId);
      const away = teamById(awayId);
      if (!home || !away) throw new Error("time não encontrado");
      const start = performance.now();
      // wasm-bindgen expects BigInt for u64.
      const raw = play_match(home, away, BigInt(seed));
      const ms = Math.round(performance.now() - start);
      setResult(raw as Match);
      onStatus(`partida concluída em ${ms}ms · seed ${seed}`);
    } catch (e) {
      setError(String(e));
      onStatus(`erro: ${e}`);
    }
  }

  return (
    <div className="match-view">
      <Card title="CONFRONTO">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            play();
          }}
        >
          <label>
            <span>Mandante</span>
            <select
              value={homeId}
              onChange={(e) => setHomeId(Number(e.target.value))}
            >
              {ALL_TEAMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Visitante</span>
            <select
              value={awayId}
              onChange={(e) => setAwayId(Number(e.target.value))}
            >
              {ALL_TEAMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Semente</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <pre className="match-meta">{matchMetaLines(homeId, awayId)}</pre>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={homeId === awayId}>
              [ JOGAR ]
            </button>
          </div>
        </form>
      </Card>

      {homeId === awayId && (
        <p className="muted">Escolha times diferentes.</p>
      )}

      {error && <pre className="error">{error}</pre>}

      {result && <MatchReveal match={result} />}
    </div>
  );
}

/** Average overall of a team's starting XI: per-player overall is the mean
 *  of pace+technique+passing+defending+finishing+stamina (6 attributes),
 *  then averaged across the 11 starters, rounded. */
function avgStrength(team: Team): number {
  const starters = team.starting_xi
    .map((id) => team.roster.find((p) => p.id === id))
    .filter((p): p is Player => p !== undefined);
  if (starters.length === 0) return 0;
  const sum = starters.reduce((acc, p) => {
    const a = p.attributes;
    return (
      acc +
      (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
        6
    );
  }, 0);
  return Math.round(sum / starters.length);
}

/** Pre-game meta lines for the CONFRONTO box: two columns showing FORMACAO
 *  and FORCA MED for home and away. Padding via padEnd guarantees column 2
 *  starts at the same char position on both lines. */
function matchMetaLines(homeId: number, awayId: number): string {
  const home = teamById(homeId);
  const away = teamById(awayId);
  const homeFor = home?.formation ?? "";
  const awayFor = away?.formation ?? "";
  const homeStr = home ? avgStrength(home) : 0;
  const awayStr = away ? avgStrength(away) : 0;
  const COL = 35;
  const line1 =
    `FORMACAO  : ${homeFor}`.padEnd(COL) + `FORMACAO  : ${awayFor}`;
  const line2 =
    `FORCA MED : ${homeStr}`.padEnd(COL) + `FORCA MED : ${awayStr}`;
  return line1 + "\n" + line2;
}
