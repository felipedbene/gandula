import { Group, Stack, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";
import { objectivesFor, userPositionIn, type ObjectiveStatus } from "../util/objectives";
import type { TeamStats } from "../types";

/** Status → glyph + colour, matching the match-feed/scout colour language
 *  (accent blue = good, yellow = watch, red = danger). */
function statusStyle(s: ObjectiveStatus): { glyph: string; color: string } {
  switch (s) {
    case "met":
      return { glyph: "★", color: "accent.4" };
    case "onTrack":
      return { glyph: "▸", color: "accent.4" };
    case "atRisk":
      return { glyph: "!", color: "yellow.5" };
    case "missed":
      return { glyph: "×", color: "red.5" };
  }
}

/**
 * E.5.b — the career objectives panel for the running season. Reads the user's
 * live standings (already computed by the caller) and renders the tier-aware
 * goal ladder, so the player sees promotion/title as explicit goals with
 * current progress. Pure presentation over `objectivesFor`.
 */
export function Objectives({
  tier,
  standings,
  teamId,
}: {
  tier: 1 | 2 | 3;
  standings: TeamStats[];
  teamId: number;
}) {
  const position = userPositionIn(standings, teamId);
  const goals = objectivesFor(tier, position, standings.length, standings, teamId);

  return (
    <Panel title="Objetivos da carreira">
      <Stack gap={6}>
        {goals.map((g, i) => {
          const { glyph, color } = statusStyle(g.status);
          return (
            <Group key={i} gap="xs" wrap="nowrap" align="baseline">
              <Text span w={14} ta="center" c={color} fw={700}>
                {glyph}
              </Text>
              <Text
                span
                size="sm"
                fw={g.primary ? 700 : 500}
                c={g.primary ? undefined : "gray.4"}
                style={{ minWidth: 180 }}
              >
                {g.label}
              </Text>
              <Text span size="sm" c={color === "accent.4" ? "dimmed" : color}>
                {g.detail}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Panel>
  );
}
