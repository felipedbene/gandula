import { play_match, derive_match_seed } from "../wasm/gandula_wasm.js";
import type { Match, Team } from "../types";
import { computeStandings } from "../types";
import { teamById } from "../teams";
import {
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
  type Division,
  type UserTactics,
} from "../persistence";

/**
 * Apply user tactical overrides on top of a base team. Field substitution
 * (not deep merge) — UserTactics is always a complete object when defined,
 * so the four override fields just replace their counterparts.
 *
 * `roster` is shared by reference: rosters are immutable in the JSON
 * registry, no need to clone.
 */
export function applyUserTactics(baseTeam: Team, override: UserTactics): Team {
  return {
    ...baseTeam,
    formation: override.formation,
    tactics: override.tactics,
    starting_xi: override.starting_xi,
    bench: override.bench,
  };
}

/**
 * Re-simulate every match in the user's division at or after `fromRoundIdx`
 * that involves the controlled team, using the given `userTactics`. The
 * other division is untouched — tactical changes only ripple through the
 * user's own league. Matches that don't touch the user are also untouched:
 * same seed, same teams, same engine ⇒ identical result, re-running is
 * wasted work.
 *
 * Determinism: each fixture's match_seed is derived from a per-division
 * seed namespace `currentSeason.seed XOR BigInt(division.tier)`. The same
 * XOR is used at division creation (`run_season(tier, seasonSeed ^ tier,
 * name)` in SeasonView.run() and advanceCareer), so calling
 * `derive_match_seed(divSeed, i)` here reproduces the engine's internal
 * derivation exactly.
 *
 * Returned shape: a new Career with `currentSeason.divisions[userDivIdx]`
 * carrying the re-simulated matches/standings and `currentSeason.userTactics`
 * populated. Other divisions, finished seasons, and career metadata stay
 * by reference. `savedAt` is bumped to now().
 *
 * Pure: does not touch IndexedDB. Caller is responsible for `saveCareer`.
 */
export function resimulateFromRound(
  career: Career,
  fromRoundIdx: number,
  userTactics: UserTactics,
): Career {
  const baseUserTeam = teamById(career.controlledTeamId);
  if (!baseUserTeam) {
    throw new Error(
      `Controlled team ${career.controlledTeamId} not found in registry`,
    );
  }
  const effectiveUserTeam = applyUserTactics(baseUserTeam, userTactics);

  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const divSeed = season.seed ^ BigInt(userDiv.tier);

  const newMatches: Match[] = userDiv.record.matches.slice();
  userDiv.record.fixtures.forEach((f, i) => {
    if (f.round < fromRoundIdx) return;
    const oldMatch = userDiv.record.matches[i];
    const isUserHome = oldMatch.home === career.controlledTeamId;
    const isUserAway = oldMatch.away === career.controlledTeamId;
    if (!isUserHome && !isUserAway) return;

    const opponentId = isUserHome ? oldMatch.away : oldMatch.home;
    const opponentTeam = teamById(opponentId);
    if (!opponentTeam) {
      throw new Error(`Opponent team ${opponentId} not found in registry`);
    }

    const matchSeed = derive_match_seed(divSeed, i);
    const home = isUserHome ? effectiveUserTeam : opponentTeam;
    const away = isUserHome ? opponentTeam : effectiveUserTeam;
    newMatches[i] = play_match(home, away, matchSeed) as Match;
  });

  const totalRounds = totalRoundsOf(userDiv);
  const teamIds = userDiv.record.standings.map((s) => s.team_id);
  const newStandings = computeStandings(
    newMatches,
    userDiv.record.fixtures,
    totalRounds,
    teamIds,
  );

  const newDivisions: Division[] = season.divisions.slice();
  newDivisions[userDivIdx] = {
    ...userDiv,
    record: {
      ...userDiv.record,
      matches: newMatches,
      standings: newStandings,
    },
  };

  return {
    ...career,
    savedAt: new Date().toISOString(),
    currentSeason: {
      ...season,
      divisions: newDivisions,
      userTactics,
    },
  };
}
