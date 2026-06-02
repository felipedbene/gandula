import { useMemo, useState } from "react";
import type {
  Formation,
  Match,
  Mentality,
  Pressing,
  Tempo,
  Width,
} from "../types";
import {
  findUserDivisionIdxInSeason,
  totalRoundsOf,
  type Career,
  type UserTactics,
} from "../persistence";
import { teamById } from "../teams";
import { userTeam } from "../util/roster";
import { resimulateFromRound } from "../util/resimulate";
import {
  COPA_ROUND_AT_LEAGUE_ROUND,
  userTieInRound,
} from "../util/copa";
import { avgStrength } from "../util/divisions";
import { formatMoney } from "../util/money";
import { Button, Group, Stack, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";
import { TeamCrest } from "./ui/TeamCrest";
import TacticsForm, {
  type TacticsFormState,
  tacticsFormStateEquals,
  tacticsFormStateToOverride,
} from "./TacticsForm";
import LineupEditor, {
  type LineupState,
  lineupStateEquals,
} from "./LineupEditor";
import BenchEditor from "./BenchEditor";
import { countUserMatchesFromRound } from "./TacticsView";

type PrepareViewProps = {
  career: Career;
  /** User clicked [ JOGAR ]. Parent receives the (possibly re-simulated)
   *  new Career and transitions to revealing. */
  onPlay: (newCareer: Career, resimMs: number, resimCount: number) => void;
  /** User clicked [ VOLTAR ]. Parent transitions to running without
   *  persisting anything; pending dropdown changes are lost. */
  onBack: () => void;
};

/**
 * Intermediate screen between [ AVANÇAR RODADA ] (running phase) and the
 * round reveal. Shows the next opponent (or "SEM JOGO" for bye rounds)
 * in the user's division, plus the tactical form. Re-simulation on JOGAR
 * runs only when the form is dirty; clean JOGAR forwards the original
 * career through to the reveal so the user doesn't eat the ~160ms freeze
 * when they just want to play with the current tactics.
 *
 * State ownership: this view owns the TacticsFormState + LineupState. All
 * form subcomponents are pure-controlled.
 */
export default function PrepareView({ career, onPlay, onBack }: PrepareViewProps) {
  // userTeam returns the registry default when career.userRoster is
  // empty (no transfers yet), or the custom roster when E.1.e.2 has
  // mutated it. Either way, downstream readers (LineupEditor,
  // BenchEditor, resimulate) see the user's effective roster.
  const baseTeam = userTeam(career);
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];

  const initial: TacticsFormState = useMemo(() => {
    if (season.userTactics) {
      return {
        formation: season.userTactics.formation,
        mentality: season.userTactics.tactics.mentality,
        tempo: season.userTactics.tactics.tempo,
        pressing: season.userTactics.tactics.pressing,
        width: season.userTactics.tactics.width,
      };
    }
    return {
      formation: baseTeam?.formation ?? ("F442" as Formation),
      mentality: baseTeam?.tactics.mentality ?? ("Balanced" as Mentality),
      tempo: baseTeam?.tactics.tempo ?? ("Normal" as Tempo),
      pressing: baseTeam?.tactics.pressing ?? ("Medium" as Pressing),
      width: baseTeam?.tactics.width ?? ("Normal" as Width),
    };
  }, [season.userTactics, baseTeam]);

  const initialLineup: LineupState = useMemo(() => {
    // Keep only bench ids still in the roster — a player sold while a
    // userTactics overlay existed can leave a phantom id that would render
    // as "Player <id>" in the bench editor. (baseTeam.bench is already
    // reconciled by userTeam.)
    const rosterIds = new Set((baseTeam?.roster ?? []).map((p) => p.id));
    if (season.userTactics) {
      return {
        starting_xi: season.userTactics.starting_xi.slice(),
        bench: season.userTactics.bench.filter((id) => rosterIds.has(id)),
      };
    }
    return {
      starting_xi: baseTeam?.starting_xi.slice() ?? [],
      bench: baseTeam?.bench?.slice() ?? [],
    };
  }, [season.userTactics, baseTeam]);

  const [current, setCurrent] = useState<TacticsFormState>(initial);
  const [currentLineup, setCurrentLineup] = useState<LineupState>(initialLineup);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    !tacticsFormStateEquals(initial, current) ||
    !lineupStateEquals(initialLineup, currentLineup);

  // User's fixture in the current round of their division (null on bye
  // rounds — Série B has 9 teams, so engine inserts 2 byes per team per
  // season via the virtual BYE position).
  const userFixture = useMemo(() => {
    const fixtures = userDiv.record.fixtures;
    const matches = userDiv.record.matches;
    for (let i = 0; i < fixtures.length; i++) {
      if (fixtures[i].round !== userDiv.currentRoundIdx) continue;
      const m = matches[i];
      if (
        m.home === career.controlledTeamId ||
        m.away === career.controlledTeamId
      ) {
        return { fixtureIdx: i, match: m };
      }
    }
    return null;
  }, [userDiv, career.controlledTeamId]);

  const isBye = userFixture === null;

  function play() {
    if (!baseTeam) {
      setError("Time controlado não encontrado.");
      return;
    }
    if (!dirty) {
      // No tactical change — skip re-simulation, hand the original career
      // through. resimMs=0 / resimCount=0 signals "nothing re-simulated"
      // to the parent's status line logic.
      onPlay(career, 0, 0);
      return;
    }
    const { formation, tactics } = tacticsFormStateToOverride(current);
    const override: UserTactics = {
      formation,
      tactics,
      starting_xi: currentLineup.starting_xi.slice(),
      bench: currentLineup.bench.slice(),
    };
    try {
      const start = performance.now();
      const newCareer = resimulateFromRound(career, userDiv.currentRoundIdx, override);
      const ms = Math.round(performance.now() - start);
      const resimCount = countUserMatchesFromRound(career, userDiv.currentRoundIdx);
      onPlay(newCareer, ms, resimCount);
    } catch (e) {
      setError(String(e));
    }
  }

  const totalRounds = totalRoundsOf(userDiv);

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        PREPARAR · {userDiv.name} · RODADA {userDiv.currentRoundIdx + 1} /{" "}
        {totalRounds} · $ {formatMoney(career.manager.money)}
      </Text>

      {isBye ? (
        <ByeCard />
      ) : (
        <NextOpponentCard
          userMatch={userFixture.match}
          controlledTeamId={career.controlledTeamId}
        />
      )}

      <CopaBanner career={career} round={userDiv.currentRoundIdx} />

      <Panel title="Tática">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            play();
          }}
        >
          <Stack gap="md">
            <TacticsForm state={current} onChange={setCurrent} />
            {baseTeam && (
              <>
                <LineupEditor
                  team={baseTeam}
                  state={currentLineup}
                  onChange={setCurrentLineup}
                />
                <BenchEditor
                  team={baseTeam}
                  state={currentLineup}
                  onChange={setCurrentLineup}
                />
              </>
            )}
            {error && (
              <Text c="red" style={{ whiteSpace: "pre-wrap" }}>
                {error}
              </Text>
            )}
            <Group justify="center" gap="sm">
              <Button type="submit">Jogar</Button>
              <Button type="button" variant="default" onClick={onBack}>
                Voltar
              </Button>
            </Group>
          </Stack>
        </form>
      </Panel>
    </Stack>
  );
}

function NextOpponentCard({
  userMatch,
  controlledTeamId,
}: {
  userMatch: Match;
  controlledTeamId: number;
}) {
  const isUserHome = userMatch.home === controlledTeamId;
  // `controlledTeam` (not `userTeam`) avoids shadowing the imported
  // userTeam(career) helper at module scope. NextOpponentCard doesn't
  // see Career — it just gets the id — so registry teamById is the
  // right lookup here; transfer-market roster mutations don't affect
  // the opponent or the team-name strength display.
  const controlledTeam = teamById(controlledTeamId);
  const opponentId = isUserHome ? userMatch.away : userMatch.home;
  const opponentTeam = teamById(opponentId);

  const userName = controlledTeam?.name ?? `Time ${controlledTeamId}`;
  const opponentName = opponentTeam?.name ?? `Time ${opponentId}`;
  const userVenue = isUserHome ? "(CASA)" : "(FORA)";
  const opponentVenue = isUserHome ? "(FORA)" : "(CASA)";

  const userStrength = controlledTeam ? avgStrength(controlledTeam) : 0;
  const opponentStrength = opponentTeam ? avgStrength(opponentTeam) : 0;

  return (
    <Panel title="Próximo jogo">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <TeamCrest name={userName} size={22} />
            <Text size="sm" truncate>
              {userName}{" "}
              <Text span c="dimmed">
                {userVenue}
              </Text>
            </Text>
          </Group>
          <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
            Força {userStrength}
          </Text>
        </Group>
        <Text c="dimmed" ta="center">
          ×
        </Text>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <TeamCrest name={opponentName} size={22} />
            <Text size="sm" truncate>
              {opponentName}{" "}
              <Text span c="dimmed">
                {opponentVenue}
              </Text>
            </Text>
          </Group>
          <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
            Força {opponentStrength}
          </Text>
        </Group>
      </Stack>
    </Panel>
  );
}

function ByeCard() {
  return (
    <Panel title="Sem jogo">
      <Stack gap={4}>
        <Text>Seu time descansa nesta rodada.</Text>
        <Text c="dimmed" size="sm">
          Mudanças de tática aplicam às próximas rodadas onde seu time joga.
        </Text>
      </Stack>
    </Panel>
  );
}

// Copa do Brasil banner: shown when this matchday also hosts the user's cup
// tie (so the tactics they set here apply to the cup tie too). Hidden if this
// round isn't a cup matchday or the user is already out.
function CopaBanner({ career, round }: { career: Career; round: number }) {
  const copa = career.currentSeason.copa;
  const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(round);
  // Only on a cup matchday that hasn't been played yet.
  if (cupRoundIdx < 0 || cupRoundIdx !== copa.currentCupRoundIdx) return null;
  const tie = userTieInRound(copa, cupRoundIdx, career.controlledTeamId);
  if (!tie) {
    if (copa.userEliminatedAtRoundIdx !== undefined) {
      return (
        <Panel title="Copa do Brasil">
          <Text c="dimmed" size="sm">
            Seu time já foi eliminado da Copa.
          </Text>
        </Panel>
      );
    }
    return null;
  }
  const oppId = tie.homeId === career.controlledTeamId ? tie.awayId : tie.homeId;
  const oppName = teamById(oppId)?.name ?? `Time ${oppId}`;
  return (
    <Panel title="Copa do Brasil">
      <Text c="accent.4" fw={600}>
        Jogo da Copa nesta rodada — vs {oppName}
      </Text>
      <Text c="dimmed" size="sm">
        Mata-mata: empate é decidido nos pênaltis. Sua tática vale para os dois jogos.
      </Text>
    </Panel>
  );
}
