import { teamById } from "../teams";
import { avgStrength } from "./divisions";
import { userTeam } from "./roster";
import { evolveTeam } from "./regen";
import {
  FIRST_YEAR,
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
  type Copa,
  type CupRoundName,
} from "../persistence";
import { userTieInRound } from "./copa";
import type { Player } from "../types";

/**
 * Strength of the opponent the user actually faced in `oppId`'s season —
 * the EVOLVED team, not the immutable registry. buildNextSeason composes
 * every opponent each season as `evolveTeam(registry, year − FIRST_YEAR,
 * career.seed)` (age + retire + youth + rebuild), so the side on the pitch
 * diverges from the registry from season 2 on. Bilheteria scales with that
 * on-pitch strength, so we replay the SAME deterministic evolution here:
 * identical inputs ⇒ the exact roster the engine simulated against.
 *
 * Season 0 (year === FIRST_YEAR) evolves by 0 — evolveTeam returns the
 * registry team unchanged — so the first season is unaffected, matching how
 * the initial season is built straight from the registry.
 */
function opponentStrength(career: Career, oppId: number): number {
  const base = teamById(oppId);
  if (!base) return 0;
  const elapsed = career.currentSeason.year - FIRST_YEAR;
  const onPitch = elapsed > 0 ? evolveTeam(base, elapsed, career.seed) : base;
  return avgStrength(onPitch);
}

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

/** Balance below which the board fires the manager (checked at season end,
 *  after the season's net is applied). Strict `< 0` — exactly zero survives.
 *  Raise to a negative number (e.g. -500_000) to allow a grace overdraft. */
export const MANAGER_FIRING_FLOOR = 0;

/** Whether a manager is fired given their balance. Single source of truth for
 *  the lose-condition (E.1.f) — checked per round and at season advance. */
export function isManagerFired(balance: number): boolean {
  return balance < MANAGER_FIRING_FLOOR;
}

// ─── E.4 — title flywheel + cup prize + TV-deal floor ────────────────────
//
// These add compounding revenue (finishing high → cash → stronger squad) and
// a structural floor that softens the 91%-fired economy gandula-rl measured.
// All numbers here are ILLUSTRATIVE and gandula-rl-tunable (E.6 re-measures and
// re-tunes this one block). Reference scale: a home gate is ~50–65k, a season
// has ~19 home games (~1.0–1.2M gate/season), the wage bill is ~400k baseline
// rising with squad strength, and STARTING_MONEY is 1M.

/** Season-total TV money by tier (sliced per round, like the wage bill). The
 *  structural floor: Série C (~600k) roughly covers a baseline C wage bill, so
 *  a careful C club is cash-positive before the gate (dents the 91% firing);
 *  Série A (4M) ≫ a strong-A bill, and that headroom funds compounding buys.
 *  The ~6.7 : 2.5 : 1 ratio makes climbing the pyramid the dominant lever. */
export const TV_DEAL_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 4_000_000,
  2: 1_500_000,
  3: 600_000,
};

/** Per-match performance bonus. ~one home gate per win; a ~27-win title run is
 *  ~1.08M ≈ one season wage bill, so winning literally pays for the squad. */
export const WIN_BONUS = 40_000;
export const DRAW_BONUS = 12_000;

/** End-of-season placement prize for the user's FINAL position in their tier.
 *  Closed-form decay over 1-based position: champion gets the full base, fading
 *  to 0 by `PLACEMENT_CUTOFF`. Survival alone (≥ cutoff) earns nothing — you
 *  must compete to capitalize. Tier-scaled below so each title up the pyramid
 *  is worth dramatically more (the climb incentive). */
export const PLACEMENT_PRIZE_BASE = 2_500_000;
export const PLACEMENT_CUTOFF = 12;
export const PLACEMENT_TIER_MULTIPLIER: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 0.4,
  3: 0.15,
};

/** Copa do Brasil prize for the round a club REACHED (regardless of that tie's
 *  result), plus a champion bonus on winning the final. A deep run (final +
 *  win ≈ 2.1M) rivals a league title — a second flywheel for a lower-tier
 *  user. Mirrors the E.3 round names. */
export const CUP_PRIZE_BY_ROUND: Record<CupRoundName, number> = {
  prelim: 0,
  r32: 60_000,
  r16: 120_000,
  qf: 250_000,
  sf: 500_000,
  final: 900_000,
};
export const CUP_CHAMPION_BONUS = 1_200_000;

/** TV-money slice for `roundIdx` — the season-total TV deal for the user's
 *  current tier, paid in equal per-round slices with the same fair-rounding as
 *  the wage bill (`round(S·(r+1)/T) − round(S·r/T)`), so slices sum to the exact
 *  season total with no drift. Accrues EVERY round (incl. away) — it's a
 *  structural floor, not gated by home/away. */
export function tvIncomeForRound(career: Career, roundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const total = totalRoundsOf(userDiv);
  if (total <= 0) return 0;
  const s = TV_DEAL_BY_TIER[userDiv.tier];
  return (
    Math.round((s * (roundIdx + 1)) / total) - Math.round((s * roundIdx) / total)
  );
}

/** Per-match win/draw bonus for the user's match in `roundIdx`: WIN_BONUS on a
 *  win, DRAW_BONUS on a draw, 0 on a loss/bye. */
export function matchBonusForRound(career: Career, roundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const { fixtures, matches } = season.divisions[userDivIdx].record;
  for (let i = 0; i < fixtures.length; i++) {
    if (fixtures[i].round !== roundIdx) continue;
    const m = matches[i];
    const isHome = m.home === career.controlledTeamId;
    const isAway = m.away === career.controlledTeamId;
    if (!isHome && !isAway) continue;
    const gf = isHome ? m.result.home_goals : m.result.away_goals;
    const ga = isHome ? m.result.away_goals : m.result.home_goals;
    if (gf > ga) return WIN_BONUS;
    if (gf === ga) return DRAW_BONUS;
    return 0;
  }
  return 0; // bye / no fixture this round
}

/** End-of-season placement prize for the user's final position in their tier.
 *  Pure; applied at the season boundary (NOT per round). */
export function placementPrizeFor(career: Career): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const pos =
    userDiv.record.standings.findIndex(
      (s) => s.team_id === career.controlledTeamId,
    ) + 1;
  if (pos <= 0) return 0;
  const base = Math.round(
    PLACEMENT_PRIZE_BASE *
      Math.max(0, (PLACEMENT_CUTOFF - pos + 1) / PLACEMENT_CUTOFF),
  );
  return Math.round(base * PLACEMENT_TIER_MULTIPLIER[userDiv.tier]);
}

/**
 * Cup prize the user EARNED by the transition from `prevCopa` to `nextCopa` —
 * called once per cup matchday inside SeasonView.playRound (the cursor advances
 * exactly once, so it can't double-pay). Pays the prize for the round just
 * played if the user had a tie in it, plus the champion bonus when the user
 * just won the final.
 */
export function cupPrizeForAdvance(
  prevCopa: Copa,
  nextCopa: Copa,
  controlledTeamId: number,
): number {
  const roundIdx = prevCopa.currentCupRoundIdx;
  const round = nextCopa.rounds[roundIdx];
  let prize = 0;
  if (round && userTieInRound(nextCopa, roundIdx, controlledTeamId)) {
    prize += CUP_PRIZE_BY_ROUND[round.name];
  }
  if (
    nextCopa.championId === controlledTeamId &&
    prevCopa.championId !== controlledTeamId
  ) {
    prize += CUP_CHAMPION_BONUS;
  }
  return prize;
}

/**
 * Total cup prize the user banked across the (finished) season — the
 * season-total reconciliation of the per-matchday `cupPrizeForAdvance`
 * payments. Sums the prize for every round the user reached (had a tie in)
 * plus the champion bonus if they won. Used by computeSeasonFinances so the
 * finale panel and `net` reflect cup money already banked in-season.
 */
export function cupPrizeTotal(copa: Copa, controlledTeamId: number): number {
  let prize = 0;
  for (let i = 0; i < copa.rounds.length; i++) {
    const round = copa.rounds[i];
    if (i >= copa.currentCupRoundIdx) break; // round not played yet
    if (userTieInRound(copa, i, controlledTeamId)) {
      prize += CUP_PRIZE_BY_ROUND[round.name];
    }
  }
  if (copa.championId === controlledTeamId) prize += CUP_CHAMPION_BONUS;
  return prize;
}

/**
 * Home-gate revenue for the user's match in `roundIdx` — same home-only basis
 * as computeSeasonFinances, just for one round. Away games and byes earn
 * nothing (the away club banks its own gate).
 */
export function homeTicketForRound(career: Career, roundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const { fixtures, matches } = userDiv.record;
  for (let i = 0; i < fixtures.length; i++) {
    if (fixtures[i].round !== roundIdx) continue;
    const m = matches[i];
    if (m.home === career.controlledTeamId) {
      return opponentStrength(career, m.away) * TICKET_REVENUE_PER_STRENGTH;
    }
    if (m.away === career.controlledTeamId) return 0; // away game
  }
  return 0; // bye round — user has no fixture this round
}

/**
 * The wage bill, paid in equal per-round slices across the season. Fair
 * rounding — `round(S·(r+1)/T) − round(S·r/T)` — so the slices sum to the
 * exact season salary S with no drift (money stays integer and the per-round
 * total matches computeSeasonFinances.salaries exactly).
 */
export function salarySliceForRound(career: Career, roundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const total = totalRoundsOf(season.divisions[userDivIdx]);
  if (total <= 0) return 0;
  if (!teamById(career.controlledTeamId)) return 0;
  const s = userTeam(career).roster.reduce(
    (sum, p) => sum + avgAttributes(p) * SALARY_PER_PLAYER_STRENGTH,
    0,
  );
  return (
    Math.round((s * (roundIdx + 1)) / total) - Math.round((s * roundIdx) / total)
  );
}

/** Net cash for playing `roundIdx`: home gate (if mandante) + TV slice + the
 *  win/draw bonus, minus the wage slice. Used to move `manager.money` each
 *  round. (Cup prize and the placement prize land elsewhere — on the cup
 *  matchday and at the season boundary respectively.) */
export function roundCashDelta(career: Career, roundIdx: number): number {
  return (
    homeTicketForRound(career, roundIdx) +
    tvIncomeForRound(career, roundIdx) +
    matchBonusForRound(career, roundIdx) -
    salarySliceForRound(career, roundIdx)
  );
}

/**
 * Breakdown of a season's net cash flow for the user. All values in
 * moedas; signs match the running-total convention (revenue/bonus
 * positive, salaries always positive — the subtraction lives in `net`).
 * `prBonus` is signed (+PROMOTION_BONUS / -RELEGATION_PENALTY / 0).
 */
export type SeasonFinances = {
  ticketRevenue: number;
  /** Season-total TV money (TV_DEAL_BY_TIER for the user's tier). Banked
   *  per-round during the season. */
  tvRevenue: number;
  /** Σ per-match win/draw bonus. Banked per-round during the season. */
  matchBonuses: number;
  salaries: number;
  /** Σ Copa prize banked in-season (rounds reached + champion bonus). */
  cupPrize: number;
  /** End-of-season placement prize. Applied at the season BOUNDARY. */
  placementPrize: number;
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
 * to home games), the user's effective roster (`userTeam(career)` — the
 * transfer/aging-aware squad, not the immutable registry), and the
 * pre-computed `userOutcome` (which is `userOutcomeFromPRResult(pr)` at
 * every call site today).
 *
 * Ticket revenue: home games only. The away-team revenue belongs to the
 * away team's manager (which the user doesn't manage in E.1.d). Sum is
 * `Σ opponentStrength × TICKET_REVENUE_PER_STRENGTH`, where opponentStrength
 * is the EVOLVED opponent that actually played (see `opponentStrength`), not
 * the static registry — so revenue tracks the side on the pitch from season 2.
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

  // userTeam(career) throws when the controlled team isn't in the registry —
  // the same save-invariant violation the old teamById guard caught — and
  // returns the effective (transfer/aging-aware) roster otherwise.
  const team = userTeam(career);

  let ticketRevenue = 0;
  let matchBonuses = 0;
  userDiv.record.matches.forEach((m) => {
    const isHome = m.home === career.controlledTeamId;
    const isAway = m.away === career.controlledTeamId;
    if (isHome) {
      ticketRevenue +=
        opponentStrength(career, m.away) * TICKET_REVENUE_PER_STRENGTH;
    }
    if (isHome || isAway) {
      const gf = isHome ? m.result.home_goals : m.result.away_goals;
      const ga = isHome ? m.result.away_goals : m.result.home_goals;
      matchBonuses += gf > ga ? WIN_BONUS : gf === ga ? DRAW_BONUS : 0;
    }
  });

  // TV money is a flat season total for the user's tier (per-round slices sum
  // to exactly this).
  const tvRevenue = TV_DEAL_BY_TIER[userDiv.tier];

  const salaries = team.roster.reduce(
    (sum, p) => sum + avgAttributes(p) * SALARY_PER_PLAYER_STRENGTH,
    0,
  );

  // Cup prize already banked in-season (reconciles with the per-matchday
  // cupPrizeForAdvance payments).
  const cupPrize = cupPrizeTotal(season.copa, career.controlledTeamId);

  // Placement prize is applied at the season boundary (see advanceToNextSeason)
  // — it is NOT in manager.money during the season, but it IS part of net.
  const placementPrize = placementPrizeFor(career);

  const prBonus =
    userOutcome === "promoted"
      ? PROMOTION_BONUS
      : userOutcome === "relegated"
        ? -RELEGATION_PENALTY
        : 0;

  const net =
    ticketRevenue +
    tvRevenue +
    matchBonuses -
    salaries +
    cupPrize +
    placementPrize +
    prBonus;

  return {
    ticketRevenue,
    tvRevenue,
    matchBonuses,
    salaries,
    cupPrize,
    placementPrize,
    prBonus,
    net,
  };
}
