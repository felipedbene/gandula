import { useCallback, useMemo, useState } from "react";
import { play_first_half, play_second_half } from "../wasm/gandula_wasm.js";
import type { HalfTimeSub, Match, Team } from "../types";
import { eventKindName } from "../types";
import type { Career, UserTactics } from "../persistence";
import { findUserDivisionIdxInSeason } from "../persistence";
import { userTeam } from "../util/roster";
import {
  applyUserTactics,
  applyRivalHalftime,
  liveOpponentTeam,
} from "../util/resimulate";
import MatchReveal from "./MatchReveal";
import HalftimePanel from "./HalftimePanel";
import {
  type TacticsFormState,
} from "./TacticsForm";

type UserMatchRevealProps = {
  career: Career;
  /** Fixture index of the user's match in the division record. */
  fixtureIdx: number;
  /** Per-match seed (derive_match_seed(divSeed, fixtureIdx)). */
  matchSeed: bigint;
  /** External skip (PULAR) — jumps to the end without a half-time pause. */
  skipAll?: boolean;
  /** Fires when the full match has revealed. */
  onComplete: () => void;
  /** Hands the finalized 90' match + the half-time tactics (or null if
   *  unchanged) up so the parent can persist them on the Career. */
  onFinalized: (match: Match, halftime: UserTactics | null) => void;
};

/**
 * Live two-phase reveal of the USER's match: run the first half, animate it,
 * pause at the interval for a tactics change + projection, then run the second
 * half with the chosen tactics and resume the same feed. Unlike the other
 * matches (pre-simulated 90'), the user's match is computed here so a half-time
 * decision can actually steer it — and the result is handed back up to persist
 * (with the half-time tactics) so a re-sim / F5 reproduces it deterministically.
 */
export default function UserMatchReveal({
  career,
  fixtureIdx,
  matchSeed,
  skipAll,
  onComplete,
  onFinalized,
}: UserMatchRevealProps) {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const tier = userDiv.tier as 1 | 2 | 3;

  // The fixture's stored orientation tells us which side the user is.
  const oldMatch = userDiv.record.matches[fixtureIdx];
  const isUserHome = oldMatch.home === career.controlledTeamId;
  const opponentId = isUserHome ? oldMatch.away : oldMatch.home;

  // First-half teams: user with their first-half tactics; opponent as composed.
  const baseUserTeam = userTeam(career);
  const firstHalfUser = season.userTactics
    ? applyUserTactics(baseUserTeam, season.userTactics)
    : baseUserTeam;
  const opponentTeam = useMemo(
    () => liveOpponentTeam(career, opponentId),
    [career, opponentId],
  );

  // Run the first half once. The snapshot + first-half events drive the reveal.
  const { snapshot, firstHalf } = useMemo(() => {
    const home = isUserHome ? firstHalfUser : opponentTeam;
    const away = isUserHome ? opponentTeam : firstHalfUser;
    const snap = play_first_half(home, away, matchSeed);
    const fh = play_first_half_to_match(snap, home, away);
    return { snapshot: snap, firstHalf: fh };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchSeed]);

  // The match shown by MatchReveal: starts as first-half-only, grows to the
  // full 90' once the user confirms at the interval.
  const [shownMatch, setShownMatch] = useState<Match>(firstHalf);
  const [atHalfTime, setAtHalfTime] = useState(false);
  const onHalfTime = useCallback(() => setAtHalfTime(true), []);

  // First-half score, user perspective, for the panel.
  const { userGoals, oppGoals } = useMemo(() => {
    let home = 0;
    let away = 0;
    for (const e of firstHalf.events) {
      if (eventKindName(e.kind) === "Goal") {
        if (e.side === "Home") home++;
        else if (e.side === "Away") away++;
      }
    }
    return isUserHome
      ? { userGoals: home, oppGoals: away }
      : { userGoals: away, oppGoals: home };
  }, [firstHalf, isUserHome]);

  const initialForm: TacticsFormState = useMemo(() => {
    const t = season.userTactics?.tactics ?? firstHalfUser.tactics;
    return {
      formation: season.userTactics?.formation ?? firstHalfUser.formation,
      mentality: t.mentality,
      tempo: t.tempo,
      pressing: t.pressing,
      width: t.width,
    };
  }, [season.userTactics, firstHalfUser]);

  function runSecondHalf(halftime: UserTactics | null, subs: HalfTimeSub[]) {
    const secondHalfUser = halftime
      ? applyUserTactics(baseUserTeam, halftime)
      : firstHalfUser;
    const secondHalfOpp = applyRivalHalftime(opponentTeam, tier);
    const home = isUserHome ? secondHalfUser : secondHalfOpp;
    const away = isUserHome ? secondHalfOpp : secondHalfUser;
    // The user's subs apply to whichever side they are; the opponent's subs are
    // left to the AI manager during the second-half loop (empty here).
    const homeSubs = isUserHome ? subs : [];
    const awaySubs = isUserHome ? [] : subs;
    const full = play_second_half(snapshot, home, away, homeSubs, awaySubs) as Match;
    setAtHalfTime(false);
    setShownMatch(full); // MatchReveal resumes from 46' with the full match
    onFinalized(full, halftime);
  }

  return (
    <>
      <MatchReveal
        match={shownMatch}
        skipAll={skipAll}
        pauseAtHalfTime={!atHalfTimeResolved(shownMatch)}
        onHalfTime={onHalfTime}
        onComplete={onComplete}
      />
      {atHalfTime && (
        <HalftimePanel
          snapshot={snapshot}
          baseUserTeam={firstHalfUser}
          opponentTeam={opponentTeam}
          isUserHome={isUserHome}
          tier={tier}
          userGoals={userGoals}
          oppGoals={oppGoals}
          initial={initialForm}
          startingXi={firstHalfUser.starting_xi}
          bench={firstHalfUser.bench ?? []}
          onConfirm={runSecondHalf}
        />
      )}
    </>
  );
}

/** True once the match has second-half events (so the reveal no longer pauses).
 *  A first-half-only match ends with the HalfTime marker. */
function atHalfTimeResolved(match: Match): boolean {
  const last = match.events[match.events.length - 1];
  return last !== undefined && eventKindName(last.kind) !== "HalfTime";
}

/** Build a first-half-only Match from a snapshot for MatchReveal to animate.
 *  play_first_half returns a HalfTimeSnapshot carrying first_half_events; wrap
 *  it as a Match (result is the first-half score) so MatchReveal can consume it
 *  unchanged. */
function play_first_half_to_match(snapshot: any, home: Team, away: Team): Match {
  let h = 0;
  let a = 0;
  const events = (snapshot.first_half_events ?? []) as Match["events"];
  for (const e of events) {
    if (eventKindName(e.kind) === "Goal") {
      if (e.side === "Home") h++;
      else if (e.side === "Away") a++;
    }
  }
  return {
    home: home.id,
    away: away.id,
    seed: snapshot.seed as bigint,
    result: { home_goals: h, away_goals: a },
    events,
  };
}
