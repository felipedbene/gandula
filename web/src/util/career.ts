import { run_season } from "../wasm/gandula_wasm.js";
import { teamById } from "../teams";
import {
  points,
  type Player,
  type SeasonRecord,
  type Team,
  type TeamStats,
} from "../types";
import {
  FIRST_YEAR,
  findUserDivisionIdxInSeason,
  type Career,
  type Division,
  type Season,
  type SeasonHistory,
} from "../persistence";
import { userOutcomeFromPRResult, type PRResult } from "./promotion";
import { buildCopa, cupResultFor } from "./copa";
import {
  computeSeasonFinances,
  nextFanbase,
  nextMarketingMomentum,
  type SeasonFinances,
} from "./finances";
import { evolveTeam, evolveRoster } from "./regen";
import { applyRivalCoach } from "./rival-coach";
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
  /** The user's roster after one season of churn (E.2.a/E.2.c): every player
   *  aged, retirees (≥ RETIREMENT_AGE) replaced by same-position youth —
   *  symmetric with the opponent evolution. (Name kept for call-site stability;
   *  it's now evolved, not merely aged.) The caller persists it as
   *  `Career.userRoster`; it's also what next season was simulated against. */
  agedUserRoster: Player[];
  /** Fanbase for next season after the boundary drift (E.4.b.4). The caller
   *  writes it to `manager.fanbase`. */
  nextFanbase: number;
  /** Marketing momentum for next season after decay (E.4.b.5). The caller
   *  writes it to `manager.marketingMomentum`. */
  nextMarketingMomentum: number;
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
 *   3. Recomposes the three divisions by applying P/R across both boundaries
 *      (A↔B and B↔C): the middle tier shuffles in both directions, the top
 *      and bottom in one. Survivors stay put.
 *   4. Simulates next season's schedule + matches via `run_season` three
 *      times (once per tier), using a per-season seed namespace
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

  // E.2.a/E.2.c: churn the user's squad one season before composing the next
  // one, so next season is simulated against the evolved roster. evolveRoster
  // ages every player, retires those ≥ RETIREMENT_AGE, and replaces each with a
  // same-position youth — symmetric with the opponent evolution below (same
  // yearOffset, keyed on the controlled team id). It reads userTeam().roster,
  // which materializes a still-empty userRoster from the registry, so a
  // transfer-free career still ages and renews. userTeam() reconciles the XI on
  // read, so a retired starter can't leave next season's auto-sim short of 11.
  const elapsed = career.currentSeason.year + 1 - FIRST_YEAR;
  const agedUserRoster = evolveRoster(
    userTeam(career).roster,
    career.seed,
    career.controlledTeamId,
    elapsed,
  );
  const nextSeason = buildNextSeason(
    { ...career, userRoster: agedUserRoster },
    career.currentSeason,
    prResult,
  );

  // E.4.b.4: drift the fanbase toward the target for NEXT season's tier
  // (promotion pulls toward the higher target immediately), adjusted by where
  // the club just finished. Capacity carries forward untouched (caller spreads
  // the existing manager).
  const finishedTier = history.userDivision.tier;
  const nextTier = (
    userOutcome === "promoted"
      ? finishedTier - 1
      : userOutcome === "relegated"
        ? finishedTier + 1
        : finishedTier
  ) as 1 | 2 | 3;
  // E.4.b.5: the drift target is lifted by marketing momentum (so paid
  // campaigns persist), and momentum itself decays toward 0 each season.
  const nextFanbaseValue = nextFanbase(
    career.manager.fanbase,
    nextTier,
    history.userPosition,
    career.manager.marketingMomentum,
  );
  const nextMomentum = nextMarketingMomentum(career.manager.marketingMomentum);

  return {
    history,
    nextSeason,
    finances,
    agedUserRoster,
    nextFanbase: nextFanbaseValue,
    nextMarketingMomentum: nextMomentum,
  };
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
    // History records all movement across both boundaries (B→A + C→B for
    // promoted, A→B + B→C for relegated) so HistoryCard can show the full
    // season's churn, not just the user's tier.
    promoted: [...prResult.promotedBtoA, ...prResult.promotedCtoB].map((s) => ({
      teamId: s.team_id,
      teamName: teamById(s.team_id)?.name ?? `Time ${s.team_id}`,
    })),
    relegated: [...prResult.relegatedAtoB, ...prResult.relegatedBtoC].map(
      (s) => ({
        teamId: s.team_id,
        teamName: teamById(s.team_id)?.name ?? `Time ${s.team_id}`,
      }),
    ),
    userOutcome,
    // moneyDelta is the season's full P&L (the change over the season).
    // moneyAfter adds the BOUNDARY pieces (P/R bonus + placement prize); the
    // per-round pieces (gate + TV + match bonuses − salaries) and the cup
    // prize already accrued into manager.money during the season, so
    // career.manager.money here is the pre-boundary end-of-season balance.
    moneyDelta: finances.net,
    moneyAfter:
      career.manager.money + finances.prBonus + finances.placementPrize,
    // Transfer-market activity that happened during this season is
    // surfaced into history as a non-empty array; skipped markets stay
    // `undefined` so HistoryCard can short-circuit cleanly. The market
    // phase always writes to `currentSeason.transfers`, even on
    // FECHAR-without-changes, so this branch is the source of truth.
    transfers:
      current.transfers.length > 0 ? current.transfers : undefined,
    // Copa do Brasil (E.3): the season's cup champion and how far the user
    // got. Both undefined if the cup didn't finish (shouldn't happen at a
    // season boundary, but keeps the record honest).
    copaChampionId: current.copa.championId,
    copaUserResult: cupResultFor(current.copa, career.controlledTeamId),
  };
}

/**
 * Compose the next Season by recomposing the three divisions across the two
 * P/R boundaries and simulating them.
 *
 * Recomposition, each tier kept at exactly 20:
 *   - Série A next = (A survivors − relegatedAtoB) ++ promotedBtoA.
 *   - Série B next = (B survivors − promotedBtoA − relegatedBtoC)
 *                    ++ relegatedAtoB ++ promotedCtoB   ← the 3-way shuffle.
 *   - Série C next = (C survivors − promotedCtoB) ++ relegatedBtoC.
 *
 * The user's team naturally ends up in whichever tier the P/R placed it.
 *
 * Team ORDER within each tier is survivors-first (by previous-season standings
 * position) then incomers — deterministic and stable. The order shapes the
 * schedule run_season generates, but matches stay deterministic given the same
 * input.
 */
function buildNextSeason(
  career: Career,
  current: Season,
  prResult: PRResult,
): Season {
  const tierAOld = current.divisions.find((d) => d.tier === 1);
  const tierBOld = current.divisions.find((d) => d.tier === 2);
  const tierCOld = current.divisions.find((d) => d.tier === 3);
  if (!tierAOld || !tierBOld || !tierCOld) {
    throw new Error(
      "advanceCareer: current season must have Série A, B and C",
    );
  }

  // E.2.a.2 / E.2.b: opponents reset to the immutable registry each season, so
  // we replay their evolution from the registry base by the elapsed-season
  // count — aging plus retire/youth/rebuild (evolveTeam) — so the league ages
  // AND refreshes rather than only decaying. The controlled team is left as the
  // (already-aged) userTeam view; the user refreshes via the market.
  const userTeamWithRoster = userTeam(career);
  const elapsed = current.year + 1 - FIRST_YEAR;

  // E.3.c.2: opponents are now policy-distilled "coaches". After the registry
  // re-evolution (aging/regen), each opponent gets the per-tier distilled
  // tactic + a stateless transfer budget and buys squad upgrades, so the league
  // genuinely strengthens rather than only aging. The user's club is untouched
  // (they shop the market themself). The coach depends only on (nextTier, year,
  // seed, elapsed) — NOT last season's finish — so the re-simulation path can
  // reconstruct the identical coached opponent (see resimulate.ts `liveOpponent`).
  const composeTeam = (t: Team, nextTier: 1 | 2 | 3): Team => {
    if (t.id === career.controlledTeamId) return userTeamWithRoster;
    const evolved = evolveTeam(t, elapsed, career.seed);
    return applyRivalCoach(evolved, nextTier, current.year + 1, career.seed, elapsed);
  };

  // Recompose one tier: survivors (current standings minus everyone leaving)
  // in finishing order, then the incoming teams. Resolves ids to Team records
  // and applies composeTeam (with the destination tier) so the user/opponent
  // evolution + coaching flows through.
  const recompose = (
    oldDiv: Division,
    leaving: TeamStats[],
    incoming: TeamStats[],
    nextTier: 1 | 2 | 3,
  ): Team[] => {
    const leavingIds = new Set(leaving.map((s) => s.team_id));
    const survivors = oldDiv.record.standings.filter(
      (s) => !leavingIds.has(s.team_id),
    );
    const teams = [...survivors, ...incoming].map((s) =>
      composeTeam(mustGetTeam(s.team_id), nextTier),
    );
    // Invariant: tier size unchanged. Mismatch means PRResult was malformed
    // or standings were missing teams. The middle tier (3-way shuffle) is the
    // one most worth guarding.
    if (teams.length !== oldDiv.record.standings.length) {
      throw new Error(
        `advanceCareer: ${oldDiv.name} size changed (${oldDiv.record.standings.length} → ${teams.length})`,
      );
    }
    return teams;
  };

  const tierATeams = recompose(
    tierAOld,
    prResult.relegatedAtoB,
    prResult.promotedBtoA,
    1,
  );
  const tierBTeams = recompose(
    tierBOld,
    [...prResult.promotedBtoA, ...prResult.relegatedBtoC],
    [...prResult.relegatedAtoB, ...prResult.promotedCtoB],
    2,
  );
  const tierCTeams = recompose(
    tierCOld,
    prResult.promotedCtoB,
    prResult.relegatedBtoC,
    3,
  );

  const nextYear = current.year + 1;
  const seasonSeed = career.seed ^ BigInt(nextYear);

  const recordA = run_season(tierATeams, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierBTeams, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierCTeams, seasonSeed ^ 3n, "Série C") as SeasonRecord;

  const divisions: Division[] = [
    { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
    { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
    { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
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
    // A fresh Copa bracket each season (drawn, no rounds played). The cup
    // seed derives from this season's seed, so each year's draw differs.
    // Seed the bracket from the NEXT season's composed sides (the three tiers
    // above already aged each club to nextYear, applied the rival coach, and
    // swapped in the user's roster), so the draw reflects the living, coached
    // world rather than the static registry.
    copa: buildCopa([...tierATeams, ...tierBTeams, ...tierCTeams]),
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
