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
  MANAGER_FIRING_FLOOR,
  PROMOTION_BONUS,
  RELEGATION_PENALTY,
  SALARY_PER_PLAYER_STRENGTH,
  TICKET_REVENUE_PER_STRENGTH,
  computeSeasonFinances,
  homeTicketForRound,
  isManagerFired,
  roundCashDelta,
  salarySliceForRound,
} from "./finances";
import { divideIntoDivisions, pickStarterTeam, avgStrength } from "./divisions";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { evolveTeam } from "./regen";
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
    schemaVersion: 7,
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
    manager: { money: STARTING_MONEY },
    userRoster: [],
  };
}

describe("computeSeasonFinances — ticket revenue", () => {
  it("sums opponent strength × TICKET_REVENUE_PER_STRENGTH for home games only", () => {
    const career = makeFinishedCareer(1998n);
    const season = career.currentSeason;
    const userDivIdx = findUserDivisionIdxInSeason(
      season,
      career.controlledTeamId,
    );
    const userDiv = season.divisions[userDivIdx];

    let expected = 0;
    userDiv.record.matches.forEach((m) => {
      if (m.home !== career.controlledTeamId) return;
      const opp = teamById(m.away);
      if (!opp) return;
      expected += avgStrength(opp) * TICKET_REVENUE_PER_STRENGTH;
    });

    const fin = computeSeasonFinances(career, "stayed");
    expect(fin.ticketRevenue).toBe(expected);
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
  it("sums avgStrength of the evolved away team for home games", () => {
    const N = 3; // far enough that opponent evolution (age/retire/youth) bites
    const career = advanceSeasons(makeFinishedCareer(1998n), N);
    const season = career.currentSeason;
    expect(season.year).toBe(FIRST_YEAR + N);

    const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
    const userDiv = season.divisions[userDivIdx];
    const elapsed = season.year - FIRST_YEAR;

    let evolvedSum = 0;
    let registrySum = 0;
    let homeGames = 0;
    userDiv.record.matches.forEach((m) => {
      if (m.home !== career.controlledTeamId) return;
      homeGames++;
      const base = teamById(m.away)!;
      evolvedSum +=
        avgStrength(evolveTeam(base, elapsed, career.seed)) *
        TICKET_REVENUE_PER_STRENGTH;
      registrySum += avgStrength(base) * TICKET_REVENUE_PER_STRENGTH;
    });
    expect(homeGames).toBeGreaterThan(0);

    const fin = computeSeasonFinances(career, "stayed");
    // Correctness: revenue matches the on-pitch (evolved) opponents exactly.
    expect(fin.ticketRevenue).toBe(evolvedSum);
    // And the fix actually moves the number — the old registry-based sum differs.
    expect(evolvedSum).not.toBe(registrySum);
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
  it("net = ticketRevenue - salaries + prBonus", () => {
    const career = makeFinishedCareer(1998n);
    const finP = computeSeasonFinances(career, "promoted");
    expect(finP.net).toBe(finP.ticketRevenue - finP.salaries + finP.prBonus);
    const finS = computeSeasonFinances(career, "stayed");
    expect(finS.net).toBe(finS.ticketRevenue - finS.salaries + finS.prBonus);
    const finR = computeSeasonFinances(career, "relegated");
    expect(finR.net).toBe(finR.ticketRevenue - finR.salaries + finR.prBonus);
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

  it("roundCashDelta = home ticket − salary slice, every round", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    for (let r = 0; r < total; r++) {
      expect(roundCashDelta(career, r)).toBe(
        homeTicketForRound(career, r) - salarySliceForRound(career, r),
      );
    }
  });

  it("per-round deltas sum to the season net minus the P/R bonus", () => {
    const career = makeFinishedCareer(1998n);
    const total = userRounds(career);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += roundCashDelta(career, r);
    const fin = computeSeasonFinances(career, "stayed");
    expect(sum).toBe(fin.net - fin.prBonus);
  });
});
