import { useState } from "react";
import {
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
} from "@mantine/core";
import { play_match } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import type { Match } from "../types";
import { Panel } from "./ui/Panel";
import MatchReveal from "./MatchReveal";

/**
 * Standalone exhibition match — pick any two clubs from the 60-team registry,
 * set a seed, and watch a one-off friendly play out tick-by-tick. No career
 * context: the engine's `play_match` is deterministic on (home, away, seed),
 * so the same inputs always reproduce the same match. Mirrors the native
 * Android "friendly match simulator".
 */

// Teams sorted by name for the pickers (registry order is by id).
const TEAM_OPTIONS = ALL_TEAMS.slice()
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  .map((t) => ({ value: String(t.id), label: t.name }));

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export default function FriendlyMatchView({ onBack }: { onBack: () => void }) {
  // Default to the first two distinct clubs so "Jogar" works immediately.
  const [homeId, setHomeId] = useState<number>(ALL_TEAMS[0]?.id ?? 0);
  const [awayId, setAwayId] = useState<number>(
    ALL_TEAMS[1]?.id ?? ALL_TEAMS[0]?.id ?? 0,
  );
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [match, setMatch] = useState<Match | null>(null);
  const [skip, setSkip] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameTeam = homeId === awayId;

  function play() {
    const home = teamById(homeId);
    const away = teamById(awayId);
    if (!home || !away) {
      setError("Time inválido.");
      return;
    }
    try {
      setError(null);
      setSkip(false);
      setDone(false);
      const result = play_match(home, away, BigInt(seed)) as Match;
      setMatch(result);
    } catch (e) {
      setError(`Falha ao simular: ${String(e)}`);
    }
  }

  function reset() {
    setMatch(null);
    setDone(false);
    setSkip(false);
    setSeed(randomSeed());
  }

  if (match) {
    const homeName = teamById(match.home)?.name ?? `Time ${match.home}`;
    const awayName = teamById(match.away)?.name ?? `Time ${match.away}`;
    return (
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          AMISTOSO · {homeName} × {awayName} · seed {seed}
        </Text>

        <MatchReveal
          match={match}
          skipAll={skip}
          onComplete={() => setDone(true)}
        />

        {done && (
          <Panel title="Fim de jogo">
            <Text fw={700} ta="center" fz="lg">
              {homeName} {match.result.home_goals} × {match.result.away_goals}{" "}
              {awayName}
            </Text>
          </Panel>
        )}

        <Group justify="center" gap="sm">
          {!done && (
            <Button variant="default" onClick={() => setSkip(true)}>
              Pular
            </Button>
          )}
          <Button onClick={reset}>Nova partida</Button>
          <Button variant="subtle" onClick={onBack}>
            Voltar
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Panel title="Amistoso">
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          Escolha dois times e uma seed para simular uma partida avulsa. O
          resultado é determinístico: a mesma combinação sempre reproduz o
          mesmo jogo.
        </Text>

        <NativeSelect
          label="Mandante"
          value={String(homeId)}
          onChange={(e) => setHomeId(Number(e.currentTarget.value))}
          data={TEAM_OPTIONS}
        />
        <NativeSelect
          label="Visitante"
          value={String(awayId)}
          onChange={(e) => setAwayId(Number(e.currentTarget.value))}
          data={TEAM_OPTIONS}
        />
        <NumberInput
          label="Seed"
          value={seed}
          onChange={(v) => setSeed(typeof v === "number" ? v : Number(v) || 0)}
          min={0}
          step={1}
          allowDecimal={false}
        />

        {sameTeam && (
          <Text c="yellow.5" size="sm">
            Escolha dois times diferentes.
          </Text>
        )}
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}

        <Group justify="center" gap="sm">
          <Button onClick={play} disabled={sameTeam}>
            Jogar
          </Button>
          <Button variant="default" onClick={() => setSeed(randomSeed())}>
            Seed aleatória
          </Button>
          <Button variant="subtle" onClick={onBack}>
            Voltar
          </Button>
        </Group>
      </Stack>
    </Panel>
  );
}
