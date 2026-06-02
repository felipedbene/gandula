import { mulberry32 } from "./prng";
import {
  generateFreeAgents,
  playerOverall,
  playerPrice,
  MAX_ROSTER,
} from "./transfer-market";
import type { Player, Tactics, Formation, Team } from "../types";

// ─── E.3.c.2 — distilled rival coach ────────────────────────────────────────
//
// AI clubs "coach" like the trained RL policy of record
// (gandula-rl/models/maskppo_reshaped_probe: 98% reach Série A, 11% titles).
// We can't ship a neural net to the browser, so the policy was DISTILLED: a
// probe (gandula-rl/distill_probe.py) ran it over 500 careers and logged what
// it does per tier → gandula-rl/distill/rival_policy.json. The constants below
// are transcribed from that artifact. Behaviour, not a network.
//
// The distilled fingerprint is "climb then consolidate":
//   Série C (3): F352/Defensive/Fast/High/Narrow (89% of picks) — buys hard,
//                down to a small cash floor (the policy spends its start money).
//   Série B (2): F4231/VeryAttacking/Fast/High/Wide — buys when flush.
//   Série A (1): F442/Defensive/Low — consolidates, rarely buys.
// Sells were only roster-cap trims (no strategic selling), so rivals don't sell.
//
// All functions here are PURE + deterministic in their inputs (the same
// careerSeed/teamId/yearOffset namespacing the rest of the evolve path uses),
// so the "recompute opponents from the registry by elapsed years" replay
// invariant — and re-simulation — stay reproducible.

type RivalTier = {
  formation: Formation;
  tactics: Tactics;
  /** Base transfer budget for a mid-table finish, in moedas. Scaled by finish
   *  (see rivalBudget). Roughly mirrors the cash the policy had to spend at
   *  this tier in the probe. */
  budgetBase: number;
};

/** Per-tier distilled config. Keyed by tier (1 = Série A, 2 = B, 3 = C). */
export const RIVAL_POLICY: Record<1 | 2 | 3, RivalTier> = {
  1: {
    formation: "F442",
    tactics: { mentality: "Defensive", tempo: "Normal", pressing: "Low", width: "Normal" },
    budgetBase: 4_000_000,
  },
  2: {
    formation: "F4231",
    tactics: { mentality: "VeryAttacking", tempo: "Fast", pressing: "High", width: "Wide" },
    budgetBase: 6_000_000,
  },
  3: {
    formation: "F352",
    tactics: { mentality: "Defensive", tempo: "Fast", pressing: "High", width: "Narrow" },
    budgetBase: 3_000_000,
  },
};

/** Cash floor a rival keeps unspent — the policy bought down to ~2M of start
 *  money but never to zero; mirrors a club not betting the whole budget. */
const RIVAL_CASH_FLOOR = 500_000;

/** Per-position minimum useful overall delta to bother buying — a new agent
 *  must beat the weakest same-position player by at least this to count as an
 *  upgrade (avoids churning sideways moves). */
const MIN_UPGRADE_DELTA = 2;

function rngFor(careerSeed: bigint, teamId: number, yearOffset: number): () => number {
  // Distinct namespace from regen.rngFor (different XOR constant) so the buy
  // RNG can't accidentally correlate with the aging/regen RNG for a team.
  const s =
    (careerSeed ^ BigInt(teamId) ^ (BigInt(yearOffset) * 0x7f4an) ^ 0xc0a7n) &
    0xffffffffn;
  return mulberry32(Number(s));
}

/**
 * Stateless per-season transfer budget for a rival. Derived from the tier base
 * × a per-club deterministic jitter so clubs in the same tier don't move in
 * lockstep. **Deliberately depends only on (tier, careerSeed, teamId,
 * yearOffset)** — data the re-simulation path can reconstruct without the prior
 * season's standings. Tying the budget to last season's finish would make
 * coached opponents un-reproducible on re-sim (which rebuilds opponents from
 * the registry), breaking determinism; tier already captures most of the
 * "stronger clubs spend more" effect (Série A clubs have richer floors).
 *
 * No persistence — recomputed each season from those inputs, keeping the
 * registry-replay determinism intact.
 */
export function rivalBudget(
  tier: 1 | 2 | 3,
  careerSeed: bigint,
  teamId: number,
  yearOffset: number,
): number {
  const base = RIVAL_POLICY[tier].budgetBase;
  const rng = rngFor(careerSeed, teamId, yearOffset);
  // Per-club jitter in [0.7, 1.3] so same-tier clubs differ but stay in band.
  const jitter = 0.7 + rng() * 0.6;
  return Math.round(base * jitter);
}

/** The distilled tactic + formation for a tier. */
export function rivalTactics(tier: 1 | 2 | 3): { formation: Formation; tactics: Tactics } {
  const p = RIVAL_POLICY[tier];
  return { formation: p.formation, tactics: p.tactics };
}

/** The weakest position on a roster and its weakest player's overall, for
 *  deciding where a buy helps most. Positions with NO players are weakest of
 *  all (return overall 0). */
function weakestPosition(roster: Player[]): { position: Player["position"]; worst: number } {
  const positions: Player["position"][] = ["GK", "DEF", "MID", "FWD"];
  let chosen: Player["position"] = "GK";
  let chosenWorst = Infinity;
  for (const pos of positions) {
    const same = roster.filter((p) => p.position === pos);
    const worst = same.length === 0 ? 0 : Math.min(...same.map(playerOverall));
    if (worst < chosenWorst) {
      chosenWorst = worst;
      chosen = pos;
    }
  }
  return { position: chosen, worst: chosenWorst === Infinity ? 0 : chosenWorst };
}

/**
 * Apply the distilled buy behaviour to a rival roster for one season. The
 * policy buys greedily — best affordable free agent that upgrades the weakest
 * position — until the budget (down to a cash floor) or the roster cap is hit.
 *
 * Returns the (possibly grown) roster. XI/bench reconciliation is the caller's
 * job (regen's backfill already does it), so this only touches `roster`.
 *
 * Pure + deterministic: the free-agent pool is `generateFreeAgents(seed, year)`
 * (the same pool the user shops from) and purchase order is greedy-by-upgrade,
 * with the rng only breaking exact ties — so a (team, year, seed) always buys
 * the same players.
 */
export function rivalTransfers(
  roster: Player[],
  budget: number,
  year: number,
  careerSeed: bigint,
): Player[] {
  // The market pool for this season (shared shape with the user's market).
  const pool = generateFreeAgents(careerSeed, year);
  const taken = new Set<number>(roster.map((p) => p.id));
  const result = [...roster];
  let cash = budget;

  // Greedy: each round, find the weakest position, then the best affordable
  // agent in that position that's a real upgrade. Stop when nothing qualifies
  // or limits are hit.
  while (result.length < MAX_ROSTER && cash > RIVAL_CASH_FLOOR) {
    const { position, worst } = weakestPosition(result);
    const candidates = pool
      .filter((p) => !taken.has(p.id) && p.position === position)
      .filter((p) => playerOverall(p) >= worst + MIN_UPGRADE_DELTA)
      .filter((p) => playerPrice(p, "buy") <= cash - RIVAL_CASH_FLOOR)
      // Best upgrade first; tie-break by cheaper, then id for determinism.
      .sort(
        (a, b) =>
          playerOverall(b) - playerOverall(a) ||
          playerPrice(a, "buy") - playerPrice(b, "buy") ||
          a.id - b.id,
      );
    const pick = candidates[0];
    if (!pick) break;
    cash -= playerPrice(pick, "buy");
    taken.add(pick.id);
    result.push(pick);
  }
  return result;
}

/** After buys, promote a bought player into the XI if it's a strict upgrade on
 *  the weakest same-position starter, and top up the bench with the best
 *  remaining non-XI players. Keeps XI = 11 distinct ids that exist in roster,
 *  bench ≤ MAX_BENCH, no overlap — the invariants re-sim depends on. */
function reconcileLineup(team: Team, newRoster: Player[]): Team {
  const byId = new Map(newRoster.map((p) => [p.id, p]));
  const rosterIds = new Set(byId.keys());
  // Keep only XI ids that still exist; we never had retirees here (post-evolve),
  // but a defensive filter keeps the invariant if inputs drift.
  let xi = team.starting_xi.filter((id) => rosterIds.has(id));

  // Upgrade XI: for each starter, if a non-XI roster player at the same
  // position is strictly better, swap them in (best-first, deterministic).
  const inXi = new Set(xi);
  const benchPool = newRoster
    .filter((p) => !inXi.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a) || a.id - b.id);
  for (const cand of benchPool) {
    // Find the weakest XI starter at the candidate's position worse than it.
    let weakestSlot = -1;
    let weakestOverall = Infinity;
    xi.forEach((id, slot) => {
      const p = byId.get(id);
      if (!p || p.position !== cand.position) return;
      const ov = playerOverall(p);
      if (ov < weakestOverall) {
        weakestOverall = ov;
        weakestSlot = slot;
      }
    });
    if (weakestSlot >= 0 && playerOverall(cand) > weakestOverall) {
      inXi.delete(xi[weakestSlot]);
      xi[weakestSlot] = cand.id;
      inXi.add(cand.id);
    }
  }

  // Rebuild bench: best remaining non-XI players, capped at the prior depth.
  const priorDepth = (team.bench ?? []).length || 7;
  const bench = newRoster
    .filter((p) => !inXi.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a) || a.id - b.id)
    .slice(0, Math.min(7, priorDepth || 7))
    .map((p) => p.id);

  return { ...team, roster: newRoster, starting_xi: xi, bench };
}

/**
 * Apply the distilled rival coach to one (already aged/regen'd) opponent team
 * for the upcoming season: set the per-tier tactic + formation, compute a
 * stateless budget, buy squad-strengthening free agents, and reconcile XI/bench
 * so the team stays engine-valid. Pure + deterministic in all inputs.
 *
 * Called from career.ts `composeTeam` AFTER `evolveTeam` (aging) and only for
 * opponents — the user's club is untouched (the user shops the market themself).
 */
export function applyRivalCoach(
  team: Team,
  tier: 1 | 2 | 3,
  year: number,
  careerSeed: bigint,
  yearOffset: number,
): Team {
  // Season 0 (yearOffset 0) is the authored registry baseline — uncoached,
  // matching how SeasonView builds the first season straight from the registry.
  // Coaching begins as the world advances (yearOffset ≥ 1). This also keeps the
  // re-sim path (resimulate.ts) consistent for a season-0 re-sim.
  if (yearOffset === 0) return team;
  const budget = rivalBudget(tier, careerSeed, team.id, yearOffset);
  const boughtRoster = rivalTransfers(team.roster, budget, year, careerSeed);
  const { formation, tactics } = rivalTactics(tier);
  const coached = reconcileLineup(team, boughtRoster);
  return { ...coached, formation, tactics };
}
