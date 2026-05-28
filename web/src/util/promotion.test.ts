// Pure unit tests — no WASM, no DOM, no IndexedDB. The util operates
// on a SavedSeason shape we build by hand: synthetic standings in the
// order the engine's compute_standings would have produced.
import { describe, it, expect } from "vitest";
import {
  computePromotionRelegation,
  PROMOTION_SLOTS,
  RELEGATION_SLOTS,
} from "./promotion";
import type { Division, SavedSeason } from "../persistence";
import type { Fixture, Match, SeasonRecord, TeamStats } from "../types";

/** TeamStats fixture builder. Tests only depend on `team_id`, the order
 *  of the standings array, and `points(s)` derivation — wins/draws are
 *  set to make `points = won*3 + drawn` produce the desired total. */
function ts(team_id: number, pts: number): TeamStats {
  const won = Math.floor(pts / 3);
  const drawn = pts - won * 3;
  return {
    team_id,
    played: 14,
    won,
    drawn,
    lost: 14 - won - drawn,
    goals_for: pts * 2,
    goals_against: pts,
  };
}

/** Minimal Division with `totalRoundsOf(div) === totalRounds`. Synthesizes
 *  `totalRounds` fixtures so the helper's `max(fixtures.round) + 1` math
 *  returns the right number; matches are sized to match (P/R doesn't read
 *  them, but the type shape demands the array). */
function makeDivision(
  tier: 1 | 2,
  name: string,
  standings: TeamStats[],
  roundsPlayed: number,
  totalRounds: number,
): Division {
  const fixtures: Fixture[] = Array.from({ length: totalRounds }, (_, i) => ({
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
  const record: SeasonRecord = {
    league_name: name,
    fixtures,
    matches,
    standings,
  };
  return { tier, name, record, currentRoundIdx: roundsPlayed };
}

function makeSaved(opts: {
  controlledTeamId: number;
  tierAStandings: TeamStats[];
  tierBStandings: TeamStats[];
  tierAFinished?: boolean;
  tierBFinished?: boolean;
}): SavedSeason {
  return {
    schemaVersion: 2,
    savedAt: "2026-01-01T00:00:00Z",
    seed: 1998n,
    controlledTeamId: opts.controlledTeamId,
    divisions: [
      makeDivision(
        1,
        "Série A",
        opts.tierAStandings,
        opts.tierAFinished === false ? 7 : 14,
        14,
      ),
      makeDivision(
        2,
        "Série B",
        opts.tierBStandings,
        opts.tierBFinished === false ? 9 : 18,
        18,
      ),
    ],
  };
}

describe("computePromotionRelegation", () => {
  // Standings hand-ordered with strictly descending points so we don't
  // have to second-guess tiebreakers in these tests.
  const tierA: TeamStats[] = [
    ts(101, 30),
    ts(102, 28),
    ts(103, 26),
    ts(104, 24),
    ts(105, 22),
    ts(106, 20),
    ts(107, 18), // 7º — relegated
    ts(108, 16), // 8º — relegated
  ];
  const tierB: TeamStats[] = [
    ts(201, 40), // 1º — promoted
    ts(202, 38), // 2º — promoted
    ts(203, 36),
    ts(204, 34),
    ts(205, 32),
    ts(206, 30),
    ts(207, 28),
    ts(208, 26),
    ts(209, 24),
  ];

  it("promoted contains top 2 of Série B", () => {
    const saved = makeSaved({
      controlledTeamId: 209,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    const result = computePromotionRelegation(saved, saved.controlledTeamId);
    expect(result.promoted.map((s) => s.team_id)).toEqual([201, 202]);
    expect(result.promoted).toHaveLength(PROMOTION_SLOTS);
  });

  it("relegated contains bottom 2 of Série A", () => {
    const saved = makeSaved({
      controlledTeamId: 209,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    const result = computePromotionRelegation(saved, saved.controlledTeamId);
    expect(result.relegated.map((s) => s.team_id)).toEqual([107, 108]);
    expect(result.relegated).toHaveLength(RELEGATION_SLOTS);
  });

  it("userPromoted true when user is 1º of Série B", () => {
    const saved = makeSaved({
      controlledTeamId: 201,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    const result = computePromotionRelegation(saved, saved.controlledTeamId);
    expect(result.userPromoted).toBe(true);
    expect(result.userRelegated).toBe(false);
  });

  it("userPromoted true when user is 2º of Série B", () => {
    const saved = makeSaved({
      controlledTeamId: 202,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    expect(
      computePromotionRelegation(saved, saved.controlledTeamId).userPromoted,
    ).toBe(true);
  });

  it("userPromoted false when user is 3º or lower in Série B", () => {
    const saved = makeSaved({
      controlledTeamId: 203,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    expect(
      computePromotionRelegation(saved, saved.controlledTeamId).userPromoted,
    ).toBe(false);
  });

  it("userRelegated true when user is 7º or 8º of Série A", () => {
    const saved7 = makeSaved({
      controlledTeamId: 107,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    const saved8 = makeSaved({
      controlledTeamId: 108,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    expect(
      computePromotionRelegation(saved7, saved7.controlledTeamId).userRelegated,
    ).toBe(true);
    expect(
      computePromotionRelegation(saved8, saved8.controlledTeamId).userRelegated,
    ).toBe(true);
  });

  it("userRelegated false when user finishes 6º or better in Série A", () => {
    const saved = makeSaved({
      controlledTeamId: 106,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    expect(
      computePromotionRelegation(saved, saved.controlledTeamId).userRelegated,
    ).toBe(false);
  });

  it("PROMOTION_SLOTS equals RELEGATION_SLOTS (preserves 8+9 split)", () => {
    expect(PROMOTION_SLOTS).toBe(RELEGATION_SLOTS);
  });

  it("throws when Série A is not finished", () => {
    const saved = makeSaved({
      controlledTeamId: 209,
      tierAStandings: tierA,
      tierBStandings: tierB,
      tierAFinished: false,
    });
    expect(() =>
      computePromotionRelegation(saved, saved.controlledTeamId),
    ).toThrow(/Série A/);
  });

  it("throws when Série B is not finished", () => {
    const saved = makeSaved({
      controlledTeamId: 209,
      tierAStandings: tierA,
      tierBStandings: tierB,
      tierBFinished: false,
    });
    expect(() =>
      computePromotionRelegation(saved, saved.controlledTeamId),
    ).toThrow(/Série B/);
  });

  it("is deterministic across repeated calls", () => {
    const saved = makeSaved({
      controlledTeamId: 209,
      tierAStandings: tierA,
      tierBStandings: tierB,
    });
    const a = computePromotionRelegation(saved, saved.controlledTeamId);
    const b = computePromotionRelegation(saved, saved.controlledTeamId);
    expect(a).toEqual(b);
  });
});
