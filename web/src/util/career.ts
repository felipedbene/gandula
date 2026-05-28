import { run_season } from "../wasm/gandula_wasm.js";
import { teamById } from "../teams";
import { points, type SeasonRecord, type Team } from "../types";
import {
  findUserDivisionIdxInSeason,
  type Career,
  type Division,
  type Season,
  type SeasonHistory,
} from "../persistence";
import type { PRResult } from "./promotion";

/**
 * Result of advancing the career one season. The caller (E.1.c.3 UI)
 * appends `history` to `career.seasons[]` and replaces `career.currentSeason`
 * with `nextSeason`. Splitting the return like this keeps the function
 * pure — it doesn't mutate the Career passed in.
 */
export type AdvanceResult = {
  /** Compact record of the just-finished season (the one in
   *  `career.currentSeason` before this call). */
  history: SeasonHistory;
  /** New in-progress season for the next year. Divisions are
   *  re-simulated end-to-end via run_season — schedule and matches are
   *  fresh, but team rosters carry over from the registry. */
  nextSeason: Season;
};

/**
 * Advance a career by one season. Composes three things:
 *
 *   1. Builds a `SeasonHistory` summarising the current season's outcome
 *      (champion of user's division, user's final position, P/R applied).
 *   2. Recomposes the two divisions by applying P/R: relegated teams
 *      move from A → B, promoted teams from B → A. Survivors stay put.
 *   3. Simulates next season's schedule + matches via `run_season` twice
 *      (once per tier), using a per-season seed namespace
 *      `career.seed XOR BigInt(nextYear)` so each (career, year)
 *      combination is deterministic and distinct.
 *
 * Caller (E.1.c.3) orchestrates:
 *   const prResult = computePromotionRelegation(
 *     career.currentSeason,
 *     career.controlledTeamId,
 *   );
 *   const { history, nextSeason } = advanceCareer(career, prResult);
 *   const newCareer: Career = {
 *     ...career,
 *     seasons: [...career.seasons, history],
 *     currentSeason: nextSeason,
 *   };
 *   await saveCareer(newCareer);
 *
 * Pure: no IDB, no mutation of inputs.
 */
export function advanceCareer(
  career: Career,
  prResult: PRResult,
): AdvanceResult {
  const history = buildSeasonHistory(career, prResult);
  const nextSeason = buildNextSeason(career, career.currentSeason, prResult);
  return { history, nextSeason };
}

/**
 * Compose the SeasonHistory for the just-finished season. All data
 * sourced from `career.currentSeason` plus the pre-computed PRResult.
 */
function buildSeasonHistory(
  career: Career,
  prResult: PRResult,
): SeasonHistory {
  const current = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(
    current,
    career.controlledTeamId,
  );
  const userDiv = current.divisions[userDivIdx];

  const userPosition =
    userDiv.record.standings.findIndex(
      (s) => s.team_id === career.controlledTeamId,
    ) + 1;
  const userStats = userDiv.record.standings[userPosition - 1];
  const userPoints = points(userStats);

  // Champion is always position 0 (standings sorted Pts desc by the engine).
  const championStats = userDiv.record.standings[0];
  const championTeamName =
    teamById(championStats.team_id)?.name ?? `Time ${championStats.team_id}`;

  const userOutcome: "promoted" | "relegated" | "stayed" = prResult.userPromoted
    ? "promoted"
    : prResult.userRelegated
      ? "relegated"
      : "stayed";

  return {
    year: current.year,
    userDivision: { tier: userDiv.tier, name: userDiv.name },
    userPosition,
    userPoints,
    champion: {
      tier: userDiv.tier,
      teamId: championStats.team_id,
      teamName: championTeamName,
    },
    promoted: prResult.promoted.map((s) => ({
      teamId: s.team_id,
      teamName: teamById(s.team_id)?.name ?? `Time ${s.team_id}`,
    })),
    relegated: prResult.relegated.map((s) => ({
      teamId: s.team_id,
      teamName: teamById(s.team_id)?.name ?? `Time ${s.team_id}`,
    })),
    userOutcome,
  };
}

/**
 * Compose the next Season by recomposing divisions and simulating them.
 *
 * Recomposition: take the current Série A standings, remove the
 * `relegated` teams; take Série B standings, remove the `promoted`
 * teams. Then put promoted into Série A and relegated into Série B.
 * Each tier's team COUNT is preserved (8 + 9), and the user's team
 * naturally ends up in whichever tier the P/R placed it.
 *
 * Team ORDER within each tier is survivors-first (by previous-season
 * standings position) then newcomers — deterministic and stable. The
 * order shapes the schedule run_season generates (different input order
 * → different home/away pairings per round), but matches are still
 * deterministic given the same input.
 */
function buildNextSeason(
  career: Career,
  current: Season,
  prResult: PRResult,
): Season {
  const tierAOld = current.divisions.find((d) => d.tier === 1);
  const tierBOld = current.divisions.find((d) => d.tier === 2);
  if (!tierAOld || !tierBOld) {
    throw new Error(
      "advanceCareer: current season must have both Série A and Série B",
    );
  }

  const promotedIds = new Set(prResult.promoted.map((s) => s.team_id));
  const relegatedIds = new Set(prResult.relegated.map((s) => s.team_id));

  const tierASurvivors: Team[] = tierAOld.record.standings
    .filter((s) => !relegatedIds.has(s.team_id))
    .map((s) => mustGetTeam(s.team_id));
  const tierBSurvivors: Team[] = tierBOld.record.standings
    .filter((s) => !promotedIds.has(s.team_id))
    .map((s) => mustGetTeam(s.team_id));

  const newPromoted: Team[] = prResult.promoted.map((s) =>
    mustGetTeam(s.team_id),
  );
  const newRelegated: Team[] = prResult.relegated.map((s) =>
    mustGetTeam(s.team_id),
  );

  const tierATeams: Team[] = [...tierASurvivors, ...newPromoted];
  const tierBTeams: Team[] = [...tierBSurvivors, ...newRelegated];

  // Invariant: division sizes must match the previous season. Mismatch
  // would mean PRResult was malformed or the standings were missing teams.
  if (tierATeams.length !== tierAOld.record.standings.length) {
    throw new Error(
      `advanceCareer: tier A size changed (${tierAOld.record.standings.length} → ${tierATeams.length})`,
    );
  }
  if (tierBTeams.length !== tierBOld.record.standings.length) {
    throw new Error(
      `advanceCareer: tier B size changed (${tierBOld.record.standings.length} → ${tierBTeams.length})`,
    );
  }

  const nextYear = current.year + 1;
  const seasonSeed = career.seed ^ BigInt(nextYear);

  const recordA = run_season(
    tierATeams,
    seasonSeed ^ 1n,
    "Série A",
  ) as SeasonRecord;
  const recordB = run_season(
    tierBTeams,
    seasonSeed ^ 2n,
    "Série B",
  ) as SeasonRecord;

  const divisions: Division[] = [
    { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
    { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
  ];

  return {
    year: nextYear,
    seed: seasonSeed,
    divisions,
    // userTactics intentionally undefined — fresh season, user reconfigures.
    // E.1.c discussion (decision 1.1): "uma temporada, uma tática".
  };
}

/**
 * Resolve a team id to its Team record from the JSON registry. Throws
 * because every team_id in a division's standings must correspond to a
 * registered team — a missing entry indicates the JSON registry was
 * rebuilt without that team and the save points to a stale id.
 */
function mustGetTeam(teamId: number): Team {
  const t = teamById(teamId);
  if (!t) {
    throw new Error(
      `advanceCareer: team ${teamId} not in registry — save references a team that no longer exists`,
    );
  }
  return t;
}
