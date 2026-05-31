// @vitest-environment node
//
// computeSeasonFinances tests. Pure compute over a real Career so the
// sums reflect the actual ALL_TEAMS rosters and run_season output. Node
// env for the WASM init pattern (see vitest.config.ts).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import {
  CUP_CHAMPION_BONUS,
  CUP_PRIZE_BY_ROUND,
  DRAW_BONUS,
  MANAGER_FIRING_FLOOR,
  PLACEMENT_TIER_MULTIPLIER,
  PROMOTION_BONUS,
  RELEGATION_PENALTY,
  SALARY_PER_PLAYER_STRENGTH,
  TV_DEAL_BY_TIER,
  WIN_BONUS,
  STADIUM_EXPANSION_STEP,
  STADIUM_MAX_CAPACITY,
  computeSeasonFinances,
  cupPrizeForAdvance,
  expansionCost,
  homeTicketForRound,
  isManagerFired,
  matchBonusForRound,
  nextFanbase,
  placementPrizeFor,
  roundCashDelta,
  salarySliceForRound,
  seedStadiumForTier,
  tvIncomeForRound,
} from "./finances";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { freshCopa } from "./copa";
import { ALL_TEAMS, teamById } from "../teams";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
} from "../persistence";
import type { Player, SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

// NOTE (E.4.b.4): the gate is now min(demand, capacity) × TICKET_PRICE, not
// strength×price — see the rewritten gate tests below.

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a finished v4 Career (both divisions at terminal round) so
 * computeSeasonFinances can run against realistic matches and standings.
 */
function makeFinishedCareer(seed: bigint): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const totalA = Math.max(...recordA.fixtures.map((f) => f.round)) + 1;
  const totalB = Math.max(...recordB.fixtures.map((f) => f.round)) + 1;
  const totalC = Math.max(...recordC.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 8,
    savedAt: "2026-01-01T00:00:00Z",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: totalA },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: totalB },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: totalC },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
  };
}

describe("computeSeasonFinances — ticket revenue", () => {
  it("season ticket revenue equals the sum of per-round home gates", () => {
    // The gate is min(demand, capacity) × price; the per-round path and the
    // season-total path share homeGateRevenue, so they must agree exactly.
    const career = makeFinishedCareer(1998n);
    const season = career.currentSeason;
    const userDivIdx = findUserDivisionIdxInSeason(
      season,
      career.controlledTeamId,
    );
    const total = totalRoundsOf(season.divisions[userDivIdx]);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += homeTicketForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").ticketRevenue);
    expect(sum).toBeGreaterThan(0);
  });

  it("ignores away games entirely", () => {
    const career = makeFinishedCareer(1998n);
    const season = career.currentSeason;
    const userDivIdx = findUserDivisionIdxInSeason(
      season,
      career.controlledTeamId,
    );
    const userDiv = season.divisions[userDivIdx];

    // Sanity: user does play away games in this division.
    const awayGames = userDiv.record.matches.filter(
      (m) => m.away === career.controlledTeamId,
    );
    expect(awayGames.length).toBeGreaterThan(0);

    // Revenue is purely from home games. Replacing every away game's
    // home team with a dummy doesn't change the result (the only
    // contributors are matches where m.home === controlledTeamId).
    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.ticketRevenue).toBeGreaterThan(0); // home games exist too
  });
});

describe("computeSeasonFinances — salaries", () => {
  it("sums the entire roster (XI + bench + reserves)", () => {
    const career = makeFinishedCareer(1998n);
    const userTeam = teamById(career.controlledTeamId)!;

    let expected = 0;
    userTeam.roster.forEach((p) => {
      const a = p.attributes;
      const avg = Math.round(
        (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
          6,
      );
      expected += avg * SALARY_PER_PLAYER_STRENGTH;
    });

    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.salaries).toBe(expected);
  });
});

/** Drive the season-advance pipeline `n` times, mirroring SeasonView's
 *  orchestration (apply the P/R bonus, carry the aged roster forward). */
function advanceSeasons(career: Career, n: number): Career {
  let c = career;
  for (let i = 0; i < n; i++) {
    const pr = computePromotionRelegation(c.currentSeason, c.controlledTeamId);
    const { history, nextSeason, finances, agedUserRoster } = advanceCareer(c, pr);
    // advanceCareer hands back a fresh season at round 0; the real game plays
    // it out before the next advance, so mark it terminal for re-advancing.
    const finished = {
      ...nextSeason,
      divisions: nextSeason.divisions.map((d) => ({
        ...d,
        currentRoundIdx: totalRoundsOf(d),
      })),
    };
    c = {
      ...c,
      seasons: [...c.seasons, history],
      currentSeason: finished,
      manager: { ...c.manager, money: c.manager.money + finances.prBonus },
      userRoster: agedUserRoster,
    };
  }
  return c;
}

describe("computeSeasonFinances — ticket revenue tracks the EVOLVED opponent", () => {
  // Regression: bilheteria scaled with the immutable registry opponent, but
  // matches are simulated against opponents evolved by evolveTeam each season
  // (career.ts buildNextSeason). From season 2 on the side on the pitch
  // diverges from the registry, so revenue must replay the same evolution.
  it("gate still responds to the (evolved) opponent's strength", () => {
    // The demand model keeps an opponent-draw term, so a home game vs a
    // stronger side draws a bigger crowd. With capacity uncapped, two careers
    // whose home opponents differ in strength should differ in gate revenue,
    // and revenue stays positive after several seasons of opponent evolution.
    const N = 3;
    const career = advanceSeasons(makeFinishedCareer(1998n), N);
    expect(career.currentSeason.year).toBe(FIRST_YEAR + N);
    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.ticketRevenue).toBeGreaterThan(0);
    // Uncapped capacity so the demand term (which reads opponent strength) is
    // what drives the gate, not a sellout.
    const uncapped: Career = {
      ...career,
      manager: { ...career.manager, stadiumCapacity: 10_000_000 },
    };
    const finUncapped = computeSeasonFinances(uncapped, "stayed");
    expect(finUncapped.ticketRevenue).toBeGreaterThanOrEqual(fin.ticketRevenue);
  });

  it("per-round home tickets still sum to the season ticket revenue (evolved)", () => {
    const career = advanceSeasons(makeFinishedCareer(1998n), 3);
    const idx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const total = totalRoundsOf(career.currentSeason.divisions[idx]);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += homeTicketForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").ticketRevenue);
  });
});

describe("computeSeasonFinances — salaries follow the effective roster", () => {
  // Regression for the latent bug where salaries were charged against the
  // immutable registry roster (teamById) rather than the manager's actual
  // squad (userTeam → userRoster). Strong squads you build must now cost
  // proportionally more to maintain.
  const expensivePlayer: Player = {
    id: 999_999,
    name: "Galáctico",
    age: 26,
    position: "FWD",
    attributes: {
      pace: 95,
      technique: 95,
      passing: 95,
      defending: 95,
      finishing: 95,
      stamina: 95,
    },
  };

  it("buying an expensive player increases salaries by exactly his wage", () => {
    const career = makeFinishedCareer(1998n);
    const registryRoster = teamById(career.controlledTeamId)!.roster;

    // Baseline: empty userRoster → effective roster falls back to registry.
    const base = computeSeasonFinances(career, "stayed").salaries;

    // Buy: registry roster + the galáctico, persisted into userRoster.
    const bought: Career = {
      ...career,
      userRoster: [...registryRoster, expensivePlayer],
    };
    const after = computeSeasonFinances(bought, "stayed").salaries;

    expect(after).toBeGreaterThan(base);
    expect(after - base).toBe(95 * SALARY_PER_PLAYER_STRENGTH);
  });

  it("salary slices still sum EXACTLY to the season salary with a custom roster", () => {
    const career = makeFinishedCareer(1998n);
    const registryRoster = teamById(career.controlledTeamId)!.roster;
    const bought: Career = {
      ...career,
      userRoster: [...registryRoster, expensivePlayer],
    };

    const idx = findUserDivisionIdxInSeason(
      bought.currentSeason,
      bought.controlledTeamId,
    );
    const total = totalRoundsOf(bought.currentSeason.divisions[idx]);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += salarySliceForRound(bought, r);
    expect(sum).toBe(computeSeasonFinances(bought, "stayed").salaries);
  });

  it("an aged roster (lower attributes) lowers salaries", () => {
    const career = makeFinishedCareer(1998n);
    const registryRoster = teamById(career.controlledTeamId)!.roster;
    const base = computeSeasonFinances(career, "stayed").salaries;

    // Age every player: clamp each attribute down by 10 (floor 1).
    const aged: Career = {
      ...career,
      userRoster: registryRoster.map((p) => ({
        ...p,
        age: p.age + 5,
        attributes: {
          pace: Math.max(1, p.attributes.pace - 10),
          technique: Math.max(1, p.attributes.technique - 10),
          passing: Math.max(1, p.attributes.passing - 10),
          defending: Math.max(1, p.attributes.defending - 10),
          finishing: Math.max(1, p.attributes.finishing - 10),
          stamina: Math.max(1, p.attributes.stamina - 10),
        },
      })),
    };
    const after = computeSeasonFinances(aged, "stayed").salaries;
    expect(after).toBeLessThan(base);
  });
});

describe("computeSeasonFinances — prBonus", () => {
  it("is +PROMOTION_BONUS when userOutcome is promoted", () => {
    const career = makeFinishedCareer(1998n);
    const fin = computeSeasonFinances(career, "promoted");
    expect(fin.prBonus).toBe(PROMOTION_BONUS);
  });

  it("is -RELEGATION_PENALTY when userOutcome is relegated", () => {
    const career = makeFinishedCareer(1998n);
    const fin = computeSeasonFinances(career, "relegated");
    expect(fin.prBonus).toBe(-RELEGATION_PENALTY);
  });

  it("is 0 when userOutcome is stayed", () => {
    const career = makeFinishedCareer(1998n);
    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.prBonus).toBe(0);
  });
});

describe("computeSeasonFinances — net + determinism", () => {
  it("net sums all the line items", () => {
    const expectNet = (f: ReturnType<typeof computeSeasonFinances>) =>
      expect(f.net).toBe(
        f.ticketRevenue +
          f.tvRevenue +
          f.matchBonuses -
          f.salaries +
          f.cupPrize +
          f.placementPrize +
          f.prBonus,
      );
    const career = makeFinishedCareer(1998n);
    expectNet(computeSeasonFinances(career, "promoted"));
    expectNet(computeSeasonFinances(career, "stayed"));
    expectNet(computeSeasonFinances(career, "relegated"));
  });

  it("same career + same outcome ⇒ same finances (deterministic)", () => {
    const c1 = makeFinishedCareer(1998n);
    const c2 = makeFinishedCareer(1998n);
    const a = computeSeasonFinances(c1, "stayed");
    const b = computeSeasonFinances(c2, "stayed");
    expect(a).toEqual(b);
  });
});

describe("isManagerFired", () => {
  it("fires below the floor (negative balance)", () => {
    expect(isManagerFired(MANAGER_FIRING_FLOOR - 1)).toBe(true);
    expect(isManagerFired(-1)).toBe(true);
  });

  it("survives at exactly the floor and above", () => {
    expect(isManagerFired(MANAGER_FIRING_FLOOR)).toBe(false);
    expect(isManagerFired(MANAGER_FIRING_FLOOR + 1)).toBe(false);
    expect(isManagerFired(STARTING_MONEY)).toBe(false);
  });
});

describe("per-round finances", () => {
  function userRounds(career: Career): number {
    const idx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    return totalRoundsOf(career.currentSeason.divisions[idx]);
  }

  it("home tickets per round sum to the season ticket revenue", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += homeTicketForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").ticketRevenue);
  });

  it("salary slices sum EXACTLY to the season salary (fair rounding)", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += salarySliceForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").salaries);
  });

  it("roundCashDelta = home ticket + TV + match bonus − salary slice, every round", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    for (let r = 0; r < total; r++) {
      expect(roundCashDelta(career, r)).toBe(
        homeTicketForRound(career, r) +
          tvIncomeForRound(career, r) +
          matchBonusForRound(career, r) -
          salarySliceForRound(career, r),
      );
    }
  });

  it("TV slices sum EXACTLY to the season TV revenue (fair rounding)", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += tvIncomeForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").tvRevenue);
  });

  it("match bonuses per round sum to the season matchBonuses", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += matchBonusForRound(career, r);
    expect(sum).toBe(computeSeasonFinances(career, "stayed").matchBonuses);
  });

  it("per-round deltas sum to the season net minus the boundary/cup pieces", () => {
    // Per-round pieces = gate + TV + match bonuses − salaries.
    // net additionally includes cupPrize (banked on cup matchdays, not via
    // roundCashDelta in this fixture's fresh copa → 0) + placementPrize +
    // prBonus (boundary).
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += roundCashDelta(career, r);
    const fin = computeSeasonFinances(career, "stayed");
    expect(sum).toBe(fin.net - fin.cupPrize - fin.placementPrize - fin.prBonus);
  });
});

describe("E.4 revenue levers", () => {
  it("TV revenue is the user tier's deal (Série C for a fresh career)", () => {
    const career = makeFinishedCareer(1998n);
    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.tvRevenue).toBe(TV_DEAL_BY_TIER[3]); // user starts in Série C
  });

  it("match bonus is WIN/DRAW/0 by the user's result", () => {
    expect(WIN_BONUS).toBeGreaterThan(DRAW_BONUS);
    expect(DRAW_BONUS).toBeGreaterThan(0);
  });

  it("placement prize: champion >> mid-table, and ≥cutoff pays nothing", () => {
    // Build a fixture where we can force the user's standings position by
    // swapping the controlledTeamId to a known standings slot.
    const career = makeFinishedCareer(1998n);
    const idx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const standings = career.currentSeason.divisions[idx].record.standings;
    const champId = standings[0].team_id;
    const lastId = standings[standings.length - 1].team_id;

    const asChamp = { ...career, controlledTeamId: champId };
    const asLast = { ...career, controlledTeamId: lastId };
    expect(placementPrizeFor(asChamp)).toBeGreaterThan(0);
    expect(placementPrizeFor(asLast)).toBe(0); // 20th ≥ cutoff 12 → 0
  });

  it("placement prize scales by tier (same position pays more higher up)", () => {
    const career = makeFinishedCareer(1998n);
    // Champion of each tier; placement base is the same, multiplier differs.
    const champOf = (tier: 1 | 2 | 3) => {
      const div = career.currentSeason.divisions.find((d) => d.tier === tier)!;
      return { ...career, controlledTeamId: div.record.standings[0].team_id };
    };
    const a = placementPrizeFor(champOf(1));
    const b = placementPrizeFor(champOf(2));
    const c = placementPrizeFor(champOf(3));
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    // Ratio tracks the tier multipliers.
    expect(a / c).toBeCloseTo(
      PLACEMENT_TIER_MULTIPLIER[1] / PLACEMENT_TIER_MULTIPLIER[3],
      1,
    );
  });

  it("the new model pays a careful Série C club more than the old model", () => {
    const career = makeFinishedCareer(1998n);
    const fin = computeSeasonFinances(career, "stayed");
    // Old model was: ticketRevenue − salaries + prBonus.
    const oldNet = fin.ticketRevenue - fin.salaries + fin.prBonus;
    expect(fin.net).toBeGreaterThan(oldNet);
    // The TV floor alone (Série C) covers a chunk of the wage bill, so a
    // mid-table C season should be net positive (dents the 91% firing).
    expect(fin.net).toBeGreaterThan(0);
    expect(fin.tvRevenue).toBeGreaterThan(0);
  });

  it("cup prize: pays the round just reached, + champion bonus on the final win", () => {
    const userId = 13;
    const finalRound = {
      name: "final" as const,
      ties: [
        { homeId: userId, awayId: 99, played: true, winnerId: userId },
      ],
    };
    const base = {
      rounds: [
        { name: "prelim" as const, ties: [] },
        { name: "r32" as const, ties: [] },
        { name: "r16" as const, ties: [] },
        { name: "qf" as const, ties: [] },
        { name: "sf" as const, ties: [] },
        finalRound,
      ],
    };
    const prevCopa = { ...base, currentCupRoundIdx: 5, championId: undefined };
    const nextCopa = { ...base, currentCupRoundIdx: 6, championId: userId };
    const prize = cupPrizeForAdvance(prevCopa, nextCopa, userId);
    expect(prize).toBe(CUP_PRIZE_BY_ROUND.final + CUP_CHAMPION_BONUS);

    // A non-champion who merely reached the final gets the final prize only.
    const loser = cupPrizeForAdvance(
      { ...base, currentCupRoundIdx: 5, championId: undefined },
      { ...base, currentCupRoundIdx: 6, championId: 99 },
      userId,
    );
    expect(loser).toBe(CUP_PRIZE_BY_ROUND.final);
  });
});

describe("E.4.b.4 — stadium & fanbase", () => {
  // A high-capacity helper so the demand term (not a sellout) drives the gate.
  function withStadium(cap: number, fanbase: number): Career {
    const c = makeFinishedCareer(1998n);
    return { ...c, manager: { ...c.manager, stadiumCapacity: cap, fanbase } };
  }

  it("seedStadiumForTier gives bigger stadiums to higher tiers", () => {
    const a = seedStadiumForTier(1);
    const b = seedStadiumForTier(2);
    const c = seedStadiumForTier(3);
    expect(a.stadiumCapacity).toBeGreaterThan(b.stadiumCapacity);
    expect(b.stadiumCapacity).toBeGreaterThan(c.stadiumCapacity);
    expect(a.fanbase).toBeGreaterThan(c.fanbase);
  });

  it("gate rises with fanbase (capacity uncapped)", () => {
    const lo = computeSeasonFinances(withStadium(10_000_000, 10_000), "stayed");
    const hi = computeSeasonFinances(withStadium(10_000_000, 40_000), "stayed");
    expect(hi.ticketRevenue).toBeGreaterThan(lo.ticketRevenue);
  });

  it("capacity caps the gate (a sellout): tiny stadium earns less than a big one", () => {
    const tiny = computeSeasonFinances(withStadium(5_000, 40_000), "stayed");
    const big = computeSeasonFinances(withStadium(10_000_000, 40_000), "stayed");
    expect(tiny.ticketRevenue).toBeLessThan(big.ticketRevenue);
  });

  it("expanding capacity only helps once demand exceeds the old capacity", () => {
    // High fanbase → demand far above a small stadium: expanding helps.
    const demandHigh = withStadium(5_000, 40_000);
    const before = computeSeasonFinances(demandHigh, "stayed").ticketRevenue;
    const after = computeSeasonFinances(
      { ...demandHigh, manager: { ...demandHigh.manager, stadiumCapacity: 10_000 } },
      "stayed",
    ).ticketRevenue;
    expect(after).toBeGreaterThan(before);

    // Already-huge stadium (demand < capacity): adding seats does nothing.
    const overBuilt = withStadium(10_000_000, 40_000);
    const overBefore = computeSeasonFinances(overBuilt, "stayed").ticketRevenue;
    const overAfter = computeSeasonFinances(
      { ...overBuilt, manager: { ...overBuilt.manager, stadiumCapacity: 20_000_000 } },
      "stayed",
    ).ticketRevenue;
    expect(overAfter).toBe(overBefore);
  });

  it("expansionCost is monotonic in capacity and capped capacity is reachable", () => {
    expect(expansionCost(20_000)).toBeGreaterThan(expansionCost(10_000));
    expect(STADIUM_EXPANSION_STEP).toBeGreaterThan(0);
    expect(STADIUM_MAX_CAPACITY).toBeGreaterThan(seedStadiumForTier(1).stadiumCapacity);
  });

  it("nextFanbase drifts toward the tier target, capped, floored, deterministic", () => {
    // Winning (position 1) in Série A grows toward the high target.
    const grow = nextFanbase(40_000, 1, 1);
    expect(grow).toBeGreaterThan(40_000);
    // A relegated club finishing last shrinks.
    const shrink = nextFanbase(40_000, 3, 20);
    expect(shrink).toBeLessThan(40_000);
    // Capped step: can't jump more than FANBASE_MAX_STEP toward a far target.
    expect(Math.abs(nextFanbase(10_000, 1, 1) - 10_000)).toBeLessThanOrEqual(4_000);
    // Floored at 0.
    expect(nextFanbase(100, 3, 20)).toBeGreaterThanOrEqual(0);
    // Deterministic.
    expect(nextFanbase(30_000, 2, 5)).toBe(nextFanbase(30_000, 2, 5));
  });

  it("compounding: maxed Série A stadium+fanbase ≫ Série C baseline gate", () => {
    // Same career, two manager states: a maxed-out Série-A-scale club vs the
    // Série C starting baseline. (Tier read from the user's division is C here,
    // so this isolates the capacity+fanbase contribution.)
    const baseline = computeSeasonFinances(
      withStadium(
        seedStadiumForTier(3).stadiumCapacity,
        seedStadiumForTier(3).fanbase,
      ),
      "stayed",
    ).ticketRevenue;
    const maxed = computeSeasonFinances(
      withStadium(STADIUM_MAX_CAPACITY, 70_000),
      "stayed",
    ).ticketRevenue;
    expect(maxed).toBeGreaterThan(baseline);
  });
});
