import { teamById } from "../teams";
import type { Career } from "../persistence";
import type { Team } from "../types";

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
 * Formation / tactics / starting_xi stay on the registry Team (UserTactics
 * in `currentSeason.userTactics` is the per-season overlay for those;
 * resimulate's applyUserTactics handles the merge). The `bench`, however, is
 * reconciled to the custom roster here: selling a registry-default bench
 * player removes them from `userRoster`, and a lingering phantom id would
 * render as "Player <id>" in the bench editor and confuse the engine's sub
 * logic. XI is deliberately NOT filtered — canSell hard-blocks selling an XI
 * player, so it never needs pruning, and dropping below 11 would break re-sim.
 */
export function userTeam(career: Career): Team {
  const base = teamById(career.controlledTeamId);
  if (!base) {
    throw new Error(
      `userTeam: controlled team ${career.controlledTeamId} not in registry`,
    );
  }
  if (career.userRoster.length === 0) return base;
  const rosterIds = new Set(career.userRoster.map((p) => p.id));
  return {
    ...base,
    roster: career.userRoster,
    bench: (base.bench ?? []).filter((id) => rosterIds.has(id)),
  };
}
