import { useMemo, useState } from "react";
import type {
  Formation,
  Match,
  Mentality,
  Pressing,
  Team,
  Tempo,
  Width,
} from "../types";
import type { SavedSeason, UserTactics } from "../persistence";
import { teamById } from "../teams";
import { resimulateFromRound } from "../util/resimulate";
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
  saved: SavedSeason;
  /** User clicked [ JOGAR ]. Parent receives the (possibly re-simulated)
   *  new SavedSeason and transitions to revealing. */
  onPlay: (newSaved: SavedSeason, resimMs: number, resimCount: number) => void;
  /** User clicked [ VOLTAR ]. Parent transitions to running without
   *  persisting anything; pending dropdown changes are lost. */
  onBack: () => void;
};

/**
 * Intermediate screen between [ AVANÇAR RODADA ] (running phase) and the
 * round reveal. Shows the next opponent (or "SEM JOGO" for bye rounds)
 * plus the tactical form.
 *
 * JOGAR behavior:
 *   - If the user changed tactics → re-simulate, then transition
 *   - If unchanged → forward the original save through, skip the ~160ms
 *     re-simulation freeze (clean JOGAR is the explicit "play with what
 *     I have" path)
 *
 * State ownership: this view owns the TacticsFormState (current). The
 * form subcomponent is pure-controlled.
 */
export default function PrepareView({ saved, onPlay, onBack }: PrepareViewProps) {
  const baseTeam = teamById(saved.controlledTeamId);

  const initial: TacticsFormState = useMemo(() => {
    if (saved.userTactics) {
      return {
        formation: saved.userTactics.formation,
        mentality: saved.userTactics.tactics.mentality,
        tempo: saved.userTactics.tactics.tempo,
        pressing: saved.userTactics.tactics.pressing,
        width: saved.userTactics.tactics.width,
      };
    }
    return {
      formation: baseTeam?.formation ?? ("F442" as Formation),
      mentality: baseTeam?.tactics.mentality ?? ("Balanced" as Mentality),
      tempo: baseTeam?.tactics.tempo ?? ("Normal" as Tempo),
      pressing: baseTeam?.tactics.pressing ?? ("Medium" as Pressing),
      width: baseTeam?.tactics.width ?? ("Normal" as Width),
    };
  }, [saved.userTactics, baseTeam]);

  const initialLineup: LineupState = useMemo(() => {
    if (saved.userTactics) {
      return {
        starting_xi: saved.userTactics.starting_xi.slice(),
        bench: saved.userTactics.bench.slice(),
      };
    }
    return {
      starting_xi: baseTeam?.starting_xi.slice() ?? [],
      bench: baseTeam?.bench?.slice() ?? [],
    };
  }, [saved.userTactics, baseTeam]);

  const [current, setCurrent] = useState<TacticsFormState>(initial);
  const [currentLineup, setCurrentLineup] = useState<LineupState>(initialLineup);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    !tacticsFormStateEquals(initial, current) ||
    !lineupStateEquals(initialLineup, currentLineup);

  // User's fixture in the current round (null on bye rounds — 17-team
  // odd-N schedule gives every team 2 byes per season).
  const userFixture = useMemo(() => {
    const fixtures = saved.record.fixtures;
    const matches = saved.record.matches;
    for (let i = 0; i < fixtures.length; i++) {
      if (fixtures[i].round !== saved.currentRoundIdx) continue;
      const m = matches[i];
      if (m.home === saved.controlledTeamId || m.away === saved.controlledTeamId) {
        return { fixtureIdx: i, match: m };
      }
    }
    return null;
  }, [saved]);

  const isBye = userFixture === null;

  function play() {
    if (!baseTeam) {
      setError("Time controlado não encontrado.");
      return;
    }
    if (!dirty) {
      // No tactical change — skip re-simulation, hand the original save
      // through. resimMs=0 / resimCount=0 signals "nothing re-simulated"
      // to the parent's status line logic.
      onPlay(saved, 0, 0);
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
      const newSaved = resimulateFromRound(saved, saved.currentRoundIdx, override);
      const ms = Math.round(performance.now() - start);
      const resimCount = countUserMatchesFromRound(saved, saved.currentRoundIdx);
      onPlay(newSaved, ms, resimCount);
    } catch (e) {
      setError(String(e));
    }
  }

  const totalRounds =
    saved.record.fixtures.length === 0
      ? 0
      : Math.max(...saved.record.fixtures.map((f) => f.round)) + 1;

  return (
    <>
      <p className="campeonato-header muted">
        PREPARAR · RODADA {saved.currentRoundIdx + 1} / {totalRounds}
      </p>

      {isBye ? (
        <ByeCard />
      ) : (
        <NextOpponentCard
          userMatch={userFixture.match}
          controlledTeamId={saved.controlledTeamId}
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

/** Mirror of MatchView's avgStrength (deleted along with MatchView in
 *  0f1ea72). Inlined here pending a util/team-stats extraction when a
 *  third caller appears. Per-player overall is the mean of 6 attributes;
 *  the team's overall is the mean across the 11 starters, rounded. */
function avgStrength(team: Team): number {
  const starters = team.starting_xi
    .map((id) => team.roster.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  if (starters.length === 0) return 0;
  const sum = starters.reduce((acc, p) => {
    const a = p.attributes;
    return (
      acc +
      (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
        6
    );
  }, 0);
  return Math.round(sum / starters.length);
}
