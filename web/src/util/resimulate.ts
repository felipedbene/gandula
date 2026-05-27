import { play_match, derive_match_seed } from "../wasm/gandula_wasm.js";
import type { Match, Team } from "../types";
import { computeStandings } from "../types";
import { teamById } from "../teams";
import type { SavedSeason, UserTactics } from "../persistence";

/**
 * Apply user tactical overrides on top of a base team. Field substitution
 * (not deep merge) — UserTactics is always a complete object when defined,
 * so the four override fields just replace their counterparts.
 *
 * The `roster` is shared by reference: rosters are immutable in the JSON
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
 * Re-simulate every match in `saved.record` that involves the controlled
 * team at or after `fromRoundIdx`, using the given `userTactics`. Matches
 * that don't touch the user are left as-is: same seed, same teams, same
 * engine — they would re-simulate identically, so re-running them is wasted
 * work.
 *
 * Determinism: each fixture's match_seed is derived via
 * `derive_match_seed(saved.seed, i)` — same derivation the engine used the
 * first time, exposed via the D.1.a WASM binding. So replaying any single
 * fixture in isolation produces the same Match as the original run when
 * inputs are unchanged.
 *
 * Returned shape:
 *   - `record.matches`: same length and same index→fixture alignment as
 *     before; only the user-involving entries from `fromRoundIdx` onward
 *     are replaced.
 *   - `record.standings`: recomputed from scratch over the full new
 *     `matches[]` (the engine's compute_standings and `computeStandings`
 *     in types.ts mirror each other byte-for-byte on tiebreakers).
 *   - `userTactics`: populated with the provided override.
 *   - `savedAt`: bumped to now().
 *
 * Pure: does not touch IndexedDB. Caller is responsible for `saveSeason`
 * on the returned object.
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

  const newMatches: Match[] = saved.record.matches.slice();
  saved.record.fixtures.forEach((f, i) => {
    if (f.round < fromRoundIdx) return;
    const oldMatch = saved.record.matches[i];
    const isUserHome = oldMatch.home === saved.controlledTeamId;
    const isUserAway = oldMatch.away === saved.controlledTeamId;
    if (!isUserHome && !isUserAway) return;

    const opponentId = isUserHome ? oldMatch.away : oldMatch.home;
    const opponentTeam = teamById(opponentId);
    if (!opponentTeam) {
      throw new Error(`Opponent team ${opponentId} not found in registry`);
    }

    const matchSeed = derive_match_seed(saved.seed, i);
    const home = isUserHome ? effectiveUserTeam : opponentTeam;
    const away = isUserHome ? opponentTeam : effectiveUserTeam;
    newMatches[i] = play_match(home, away, matchSeed) as Match;
  });

  const totalRounds =
    saved.record.fixtures.length === 0
      ? 0
      : Math.max(...saved.record.fixtures.map((f) => f.round)) + 1;
  const teamIds = saved.record.standings.map((s) => s.team_id);
  const newStandings = computeStandings(
    newMatches,
    saved.record.fixtures,
    totalRounds,
    teamIds,
  );

  return {
    ...saved,
    savedAt: new Date().toISOString(),
    record: {
      ...saved.record,
      matches: newMatches,
      standings: newStandings,
    },
    userTactics,
  };
}
