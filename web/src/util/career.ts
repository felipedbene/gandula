import { run_season } from "../wasm/gandula_wasm.js";
import { teamById } from "../teams";
import { points, type Player, type SeasonRecord, type Team } from "../types";
import {
  findUserDivisionIdxInSeason,
  type Career,
  type Division,
  type Season,
  type SeasonHistory,
} from "../persistence";
import { userOutcomeFromPRResult, type PRResult } from "./promotion";
import { computeSeasonFinances, type SeasonFinances } from "./finances";
import { ageRoster } from "./aging";
import { userTeam } from "./roster";

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
  /** Breakdown of money flow for the just-finished season. Surfaced so
   *  the UI can show line items without recomputing. */
  finances: SeasonFinances;
  /** The user's roster aged one season (E.2.a). The caller persists it as
   *  `Career.userRoster`; it's also what next season was simulated against. */
  agedUserRoster: Player[];
};

/**
 * Advance a career by one season. Composes four things:
 *
 *   1. Computes finances (ticket revenue / salaries / P/R bonus) for the
 *      just-finished season — needed both for the SeasonHistory record
 *      and so the caller can apply the delta to `career.manager.money`.
 *   2. Builds a `SeasonHistory` summarising the current season's outcome
 *      (champion of user's division, user's final position, P/R applied,
 *      moneyDelta / moneyAfter).
 *   3. Recomposes the two divisions by applying P/R: relegated teams
 *      move from A → B, promoted teams from B → A. Survivors stay put.
 *   4. Simulates next season's schedule + matches via `run_season` twice
 *      (once per tier), using a per-season seed namespace
 *      `career.seed XOR BigInt(nextYear)` so each (career, year)
 *      combination is deterministic and distinct.
 *
 * Caller (SeasonView.advanceToNextSeason) orchestrates:
 *   const pr = computePromotionRelegation(
 *     career.currentSeason,
 *     career.controlledTeamId,
 *   );
 *   const { history, nextSeason, finances } = advanceCareer(career, pr);
 *   const newCareer: Career = {
 *     ...career,
 *     seasons: [...career.seasons, history],
 *     currentSeason: nextSeason,
 *     // tickets/salaries accrue per round during the season; only the P/R
 *     // bonus is applied at the boundary.
 *     manager: { ...career.manager, money: career.manager.money + finances.prBonus },
 *   };
 *   await saveCareer(newCareer);
 *
 * Pure: no IDB, no mutation of inputs.
 */
export function advanceCareer(
  career: Career,
  prResult: PRResult,
): AdvanceResult {
  const userOutcome = userOutcomeFromPRResult(prResult);
  const finances = computeSeasonFinances(career, userOutcome);
  const history = buildSeasonHistory(career, prResult, userOutcome, finances);

  // E.2.a: age the user's squad one season before composing the next one, so
  // next season is simulated against the aged attributes. ageRoster(userTeam…)
  // also materializes a still-empty userRoster from the registry, so a
  // transfer-free career still ages.
  const agedUserRoster = ageRoster(userTeam(career).roster);
  const nextSeason = buildNextSeason(
    { ...career, userRoster: agedUserRoster },
    career.currentSeason,
    prResult,
  );
  return { history, nextSeason, finances, agedUserRoster };
}

/**
 * Compose the SeasonHistory for the just-finished season. All data
 * sourced from `career.currentSeason` plus the pre-computed PRResult,
 * userOutcome (derived once in advanceCareer), and finances.
 */
function buildSeasonHistory(
  career: Career,
  prResult: PRResult,
  userOutcome: "promoted" | "relegated" | "stayed",
  finances: SeasonFinances,
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
    // moneyDelta is the season's full P&L (the change over the season).
    // moneyAfter adds only the P/R bonus: tickets/salaries already accrued
    // into manager.money per round, so career.manager.money here is the
    // pre-bonus end-of-season balance.
    moneyDelta: finances.net,
    moneyAfter: career.manager.money + finances.prBonus,
    // Transfer-market activity that happened during this season is
    // surfaced into history as a non-empty array; skipped markets stay
    // `undefined` so HistoryCard can short-circuit cleanly. The market
    // phase always writes to `currentSeason.transfers`, even on
    // FECHAR-without-changes, so this branch is the source of truth.
    transfers:
      current.transfers.length > 0 ? current.transfers : undefined,
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

  // Substitute the user's team (wherever it ends up post-P/R) with the
  // userTeam() view so transfer-market activity (E.1.e+) flows through:
  // next season's run_season sees the bought/sold roster, not the
  // registry default. The substitution is a no-op when userRoster is
  // empty — userTeam falls back to the registry team.
  const userTeamWithRoster = userTeam(career);
  const useUserRosterIfControlled = (t: Team): Team =>
    t.id === career.controlledTeamId ? userTeamWithRoster : t;

  const tierATeams: Team[] = [...tierASurvivors, ...newPromoted].map(
    useUserRosterIfControlled,
  );
  const tierBTeams: Team[] = [...tierBSurvivors, ...newRelegated].map(
    useUserRosterIfControlled,
  );

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
    // transfers starts empty — mercado opens between this Season and the
    // NEXT, and writes accumulate into THIS season's `transfers` (E.1.e.2).
    transfers: [],
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
