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
 * Outfield line counts per formation, ordered FRONT→BACK (forwards first,
 * defenders last). Keyed by the engine's `Formation` tag (string-keyed to keep
 * this util free of the domain enum import). Each sums to 10 (the GK is the
 * implicit 11th, rendered on its own line). Mirrors the four formations the
 * tactics form offers.
 */
export const FORMATION_LINES: Record<string, number[]> = {
  F442: [2, 4, 4],
  F433: [3, 3, 4],
  F352: [2, 5, 3],
  F4231: [1, 3, 2, 4],
};

// Front→back ordering of the coarse positions, so a position-sorted outfield
// pool fills the formation's lines forwards-first.
const POS_RANK: Record<string, number> = { FWD: 0, MID: 1, DEF: 2, GK: 3 };

/**
 * Arrange a starting XI into the chosen formation's lines for the pitch board.
 * Returns rows TOP→BOTTOM (forwards first … defenders … then the GK row last),
 * each row a list of player ids.
 *
 * The XI carries only coarse positions (GK/DEF/MID/FWD) with no stored slot, so
 * outfielders are sorted forwards→defenders and filled greedily into the
 * formation's line template: when the XI composition matches the formation it
 * lands perfectly; when it doesn't, a spare player sits one line further
 * forward and stays its true position colour — honest, not hidden. Any leftover
 * (e.g. an XI with no template / odd composition) spills into the last outfield
 * line so all 11 always render. Unknown formation → fall back to one line per
 * position band (the old layout).
 */
export function formationRows(
  formation: string,
  startingXi: number[],
  positionOf: (id: number) => string | undefined,
): number[][] {
  const gk = startingXi.filter((id) => positionOf(id) === "GK");
  const outfield = startingXi.filter((id) => positionOf(id) !== "GK");
  const template = FORMATION_LINES[formation];
  const rows: number[][] = [];

  if (template) {
    const sorted = [...outfield].sort(
      (a, b) => (POS_RANK[positionOf(a) ?? "GK"] ?? 9) - (POS_RANK[positionOf(b) ?? "GK"] ?? 9),
    );
    let i = 0;
    for (const size of template) {
      rows.push(sorted.slice(i, i + size));
      i += size;
    }
    if (i < sorted.length && rows.length > 0) {
      rows[rows.length - 1] = rows[rows.length - 1].concat(sorted.slice(i));
    }
  } else {
    for (const pos of ["FWD", "MID", "DEF"]) {
      rows.push(outfield.filter((id) => positionOf(id) === pos));
    }
  }

  rows.push(gk); // GK on its own line at the back
  return rows;
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
