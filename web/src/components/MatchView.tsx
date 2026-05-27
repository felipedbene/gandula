import { useEffect, useState } from "react";
import { play_match } from "../wasm/gandula_wasm.js";
import { SAMPLE_TEAMS, teamById } from "../teams";
import type { Match, MatchEvent } from "../types";
import { eventKindName } from "../types";
import { AsciiBox } from "./AsciiBox";

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

/** Tick-by-tick reveal pacing: ms of wall-clock per minute of match time.
 *  80ms/min → 90' match unrolls in ~7.2s, with dense periods (e.g. three
 *  subs at min 70) appearing in a burst and calm stretches sitting still.
 *  Elifoot 98 vibe — the engine resolves the match in <5ms but the UI
 *  pretends to be a 1998 PC discovering the result tick by tick. */
const REVEAL_MS_PER_MIN = 80;

/** Extra wall-clock delay added to second-half events so the feed pauses
 *  briefly at halftime — matches the "intervalo" beat from Elifoot where
 *  you registered "ah, primeiro tempo acabou" before the second half rolled. */
const HALFTIME_PAUSE_MS = 1500;

function MatchResult({ result }: { result: Match }) {
  const home = teamById(result.home)?.name ?? `Time ${result.home}`;
  const away = teamById(result.away)?.name ?? `Time ${result.away}`;

  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    const timers = result.events.map((e, i) => {
      const delay =
        e.minute * REVEAL_MS_PER_MIN +
        (e.minute > 45 ? HALFTIME_PAUSE_MS : 0);
      return window.setTimeout(() => setRevealed(i + 1), delay);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [result]);

  const visible = result.events.slice(0, revealed);
  const runningHome = visible.filter(
    (e) => eventKindName(e.kind) === "Goal" && e.side === "Home",
  ).length;
  const runningAway = visible.filter(
    (e) => eventKindName(e.kind) === "Goal" && e.side === "Away",
  ).length;
  const clock = visible.length > 0 ? visible[visible.length - 1].minute : 0;
  const title =
    `${home.toUpperCase()}  ${runningHome} x ${runningAway}  ${away.toUpperCase()}  ${clock}'`;

  const isPlaying = revealed < result.events.length;
  const skip = () => setRevealed(result.events.length);

  return (
    <div className="match-result">
      <AsciiBox double title={title} hint="[↑↓] rolar  [ESC] voltar">
        <ol className="feed">
          {visible.map((e, i) => {
            const side = e.side === "Away" ? " event--away" : "";
            const klass = `event ${eventClass(e)}${side}`;
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
      {isPlaying && (
        <button className="btn" onClick={skip}>
          [ PULAR ]
        </button>
      )}
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
