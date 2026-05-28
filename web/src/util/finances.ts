import { teamById } from "../teams";
import { avgStrength } from "./divisions";
import {
  findUserDivisionIdxInSeason,
  type Career,
} from "../persistence";
import type { Player } from "../types";

/** Home ticket revenue per opponent-strength point. Tuned so a Série A
 *  home game vs a strong opponent (~65 avg) yields ~65k and a Série B
 *  match vs a typical opponent (~55 avg) yields ~55k. */
export const TICKET_REVENUE_PER_STRENGTH = 1000;

/** Per-player season salary per strength point of that player. With 16
 *  rostered players × ~50 avg = ~400k baseline season salary. Stronger
 *  rosters cost proportionally more, which is the intended pressure. */
export const SALARY_PER_PLAYER_STRENGTH = 500;

/** Bonus on promotion to Série A. Carrot for performance — large enough
 *  to bankroll the salary jump that comes with surviving in A. */
export const PROMOTION_BONUS = 500_000;

/** Penalty on relegation to Série B. Stick for failure — smaller than
 *  the promotion bonus because relegation is already punishing through
 *  the salary contraction the user opts into. */
export const RELEGATION_PENALTY = 200_000;

/**
 * Breakdown of a season's net cash flow for the user. All values in
 * moedas; signs match the running-total convention (revenue/bonus
 * positive, salaries always positive — the subtraction lives in `net`).
 * `prBonus` is signed (+PROMOTION_BONUS / -RELEGATION_PENALTY / 0).
 */
export type SeasonFinances = {
  ticketRevenue: number;
  salaries: number;
  prBonus: number;
  net: number;
};

/**
 * Per-player overall: mean of the six attributes, rounded. Private to
 * finances.ts because salaries are the only consumer today; if a second
 * caller appears, promote to util/divisions.ts (alongside avgStrength,
 * which is the team-level XI version).
 */
function avgAttributes(player: Player): number {
  const a = player.attributes;
  return Math.round(
    (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
      6,
  );
}

/**
 * Compute finances for the just-finished season. Pure — derived from the
 * career's `currentSeason.divisions[userDivIdx].record.matches` (filtered
 * to home games), the user's roster from the registry, and the
 * pre-computed `userOutcome` (which is `userOutcomeFromPRResult(pr)` at
 * every call site today).
 *
 * Ticket revenue: home games only. The away-team revenue belongs to the
 * away team's manager (which the user doesn't manage in E.1.d). Sum is
 * `Σ opponent.avgStrength × TICKET_REVENUE_PER_STRENGTH`.
 *
 * Salaries: paid across the FULL roster (XI + bench + reserves), not
 * just the starting eleven — bench players cost money in real sports
 * too. Sum is `Σ player.avgAttributes × SALARY_PER_PLAYER_STRENGTH`.
 *
 * P/R bonus: +PROMOTION_BONUS on promotion, -RELEGATION_PENALTY on
 * relegation, 0 on stayed. Signed so `net` is a clean sum.
 */
export function computeSeasonFinances(
  career: Career,
  userOutcome: "promoted" | "relegated" | "stayed",
): SeasonFinances {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];

  const userTeam = teamById(career.controlledTeamId);
  if (!userTeam) {
    throw new Error(
      `computeSeasonFinances: controlled team ${career.controlledTeamId} not in registry`,
    );
  }

  let ticketRevenue = 0;
  userDiv.record.matches.forEach((m) => {
    if (m.home !== career.controlledTeamId) return;
    const opponent = teamById(m.away);
    if (!opponent) return;
    ticketRevenue += avgStrength(opponent) * TICKET_REVENUE_PER_STRENGTH;
  });

  const salaries = userTeam.roster.reduce(
    (sum, p) => sum + avgAttributes(p) * SALARY_PER_PLAYER_STRENGTH,
    0,
  );

  const prBonus =
    userOutcome === "promoted"
      ? PROMOTION_BONUS
      : userOutcome === "relegated"
        ? -RELEGATION_PENALTY
        : 0;

  const net = ticketRevenue - salaries + prBonus;

  return { ticketRevenue, salaries, prBonus, net };
}
