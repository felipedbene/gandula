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

// ─── E.4.b.4 — stadium capacity, fanbase & the demand-driven gate ────────
//
// The home gate is now `min(demand, capacity) × TICKET_PRICE`, where demand
// rises with the club's fanbase, its division, and the (evolved) opponent's
// draw, and capacity caps a sellout. Expanding the stadium only helps once
// demand exceeds the current seats — the build-vs-buy tension. fanbase is real
// state that drifts toward a tier+placement target each season. All numbers
// here are ILLUSTRATIVE and gandula-rl-tunable (E.6); calibrated so a baseline
// Série A home game still yields ~65k (matching the old strength×1000 gate),
// while a maxed stadium + grown fanbase in A roughly doubles it.

/** Revenue per attendee. Low because attendance is now in the tens of
 *  thousands (a 44k baseline-A crowd × 1.5 ≈ 66k, the old gate). */
export const TICKET_PRICE = 1.5;

/** Starting seats by tier on a fresh career / migration. A bigger than C. */
export const STARTING_CAPACITY_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 45_000,
  2: 25_000,
  3: 12_000,
};
/** Starting fanbase (supporters) by tier. */
export const STARTING_FANBASE_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 40_000,
  2: 22_000,
  3: 10_000,
};

/** Demand model coefficients. demand = fanbase × COEF × tierMult × oppDraw. */
export const DEMAND_FANBASE_COEF = 1.0;
export const DEMAND_TIER_MULT: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 0.8,
  3: 0.65,
};

/** How a stronger (evolved) opponent draws a bigger crowd. ≈1.0 at a ~55-avg
 *  opponent, so the demand baseline matches the old gate scale. */
function opponentDraw(strength: number): number {
  return 0.45 + strength * 0.01;
}

/** Stadium expansion: fixed +5k seats per purchase, on a rising cost curve so
 *  you can't trivially max it, up to a hard cap. */
export const STADIUM_EXPANSION_STEP = 5_000;
export const STADIUM_MAX_CAPACITY = 80_000;
export function expansionCost(currentCapacity: number): number {
  return 1_500_000 + currentCapacity * 80;
}

/** Fanbase drift (per season, at the boundary). Each season fanbase moves a
 *  capped step toward a target set by the (next) tier plus a placement swing —
 *  finishing high grows it, finishing low (or relegating) shrinks it. */
export const FANBASE_TARGET_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 70_000,
  2: 30_000,
  3: 12_000,
};
export const FANBASE_PLACEMENT_SWING = 15_000;
export const FANBASE_PLACEMENT_PIVOT = 10; // finish above 10th → grow, below → shrink
export const FANBASE_MAX_STEP = 4_000; // ~4 seasons to fully grow the base

// ─── E.4.b.5 — marketing campaigns (paid fanbase growth) ─────────────────
//
// The demand-side lever: a campaign grows the fanbase NOW and raises a decaying
// `marketingMomentum` that the seasonal drift target is nudged by — so spend
// persists a few seasons rather than snapping back to the organic tier target.
// Pairs with the stadium (supply): capacity caps the gate, fanbase fills it.

/** Fanbase added immediately by one campaign (≈1.5× the organic season step,
 *  so paying clearly beats waiting). */
export const CAMPAIGN_FANBASE = 6_000;
/** Drift-target nudge a campaign adds to marketingMomentum. */
export const MARKETING_MOMENTUM_PER_CAMPAIGN = 6_000;
/** Momentum halves each season → a campaign's target-boost fades over ~3–4
 *  seasons (you must keep spending to sustain a big crowd). */
export const MARKETING_MOMENTUM_DECAY = 0.5;
/** Cap on accumulated momentum (and thus the campaign cost ceiling). */
export const MARKETING_MOMENTUM_MAX = 40_000;
/** Campaign cost, rising with accumulated momentum so it can't be spammed
 *  cheaply. Cheaper per use than a stadium expansion, but bounded by the
 *  momentum cap + decay. */
export function marketingCost(currentMomentum: number): number {
  return 800_000 + currentMomentum * 120;
}

/** Momentum for next season — decays toward 0. Pure. Snaps small residual
 *  values to 0 so it fully fades (round-half-up would otherwise stick at 1). */
export function nextMarketingMomentum(currentMomentum: number): number {
  const decayed = Math.round(currentMomentum * MARKETING_MOMENTUM_DECAY);
  return decayed <= 1 ? 0 : decayed;
}

// ─── E.4.b.7 — team momentum / form (bounded attendance multiplier) ──────
//
// Recent form nudges the home gate: a win streak fills a few more seats, a skid
// empties them. DELIBERATELY BOUNDED and applied to the GATE ONLY — never to
// the TV/sponsorship floors — so a slump can dent matchday income but the
// floors keep the club solvent (no death spiral, the roadmap's caution). The
// multiplier decays toward 1.0 from whatever the recent window implies. Numbers
// illustrative + gandula-rl-tunable (E.6).

/** How many recent matches feed the form window. */
export const FORM_WINDOW = 5;
/** Per-result step away from 1.0 (a win +, a loss −, a draw 0), before clamp. */
export const FORM_STEP = 0.05;
/** Hard clamp — a small drama bump, not a structural swing. */
export const FORM_MIN = 0.9;
export const FORM_MAX = 1.2;

/**
 * Attendance multiplier from the user's form in the `FORM_WINDOW` matches
 * strictly BEFORE `beforeRoundIdx` (so the gate for a round reflects the run
 * leading into it, not the result of the match being played). Each win is
 * +FORM_STEP, each loss −FORM_STEP, draws neutral; summed onto 1.0 and clamped
 * to [FORM_MIN, FORM_MAX]. Byes/no-match rounds are skipped. Pure.
 */
export function formMultiplier(career: Career, beforeRoundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const { fixtures, matches } = season.divisions[userDivIdx].record;
  // Collect the user's win/loss/draw deltas in rounds < beforeRoundIdx, in
  // fixture order (ascending round), then take the most recent FORM_WINDOW.
  const ordered = fixtures
    .map((f, i) => ({ round: f.round, m: matches[i] }))
    .filter((x) => x.round < beforeRoundIdx)
    .sort((a, b) => a.round - b.round);
  const results: number[] = [];
  for (const { m } of ordered) {
    const isHome = m.home === career.controlledTeamId;
    const isAway = m.away === career.controlledTeamId;
    if (!isHome && !isAway) continue;
    const gf = isHome ? m.result.home_goals : m.result.away_goals;
    const ga = isHome ? m.result.away_goals : m.result.home_goals;
    results.push(gf > ga ? 1 : gf < ga ? -1 : 0);
  }
  const window = results.slice(-FORM_WINDOW);
  const raw = 1 + window.reduce((s, d) => s + d * FORM_STEP, 0);
  return Math.max(FORM_MIN, Math.min(FORM_MAX, raw));
}

/** Home-gate revenue for one home match: min(demand, capacity) × price × form.
 *  Shared by the per-round and season-total paths so they stay identical (the
 *  per-round-sums-to-season invariant). `form` defaults to 1.0. */
function homeGateRevenue(
  fanbase: number,
  capacity: number,
  tier: 1 | 2 | 3,
  oppStrength: number,
  form = 1,
): number {
  const demand =
    fanbase * DEMAND_FANBASE_COEF * DEMAND_TIER_MULT[tier] * opponentDraw(oppStrength);
  const attendance = Math.min(demand, capacity);
  return Math.round(attendance * TICKET_PRICE * form);
}

/** Seed stadium + marketing state for a new career / migrated save from a
 *  division tier. Momentum starts at 0 (no campaigns run yet). */
export function seedStadiumForTier(tier: 1 | 2 | 3): {
  stadiumCapacity: number;
  fanbase: number;
  marketingMomentum: number;
} {
  return {
    stadiumCapacity: STARTING_CAPACITY_BY_TIER[tier],
    fanbase: STARTING_FANBASE_BY_TIER[tier],
    marketingMomentum: 0,
  };
}

/**
 * Fanbase for next season: drift the current value a capped step toward the
 * target for `tier` (the tier the club will play in next), adjusted by where it
 * finished (`position`, 1-based) and lifted by `marketingMomentum` (E.4.b.5) so
 * paid campaigns persist against the drift. Pure; floored at 0.
 */
export function nextFanbase(
  currentFanbase: number,
  tier: 1 | 2 | 3,
  position: number,
  marketingMomentum = 0,
): number {
  const placementAdj =
    FANBASE_PLACEMENT_SWING *
    ((FANBASE_PLACEMENT_PIVOT - position) / FANBASE_PLACEMENT_PIVOT);
  const target = FANBASE_TARGET_BY_TIER[tier] + placementAdj + marketingMomentum;
  const delta = Math.max(
    -FANBASE_MAX_STEP,
    Math.min(FANBASE_MAX_STEP, target - currentFanbase),
  );
  return Math.max(0, Math.round(currentFanbase + delta));
}

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
  // E.6 re-tune (down): the first pass made greedy unfireable (0% fired). These
  // floors no longer fully cover a wage bill on their own, so solvency is a
  // skill again — a careful manager survives, a careless one can still go broke.
  1: 3_000_000,
  2: 900_000,
  3: 300_000,
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
export const PLACEMENT_PRIZE_BASE = 1_500_000; // E.6 re-tune: 2.5M → 1.5M (less windfall)
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

// ─── E.4.b.6 — sponsorship (recurring revenue floor) ─────────────────────
//
// A passive, recurring income scaled by tier + fanbase + last-season placement.
// Unlike the gate it isn't gated by home/away or capacity, so it's a floor that
// directly eases the firing economy. It reads the fanbase substrate (so b.5
// marketing compounds into it) and rewards sustained success (another flywheel
// input). Sliced per round like TV. Numbers illustrative + gandula-rl-tunable.

/** Season-total sponsorship floor by tier. Série C (~200k) stacks with the
 *  600k TV floor to cover much of a baseline wage bill; Série A (1.2M) is a
 *  meaningful floor but below TV so the gate/prizes still dominate at the top. */
export const SPONSORSHIP_BASE_BY_TIER: Record<1 | 2 | 3, number> = {
  // E.6 re-tune (down): trimmed alongside the TV floor so the two floors
  // together don't make a careless manager unfireable.
  1: 800_000,
  2: 300_000,
  3: 100_000,
};
/** Sponsorship per supporter — growing the fanbase (b.5) compounds into the
 *  floor (a 10k-fanbase C club +25k, a 70k-fanbase A club +175k). E.6 coef
 *  lowered 4 → 2.5 so the fanbase flywheel is rewarding but not a windfall. */
export const SPONSORSHIP_FANBASE_COEF = 2.5;
/** Last-season placement bonus: BONUS × ((PIVOT − lastPos)/PIVOT) — champion ≫
 *  mid, ~0 by 10th, negative below (the total is floored at 0). New careers
 *  (no prior season) get 0. */
export const SPONSORSHIP_PLACEMENT_BONUS = 600_000;
export const SPONSORSHIP_PLACEMENT_PIVOT = 10;

/** Total sponsorship income for the current season. Pure — reads the user's
 *  tier, current fanbase, and last season's finishing position. */
export function sponsorshipSeasonTotal(career: Career): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const tier = season.divisions[userDivIdx].tier;
  const last = career.seasons.at(-1);
  const placementTerm =
    last === undefined
      ? 0
      : SPONSORSHIP_PLACEMENT_BONUS *
        ((SPONSORSHIP_PLACEMENT_PIVOT - last.userPosition) /
          SPONSORSHIP_PLACEMENT_PIVOT);
  return Math.max(
    0,
    Math.round(
      SPONSORSHIP_BASE_BY_TIER[tier] +
        career.manager.fanbase * SPONSORSHIP_FANBASE_COEF +
        placementTerm,
    ),
  );
}

/** Sponsorship slice for `roundIdx` — the season total sliced with the same
 *  fair-rounding as TV/wages, so slices sum to the exact total. Accrues every
 *  round (a floor, not home/away-gated). */
export function sponsorshipForRound(career: Career, roundIdx: number): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const total = totalRoundsOf(season.divisions[userDivIdx]);
  if (total <= 0) return 0;
  const s = sponsorshipSeasonTotal(career);
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
      return homeGateRevenue(
        career.manager.fanbase,
        career.manager.stadiumCapacity,
        userDiv.tier,
        opponentStrength(career, m.away),
        formMultiplier(career, roundIdx),
      );
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

/** Net cash for playing `roundIdx`: home gate (if mandante) + TV slice +
 *  sponsorship slice + the win/draw bonus, minus the wage slice. Used to move
 *  `manager.money` each round. (Cup prize and the placement prize land
 *  elsewhere — on the cup matchday and at the season boundary respectively.) */
export function roundCashDelta(career: Career, roundIdx: number): number {
  return (
    homeTicketForRound(career, roundIdx) +
    tvIncomeForRound(career, roundIdx) +
    sponsorshipForRound(career, roundIdx) +
    matchBonusForRound(career, roundIdx) -
    salarySliceForRound(career, roundIdx)
  );
}

/**
 * Cash-runway projection (E.5.a) — answers "can I afford this squad across the
 * REST of the season?" from where the season currently sits. Sums the per-round
 * net (`roundCashDelta`: gate + TV + sponsorship + bonus − wages) over every
 * round not yet played in the user's division, and adds it to the current
 * balance. Excludes the end-of-season placement/PR prize (outcome unknown) and
 * cup prizes (land on their own matchdays) — so it's a deliberately
 * CONSERVATIVE floor: the real end balance is usually a bit higher.
 *
 * Pure. Reads the live roster via the same helpers the per-round accrual uses,
 * so a buy/sell in the market (which mutates the working Career) immediately
 * moves the projection — that's the point: see the wage-bill impact before
 * committing.
 */
export type RunwayProjection = {
  /** Rounds in the user's division still unplayed (currentRoundIdx … end). */
  remainingRounds: number;
  /** Net cash expected across those rounds (signed). */
  projectedNet: number;
  /** Projected balance at season end: current money + projectedNet. */
  projectedEndBalance: number;
  /** Wage bill across the remaining rounds (always ≥ 0). */
  remainingWages: number;
  /** True if the projection dips below zero at season end — overspend risk. */
  atRisk: boolean;
};

export function projectSeasonRunway(career: Career): RunwayProjection {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const total = totalRoundsOf(userDiv);
  const from = Math.min(userDiv.currentRoundIdx, total);

  let projectedNet = 0;
  let remainingWages = 0;
  for (let r = from; r < total; r++) {
    projectedNet += roundCashDelta(career, r);
    remainingWages += salarySliceForRound(career, r);
  }
  const projectedEndBalance = career.manager.money + projectedNet;
  return {
    remainingRounds: Math.max(0, total - from),
    projectedNet,
    projectedEndBalance,
    remainingWages,
    atRisk: projectedEndBalance < 0,
  };
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
  /** Season-total sponsorship (tier + fanbase + last-season placement). Banked
   *  per-round during the season — a floor, not home/away-gated. */
  sponsorship: number;
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
  userDiv.record.matches.forEach((m, i) => {
    const isHome = m.home === career.controlledTeamId;
    const isAway = m.away === career.controlledTeamId;
    if (isHome) {
      // Form is read per-match (the run leading into this round), so the
      // season total equals the sum of per-round gates — the invariant holds.
      ticketRevenue += homeGateRevenue(
        career.manager.fanbase,
        career.manager.stadiumCapacity,
        userDiv.tier,
        opponentStrength(career, m.away),
        formMultiplier(career, userDiv.record.fixtures[i].round),
      );
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

  // Sponsorship floor (tier + fanbase + last-season placement), banked per
  // round like TV.
  const sponsorship = sponsorshipSeasonTotal(career);

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
    sponsorship +
    matchBonuses -
    salaries +
    cupPrize +
    placementPrize +
    prBonus;

  return {
    ticketRevenue,
    tvRevenue,
    sponsorship,
    matchBonuses,
    salaries,
    cupPrize,
    placementPrize,
    prBonus,
    net,
  };
}
