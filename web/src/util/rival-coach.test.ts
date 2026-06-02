// @vitest-environment node
//
// Pure unit tests for the distilled rival coach (E.3.c.2) — no WASM/DOM.
// Operates on the static ALL_TEAMS registry.
import { describe, expect, it } from "vitest";
import {
  RIVAL_POLICY,
  applyRivalCoach,
  rivalBudget,
  rivalTactics,
  rivalTransfers,
} from "./rival-coach";
import { MAX_ROSTER } from "./transfer-market";
import { avgStrength } from "./divisions";
import { FIRST_YEAR } from "../persistence";
import { ALL_TEAMS } from "../teams";
import type { Team } from "../types";

const team = ALL_TEAMS.find((t) => t.name === "Sociedade Onça SC")!;

/** Assert the engine's team invariants (core/src/domain/team.rs validate). */
function expectValid(t: Team) {
  const rosterIds = new Set(t.roster.map((p) => p.id));
  expect(t.starting_xi).toHaveLength(11);
  expect(new Set(t.starting_xi).size).toBe(11);
  for (const id of t.starting_xi) expect(rosterIds.has(id)).toBe(true);

  const bench = t.bench ?? [];
  expect(bench.length).toBeLessThanOrEqual(7);
  expect(new Set(bench).size).toBe(bench.length);
  const xi = new Set(t.starting_xi);
  for (const id of bench) {
    expect(rosterIds.has(id)).toBe(true);
    expect(xi.has(id)).toBe(false);
  }
  expect(t.roster.length).toBeLessThanOrEqual(MAX_ROSTER);
}

describe("rivalTactics", () => {
  it("returns the distilled per-tier tactic + formation", () => {
    for (const tier of [1, 2, 3] as const) {
      const { formation, tactics } = rivalTactics(tier);
      expect(formation).toBe(RIVAL_POLICY[tier].formation);
      expect(tactics).toEqual(RIVAL_POLICY[tier].tactics);
    }
  });
});

describe("rivalBudget", () => {
  it("is positive and scales with the tier base", () => {
    // Same club/seed/year, different tiers: budget tracks the tier base.
    const a = rivalBudget(1, 1998n, team.id, 3);
    const b = rivalBudget(2, 1998n, team.id, 3);
    const c = rivalBudget(3, 1998n, team.id, 3);
    for (const v of [a, b, c]) expect(v).toBeGreaterThan(0);
    // Série B base is the highest in the distilled policy.
    expect(b).toBeGreaterThan(c);
  });

  it("is deterministic in (tier, seed, teamId, yearOffset)", () => {
    expect(rivalBudget(3, 1998n, team.id, 5)).toBe(rivalBudget(3, 1998n, team.id, 5));
  });

  it("differs across clubs in the same tier (per-club jitter)", () => {
    const ids = ALL_TEAMS.slice(0, 5).map((t) => rivalBudget(2, 1998n, t.id, 3));
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});

describe("rivalTransfers", () => {
  it("buys upgrades when given a real budget, never exceeding the roster cap", () => {
    const before = team.roster.length;
    const out = rivalTransfers(team.roster, 8_000_000, 2030, 1998n);
    expect(out.length).toBeGreaterThanOrEqual(before);
    expect(out.length).toBeLessThanOrEqual(MAX_ROSTER);
  });

  it("buys nothing with no budget", () => {
    const out = rivalTransfers(team.roster, 0, 2030, 1998n);
    expect(out).toEqual(team.roster);
  });

  it("is deterministic in (roster, budget, year, seed)", () => {
    const a = rivalTransfers(team.roster, 5_000_000, 2031, 1998n);
    const b = rivalTransfers(team.roster, 5_000_000, 2031, 1998n);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });
});

describe("applyRivalCoach", () => {
  it("stays engine-valid (11 XI, valid bench, ≤ cap) and sets the tier tactic", () => {
    const out = applyRivalCoach(team, 3, 2030, 1998n, 4);
    expectValid(out);
    expect(out.formation).toBe(RIVAL_POLICY[3].formation);
    expect(out.tactics).toEqual(RIVAL_POLICY[3].tactics);
  });

  it("a coached club ends at least as strong as before (buys help, never hurt the XI)", () => {
    // The lineup reconcile only promotes strict upgrades, so coaching never
    // lowers the starting-XI average strength.
    const before = avgStrength(team);
    const out = applyRivalCoach(team, 2, 2030, 1998n, 4);
    expect(avgStrength(out)).toBeGreaterThanOrEqual(before);
  });

  it("is deterministic in all inputs", () => {
    const a = applyRivalCoach(team, 1, 2032, 4242n, 6);
    const b = applyRivalCoach(team, 1, 2032, 4242n, 6);
    expect(a).toEqual(b);
  });

  it("is a no-op at yearOffset 0 (season-0 registry baseline)", () => {
    // Season 0 is the authored registry world — uncoached — so re-sim of a
    // season-0 career reproduces the original.
    expect(applyRivalCoach(team, 3, FIRST_YEAR, 1998n, 0)).toEqual(team);
  });

  it("stays engine-valid for every tier", () => {
    for (const tier of [1, 2, 3] as const) {
      expectValid(applyRivalCoach(team, tier, 2031, 55n, 2));
    }
  });
});
