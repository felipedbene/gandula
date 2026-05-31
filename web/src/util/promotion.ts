import type { Division } from "../persistence";
import { totalRoundsOf } from "../persistence";
import type { TeamStats } from "../types";

/** Teams promoted at EACH boundary (Série C→B and Série B→A). With 3 up / 3
 *  down at both boundaries, the middle tier nets zero (−3 up, −3 down, +3 from
 *  A, +3 from C), so every tier holds 20. Mirrors the Brasileirão. */
export const PROMOTION_SLOTS = 3;
/** Teams relegated at EACH boundary (Série A→B and Série B→C). */
export const RELEGATION_SLOTS = 3;

/**
 * Outcome of a season's promotion / relegation across the two boundaries of
 * the three-tier pyramid. Pure derivation from the final standings — does not
 * mutate the input, does not generate the next season's divisions (that's
 * `buildNextSeason` in util/career.ts).
 *
 * Four movement lists, one per direction. Each preserves the source
 * standings' order (slicing keeps the engine's Pts-desc sort):
 *   - `promotedBtoA`:   top 3 of Série B (champion first).
 *   - `relegatedAtoB`:  bottom 3 of Série A (best-of-the-relegated first,
 *                       i.e. 18º before 19º before 20º).
 *   - `promotedCtoB`:   top 3 of Série C.
 *   - `relegatedBtoC`:  bottom 3 of Série B.
 */
export type PRResult = {
  promotedBtoA: TeamStats[];
  relegatedAtoB: TeamStats[];
  promotedCtoB: TeamStats[];
  relegatedBtoC: TeamStats[];
  userPromoted: boolean;
  userRelegated: boolean;
};

/**
 * Compute promotion / relegation for the just-finished season. Requires all
 * three divisions to have played every round — otherwise standings are
 * provisional and a P/R verdict would be incoherent.
 *
 * The first parameter is typed structurally (`{ divisions: Division[] }`) so
 * it works for any season-shaped value carrying the three tiers.
 *
 * Tiebreakers come for free from the engine's `compute_standings` sort
 * (Pts desc, GD desc, GF desc, team_id asc) — `record.standings` is already
 * in that order, so slicing is the entire algorithm.
 */
export function computePromotionRelegation(
  state: { divisions: Division[] },
  controlledTeamId: number,
): PRResult {
  const tierA = state.divisions.find((d) => d.tier === 1);
  const tierB = state.divisions.find((d) => d.tier === 2);
  const tierC = state.divisions.find((d) => d.tier === 3);
  if (!tierA || !tierB || !tierC) {
    throw new Error(
      "computePromotionRelegation: state must have Série A (1), B (2) and C (3)",
    );
  }

  for (const div of [tierA, tierB, tierC]) {
    if (div.currentRoundIdx < totalRoundsOf(div)) {
      throw new Error(
        `computePromotionRelegation: ${div.name} not finished (round ${div.currentRoundIdx} of ${totalRoundsOf(div)})`,
      );
    }
  }

  const promotedBtoA = tierB.record.standings.slice(0, PROMOTION_SLOTS);
  const relegatedAtoB = tierA.record.standings.slice(-RELEGATION_SLOTS);
  const promotedCtoB = tierC.record.standings.slice(0, PROMOTION_SLOTS);
  const relegatedBtoC = tierB.record.standings.slice(-RELEGATION_SLOTS);

  const isUser = (s: TeamStats) => s.team_id === controlledTeamId;

  return {
    promotedBtoA,
    relegatedAtoB,
    promotedCtoB,
    relegatedBtoC,
    userPromoted: promotedBtoA.some(isUser) || promotedCtoB.some(isUser),
    userRelegated: relegatedAtoB.some(isUser) || relegatedBtoC.some(isUser),
  };
}

/**
 * Collapse the two boolean flags on PRResult into the single string the
 * history record + finances UI consume. Shared so the derivation lives in one
 * place — buildSeasonHistory (career.ts) and computeSeasonFinances
 * (finances.ts) both call this rather than duplicating the ternary.
 */
export function userOutcomeFromPRResult(
  pr: PRResult,
): "promoted" | "relegated" | "stayed" {
  if (pr.userPromoted) return "promoted";
  if (pr.userRelegated) return "relegated";
  return "stayed";
}
