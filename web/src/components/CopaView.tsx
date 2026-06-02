import { Box, Button, Group, Stack, Text } from "@mantine/core";
import type { Career, CupRound, CupTie } from "../persistence";
import { teamById } from "../teams";
import { Panel } from "./ui/Panel";

const ROUND_TITLE: Record<string, string> = {
  prelim: "Fase preliminar",
  r32: "Rodada de 32",
  r16: "Oitavas",
  qf: "Quartas",
  sf: "Semifinal",
  final: "Final",
};

/**
 * Read-only Copa do Brasil bracket view (a peek, like viewOtherDivision).
 * Renders each drawn round as a list of ties with scores, shootout markers,
 * and winners, highlighting the user's club throughout.
 */
export default function CopaView({
  career,
  onBack,
}: {
  career: Career;
  onBack: () => void;
}) {
  const copa = career.currentSeason.copa;
  const userId = career.controlledTeamId;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        COPA DO BRASIL · {career.currentSeason.year}
        {copa.championId !== undefined &&
          ` · Campeão: ${teamById(copa.championId)?.name ?? `Time ${copa.championId}`}`}
      </Text>

      {copa.rounds.map((round, i) => (
        <RoundPanel
          key={round.name}
          round={round}
          userId={userId}
          played={i < copa.currentCupRoundIdx}
        />
      ))}

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
}

function RoundPanel({
  round,
  userId,
  played,
}: {
  round: CupRound;
  userId: number;
  played: boolean;
}) {
  const real = round.ties.filter((t) => !t.bye);
  const byes = round.ties.filter((t) => t.bye);
  return (
    <Panel title={`${ROUND_TITLE[round.name] ?? round.name}${played ? "" : " · a disputar"}`}>
      <Stack gap={2}>
        {real.map((tie, i) => (
          <TieRow key={i} tie={tie} userId={userId} />
        ))}
        {byes.length > 0 && (
          <Text c="dimmed" size="xs" mt={4}>
            Bye: {byes.map((t) => teamById(t.homeId)?.name ?? t.homeId).join(", ")}
          </Text>
        )}
      </Stack>
    </Panel>
  );
}

function TieRow({ tie, userId }: { tie: CupTie; userId: number }) {
  const homeName = teamById(tie.homeId)?.name ?? `Time ${tie.homeId}`;
  const awayName = teamById(tie.awayId)?.name ?? `Time ${tie.awayId}`;
  const isUser = tie.homeId === userId || tie.awayId === userId;
  const score = tie.match
    ? `${tie.match.result.home_goals}-${tie.match.result.away_goals}` +
      (tie.shootout ? ` (${tie.shootout.homeGoals}-${tie.shootout.awayGoals}p)` : "")
    : "×";
  const homeWon = tie.winnerId === tie.homeId;
  const awayWon = tie.winnerId === tie.awayId;
  return (
    <Box
      style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}
    >
      <Text ta="right" size="sm" fw={homeWon ? 700 : 400} c={isUser ? "accent.3" : undefined}>
        {homeName}
      </Text>
      <Text px="md" size="sm" ff="monospace" c={tie.played ? undefined : "dimmed"}>
        {score}
      </Text>
      <Text ta="left" size="sm" fw={awayWon ? 700 : 400} c={isUser ? "accent.3" : undefined}>
        {awayName}
      </Text>
    </Box>
  );
}
