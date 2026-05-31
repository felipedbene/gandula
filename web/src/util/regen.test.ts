// @vitest-environment node
//
// Pure unit tests for opponent regen — no WASM/DOM. Operates on the static
// ALL_TEAMS registry.
import { describe, expect, it } from "vitest";
import { RETIREMENT_AGE, evolveTeam, evolveRoster } from "./regen";
import { REGEN_ID_BASE } from "./transfer-market";
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
  for (const p of t.roster) expect(p.age).toBeLessThanOrEqual(50);
}

describe("evolveTeam", () => {
  it("stays engine-valid and keeps roster size over many seasons", () => {
    const out = evolveTeam(team, 12, 1998n);
    expectValid(out);
    expect(out.roster.length).toBe(team.roster.length);
  });

  it("retires everyone over the threshold each season", () => {
    const out = evolveTeam(team, 12, 1998n);
    expect(Math.max(...out.roster.map((p) => p.age))).toBeLessThan(RETIREMENT_AGE);
  });

  it("brings in regen youth (registry players churn out)", () => {
    // Over 15 seasons every original player (≤ age 50) crosses the retirement
    // threshold, so the roster is replaced by regen youth.
    const out = evolveTeam(team, 15, 1998n);
    expect(out.roster.some((p) => p.id >= REGEN_ID_BASE)).toBe(true);
  });

  it("is deterministic in (team, seasons, seed)", () => {
    expect(evolveTeam(team, 8, 1998n)).toEqual(evolveTeam(team, 8, 1998n));
  });

  it("0 seasons is a no-op", () => {
    expect(evolveTeam(team, 0, 1998n)).toEqual(team);
  });
});

describe("evolveRoster (E.2.c — shared user/opponent squad churn)", () => {
  it("ages survivors and holds roster size", () => {
    const out = evolveRoster(team.roster, 1998n, team.id, 1);
    expect(out.length).toBe(team.roster.length);
    // A player who didn't retire is one year older.
    const survivor = team.roster.find((p) => p.age + 1 < RETIREMENT_AGE)!;
    const after = out.find((p) => p.id === survivor.id)!;
    expect(after.age).toBe(survivor.age + 1);
  });

  it("retires players who reach RETIREMENT_AGE and replaces them with same-position youth", () => {
    // Build a controlled roster where ONLY the victim is near retirement: age
    // the first starter to one year shy of retirement (so this season tips
    // them over, age+1 ≥ RETIREMENT_AGE) and make everyone else comfortably
    // young so exactly one youth is regenerated regardless of the chosen team.
    const victim = team.roster[0];
    const roster = team.roster.map((p) =>
      p.id === victim.id ? { ...p, age: RETIREMENT_AGE - 1 } : { ...p, age: 25 },
    );
    const out = evolveRoster(roster, 1998n, team.id, 1);

    expect(out.some((p) => p.id === victim.id)).toBe(false); // retired
    expect(out.length).toBe(roster.length); // size held
    const youth = out.filter((p) => p.id >= REGEN_ID_BASE);
    expect(youth.length).toBe(1);
    expect(youth[0].position).toBe(victim.position); // same-position replacement
  });

  it("is deterministic in (roster, seed, teamId, yearOffset)", () => {
    const a = evolveRoster(team.roster, 1998n, team.id, 3);
    const b = evolveRoster(team.roster, 1998n, team.id, 3);
    expect(a).toEqual(b);
  });
});
