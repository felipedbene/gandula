import { useMemo, useState } from "react";
import { userTeam } from "../util/roster";
import {
  MAX_ROSTER,
  canBuy,
  canSell,
  generateFreeAgents,
  playerPrice,
  type TransferAction,
} from "../util/transfer-market";
import { formatMoney } from "../util/money";
import type { Career, TransferRecord } from "../persistence";
import type { Player } from "../types";
import Card from "../srcl/Card";

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
    <>
      <p className="campeonato-header muted">
        MERCADO · ANO {working.currentSeason.year} · SALDO ${" "}
        {formatMoney(working.manager.money)} · ROSTER {team.roster.length}/
        {MAX_ROSTER}
      </p>

      <Card title={`JOGADORES DISPONÍVEIS (${availableAgents.length})`}>
        <div className="transfer-list">
          {availableAgents.length === 0 ? (
            <p className="muted">Mercado esgotado nesta janela.</p>
          ) : (
            availableAgents.map((p) => {
              const price = playerPrice(p, "buy");
              const check = canBuy(working, price);
              return (
                <TransferRow
                  key={p.id}
                  player={p}
                  price={price}
                  action="comprar"
                  enabled={check.ok}
                  reason={check.ok ? undefined : check.reason}
                  inXi={false}
                  onClick={() => buy(p)}
                />
              );
            })
          )}
        </div>
      </Card>

      <Card title={`MEU ELENCO (${team.roster.length})`}>
        <div className="transfer-list">
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
        </div>
      </Card>

      <div className="form-actions form-actions--pair">
        <button type="button" className="btn" onClick={() => onClose(working)}>
          [ FECHAR MERCADO ]
        </button>
        <button
          type="button"
          className="btn"
          onClick={undoLast}
          disabled={actions.length === 0}
        >
          [ DESFAZER ÚLTIMA ]
        </button>
      </div>
    </>
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
}: {
  player: Player;
  price: number;
  action: "comprar" | "vender";
  enabled: boolean;
  reason?: string;
  inXi: boolean;
  onClick: () => void;
}) {
  const label =
    action === "comprar" ? "[ COMPRAR ]" : enabled ? "[ VENDER ]" : "[ — ]";
  const stamina = player.attributes.stamina;
  return (
    <div className="transfer-row">
      <span className="transfer-row__pos">{player.position.padEnd(4)}</span>
      <span className="transfer-row__name">
        {player.name}
        {inXi ? " (XI)" : ""}
      </span>
      <span className="transfer-row__age">{player.age}a</span>
      <span className="transfer-row__stat">STAM {stamina}</span>
      <span className="transfer-row__price">$ {formatMoney(price)}</span>
      <button
        type="button"
        className="btn transfer-row__btn"
        onClick={onClick}
        disabled={!enabled}
        title={reason}
      >
        {label}
      </button>
    </div>
  );
}
