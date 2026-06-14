import type { Career } from "../persistence";

/**
 * Career-long honours, aggregated from the archived `SeasonHistory` entries.
 * Pure derivation — the per-season records already hold everything needed
 * (champion, Copa result, P/R outcome, end-of-season balance), so the
 * "galeria de troféus" never needs the discarded match logs.
 */
export interface Honours {
  /** Completed seasons on record (excludes the one currently in progress). */
  seasonsManaged: number;
  /** Seasons where the user's club won its division. */
  leagueTitles: Array<{ year: number; division: string }>;
  /** Years in which the user lifted the Copa do Brasil. */
  copaTitles: number[];
  promotions: number;
  relegations: number;
  /** Best campaign by altitude: highest tier reached, then best finishing
   *  position within it (finishing 3rd in Série A beats winning Série C). */
  bestFinish: { position: number; division: string; year: number } | null;
  /** Highest end-of-season balance ever recorded. */
  richestBalance: number | null;
}

export function computeHonours(career: Career): Honours {
  const seasons = career.seasons;
  const userId = career.controlledTeamId;

  const leagueTitles = seasons
    .filter((s) => s.champion.teamId === userId)
    .map((s) => ({ year: s.year, division: s.userDivision.name }));

  const copaTitles = seasons
    .filter((s) => s.copaUserResult === "champion")
    .map((s) => s.year);

  const promotions = seasons.filter((s) => s.userOutcome === "promoted").length;
  const relegations = seasons.filter(
    (s) => s.userOutcome === "relegated",
  ).length;

  // Best campaign: minimise (tier, position) lexicographically — tier 1
  // (Série A) outranks tier 3, and within a tier a lower position is better.
  let best: (typeof seasons)[number] | null = null;
  for (const s of seasons) {
    if (
      best === null ||
      s.userDivision.tier < best.userDivision.tier ||
      (s.userDivision.tier === best.userDivision.tier &&
        s.userPosition < best.userPosition)
    ) {
      best = s;
    }
  }
  const bestFinish = best
    ? {
        position: best.userPosition,
        division: best.userDivision.name,
        year: best.year,
      }
    : null;

  const richestBalance =
    seasons.length > 0
      ? Math.max(...seasons.map((s) => s.moneyAfter))
      : null;

  return {
    seasonsManaged: seasons.length,
    leagueTitles,
    copaTitles,
    promotions,
    relegations,
    bestFinish,
    richestBalance,
  };
}
