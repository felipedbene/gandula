// @vitest-environment node
//
// Pure-compute tests over the WASM engine — no DOM. Node env gives us
// file:// `import.meta.url` so we can anchor the wasm path to this file.
// happy-dom resolves import.meta.url to http://localhost:3000/... and
// fileURLToPath would throw "URL must be of scheme file" (see D.1.b
// investigation notes).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect } from "vitest";
import init, {
  derive_match_seed,
  run_season,
} from "../wasm/gandula_wasm.js";
import { applyUserTactics, resimulateFromRound } from "./resimulate";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import { ALL_TEAMS, teamById } from "../teams";
import {
  findUserDivisionIdx,
  type SavedSeason,
  type UserTactics,
} from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a v2 SavedSeason with both divisions fully simulated. The user is
 * always assigned to Série B's weakest team (via pickStarterTeam) so
 * `findUserDivisionIdx(saved) === 1` is a stable assumption across tests.
 * `currentRoundIdx` is applied to BOTH divisions for simplicity — tests
 * that only care about user-division behavior can ignore Série A's
 * counter.
 */
function makeSavedSeason(seed: bigint, currentRoundIdx: number): SavedSeason {
  const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierB);
  const recordA = run_season(tierA, seed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seed ^ 2n, "Série B") as SeasonRecord;
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    divisions: [
      { tier: 1, name: "Série A", record: recordA, currentRoundIdx },
      { tier: 2, name: "Série B", record: recordB, currentRoundIdx },
    ],
  };
}

function overrideFor(teamId: number): UserTactics {
  const t = teamById(teamId);
  if (!t) throw new Error(`teamById(${teamId}) not found`);
  return {
    formation: "F433",
    tactics: {
      mentality: "VeryAttacking",
      tempo: "Fast",
      pressing: "High",
      width: "Wide",
    },
    starting_xi: t.starting_xi.slice(),
    bench: t.bench?.slice() ?? [],
  };
}

describe("applyUserTactics", () => {
  it("substitutes formation, tactics, XI, and bench", () => {
    const base = teamById(ALL_TEAMS[0].id)!;
    const override = overrideFor(base.id);
    const result = applyUserTactics(base, override);
    expect(result.formation).toBe("F433");
    expect(result.tactics.mentality).toBe("VeryAttacking");
    expect(result.tactics.tempo).toBe("Fast");
    expect(result.tactics.pressing).toBe("High");
    expect(result.tactics.width).toBe("Wide");
  });

  it("preserves id, name, and roster from the base team", () => {
    const base = teamById(ALL_TEAMS[0].id)!;
    const override = overrideFor(base.id);
    const result = applyUserTactics(base, override);
    expect(result.id).toBe(base.id);
    expect(result.name).toBe(base.name);
    expect(result.roster).toBe(base.roster); // same reference, untouched
  });
});

describe("derive_match_seed parity", () => {
  it("matches the seeds the engine used internally per division (XOR tier)", () => {
    const saved = makeSavedSeason(1998n, 0);
    saved.divisions.forEach((div) => {
      const divSeed = saved.seed ^ BigInt(div.tier);
      div.record.matches.forEach((m, i) => {
        const computed = derive_match_seed(divSeed, i);
        expect(m.seed).toBe(computed);
      });
    });
  });
});

describe("resimulateFromRound", () => {
  it("preserves match count and fixture alignment in the user's division", () => {
    const saved = makeSavedSeason(1998n, 5);
    const userDivIdx = findUserDivisionIdx(saved);
    const userDiv = saved.divisions[userDivIdx];
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 5, override);
    const newUserDiv = result.divisions[userDivIdx];
    expect(newUserDiv.record.matches.length).toBe(userDiv.record.matches.length);
    expect(newUserDiv.record.fixtures).toEqual(userDiv.record.fixtures);
  });

  it("leaves matches before fromRoundIdx untouched", () => {
    const saved = makeSavedSeason(1998n, 10);
    const userDivIdx = findUserDivisionIdx(saved);
    const userDiv = saved.divisions[userDivIdx];
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 10, override);
    const newUserDiv = result.divisions[userDivIdx];
    userDiv.record.fixtures.forEach((f, i) => {
      if (f.round < 10) {
        expect(newUserDiv.record.matches[i]).toEqual(userDiv.record.matches[i]);
      }
    });
  });

  it("leaves matches without the user untouched (even after fromRoundIdx)", () => {
    const saved = makeSavedSeason(1998n, 0);
    const userDivIdx = findUserDivisionIdx(saved);
    const userDiv = saved.divisions[userDivIdx];
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    const newUserDiv = result.divisions[userDivIdx];
    userDiv.record.fixtures.forEach((_, i) => {
      const m = userDiv.record.matches[i];
      const userInvolved =
        m.home === saved.controlledTeamId || m.away === saved.controlledTeamId;
      if (!userInvolved) {
        expect(newUserDiv.record.matches[i]).toEqual(userDiv.record.matches[i]);
      }
    });
  });

  it("leaves the other division entirely untouched", () => {
    const saved = makeSavedSeason(1998n, 0);
    const userDivIdx = findUserDivisionIdx(saved);
    const otherDivIdx = 1 - userDivIdx;
    const otherDiv = saved.divisions[otherDivIdx];
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    const newOtherDiv = result.divisions[otherDivIdx];
    expect(newOtherDiv.record.matches).toEqual(otherDiv.record.matches);
    expect(newOtherDiv.record.standings).toEqual(otherDiv.record.standings);
    expect(newOtherDiv.record.fixtures).toEqual(otherDiv.record.fixtures);
  });

  it("is deterministic — same input produces identical engine output", () => {
    const saved = makeSavedSeason(1998n, 0);
    const userDivIdx = findUserDivisionIdx(saved);
    const override = overrideFor(saved.controlledTeamId);
    const a = resimulateFromRound(saved, 0, override);
    const b = resimulateFromRound(saved, 0, override);
    // savedAt is timestamp-derived (will differ); everything engine-touched
    // must be byte-identical.
    expect(a.divisions[userDivIdx].record.matches).toEqual(
      b.divisions[userDivIdx].record.matches,
    );
    expect(a.divisions[userDivIdx].record.standings).toEqual(
      b.divisions[userDivIdx].record.standings,
    );
    expect(a.userTactics).toEqual(b.userTactics);
  });

  it("populates userTactics on the returned save", () => {
    const saved = makeSavedSeason(1998n, 0);
    expect(saved.userTactics).toBeUndefined();
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    expect(result.userTactics).toEqual(override);
  });

  it("recomputes standings consistent with the new matches array", () => {
    const saved = makeSavedSeason(1998n, 0);
    const userDivIdx = findUserDivisionIdx(saved);
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    const newUserDiv = result.divisions[userDivIdx];
    // Every match counts as "played" for both home and away teams, so the
    // sum across the standings should be exactly 2 × matches.length.
    const totalGames = newUserDiv.record.standings.reduce(
      (sum, s) => sum + s.played,
      0,
    );
    expect(totalGames).toBe(2 * newUserDiv.record.matches.length);
  });
});
