import { useMemo, useState } from "react";
import { Badge, Button, Group, NativeSelect, Stack, Text } from "@mantine/core";
import { project_second_half_js } from "../wasm/gandula_wasm.js";
import type { HalfTimeSub, Player, Team } from "../types";
import type { UserTactics } from "../persistence";
import { applyUserTactics, applyRivalHalftime } from "../util/resimulate";
import { Panel } from "./ui/Panel";
import { TeamCrest } from "./ui/TeamCrest";
import { ProjectionIndicators } from "./ui/ProjectionIndicators";
import TacticsForm, {
  type TacticsFormState,
  tacticsFormStateToOverride,
} from "./TacticsForm";

type SecondHalfProjection = {
  home_possession: number;
  home_pressure: number;
  away_pressure: number;
};

type HalftimePanelProps = {
  /** The opaque HalfTimeSnapshot returned by play_first_half. */
  snapshot: unknown;
  /** The user's team at the break (first-half tactics applied). */
  baseUserTeam: Team;
  /** The opponent at the break. */
  opponentTeam: Team;
  /** True if the user is the home side in this fixture. */
  isUserHome: boolean;
  /** The user's division tier — drives the rival's symmetric half-time tactic. */
  tier: 1 | 2 | 3;
  /** First-half running score, user-perspective + opponent. */
  userGoals: number;
  oppGoals: number;
  /** The user's first-half tactics, as the form's starting values. */
  initial: TacticsFormState;
  /** Player keeps the same XI/bench at the interval (this panel only changes
   *  the tactical dials, not the lineup — lineup edits stay in PrepareView). */
  startingXi: number[];
  bench: number[];
  /** Confirm: pass the chosen half-time UserTactics (or null if unchanged) and
   *  the chosen substitutions (empty if none). */
  onConfirm: (halftime: UserTactics | null, subs: HalfTimeSub[]) => void;
};

/** Max substitutions the user may make at the interval — mirrors the engine's
 *  MAX_SUBS_PER_MATCH. */
const MAX_HALFTIME_SUBS = 3;

/**
 * The half-time interview. Shows the closed first-half score, lets the player
 * tweak the tactical dials, and recomputes the analytic second-half projection
 * (possession + pressure — NO projected score) on every change. The opponent
 * folds its symmetric per-tier tactic into the projection silently, so the
 * indicators already reflect the rival's response. On confirm, the (possibly
 * unchanged) tactics are handed up to run the real second half.
 */
export default function HalftimePanel({
  snapshot,
  baseUserTeam,
  opponentTeam,
  isUserHome,
  tier,
  userGoals,
  oppGoals,
  initial,
  startingXi,
  bench,
  onConfirm,
}: HalftimePanelProps) {
  const [form, setForm] = useState<TacticsFormState>(initial);
  const [subs, setSubs] = useState<HalfTimeSub[]>([]);

  const toUserTactics = (s: TacticsFormState): UserTactics => {
    const { formation, tactics } = tacticsFormStateToOverride(s);
    return { formation, tactics, starting_xi: startingXi, bench };
  };

  // Player lookup for the sub dropdowns, off the user's break-time roster.
  const byId = useMemo(() => {
    const m = new Map<number, Player>();
    for (const p of baseUserTeam.roster) m.set(p.id, p);
    return m;
  }, [baseUserTeam.roster]);
  const label = (id: number) => {
    const p = byId.get(id);
    return p ? `${p.name} (${p.position})` : `#${id}`;
  };

  // Off candidates: on-field starters not already pulled. On candidates: bench
  // players not already brought on. Keeps each player in at most one swap.
  const usedOff = new Set(subs.map((s) => s.off));
  const usedOn = new Set(subs.map((s) => s.on));
  const offOptions = startingXi.filter((id) => !usedOff.has(id));
  const onOptions = bench.filter((id) => !usedOn.has(id));
  const [offSel, setOffSel] = useState<number | null>(null);
  const [onSel, setOnSel] = useState<number | null>(null);

  const canAddSub =
    subs.length < MAX_HALFTIME_SUBS &&
    offSel !== null &&
    onSel !== null &&
    !usedOff.has(offSel) &&
    !usedOn.has(onSel);

  function addSub() {
    if (offSel === null || onSel === null) return;
    setSubs([...subs, { off: offSel, on: onSel }]);
    setOffSel(null);
    setOnSel(null);
  }
  function removeSub(i: number) {
    setSubs(subs.filter((_, idx) => idx !== i));
  }

  // Recompute the projection whenever the form changes. The rival's symmetric
  // half-time tactic is baked into the opponent team here AND in the real
  // second half (resimulate.applyRivalHalftime), so what the player sees is
  // what they'll get.
  const projection = useMemo<SecondHalfProjection | null>(() => {
    try {
      const userTeam = applyUserTactics(baseUserTeam, toUserTactics(form));
      const oppTeam = applyRivalHalftime(opponentTeam, tier);
      const home = isUserHome ? userTeam : oppTeam;
      const away = isUserHome ? oppTeam : userTeam;
      return project_second_half_js(snapshot, home, away) as SecondHalfProjection;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, baseUserTeam, opponentTeam, isUserHome, tier, snapshot]);

  // Orient the projection to the user's perspective for display.
  const userPoss = projection
    ? isUserHome
      ? projection.home_possession
      : 1 - projection.home_possession
    : 0.5;
  const userPressure = projection
    ? isUserHome
      ? projection.home_pressure
      : projection.away_pressure
    : 0;
  const oppPressure = projection
    ? isUserHome
      ? projection.away_pressure
      : projection.home_pressure
    : 0;

  const userName = baseUserTeam.name;
  const oppName = opponentTeam.name;

  return (
    <Panel title="Intervalo">
      <Stack gap="md">
        {/* Closed first-half score. */}
        <Group justify="center" gap="md" align="center">
          <Group gap="xs">
            <TeamCrest name={userName} size={28} radius={6} />
            <Text fw={700}>{userName}</Text>
          </Group>
          <Text ff="monospace" fw={800} fz="xl">
            {userGoals} <Text span c="dimmed">-</Text> {oppGoals}
          </Text>
          <Group gap="xs">
            <Text fw={700}>{oppName}</Text>
            <TeamCrest name={oppName} size={28} radius={6} />
          </Group>
        </Group>

        <Text c="dimmed" size="sm" ta="center">
          Ajuste a tática para o segundo tempo. Os indicadores já consideram a
          resposta do adversário.
        </Text>

        <TacticsForm state={form} onChange={setForm} />

        {/* Aggregate projection — NO projected score. */}
        <ProjectionIndicators
          userPossession={userPoss}
          userPressure={userPressure}
          oppPressure={oppPressure}
          userName={userName}
          oppName={oppName}
        />

        {/* Substituições (até 3) — aplicadas no reinício do segundo tempo. */}
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Substituições ({subs.length}/{MAX_HALFTIME_SUBS})
          </Text>
          {subs.map((s, i) => (
            <Group key={i} gap="xs" wrap="nowrap" justify="space-between">
              <Text size="sm">
                <Badge size="xs" color="red" variant="light" radius="sm">
                  sai
                </Badge>{" "}
                {label(s.off)} →{" "}
                <Badge size="xs" color="accent" variant="light" radius="sm">
                  entra
                </Badge>{" "}
                {label(s.on)}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => removeSub(i)}
              >
                remover
              </Button>
            </Group>
          ))}
          {subs.length < MAX_HALFTIME_SUBS && onOptions.length > 0 && (
            <Group gap="xs" align="end" wrap="nowrap">
              <NativeSelect
                size="xs"
                label="Sai"
                style={{ flex: 1 }}
                value={offSel ?? ""}
                onChange={(e) =>
                  setOffSel(e.currentTarget.value ? Number(e.currentTarget.value) : null)
                }
                data={[
                  { value: "", label: "—" },
                  ...offOptions.map((id) => ({ value: String(id), label: label(id) })),
                ]}
              />
              <NativeSelect
                size="xs"
                label="Entra"
                style={{ flex: 1 }}
                value={onSel ?? ""}
                onChange={(e) =>
                  setOnSel(e.currentTarget.value ? Number(e.currentTarget.value) : null)
                }
                data={[
                  { value: "", label: "—" },
                  ...onOptions.map((id) => ({ value: String(id), label: label(id) })),
                ]}
              />
              <Button size="xs" variant="default" disabled={!canAddSub} onClick={addSub}>
                Adicionar
              </Button>
            </Group>
          )}
        </Stack>

        <Group justify="center">
          <Button onClick={() => onConfirm(toUserTactics(form), subs)}>
            Iniciar segundo tempo
          </Button>
        </Group>
      </Stack>
    </Panel>
  );
}
