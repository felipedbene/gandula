import { Fragment, useMemo, useState } from "react";
import { userTeam } from "../util/roster";
import {
  MAX_ROSTER,
  canBuy,
  canSell,
  generateFreeAgents,
  playerPrice,
  scoutReport,
  type ScoutReport,
  type TransferAction,
} from "../util/transfer-market";
import { formatMoney } from "../util/money";
import type { Career, TransferRecord } from "../persistence";
import type { Player } from "../types";
import { Button, Group, Progress, SimpleGrid, Stack, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";

type TransferMarketViewProps = {
  career: Career;
  /** Called when user clicks FECHAR MERCADO. Receives the mutated
   *  Career with userRoster / manager.money / currentSeason.transfers
   *  (and possibly lazy-pruned userTactics.bench) reflecting the
   *  session's transactions. Parent (SeasonView) persists +
   *  transitions back to finale. */
  onClose: (newCareer: Career) => void;
};

/**
 * Transfer market phase view. Opens between SeasonFinale and the next
 * season's `running`. Internal state (`working` + `actions`) shadows
 * the on-disk career until FECHAR MERCADO commits — every buy/sell is
 * reversible via [ DESFAZER ÚLTIMA ], and F5 mid-market loses session
 * progress but never corrupts the saved career.
 *
 * Lazy-init pattern: `working.userRoster` starts as the prop's career
 * value (which may be `[]` for fresh careers, signalling
 * registry-default). The first buy/sell action populates it from the
 * registry, so subsequent userTeam() calls see a real array. The
 * lazy-init helper handles both "first transfer" and "already
 * customised" cases uniformly.
 *
 * Lazy-prune on sell: if the sold player sits in
 * `userTactics.bench`, that array is filtered. If userTactics is
 * undefined, we leave it undefined — registry default bench will
 * naturally drop the player when the next TacticsView mount filters
 * roster.find(p => p.id === missingId). The XI is hard-blocked by
 * canSell, so the XI array always stays consistent.
 */
export default function TransferMarketView({
  career,
  onClose,
}: TransferMarketViewProps) {
  const [working, setWorking] = useState<Career>(career);
  const [actions, setActions] = useState<TransferAction[]>([]);
  // Which free agent's scout report is expanded (id), or null.
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);

  // Pool depends only on career.seed + year — both immutable for the
  // life of this market session. Recomputing on render is cheap
  // (12 deterministic Players) but the useMemo also pins identity
  // for the available-agents derivation below.
  const pool = useMemo(
    () => generateFreeAgents(career.seed, career.currentSeason.year),
    [career.seed, career.currentSeason.year],
  );

  // Bought players land in working.userRoster; filter them out of the
  // pool so the UI never offers the same agent twice.
  const team = userTeam(working);
  const availableAgents = useMemo(() => {
    const rosterIds = new Set(team.roster.map((p) => p.id));
    return pool.filter((p) => !rosterIds.has(p.id));
  }, [pool, team]);

  /** Lazy-init the working roster from the registry team on first
   *  transaction. After the first buy/sell, working.userRoster is
   *  always populated (and stays populated across undos — see briefing
   *  decision: skipping the "non-empty content-equal to registry"
   *  optimisation; userTeam fallback is functionally identical). */
  function currentRosterCopy(): Player[] {
    return working.userRoster.length === 0
      ? team.roster.slice()
      : working.userRoster.slice();
  }

  function buy(player: Player) {
    const price = playerPrice(player, "buy");
    const check = canBuy(working, price);
    if (!check.ok) return;

    const newRoster = [...currentRosterCopy(), player];
    const newTransfers: TransferRecord[] = [
      ...working.currentSeason.transfers,
      { kind: "buy", playerName: player.name, position: player.position, price },
    ];
    setWorking({
      ...working,
      manager: {
        ...working.manager,
        money: working.manager.money - price,
      },
      userRoster: newRoster,
      currentSeason: {
        ...working.currentSeason,
        transfers: newTransfers,
      },
    });
    setActions([...actions, { kind: "buy", player, price }]);
  }

  function sell(player: Player) {
    const price = playerPrice(player, "sell");
    const check = canSell(working, player.id);
    if (!check.ok) return;

    const newRoster = currentRosterCopy().filter((p) => p.id !== player.id);

    // Lazy-prune userTactics.bench if the sold id is there. XI is
    // hard-blocked by canSell so we never need to mutate it.
    let newUserTactics = working.currentSeason.userTactics;
    if (newUserTactics?.bench.includes(player.id)) {
      newUserTactics = {
        ...newUserTactics,
        bench: newUserTactics.bench.filter((id) => id !== player.id),
      };
    }

    const newTransfers: TransferRecord[] = [
      ...working.currentSeason.transfers,
      { kind: "sell", playerName: player.name, position: player.position, price },
    ];
    setWorking({
      ...working,
      manager: {
        ...working.manager,
        money: working.manager.money + price,
      },
      userRoster: newRoster,
      currentSeason: {
        ...working.currentSeason,
        transfers: newTransfers,
        userTactics: newUserTactics,
      },
    });
    setActions([...actions, { kind: "sell", player, price }]);
  }

  function undoLast() {
    if (actions.length === 0) return;
    const last = actions[actions.length - 1];
    const baseRoster = currentRosterCopy();
    const newRoster =
      last.kind === "buy"
        ? baseRoster.filter((p) => p.id !== last.player.id)
        : [...baseRoster, last.player];
    const moneyDelta = last.kind === "buy" ? last.price : -last.price;
    // The lazy-prune of userTactics.bench on a sell is intentionally
    // NOT reversed here: re-adding the player to the roster on undo
    // doesn't put them back on the bench. Simpler than nesting undo
    // state, and consistent with how a freshly bought player also
    // arrives outside the bench — user uses BenchEditor to slot
    // anyone into bench from the broader roster.
    setWorking({
      ...working,
      manager: {
        ...working.manager,
        money: working.manager.money + moneyDelta,
      },
      userRoster: newRoster,
      currentSeason: {
        ...working.currentSeason,
        transfers: working.currentSeason.transfers.slice(0, -1),
      },
    });
    setActions(actions.slice(0, -1));
  }

  const effectiveXi =
    working.currentSeason.userTactics?.starting_xi ?? team.starting_xi;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        MERCADO · ANO {working.currentSeason.year} · SALDO ${" "}
        {formatMoney(working.manager.money)} · ROSTER {team.roster.length}/
        {MAX_ROSTER}
      </Text>

      <Panel title={`Jogadores disponíveis (${availableAgents.length})`}>
        <Stack gap={2}>
          {availableAgents.length === 0 ? (
            <Text c="dimmed">Mercado esgotado nesta janela.</Text>
          ) : (
            availableAgents.map((p) => {
              const price = playerPrice(p, "buy");
              const check = canBuy(working, price);
              const scouted = expandedAgent === p.id;
              return (
                <Fragment key={p.id}>
                  <TransferRow
                    player={p}
                    price={price}
                    action="comprar"
                    enabled={check.ok}
                    reason={check.ok ? undefined : check.reason}
                    inXi={false}
                    onClick={() => buy(p)}
                    scouted={scouted}
                    onScout={() => setExpandedAgent(scouted ? null : p.id)}
                  />
                  {scouted && (
                    <ScoutPanel player={p} report={scoutReport(p, team.roster)} />
                  )}
                </Fragment>
              );
            })
          )}
        </Stack>
      </Panel>

      <Panel title={`Meu elenco (${team.roster.length})`}>
        <Stack gap={2}>
          {team.roster.map((p) => {
            const price = playerPrice(p, "sell");
            const check = canSell(working, p.id);
            return (
              <TransferRow
                key={p.id}
                player={p}
                price={price}
                action="vender"
                enabled={check.ok}
                reason={check.ok ? undefined : check.reason}
                inXi={effectiveXi.includes(p.id)}
                onClick={() => sell(p)}
              />
            );
          })}
        </Stack>
      </Panel>

      <Group justify="center" gap="sm">
        <Button onClick={() => onClose(working)}>Fechar mercado</Button>
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

/**
 * One row of the free-agent or roster list. Action label is the verb
 * (comprar/vender) so the row stays the same shape on both sides —
 * disabled sells render `[ — ]` so the column width stays stable across
 * a mix of sellable and locked players.
 */
function TransferRow({
  player,
  price,
  action,
  enabled,
  reason,
  inXi,
  onClick,
  onScout,
  scouted,
}: {
  player: Player;
  price: number;
  action: "comprar" | "vender";
  enabled: boolean;
  reason?: string;
  inXi: boolean;
  onClick: () => void;
  /** When provided, renders a scout toggle (▾/▴) that expands the report. */
  onScout?: () => void;
  scouted?: boolean;
}) {
  const label = action === "comprar" ? "Comprar" : enabled ? "Vender" : "—";
  const stamina = player.attributes.stamina;
  return (
    <Group gap="xs" wrap="nowrap">
      <Text span size="sm" c="dimmed">
        {player.position}
      </Text>
      <Text
        span
        size="sm"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {player.name}
        {inXi ? " (XI)" : ""}
      </Text>
      <Text span size="sm" c="dimmed" visibleFrom="sm">
        {player.age}a
      </Text>
      <Text span size="sm" c="dimmed" visibleFrom="sm">
        STAM {stamina}
      </Text>
      <Text span size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        $ {formatMoney(price)}
      </Text>
      {onScout && (
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={onScout}
          title="Scout"
        >
          {scouted ? "▴" : "▾"}
        </Button>
      )}
      <Button
        size="compact-xs"
        variant={action === "comprar" ? "filled" : "default"}
        onClick={onClick}
        disabled={!enabled}
        title={reason}
      >
        {label}
      </Button>
    </Group>
  );
}

/** Attribute order + short PT labels for the scout report bars. */
const SCOUT_ATTRS: { key: keyof Player["attributes"]; label: string }[] = [
  { key: "pace", label: "VEL" },
  { key: "technique", label: "TÉC" },
  { key: "passing", label: "PAS" },
  { key: "defending", label: "DEF" },
  { key: "finishing", label: "FIN" },
  { key: "stamina", label: "FÔL" },
];

/**
 * Expanded scouting report for a free agent: attribute bars + an overall
 * rating and a verdict relative to the user's squad at that position.
 */
function ScoutPanel({
  player,
  report,
}: {
  player: Player;
  report: ScoutReport;
}) {
  return (
    <Stack
      gap={6}
      pl="md"
      mt={2}
      mb={4}
      style={{ borderLeft: "1px solid var(--mantine-color-dark-4)" }}
    >
      <SimpleGrid cols={2} spacing="md" verticalSpacing={4}>
        {SCOUT_ATTRS.map(({ key, label }) => {
          const v = player.attributes[key];
          return (
            <Group key={key} gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" w={30}>
                {label}
              </Text>
              <Progress value={v} color="phosphor" size="sm" style={{ flex: 1 }} />
              <Text
                size="xs"
                w={22}
                ta="right"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {v}
              </Text>
            </Group>
          );
        })}
      </SimpleGrid>

      <Group gap="md" wrap="wrap">
        <Text size="sm">
          Geral <b>{report.overall}</b>
        </Text>
        {report.samePositionCount > 0 ? (
          <>
            <Text size="sm" c={report.delta >= 0 ? "phosphor.4" : "red.5"}>
              vs seus {player.position}: {report.delta >= 0 ? "+" : "−"}
              {Math.abs(report.delta)}
            </Text>
            <Text size="sm" c="dimmed">
              seria seu Nº {report.rank} de {report.samePositionCount + 1}{" "}
              {player.position}
            </Text>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            seu 1º {player.position}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
