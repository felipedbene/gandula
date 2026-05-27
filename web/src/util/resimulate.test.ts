// @vitest-environment node
//
// Pure-compute tests over the WASM engine — no DOM. Node env gives us
// file:// `import.meta.url` so we can anchor the wasm path to this file.
// happy-dom resolves import.meta.url to http://localhost:3000/... and the
// fileURLToPath call would throw "URL must be of scheme file" (see D.1.b
// investigation notes).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import { derive_match_seed } from "../wasm/gandula_wasm.js";
import { applyUserTactics, resimulateFromRound } from "./resimulate";
import { ALL_TEAMS, teamById } from "../teams";
import type { SavedSeason, UserTactics } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

function makeSavedSeason(
  seed: bigint,
  controlledTeamId: number,
  currentRoundIdx: number,
): SavedSeason {
  const record = run_season(ALL_TEAMS, seed, "Test League") as SeasonRecord;
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId,
    currentRoundIdx,
    record,
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
  it("matches the seeds the engine used internally during run_season", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 0);
    saved.record.matches.forEach((m, i) => {
      const computed = derive_match_seed(saved.seed, i);
      expect(m.seed).toBe(computed);
    });
  });
});

describe("resimulateFromRound", () => {
  it("preserves match count and fixture alignment", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 5);
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 5, override);
    expect(result.record.matches.length).toBe(saved.record.matches.length);
    expect(result.record.fixtures).toEqual(saved.record.fixtures);
  });

  it("leaves matches before fromRoundIdx untouched", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 10);
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 10, override);
    saved.record.fixtures.forEach((f, i) => {
      if (f.round < 10) {
        expect(result.record.matches[i]).toEqual(saved.record.matches[i]);
      }
    });
  });

  it("leaves matches without the user untouched (even after fromRoundIdx)", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 0);
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    saved.record.fixtures.forEach((_, i) => {
      const m = saved.record.matches[i];
      const userInvolved =
        m.home === saved.controlledTeamId || m.away === saved.controlledTeamId;
      if (!userInvolved) {
        expect(result.record.matches[i]).toEqual(saved.record.matches[i]);
      }
    });
  });

  it("is deterministic — same input produces identical engine output", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 0);
    const override = overrideFor(saved.controlledTeamId);
    const a = resimulateFromRound(saved, 0, override);
    const b = resimulateFromRound(saved, 0, override);
    // savedAt is timestamp-derived (will differ); everything engine-touched
    // must be byte-identical.
    expect(a.record.matches).toEqual(b.record.matches);
    expect(a.record.standings).toEqual(b.record.standings);
    expect(a.userTactics).toEqual(b.userTactics);
  });

  it("populates userTactics on the returned save", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 0);
    expect(saved.userTactics).toBeUndefined();
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    expect(result.userTactics).toEqual(override);
  });

  it("recomputes standings consistent with the new matches array", () => {
    const saved = makeSavedSeason(1998n, ALL_TEAMS[0].id, 0);
    const override = overrideFor(saved.controlledTeamId);
    const result = resimulateFromRound(saved, 0, override);
    // Every match counts a "played" for both home and away teams, so the
    // sum across the standings table should be exactly 2 × matches.length.
    const totalGames = result.record.standings.reduce(
      (sum, s) => sum + s.played,
      0,
    );
    expect(totalGames).toBe(2 * result.record.matches.length);
  });
});
