import { useMemo, useState } from "react";
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import type { Career, Deal } from "../persistence";
import {
  projectSeasonRunway,
  nextHomeDemand,
  expansionCost,
  marketingCost,
  tvIncomeForRound,
  sponsorshipForRound,
  seasonToDateLedger,
  tvSeasonTotal,
  generateDealOffers,
  type DealOffer,
  TV_DEAL_BY_TIER,
  SPONSORSHIP_BASE_BY_TIER,
  SPONSORSHIP_FANBASE_COEF,
  CAMPAIGN_FANBASE,
  STADIUM_EXPANSION_STEP,
  MARKETING_MOMENTUM_PER_CAMPAIGN,
} from "../util/finances";
import { findUserDivisionIdxInSeason } from "../persistence";
import {
  canExpand,
  canMarket,
  applyTransferAction,
  reverseTransferAction,
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

  // E.4.b.4: pay to add a fixed block of seats. E.4.b.5: run a marketing
  // campaign. Both are reversible manager-state spends; the money/state math
  // lives in applyTransferAction (shared with the market) so it can't drift.
  function expandStadium() {
    if (!canExpand(working).ok) return;
    const action = {
      kind: "expandStadium" as const,
      seats: STADIUM_EXPANSION_STEP,
      price: expansionCost(working.manager.stadiumCapacity),
    };
    setWorking(applyTransferAction(working, action));
    setActions([...actions, action]);
  }

  function runCampaign() {
    if (!canMarket(working).ok) return;
    const action = {
      kind: "runCampaign" as const,
      fanbase: CAMPAIGN_FANBASE,
      momentum: MARKETING_MOMENTUM_PER_CAMPAIGN,
      price: marketingCost(working.manager.marketingMomentum),
    };
    setWorking(applyTransferAction(working, action));
    setActions([...actions, action]);
  }

  function undoLast() {
    const last = actions[actions.length - 1];
    if (!last) return;
    setWorking(reverseTransferAction(working, last));
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
  const tvSeason = tvSeasonTotal(working);
  const round = Math.min(userDiv.currentRoundIdx, userDiv.record.fixtures.length);
  const tvPerRound = tvIncomeForRound(working, round);
  const sponsorshipPerRound = sponsorshipForRound(working, round);

  // Negotiable deals (v12): the offer slate for NEXT season, signable now (it
  // takes effect next season — the current season runs on the active deal /
  // derived floor, keeping the per-round-sums-to-season invariant intact).
  // Anchored on the current tier's floors; deterministic in (seed, nextYear).
  const nextYear = working.currentSeason.year + 1;
  const offers = useMemo(() => {
    const tvFloor = TV_DEAL_BY_TIER[tier];
    const sponsorshipFloor = Math.round(
      SPONSORSHIP_BASE_BY_TIER[tier] +
        working.manager.fanbase * SPONSORSHIP_FANBASE_COEF,
    );
    return generateDealOffers(working.seed, nextYear, tier, tvFloor, sponsorshipFloor);
    // seed + nextYear + tier + fanbase fully determine the slate.
  }, [working.seed, nextYear, tier, working.manager.fanbase]);

  function signDeal(slot: "tv" | "sponsorship", offer: DealOffer) {
    // Strip the display-only `label` to store a clean Deal.
    const { label: _label, ...deal } = offer;
    const action: TransferAction = {
      kind: "signDeal",
      slot,
      deal: deal as Deal,
      previous: working.manager.activeDeals?.[slot],
    };
    setWorking(applyTransferAction(working, action));
    setActions([...actions, action]);
  }

  const activeTv = working.manager.activeDeals?.tv;
  const activeSponsor = working.manager.activeDeals?.sponsorship;

  // Season-to-date ledger: the 5 streams summed over rounds already played.
  const ledger = seasonToDateLedger(working);

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

      <Panel
        title={`Caixa da temporada${ledger.rounds > 0 ? ` (${ledger.rounds} rodada${ledger.rounds === 1 ? "" : "s"})` : ""}`}
      >
        {ledger.rounds === 0 ? (
          <Text c="dimmed" size="sm">
            Nenhuma rodada jogada ainda nesta temporada.
          </Text>
        ) : (
          <Stack gap={4}>
            {([
              ["Bilheteria", ledger.ticket, false],
              ["TV", ledger.tv, false],
              ["Patrocínio", ledger.sponsorship, false],
              ["Bônus", ledger.bonus, false],
              ["Folha", ledger.wages, true],
            ] as const).map(([label, value, negative]) => (
              <Group key={label} justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
                <Text size="sm" ff="monospace" c={negative ? "red.4" : undefined}>
                  {negative ? "−" : "+"} $ {formatMoney(Math.abs(value))}
                </Text>
              </Group>
            ))}
            <Group
              justify="space-between"
              wrap="nowrap"
              style={{
                borderTop: "1px solid var(--mantine-color-ink-6)",
                marginTop: 2,
                paddingTop: 4,
              }}
            >
              <Text size="sm" fw={700}>
                Líquido
              </Text>
              <Text
                size="sm"
                fw={700}
                ff="monospace"
                c={ledger.net >= 0 ? "accent.4" : "red.4"}
              >
                {ledger.net >= 0 ? "+" : "−"} $ {formatMoney(Math.abs(ledger.net))}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Acumulado das rodadas já jogadas (sem copa nem premiação de
              classificação).
            </Text>
          </Stack>
        )}
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

      <Panel title={`Contratos · ofertas para ${nextYear}`}>
        <Stack gap="sm">
          <DealSlot
            heading="TV"
            active={activeTv}
            floor={TV_DEAL_BY_TIER[tier]}
            offers={offers.tv}
            onSign={(o) => signDeal("tv", o)}
          />
          <DealSlot
            heading="Patrocínio"
            active={activeSponsor}
            floor={Math.round(
              SPONSORSHIP_BASE_BY_TIER[tier] +
                working.manager.fanbase * SPONSORSHIP_FANBASE_COEF,
            )}
            offers={offers.sponsorship}
            onSign={(o) => signDeal("sponsorship", o)}
          />
          <Text size="xs" c="dimmed">
            Ofertas entram em vigor na próxima temporada. Cair de divisão
            derruba o contrato de TV (volta ao piso da nova série).
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

/** One contract slot (TV or sponsorship): the active deal (or the derived
 *  floor when none is signed) + the next-season offer slate to sign from. */
function DealSlot({
  heading,
  active,
  floor,
  offers,
  onSign,
}: {
  heading: string;
  active: Deal | undefined;
  floor: number;
  offers: DealOffer[];
  onSign: (offer: DealOffer) => void;
}) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={700}>
          {heading}
        </Text>
        {active ? (
          <Group gap="xs" wrap="nowrap">
            <Badge variant="light" color="accent" radius="sm" size="sm">
              Contrato
            </Badge>
            <Text size="sm" ff="monospace">
              $ {formatMoney(active.seasonAmount)}/temp · {active.termYears}t
            </Text>
          </Group>
        ) : (
          <Text size="sm" ff="monospace" c="dimmed">
            piso $ {formatMoney(floor)}/temp
          </Text>
        )}
      </Group>
      {active?.performanceClause && (
        <Text size="xs" c="yellow.5">
          ⚠ Cláusula: terminar ≤ {active.performanceClause.maxPosition}º — senão o
          contrato cai no fim da temporada.
        </Text>
      )}
      {offers.map((o) => {
        const signed = active?.id === o.id;
        return (
          <Group key={o.id} justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" c="dimmed">
                {o.label} · {o.termYears} temporada{o.termYears === 1 ? "" : "s"}
              </Text>
              {o.performanceClause && (
                <Text size="xs" c="yellow.5">
                  meta ≤ {o.performanceClause.maxPosition}º
                </Text>
              )}
            </Stack>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" ff="monospace">
                $ {formatMoney(o.seasonAmount)}
              </Text>
              <Button
                size="compact-xs"
                variant={signed ? "filled" : "default"}
                disabled={signed}
                onClick={() => onSign(o)}
              >
                {signed ? "Assinado" : "Assinar"}
              </Button>
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}
