import { Group, Progress, Stack, Text } from "@mantine/core";

/**
 * Aggregate, RNG-free projection indicators shared by the pre-match prep and
 * the half-time panel: expected possession split + per-side pressure bars.
 * Deliberately shows NO projected score — only expected shape. Values are
 * already oriented to the user's perspective by the caller.
 */
export function ProjectionIndicators({
  userPossession,
  userPressure,
  oppPressure,
  userName,
  oppName,
}: {
  /** User's expected possession share, 0..=1 (opponent's is 1 − this). */
  userPossession: number;
  /** Expected shots/min for each side (magnitude; normalized to bars here). */
  userPressure: number;
  oppPressure: number;
  userName: string;
  oppName: string;
}) {
  // Bars are relative to the larger pressure, so they're comparable without
  // exposing the raw per-minute rate.
  const maxPressure = Math.max(userPressure, oppPressure, 1e-9);
  const userBar = Math.round((userPressure / maxPressure) * 100);
  const oppBar = Math.round((oppPressure / maxPressure) * 100);
  const userPct = Math.round(userPossession * 100);

  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Posse projetada
        </Text>
        <Text size="sm" ff="monospace">
          {userPct}% × {100 - userPct}%
        </Text>
      </Group>
      <Progress value={userPct} color="accent" size="lg" />

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
  );
}
