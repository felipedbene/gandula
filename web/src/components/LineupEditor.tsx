import { useState } from "react";
import type { Player, Team } from "../types";

/**
 * Lineup state: the 11 starting XI player IDs + the bench player IDs.
 * Bench is part of the state even though D.1.e doesn't expose explicit
 * bench-editing UI — swap-perfect logic mutates bench when a user pulls
 * a bench player into the XI (the outgoing player takes the vacated bench
 * slot). D.1.f will add the explicit bench editor on top of this same
 * state shape.
 */
export type LineupState = {
  starting_xi: number[]; // exactly 11 player IDs
  bench: number[]; // up to 7, disjoint from starting_xi
};

export function lineupStateEquals(a: LineupState, b: LineupState): boolean {
  if (a.starting_xi.length !== b.starting_xi.length) return false;
  if (a.bench.length !== b.bench.length) return false;
  for (let i = 0; i < a.starting_xi.length; i++) {
    if (a.starting_xi[i] !== b.starting_xi[i]) return false;
  }
  for (let i = 0; i < a.bench.length; i++) {
    if (a.bench[i] !== b.bench[i]) return false;
  }
  return true;
}

type LineupEditorProps = {
  team: Team;
  state: LineupState;
  onChange: (next: LineupState) => void;
};

/**
 * Controlled-component editor for the starting XI. Click [ TROCAR ] on a
 * slot to expand the same-position candidates inline; pick one to perform
 * a swap-perfect substitution. Bench mutates implicitly via the swap —
 * explicit bench editing comes in D.1.f.
 *
 * State ownership: parent owns LineupState; this view is pure
 * presentational (same pattern as TacticsForm).
 */
export default function LineupEditor({ team, state, onChange }: LineupEditorProps) {
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  // Look up players by id — every slot row needs at least one lookup.
  const playerById = new Map<number, Player>();
  for (const p of team.roster) playerById.set(p.id, p);

  // GK count for the non-blocking warnings.
  const gkCount = state.starting_xi.reduce((acc, id) => {
    const p = playerById.get(id);
    return acc + (p?.position === "GK" ? 1 : 0);
  }, 0);

  function toggleSlot(slotIdx: number) {
    setExpandedSlot((prev) => (prev === slotIdx ? null : slotIdx));
  }

  /**
   * Swap-perfect substitution: XI[slotIdx] ⇄ incomingId. If incoming came
   * from the bench, outgoing takes its exact bench slot — bench size and
   * order both preserved. If incoming came from outside the bench (no
   * caller today; D.1.f may surface this path), outgoing leaves the team
   * silently — bench unchanged.
   */
  function swap(slotIdx: number, incomingId: number) {
    const outgoingId = state.starting_xi[slotIdx];
    const newXI = state.starting_xi.slice();
    newXI[slotIdx] = incomingId;

    const newBench = state.bench.slice();
    const benchIdx = newBench.indexOf(incomingId);
    if (benchIdx >= 0) {
      newBench[benchIdx] = outgoingId;
    }

    onChange({ starting_xi: newXI, bench: newBench });
    setExpandedSlot(null);
  }

  /** Candidates for `slotIdx`: roster players matching the slot's position
   *  who aren't currently in the XI. Today that means "in bench OR
   *  unaffiliated"; in practice every roster player is either XI or bench. */
  function candidatesFor(slotIdx: number): Player[] {
    const current = playerById.get(state.starting_xi[slotIdx]);
    if (!current) return [];
    const xiSet = new Set(state.starting_xi);
    return team.roster.filter(
      (p) => p.position === current.position && !xiSet.has(p.id),
    );
  }

  return (
    <>
      {gkCount === 0 && (
        <p className="lineup-warning">
          ATENÇÃO: nenhum goleiro na escalação
        </p>
      )}
      {gkCount > 1 && (
        <p className="lineup-warning">
          ATENÇÃO: múltiplos goleiros na escalação ({gkCount})
        </p>
      )}

      <div className="lineup">
        {state.starting_xi.map((playerId, slotIdx) => {
          const player = playerById.get(playerId);
          const candidates = candidatesFor(slotIdx);
          const isExpanded = expandedSlot === slotIdx;
          const noCandidates = candidates.length === 0;

          return (
            <div key={slotIdx} className="lineup-slot">
              <div className="lineup-slot__row">
                <span className="lineup-slot__glyph">►</span>
                <span className="lineup-slot__pos">{player?.position ?? "?"}</span>
                <span className="lineup-slot__name">
                  {player?.name ?? `Player ${playerId}`}
                </span>
                <span className="lineup-slot__stam">
                  STAM {player?.attributes.stamina ?? "?"}
                </span>
                <button
                  type="button"
                  className="btn lineup-slot__btn"
                  onClick={() => toggleSlot(slotIdx)}
                  disabled={noCandidates}
                  title={
                    noCandidates ? "Sem substituto na mesma posição" : undefined
                  }
                >
                  [ TROCAR ]
                </button>
              </div>

              {isExpanded && (
                <div className="lineup-candidates">
                  <p className="lineup-candidates__title muted">
                    Candidatos ({player?.position}):
                  </p>
                  {candidates.map((c) => (
                    <div key={c.id} className="lineup-candidates__row">
                      <span className="lineup-slot__glyph"> </span>
                      <span className="lineup-slot__pos">{c.position}</span>
                      <span className="lineup-slot__name">{c.name}</span>
                      <span className="lineup-slot__stam">
                        STAM {c.attributes.stamina}
                      </span>
                      <button
                        type="button"
                        className="btn lineup-slot__btn"
                        onClick={() => swap(slotIdx, c.id)}
                      >
                        [ ESCOLHER ]
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
