import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { Match } from "../types";
import { findUserDivisionIdxInSeason, type Career } from "../persistence";
import { teamById } from "../teams";
import { revealMinutes } from "../util/prng";
import { Panel } from "./ui/Panel";
import MatchReveal, {
  HALFTIME_PAUSE_MS,
  REVEAL_MS_PER_MIN,
  useMatchClock,
} from "./MatchReveal";

type RevealRoundProps = {
  career: Career;
  /** Fires once when the user's match reveal and all parallel matches have
   *  completed (or PULAR was clicked). Parent transitions back to running. */
  onDone: () => void;
};

type OtherMatch = {
  index: number;          // index into userDiv.record.matches/fixtures
  match: Match;
  homeName: string;
  awayName: string;
  revealAtMinute: number;
};

/**
 * Orchestrates the AVANÇAR reveal: user's match (if any) plays tick-by-tick
 * via MatchReveal, the other matches in the user's division reveal final
 * scores at deterministic wall-clock moments seeded off the division seed
 * XOR round.
 *
 * Persistence note: by the time this component mounts, both divisions have
 * already been incremented by SeasonView.playRound. The round we're
 * revealing is therefore `userDiv.currentRoundIdx - 1`. F5 mid-reveal
 * autoloads straight back into `running` — animation is lost, save intact.
 *
 * Bye-round path: Série B is N=9 odd, so the engine schedules a virtual
 * BYE for one team per round; if that team is the user, the user match
 * pane is omitted and the header says "SEU TIME DESCANSA". Série A is
 * N=8 even, no byes — user is always playing there.
 */
export default function RevealRound({ career, onDone }: RevealRoundProps) {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const divSeed = season.seed ^ BigInt(userDiv.tier);
  const revealRound = userDiv.currentRoundIdx - 1;

  const { userMatch, others } = useMemo(() => {
    const fixtures = userDiv.record.fixtures;
    const matches = userDiv.record.matches;
    const rows: { idx: number; match: Match; homeName: string; awayName: string; isUser: boolean }[] = [];
    fixtures.forEach((f, i) => {
      if (f.round !== revealRound) return;
      const m = matches[i];
      if (!m) return;
      rows.push({
        idx: i,
        match: m,
        homeName: teamById(m.home)?.name ?? `Time ${m.home}`,
        awayName: teamById(m.away)?.name ?? `Time ${m.away}`,
        isUser:
          m.home === career.controlledTeamId ||
          m.away === career.controlledTeamId,
      });
    });
    const userRow = rows.find((r) => r.isUser);
    const otherRows = rows.filter((r) => !r.isUser);
    return { userMatch: userRow, others: otherRows };
  }, [userDiv, career.controlledTeamId, revealRound]);

  const otherWithTiming: OtherMatch[] = useMemo(() => {
    const minutes = revealMinutes(divSeed, revealRound, others.length);
    return others.map((r, i) => ({
      index: r.idx,
      match: r.match,
      homeName: r.homeName,
      awayName: r.awayName,
      revealAtMinute: minutes[i],
    }));
  }, [divSeed, revealRound, others]);

  const [othersRevealed, setOthersRevealed] = useState<boolean[]>(() =>
    new Array(otherWithTiming.length).fill(false),
  );
  const [userDone, setUserDone] = useState(userMatch === undefined);
  const [skipAll, setSkipAll] = useState(false);
  const doneFiredRef = useRef(false);

  useEffect(() => {
    const timers = otherWithTiming.map((om, i) => {
      const delay =
        om.revealAtMinute * REVEAL_MS_PER_MIN +
        (om.revealAtMinute > 45 ? HALFTIME_PAUSE_MS : 0);
      return window.setTimeout(() => {
        setOthersRevealed((prev) => {
          if (prev[i]) return prev;
          const next = prev.slice();
          next[i] = true;
          return next;
        });
      }, delay);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [otherWithTiming]);

  useEffect(() => {
    if (!skipAll) return;
    setOthersRevealed(new Array(otherWithTiming.length).fill(true));
    if (userMatch === undefined) {
      setUserDone(true);
    }
  }, [skipAll, otherWithTiming.length, userMatch]);

  const allOthersDone =
    otherWithTiming.length === 0 || othersRevealed.every((b) => b);

  useEffect(() => {
    if (!doneFiredRef.current && userDone && allOthersDone) {
      doneFiredRef.current = true;
      onDone();
    }
  }, [userDone, allOthersDone, onDone]);

  const headerText = userMatch
    ? `REVELANDO RODADA ${revealRound + 1} · ${userDiv.name}`
    : `REVELANDO RODADA ${revealRound + 1} · ${userDiv.name} — SEU TIME DESCANSA`;

  const isPlaying = !userDone || !allOthersDone;

  // On a bye round there's no MatchReveal (and thus no clock), so run a
  // standalone matchday clock here — it ticks while the other games reveal.
  const isBye = userMatch === undefined;
  const byeClock = useMatchClock(90, skipAll, revealRound, isBye);

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        {headerText}
      </Text>

      {userMatch ? (
        <MatchReveal
          match={userMatch.match}
          onComplete={() => setUserDone(true)}
          skipAll={skipAll}
        />
      ) : (
        <Card withBorder radius="md" padding="md">
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed">Seu time descansa nesta rodada.</Text>
            <Badge variant="outline" color="phosphor" radius="xl">
              {byeClock}'
            </Badge>
          </Group>
        </Card>
      )}

      <Panel title="Outros jogos">
        {otherWithTiming.length === 0 ? (
          <Text c="dimmed">Nenhum outro jogo nesta rodada.</Text>
        ) : (
          <Stack gap={4}>
            {otherWithTiming.map((om, i) => (
              <OtherMatchRow
                key={om.index}
                match={om.match}
                homeName={om.homeName}
                awayName={om.awayName}
                revealed={othersRevealed[i]}
              />
            ))}
          </Stack>
        )}
      </Panel>

      {isPlaying && (
        <Group justify="center">
          <Button variant="default" onClick={() => setSkipAll(true)}>
            Pular
          </Button>
        </Group>
      )}
    </Stack>
  );
}

/**
 * One row in the OUTROS JOGOS list: home (right) · score/pending (center) ·
 * away (left). A 3-column grid keeps the score column centered regardless of
 * team-name length.
 */
function OtherMatchRow({
  match,
  homeName,
  awayName,
  revealed,
}: {
  match: Match;
  homeName: string;
  awayName: string;
  revealed: boolean;
}) {
  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
      }}
    >
      <Text ta="right" size="sm">
        {homeName}
      </Text>
      <Text
        px="md"
        size="sm"
        ff="monospace"
        fw={revealed ? 700 : 400}
        c={revealed ? undefined : "dimmed"}
      >
        {revealed
          ? `${match.result.home_goals} - ${match.result.away_goals}`
          : "×"}
      </Text>
      <Text ta="left" size="sm">
        {awayName}
      </Text>
    </Box>
  );
}
