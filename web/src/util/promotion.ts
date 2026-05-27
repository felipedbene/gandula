import type { SavedSeason } from "../persistence";
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
 * mutate the save, does not generate the next season's divisions
 * (that's E.1.c).
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
 * are provisional and a P/R verdict would be incoherent. In E.1.a's
 * careers (user always in Série B), Série A finishes at round 14 while
 * the user's Série B is still climbing 15-18, so by the time the user
 * sees SeasonFinale both are guaranteed done. But we check explicitly:
 * defensive invariant ahead of E.1.c, when the user could end up in
 * either tier.
 *
 * Tiebreakers come for free from the engine's `compute_standings` sort
 * (Pts desc, GD desc, GF desc, team_id asc) — `record.standings` is
 * already in that order, so slicing is the entire algorithm.
 */
export function computePromotionRelegation(saved: SavedSeason): PRResult {
  const tierA = saved.divisions.find((d) => d.tier === 1);
  const tierB = saved.divisions.find((d) => d.tier === 2);
  if (!tierA || !tierB) {
    throw new Error(
      "computePromotionRelegation: SavedSeason must have both Série A (tier 1) and Série B (tier 2)",
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
    userPromoted: promoted.some((s) => s.team_id === saved.controlledTeamId),
    userRelegated: relegated.some((s) => s.team_id === saved.controlledTeamId),
  };
}
