import { useState } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
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
    <Stack gap="xs">
      {benchEmpty && (
        <Text c="red.5" size="sm">
          ATENÇÃO: banco vazio (substituições impossíveis)
        </Text>
      )}
      {!benchEmpty && benchGkCount === 0 && (
        <Text c="red.5" size="sm">
          ATENÇÃO: nenhum goleiro no banco
        </Text>
      )}

      <Text size="sm" c="dimmed" tt="uppercase">
        BANCO ({state.bench.length} / {MAX_BENCH})
      </Text>

      <Stack gap={2}>
        {state.bench.map((playerId, slotIdx) => {
          const player = playerById.get(playerId);
          return (
            <Group key={slotIdx} gap="xs" wrap="nowrap">
              <Text span c="phosphor.4">►</Text>
              <Text span size="sm" c="dimmed">
                {player?.position ?? "?"}
              </Text>
              <Text
                span
                size="sm"
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {player?.name ?? `Player ${playerId}`}
              </Text>
              <Text span size="sm" c="dimmed">
                {player?.age ?? "?"}a · STAM {player?.attributes.stamina ?? "?"}
              </Text>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => remove(slotIdx)}
              >
                Remover
              </Button>
            </Group>
          );
        })}
      </Stack>

      <div>
        <Button
          size="compact-sm"
          variant="default"
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
          Adicionar jogador
        </Button>

        {adding && (
          <Stack
            gap={2}
            pl="md"
            mt={4}
            style={{ borderLeft: "1px solid var(--mantine-color-dark-4)" }}
          >
            <Text size="xs" c="dimmed">
              Candidatos (qualquer posição):
            </Text>
            {candidates.map((c) => (
              <Group key={c.id} gap="xs" wrap="nowrap">
                <Text span size="sm" c="dimmed">
                  {c.position}
                </Text>
                <Text span size="sm" style={{ flex: 1, minWidth: 0 }}>
                  {c.name}
                </Text>
                <Text span size="sm" c="dimmed">
                  {c.age}a · STAM {c.attributes.stamina}
                </Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => add(c.id)}
                >
                  Escolher
                </Button>
              </Group>
            ))}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
