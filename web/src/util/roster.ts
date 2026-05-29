import { teamById } from "../teams";
import type { Career } from "../persistence";
import type { Player, Team } from "../types";

/**
 * Resolve the user's effective team. The JSON registry holds the
 * starter roster (formation, tactics, starting_xi, bench, roster); the
 * Career overlay (E.1.e+) lets transfer-market activity mutate roster
 * across seasons. This helper is the single source of truth — every
 * consumer (resimulate, PrepareView, TacticsView, career.advanceCareer)
 * goes through here rather than calling teamById(controlledTeamId)
 * directly, so an empty userRoster transparently falls back to the
 * registry default and a non-empty one wins.
 *
 * Throws when the controlled team id isn't in the registry: that's a
 * save invariant violation, not a runtime expected case.
 *
 * Formation / tactics stay on the registry Team (UserTactics in
 * `currentSeason.userTactics` is the per-season overlay for those;
 * resimulate's applyUserTactics handles the merge). The `bench` and
 * `starting_xi`, however, are reconciled to the custom roster here:
 *
 * - bench: selling a registry-default bench player removes them from
 *   `userRoster`, and a lingering phantom id would render as "Player <id>"
 *   in the bench editor and confuse the engine's sub logic.
 * - starting_xi: a registry starter can leave the roster two ways — canSell
 *   blocks selling an XI player, but E.2.c retirement removes 36+ starters
 *   outright. A retired starter's id would dangle in the XI and fail the
 *   engine's validation, so `reconcileXI` drops dangling ids and backfills to
 *   a fieldable 11. It's a no-op when every starter is still rostered (the
 *   common case — no behavior change for transfer-only careers).
 */
export function userTeam(career: Career): Team {
  const base = teamById(career.controlledTeamId);
  if (!base) {
    throw new Error(
      `userTeam: controlled team ${career.controlledTeamId} not in registry`,
    );
  }
  if (career.userRoster.length === 0) return base;
  const roster = career.userRoster;
  const startingXi = reconcileXI(base.starting_xi, roster);
  const xiSet = new Set(startingXi);
  const rosterIds = new Set(roster.map((p) => p.id));
  return {
    ...base,
    roster,
    starting_xi: startingXi,
    bench: (base.bench ?? []).filter((id) => rosterIds.has(id) && !xiSet.has(id)),
  };
}

/** Sum of a player's six attributes — an ordering key for XI backfill (no
 *  need to divide; the /6 mean preserves the same order). */
function attrSum(p: Player): number {
  const a = p.attributes;
  return a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina;
}

/**
 * The base starting XI, pruned to ids still on `roster`, then backfilled with
 * the best available roster players (by attribute sum, lower id breaking ties
 * for determinism) until it's a fieldable 11. Backfill only fires when a
 * starter has left the roster (E.2.c retirement); otherwise the filtered base
 * XI already has 11 and is returned as-is.
 */
function reconcileXI(baseXi: number[], roster: Player[]): number[] {
  const rosterIds = new Set(roster.map((p) => p.id));
  const xi = baseXi.filter((id) => rosterIds.has(id));
  if (xi.length >= 11) return xi;
  const used = new Set(xi);
  const candidates = roster
    .filter((p) => !used.has(p.id))
    .sort((a, b) => attrSum(b) - attrSum(a) || a.id - b.id);
  for (const p of candidates) {
    if (xi.length >= 11) break;
    xi.push(p.id);
  }
  return xi;
}
