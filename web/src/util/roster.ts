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
 * Note on formation / tactics / starting_xi / bench: these stay on the
 * registry Team. UserTactics (in `currentSeason.userTactics`) is the
 * per-season overlay for those four fields; resimulate's
 * applyUserTactics handles the merge there. This helper only swaps the
 * `roster` array — the player POOL the team draws from. XI and bench
 * arrays might reference player ids that aren't in `userRoster` (e.g.,
 * after a sell of a registry-default bench player) — that's E.1.e.2's
 * problem to handle via lazy-prune in the sell flow.
 */
export function userTeam(career: Career): Team {
  const base = teamById(career.controlledTeamId);
  if (!base) {
    throw new Error(
      `userTeam: controlled team ${career.controlledTeamId} not in registry`,
    );
  }
  if (career.userRoster.length === 0) return base;
  return { ...base, roster: career.userRoster };
}
