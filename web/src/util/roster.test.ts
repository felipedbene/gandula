// @vitest-environment node
//
// Pure unit tests for userTeam — the effective-team resolver. No WASM/DOM:
// it only reads controlledTeamId + userRoster off the Career.
import { describe, it, expect } from "vitest";
import { userTeam } from "./roster";
import { freshCopa } from "./copa";
import { ALL_TEAMS } from "../teams";
import { FIRST_YEAR, STARTING_MONEY, type Career } from "../persistence";

const team = ALL_TEAMS.find((t) => t.name === "Amazônia do Norte")!;

function careerWith(userRoster: typeof team.roster): Career {
  return {
    schemaVersion: 8,
    savedAt: "2026-01-01T00:00:00Z",
    seed: 1998n,
    controlledTeamId: team.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: 1998n,
      divisions: [],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster,
  };
}

describe("userTeam", () => {
  it("falls back to the registry team when userRoster is empty", () => {
    const t = userTeam(careerWith([]));
    expect(t.roster.map((p) => p.id)).toEqual(team.roster.map((p) => p.id));
    expect(t.bench).toEqual(team.bench);
  });

  it("uses the custom roster and drops bench ids no longer in it", () => {
    const soldBenchId = team.bench![0];
    const userRoster = team.roster.filter((p) => p.id !== soldBenchId);
    const t = userTeam(careerWith(userRoster));

    expect(t.roster).toBe(userRoster);
    expect(t.bench).not.toContain(soldBenchId);
    // Bench ids still present in the roster survive, in order.
    expect(t.bench).toEqual(team.bench!.filter((id) => id !== soldBenchId));
  });

  it("leaves the starting XI untouched when every starter is still rostered", () => {
    // Drop a bench player only — no starter affected. XI is unchanged.
    const soldBenchId = team.bench![0];
    const userRoster = team.roster.filter((p) => p.id !== soldBenchId);
    const t = userTeam(careerWith(userRoster));
    expect(t.starting_xi).toEqual(team.starting_xi);
  });

  it("backfills the starting XI to a fieldable 11 when a starter has left the roster", () => {
    // E.2.c: retirement can remove a starter outright (canSell blocks selling
    // one). userTeam must drop the dangling id and refill so the engine sees 11.
    const goneStarter = team.starting_xi[0];
    const userRoster = team.roster.filter((p) => p.id !== goneStarter);
    const t = userTeam(careerWith(userRoster));

    expect(t.starting_xi).toHaveLength(11);
    expect(new Set(t.starting_xi).size).toBe(11); // distinct
    expect(t.starting_xi).not.toContain(goneStarter);
    // Every XI id is a real rostered player.
    const rosterIds = new Set(userRoster.map((p) => p.id));
    for (const id of t.starting_xi) expect(rosterIds.has(id)).toBe(true);
    // XI and bench stay disjoint.
    const xi = new Set(t.starting_xi);
    for (const id of t.bench ?? []) expect(xi.has(id)).toBe(false);
  });
});
