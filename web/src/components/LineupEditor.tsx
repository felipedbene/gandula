import { useState } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { Player, Team } from "../types";
import { applySwap } from "../util/lineup";
import FormationPitch from "./ui/FormationPitch";

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
  /** Live formation (being edited) — passed to the pitch so its rows restructure
   *  as the user changes the formation dropdown. */
  formation?: string;
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
export default function LineupEditor({ team, state, formation, onChange }: LineupEditorProps) {
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

  /** Swap-perfect substitution: XI[slotIdx] ⇄ incomingId. Bench bookkeeping
   *  (outgoing takes incoming's bench slot, or spills to the end / leaves a
   *  full bench) lives in the shared `applySwap` — see util/lineup.ts. */
  function swap(slotIdx: number, incomingId: number) {
    onChange(applySwap(state, state.starting_xi[slotIdx], incomingId));
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
      {/* Visual pitch — the primary editor; tapping a dot swaps via the same
          state/onChange as the list below, so they stay in sync. */}
      <FormationPitch team={team} state={state} formation={formation} onChange={onChange} />

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
                <Text span c="accent.4">►</Text>
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
