// @vitest-environment node
//
// Poaching logic is pure. generatePoachBid goes through userTeam → teamById and
// reads ALL_TEAMS for the rival, so it uses a real club; accept/reject operate
// on the supplied userRoster.
import { describe, expect, it } from "vitest";
import {
  POACH_PREMIUM_MAX,
  POACH_PREMIUM_MIN,
  acceptPoach,
  generatePoachBid,
  rejectPoach,
} from "./poaching";
import { MIN_ROSTER, playerOverall, playerPrice } from "./transfer-market";
import { ALL_TEAMS } from "../teams";
import type { Career } from "../persistence";

const team = ALL_TEAMS.find((t) => t.name === "Amazônia do Norte")!;

function career(over: Partial<Career> & { year?: number; seed?: bigint } = {}): Career {
  const { year = 2030, seed = 777n, ...rest } = over;
  return {
    seed,
    controlledTeamId: team.id,
    userRoster: team.roster,
    manager: { money: 1_000_000 },
    currentSeason: { year, transfers: [] },
    ...rest,
  } as unknown as Career;
}

/** Find a seed that yields a bid, so the accept/reject paths have a subject. */
function careerWithBid(): { c: Career; bid: NonNullable<ReturnType<typeof generatePoachBid>> } {
  for (let s = 1; s < 500; s++) {
    const c = career({ seed: BigInt(s) });
    const bid = generatePoachBid(c);
    if (bid) return { c, bid };
  }
  throw new Error("no seed produced a poaching bid");
}

describe("generatePoachBid", () => {
  it("is deterministic for a given (seed, year)", () => {
    const c = career({ seed: 1234n });
    expect(generatePoachBid(c)).toEqual(generatePoachBid(c));
  });

  it("targets the squad's best player with a premium fee from a rival", () => {
    const { bid } = careerWithBid();
    const best = team.roster.reduce((a, b) =>
      playerOverall(b) > playerOverall(a) ? b : a,
    );
    expect(bid.playerId).toBe(best.id);
    expect(bid.rivalId).not.toBe(team.id);
    const sell = playerPrice(best, "sell");
    expect(bid.fee).toBeGreaterThanOrEqual(Math.round(sell * POACH_PREMIUM_MIN));
    expect(bid.fee).toBeLessThanOrEqual(Math.round(sell * POACH_PREMIUM_MAX));
  });

  it("returns null when the squad is at the roster floor", () => {
    const c = career({
      seed: 1n,
      userRoster: team.roster.slice(0, MIN_ROSTER),
    });
    expect(generatePoachBid(c)).toBeNull();
  });

  it("returns null for a player already resolved this pre-season", () => {
    const { c, bid } = careerWithBid();
    const resolved = career({
      seed: c.seed,
      contracts: {
        [bid.playerId]: { wageMultiplier: 1, morale: 100, lastNegotiatedYear: 2030 },
      },
    });
    expect(generatePoachBid(resolved)).toBeNull();
  });
});

describe("acceptPoach", () => {
  it("removes the player, banks the fee, and records a sell", () => {
    const { c, bid } = careerWithBid();
    const next = acceptPoach(c, bid);
    expect(next.userRoster.some((p) => p.id === bid.playerId)).toBe(false);
    expect(next.manager.money).toBe(1_000_000 + bid.fee);
    expect(next.currentSeason.transfers.at(-1)).toMatchObject({
      kind: "sell",
      price: bid.fee,
      playerName: bid.name,
    });
  });
});

describe("rejectPoach", () => {
  it("keeps the player but dents morale and stamps the year", () => {
    const { c, bid } = careerWithBid();
    const next = rejectPoach(c, bid);
    expect(next.userRoster.some((p) => p.id === bid.playerId)).not.toBe(false);
    const contract = next.contracts?.[bid.playerId];
    expect(contract?.morale).toBe(80); // 100 − REJECT_MORALE_HIT
    expect(contract?.lastNegotiatedYear).toBe(2030);
  });
});
