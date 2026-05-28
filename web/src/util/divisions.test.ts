// Pure unit tests — no WASM, no DOM. The util operates over the static
// ALL_TEAMS registry only.
import { describe, it, expect } from "vitest";
import {
  divideIntoDivisions,
  pickStarterTeam,
  pickRandomStarter,
  avgStrength,
  TIER_A_SIZE,
  TIER_B_SIZE,
} from "./divisions";
import { ALL_TEAMS } from "../teams";

describe("divideIntoDivisions", () => {
  it("splits 17 teams into 8 + 9", () => {
    const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
    expect(tierA).toHaveLength(TIER_A_SIZE);
    expect(tierB).toHaveLength(TIER_B_SIZE);
  });

  it("Série A teams are all at least as strong as Série B teams", () => {
    const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
    const minA = Math.min(...tierA.map(avgStrength));
    const maxB = Math.max(...tierB.map(avgStrength));
    expect(minA).toBeGreaterThanOrEqual(maxB);
  });

  it("is deterministic across calls", () => {
    const a = divideIntoDivisions(ALL_TEAMS);
    const b = divideIntoDivisions(ALL_TEAMS);
    expect(a.tierA.map((t) => t.id)).toEqual(b.tierA.map((t) => t.id));
    expect(a.tierB.map((t) => t.id)).toEqual(b.tierB.map((t) => t.id));
  });

  it("rejects team counts other than 17", () => {
    expect(() => divideIntoDivisions(ALL_TEAMS.slice(0, 16))).toThrow();
    expect(() => divideIntoDivisions([...ALL_TEAMS, ALL_TEAMS[0]])).toThrow();
  });
});

describe("pickStarterTeam", () => {
  it("returns the weakest team in Série B", () => {
    const { tierB } = divideIntoDivisions(ALL_TEAMS);
    const starter = pickStarterTeam(tierB);
    const minStrength = Math.min(...tierB.map(avgStrength));
    expect(avgStrength(starter)).toBe(minStrength);
  });

  it("is deterministic", () => {
    const { tierB } = divideIntoDivisions(ALL_TEAMS);
    const a = pickStarterTeam(tierB);
    const b = pickStarterTeam(tierB);
    expect(a.id).toBe(b.id);
  });

  it("throws on empty tierB", () => {
    expect(() => pickStarterTeam([])).toThrow();
  });
});

describe("pickRandomStarter", () => {
  it("always returns a team from Série B", () => {
    const { tierB } = divideIntoDivisions(ALL_TEAMS);
    const ids = new Set(tierB.map((t) => t.id));
    for (let i = 0; i < 50; i++) {
      expect(ids.has(pickRandomStarter(tierB).id)).toBe(true);
    }
  });

  it("throws on empty tierB", () => {
    expect(() => pickRandomStarter([])).toThrow();
  });
});
