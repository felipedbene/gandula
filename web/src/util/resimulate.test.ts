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
import { divideIntoDivisions, pickStarterTeam, avgStrength } from "./divisions";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { userTeam } from "./roster";
import { evolveTeam } from "./regen";
import { freshCopa } from "./copa";
import { ALL_TEAMS, teamById } from "../teams";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
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
 * Build a v3 Career with all divisions fully simulated. The user is
 * always assigned to Série C's weakest team (via pickStarterTeam) so
 * `findUserDivisionIdxInSeason(career.currentSeason, ...) === 2` is a
 * stable assumption across tests. `currentRoundIdx` is applied to ALL
 * divisions for simplicity — tests that only care about user-division
 * behavior can ignore the other tiers' counters.
 */
function makeCareer(seed: bigint, currentRoundIdx: number): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  return {
    schemaVersion: 8,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
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
    const career = makeCareer(1998n, 0);
    career.currentSeason.divisions.forEach((div) => {
      const divSeed = career.currentSeason.seed ^ BigInt(div.tier);
      div.record.matches.forEach((m, i) => {
        const computed = derive_match_seed(divSeed, i);
        expect(m.seed).toBe(computed);
      });
    });
  });
});

describe("resimulateFromRound", () => {
  it("preserves match count and fixture alignment in the user's division", () => {
    const career = makeCareer(1998n, 5);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const userDiv = career.currentSeason.divisions[userDivIdx];
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 5, override);
    const newUserDiv = result.currentSeason.divisions[userDivIdx];
    expect(newUserDiv.record.matches.length).toBe(userDiv.record.matches.length);
    expect(newUserDiv.record.fixtures).toEqual(userDiv.record.fixtures);
  });

  it("leaves matches before fromRoundIdx untouched", () => {
    const career = makeCareer(1998n, 10);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const userDiv = career.currentSeason.divisions[userDivIdx];
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 10, override);
    const newUserDiv = result.currentSeason.divisions[userDivIdx];
    userDiv.record.fixtures.forEach((f, i) => {
      if (f.round < 10) {
        expect(newUserDiv.record.matches[i]).toEqual(userDiv.record.matches[i]);
      }
    });
  });

  it("leaves matches without the user untouched (even after fromRoundIdx)", () => {
    const career = makeCareer(1998n, 0);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const userDiv = career.currentSeason.divisions[userDivIdx];
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 0, override);
    const newUserDiv = result.currentSeason.divisions[userDivIdx];
    userDiv.record.fixtures.forEach((_, i) => {
      const m = userDiv.record.matches[i];
      const userInvolved =
        m.home === career.controlledTeamId || m.away === career.controlledTeamId;
      if (!userInvolved) {
        expect(newUserDiv.record.matches[i]).toEqual(userDiv.record.matches[i]);
      }
    });
  });

  it("leaves the other divisions entirely untouched", () => {
    const career = makeCareer(1998n, 0);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 0, override);
    career.currentSeason.divisions.forEach((otherDiv, otherDivIdx) => {
      if (otherDivIdx === userDivIdx) return;
      const newOtherDiv = result.currentSeason.divisions[otherDivIdx];
      expect(newOtherDiv.record.matches).toEqual(otherDiv.record.matches);
      expect(newOtherDiv.record.standings).toEqual(otherDiv.record.standings);
      expect(newOtherDiv.record.fixtures).toEqual(otherDiv.record.fixtures);
    });
  });

  it("is deterministic — same input produces identical engine output", () => {
    const career = makeCareer(1998n, 0);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const override = overrideFor(career.controlledTeamId);
    const a = resimulateFromRound(career, 0, override);
    const b = resimulateFromRound(career, 0, override);
    // savedAt is timestamp-derived (will differ); everything engine-touched
    // must be byte-identical.
    expect(a.currentSeason.divisions[userDivIdx].record.matches).toEqual(
      b.currentSeason.divisions[userDivIdx].record.matches,
    );
    expect(a.currentSeason.divisions[userDivIdx].record.standings).toEqual(
      b.currentSeason.divisions[userDivIdx].record.standings,
    );
    expect(a.currentSeason.userTactics).toEqual(b.currentSeason.userTactics);
  });

  it("populates userTactics on the returned career's currentSeason", () => {
    const career = makeCareer(1998n, 0);
    expect(career.currentSeason.userTactics).toBeUndefined();
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 0, override);
    expect(result.currentSeason.userTactics).toEqual(override);
  });

  it("reproduces the user's matches against the EVOLVED opponent (year > FIRST_YEAR)", () => {
    // Advance into seasons where opponents have evolved (aged/retired/youth),
    // then re-simulate from round 0 with the tactics the season actually used.
    // With the registry opponent the results would diverge; with the evolved
    // opponent they reproduce byte-for-byte.
    const advanceSeasons = (career: Career, n: number): Career => {
      let c = career;
      for (let i = 0; i < n; i++) {
        const pr = computePromotionRelegation(c.currentSeason, c.controlledTeamId);
        const { nextSeason, agedUserRoster } = advanceCareer(c, pr);
        c = {
          ...c,
          userRoster: agedUserRoster,
          currentSeason: {
            ...nextSeason,
            divisions: nextSeason.divisions.map((d) => ({
              ...d,
              currentRoundIdx: totalRoundsOf(d),
            })),
          },
        };
      }
      return c;
    };

    // currentRoundIdx 38 ≥ all tiers' round counts ⇒ season 0 is finished.
    const career = advanceSeasons(makeCareer(1998n, 38), 3);
    expect(career.currentSeason.year).toBe(FIRST_YEAR + 3);

    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const userDiv = career.currentSeason.divisions[userDivIdx];

    // Tactics equal to what buildNextSeason used: registry-default formation +
    // tactics, with the reconciled XI/bench from the effective team.
    const eff = userTeam(career);
    const tactics: UserTactics = {
      formation: eff.formation,
      tactics: eff.tactics,
      starting_xi: eff.starting_xi.slice(),
      bench: eff.bench?.slice() ?? [],
    };

    const out = resimulateFromRound(career, 0, tactics);
    const outDiv = out.currentSeason.divisions[userDivIdx];

    let userMatches = 0;
    userDiv.record.fixtures.forEach((_, i) => {
      const m = userDiv.record.matches[i];
      if (m.home === career.controlledTeamId || m.away === career.controlledTeamId) {
        userMatches++;
        expect(outDiv.record.matches[i]).toEqual(m);
      }
    });
    expect(userMatches).toBeGreaterThan(0);

    // Sanity: the evolution is non-trivial here — at least one user opponent's
    // evolved strength differs from its registry strength, so this genuinely
    // exercises the registry-vs-evolved path (not a vacuous pass).
    const elapsed = career.currentSeason.year - FIRST_YEAR;
    const someDiverges = userDiv.record.matches.some((m) => {
      const oppId =
        m.home === career.controlledTeamId
          ? m.away
          : m.away === career.controlledTeamId
            ? m.home
            : undefined;
      if (oppId === undefined) return false;
      const reg = teamById(oppId)!;
      return avgStrength(evolveTeam(reg, elapsed, career.seed)) !== avgStrength(reg);
    });
    expect(someDiverges).toBe(true);
  });

  it("recomputes standings consistent with the new matches array", () => {
    const career = makeCareer(1998n, 0);
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const override = overrideFor(career.controlledTeamId);
    const result = resimulateFromRound(career, 0, override);
    const newUserDiv = result.currentSeason.divisions[userDivIdx];
    // Every match counts as "played" for both home and away teams, so the
    // sum across the standings should be exactly 2 × matches.length.
    const totalGames = newUserDiv.record.standings.reduce(
      (sum, s) => sum + s.played,
      0,
    );
    expect(totalGames).toBe(2 * newUserDiv.record.matches.length);
  });
});
