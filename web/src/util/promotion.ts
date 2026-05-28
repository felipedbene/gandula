import type { Division } from "../persistence";
import { totalRoundsOf } from "../persistence";
import type { TeamStats } from "../types";

/** Top 2 of Série B earn promotion to Série A. Symmetric with relegation
 *  so the 8+9 split is preserved season-to-season (when E.1.c lands). */
export const PROMOTION_SLOTS = 2;
/** Bottom 2 of Série A are relegated to Série B. */
export const RELEGATION_SLOTS = 2;

/**
 * Outcome of a season's promotion / relegation calculation. Pure
 * derivation from the final standings of both divisions — does not
 * mutate the input, does not generate the next season's divisions
 * (that's `advanceCareer` in util/career.ts).
 *
 * Order conventions:
 *   - `promoted`: best-of-Série-B first (champion → runner-up).
 *   - `relegated`: best-of-the-relegated-set first. I.e. relegated[0] is
 *     the team that finished 7º of Série A, relegated[last] is the team
 *     that finished 8º. Mirrors how they appear in the original
 *     standings array (slicing preserves order).
 */
export type PRResult = {
  promoted: TeamStats[];
  relegated: TeamStats[];
  userPromoted: boolean;
  userRelegated: boolean;
};

/**
 * Compute promotion / relegation for the just-finished season. Requires
 * both divisions to have played all their rounds — otherwise standings
 * are provisional and a P/R verdict would be incoherent. The throw is a
 * defensive invariant for E.1.c, when the user can end up in either tier.
 *
 * The first parameter is typed structurally (`{ divisions: Division[] }`)
 * so the same function works for both Season (v3 — `career.currentSeason`)
 * and SavedSeason (legacy v2). The transitional window between E.1.c.2
 * and E.1.c.3 has both shapes in play; once E.1.c.3 removes SavedSeason
 * the parameter can be narrowed to Season.
 *
 * Tiebreakers come for free from the engine's `compute_standings` sort
 * (Pts desc, GD desc, GF desc, team_id asc) — `record.standings` is
 * already in that order, so slicing is the entire algorithm.
 */
export function computePromotionRelegation(
  state: { divisions: Division[] },
  controlledTeamId: number,
): PRResult {
  const tierA = state.divisions.find((d) => d.tier === 1);
  const tierB = state.divisions.find((d) => d.tier === 2);
  if (!tierA || !tierB) {
    throw new Error(
      "computePromotionRelegation: state must have both Série A (tier 1) and Série B (tier 2)",
    );
  }

  if (tierA.currentRoundIdx < totalRoundsOf(tierA)) {
    throw new Error(
      `computePromotionRelegation: Série A not finished (round ${tierA.currentRoundIdx} of ${totalRoundsOf(tierA)})`,
    );
  }
  if (tierB.currentRoundIdx < totalRoundsOf(tierB)) {
    throw new Error(
      `computePromotionRelegation: Série B not finished (round ${tierB.currentRoundIdx} of ${totalRoundsOf(tierB)})`,
    );
  }

  const promoted = tierB.record.standings.slice(0, PROMOTION_SLOTS);
  const relegated = tierA.record.standings.slice(-RELEGATION_SLOTS);

  return {
    promoted,
    relegated,
    userPromoted: promoted.some((s) => s.team_id === controlledTeamId),
    userRelegated: relegated.some((s) => s.team_id === controlledTeamId),
  };
}

/**
 * Collapse the two boolean flags on PRResult into the single string the
 * history record + finances UI consume. Shared so the derivation lives
 * in one place — buildSeasonHistory (career.ts) and computeSeasonFinances
 * (finances.ts) both call this rather than duplicating the ternary.
 */
export function userOutcomeFromPRResult(
  pr: PRResult,
): "promoted" | "relegated" | "stayed" {
  if (pr.userPromoted) return "promoted";
  if (pr.userRelegated) return "relegated";
  return "stayed";
}
