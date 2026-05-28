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
import { resimulateFromRound } from "../util/resimulate";
import { avgStrength } from "../util/divisions";
import { formatMoney } from "../util/money";
import Card from "../srcl/Card";
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
  const baseTeam = teamById(career.controlledTeamId);
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
    if (season.userTactics) {
      return {
        starting_xi: season.userTactics.starting_xi.slice(),
        bench: season.userTactics.bench.slice(),
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
    <>
      <p className="campeonato-header muted">
        PREPARAR · {userDiv.name} · RODADA {userDiv.currentRoundIdx + 1} /{" "}
        {totalRounds} · $ {formatMoney(career.manager.money)}
      </p>

      {isBye ? (
        <ByeCard />
      ) : (
        <NextOpponentCard
          userMatch={userFixture.match}
          controlledTeamId={career.controlledTeamId}
        />
      )}

      <Card title="TÁTICA">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            play();
          }}
        >
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
          {error && <pre className="error">{error}</pre>}
          <div className="form-actions form-actions--pair">
            <button type="submit" className="btn">
              [ JOGAR ]
            </button>
            <button type="button" className="btn" onClick={onBack}>
              [ VOLTAR ]
            </button>
          </div>
        </form>
      </Card>
    </>
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
  const userTeam = teamById(controlledTeamId);
  const opponentId = isUserHome ? userMatch.away : userMatch.home;
  const opponentTeam = teamById(opponentId);

  const userName = userTeam?.name ?? `Time ${controlledTeamId}`;
  const opponentName = opponentTeam?.name ?? `Time ${opponentId}`;
  const userVenue = isUserHome ? "(CASA)" : "(FORA)";
  const opponentVenue = isUserHome ? "(FORA)" : "(CASA)";

  const userStrength = userTeam ? avgStrength(userTeam) : 0;
  const opponentStrength = opponentTeam ? avgStrength(opponentTeam) : 0;

  return (
    <Card title="PRÓXIMO JOGO">
      <pre className="next-opponent">
        {`${userName.padEnd(28)}${userVenue}\n`}
        {`× ${opponentName.padEnd(26)}${opponentVenue}\n`}
        {`\n`}
        {`FORÇA MED: ${String(userStrength).padStart(3)}    ×    ${String(opponentStrength).padStart(3)}`}
      </pre>
    </Card>
  );
}

function ByeCard() {
  return (
    <Card title="SEM JOGO">
      <p>Seu time descansa nesta rodada.</p>
      <p className="muted">
        Mudanças de tática aplicam às próximas rodadas onde seu time joga.
      </p>
    </Card>
  );
}
