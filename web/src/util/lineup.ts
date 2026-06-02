/**
 * Pure lineup domain logic, shared by the lineup editors (the text
 * `LineupEditor`, the visual `FormationPitch`, and its drag-and-drop).
 * Kept engine-free and component-free so it can be unit-tested directly and
 * so the editors can't drift in how a substitution rearranges the squad.
 */

/** Hard upper bound on bench size — mirrors `core/src/domain/team.rs:8`
 *  (`pub const MAX_BENCH: usize = 7`). Engine validation rejects any bench
 *  longer than this, so the UI caps to it too. */
export const MAX_BENCH = 7;

/** The 11 starting XI ids + the bench ids. Structurally compatible with the
 *  `LineupState` the editors pass around. */
export type Lineup = {
  starting_xi: number[];
  bench: number[];
};

/**
 * Swap-perfect substitution: replace `outgoingId` in the XI with `incomingId`,
 * returning a NEW lineup (inputs untouched). The single source of truth for
 * both the tap-to-swap menu and the drag-and-drop gesture.
 *
 * - `outgoingId` must be in the XI; otherwise the lineup is returned unchanged
 *   (defensive — a stale drag target after a re-render shouldn't corrupt state).
 * - Incoming came from the bench → outgoing takes its exact bench slot
 *   (bench size and order preserved).
 * - Incoming came from outside the bench → outgoing is appended to the bench if
 *   there's room (< maxBench), else it leaves the squad silently (the rare case
 *   of a deliberately-full bench whose only spare slot is the XI one).
 *
 * Callers are responsible for the same-position rule — this function moves ids,
 * it does not police positions. (Both editors only ever offer same-position
 * candidates / accept same-position drops.)
 */
export function applySwap(
  state: Lineup,
  outgoingId: number,
  incomingId: number,
  maxBench: number = MAX_BENCH,
): Lineup {
  if (outgoingId === incomingId) return state;
  const slotIdx = state.starting_xi.indexOf(outgoingId);
  if (slotIdx < 0) return state;

  const newXI = state.starting_xi.slice();
  newXI[slotIdx] = incomingId;

  const newBench = state.bench.slice();
  const benchIdx = newBench.indexOf(incomingId);
  if (benchIdx >= 0) {
    newBench[benchIdx] = outgoingId;
  } else if (newBench.length < maxBench) {
    newBench.push(outgoingId);
  }
  // else: bench full and incoming from outside → outgoing leaves silently.

  return { starting_xi: newXI, bench: newBench };
}

/**
 * Resolve a drag-and-drop gesture (source dot → target dot) into the resulting
 * lineup, or `null` if the drop isn't allowed. A drop is valid when both dots
 * share a position AND exactly one endpoint is in the XI — the XI endpoint is
 * the outgoing player, the other is the incoming one. Same-position-only keeps
 * the swap honest (the formation bands are by position; there's no free slot
 * mapping), and the "exactly one in XI" rule rejects meaningless XI↔XI or
 * bench↔bench drops that would otherwise duplicate or strand a player.
 *
 * Pure: takes a `positionOf` lookup so it stays free of any Player/Team type.
 */
export function swapFromDrop(
  state: Lineup,
  positionOf: (id: number) => string | undefined,
  sourceId: number,
  targetId: number,
  maxBench: number = MAX_BENCH,
): Lineup | null {
  if (sourceId === targetId) return null;
  const sp = positionOf(sourceId);
  const tp = positionOf(targetId);
  if (sp === undefined || tp === undefined || sp !== tp) return null;

  const sourceInXI = state.starting_xi.includes(sourceId);
  const targetInXI = state.starting_xi.includes(targetId);
  if (sourceInXI === targetInXI) return null; // need exactly one in the XI

  const outgoing = sourceInXI ? sourceId : targetId;
  const incoming = sourceInXI ? targetId : sourceId;
  return applySwap(state, outgoing, incoming, maxBench);
}
