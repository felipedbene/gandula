// Pure unit tests — no WASM, no DOM, no IndexedDB. The util operates on a
// season-shaped value we build by hand: synthetic standings in the order the
// engine's compute_standings would have produced.
import { describe, it, expect } from "vitest";
import {
  computePromotionRelegation,
  PROMOTION_SLOTS,
  RELEGATION_SLOTS,
} from "./promotion";
import type { Division } from "../persistence";
import type { Fixture, Match, SeasonRecord, TeamStats } from "../types";

const TIER_SIZE = 20;
const TOTAL_ROUNDS = (TIER_SIZE - 1) * 2; // 38 — even N, no byes

/** TeamStats fixture builder. Tests only depend on `team_id`, the order of
 *  the standings array, and `points(s)` derivation. */
function ts(team_id: number, pts: number): TeamStats {
  const won = Math.floor(pts / 3);
  const drawn = pts - won * 3;
  return {
    team_id,
    played: TOTAL_ROUNDS,
    won,
    drawn,
    lost: TOTAL_ROUNDS - won - drawn,
    goals_for: pts * 2,
    goals_against: pts,
  };
}

/** A 20-team standings list for one tier, ids `base+1 … base+20`, with
 *  strictly descending points so tiebreakers never come into play. */
function tierStandings(base: number): TeamStats[] {
  return Array.from({ length: TIER_SIZE }, (_, i) =>
    ts(base + i + 1, 100 - i * 2),
  );
}

function makeDivision(
  tier: 1 | 2 | 3,
  name: string,
  standings: TeamStats[],
  finished: boolean,
): Division {
  const fixtures: Fixture[] = Array.from({ length: TOTAL_ROUNDS }, (_, i) => ({
    round: i,
    home_idx: 0,
    away_idx: 1,
  }));
  const matches: Match[] = fixtures.map(() => ({
    home: standings[0]?.team_id ?? 0,
    away: standings[1]?.team_id ?? 0,
    seed: 0n,
    result: { home_goals: 0, away_goals: 0 },
    events: [],
  }));
  const record: SeasonRecord = { league_name: name, fixtures, matches, standings };
  return {
    tier,
    name,
    record,
    currentRoundIdx: finished ? TOTAL_ROUNDS : Math.floor(TOTAL_ROUNDS / 2),
  };
}

// Tier A ids 101–120, B 201–220, C 301–320.
const tierA = tierStandings(100);
const tierB = tierStandings(200);
const tierC = tierStandings(300);

function makeSeason(opts: {
  controlledTeamId: number;
  aFinished?: boolean;
  bFinished?: boolean;
  cFinished?: boolean;
}): { divisions: Division[] } {
  return {
    divisions: [
      makeDivision(1, "Série A", tierA, opts.aFinished ?? true),
      makeDivision(2, "Série B", tierB, opts.bFinished ?? true),
      makeDivision(3, "Série C", tierC, opts.cFinished ?? true),
    ],
  };
}

const ids = (xs: TeamStats[]) => xs.map((s) => s.team_id);

describe("computePromotionRelegation", () => {
  it("slot constants: 3 up / 3 down per boundary", () => {
    expect(PROMOTION_SLOTS).toBe(3);
    expect(RELEGATION_SLOTS).toBe(3);
  });

  it("promotedBtoA = top 3 of Série B", () => {
    const r = computePromotionRelegation(makeSeason({ controlledTeamId: 320 }), 320);
    expect(ids(r.promotedBtoA)).toEqual([201, 202, 203]);
    expect(r.promotedBtoA).toHaveLength(PROMOTION_SLOTS);
  });

  it("relegatedAtoB = bottom 3 of Série A (18º,19º,20º order)", () => {
    const r = computePromotionRelegation(makeSeason({ controlledTeamId: 320 }), 320);
    expect(ids(r.relegatedAtoB)).toEqual([118, 119, 120]);
    expect(r.relegatedAtoB).toHaveLength(RELEGATION_SLOTS);
  });

  it("promotedCtoB = top 3 of Série C", () => {
    const r = computePromotionRelegation(makeSeason({ controlledTeamId: 320 }), 320);
    expect(ids(r.promotedCtoB)).toEqual([301, 302, 303]);
  });

  it("relegatedBtoC = bottom 3 of Série B", () => {
    const r = computePromotionRelegation(makeSeason({ controlledTeamId: 320 }), 320);
    expect(ids(r.relegatedBtoC)).toEqual([218, 219, 220]);
  });

  it("userPromoted when user is top-3 of B (B→A) or top-3 of C (C→B)", () => {
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 201 }), 201).userPromoted).toBe(true);
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 303 }), 303).userPromoted).toBe(true);
  });

  it("userPromoted false below the promotion line", () => {
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 204 }), 204).userPromoted).toBe(false);
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 304 }), 304).userPromoted).toBe(false);
  });

  it("userRelegated when user is bottom-3 of A (A→B) or bottom-3 of B (B→C)", () => {
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 120 }), 120).userRelegated).toBe(true);
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 220 }), 220).userRelegated).toBe(true);
  });

  it("userRelegated false above the relegation line", () => {
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 117 }), 117).userRelegated).toBe(false);
    expect(computePromotionRelegation(makeSeason({ controlledTeamId: 217 }), 217).userRelegated).toBe(false);
  });

  it("the middle tier both promotes and is relegated from", () => {
    const r = computePromotionRelegation(makeSeason({ controlledTeamId: 320 }), 320);
    // B sends 3 up and 3 down → nets zero, keeping 20.
    expect(r.promotedBtoA).toHaveLength(3);
    expect(r.relegatedBtoC).toHaveLength(3);
  });

  it.each([
    ["Série A", { aFinished: false }, /Série A/],
    ["Série B", { bFinished: false }, /Série B/],
    ["Série C", { cFinished: false }, /Série C/],
  ])("throws when %s is not finished", (_label, partial, re) => {
    expect(() =>
      computePromotionRelegation(makeSeason({ controlledTeamId: 320, ...partial }), 320),
    ).toThrow(re as RegExp);
  });

  it("is deterministic across repeated calls", () => {
    const season = makeSeason({ controlledTeamId: 320 });
    expect(computePromotionRelegation(season, 320)).toEqual(
      computePromotionRelegation(season, 320),
    );
  });
});
