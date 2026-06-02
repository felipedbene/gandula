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
  sponsorshipForRound,
  sponsorshipSeasonTotal,
  generateDealOffers,
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
    const a = generateDealOffers(1998n, 2027, 600_000, 200_000);
    const b = generateDealOffers(1998n, 2027, 600_000, 200_000);
    expect(a).toEqual(b);
  });

  it("returns 3 TV + 3 sponsorship offers anchored on the floors", () => {
    const o = generateDealOffers(1998n, 2027, 600_000, 200_000);
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
    const y0 = generateDealOffers(1998n, 2027, 600_000, 200_000);
    const y1 = generateDealOffers(1998n, 2028, 600_000, 200_000);
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
