import { NativeSelect, Stack } from "@mantine/core";
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
    <Stack gap="sm">
      <NativeSelect
        label="Formação"
        value={state.formation}
        onChange={(e) =>
          onChange({ ...state, formation: e.currentTarget.value as Formation })
        }
        data={[
          { value: "F442", label: "4-4-2" },
          { value: "F433", label: "4-3-3" },
          { value: "F352", label: "3-5-2" },
          { value: "F4231", label: "4-2-3-1" },
        ]}
      />
      <NativeSelect
        label="Postura"
        value={state.mentality}
        onChange={(e) =>
          onChange({ ...state, mentality: e.currentTarget.value as Mentality })
        }
        data={[
          { value: "VeryDefensive", label: "Muito Defensivo" },
          { value: "Defensive", label: "Defensivo" },
          { value: "Balanced", label: "Equilibrado" },
          { value: "Attacking", label: "Ofensivo" },
          { value: "VeryAttacking", label: "Muito Ofensivo" },
        ]}
      />
      <NativeSelect
        label="Ritmo"
        value={state.tempo}
        onChange={(e) =>
          onChange({ ...state, tempo: e.currentTarget.value as Tempo })
        }
        data={[
          { value: "Slow", label: "Lento" },
          { value: "Normal", label: "Normal" },
          { value: "Fast", label: "Rápido" },
        ]}
      />
      <NativeSelect
        label="Marcação"
        value={state.pressing}
        onChange={(e) =>
          onChange({ ...state, pressing: e.currentTarget.value as Pressing })
        }
        data={[
          { value: "Low", label: "Baixa" },
          { value: "Medium", label: "Média" },
          { value: "High", label: "Alta" },
        ]}
      />
      <NativeSelect
        label="Amplitude"
        value={state.width}
        onChange={(e) =>
          onChange({ ...state, width: e.currentTarget.value as Width })
        }
        data={[
          { value: "Narrow", label: "Estreita" },
          { value: "Normal", label: "Normal" },
          { value: "Wide", label: "Larga" },
        ]}
      />
    </Stack>
  );
}
