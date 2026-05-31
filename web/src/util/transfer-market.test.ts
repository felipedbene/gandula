// Pure unit tests — no WASM, no DOM, no IndexedDB. generateFreeAgents is
// fully deterministic from (seed, year), so we assert structure +
// repeatability without needing a "fixed gold" sample.
import { describe, expect, it } from "vitest";
import {
  BUY_MULTIPLIER,
  FREE_AGENT_ID_BASE,
  FREE_AGENT_ID_YEAR_STRIDE,
  MAX_ROSTER,
  MIN_ROSTER,
  POOL_COMPOSITION,
  POOL_SIZE,
  SELL_MULTIPLIER,
  canBuy,
  canExpand,
  canSell,
  generateFreeAgents,
  playerOverall,
  playerPrice,
  scoutReport,
} from "./transfer-market";
import {
  STADIUM_MAX_CAPACITY,
  expansionCost,
} from "./finances";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  type Career,
  type Division,
} from "../persistence";
import type { Fixture, Match, Player, TeamStats } from "../types";

// ─── Synthetic Career builder (no WASM) ──────────────────────────────────
//
// canBuy/canSell only need userRoster (or registry team via teamById),
// manager.money, and currentSeason.userTactics. Build a minimal v5
// shape with a userRoster of `rosterSize` synthetic players so we can
// exercise the bound checks without standing up the full engine.

function makePlayer(id: number, position: "GK" | "DEF" | "MID" | "FWD"): Player {
  return {
    id,
    name: `P${id}`,
    age: 25,
    position,
    attributes: {
      pace: 50,
      technique: 50,
      passing: 50,
      defending: 50,
      finishing: 50,
      stamina: 50,
    },
  };
}

function makeDivision(): Division {
  const standings: TeamStats[] = [
    {
      team_id: 1,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
    },
  ];
  const fixtures: Fixture[] = [];
  const matches: Match[] = [];
  return {
    tier: 1,
    name: "Série A",
    record: { league_name: "test", fixtures, matches, standings },
    currentRoundIdx: 0,
  };
}

function makeCareer(opts: {
  rosterSize: number;
  money?: number;
  xiIds?: number[];
}): Career {
  const roster = Array.from({ length: opts.rosterSize }, (_, i) =>
    makePlayer(1000 + i, "MID"),
  );
  return {
    schemaVersion: 8,
    savedAt: "2026-01-01T00:00:00Z",
    seed: 1998n,
    controlledTeamId: 1,
    seasons: [],
    currentSeason: {
      copa: freshCopa(),
      year: FIRST_YEAR,
      seed: 1998n ^ BigInt(FIRST_YEAR),
      divisions: [makeDivision()],
      // userTactics with the supplied XI ids (or unset for registry-default
      // XI — but our synthetic team has none registered, so undefined is
      // the right default for "no XI restriction"; tests that exercise the
      // XI branch supply xiIds explicitly).
      ...(opts.xiIds !== undefined
        ? {
            userTactics: {
              formation: "F442",
              tactics: {
                mentality: "Balanced",
                tempo: "Normal",
                pressing: "Medium",
                width: "Normal",
              },
              starting_xi: opts.xiIds,
              bench: [],
            },
          }
        : {}),
      transfers: [],
    },
    manager: { money: opts.money ?? STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: roster,
  };
}

// Because canBuy/canSell internally call userTeam(career) which calls
// teamById(controlledTeamId), we need teamById to return *some* team
// when called with id 1. Real ALL_TEAMS doesn't have id 1 — but our
// makeCareer puts a non-empty userRoster, and userTeam returns
// `{...base, roster: userRoster}` only when base exists. To dodge
// teamById entirely we use a team id known to exist in ALL_TEAMS:
// the first team's id.
import { ALL_TEAMS } from "../teams";
import { freshCopa } from "./copa";
const REAL_TEAM_ID = ALL_TEAMS[0].id;

function makeCareerWithRealTeam(opts: {
  rosterSize: number;
  money?: number;
  xiIds?: number[];
}): Career {
  const c = makeCareer(opts);
  c.controlledTeamId = REAL_TEAM_ID;
  return c;
}

// ─── generateFreeAgents tests ────────────────────────────────────────────

describe("generateFreeAgents", () => {
  it("returns POOL_SIZE players with the configured positional split", () => {
    const pool = generateFreeAgents(1998n, FIRST_YEAR);
    expect(pool).toHaveLength(POOL_SIZE);
    const byPos = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    pool.forEach((p) => byPos[p.position]++);
    expect(byPos).toEqual(POOL_COMPOSITION);
  });

  it("is deterministic — same (seed, year) ⇒ same players", () => {
    const a = generateFreeAgents(1998n, FIRST_YEAR);
    const b = generateFreeAgents(1998n, FIRST_YEAR);
    expect(a).toEqual(b);
  });

  it("different years produce different pools", () => {
    const y0 = generateFreeAgents(1998n, FIRST_YEAR);
    const y1 = generateFreeAgents(1998n, FIRST_YEAR + 1);
    // Names + attributes should differ; comparing full equality is enough.
    expect(y0).not.toEqual(y1);
  });

  it("different years produce non-colliding ids (year-stride)", () => {
    const y0 = generateFreeAgents(1998n, FIRST_YEAR);
    const y1 = generateFreeAgents(1998n, FIRST_YEAR + 1);
    const y0Ids = new Set(y0.map((p) => p.id));
    const y1Ids = new Set(y1.map((p) => p.id));
    y1.forEach((p) => expect(y0Ids.has(p.id)).toBe(false));
    y0.forEach((p) => expect(y1Ids.has(p.id)).toBe(false));
  });

  it("ids start at FREE_AGENT_ID_BASE for year=FIRST_YEAR", () => {
    const pool = generateFreeAgents(1998n, FIRST_YEAR);
    expect(pool[0].id).toBe(FREE_AGENT_ID_BASE);
    expect(pool[POOL_SIZE - 1].id).toBe(FREE_AGENT_ID_BASE + POOL_SIZE - 1);
  });

  it("ids strided by FREE_AGENT_ID_YEAR_STRIDE per year", () => {
    const y1 = generateFreeAgents(1998n, FIRST_YEAR + 1);
    expect(y1[0].id).toBe(FREE_AGENT_ID_BASE + FREE_AGENT_ID_YEAR_STRIDE);
  });

  it("free agent ids do not collide with registry team player ids", () => {
    // Registry ids top out well below 100_000 (highest is 62916 today);
    // FREE_AGENT_ID_BASE is 900_000.
    const pool = generateFreeAgents(1998n, FIRST_YEAR);
    pool.forEach((p) => expect(p.id).toBeGreaterThanOrEqual(FREE_AGENT_ID_BASE));
  });
});

// ─── playerPrice tests ───────────────────────────────────────────────────

describe("playerPrice", () => {
  function makeAvgPlayer(avg: number, age: number): Player {
    // All six attrs set equal so the average is exactly `avg`.
    return {
      id: 999_999,
      name: "Test",
      age,
      position: "MID",
      attributes: {
        pace: avg,
        technique: avg,
        passing: avg,
        defending: avg,
        finishing: avg,
        stamina: avg,
      },
    };
  }

  it("buy at age 25 (1.3x curve): 50² × 100 × 1.3 × 1.0 = 325_000", () => {
    const p = makeAvgPlayer(50, 25);
    expect(playerPrice(p, "buy")).toBe(325_000);
  });

  it("sell applies SELL_MULTIPLIER haircut", () => {
    const p = makeAvgPlayer(50, 25);
    const buy = playerPrice(p, "buy");
    const sell = playerPrice(p, "sell");
    expect(sell).toBe(Math.round(buy * SELL_MULTIPLIER));
  });

  it("BUY_MULTIPLIER vs SELL_MULTIPLIER: buy > sell for same player", () => {
    const p = makeAvgPlayer(60, 28);
    expect(playerPrice(p, "buy")).toBeGreaterThan(playerPrice(p, "sell"));
    expect(BUY_MULTIPLIER).toBeGreaterThan(SELL_MULTIPLIER);
  });

  it("age curve: under-21 prime (1.5x) costs more than peak (1.0x) at same avg", () => {
    const young = makeAvgPlayer(60, 20);
    const peak = makeAvgPlayer(60, 27);
    expect(playerPrice(young, "buy")).toBeGreaterThan(playerPrice(peak, "buy"));
  });

  it("age curve: veteran (0.4x) costs less than peak at same avg", () => {
    const vet = makeAvgPlayer(60, 34);
    const peak = makeAvgPlayer(60, 27);
    expect(playerPrice(vet, "buy")).toBeLessThan(playerPrice(peak, "buy"));
  });
});

// ─── canBuy tests ────────────────────────────────────────────────────────

describe("canBuy", () => {
  it("succeeds when roster has room and money covers price", () => {
    const c = makeCareerWithRealTeam({ rosterSize: 16, money: 500_000 });
    expect(canBuy(c, 200_000)).toEqual({ ok: true });
  });

  it("fails when roster is at MAX_ROSTER", () => {
    const c = makeCareerWithRealTeam({ rosterSize: MAX_ROSTER, money: 9_000_000 });
    const r = canBuy(c, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Roster cheio/);
  });

  it("fails when money < price", () => {
    const c = makeCareerWithRealTeam({ rosterSize: 16, money: 100 });
    const r = canBuy(c, 500_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Dinheiro insuficiente/);
  });
});

// ─── canSell tests ───────────────────────────────────────────────────────

describe("canSell", () => {
  it("succeeds for a player not in XI when above MIN_ROSTER", () => {
    const c = makeCareerWithRealTeam({ rosterSize: 16, xiIds: [9999] });
    expect(canSell(c, 1000)).toEqual({ ok: true });
  });

  it("fails when roster is at MIN_ROSTER", () => {
    const c = makeCareerWithRealTeam({ rosterSize: MIN_ROSTER, xiIds: [9999] });
    const r = canSell(c, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Roster mínimo/);
  });

  it("fails when player is in the effective XI (userTactics)", () => {
    const c = makeCareerWithRealTeam({ rosterSize: 16, xiIds: [1000] });
    const r = canSell(c, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Tire do XI/);
  });
});

describe("scoutReport", () => {
  // A player whose every attribute equals `level`, so playerOverall === level.
  function atLevel(
    id: number,
    position: "GK" | "DEF" | "MID" | "FWD",
    level: number,
  ): Player {
    return {
      id,
      name: `P${id}`,
      age: 25,
      position,
      attributes: {
        pace: level,
        technique: level,
        passing: level,
        defending: level,
        finishing: level,
        stamina: level,
      },
    };
  }

  const roster: Player[] = [
    atLevel(1, "MID", 60),
    atLevel(2, "MID", 70),
    atLevel(3, "DEF", 80),
  ];

  it("overall is the rounded mean of attributes", () => {
    expect(playerOverall(atLevel(9, "MID", 64))).toBe(64);
  });

  it("compares against the same-position squad average", () => {
    const r = scoutReport(atLevel(9, "MID", 80), roster);
    expect(r.overall).toBe(80);
    expect(r.samePositionCount).toBe(2);
    expect(r.positionAvg).toBe(65); // mean of 60, 70
    expect(r.delta).toBe(15);
    expect(r.rank).toBe(1); // better than both MIDs
  });

  it("ranks a weaker agent below the squad", () => {
    const r = scoutReport(atLevel(9, "MID", 50), roster);
    expect(r.delta).toBe(-15);
    expect(r.rank).toBe(3); // both MIDs are better
  });

  it("handles a position the squad has none of", () => {
    const r = scoutReport(atLevel(9, "FWD", 55), roster);
    expect(r.samePositionCount).toBe(0);
    expect(r.positionAvg).toBe(0);
    expect(r.delta).toBe(0);
    expect(r.rank).toBe(1);
  });
});

describe("canExpand (E.4.b.4 stadium)", () => {
  it("allows expansion with enough money below the cap", () => {
    const career = makeCareer({ rosterSize: 16, money: 5_000_000 });
    expect(canExpand(career).ok).toBe(true);
  });

  it("blocks when money is below the expansion cost", () => {
    const career = makeCareer({ rosterSize: 16, money: 1_000 });
    const r = canExpand(career);
    expect(r.ok).toBe(false);
  });

  it("blocks at the capacity cap", () => {
    const career = makeCareer({ rosterSize: 16, money: 1_000_000_000 });
    const maxed: Career = {
      ...career,
      manager: { ...career.manager, stadiumCapacity: STADIUM_MAX_CAPACITY },
    };
    const r = canExpand(maxed);
    expect(r.ok).toBe(false);
  });

  it("expansionCost rises with capacity", () => {
    expect(expansionCost(30_000)).toBeGreaterThan(expansionCost(10_000));
  });
});
