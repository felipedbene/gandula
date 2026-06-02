import { useState } from "react";
import { Box, Stack, Text } from "@mantine/core";
import type { Player, Position, Team } from "../../types";
import { playerOverall } from "../../util/transfer-market";
import type { LineupState } from "../LineupEditor";
import { MAX_BENCH } from "../BenchEditor";

/**
 * A responsive portrait football pitch that renders a starting XI by grouping
 * the players into position bands (GK → DEF → MID → FWD) — the honest layout,
 * since the XI is just 11 ids each carrying a coarse Position (the precise
 * formation slot isn't stored; see LineupEditor). The pitch scales to its
 * container width via a fixed aspect ratio, so it reads the same on phone and
 * desktop.
 *
 * Read-only by default (used for the opponent preview). When `onChange` is
 * given it's interactive: tap a player to reveal same-position candidates and
 * pick one to swap (swap-perfect, mirroring LineupEditor.swap).
 */

const BANDS: { pos: Position; label: string }[] = [
  { pos: "FWD", label: "ATA" },
  { pos: "MID", label: "MEI" },
  { pos: "DEF", label: "DEF" },
  { pos: "GK", label: "GOL" },
];

// Two-tone dot colours per band so positions read at a glance.
const BAND_COLOR: Record<Position, string> = {
  FWD: "var(--mantine-color-accent-5)",
  MID: "var(--mantine-color-ink-3)",
  DEF: "var(--mantine-color-ink-2)",
  GK: "var(--mantine-color-yellow-6)",
};

function PlayerDot({
  player,
  selected,
  onClick,
}: {
  player: Player | undefined;
  selected: boolean;
  onClick?: () => void;
}) {
  const ovr = player ? playerOverall(player) : "?";
  const name = player?.name ?? "—";
  // Short label: surname (last token) keeps the pitch legible.
  const short = name.split(/\s+/).slice(-1)[0];
  return (
    <Box
      component={onClick ? "button" : "div"}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: 72,
      }}
    >
      <Box
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: player
            ? BAND_COLOR[player.position]
            : "var(--mantine-color-ink-5)",
          color: "var(--mantine-color-ink-9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 12,
          fontFamily: "var(--mantine-font-family-monospace)",
          boxShadow: selected
            ? "0 0 0 3px var(--mantine-color-accent-4)"
            : "0 1px 3px rgba(0,0,0,0.4)",
          transition: "box-shadow 120ms ease",
        }}
      >
        {ovr}
      </Box>
      <Text
        fz={10}
        fw={600}
        c="white"
        truncate
        style={{
          maxWidth: 64,
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          lineHeight: 1.1,
        }}
      >
        {short}
      </Text>
    </Box>
  );
}

export default function FormationPitch({
  team,
  state,
  onChange,
}: {
  team: Team;
  state: LineupState;
  /** When provided, the pitch is interactive (tap to swap). Omit for a
   *  read-only view (e.g. the opponent preview). */
  onChange?: (next: LineupState) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const interactive = !!onChange;

  const playerById = new Map<number, Player>();
  for (const p of team.roster) playerById.set(p.id, p);

  // Group the XI ids into position bands, preserving array order within each.
  const bands = BANDS.map((b) => ({
    ...b,
    ids: state.starting_xi.filter(
      (id) => playerById.get(id)?.position === b.pos,
    ),
  }));

  /** Same-position candidates not already in the XI — the swap menu. */
  function candidatesFor(playerId: number): Player[] {
    const cur = playerById.get(playerId);
    if (!cur) return [];
    const xiSet = new Set(state.starting_xi);
    return team.roster.filter(
      (p) => p.position === cur.position && !xiSet.has(p.id),
    );
  }

  // Swap-perfect: mirrors LineupEditor.swap so the two editors agree.
  function swap(outgoingId: number, incomingId: number) {
    if (!onChange) return;
    const slotIdx = state.starting_xi.indexOf(outgoingId);
    if (slotIdx < 0) return;
    const newXI = state.starting_xi.slice();
    newXI[slotIdx] = incomingId;
    const newBench = state.bench.slice();
    const benchIdx = newBench.indexOf(incomingId);
    if (benchIdx >= 0) newBench[benchIdx] = outgoingId;
    else if (newBench.length < MAX_BENCH) newBench.push(outgoingId);
    onChange({ starting_xi: newXI, bench: newBench });
    setSelected(null);
  }

  const selectedCandidates =
    selected !== null ? candidatesFor(selected) : [];

  return (
    <Stack gap="xs">
      <Box
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "3 / 4",
          maxWidth: 460,
          margin: "0 auto",
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden",
          background:
            "linear-gradient(160deg, hsl(150 32% 22%), hsl(150 36% 16%))",
          border: "1px solid var(--mantine-color-ink-7)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          padding: "12px 8px",
        }}
      >
        {/* Pitch markings (decorative). */}
        <PitchMarkings />
        {bands.map((band) => (
          <Box
            key={band.pos}
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              justifyContent: "space-evenly",
              alignItems: "center",
              gap: 4,
            }}
          >
            {band.ids.length === 0 ? null : (
              band.ids.map((id) => (
                <PlayerDot
                  key={id}
                  player={playerById.get(id)}
                  selected={selected === id}
                  onClick={
                    interactive
                      ? () => setSelected((p) => (p === id ? null : id))
                      : undefined
                  }
                />
              ))
            )}
          </Box>
        ))}
      </Box>

      {/* Interactive swap menu for the selected player. */}
      {interactive && selected !== null && (
        <Box
          p="xs"
          style={{
            borderRadius: "var(--mantine-radius-sm)",
            background: "var(--mantine-color-ink-8)",
            border: "1px solid var(--mantine-color-ink-7)",
          }}
        >
          <Text size="xs" c="dimmed" mb={4}>
            Trocar {playerById.get(selected)?.name} (
            {playerById.get(selected)?.position}) por:
          </Text>
          {selectedCandidates.length === 0 ? (
            <Text size="sm" c="dimmed">
              Sem substituto na mesma posição.
            </Text>
          ) : (
            <Stack gap={2}>
              {selectedCandidates.map((c) => (
                <Box
                  key={c.id}
                  component="button"
                  onClick={() => swap(selected, c.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--mantine-spacing-xs)",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 2px",
                    borderRadius: 4,
                    color: "var(--mantine-color-ink-0)",
                  }}
                >
                  <Text span size="sm" ff="monospace" c="accent.3" fw={700}>
                    {playerOverall(c)}
                  </Text>
                  <Text span size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                    {c.name}
                  </Text>
                  <Text span size="xs" c="dimmed">
                    {c.age}a · STAM {c.attributes.stamina}
                  </Text>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );
}

/** Decorative pitch lines drawn as an SVG overlay. */
function PitchMarkings() {
  const line = "rgba(255,255,255,0.16)";
  return (
    <svg
      viewBox="0 0 100 133"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
      }}
      aria-hidden="true"
    >
      {/* outer touchline */}
      <rect x="3" y="3" width="94" height="127" fill="none" stroke={line} strokeWidth="0.6" />
      {/* halfway line + centre circle */}
      <line x1="3" y1="66.5" x2="97" y2="66.5" stroke={line} strokeWidth="0.6" />
      <circle cx="50" cy="66.5" r="11" fill="none" stroke={line} strokeWidth="0.6" />
      <circle cx="50" cy="66.5" r="0.9" fill={line} />
      {/* top penalty box (attack) */}
      <rect x="28" y="3" width="44" height="18" fill="none" stroke={line} strokeWidth="0.6" />
      <rect x="40" y="3" width="20" height="7" fill="none" stroke={line} strokeWidth="0.6" />
      {/* bottom penalty box (own goal) */}
      <rect x="28" y="112" width="44" height="18" fill="none" stroke={line} strokeWidth="0.6" />
      <rect x="40" y="123" width="20" height="7" fill="none" stroke={line} strokeWidth="0.6" />
    </svg>
  );
}
