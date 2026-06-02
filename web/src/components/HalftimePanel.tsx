import { useMemo, useState } from "react";
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { project_second_half_js } from "../wasm/gandula_wasm.js";
import type { Team } from "../types";
import type { UserTactics } from "../persistence";
import { applyUserTactics, applyRivalHalftime } from "../util/resimulate";
import { Panel } from "./ui/Panel";
import { TeamCrest } from "./ui/TeamCrest";
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
  /** Confirm: pass the chosen half-time UserTactics, or null if unchanged. */
  onConfirm: (halftime: UserTactics | null) => void;
};

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

  const toUserTactics = (s: TacticsFormState): UserTactics => {
    const { formation, tactics } = tacticsFormStateToOverride(s);
    return { formation, tactics, starting_xi: startingXi, bench };
  };

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

  // Normalize the two pressures into bar widths relative to the larger one, so
  // the bars are comparable without exposing the raw per-minute rate.
  const maxPressure = Math.max(userPressure, oppPressure, 1e-9);
  const userBar = Math.round((userPressure / maxPressure) * 100);
  const oppBar = Math.round((oppPressure / maxPressure) * 100);

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
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Posse projetada
            </Text>
            <Text size="sm" ff="monospace">
              {Math.round(userPoss * 100)}% × {Math.round((1 - userPoss) * 100)}%
            </Text>
          </Group>
          <Progress value={Math.round(userPoss * 100)} color="accent" size="lg" />

          <Group justify="space-between" mt={4}>
            <Text size="sm" c="dimmed">
              Pressão {userName}
            </Text>
          </Group>
          <Progress value={userBar} color="accent" size="md" />
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Pressão {oppName}
            </Text>
          </Group>
          <Progress value={oppBar} color="red" size="md" />
        </Stack>

        <Group justify="center">
          <Button onClick={() => onConfirm(toUserTactics(form))}>
            Iniciar segundo tempo
          </Button>
        </Group>
      </Stack>
    </Panel>
  );
}
