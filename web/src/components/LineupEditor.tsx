import { useState } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { Player, Team } from "../types";
import { MAX_BENCH } from "./BenchEditor";

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
   * Swap-perfect substitution: XI[slotIdx] ⇄ incomingId.
   *
   * - Incoming came from the bench → outgoing takes its exact bench slot.
   *   Bench size and order both preserved.
   * - Incoming came from outside the bench (D.1.f path, surfaced when the
   *   user REMOVERs a player off the bench and then picks them back into
   *   the XI from "outside"):
   *     - If the bench has room (< MAX_BENCH), outgoing is appended to the
   *       end so the user doesn't lose the player they had on the field.
   *     - If the bench is full, outgoing leaves the team silently — the
   *       rare-but-real case where the user has deliberately built up a
   *       full bench and the only thing to give up is the XI slot.
   */
  function swap(slotIdx: number, incomingId: number) {
    const outgoingId = state.starting_xi[slotIdx];
    const newXI = state.starting_xi.slice();
    newXI[slotIdx] = incomingId;

    const newBench = state.bench.slice();
    const benchIdx = newBench.indexOf(incomingId);
    if (benchIdx >= 0) {
      newBench[benchIdx] = outgoingId;
    } else if (newBench.length < MAX_BENCH) {
      newBench.push(outgoingId);
    }
    // else: bench full and incoming from outside → outgoing leaves silently.

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
    <Stack gap="xs">
      {gkCount === 0 && (
        <Text c="red.5" size="sm">
          ATENÇÃO: nenhum goleiro na escalação
        </Text>
      )}
      {gkCount > 1 && (
        <Text c="red.5" size="sm">
          ATENÇÃO: múltiplos goleiros na escalação ({gkCount})
        </Text>
      )}

      <Stack gap={2}>
        {state.starting_xi.map((playerId, slotIdx) => {
          const player = playerById.get(playerId);
          const candidates = candidatesFor(slotIdx);
          const isExpanded = expandedSlot === slotIdx;
          const noCandidates = candidates.length === 0;

          return (
            <div key={slotIdx}>
              <Group gap="xs" wrap="nowrap">
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
                  onClick={() => toggleSlot(slotIdx)}
                  disabled={noCandidates}
                  title={
                    noCandidates ? "Sem substituto na mesma posição" : undefined
                  }
                >
                  Trocar
                </Button>
              </Group>

              {isExpanded && (
                <Stack
                  gap={2}
                  pl="md"
                  mt={4}
                  style={{ borderLeft: "1px solid var(--mantine-color-dark-4)" }}
                >
                  <Text size="xs" c="dimmed">
                    Candidatos ({player?.position}):
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
                        onClick={() => swap(slotIdx, c.id)}
                      >
                        Escolher
                      </Button>
                    </Group>
                  ))}
                </Stack>
              )}
            </div>
          );
        })}
      </Stack>
    </Stack>
  );
}
