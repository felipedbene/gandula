import { play_match, derive_match_seed } from "../wasm/gandula_wasm.js";
import type { Match, Team } from "../types";
import { computeStandings } from "../types";
import { teamById } from "../teams";
import {
  findUserDivisionIdx,
  totalRoundsOf,
  type Division,
  type SavedSeason,
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
 * seed namespace `saved.seed XOR BigInt(division.tier)`. The same XOR is
 * used at division creation (`run_season(tier, seed ^ tier, name)` in
 * SeasonView.run()), so calling `derive_match_seed(divSeed, i)` here
 * reproduces the engine's internal derivation exactly.
 *
 * Returned shape:
 *   - `divisions[userDivIdx].record.matches`: same length and index→fixture
 *     alignment; only the user-involving entries from fromRoundIdx onward
 *     are replaced.
 *   - `divisions[userDivIdx].record.standings`: recomputed from scratch
 *     over the full new matches[] (engine compute_standings and
 *     `computeStandings` mirror each other on tiebreakers).
 *   - other divisions: untouched.
 *   - `userTactics`: populated with the provided override.
 *   - `savedAt`: bumped to now().
 *
 * Pure: does not touch IndexedDB. Caller is responsible for `saveSeason`.
 */
export function resimulateFromRound(
  saved: SavedSeason,
  fromRoundIdx: number,
  userTactics: UserTactics,
): SavedSeason {
  const baseUserTeam = teamById(saved.controlledTeamId);
  if (!baseUserTeam) {
    throw new Error(
      `Controlled team ${saved.controlledTeamId} not found in registry`,
    );
  }
  const effectiveUserTeam = applyUserTactics(baseUserTeam, userTactics);

  const userDivIdx = findUserDivisionIdx(saved);
  const userDiv = saved.divisions[userDivIdx];
  const divSeed = saved.seed ^ BigInt(userDiv.tier);

  const newMatches: Match[] = userDiv.record.matches.slice();
  userDiv.record.fixtures.forEach((f, i) => {
    if (f.round < fromRoundIdx) return;
    const oldMatch = userDiv.record.matches[i];
    const isUserHome = oldMatch.home === saved.controlledTeamId;
    const isUserAway = oldMatch.away === saved.controlledTeamId;
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

  const newDivisions: Division[] = saved.divisions.slice();
  newDivisions[userDivIdx] = {
    ...userDiv,
    record: {
      ...userDiv.record,
      matches: newMatches,
      standings: newStandings,
    },
  };

  return {
    ...saved,
    savedAt: new Date().toISOString(),
    divisions: newDivisions,
    userTactics,
  };
}
