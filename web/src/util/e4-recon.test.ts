// @vitest-environment node
// E.4 reconciliation smoke: drive a full season's money flow exactly as
// SeasonView does (per-round deltas + cup prize on cup matchdays + boundary
// placement/prBonus) and assert it reconciles with computeSeasonFinances:
// end-of-season money == start + net. This guards the per-round-vs-boundary
// split that is the subtle correctness core of E.4.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS } from "../teams";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import {
  computeSeasonFinances,
  cupPrizeForAdvance,
  roundCashDelta,
} from "./finances";
import {
  COPA_ROUND_AT_LEAGUE_ROUND,
  cupSeedFor,
  cupTeamResolver,
  freshCopa,
  playCupRound,
} from "./copa";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
} from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
beforeAll(async () => {
  await init({ module_or_path: readFileSync(resolve(HERE, "../wasm/gandula_wasm_bg.wasm")) });
});

function newCareer(seed: bigint): Career {
  const [a, b, c] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(c);
  const ss = seed ^ BigInt(FIRST_YEAR);
  return {
    schemaVersion: 8,
    savedAt: "x",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: ss,
      divisions: [
        { tier: 1, name: "Série A", record: run_season(a, ss ^ 1n, "Série A") as SeasonRecord, currentRoundIdx: 0 },
        { tier: 2, name: "Série B", record: run_season(b, ss ^ 2n, "Série B") as SeasonRecord, currentRoundIdx: 0 },
        { tier: 3, name: "Série C", record: run_season(c, ss ^ 3n, "Série C") as SeasonRecord, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
  };
}

describe("E.4 season money reconciliation", () => {
  it("end-of-season money == start + net (per-round + cup + boundary)", () => {
    const career = newCareer(1998n);
    const season = career.currentSeason;
    const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
    const total = totalRoundsOf(season.divisions[userDivIdx]);

    let money = STARTING_MONEY;
    let copa = season.copa;
    const cupSeed = cupSeedFor(season);

    // Per-round: gate + TV + match bonus − salary, plus cup prize on cup
    // matchdays (exactly as SeasonView.playRound).
    for (let r = 0; r < total; r++) {
      money += roundCashDelta(career, r);
      const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(r);
      if (cupRoundIdx >= 0 && copa.currentCupRoundIdx === cupRoundIdx) {
        const next = playCupRound(copa, cupRoundIdx, cupTeamResolver(career), cupSeed, career.controlledTeamId);
        money += cupPrizeForAdvance(copa, next, career.controlledTeamId);
        copa = next;
      }
    }

    // Compute season finances against the FINISHED copa (mirrors the finale).
    const finished: Career = {
      ...career,
      currentSeason: { ...season, copa },
    };
    const fin = computeSeasonFinances(finished, "stayed");

    // Boundary pieces.
    money += fin.prBonus + fin.placementPrize;

    // moneyAfter == start + net.
    expect(money).toBe(STARTING_MONEY + fin.net);
    // The per-round + cup money already banked equals net minus boundary.
    expect(money - fin.prBonus - fin.placementPrize).toBe(
      STARTING_MONEY + fin.net - fin.prBonus - fin.placementPrize,
    );
    // Cup actually ran and its season-total reconciles with the per-matchday pay.
    expect(copa.championId).toBeDefined();
  });

  it("a bigger stadium raises the season gate (E.4.b.4 build-vs-buy payoff)", () => {
    const base = newCareer(1998n);
    // Force high fanbase so demand exceeds even a large stadium → capacity bites
    // and expanding genuinely adds seats sold.
    const small = {
      ...base,
      manager: { ...base.manager, fanbase: 80_000, stadiumCapacity: 12_000 },
    };
    const big = {
      ...small,
      manager: { ...small.manager, stadiumCapacity: 60_000 },
    };
    const gateSmall = computeSeasonFinances(small, "stayed").ticketRevenue;
    const gateBig = computeSeasonFinances(big, "stayed").ticketRevenue;
    expect(gateBig).toBeGreaterThan(gateSmall);
  });
});
