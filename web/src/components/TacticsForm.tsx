import type {
  Formation,
  Mentality,
  Pressing,
  Tactics,
  Tempo,
  Width,
} from "../types";

/** Flat shape of the five tactical enum fields. Flat (not nested under a
 *  `tactics` key) so parents can use `useState<TacticsFormState>` directly
 *  and dirty-check by field equality. */
export type TacticsFormState = {
  formation: Formation;
  mentality: Mentality;
  tempo: Tempo;
  pressing: Pressing;
  width: Width;
};

export function tacticsFormStateEquals(
  a: TacticsFormState,
  b: TacticsFormState,
): boolean {
  return (
    a.formation === b.formation &&
    a.mentality === b.mentality &&
    a.tempo === b.tempo &&
    a.pressing === b.pressing &&
    a.width === b.width
  );
}

/** Decompose into the (formation, tactics) pair the engine and UserTactics
 *  shape consume. */
export function tacticsFormStateToOverride(
  s: TacticsFormState,
): { formation: Formation; tactics: Tactics } {
  return {
    formation: s.formation,
    tactics: {
      mentality: s.mentality,
      tempo: s.tempo,
      pressing: s.pressing,
      width: s.width,
    },
  };
}

type TacticsFormProps = {
  /** Current form values — parent owns. Any change emits the full new
   *  state via `onChange`; the form is stateless. */
  state: TacticsFormState;
  onChange: (next: TacticsFormState) => void;
};

/**
 * Pure controlled component: the five tactical enum dropdowns. No
 * useState/useEffect inside — parent fully owns state. This shape avoids
 * the clobbering footgun an internal-state form would have: if a parent's
 * `initial` prop ever changed reference unexpectedly, an internal
 * `useEffect(() => setState(initial), [initial])` would silently wipe
 * user input. Controlled-component pattern makes that impossible.
 *
 * Shared by TacticsView (quick-menu) and PrepareView (intermediate screen
 * on AVANÇAR).
 */
export default function TacticsForm({ state, onChange }: TacticsFormProps) {
  return (
    <>
      <label>
        <span>Formação</span>
        <select
          value={state.formation}
          onChange={(e) =>
            onChange({ ...state, formation: e.target.value as Formation })
          }
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
          value={state.mentality}
          onChange={(e) =>
            onChange({ ...state, mentality: e.target.value as Mentality })
          }
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
        <select
          value={state.tempo}
          onChange={(e) =>
            onChange({ ...state, tempo: e.target.value as Tempo })
          }
        >
          <option value="Slow">Lento</option>
          <option value="Normal">Normal</option>
          <option value="Fast">Rápido</option>
        </select>
      </label>
      <label>
        <span>Marcação</span>
        <select
          value={state.pressing}
          onChange={(e) =>
            onChange({ ...state, pressing: e.target.value as Pressing })
          }
        >
          <option value="Low">Baixa</option>
          <option value="Medium">Média</option>
          <option value="High">Alta</option>
        </select>
      </label>
      <label>
        <span>Amplitude</span>
        <select
          value={state.width}
          onChange={(e) =>
            onChange({ ...state, width: e.target.value as Width })
          }
        >
          <option value="Narrow">Estreita</option>
          <option value="Normal">Normal</option>
          <option value="Wide">Larga</option>
        </select>
      </label>
    </>
  );
}
