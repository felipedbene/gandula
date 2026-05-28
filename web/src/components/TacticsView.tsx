import { useMemo, useState } from "react";
import type {
  Formation,
  Mentality,
  Pressing,
  Tempo,
  Width,
} from "../types";
import {
  findUserDivisionIdxInSeason,
  type Career,
  type UserTactics,
} from "../persistence";
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

type TacticsViewProps = {
  career: Career;
  /** Called when re-simulation is applied. Parent persists the new career
   *  and transitions back to running. Receives the new Career plus
   *  informational counters for the status line. */
  onApply: (newCareer: Career, resimMs: number, resimCount: number) => void;
  /** Called when user backs out without changes (or cancels). Parent
   *  transitions back to running without persisting anything. */
  onBack: () => void;
};

/**
 * Tactical configuration screen accessible via the quick-menu [ TÁTICA ]
 * button on the running phase. Re-simulates from `currentRoundIdx` onward
 * when the user applies changes.
 *
 * State ownership: this view owns the `TacticsFormState`. The form
 * subcomponent is pure-controlled — see TacticsForm.tsx.
 */
export default function TacticsView({ career, onApply, onBack }: TacticsViewProps) {
  const baseTeam = teamById(career.controlledTeamId);
  const teamName = baseTeam?.name ?? `Time ${career.controlledTeamId}`;
  const season = career.currentSeason;

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

  function apply() {
    if (!baseTeam) {
      setError("Time controlado não encontrado.");
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
      const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
      const userDiv = season.divisions[userDivIdx];
      const fromRound = userDiv.currentRoundIdx;
      const start = performance.now();
      const newCareer = resimulateFromRound(career, fromRound, override);
      const ms = Math.round(performance.now() - start);
      const resimCount = countUserMatchesFromRound(career, fromRound);
      onApply(newCareer, ms, resimCount);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Card title={`TÁTICA · ${teamName.toUpperCase()}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) apply();
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
          <button type="submit" className="btn" disabled={!dirty}>
            [ APLICAR ]
          </button>
          <button type="button" className="btn" onClick={onBack}>
            [ VOLTAR ]
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Count user-involving fixtures at or after `fromRoundIdx` within the
 * user's division. Exposed so PrepareView and TacticsView report the same
 * number in their status lines without duplicating the loop.
 */
export function countUserMatchesFromRound(
  career: Career,
  fromRoundIdx: number,
): number {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  return userDiv.record.fixtures.reduce((acc, f, i) => {
    if (f.round < fromRoundIdx) return acc;
    const m = userDiv.record.matches[i];
    const involves =
      m.home === career.controlledTeamId || m.away === career.controlledTeamId;
    return acc + (involves ? 1 : 0);
  }, 0);
}
