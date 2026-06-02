import { Button, Group, Stack, Text } from "@mantine/core";
import type { Career } from "../persistence";
import { projectSeasonRunway, nextHomeDemand } from "../util/finances";
import { formatMoney } from "../util/money";
import { teamById } from "../teams";
import { Panel } from "./ui/Panel";

/**
 * Read-only financial picture, reachable from the running phase. Surfaces what
 * was previously locked inside the between-seasons transfer market: the balance,
 * the rest-of-season cash runway, and the stadium/fanbase status (incl. whether
 * the next home gate is capped by capacity). NO mutations, no spend buttons, no
 * draft/commit — that's the safety property: it can't fork or corrupt the
 * career. Stadium/marketing ADJUSTMENT stays in the market (transactional);
 * here it's status only. All numbers come from pure finances.ts helpers.
 */
export default function FinancesView({
  career,
  onBack,
}: {
  career: Career;
  onBack: () => void;
}) {
  const runway = projectSeasonRunway(career);
  const ok = !runway.atRisk;
  const home = nextHomeDemand(career);

  // Capacity-capped means demand ≥ capacity: the gate is leaving money on the
  // table. A small margin avoids flapping right at the boundary.
  const capped = home !== null && home.demand >= home.capacity;
  const oppName = home ? teamById(home.oppId)?.name ?? `Time ${home.oppId}` : null;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        FINANÇAS · {career.currentSeason.year}
      </Text>

      <Panel title="Saldo">
        <Text ff="monospace" fw={800} fz={28} c={ok ? "accent.4" : "red.5"}>
          $ {formatMoney(career.manager.money)}
        </Text>
      </Panel>

      <Panel title="Fôlego de caixa (resto da temporada)">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              Rodadas restantes
            </Text>
            <Text size="sm" ff="monospace">
              {runway.remainingRounds}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              Folha salarial até o fim
            </Text>
            <Text size="sm" ff="monospace" c="red.5">
              − $ {formatMoney(runway.remainingWages)}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Saldo projetado no fim da temporada</Text>
            <Text size="sm" ff="monospace" fw={700} c={ok ? "accent.4" : "red.5"}>
              $ {formatMoney(runway.projectedEndBalance)}
            </Text>
          </Group>
          <Text size="xs" c={ok ? "dimmed" : "red.5"}>
            {ok
              ? "Projeção conservadora (sem premiação de classificação nem copa)."
              : "⚠ Risco de ficar no vermelho antes do fim da temporada — segure as compras ou venda para equilibrar a folha."}
          </Text>
        </Stack>
      </Panel>

      <Panel title="Estádio & torcida">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Capacidade do estádio</Text>
            <Text size="sm" ff="monospace">
              {formatMoney(career.manager.stadiumCapacity)} lugares
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Torcida</Text>
            <Text size="sm" ff="monospace">
              {formatMoney(career.manager.fanbase)} torcedores
            </Text>
          </Group>
          {home && (
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="dimmed">
                Demanda do próximo jogo em casa{oppName ? ` (vs ${oppName})` : ""}
              </Text>
              <Text size="sm" ff="monospace" c={capped ? "yellow.5" : undefined}>
                {formatMoney(Math.round(home.demand))}
              </Text>
            </Group>
          )}
          {home && (
            <Text size="xs" c={capped ? "yellow.5" : "dimmed"} mt={2}>
              {capped
                ? "Lotando: a demanda supera a capacidade — você perde receita de bilheteria. Amplie o estádio no próximo Mercado."
                : "Sobra cadeira: a capacidade ainda comporta a demanda do próximo jogo em casa."}
            </Text>
          )}
          {!home && (
            <Text size="xs" c="dimmed" mt={2}>
              Sem mais jogos em casa nesta temporada.
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={2}>
            Ampliar estádio e campanhas de marketing continuam no Mercado.
          </Text>
        </Stack>
      </Panel>

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
}
