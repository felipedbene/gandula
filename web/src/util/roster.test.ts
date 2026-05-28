// @vitest-environment node
//
// Pure unit tests for userTeam — the effective-team resolver. No WASM/DOM:
// it only reads controlledTeamId + userRoster off the Career.
import { describe, it, expect } from "vitest";
import { userTeam } from "./roster";
import { ALL_TEAMS } from "../teams";
import { FIRST_YEAR, STARTING_MONEY, type Career } from "../persistence";

const team = ALL_TEAMS.find((t) => t.name === "Baviera FC")!;

function careerWith(userRoster: typeof team.roster): Career {
  return {
    schemaVersion: 5,
    savedAt: "2026-01-01T00:00:00Z",
    seed: 1998n,
    controlledTeamId: team.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: 1998n,
      divisions: [],
      transfers: [],
    },
    manager: { money: STARTING_MONEY },
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
});
