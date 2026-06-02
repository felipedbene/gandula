// @vitest-environment node
// Temporary end-to-end smoke for the E.2 three-tier expansion. Exercises the
// real new-career build + advanceCareer over multiple seasons with real
// ALL_TEAMS / run_season, asserting the 3-tier / 38-round / no-bye / two-
// boundary-P-R properties hold in practice (not just in unit fixtures).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS } from "../teams";
import { divideIntoDivisions, pickStarterTeam, WORLD_SIZE } from "./divisions";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { freshCopa } from "./copa";
import { FIRST_YEAR, STARTING_MONEY, totalRoundsOf, type Career } from "../persistence";
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
    schemaVersion: 12,
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
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000, marketingMomentum: 0 },
    userRoster: [],
  };
}

describe("E.2 smoke", () => {
  it("new career: 60 teams, 3 tiers of 20, 38 rounds, no byes, user in Série C", () => {
    expect(ALL_TEAMS.length).toBe(WORLD_SIZE);
    expect(WORLD_SIZE).toBe(60);
    const c = newCareer(1998n);
    expect(c.currentSeason.divisions).toHaveLength(3);
    for (const div of c.currentSeason.divisions) {
      expect(div.record.standings).toHaveLength(20);
      expect(totalRoundsOf(div)).toBe(38);
      // No byes: every fixture round has exactly 10 matches (20 teams / 2),
      // i.e. no round leaves a team idle.
      const byRound = new Map<number, number>();
      for (const f of div.record.fixtures) byRound.set(f.round, (byRound.get(f.round) ?? 0) + 1);
      for (const count of byRound.values()) expect(count).toBe(10);
    }
    // User is in the bottom tier.
    const userTier = c.currentSeason.divisions.find((d) =>
      d.record.standings.some((s) => s.team_id === c.controlledTeamId),
    );
    expect(userTier?.tier).toBe(3);
  });

  it("advances 10 seasons keeping all tiers at 20 and two-boundary P/R coherent", () => {
    let c = newCareer(2026n);
    for (let i = 0; i < 10; i++) {
      // Mark the season finished, then advance.
      c = {
        ...c,
        currentSeason: {
          ...c.currentSeason,
          divisions: c.currentSeason.divisions.map((d) => ({
            ...d,
            currentRoundIdx: totalRoundsOf(d),
          })),
        },
      };
      const pr = computePromotionRelegation(c.currentSeason, c.controlledTeamId);
      // Each boundary moves exactly 3.
      expect(pr.promotedBtoA).toHaveLength(3);
      expect(pr.relegatedAtoB).toHaveLength(3);
      expect(pr.promotedCtoB).toHaveLength(3);
      expect(pr.relegatedBtoC).toHaveLength(3);
      const { nextSeason } = advanceCareer(c, pr);
      expect(nextSeason.divisions).toHaveLength(3);
      nextSeason.divisions.forEach((d) => expect(d.record.standings).toHaveLength(20));
      // No team appears in two tiers (cascade didn't duplicate/drop anyone).
      const all = nextSeason.divisions.flatMap((d) => d.record.standings.map((s) => s.team_id));
      expect(new Set(all).size).toBe(60);
      c = { ...c, currentSeason: nextSeason };
    }
  });
});
