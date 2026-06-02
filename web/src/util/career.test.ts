// @vitest-environment node
//
// advanceCareer integration tests — exercise the full pure pipeline:
// real ALL_TEAMS, real run_season via WASM, real computePromotionRelegation.
// Node env (pattern c) — happy-dom's http:// `import.meta.url` would break
// fileURLToPath; cwd-anchored resolve avoids that. See vitest.config.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import { advanceCareer } from "./career";
import { computePromotionRelegation } from "./promotion";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import { RETIREMENT_AGE } from "./regen";
import { REGEN_ID_BASE } from "./transfer-market";
import { userTeam } from "./roster";
import { freshCopa } from "./copa";
import { ALL_TEAMS, teamById } from "../teams";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  totalRoundsOf,
  type Career,
} from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a freshly-finished Career at year=FIRST_YEAR with all three divisions
 * at their terminal `currentRoundIdx`. Uses real ALL_TEAMS + run_season so
 * standings + P/R outcomes are realistic for the given seed. The user is
 * always the weakest team of Série C (the bottom tier) via pickStarterTeam.
 */
function makeFinishedCareer(seed: bigint): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const totalA = Math.max(...recordA.fixtures.map((f) => f.round)) + 1;
  const totalB = Math.max(...recordB.fixtures.map((f) => f.round)) + 1;
  const totalC = Math.max(...recordC.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 10,
    savedAt: "2026-01-01T00:00:00Z",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: totalA },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: totalB },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: totalC },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000, marketingMomentum: 0 },
    userRoster: [],
  };
}

describe("advanceCareer — history", () => {
  it("year matches the just-finished season's year", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    expect(history.year).toBe(FIRST_YEAR);
  });

  it("captures user's division and 1-based position", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    // User starts as weakest of Série C → tier 3, position 1..20.
    expect(history.userDivision.tier).toBe(3);
    expect(history.userDivision.name).toBe("Série C");
    expect(history.userPosition).toBeGreaterThanOrEqual(1);
    expect(history.userPosition).toBeLessThanOrEqual(20);
  });

  it("champion is the position-0 team of the user's division", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    const userDiv = career.currentSeason.divisions.find((d) => d.tier === 3)!;
    const championId = userDiv.record.standings[0].team_id;
    expect(history.champion.teamId).toBe(championId);
    expect(history.champion.teamName).toBe(teamById(championId)?.name);
  });

  it("userOutcome reflects PRResult flags", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    if (pr.userPromoted) {
      expect(history.userOutcome).toBe("promoted");
    } else if (pr.userRelegated) {
      expect(history.userOutcome).toBe("relegated");
    } else {
      expect(history.userOutcome).toBe("stayed");
    }
  });

  it("promoted/relegated lists have team names resolved", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history } = advanceCareer(career, pr);
    // Both boundaries: 3 promoted (B→A) + 3 promoted (C→B) = 6; same for down.
    expect(history.promoted).toHaveLength(6);
    expect(history.relegated).toHaveLength(6);
    history.promoted.forEach((p) => {
      expect(p.teamName).toBe(teamById(p.teamId)?.name);
    });
    history.relegated.forEach((r) => {
      expect(r.teamName).toBe(teamById(r.teamId)?.name);
    });
  });
});

describe("advanceCareer — nextSeason", () => {
  it("year is current year + 1", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.year).toBe(FIRST_YEAR + 1);
  });

  it("seed is career.seed XOR BigInt(nextYear)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.seed).toBe(1998n ^ BigInt(FIRST_YEAR + 1));
  });

  it("has 3 divisions sized 20 each", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.divisions).toHaveLength(3);
    nextSeason.divisions.forEach((d) =>
      expect(d.record.standings).toHaveLength(20),
    );
  });

  it("P/R movers land in the correct destination tiers", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    const ids = (tier: number) =>
      new Set(
        nextSeason.divisions
          .find((d) => d.tier === tier)!
          .record.standings.map((s) => s.team_id),
      );
    const a = ids(1);
    const b = ids(2);
    const c = ids(3);
    // B→A and C→B promotions; A→B and B→C relegations.
    pr.promotedBtoA.forEach((p) => expect(a.has(p.team_id)).toBe(true));
    pr.promotedCtoB.forEach((p) => expect(b.has(p.team_id)).toBe(true));
    pr.relegatedAtoB.forEach((r) => expect(b.has(r.team_id)).toBe(true));
    pr.relegatedBtoC.forEach((r) => expect(c.has(r.team_id)).toBe(true));
  });

  it("currentRoundIdx is 0 (fresh season, no rounds played yet)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.divisions.every((d) => d.currentRoundIdx === 0)).toBe(
      true,
    );
  });

  it("userTactics is undefined on next season (fresh start)", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    expect(nextSeason.userTactics).toBeUndefined();
  });

  it("user's team appears in exactly one tier after P/R", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { nextSeason } = advanceCareer(career, pr);
    const tiersWithUser = nextSeason.divisions.filter((d) =>
      d.record.standings.some((s) => s.team_id === career.controlledTeamId),
    );
    expect(tiersWithUser).toHaveLength(1);
    if (pr.userPromoted) {
      // User started in Série C; promotion moves them to Série B (tier 2).
      expect(tiersWithUser[0].tier).toBe(2);
    } else {
      // Relegation is impossible from the bottom tier; "stayed" keeps them
      // in Série C (tier 3).
      expect(tiersWithUser[0].tier).toBe(3);
    }
  });
});

describe("advanceCareer — finances", () => {
  it("AdvanceResult includes finances breakdown", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const result = advanceCareer(career, pr);
    expect(result.finances).toBeDefined();
    expect(typeof result.finances.ticketRevenue).toBe("number");
    expect(typeof result.finances.salaries).toBe("number");
    expect(typeof result.finances.prBonus).toBe("number");
    expect(typeof result.finances.net).toBe("number");
  });

  it("history.moneyDelta equals finances.net", () => {
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history, finances } = advanceCareer(career, pr);
    expect(history.moneyDelta).toBe(finances.net);
  });

  it("history.moneyAfter equals career.manager.money + finances.prBonus", () => {
    // Tickets/salaries accrue per round into manager.money during the season,
    // so only the P/R bonus is added at the boundary.
    const career = makeFinishedCareer(1998n);
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    const { history, finances } = advanceCareer(career, pr);
    expect(history.moneyAfter).toBe(career.manager.money + finances.prBonus);
  });
});

describe("advanceCareer — determinism", () => {
  it("same career + same PRResult ⇒ same AdvanceResult", () => {
    const c1 = makeFinishedCareer(1998n);
    const c2 = makeFinishedCareer(1998n);
    const pr1 = computePromotionRelegation(c1.currentSeason, c1.controlledTeamId);
    const pr2 = computePromotionRelegation(c2.currentSeason, c2.controlledTeamId);
    const r1 = advanceCareer(c1, pr1);
    const r2 = advanceCareer(c2, pr2);
    expect(r1.history).toEqual(r2.history);
    expect(r1.nextSeason.seed).toBe(r2.nextSeason.seed);
    expect(
      r1.nextSeason.divisions[0].record.standings.map((s) => s.team_id),
    ).toEqual(
      r2.nextSeason.divisions[0].record.standings.map((s) => s.team_id),
    );
  });

  it("different seeds produce different next-season match seeds", () => {
    const c1 = makeFinishedCareer(1998n);
    const c2 = makeFinishedCareer(2000n);
    const pr1 = computePromotionRelegation(c1.currentSeason, c1.controlledTeamId);
    const pr2 = computePromotionRelegation(c2.currentSeason, c2.controlledTeamId);
    const r1 = advanceCareer(c1, pr1);
    const r2 = advanceCareer(c2, pr2);
    expect(r1.nextSeason.seed).not.toBe(r2.nextSeason.seed);
  });
});

/** Drive the advance pipeline `n` times, mirroring SeasonView: persist the
 *  evolved roster + P/R bonus, and mark the fresh season terminal so the next
 *  computePromotionRelegation sees a finished season. */
function advanceSeasons(career: Career, n: number): Career {
  let c = career;
  for (let i = 0; i < n; i++) {
    const pr = computePromotionRelegation(c.currentSeason, c.controlledTeamId);
    const { nextSeason, finances, agedUserRoster } = advanceCareer(c, pr);
    c = {
      ...c,
      currentSeason: {
        ...nextSeason,
        divisions: nextSeason.divisions.map((d) => ({
          ...d,
          currentRoundIdx: totalRoundsOf(d),
        })),
      },
      manager: { ...c.manager, money: c.manager.money + finances.prBonus },
      userRoster: agedUserRoster,
    };
  }
  return c;
}

describe("advanceCareer — user squad evolution (E.2.c)", () => {
  it("retires a 36+ user player next season and keeps a fieldable roster", () => {
    const career = makeFinishedCareer(1998n);
    const base = teamById(career.controlledTeamId)!;
    // Seed userRoster from the registry with one STARTER one year shy of
    // retirement, so this advance ages them over the threshold.
    const victimId = base.starting_xi[0];
    const userRoster = base.roster.map((p) =>
      p.id === victimId ? { ...p, age: RETIREMENT_AGE - 1 } : { ...p },
    );
    const c = { ...career, userRoster };
    const pr = computePromotionRelegation(c.currentSeason, c.controlledTeamId);
    const { agedUserRoster } = advanceCareer(c, pr);

    expect(agedUserRoster.some((p) => p.id === victimId)).toBe(false); // retired
    expect(agedUserRoster.length).toBe(userRoster.length); // size held by youth
    // The resulting effective team is engine-valid (XI backfilled past the gap).
    const t = userTeam({ ...c, userRoster: agedUserRoster });
    expect(t.starting_xi).toHaveLength(11);
    expect(t.starting_xi).not.toContain(victimId);
    const ids = new Set(agedUserRoster.map((p) => p.id));
    for (const id of t.starting_xi) expect(ids.has(id)).toBe(true);
  });

  it("runs 20 seasons without the user squad degenerating to all-floor veterans", () => {
    const c = advanceSeasons(makeFinishedCareer(1998n), 20);
    // Retirement caps age: nobody is past the threshold (they'd have retired).
    const maxAge = Math.max(...c.userRoster.map((p) => p.age));
    expect(maxAge).toBeLessThan(RETIREMENT_AGE);
    // The squad has refreshed — regen youth are present, not just decayed
    // registry originals.
    expect(c.userRoster.some((p) => p.id >= REGEN_ID_BASE)).toBe(true);
    // Still fieldable after a long career.
    const t = userTeam(c);
    expect(t.starting_xi).toHaveLength(11);
  });

  it("user squad evolution is deterministic for a fixed seed", () => {
    const a = advanceSeasons(makeFinishedCareer(1998n), 5).userRoster;
    const b = advanceSeasons(makeFinishedCareer(1998n), 5).userRoster;
    expect(a).toEqual(b);
  });
});

describe("advanceCareer — input immutability", () => {
  it("does not mutate the input career", () => {
    const career = makeFinishedCareer(1998n);
    const snapshot = JSON.stringify(career, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const pr = computePromotionRelegation(
      career.currentSeason,
      career.controlledTeamId,
    );
    advanceCareer(career, pr);
    const after = JSON.stringify(career, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(after).toBe(snapshot);
  });
});
