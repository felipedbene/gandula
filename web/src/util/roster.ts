import { teamById } from "../teams";
import type { Career } from "../persistence";
import type { Player, Position, Team } from "../types";
import { FORMATION_COMPOSITION } from "./lineup";

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
  const startingXi = reconcileXI(base.starting_xi, roster, base.formation);
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
 * The base starting XI, pruned to ids still on `roster`, then backfilled to a
 * fieldable, POSITION-VALID 11. Backfill only fires when a starter has left the
 * roster (E.2.c retirement); when every starter is still rostered the filtered
 * base XI already has 11 and is returned unchanged (byte-identical — the common
 * transfer-only case is untouched).
 *
 * The repair is position-aware (#63): it fills each open slot with a player of
 * the position the formation is SHORT on (GK first, then DEF/MID/FWD), so a
 * retired goalkeeper is replaced by the reserve keeper — not by the highest-
 * rated outfielder — and a non-GK retirement never pulls in a second keeper.
 * Within a position, the best available (by attribute sum, lower id breaking
 * ties) wins, keeping it deterministic. Slots with no same-position player left
 * fall back to the best available of any position so the side always reaches 11.
 */
function reconcileXI(
  baseXi: number[],
  roster: Player[],
  formation: string,
): number[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const xi = baseXi.filter((id) => byId.has(id));
  if (xi.length >= 11) return xi;

  const used = new Set(xi);
  const pickBest = (pos?: Position): Player | undefined =>
    roster
      .filter((p) => !used.has(p.id) && (pos === undefined || p.position === pos))
      .sort((a, b) => attrSum(b) - attrSum(a) || a.id - b.id)[0];

  const comp = FORMATION_COMPOSITION[formation];
  if (comp) {
    // How many of each position the kept starters already supply.
    const present: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const id of xi) present[byId.get(id)!.position] += 1;
    // Fix structural holes first (a missing keeper is the worst), filling the
    // deficit for each position from that position's best available reserve.
    const order: Position[] = ["GK", "DEF", "MID", "FWD"];
    for (const pos of order) {
      let deficit = comp[pos] - present[pos];
      while (deficit > 0 && xi.length < 11) {
        const pick = pickBest(pos);
        if (!pick) break; // no reserve of this position — handled by fallback
        used.add(pick.id);
        xi.push(pick.id);
        deficit -= 1;
      }
    }
  }
  // Fallback: any slots still open (unknown formation, or a position with no
  // reserve left) get the best available regardless of position, so the XI
  // always reaches 11. No-op once the position pass filled every slot; the
  // `pickBest()` undefined-guard stops it when the roster is exhausted.
  while (xi.length < 11) {
    const pick = pickBest();
    if (!pick) break;
    used.add(pick.id);
    xi.push(pick.id);
  }
  return xi;
}
