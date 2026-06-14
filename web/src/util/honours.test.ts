// @vitest-environment node
//
// computeHonours is a pure aggregation over career.seasons — no WASM, no DOM.
import { describe, expect, it } from "vitest";
import { computeHonours } from "./honours";
import type { Career, SeasonHistory } from "../persistence";

const USER = 42;

/** Minimal SeasonHistory with sensible defaults; override per case. */
function season(over: Partial<SeasonHistory> & { year: number }): SeasonHistory {
  return {
    userDivision: { tier: 3, name: "Série C" },
    userPosition: 10,
    userPoints: 50,
    champion: { tier: 3, teamId: 999, teamName: "Outro FC" },
    promoted: [],
    relegated: [],
    userOutcome: "stayed",
    moneyDelta: 0,
    moneyAfter: 1_000_000,
    ...over,
  };
}

/** Career carrying only the fields computeHonours reads. */
function career(seasons: SeasonHistory[]): Career {
  return { controlledTeamId: USER, seasons } as unknown as Career;
}

describe("computeHonours", () => {
  it("returns an empty honours board for a career with no finished seasons", () => {
    const h = computeHonours(career([]));
    expect(h.seasonsManaged).toBe(0);
    expect(h.leagueTitles).toEqual([]);
    expect(h.copaTitles).toEqual([]);
    expect(h.promotions).toBe(0);
    expect(h.relegations).toBe(0);
    expect(h.bestFinish).toBeNull();
    expect(h.richestBalance).toBeNull();
  });

  it("counts league titles only when the user's club is the division champion", () => {
    const h = computeHonours(
      career([
        season({
          year: 2026,
          userDivision: { tier: 3, name: "Série C" },
          champion: { tier: 3, teamId: USER, teamName: "Você FC" },
        }),
        season({ year: 2027 }), // someone else champion
      ]),
    );
    expect(h.leagueTitles).toEqual([{ year: 2026, division: "Série C" }]);
  });

  it("counts Copa titles by year and tallies promotions/relegations", () => {
    const h = computeHonours(
      career([
        season({ year: 2026, userOutcome: "promoted", copaUserResult: "r16" }),
        season({ year: 2027, userOutcome: "promoted", copaUserResult: "champion" }),
        season({ year: 2028, userOutcome: "relegated" }),
      ]),
    );
    expect(h.copaTitles).toEqual([2027]);
    expect(h.promotions).toBe(2);
    expect(h.relegations).toBe(1);
    expect(h.seasonsManaged).toBe(3);
  });

  it("picks best finish by tier first, then position (Série A 5th beats Série C 1st)", () => {
    const h = computeHonours(
      career([
        season({
          year: 2026,
          userDivision: { tier: 3, name: "Série C" },
          userPosition: 1,
        }),
        season({
          year: 2030,
          userDivision: { tier: 1, name: "Série A" },
          userPosition: 5,
        }),
      ]),
    );
    expect(h.bestFinish).toEqual({
      position: 5,
      division: "Série A",
      year: 2030,
    });
  });

  it("reports the richest end-of-season balance", () => {
    const h = computeHonours(
      career([
        season({ year: 2026, moneyAfter: 500_000 }),
        season({ year: 2027, moneyAfter: 3_200_000 }),
        season({ year: 2028, moneyAfter: 1_100_000 }),
      ]),
    );
    expect(h.richestBalance).toBe(3_200_000);
  });
});
