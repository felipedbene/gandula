import { useState } from "react";
import { play_match } from "../wasm/gandula_wasm.js";
import { SAMPLE_TEAMS, teamById } from "../teams";
import type { Match, MatchEvent } from "../types";
import { eventKindName } from "../types";
import { AsciiBox } from "./AsciiBox";

export function MatchView() {
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
      // wasm-bindgen expects BigInt for u64.
      const raw = play_match(home, away, BigInt(seed));
      setResult(raw as Match);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="match-view">
      <AsciiBox title="CONFRONTO">
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
              {SAMPLE_TEAMS.map((t) => (
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
              {SAMPLE_TEAMS.map((t) => (
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
          <button type="submit" className="btn" disabled={homeId === awayId}>
            [ JOGAR ]
          </button>
        </form>
      </AsciiBox>

      {homeId === awayId && (
        <p className="muted">Escolha times diferentes.</p>
      )}

      {error && <pre className="error">{error}</pre>}

      {result && <MatchResult result={result} />}
    </div>
  );
}

function MatchResult({ result }: { result: Match }) {
  const home = teamById(result.home)?.name ?? `Time ${result.home}`;
  const away = teamById(result.away)?.name ?? `Time ${result.away}`;
  const title =
    `${home.toUpperCase()}  ${result.result.home_goals} x ${result.result.away_goals}  ${away.toUpperCase()}`;

  return (
    <div className="match-result">
      <AsciiBox double title={title} hint="[↑↓] rolar  [ESC] voltar">
        <ol className="feed">
          {result.events.map((e, i) => {
            const klass = `event ${eventClass(e)}`;
            const glyph = eventGlyph(e);
            const m = e.text.match(/^(\d+'?)\s+(.*)$/);
            if (m) {
              const [, minute, rest] = m;
              return (
                <li key={i} className={klass}>
                  <span className="event__minute">{minute}</span>
                  {glyph && <span className="event__glyph">{glyph}</span>}
                  {rest}
                </li>
              );
            }
            return (
              <li key={i} className={klass}>
                {glyph && <span className="event__glyph">{glyph}</span>}
                {e.text}
              </li>
            );
          })}
        </ol>
      </AsciiBox>
    </div>
  );
}

function eventClass(e: MatchEvent): string {
  const k = eventKindName(e.kind);
  switch (k) {
    case "Goal":
      return "goal";
    case "RedCard":
      return "red";
    case "YellowCard":
      return "yellow";
    case "Substitution":
      return "sub";
    case "HalfTime":
    case "FullTime":
      return "whistle";
    default:
      return "";
  }
}

function eventGlyph(e: MatchEvent): string {
  const k = eventKindName(e.kind);
  switch (k) {
    case "Goal":
      return "►►►";
    case "RedCard":
      return "██";
    case "YellowCard":
      return "▓";
    case "Substitution":
      return "↔";
    case "HalfTime":
    case "FullTime":
      return "───";
    default:
      return "";
  }
}
