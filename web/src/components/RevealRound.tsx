import { useEffect, useMemo, useRef, useState } from "react";
import type { Match } from "../types";
import type { SavedSeason } from "../persistence";
import { teamById } from "../teams";
import { revealMinutes } from "../util/prng";
import Card from "../srcl/Card";
import MatchReveal, { HALFTIME_PAUSE_MS, REVEAL_MS_PER_MIN } from "./MatchReveal";

type RevealRoundProps = {
  saved: SavedSeason;
  /** Fires once when the user's match reveal and all parallel matches have
   *  completed (or PULAR was clicked). Parent transitions back to running. */
  onDone: () => void;
};

type OtherMatch = {
  index: number;          // index into saved.record.matches/fixtures
  match: Match;
  homeName: string;
  awayName: string;
  revealAtMinute: number;
};

/**
 * Orchestrates the AVANÇAR reveal: user's match (if any) plays tick-by-tick
 * via MatchReveal, the other matches in the round reveal final scores at
 * deterministic wall-clock moments seeded off the season's seed XOR round.
 *
 * Persistence note: by the time this component mounts, the save's
 * `currentRoundIdx` has already been incremented by SeasonView. The round
 * we're revealing is therefore `currentRoundIdx - 1`. F5 mid-reveal autoloads
 * straight back into `running` — animation is lost, save is intact.
 *
 * Bye-round path: when the user's team has no fixture in this round
 * (happens in odd-team leagues — 17 teams → 2 byes per season), the user
 * match pane is omitted and the header explicitly says "SEU TIME DESCANSA",
 * so it doesn't read as a UI bug.
 */
export default function RevealRound({ saved, onDone }: RevealRoundProps) {
  const revealRound = saved.currentRoundIdx - 1;

  // Pair fixtures with matches for the round in question, preserving the
  // engine's fixtures-array ordering (circle method is deterministic and the
  // UI shouldn't second-guess it).
  const { userMatch, others } = useMemo(() => {
    const fixtures = saved.record.fixtures;
    const matches = saved.record.matches;
    const rows: { idx: number; match: Match; homeName: string; awayName: string; isUser: boolean }[] = [];
    fixtures.forEach((f, i) => {
      if (f.round !== revealRound) return;
      const m = matches[i];
      if (!m) return;
      rows.push({
        idx: i,
        match: m,
        homeName: teamById(m.home)?.name ?? `Time ${m.home}`,
        awayName: teamById(m.away)?.name ?? `Time ${m.away}`,
        isUser: m.home === saved.controlledTeamId || m.away === saved.controlledTeamId,
      });
    });
    const userRow = rows.find((r) => r.isUser);
    const otherRows = rows.filter((r) => !r.isUser);
    return { userMatch: userRow, others: otherRows };
  }, [saved, revealRound]);

  // Deterministic per (seed, round): same season + same round always picks
  // the same reveal-at-minute sequence for parallel matches.
  const otherWithTiming: OtherMatch[] = useMemo(() => {
    const minutes = revealMinutes(saved.seed, revealRound, others.length);
    return others.map((r, i) => ({
      index: r.idx,
      match: r.match,
      homeName: r.homeName,
      awayName: r.awayName,
      revealAtMinute: minutes[i],
    }));
  }, [saved.seed, revealRound, others]);

  const [othersRevealed, setOthersRevealed] = useState<boolean[]>(() =>
    new Array(otherWithTiming.length).fill(false),
  );
  // Bye round → no user match, treat as done immediately so the only signal
  // we wait on is the parallel matches finishing.
  const [userDone, setUserDone] = useState(userMatch === undefined);
  const [skipAll, setSkipAll] = useState(false);
  const doneFiredRef = useRef(false);

  // Schedule the parallel-match reveals.
  useEffect(() => {
    const timers = otherWithTiming.map((om, i) => {
      const delay =
        om.revealAtMinute * REVEAL_MS_PER_MIN +
        (om.revealAtMinute > 45 ? HALFTIME_PAUSE_MS : 0);
      return window.setTimeout(() => {
        setOthersRevealed((prev) => {
          if (prev[i]) return prev;
          const next = prev.slice();
          next[i] = true;
          return next;
        });
      }, delay);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [otherWithTiming]);

  // PULAR: jump everything to the end.
  useEffect(() => {
    if (!skipAll) return;
    setOthersRevealed(new Array(otherWithTiming.length).fill(true));
    if (userMatch === undefined) {
      setUserDone(true);
    }
  }, [skipAll, otherWithTiming.length, userMatch]);

  // Bye round with no parallel matches at all (impossible in practice — a
  // round always has at least one fixture — but the math collapses cleanly
  // and we exit immediately).
  const allOthersDone =
    otherWithTiming.length === 0 || othersRevealed.every((b) => b);

  // Fire onDone once when everything wraps.
  useEffect(() => {
    if (!doneFiredRef.current && userDone && allOthersDone) {
      doneFiredRef.current = true;
      onDone();
    }
  }, [userDone, allOthersDone, onDone]);

  const headerText = userMatch
    ? `REVELANDO RODADA ${revealRound + 1}`
    : `REVELANDO RODADA ${revealRound + 1} — SEU TIME DESCANSA NESTA RODADA`;

  const isPlaying = !userDone || !allOthersDone;

  return (
    <>
      <p className="reveal-header muted">{headerText}</p>

      {userMatch && (
        <MatchReveal
          match={userMatch.match}
          onComplete={() => setUserDone(true)}
          skipAll={skipAll}
        />
      )}

      <Card title="OUTROS JOGOS">
        {otherWithTiming.length === 0 ? (
          <p className="muted">Nenhum outro jogo nesta rodada.</p>
        ) : (
          <pre className="other-matches">
            {otherWithTiming.map((om, i) => (
              <OtherMatchRow
                key={om.index}
                match={om.match}
                homeName={om.homeName}
                awayName={om.awayName}
                revealed={othersRevealed[i]}
              />
            ))}
          </pre>
        )}
      </Card>

      {isPlaying && (
        <div className="form-actions form-actions--reveal">
          <button type="button" className="btn" onClick={() => setSkipAll(true)}>
            [ PULAR ]
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Single row in the OUTROS JOGOS card. Padded to a fixed column width so
 * the score (or pending `×`) lines up vertically across all rows.
 */
function OtherMatchRow({
  match,
  homeName,
  awayName,
  revealed,
}: {
  match: Match;
  homeName: string;
  awayName: string;
  revealed: boolean;
}) {
  const HOME_W = 24;
  const SCORE_W = 7; // " N - N " or "  ×    "
  const home = homeName.padEnd(HOME_W);
  const away = awayName;
  if (!revealed) {
    return (
      <span className="other-matches__row">
        {home}
        <span className="other-matches__pending">{"   ×   ".padEnd(SCORE_W)}</span>
        {away}
        {"\n"}
      </span>
    );
  }
  const score = ` ${match.result.home_goals} - ${match.result.away_goals} `;
  return (
    <span className="other-matches__row">
      {home}
      <span className="other-matches__score">{score.padEnd(SCORE_W)}</span>
      {away}
      {"\n"}
    </span>
  );
}
