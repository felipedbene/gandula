import {
  play_match,
  play_first_half,
  play_second_half,
  derive_match_seed,
} from "../wasm/gandula_wasm.js";
import type { Match, Team } from "../types";
import { computeStandings } from "../types";
import { teamById } from "../teams";
import { userTeam } from "./roster";
import { evolveTeam } from "./regen";
import { applyRivalCoach, rivalTactics } from "./rival-coach";
import {
  FIRST_YEAR,
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
 * The opponent's symmetric half-time tactical response: apply the distilled
 * per-tier rival tactic (formation + tactics) for the second half, keeping its
 * XI/bench. Deterministic by tier alone (no new entropy), so a re-sim or an F5
 * mid-reveal reconstructs the identical opponent — see `rivalTactics`. Exported
 * so the live half-time flow and the projection use the exact same team.
 */
export function applyRivalHalftime(opponent: Team, tier: 1 | 2 | 3): Team {
  const { formation, tactics } = rivalTactics(tier);
  return { ...opponent, formation, tactics };
}

/**
 * Re-simulate every match in the user's division at or after `fromRoundIdx`
 * that involves the controlled team, using the given `userTactics`. The
 * other division is untouched — tactical changes only ripple through the
 * user's own league. Matches that don't touch the user are also untouched:
 * same seed, same teams, same engine ⇒ identical result, re-running is
 * wasted work.
 *
 * Copa (E.3) is intentionally NOT touched here. This re-sims the user's
 * UPCOMING (unplayed) league rounds; the cup tie that shares a matchday is
 * also still unplayed, so there is nothing already-played to re-sim. The cup
 * tie is simulated exactly once — in SeasonView.playRound, when the matchday
 * is advanced — using whatever userTactics is live at that moment. So a
 * tactical change before a cup matchday is naturally reflected when the tie
 * plays, with no re-sim path needed.
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
  // userTeam swaps in career.userRoster when the user has bought/sold
  // since the season started; falls back to the registry default
  // otherwise. Always returns a Team — throws on a missing id, which
  // is a save invariant violation.
  const baseUserTeam = userTeam(career);
  const effectiveUserTeam = applyUserTactics(baseUserTeam, userTactics);

  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const divSeed = season.seed ^ BigInt(userDiv.tier);

  // Opponents the season was played against are the EVOLVED + COACHED registry
  // teams: buildNextSeason composes each as
  //   applyRivalCoach(evolveTeam(registry, elapsed, seed), tier, year, seed, elapsed)
  // (E.3.c.2). Re-simulating against the static registry — or against the merely
  // aged team without the coach's buys/tactic — would diverge, so a re-sim with
  // unchanged user tactics wouldn't reproduce the original result. Replay the
  // EXACT same composition here. The coach depends only on (tier, year, seed,
  // elapsed) — never last season's finish — precisely so this path can rebuild
  // the identical opponent without the prior standings. Opponents are in the
  // user's division, so their tier is `userDiv.tier`. Season 0 → elapsed 0 →
  // registry team, but the coach still runs (year/seed drive its buys).
  // Memoized: the user faces each opponent twice.
  const elapsed = season.year - FIRST_YEAR;
  const tier = userDiv.tier as 1 | 2 | 3;
  const evolvedCache = new Map<number, Team>();
  const liveOpponent = (id: number): Team => {
    const cached = evolvedCache.get(id);
    if (cached) return cached;
    const base = teamById(id);
    if (!base) {
      throw new Error(`Opponent team ${id} not found in registry`);
    }
    const evolved = evolveTeam(base, elapsed, career.seed);
    const coached = applyRivalCoach(evolved, tier, season.year, career.seed, elapsed);
    evolvedCache.set(id, coached);
    return coached;
  };

  const newMatches: Match[] = userDiv.record.matches.slice();
  userDiv.record.fixtures.forEach((f, i) => {
    if (f.round < fromRoundIdx) return;
    const oldMatch = userDiv.record.matches[i];
    const isUserHome = oldMatch.home === career.controlledTeamId;
    const isUserAway = oldMatch.away === career.controlledTeamId;
    if (!isUserHome && !isUserAway) return;

    const opponentId = isUserHome ? oldMatch.away : oldMatch.home;
    const opponentTeam = liveOpponent(opponentId);

    const matchSeed = derive_match_seed(divSeed, i);
    const home = isUserHome ? effectiveUserTeam : opponentTeam;
    const away = isUserHome ? opponentTeam : effectiveUserTeam;

    // A half-time tactical change confirmed at the interval for this round is
    // replayed deterministically: run the first half with the first-half
    // (`userTactics`) teams, then the second half with the user's half-time
    // tactics applied to their side (and the rival's symmetric half-time tactic
    // to the opponent). With NO half-time entry, the two-phase path is
    // byte-identical to play_match(90) — proven by the engine's half-split tests
    // — so unchanged rounds reproduce exactly.
    const htUser = season.halftimeTactics?.[f.round];
    if (!htUser) {
      newMatches[i] = play_match(home, away, matchSeed) as Match;
      return;
    }

    const snapshot = play_first_half(home, away, matchSeed);
    const htUserTeam = applyUserTactics(baseUserTeam, htUser);
    const htOpponentTeam = applyRivalHalftime(opponentTeam, tier);
    const home2 = isUserHome ? htUserTeam : htOpponentTeam;
    const away2 = isUserHome ? htOpponentTeam : htUserTeam;
    newMatches[i] = play_second_half(snapshot, home2, away2) as Match;
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
