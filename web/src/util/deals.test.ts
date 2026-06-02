// @vitest-environment node
//
// Negotiable TV/sponsorship deals (v12): the income functions read a signed
// deal's seasonAmount (else the derived floor) WITHOUT breaking the
// per-round-sums-to-season invariant; offer generation is deterministic;
// signDeal apply∘reverse round-trips; relegation drops the TV deal.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import {
  tvIncomeForRound,
  tvSeasonTotal,
  tvFloor,
  sponsorshipForRound,
  sponsorshipSeasonTotal,
  generateDealOffers,
  scandalStrikesAt,
  SCANDAL_SEASON_CHANCE,
  TV_DEAL_BY_TIER,
} from "./finances";
import {
  applyTransferAction,
  reverseTransferAction,
  type TransferAction,
} from "./transfer-market";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  totalRoundsOf,
  findUserDivisionIdxInSeason,
  type Career,
  type Deal,
} from "../persistence";
import { freshCopa } from "./copa";
import { ALL_TEAMS } from "../teams";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  await init({ module_or_path: readFileSync(WASM_PATH) });
});

function makeCareer(seed: bigint, deals?: Career["manager"]["activeDeals"]): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const tot = (r: SeasonRecord) => Math.max(...r.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 12,
    savedAt: "2026-01-01T00:00:00Z",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: tot(recordA) },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: tot(recordB) },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: {
      money: STARTING_MONEY,
      stadiumCapacity: 12_000,
      fanbase: 10_000,
      marketingMomentum: 0,
      ...(deals ? { activeDeals: deals } : {}),
    },
    userRoster: [],
  };
}

const tvDeal: Deal = {
  id: "tv-2026-1",
  kind: "tv",
  seasonAmount: 4_321_000,
  startYear: FIRST_YEAR,
  termYears: 2,
};

describe("deal income (invariant preserved)", () => {
  it("with no deal, income == the tier-derived floor (v11 behaviour)", () => {
    const c = makeCareer(1998n);
    const div = c.currentSeason.divisions[
      findUserDivisionIdxInSeason(c.currentSeason, c.controlledTeamId)
    ];
    expect(tvSeasonTotal(c)).toBe(TV_DEAL_BY_TIER[div.tier]);
  });

  it("with a signed TV deal, tvSeasonTotal == the deal amount", () => {
    const c = makeCareer(1998n, { tv: tvDeal });
    expect(tvSeasonTotal(c)).toBe(tvDeal.seasonAmount);
  });

  it("per-round TV slices still SUM EXACTLY to the deal amount (fair-rounding)", () => {
    const c = makeCareer(1998n, { tv: tvDeal });
    const div = c.currentSeason.divisions[
      findUserDivisionIdxInSeason(c.currentSeason, c.controlledTeamId)
    ];
    const total = totalRoundsOf(div);
    let sum = 0;
    for (let r = 0; r < total; r++) sum += tvIncomeForRound(c, r);
    expect(sum).toBe(tvDeal.seasonAmount);
  });

  it("sponsorship per-round slices sum to the signed sponsorship amount", () => {
    const dealAmt = 1_234_567;
    const c = makeCareer(1998n, {
      sponsorship: {
        id: "sponsorship-2026-0",
        kind: "sponsorship",
        seasonAmount: dealAmt,
        startYear: FIRST_YEAR,
        termYears: 1,
      },
    });
    expect(sponsorshipSeasonTotal(c)).toBe(dealAmt);
    const div = c.currentSeason.divisions[
      findUserDivisionIdxInSeason(c.currentSeason, c.controlledTeamId)
    ];
    let sum = 0;
    for (let r = 0; r < totalRoundsOf(div); r++) sum += sponsorshipForRound(c, r);
    expect(sum).toBe(dealAmt);
  });
});

describe("generateDealOffers (deterministic)", () => {
  it("same (seed, year, floors) ⇒ identical offers", () => {
    const a = generateDealOffers(1998n, 2027, 3, 600_000, 200_000);
    const b = generateDealOffers(1998n, 2027, 3, 600_000, 200_000);
    expect(a).toEqual(b);
  });

  it("returns 3 TV + 3 sponsorship offers anchored on the floors", () => {
    const o = generateDealOffers(1998n, 2027, 3, 600_000, 200_000);
    expect(o.tv).toHaveLength(3);
    expect(o.sponsorship).toHaveLength(3);
    // The aggressive offer pays more than the conservative one.
    const amts = o.tv.map((d) => d.seasonAmount);
    expect(Math.max(...amts)).toBeGreaterThan(Math.min(...amts));
    o.tv.forEach((d) => {
      expect(d.kind).toBe("tv");
      expect(d.termYears).toBeGreaterThanOrEqual(1);
      expect(d.termYears).toBeLessThanOrEqual(3);
    });
  });

  it("different years produce different slates", () => {
    const y0 = generateDealOffers(1998n, 2027, 3, 600_000, 200_000);
    const y1 = generateDealOffers(1998n, 2028, 3, 600_000, 200_000);
    expect(y0).not.toEqual(y1);
  });
});

describe("signDeal apply/reverse", () => {
  it("apply sets the slot; reverse restores the previous (undefined ⇒ cleared)", () => {
    const c = makeCareer(1998n);
    const action: TransferAction = { kind: "signDeal", slot: "tv", deal: tvDeal };
    const after = applyTransferAction(c, action);
    expect(after.manager.activeDeals?.tv).toEqual(tvDeal);
    const back = reverseTransferAction(after, action);
    expect(back.manager.activeDeals?.tv).toBeUndefined();
  });

  it("replacing an existing deal round-trips to the previous one", () => {
    const c = makeCareer(1998n, { tv: tvDeal });
    const newer: Deal = { ...tvDeal, id: "tv-2026-2", seasonAmount: 5_000_000 };
    const action: TransferAction = {
      kind: "signDeal",
      slot: "tv",
      deal: newer,
      previous: tvDeal,
    };
    const after = applyTransferAction(c, action);
    expect(after.manager.activeDeals?.tv).toEqual(newer);
    const back = reverseTransferAction(after, action);
    expect(back.manager.activeDeals?.tv).toEqual(tvDeal);
  });

  it("signing one slot leaves the other untouched", () => {
    const sponsorDeal: Deal = {
      id: "sponsorship-2026-0",
      kind: "sponsorship",
      seasonAmount: 500_000,
      startYear: FIRST_YEAR,
      termYears: 1,
    };
    const c = makeCareer(1998n, { sponsorship: sponsorDeal });
    const after = applyTransferAction(c, {
      kind: "signDeal",
      slot: "tv",
      deal: tvDeal,
    });
    expect(after.manager.activeDeals?.tv).toEqual(tvDeal);
    expect(after.manager.activeDeals?.sponsorship).toEqual(sponsorDeal);
  });
});

describe("performance clauses on offers", () => {
  it("only the Aggressive offer carries a clause, with the per-tier target", () => {
    for (const [tier, max] of [
      [1, 6],
      [2, 10],
      [3, 12],
    ] as const) {
      const o = generateDealOffers(1998n, 2027, tier, 600_000, 200_000);
      const withClause = o.tv.filter((d) => d.performanceClause);
      expect(withClause).toHaveLength(1);
      expect(withClause[0].label).toBe("Agressiva");
      expect(withClause[0].performanceClause?.maxPosition).toBe(max);
      expect(
        o.sponsorship.find((d) => d.performanceClause)?.performanceClause
          ?.maxPosition,
      ).toBe(max);
    }
  });

  it("the clause-bearing offer is the highest-paying one (risk vs reward)", () => {
    const o = generateDealOffers(1998n, 2027, 1, 3_000_000, 800_000);
    const clauseOffer = o.tv.find((d) => d.performanceClause)!;
    const maxAmt = Math.max(...o.tv.map((d) => d.seasonAmount));
    expect(clauseOffer.seasonAmount).toBe(maxAmt);
  });
});

describe("scandal drop (mid-season, segmented income)", () => {
  it("a dropped TV deal earns pro-rata contract before K + a full floor from K", () => {
    const k = 14;
    const dropped = { ...tvDeal, droppedAtRound: k };
    const c = makeCareer(1998n, { tv: dropped });
    const undropped = makeCareer(1998n, { tv: tvDeal });
    const div = c.currentSeason.divisions[
      findUserDivisionIdxInSeason(c.currentSeason, c.controlledTeamId)
    ];
    const total = totalRoundsOf(div);

    // Pre-drop rounds are exactly the un-dropped contract slices (pro-rata over
    // the full season) — the deal paid its normal rate while it lasted.
    let pre = 0;
    let preUndropped = 0;
    for (let r = 0; r < k; r++) {
      pre += tvIncomeForRound(c, r);
      preUndropped += tvIncomeForRound(undropped, r);
    }
    expect(pre).toBe(preUndropped);

    // Post-drop rounds are the derived floor, sliced over the tail [k,total) so
    // that tail sums to a full floor's worth (each segment fair-rounds clean).
    let post = 0;
    for (let r = k; r < total; r++) post += tvIncomeForRound(c, r);
    expect(post).toBe(tvFloor(c));

    // Realized season total = pro-rata contract to K + a full floor after.
    let all = 0;
    for (let r = 0; r < total; r++) all += tvIncomeForRound(c, r);
    expect(all).toBe(pre + tvFloor(c));
  });

  it("rounds before the drop earn the contract rate, rounds after earn the floor rate", () => {
    const k = 10;
    const dropped = { ...tvDeal, droppedAtRound: k };
    const c = makeCareer(1998n, { tv: dropped });
    const undropped = makeCareer(1998n, { tv: tvDeal });
    // A pre-drop round matches the un-dropped (full-contract) slice.
    expect(tvIncomeForRound(c, 0)).toBe(tvIncomeForRound(undropped, 0));
    // A post-drop round is the floor segment, strictly less than the contract
    // slice (tvDeal pays well above the C floor).
    expect(tvIncomeForRound(c, k)).toBeLessThan(tvIncomeForRound(undropped, k));
  });
});

describe("scandalStrikesAt (deterministic, rare)", () => {
  it("same (seed, year, slot) ⇒ identical strike pattern across rounds", () => {
    const pattern = (s: bigint) =>
      Array.from({ length: 38 }, (_, r) => scandalStrikesAt(s, 2027, "tv", r, 38));
    expect(pattern(1998n)).toEqual(pattern(1998n));
  });

  it("strikes at most ONE round in a season (or none)", () => {
    for (const seed of [1n, 7n, 42n, 99n, 1998n, 2026n]) {
      const hits = Array.from({ length: 38 }, (_, r) =>
        scandalStrikesAt(seed, 2027, "tv", r, 38),
      ).filter(Boolean).length;
      expect(hits).toBeLessThanOrEqual(1);
    }
  });

  it("fires at roughly SCANDAL_SEASON_CHANCE across many seeds", () => {
    const N = 2000;
    let seasonsWithScandal = 0;
    for (let s = 0; s < N; s++) {
      const any = Array.from({ length: 38 }, (_, r) =>
        scandalStrikesAt(BigInt(s), 2027, "tv", r, 38),
      ).some(Boolean);
      if (any) seasonsWithScandal++;
    }
    const rate = seasonsWithScandal / N;
    // Within a loose band of the configured ~5% (PRNG, finite sample).
    expect(rate).toBeGreaterThan(SCANDAL_SEASON_CHANCE * 0.5);
    expect(rate).toBeLessThan(SCANDAL_SEASON_CHANCE * 1.6);
  });
});
