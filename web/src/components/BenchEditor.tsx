import { useState } from "react";
import type { Player, Team } from "../types";
import type { LineupState } from "./LineupEditor";

/** Hard upper bound on bench size — mirrors `core/src/domain/team.rs:8`
 *  (`pub const MAX_BENCH: usize = 7`). Engine validation rejects any bench
 *  longer than this, so we cap inside the UI too. Exported so LineupEditor
 *  can reuse it when deciding whether to spill a swap's outgoing player
 *  back onto the bench. */
export const MAX_BENCH = 7;

type BenchEditorProps = {
  team: Team;
  state: LineupState;
  onChange: (next: LineupState) => void;
};

/**
 * Controlled-component editor for the bench. Two operations:
 *
 *   - REMOVER on a bench slot → player goes to "outside the team"
 *     (in roster but not in XI nor bench). Bench shrinks.
 *   - ADICIONAR JOGADOR → expands a candidate list of currently-outside
 *     players (no position filter — the bench is heterogeneous by
 *     design). Click ESCOLHER to append at end.
 *
 * Soft warnings: empty bench (manager substitutions impossible) and
 * bench-without-GK. Hard limit: bench ≤ 7, ADICIONAR disabled when full
 * or when there are no outside players to add.
 *
 * State ownership: parent owns LineupState; this view is pure
 * presentational — same pattern as LineupEditor and TacticsForm.
 */
export default function BenchEditor({ team, state, onChange }: BenchEditorProps) {
  const [adding, setAdding] = useState(false);

  const playerById = new Map<number, Player>();
  for (const p of team.roster) playerById.set(p.id, p);

  const benchGkCount = state.bench.reduce((acc, id) => {
    const p = playerById.get(id);
    return acc + (p?.position === "GK" ? 1 : 0);
  }, 0);

  const benchFull = state.bench.length >= MAX_BENCH;
  const benchEmpty = state.bench.length === 0;

  /** Players in the roster but neither in XI nor in bench. */
  function outsidePlayers(): Player[] {
    const xiSet = new Set(state.starting_xi);
    const benchSet = new Set(state.bench);
    return team.roster.filter((p) => !xiSet.has(p.id) && !benchSet.has(p.id));
  }

  function remove(slotIdx: number) {
    const newBench = state.bench.slice();
    newBench.splice(slotIdx, 1);
    onChange({ ...state, bench: newBench });
  }

  function add(playerId: number) {
    // Belt-and-suspenders: the button is disabled when full, but guard the
    // mutation too in case a caller bypasses the UI.
    if (state.bench.length >= MAX_BENCH) return;
    onChange({ ...state, bench: [...state.bench, playerId] });
    setAdding(false);
  }

  const candidates = outsidePlayers();
  const noOutside = candidates.length === 0;

  return (
    <>
      {benchEmpty && (
        <p className="lineup-warning">
          ATENÇÃO: banco vazio (substituições impossíveis)
        </p>
      )}
      {!benchEmpty && benchGkCount === 0 && (
        <p className="lineup-warning">
          ATENÇÃO: nenhum goleiro no banco
        </p>
      )}

      <div className="bench-header muted">
        BANCO ({state.bench.length} / {MAX_BENCH})
      </div>

      <div className="lineup">
        {state.bench.map((playerId, slotIdx) => {
          const player = playerById.get(playerId);
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
                  onClick={() => remove(slotIdx)}
                >
                  [ REMOVER ]
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bench-add">
        <button
          type="button"
          className="btn"
          onClick={() => setAdding((p) => !p)}
          disabled={benchFull || noOutside}
          title={
            benchFull
              ? `Banco cheio (máximo ${MAX_BENCH})`
              : noOutside
                ? "Nenhum jogador disponível fora do time"
                : undefined
          }
        >
          [ ADICIONAR JOGADOR ]
        </button>

        {adding && (
          <div className="lineup-candidates">
            <p className="lineup-candidates__title muted">
              Candidatos (qualquer posição):
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
                  onClick={() => add(c.id)}
                >
                  [ ESCOLHER ]
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
