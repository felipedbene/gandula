// @vitest-environment node
import { describe, expect, it } from "vitest";
import { objectivesFor, userPositionIn } from "./objectives";
import type { TeamStats } from "../types";

/** A standings list of `size` teams where the team `teamId` sits at 1-based
 *  `position`. Points decrease down the table so computeStandings-style order
 *  is respected; only ordering + ids matter for these tests. */
function standingsWithUserAt(position: number, size: number, teamId: number): TeamStats[] {
  const out: TeamStats[] = [];
  for (let i = 0; i < size; i++) {
    const id = i + 1 === position ? teamId : 1000 + i;
    out.push({
      team_id: id,
      played: 10,
      won: size - i,
      drawn: 0,
      lost: i,
      goals_for: 0,
      goals_against: 0,
    });
  }
  return out;
}

describe("userPositionIn", () => {
  it("returns the 1-based index of the team", () => {
    const s = standingsWithUserAt(5, 20, 42);
    expect(userPositionIn(s, 42)).toBe(5);
  });
  it("falls back to last when absent", () => {
    const s = standingsWithUserAt(5, 20, 42);
    expect(userPositionIn(s, 999)).toBe(20);
  });
});

describe("objectivesFor", () => {
  it("Série C headline is promotion, on-track inside the G3", () => {
    const s = standingsWithUserAt(2, 20, 42);
    const obj = objectivesFor(3, 2, 20, s, 42);
    expect(obj[0].primary).toBe(true);
    expect(obj[0].label).toMatch(/Subir/);
    expect(obj[0].status).toBe("onTrack");
  });

  it("Série C promotion is at-risk outside the G3", () => {
    const s = standingsWithUserAt(8, 20, 42);
    const obj = objectivesFor(3, 8, 20, s, 42);
    expect(obj[0].status).toBe("atRisk");
  });

  it("Série B includes an avoid-relegation floor", () => {
    const s = standingsWithUserAt(18, 20, 42);
    const obj = objectivesFor(2, 18, 20, s, 42);
    const releg = obj.find((o) => /rebaixamento/.test(o.label));
    expect(releg).toBeDefined();
    expect(releg!.status).toBe("atRisk"); // 18th of 20 → bottom 3
  });

  it("Série A headline is the title; met when 1st", () => {
    const s = standingsWithUserAt(1, 20, 42);
    const obj = objectivesFor(1, 1, 20, s, 42);
    expect(obj[0].label).toMatch(/campeão/);
    expect(obj[0].status).toBe("met");
  });

  it("Série A survival flips to at-risk in the bottom 3", () => {
    const s = standingsWithUserAt(19, 20, 42);
    const obj = objectivesFor(1, 19, 20, s, 42);
    const survive = obj.find((o) => /Permanecer/.test(o.label));
    expect(survive!.status).toBe("atRisk");
  });

  it("always returns a primary headline goal", () => {
    for (const tier of [1, 2, 3] as const) {
      const s = standingsWithUserAt(10, 20, 42);
      const obj = objectivesFor(tier, 10, 20, s, 42);
      expect(obj.filter((o) => o.primary)).toHaveLength(1);
    }
  });
});
