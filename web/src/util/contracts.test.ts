// @vitest-environment node
//
// Contract/wage-demand logic is pure. generateWageDemands goes through
// userTeam → teamById, so it uses a real ALL_TEAMS club; the deny/accept paths
// operate on a supplied userRoster and need no registry.
import { describe, expect, it } from "vitest";
import {
  MERCENARY_FRACTION,
  MULTIPLIER_CAP,
  acceptDemand,
  baseWage,
  denyDemand,
  deriveTemperament,
  generateWageDemands,
} from "./contracts";
import { MIN_ROSTER } from "./transfer-market";
import { ALL_TEAMS } from "../teams";
import type { Career } from "../persistence";
import type { Player, Position } from "../types";

function player(id: number, position: Position = "MID"): Player {
  return {
    id,
    name: `Jogador ${id}`,
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

/** Minimal Career carrying only what the contract helpers read. */
function career(over: Partial<Career> & { year?: number }): Career {
  const { year = 2030, ...rest } = over;
  return {
    seed: 999n,
    controlledTeamId: ALL_TEAMS[0].id,
    userRoster: [],
    manager: { money: 1_000_000 },
    currentSeason: { year },
    ...rest,
  } as unknown as Career;
}

/** First player id (scanning up from `from`) with the given temperament. */
function findId(temperament: "loyal" | "mercenary", from = 1): number {
  for (let id = from; id < from + 5000; id++) {
    if (deriveTemperament(id) === temperament) return id;
  }
  throw new Error(`no ${temperament} id found`);
}

describe("deriveTemperament", () => {
  it("is stable for a given id", () => {
    expect(deriveTemperament(42)).toBe(deriveTemperament(42));
  });

  it("splits roughly at MERCENARY_FRACTION across many ids", () => {
    let merc = 0;
    const N = 4000;
    for (let id = 1; id <= N; id++) {
      if (deriveTemperament(id) === "mercenary") merc++;
    }
    const frac = merc / N;
    expect(frac).toBeGreaterThan(MERCENARY_FRACTION - 0.08);
    expect(frac).toBeLessThan(MERCENARY_FRACTION + 0.08);
  });
});

describe("baseWage", () => {
  it("is avg attributes × the salary constant (avg 50 → 25000)", () => {
    expect(baseWage(player(1))).toBe(50 * 500);
  });
});

describe("generateWageDemands", () => {
  it("is deterministic and stays within the squad and the multiplier cap", () => {
    const c = career({ userRoster: ALL_TEAMS[0].roster });
    const a = generateWageDemands(c);
    const b = generateWageDemands(c);
    expect(a).toEqual(b);
    const ids = new Set(ALL_TEAMS[0].roster.map((p) => p.id));
    for (const d of a) {
      expect(ids.has(d.playerId)).toBe(true);
      expect(d.demandedMultiplier).toBeGreaterThan(d.currentMultiplier);
      expect(d.demandedMultiplier).toBeLessThanOrEqual(MULTIPLIER_CAP);
    }
    // Sorted by demanded wage descending.
    const wages = a.map((d) => d.demandedWage);
    expect(wages).toEqual([...wages].sort((x, y) => y - x));
  });

  it("skips players already resolved this year and those at the cap", () => {
    const c = career({ userRoster: ALL_TEAMS[0].roster });
    const demanded = generateWageDemands(c)[0];
    expect(demanded).toBeDefined();

    const resolved = career({
      userRoster: ALL_TEAMS[0].roster,
      contracts: {
        [demanded.playerId]: {
          wageMultiplier: 1,
          morale: 100,
          lastNegotiatedYear: 2030,
        },
      },
    });
    expect(
      generateWageDemands(resolved).some((d) => d.playerId === demanded.playerId),
    ).toBe(false);

    const capped = career({
      userRoster: ALL_TEAMS[0].roster,
      contracts: {
        [demanded.playerId]: { wageMultiplier: MULTIPLIER_CAP, morale: 100 },
      },
    });
    expect(
      generateWageDemands(capped).some((d) => d.playerId === demanded.playerId),
    ).toBe(false);
  });
});

describe("acceptDemand", () => {
  it("raises the multiplier, resets morale, and stamps the year", () => {
    const c = career({ userRoster: ALL_TEAMS[0].roster });
    const next = acceptDemand(c, 12345, 1.3);
    expect(next.contracts?.[12345]).toEqual({
      wageMultiplier: 1.3,
      morale: 100,
      lastNegotiatedYear: 2030,
    });
  });
});

describe("denyDemand", () => {
  it("a mercenary walks for a sell fee when above the roster floor", () => {
    const mercId = findId("mercenary");
    const roster = [
      player(mercId),
      ...Array.from({ length: MIN_ROSTER }, (_, i) => player(mercId + 100 + i)),
    ];
    const c = career({ userRoster: roster });
    const { career: next, outcome } = denyDemand(c, mercId);
    expect(outcome.kind).toBe("walked");
    expect(next.userRoster.some((p) => p.id === mercId)).toBe(false);
    if (outcome.kind === "walked") {
      expect(outcome.cashIn).toBeGreaterThan(0);
      expect(next.manager.money).toBe(1_000_000 + outcome.cashIn);
    }
  });

  it("a loyal player sulks: stays, drops attributes, loses morale", () => {
    const loyalId = findId("loyal");
    const roster = [
      player(loyalId),
      ...Array.from({ length: MIN_ROSTER }, (_, i) => player(loyalId + 100 + i)),
    ];
    const c = career({ userRoster: roster });
    const { career: next, outcome } = denyDemand(c, loyalId);
    expect(outcome.kind).toBe("sulk");
    const after = next.userRoster.find((p) => p.id === loyalId)!;
    expect(after.attributes.pace).toBe(48); // 50 − SULK_ATTR_DROP
    expect(next.contracts?.[loyalId]?.morale).toBe(70); // 100 − 30
  });

  it("a mercenary stuck at the roster floor sulks instead of walking", () => {
    const mercId = findId("mercenary");
    // Exactly MIN_ROSTER players → cannot drop below the floor.
    const roster = [
      player(mercId),
      ...Array.from({ length: MIN_ROSTER - 1 }, (_, i) =>
        player(mercId + 100 + i),
      ),
    ];
    expect(roster.length).toBe(MIN_ROSTER);
    const c = career({ userRoster: roster });
    const { career: next, outcome } = denyDemand(c, mercId);
    expect(outcome.kind).toBe("sulk");
    if (outcome.kind === "sulk") expect(outcome.forced).toBe(true);
    expect(next.userRoster.some((p) => p.id === mercId)).toBe(true);
  });
});
