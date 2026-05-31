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
  TIER_C_SIZE,
  WORLD_SIZE,
} from "./divisions";
import { ALL_TEAMS } from "../teams";

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

describe("divideIntoDivisions", () => {
  it("splits 60 teams into 20 + 20 + 20", () => {
    const [a, b, c] = divideIntoDivisions(ALL_TEAMS);
    expect(a).toHaveLength(TIER_A_SIZE);
    expect(b).toHaveLength(TIER_B_SIZE);
    expect(c).toHaveLength(TIER_C_SIZE);
    expect(WORLD_SIZE).toBe(60);
  });

  it("is deterministic across calls", () => {
    const x = divideIntoDivisions(ALL_TEAMS);
    const y = divideIntoDivisions(ALL_TEAMS);
    for (let t = 0; t < 3; t++) {
      expect(x[t].map((tm) => tm.id)).toEqual(y[t].map((tm) => tm.id));
    }
  });

  it("rejects team counts other than 60", () => {
    expect(() => divideIntoDivisions(ALL_TEAMS.slice(0, 59))).toThrow();
    expect(() => divideIntoDivisions([...ALL_TEAMS, ALL_TEAMS[0]])).toThrow();
  });
});

// Anchor test: locks the data outcome. A fictionalize reroll (or a registry
// swap) that scrambles the talent distribution so the tiers stop being a clean
// gradient fails CI here — the whole 3-tier design rests on this holding.
describe("world talent gradient (anchor)", () => {
  it("partitions into a clean monotonic gradient across A > B > C", () => {
    const [a, b, c] = divideIntoDivisions(ALL_TEAMS).map((tier) =>
      tier.map(avgStrength),
    );

    // Clean tier boundaries: the weakest in an upper tier is at least as
    // strong as the strongest in the tier below (no cross-tier overlap).
    expect(Math.min(...a)).toBeGreaterThanOrEqual(Math.max(...b));
    expect(Math.min(...b)).toBeGreaterThanOrEqual(Math.max(...c));

    // Median gradient: C strictly weaker than B strictly weaker than A.
    expect(median(c)).toBeLessThan(median(b));
    expect(median(b)).toBeLessThan(median(a));
  });
});

describe("pickStarterTeam", () => {
  it("returns the weakest team in the bottom tier (Série C)", () => {
    const [, , c] = divideIntoDivisions(ALL_TEAMS);
    const starter = pickStarterTeam(c);
    const minStrength = Math.min(...c.map(avgStrength));
    expect(avgStrength(starter)).toBe(minStrength);
  });

  it("is deterministic", () => {
    const [, , c] = divideIntoDivisions(ALL_TEAMS);
    expect(pickStarterTeam(c).id).toBe(pickStarterTeam(c).id);
  });

  it("throws on empty bottom tier", () => {
    expect(() => pickStarterTeam([])).toThrow();
  });
});

describe("pickRandomStarter", () => {
  it("always returns a team from the bottom tier (Série C)", () => {
    const [, , c] = divideIntoDivisions(ALL_TEAMS);
    const ids = new Set(c.map((t) => t.id));
    for (let i = 0; i < 50; i++) {
      expect(ids.has(pickRandomStarter(c).id)).toBe(true);
    }
  });

  it("throws on empty bottom tier", () => {
    expect(() => pickRandomStarter([])).toThrow();
  });
});
