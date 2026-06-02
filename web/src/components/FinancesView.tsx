import { useState } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import type { Career } from "../persistence";
import {
  projectSeasonRunway,
  nextHomeDemand,
  expansionCost,
  marketingCost,
  tvIncomeForRound,
  sponsorshipForRound,
  TV_DEAL_BY_TIER,
  CAMPAIGN_FANBASE,
  STADIUM_EXPANSION_STEP,
  MARKETING_MOMENTUM_PER_CAMPAIGN,
} from "../util/finances";
import { findUserDivisionIdxInSeason } from "../persistence";
import {
  canExpand,
  canMarket,
  type TransferAction,
} from "../util/transfer-market";
import { formatMoney } from "../util/money";
import { teamById } from "../teams";
import { Panel } from "./ui/Panel";

/**
 * Finances screen, reachable from the running phase. Shows the balance, the
 * rest-of-season cash runway, and stadium/fanbase status — AND is where the
 * club expands the stadium / runs marketing campaigns (moved here from the
 * transfer market, which is now players-only).
 *
 * Transactional, mirroring the market: a `working` career + an `actions` draft
 * with [ Desfazer ] shadow the saved career; every indicator (balance, runway,
 * capacity, fanbase, next-home demand) reflects the draft live, so the player
 * sees the impact before committing. [ Fechar ] hands `working` up to persist.
 * Only stadium/marketing actions live here — no player buy/sell.
 */
export default function FinancesView({
  career,
  onClose,
}: {
  career: Career;
  /** Commit: parent persists the working career and returns to running. */
  onClose: (newCareer: Career) => void;
}) {
  const [working, setWorking] = useState<Career>(career);
  const [actions, setActions] = useState<TransferAction[]>([]);

  // E.4.b.4: pay to add a fixed block of seats. Debits money, raises capacity;
  // reversible. Purely manager-state — not a TransferRecord.
  function expandStadium() {
    if (!canExpand(working).ok) return;
    const price = expansionCost(working.manager.stadiumCapacity);
    setWorking({
      ...working,
      manager: {
        ...working.manager,
        money: working.manager.money - price,
        stadiumCapacity: working.manager.stadiumCapacity + STADIUM_EXPANSION_STEP,
      },
    });
    setActions([
      ...actions,
      { kind: "expandStadium", seats: STADIUM_EXPANSION_STEP, price },
    ]);
  }

  // E.4.b.5: run a marketing campaign. Adds fanbase now AND raises the decaying
  // marketingMomentum the seasonal drift reads, so the boost persists. Reversible.
  function runCampaign() {
    if (!canMarket(working).ok) return;
    const price = marketingCost(working.manager.marketingMomentum);
    setWorking({
      ...working,
      manager: {
        ...working.manager,
        money: working.manager.money - price,
        fanbase: working.manager.fanbase + CAMPAIGN_FANBASE,
        marketingMomentum:
          working.manager.marketingMomentum + MARKETING_MOMENTUM_PER_CAMPAIGN,
      },
    });
    setActions([
      ...actions,
      {
        kind: "runCampaign",
        fanbase: CAMPAIGN_FANBASE,
        momentum: MARKETING_MOMENTUM_PER_CAMPAIGN,
        price,
      },
    ]);
  }

  function undoLast() {
    const last = actions[actions.length - 1];
    if (!last) return;
    if (last.kind === "expandStadium") {
      setWorking({
        ...working,
        manager: {
          ...working.manager,
          money: working.manager.money + last.price,
          stadiumCapacity: working.manager.stadiumCapacity - last.seats,
        },
      });
    } else if (last.kind === "runCampaign") {
      setWorking({
        ...working,
        manager: {
          ...working.manager,
          money: working.manager.money + last.price,
          fanbase: working.manager.fanbase - last.fanbase,
          marketingMomentum: working.manager.marketingMomentum - last.momentum,
        },
      });
    }
    setActions(actions.slice(0, -1));
  }

  // Indicators all read `working`, so a pending expand/campaign moves them now.
  const runway = projectSeasonRunway(working);
  const ok = !runway.atRisk;
  const home = nextHomeDemand(working);
  const capped = home !== null && home.demand >= home.capacity;
  const oppName = home ? teamById(home.oppId)?.name ?? `Time ${home.oppId}` : null;

  const expand = canExpand(working);
  const market = canMarket(working);
  const expandPrice = expansionCost(working.manager.stadiumCapacity);
  const campaignPrice = marketingCost(working.manager.marketingMomentum);

  // Recurring revenue floors (passive — not player-controlled): the TV deal is
  // a season contract keyed to the division tier (banked in per-round slices);
  // sponsorship is a per-round floor scaled by tier + fanbase + last placement.
  const userDiv =
    working.currentSeason.divisions[
      findUserDivisionIdxInSeason(working.currentSeason, working.controlledTeamId)
    ];
  const tier = userDiv.tier as 1 | 2 | 3;
  const tvSeason = TV_DEAL_BY_TIER[tier];
  const round = Math.min(userDiv.currentRoundIdx, userDiv.record.fixtures.length);
  const tvPerRound = tvIncomeForRound(working, round);
  const sponsorshipPerRound = sponsorshipForRound(working, round);

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        FINANÇAS · {working.currentSeason.year}
      </Text>

      <Panel title="Saldo">
        <Text ff="monospace" fw={800} fz={28} c={ok ? "accent.4" : "red.5"}>
          $ {formatMoney(working.manager.money)}
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
              : "⚠ Risco de ficar no vermelho antes do fim da temporada — segure os gastos."}
          </Text>
        </Stack>
      </Panel>

      <Panel title="Receitas recorrentes">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              Contrato de TV ({userDiv.name} · temporada)
            </Text>
            <Text size="sm" ff="monospace" c="accent.4">
              + $ {formatMoney(tvSeason)}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              TV por rodada
            </Text>
            <Text size="sm" ff="monospace">
              + $ {formatMoney(tvPerRound)}
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              Patrocínio por rodada
            </Text>
            <Text size="sm" ff="monospace" c="accent.4">
              + $ {formatMoney(sponsorshipPerRound)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            Pisos recorrentes: a TV é o contrato da divisão (creditado em fatias
            por rodada); o patrocínio cresce com a torcida e a classificação.
          </Text>
        </Stack>
      </Panel>

      <Panel title="Estádio, torcida & marketing">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Capacidade do estádio</Text>
            <Text size="sm" ff="monospace">
              {formatMoney(working.manager.stadiumCapacity)} lugares
            </Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Torcida</Text>
            <Text size="sm" ff="monospace">
              {formatMoney(working.manager.fanbase)} torcedores
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
                ? "Lotando: a demanda supera a capacidade e você perde bilheteria. Amplie o estádio abaixo para capturá-la."
                : "Sobra cadeira: a capacidade ainda comporta a demanda do próximo jogo em casa."}
            </Text>
          )}

          <Group justify="space-between" wrap="nowrap" mt={4}>
            <Text c="dimmed" size="xs">
              Ampliar aumenta a bilheteria de todos os jogos em casa.
            </Text>
            <Button
              size="xs"
              variant="default"
              disabled={!expand.ok}
              title={expand.ok ? undefined : expand.reason}
              onClick={expandStadium}
            >
              Ampliar +{formatMoney(STADIUM_EXPANSION_STEP)} · $ {formatMoney(expandPrice)}
            </Button>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed" size="xs">
              Campanha de marketing aumenta a torcida (e dura algumas temporadas).
            </Text>
            <Button
              size="xs"
              variant="default"
              disabled={!market.ok}
              title={market.ok ? undefined : market.reason}
              onClick={runCampaign}
            >
              Campanha +{formatMoney(CAMPAIGN_FANBASE)} · $ {formatMoney(campaignPrice)}
            </Button>
          </Group>
        </Stack>
      </Panel>

      <Group justify="center" gap="sm">
        <Button onClick={() => onClose(working)}>Fechar</Button>
        <Button
          variant="default"
          onClick={undoLast}
          disabled={actions.length === 0}
        >
          Desfazer última
        </Button>
      </Group>
    </Stack>
  );
}
