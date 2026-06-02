import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Stack, Text } from "@mantine/core";
import type { Player, Position, Team } from "../../types";
import { playerOverall } from "../../util/transfer-market";
import type { LineupState } from "../LineupEditor";
import { applySwap, swapFromDrop, formationRows } from "../../util/lineup";

/**
 * A responsive portrait football pitch that renders a starting XI by grouping
 * the players into position bands (GK → DEF → MID → FWD) — the honest layout,
 * since the XI is just 11 ids each carrying a coarse Position (the precise
 * formation slot isn't stored; see LineupEditor). The pitch scales to its
 * container width via a fixed aspect ratio, so it reads the same on phone and
 * desktop.
 *
 * Read-only by default (used for the opponent preview). When `onChange` is
 * given it's interactive, with two ways to make the same swap-perfect
 * substitution (both route through `applySwap`):
 *   - **Tap** a dot to reveal same-position candidates, then pick one.
 *   - **Drag** a dot onto a same-position dot — including the bench rail shown
 *     below the pitch. Pointer-events based, so it works with both mouse and
 *     touch (the app is mobile-native; native HTML5 drag doesn't fire on touch).
 * A valid drop is same-position with exactly one endpoint in the XI; the XI
 * endpoint is the outgoing player, the other is the incoming one.
 */

// Two-tone dot colours per position so they read at a glance.
const BAND_COLOR: Record<Position, string> = {
  FWD: "var(--mantine-color-accent-5)",
  MID: "var(--mantine-color-ink-3)",
  DEF: "var(--mantine-color-ink-2)",
  GK: "var(--mantine-color-yellow-6)",
};

// Movement past this many px before pointerup counts as a drag, not a tap.
const DRAG_THRESHOLD_PX = 6;

type DotHandlers = {
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
};

function PlayerDot({
  player,
  selected,
  dropTarget,
  dragging,
  size = "md",
  handlers,
}: {
  player: Player | undefined;
  selected?: boolean;
  /** Highlighted as the current valid drop target during a drag. */
  dropTarget?: boolean;
  /** This dot is the one being dragged (dimmed; the ghost shows the live one). */
  dragging?: boolean;
  size?: "md" | "sm";
  handlers?: DotHandlers;
}) {
  const ovr = player ? playerOverall(player) : "?";
  const name = player?.name ?? "—";
  // Short label: surname (last token) keeps the pitch legible.
  const short = name.split(/\s+/).slice(-1)[0];
  const interactive = !!handlers?.onClick || !!handlers?.onPointerDown;
  const dim = size === "sm" ? 26 : 30;
  return (
    <Box
      component={interactive ? "button" : "div"}
      type={interactive ? "button" : undefined}
      onClick={handlers?.onClick}
      onPointerDown={handlers?.onPointerDown}
      onPointerMove={handlers?.onPointerMove}
      onPointerUp={handlers?.onPointerUp}
      data-dot-id={player?.id}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: interactive ? (handlers?.onPointerDown ? "grab" : "pointer") : "default",
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: 72,
        // Stop the browser from scrolling/selecting mid-drag on touch.
        touchAction: handlers?.onPointerDown ? "none" : undefined,
        userSelect: "none",
        opacity: dragging ? 0.35 : 1,
      }}
    >
      <Box
        style={{
          width: dim,
          height: dim,
          borderRadius: "50%",
          background: player
            ? BAND_COLOR[player.position]
            : "var(--mantine-color-ink-5)",
          color: "var(--mantine-color-ink-9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: size === "sm" ? 11 : 12,
          fontFamily: "var(--mantine-font-family-monospace)",
          boxShadow: dropTarget
            ? "0 0 0 3px var(--mantine-color-teal-4)"
            : selected
              ? "0 0 0 3px var(--mantine-color-accent-4)"
              : "0 1px 3px rgba(0,0,0,0.4)",
          transform: dropTarget ? "scale(1.12)" : "none",
          transition: "box-shadow 120ms ease, transform 120ms ease",
          pointerEvents: "none", // let the parent button own the gesture
        }}
      >
        {ovr}
      </Box>
      <Text
        fz={size === "sm" ? 9 : 10}
        fw={600}
        c="white"
        truncate
        style={{
          maxWidth: 64,
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          lineHeight: 1.1,
          pointerEvents: "none",
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
  formation,
  onChange,
}: {
  team: Team;
  state: LineupState;
  /** Formation that shapes the pitch rows. Defaults to the team's own
   *  formation; the lineup editor passes the live (being-edited) one so the
   *  board restructures as the user changes the formation dropdown. */
  formation?: string;
  /** When provided, the pitch is interactive (tap or drag to swap). Omit for a
   *  read-only view (e.g. the opponent preview). */
  onChange?: (next: LineupState) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  // Drag view-state (drives the ghost + highlight); the authoritative gesture
  // bookkeeping lives in `dragRef` so pointer handlers never read stale state.
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  // `dragging` flips true only once the pointer crosses the move threshold, so
  // a plain tap never shows the ghost or dims the dot.
  const [dragging, setDragging] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const interactive = !!onChange;

  const playerById = new Map<number, Player>();
  for (const p of team.roster) playerById.set(p.id, p);
  const xiSet = new Set(state.starting_xi);

  // Lay the XI out in the chosen formation's lines (top→bottom, FWD..GK). Falls
  // back to the team's own formation for the read-only opponent preview. Empty
  // rows are dropped so the vertical spacing stays even.
  const shape = formation ?? team.formation;
  const rows = formationRows(
    shape,
    state.starting_xi,
    (id) => playerById.get(id)?.position,
  ).filter((r) => r.length > 0);

  /** Same-position candidates not already in the XI — the tap-swap menu. */
  function candidatesFor(playerId: number): Player[] {
    const cur = playerById.get(playerId);
    if (!cur) return [];
    return team.roster.filter(
      (p) => p.position === cur.position && !xiSet.has(p.id),
    );
  }

  const positionOf = (id: number) => playerById.get(id)?.position;

  /** Whether a source→target drop is allowed (drives the hover highlight). */
  function canDrop(sourceId: number, targetId: number): boolean {
    return swapFromDrop(state, positionOf, sourceId, targetId) !== null;
  }

  /** Commit the swap implied by a source→target drop (the shared rule lives in
   *  swapFromDrop). */
  function commitDrop(sourceId: number, targetId: number) {
    const next = onChange && swapFromDrop(state, positionOf, sourceId, targetId);
    if (next) {
      onChange!(next);
      setSelected(null);
    }
  }

  /** Tap-pick: the selected dot is in the XI, the candidate replaces it. */
  function commitPick(outgoingId: number, incomingId: number) {
    if (!onChange) return;
    onChange(applySwap(state, outgoingId, incomingId));
    setSelected(null);
  }

  // ----- Pointer drag-and-drop -------------------------------------------
  function dotIdAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const dot = el?.closest<HTMLElement>("[data-dot-id]");
    const raw = dot?.getAttribute("data-dot-id");
    return raw ? Number(raw) : null;
  }

  function onDotPointerDown(id: number) {
    return (e: React.PointerEvent) => {
      if (!interactive || e.button !== 0) return;
      // Clear any stale suppress from a prior drag that ended without a
      // trailing click, so this gesture's tap (if it's a tap) isn't eaten.
      suppressClickRef.current = false;
      dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false };
      setDragId(id);
      // Ghost stays hidden (dragging=false) until the move threshold is crossed.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function onDotPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      d.moved = true;
      setDragging(true); // first real movement → reveal the ghost
    }
    if (d.moved) {
      setGhost({ x: e.clientX, y: e.clientY });
      const targetId = dotIdAt(e.clientX, e.clientY);
      setDropId(targetId !== null && canDrop(d.id, targetId) ? targetId : null);
    }
  }

  function onDotPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDragging(false);
    setGhost(null);
    const target = dropId;
    setDropId(null);
    if (!d) return;
    if (d.moved) {
      // A real drag: suppress the click that browsers fire after pointerup.
      suppressClickRef.current = true;
      if (target !== null) commitDrop(d.id, target);
    }
  }

  function onDotClick(id: number) {
    return () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return; // this "click" was the tail of a drag
      }
      setSelected((p) => (p === id ? null : id));
    };
  }

  function handlersFor(id: number): DotHandlers | undefined {
    if (!interactive) return undefined;
    return {
      onClick: onDotClick(id),
      onPointerDown: onDotPointerDown(id),
      onPointerMove: onDotPointerMove,
      onPointerUp: onDotPointerUp,
    };
  }

  const selectedCandidates =
    selected !== null ? candidatesFor(selected) : [];

  // Bench players that are real roster members (interactive rail only).
  const benchPlayers = interactive
    ? state.bench.map((id) => playerById.get(id)).filter((p): p is Player => !!p)
    : [];

  const draggedPlayer = dragId !== null ? playerById.get(dragId) : undefined;

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
        {rows.map((rowIds, rowIdx) => (
          <Box
            key={rowIdx}
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              justifyContent: "space-evenly",
              alignItems: "center",
              gap: 4,
            }}
          >
            {rowIds.map((id) => (
              <PlayerDot
                key={id}
                player={playerById.get(id)}
                selected={selected === id}
                dropTarget={dropId === id}
                dragging={dragging && dragId === id}
                handlers={handlersFor(id)}
              />
            ))}
          </Box>
        ))}
      </Box>

      {/* Bench rail — the other half of the drag target surface. */}
      {interactive && benchPlayers.length > 0 && (
        <Box>
          <Text size="xs" c="dimmed" mb={2}>
            Banco · arraste para escalar
          </Text>
          <Box
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: "8px 6px",
              borderRadius: "var(--mantine-radius-sm)",
              background: "var(--mantine-color-ink-8)",
              border: "1px solid var(--mantine-color-ink-7)",
            }}
          >
            {benchPlayers.map((p) => (
              <PlayerDot
                key={p.id}
                player={p}
                dropTarget={dropId === p.id}
                dragging={dragging && dragId === p.id}
                size="sm"
                handlers={handlersFor(p.id)}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Floating drag ghost following the pointer. Portaled to <body> so its
          `position: fixed` is anchored to the viewport — the screen wrapper
          carries a leftover `transform` from the phase-enter animation
          (animation-fill-mode: both), which would otherwise become the
          containing block and offset the ghost from the cursor. */}
      {dragging &&
        ghost &&
        draggedPlayer &&
        typeof document !== "undefined" &&
        createPortal(
          <Box
            style={{
              position: "fixed",
              left: ghost.x,
              top: ghost.y,
              transform: "translate(-50%, -50%)",
              zIndex: 1000,
              pointerEvents: "none",
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: BAND_COLOR[draggedPlayer.position],
              color: "var(--mantine-color-ink-9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 13,
              fontFamily: "var(--mantine-font-family-monospace)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              opacity: 0.92,
            }}
          >
            {playerOverall(draggedPlayer)}
          </Box>,
          document.body,
        )}

      {/* Interactive swap menu for the selected (tapped) player. */}
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
                  type="button"
                  onClick={() => commitPick(selected, c.id)}
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
