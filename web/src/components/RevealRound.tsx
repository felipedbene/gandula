import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { Match } from "../types";
import { findUserDivisionIdxInSeason, type Career, type CupTie } from "../persistence";
import { teamById } from "../teams";
import { revealMinutes } from "../util/prng";
import { COPA_ROUND_AT_LEAGUE_ROUND, userTieInRound } from "../util/copa";
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

  // Is there an animatable cup tie for the user this round? A cup matchday whose
  // round has been played AND the user has a real (non-bye) tie in it. When not,
  // the cup card is the static note (or absent) and the cup gate starts done.
  const userCupTie = useMemo(() => {
    const copa = season.copa;
    const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(revealRound);
    if (cupRoundIdx < 0 || cupRoundIdx >= copa.currentCupRoundIdx) return undefined;
    const tie = userTieInRound(copa, cupRoundIdx, career.controlledTeamId);
    return tie?.match ? tie : undefined;
  }, [season.copa, revealRound, career.controlledTeamId]);

  const [othersRevealed, setOthersRevealed] = useState<boolean[]>(() =>
    new Array(otherWithTiming.length).fill(false),
  );
  const [userDone, setUserDone] = useState(userMatch === undefined);
  // The cup gate: already done when there's no animatable tie this round.
  const [cupDone, setCupDone] = useState(userCupTie === undefined);
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
    if (!doneFiredRef.current && userDone && allOthersDone && cupDone) {
      doneFiredRef.current = true;
      onDone();
    }
  }, [userDone, allOthersDone, cupDone, onDone]);

  const headerText = userMatch
    ? `REVELANDO RODADA ${revealRound + 1} · ${userDiv.name}`
    : `REVELANDO RODADA ${revealRound + 1} · ${userDiv.name} — SEU TIME DESCANSA`;

  const isPlaying = !userDone || !allOthersDone || !cupDone;

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

      <CopaMatchday
        career={career}
        revealRound={revealRound}
        start={userDone}
        skipAll={skipAll}
        onCupDone={() => setCupDone(true)}
      />

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
 * Copa do Brasil card shown when the just-revealed league round was a cup
 * matchday. When the user played a real tie, the match animates tick-by-tick
 * via MatchReveal (sequenced AFTER the league match, gated by `start`), then a
 * shootout beat if it went to penalties, then the AVANÇOU/ELIMINADO verdict.
 * When the user is out / had a bye / the cup is won, it's the static note.
 *
 * `start` flips true once the league pane resolves (so only one match clock
 * runs at a time). `onCupDone` fires once the verdict shows (or immediately on
 * skip), feeding RevealRound's third reveal gate. Pure presentation over the
 * already-simulated `tie.match` / `tie.shootout` — no persistence, F5-safe.
 */
function CopaMatchday({
  career,
  revealRound,
  start,
  skipAll,
  onCupDone,
}: {
  career: Career;
  revealRound: number;
  start: boolean;
  skipAll: boolean;
  onCupDone: () => void;
}) {
  const copa = career.currentSeason.copa;
  const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(revealRound);
  // Only render on a cup matchday whose round has actually been played.
  if (cupRoundIdx < 0 || cupRoundIdx >= copa.currentCupRoundIdx) return null;
  const round = copa.rounds[cupRoundIdx];
  if (!round) return null;

  const tie = userTieInRound(copa, cupRoundIdx, career.controlledTeamId);
  const roundLabel = `Copa do Brasil · ${cupRoundTitle(round.name)}`;

  // No animatable tie (out / bye / champion): the static note. The parent set
  // the cup gate done already, so nothing to fire here.
  if (!tie?.match) {
    return (
      <Panel title={roundLabel}>
        <Text c="dimmed" size="sm">
          {copa.championId !== undefined
            ? `Campeão da Copa: ${teamById(copa.championId)?.name ?? `Time ${copa.championId}`}`
            : "Seu time não está mais na Copa — os jogos seguem sem você."}
        </Text>
      </Panel>
    );
  }

  return (
    <CopaTieReveal
      title={roundLabel}
      tie={tie}
      userId={career.controlledTeamId}
      start={start}
      skipAll={skipAll}
      onCupDone={onCupDone}
    />
  );
}

/**
 * The animated TWO-LEG cup-tie card (E.3.b): a state machine over the
 * already-resolved tie. `leg1` → MatchReveal plays leg 1 (homeId hosts);
 * `leg2` → MatchReveal plays leg 2 (awayId hosts, sides reversed); `shootout` →
 * a brief penalties beat (only if the aggregate + away-goals were level);
 * `verdict` → the aggregate line + AVANÇOU/ELIMINADO, then onCupDone fires.
 */
function CopaTieReveal({
  title,
  tie,
  userId,
  start,
  skipAll,
  onCupDone,
}: {
  title: string;
  tie: CupTie;
  userId: number;
  start: boolean;
  skipAll: boolean;
  onCupDone: () => void;
}) {
  type Phase = "leg1" | "leg2" | "shootout" | "verdict";
  const [phase, setPhase] = useState<Phase>("leg1");
  const cupDoneFiredRef = useRef(false);

  const leg1 = tie.match!;
  const leg2 = tie.leg2; // may be absent on a (defensive) single-leg tie
  const won = tie.winnerId === userId;
  const homeName = teamById(tie.homeId)?.name ?? `Time ${tie.homeId}`;
  const awayName = teamById(tie.awayId)?.name ?? `Time ${tie.awayId}`;
  // Aggregate from homeId's / awayId's perspective (stored on the tie).
  const aggHome = tie.aggHome ?? leg1.result.home_goals + (leg2?.result.away_goals ?? 0);
  const aggAway = tie.aggAway ?? leg1.result.away_goals + (leg2?.result.home_goals ?? 0);

  // Skip jumps straight to the verdict (and fires the gate).
  useEffect(() => {
    if (skipAll) setPhase("verdict");
  }, [skipAll]);

  // The shootout beat: hold briefly on the penalties line, then the verdict.
  useEffect(() => {
    if (phase !== "shootout") return;
    const id = window.setTimeout(() => setPhase("verdict"), HALFTIME_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Fire the cup gate exactly once, when the verdict shows.
  useEffect(() => {
    if (phase === "verdict" && !cupDoneFiredRef.current) {
      cupDoneFiredRef.current = true;
      onCupDone();
    }
  }, [phase, onCupDone]);

  const afterLeg2 = () => setPhase(tie.shootout ? "shootout" : "verdict");
  const animatingLeg1 = start && phase === "leg1" && !skipAll;
  const animatingLeg2 = start && phase === "leg2" && !skipAll && leg2;

  return (
    <Panel title={title}>
      {animatingLeg1 ? (
        <>
          <Text size="xs" c="dimmed" mb={4}>
            Jogo de ida — {homeName} manda
          </Text>
          <MatchReveal
            match={leg1}
            skipAll={skipAll}
            onComplete={() => (leg2 ? setPhase("leg2") : afterLeg2())}
          />
        </>
      ) : animatingLeg2 ? (
        <>
          <Text size="xs" c="dimmed" mb={4}>
            Jogo de volta — {awayName} manda
          </Text>
          <MatchReveal match={leg2} skipAll={skipAll} onComplete={afterLeg2} />
        </>
      ) : (
        // Static summary once both legs are done (or on skip): both legs + agg.
        <Stack gap={2}>
          <LegLine label="Ida" left={homeName} right={awayName} match={leg1} />
          {leg2 && (
            <LegLine label="Volta" left={awayName} right={homeName} match={leg2} />
          )}
          {phase === "verdict" && (
            <Text ta="center" size="sm" ff="monospace" mt={4}>
              Agregado: {homeName} {aggHome} – {aggAway} {awayName}
              {tie.shootout &&
                ` · pênaltis ${tie.shootout.homeGoals}-${tie.shootout.awayGoals}`}
            </Text>
          )}
        </Stack>
      )}
      {phase === "verdict" && (
        <Text ta="center" size="sm" mt={4} fw={700} c={won ? "phosphor.4" : "red.5"}>
          {won ? "AVANÇOU na Copa!" : "ELIMINADO da Copa"}
        </Text>
      )}
    </Panel>
  );
}

/** One leg's score line in the static two-leg summary. `left` hosts. */
function LegLine({
  label,
  left,
  right,
  match,
}: {
  label: string;
  left: string;
  right: string;
  match: Match;
}) {
  return (
    <Box
      style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", alignItems: "center", gap: 8 }}
    >
      <Text size="xs" c="dimmed" style={{ minWidth: 36 }}>
        {label}
      </Text>
      <Text ta="right" size="sm">
        {left}
      </Text>
      <Text px="sm" size="sm" ff="monospace" fw={700}>
        {match.result.home_goals} - {match.result.away_goals}
      </Text>
      <Text ta="left" size="sm">
        {right}
      </Text>
    </Box>
  );
}

function cupRoundTitle(name: string): string {
  switch (name) {
    case "prelim": return "Fase preliminar";
    case "r32": return "Oitavas (32)";
    case "r16": return "Oitavas de final";
    case "qf": return "Quartas de final";
    case "sf": return "Semifinal";
    case "final": return "Final";
    default: return name;
  }
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
