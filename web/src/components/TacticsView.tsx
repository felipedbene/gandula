import { useMemo, useState } from "react";
import type {
  Formation,
  Mentality,
  Pressing,
  Tempo,
  Width,
} from "../types";
import type { SavedSeason, UserTactics } from "../persistence";
import { teamById } from "../teams";
import { resimulateFromRound } from "../util/resimulate";
import Card from "../srcl/Card";

type TacticsViewProps = {
  saved: SavedSeason;
  /** Called when re-simulation is applied. Parent persists the new save
   *  and transitions back to running. Receives the new SavedSeason plus
   *  informational counters for the status line. */
  onApply: (newSaved: SavedSeason, resimMs: number, resimCount: number) => void;
  /** Called when user backs out without changes (or cancels). Parent
   *  transitions back to running without persisting anything. */
  onBack: () => void;
};

/**
 * Tactical configuration screen. Five enum dropdowns the engine consumes
 * via Team.formation + Team.tactics: formation, mentality, tempo, pressing,
 * width. starting_xi and bench come from the base team here — D.1.e/f will
 * let the user customize those too.
 *
 * Lifecycle:
 *   1. Mount → initial dropdown values from saved.userTactics if defined,
 *      otherwise from the JSON team via teamById().
 *   2. User changes any dropdown → component-local state updates, dirty
 *      check enables [ APLICAR ].
 *   3. Click APLICAR → resimulateFromRound() runs synchronously (~160ms
 *      worst case), result handed to parent via onApply.
 *   4. Click VOLTAR → onBack() with no persistence.
 */
export default function TacticsView({ saved, onApply, onBack }: TacticsViewProps) {
  const baseTeam = teamById(saved.controlledTeamId);
  const teamName = baseTeam?.name ?? `Time ${saved.controlledTeamId}`;

  // Initial state: prefer userTactics overrides if defined, fall back to
  // the team's defaults from the JSON registry. Both paths produce all five
  // fields; the type guarantees it for userTactics, and team JSON always
  // populates formation + tactics.
  const initial = useMemo(() => {
    if (saved.userTactics) {
      return {
        formation: saved.userTactics.formation,
        tactics: saved.userTactics.tactics,
      };
    }
    return {
      formation: baseTeam?.formation ?? ("F442" as Formation),
      tactics: baseTeam?.tactics ?? {
        mentality: "Balanced" as Mentality,
        tempo: "Normal" as Tempo,
        pressing: "Medium" as Pressing,
        width: "Normal" as Width,
      },
    };
  }, [saved.userTactics, baseTeam]);

  const [formation, setFormation] = useState<Formation>(initial.formation);
  const [mentality, setMentality] = useState<Mentality>(initial.tactics.mentality);
  const [tempo, setTempo] = useState<Tempo>(initial.tactics.tempo);
  const [pressing, setPressing] = useState<Pressing>(initial.tactics.pressing);
  const [width, setWidth] = useState<Width>(initial.tactics.width);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    formation !== initial.formation ||
    mentality !== initial.tactics.mentality ||
    tempo !== initial.tactics.tempo ||
    pressing !== initial.tactics.pressing ||
    width !== initial.tactics.width;

  function apply() {
    if (!baseTeam) {
      setError("Time controlado não encontrado.");
      return;
    }
    const override: UserTactics = {
      formation,
      tactics: { mentality, tempo, pressing, width },
      // XI and bench come from the base team. D.1.e/f will let the user
      // customize these; for now we forward the JSON defaults so the
      // engine gets a complete Team object.
      starting_xi: baseTeam.starting_xi.slice(),
      bench: baseTeam.bench?.slice() ?? [],
    };
    try {
      const start = performance.now();
      const newSaved = resimulateFromRound(saved, saved.currentRoundIdx, override);
      const ms = Math.round(performance.now() - start);
      // Count actually re-simulated fixtures (user-involving from
      // currentRoundIdx onward) for the status line — purely informational.
      const resimCount = saved.record.fixtures.reduce((acc, f, i) => {
        if (f.round < saved.currentRoundIdx) return acc;
        const m = saved.record.matches[i];
        const involvesUser =
          m.home === saved.controlledTeamId || m.away === saved.controlledTeamId;
        return acc + (involvesUser ? 1 : 0);
      }, 0);
      onApply(newSaved, ms, resimCount);
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
        <label>
          <span>Formação</span>
          <select
            value={formation}
            onChange={(e) => setFormation(e.target.value as Formation)}
          >
            <option value="F442">4-4-2</option>
            <option value="F433">4-3-3</option>
            <option value="F352">3-5-2</option>
            <option value="F4231">4-2-3-1</option>
          </select>
        </label>
        <label>
          <span>Postura</span>
          <select
            value={mentality}
            onChange={(e) => setMentality(e.target.value as Mentality)}
          >
            <option value="VeryDefensive">Muito Defensivo</option>
            <option value="Defensive">Defensivo</option>
            <option value="Balanced">Equilibrado</option>
            <option value="Attacking">Ofensivo</option>
            <option value="VeryAttacking">Muito Ofensivo</option>
          </select>
        </label>
        <label>
          <span>Ritmo</span>
          <select value={tempo} onChange={(e) => setTempo(e.target.value as Tempo)}>
            <option value="Slow">Lento</option>
            <option value="Normal">Normal</option>
            <option value="Fast">Rápido</option>
          </select>
        </label>
        <label>
          <span>Marcação</span>
          <select
            value={pressing}
            onChange={(e) => setPressing(e.target.value as Pressing)}
          >
            <option value="Low">Baixa</option>
            <option value="Medium">Média</option>
            <option value="High">Alta</option>
          </select>
        </label>
        <label>
          <span>Amplitude</span>
          <select value={width} onChange={(e) => setWidth(e.target.value as Width)}>
            <option value="Narrow">Estreita</option>
            <option value="Normal">Normal</option>
            <option value="Wide">Larga</option>
          </select>
        </label>

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
