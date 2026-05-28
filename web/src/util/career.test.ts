// @vitest-environment node
//
// advanceCareer integration tests — exercise the full pure pipeline:
// real ALL_TEAMS, real run_season via WASM, real computePromotionRelegation.
// Node env (pattern c) — happy-dom's http:// `import.meta.url` would break
// fileURLToPath; cwd-anchored resolve avoids that. See vitest.config.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import { ALL_TEAMS, teamById } from "../teams";
import { FIRST_YEAR, STARTING_MONEY, type Career } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a freshly-finished Career at year=FIRST_YEAR with both divisions
 * at their terminal `currentRoundIdx`. Uses real ALL_TEAMS + run_season
 * so standings + P/R outcomes are realistic for the given seed. The user
 * is always the weakest team of Série B via pickStarterTeam.
 */
function makeFinishedCareer(seed: bigint): Career {
  const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierB);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const totalA = Math.max(...recordA.fixtures.map((f) => f.round)) + 1;
  const totalB = Math.max(...recordB.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 4,
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
      ],
    },
    manager: { money: STARTING_MONEY },
  };
}

describe("advanceCareer — history", () => {
  it("year matches the just-finished season's year", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    expect(history.year).toBe(FIRST_YEAR);
  });

  it("captures user's division and 1-based position", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    // User starts as weakest of Série B → tier 2, 1..9.
    expect(history.userDivision.tier).toBe(2);
    expect(history.userDivision.name).toBe("Série B");
    expect(history.userPosition).toBeGreaterThanOrEqual(1);
    expect(history.userPosition).toBeLessThanOrEqual(9);
  });

  it("champion is the position-0 team of the user's division", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    const userDiv = career.currentSeason.divisions.find((d) => d.tier === 2)!;
    const championId = userDiv.record.standings[0].team_id;
    expect(history.champion.teamId).toBe(championId);
    expect(history.champion.teamName).toBe(teamById(championId)?.name);
  });

  it("userOutcome reflects PRResult flags", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    if (pr.userPromoted) {
      expect(history.userOutcome).toBe("promoted");
    } else if (pr.userRelegated) {
      expect(history.userOutcome).toBe("relegated");
    } else {
      expect(history.userOutcome).toBe("stayed");
    }
  });

  it("promoted/relegated lists have team names resolved", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    expect(history.promoted).toHaveLength(2);
    expect(history.relegated).toHaveLength(2);
    history.promoted.forEach((p) => {
      expect(p.teamName).toBe(teamById(p.teamId)?.name);
    });
    history.relegated.forEach((r) => {
      expect(r.teamName).toBe(teamById(r.teamId)?.name);
    });
  });
});

describe("advanceCareer — nextSeason", () => {
  it("year is current year + 1", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.year).toBe(FIRST_YEAR + 1);
  });

  it("seed is career.seed XOR BigInt(nextYear)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.seed).toBe(1998n ^ BigInt(FIRST_YEAR + 1));
  });

  it("has 2 divisions sized 8 and 9", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    const a = nextSeason.divisions.find((d) => d.tier === 1)!;
    const b = nextSeason.divisions.find((d) => d.tier === 2)!;
    expect(a.record.standings).toHaveLength(8);
    expect(b.record.standings).toHaveLength(9);
  });

  it("promoted teams move to next Série A, relegated to next Série B", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    const a = nextSeason.divisions.find((d) => d.tier === 1)!;
    const b = nextSeason.divisions.find((d) => d.tier === 2)!;
    const aIds = new Set(a.record.standings.map((s) => s.team_id));
    const bIds = new Set(b.record.standings.map((s) => s.team_id));
    pr.promoted.forEach((p) => expect(aIds.has(p.team_id)).toBe(true));
    pr.relegated.forEach((r) => expect(bIds.has(r.team_id)).toBe(true));
  });

  it("currentRoundIdx is 0 (fresh season, no rounds played yet)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.divisions.every((d) => d.currentRoundIdx === 0)).toBe(
      true,
    );
  });

  it("userTactics is undefined on next season (fresh start)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.userTactics).toBeUndefined();
  });

  it("user's team appears in exactly one tier after P/R", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    const a = nextSeason.divisions.find((d) => d.tier === 1)!;
    const b = nextSeason.divisions.find((d) => d.tier === 2)!;
    const inA = a.record.standings.some(
      (s) => s.team_id === career.controlledTeamId,
    );
    const inB = b.record.standings.some(
      (s) => s.team_id === career.controlledTeamId,
    );
    expect(inA !== inB).toBe(true);
    if (pr.userPromoted) {
      expect(inA).toBe(true);
    } else {
      // User started in Série B; relegation is impossible from B and
      // "stayed" keeps them in B. Either way they remain in tier 2.
      expect(inB).toBe(true);
    }
  });
});

describe("advanceCareer — finances", () => {
  it("AdvanceResult includes finances breakdown", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const result = advanceCareer(career, pr);
    expect(result.finances).toBeDefined();
    expect(typeof result.finances.ticketRevenue).toBe("number");
    expect(typeof result.finances.salaries).toBe("number");
    expect(typeof result.finances.prBonus).toBe("number");
    expect(typeof result.finances.net).toBe("number");
  });

  it("history.moneyDelta equals finances.net", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history, finances } = advanceCareer(career, pr);
    expect(history.moneyDelta).toBe(finances.net);
  });

  it("history.moneyAfter equals career.manager.money + finances.net", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history, finances } = advanceCareer(career, pr);
    expect(history.moneyAfter).toBe(career.manager.money + finances.net);
  });
});

describe("advanceCareer — determinism", () => {
  it("same career + same PRResult ⇒ same AdvanceResult", () => {
    const c1 = makeFinishedCareer(1998n);
    const c2 = makeFinishedCareer(1998n);
    const pr1 = computePromotionRelegation(c1.currentSeason, c1.controlledTeamId);
    const pr2 = computePromotionRelegation(c2.currentSeason, c2.controlledTeamId);
    const r1 = advanceCareer(c1, pr1);
    const r2 = advanceCareer(c2, pr2);
    expect(r1.history).toEqual(r2.history);
    expect(r1.nextSeason.seed).toBe(r2.nextSeason.seed);
    expect(
      r1.nextSeason.divisions[0].record.standings.map((s) => s.team_id),
    ).toEqual(
      r2.nextSeason.divisions[0].record.standings.map((s) => s.team_id),
    );
  });

  it("different seeds produce different next-season match seeds", () => {
    const c1 = makeFinishedCareer(1998n);
    const c2 = makeFinishedCareer(2000n);
    const pr1 = computePromotionRelegation(c1.currentSeason, c1.controlledTeamId);
    const pr2 = computePromotionRelegation(c2.currentSeason, c2.controlledTeamId);
    const r1 = advanceCareer(c1, pr1);
    const r2 = advanceCareer(c2, pr2);
    expect(r1.nextSeason.seed).not.toBe(r2.nextSeason.seed);
  });
});

describe("advanceCareer — input immutability", () => {
  it("does not mutate the input career", () => {
    const career = makeFinishedCareer(1998n);
    const snapshot = JSON.stringify(career, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    advanceCareer(career, pr);
    const after = JSON.stringify(career, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(after).toBe(snapshot);
  });
});
