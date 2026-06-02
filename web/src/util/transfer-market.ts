import { mulberry32 } from "./prng";
import { userTeam } from "./roster";
import {
  expansionCost,
  marketingCost,
  MARKETING_MOMENTUM_MAX,
  STADIUM_MAX_CAPACITY,
} from "./finances";
import {
  FIRST_YEAR,
  type Career,
  type Deal,
  type TransferRecord,
} from "../persistence";
import type { Attributes, Player, Position } from "../types";

// ─── Pool composition + ID layout ─────────────────────────────────────────

/** Positional split of the per-season free agent pool. Mirrors a typical
 *  squad needs distribution — a few GKs, more DEF/MID, a couple FWDs.
 *  Sum is POOL_SIZE; keep the constants in sync if you tune the mix. */
export const POOL_COMPOSITION: Record<Position, number> = {
  GK: 2,
  DEF: 4,
  MID: 4,
  FWD: 2,
};

/** Total free agents available each season. Derived constant — kept
 *  separate from POOL_COMPOSITION so callers can write `length === POOL_SIZE`
 *  assertions without re-summing. */
export const POOL_SIZE = 12;

/** Base offset for free agent player IDs. Chosen well above the max
 *  registry id (~63k as of E.1.e). Per-year stride keeps pools from
 *  different years from sharing ids, which matters: a player bought in
 *  year N stays in `Career.userRoster` indefinitely, and a fresh year N+1
 *  pool must not reuse their id. */
export const FREE_AGENT_ID_BASE = 900_000;
/** ID stride between consecutive years. 1000 leaves room for POOL_SIZE
 *  to grow significantly without collisions. */
export const FREE_AGENT_ID_YEAR_STRIDE = 1000;

/** Base offset for regen/youth player IDs (E.2.b). Far above free agents'
 *  900k, and `regenId` partitions the space by team/year/slot so no two
 *  generated youths — across any team, season, or the registry/free-agent
 *  pools — ever collide. Stays within u32 (engine PlayerId). */
export const REGEN_ID_BASE = 2_000_000_000;

/** Deterministic, collision-free id for a regen youth: `teamId` occupies the
 *  high stride (×10k), the season offset and slot the low digits (each < 100,
 *  so they never spill into the team band). */
export function regenId(teamId: number, yearOffset: number, slot: number): number {
  return REGEN_ID_BASE + teamId * 10_000 + yearOffset * 100 + slot;
}

// ─── Pricing ──────────────────────────────────────────────────────────────

/** Multiplier applied to base price on purchase (full price). */
export const BUY_MULTIPLIER = 1.0;
/** Multiplier applied to base price on sale (resale haircut — clubs
 *  never buy at full asking price). */
export const SELL_MULTIPLIER = 0.7;

// ─── Roster bounds ────────────────────────────────────────────────────────

/** Minimum roster size after a sale — below this and the team can't
 *  field XI + meaningful bench. */
export const MIN_ROSTER = 14;
/** Maximum roster size after a purchase — above this and the squad
 *  becomes unmanageable for the UI's lineup/bench editors. */
export const MAX_ROSTER = 25;

// ─── Name pool ────────────────────────────────────────────────────────────
//
// 30 × 30 = 900 deterministic combinations. Mulberry32 picks index pairs
// from the season-derived seed so a (career, year) always names the same
// player at the same pool slot. Brazilian first/last names; no special
// characters that would break monospace alignment in the UI.

const FIRST_NAMES = [
  "Carlos", "José", "Roberto", "Marcos", "Paulo", "Ricardo", "André",
  "Fernando", "Lucas", "Gabriel", "Rafael", "Bruno", "Felipe", "Diego",
  "Eduardo", "Henrique", "Tiago", "Vinícius", "Leandro", "Rogério",
  "Cláudio", "Sérgio", "Alex", "Daniel", "Júlio", "Murilo", "Pedro",
  "Mateus", "Thiago", "Wesley",
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa",
  "Almeida", "Rodrigues", "Ferreira", "Carvalho", "Gomes", "Martins",
  "Araújo", "Ribeiro", "Cardoso", "Barbosa", "Rocha", "Dias", "Mendes",
  "Castro", "Cunha", "Andrade", "Moraes", "Pinto", "Teixeira", "Borges",
  "Moreira", "Vieira", "Nogueira",
];

// ─── Free agent generation ───────────────────────────────────────────────

/**
 * Deterministic free agent pool for the (career, year) pair. Same inputs
 * always produce the same twelve players (name, age, attributes, id) —
 * load+save round-trips and "view this season's pool" features both rely
 * on this. Unsold agents disappear: next year's call produces a fresh
 * pool with non-colliding ids (see FREE_AGENT_ID_YEAR_STRIDE).
 *
 * Seed namespace: `careerSeed XOR year XOR 0xFA1F` ("FA" mnemonic for
 * "free agent"). XOR with year matches the per-season seed derivation
 * used in run_season — different careers get distinct pools, different
 * years within a career too.
 */
export function generateFreeAgents(careerSeed: bigint, year: number): Player[] {
  const poolSeed = careerSeed ^ BigInt(year) ^ 0xfa1fn;
  const rng = mulberry32(Number(poolSeed & 0xffffffffn));
  const idBase = FREE_AGENT_ID_BASE + (year - FIRST_YEAR) * FREE_AGENT_ID_YEAR_STRIDE;
  const players: Player[] = [];
  let slot = 0;
  // Iteration order matters for determinism: GK then DEF then MID then FWD.
  for (const position of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    const count = POOL_COMPOSITION[position];
    for (let i = 0; i < count; i++) {
      players.push(buildFreeAgent(rng, idBase + slot, position));
      slot++;
    }
  }
  return players;
}

/**
 * Pick a first+last name pair via two RNG draws. ~900 unique
 * combinations; collisions across a single pool are tolerable
 * (background flavour, not gameplay-affecting).
 */
function generateName(rng: () => number): string {
  const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

/** Fraction of free agents that roll as rare "elites" (E.4.c) — a realistic
 *  tail of expensive, title-grade players, lifting the means wall the old flat
 *  [30,70]+cap-85 roll couldn't clear. Most agents stay common. */
export const ELITE_AGENT_FRACTION = 0.12;
/** Attribute cap for the rare elite tier (vs 85 for common agents). */
export const ELITE_ATTR_CAP = 92;

/**
 * Generate position-biased attribute set. A common agent rolls each attribute
 * in [30, 70] (cap 85 after the positional boost) — the bulk of the market. A
 * rare elite (E.4.c, ELITE_AGENT_FRACTION of agents) rolls in a higher band
 * ([62, 86], cap ELITE_ATTR_CAP) so the market carries a tail of title-grade
 * players you can actually out-build the top clubs with. Deterministic via the
 * shared rng (the elite roll is just the first draw), so the pool stays a pure
 * function of (seed, year).
 */
function scaleByPosition(rng: () => number, position: Position): Attributes {
  const elite = rng() < ELITE_AGENT_FRACTION;
  const cap = elite ? ELITE_ATTR_CAP : 85;
  const base = (): number =>
    elite ? 62 + Math.floor(rng() * 25) : 30 + Math.floor(rng() * 41); // elite [62,86] / common [30,70]
  const boost = (n: number, bonus: number): number => Math.min(cap, n + bonus);
  const a: Attributes = {
    pace: base(),
    technique: base(),
    passing: base(),
    defending: base(),
    finishing: base(),
    stamina: base(),
  };
  switch (position) {
    case "GK":
      a.defending = boost(a.defending, 15);
      a.finishing = Math.max(10, a.finishing - 20); // GKs can't finish
      break;
    case "DEF":
      a.defending = boost(a.defending, 10);
      a.pace = boost(a.pace, 5);
      break;
    case "MID":
      a.passing = boost(a.passing, 5);
      a.technique = boost(a.technique, 5);
      break;
    case "FWD":
      a.finishing = boost(a.finishing, 15);
      a.pace = boost(a.pace, 5);
      break;
  }
  return a;
}

function buildFreeAgent(rng: () => number, id: number, position: Position): Player {
  return {
    id,
    name: generateName(rng),
    age: 18 + Math.floor(rng() * 17), // [18, 34]
    position,
    attributes: scaleByPosition(rng, position),
  };
}

/**
 * A regen youth (E.2.b): a young player (age 16–19) for a given position. Same
 * attribute generator as free agents — they start modest and grow via aging's
 * sub-23 bump. Used by the opponent-evolve cycle to replace retirees.
 */
export function buildYouth(rng: () => number, id: number, position: Position): Player {
  return {
    id,
    name: generateName(rng),
    age: 16 + Math.floor(rng() * 4), // [16, 19]
    position,
    attributes: scaleByPosition(rng, position),
  };
}

// ─── Pricing ──────────────────────────────────────────────────────────────

function avgAttrs(p: Player): number {
  const a = p.attributes;
  return (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) / 6;
}

// ─── Scouting ──────────────────────────────────────────────────────────────

/** Rounded overall (mean of the six attributes). The pricing path uses the
 *  raw avgAttrs; this is the integer rating surfaced to the user. */
export function playerOverall(p: Player): number {
  return Math.round(avgAttrs(p));
}

/**
 * Scouting verdict for a player relative to a roster at the same position:
 * their overall, the squad's positional average, the delta, and where they'd
 * rank among the same-position players (1 = best). `samePositionCount === 0`
 * means the squad has nobody in that position (rank defaults to 1).
 */
export type ScoutReport = {
  overall: number;
  samePositionCount: number;
  positionAvg: number;
  delta: number;
  rank: number;
};

export function scoutReport(player: Player, roster: Player[]): ScoutReport {
  const overall = playerOverall(player);
  const samePos = roster.filter((p) => p.position === player.position);
  const samePositionCount = samePos.length;
  if (samePositionCount === 0) {
    return { overall, samePositionCount: 0, positionAvg: 0, delta: 0, rank: 1 };
  }
  const positionAvg = Math.round(
    samePos.reduce((s, p) => s + playerOverall(p), 0) / samePositionCount,
  );
  const better = samePos.filter((p) => playerOverall(p) > overall).length;
  return {
    overall,
    samePositionCount,
    positionAvg,
    delta: overall - positionAvg,
    rank: better + 1,
  };
}

/**
 * Age curve multiplier. Mirrors how real football values rise then fall:
 *   < 21: 1.5x — high ceiling, scouts pay a premium
 *   21..25: 1.3x — prime entry
 *   26..29: 1.0x — peak baseline
 *   30..32: 0.7x — declining
 *   >= 33: 0.4x — veteran, short shelf life
 */
function ageMultiplier(age: number): number {
  if (age < 21) return 1.5;
  if (age < 26) return 1.3;
  if (age < 30) return 1.0;
  if (age < 33) return 0.7;
  return 0.4;
}

/**
 * Compute the price for a buy or sell transaction. Base is
 * `avg² × 100 × ageMultiplier`; resale haircut applied via
 * SELL_MULTIPLIER. Returns are rounded to whole moedas.
 *
 * Sample numbers:
 *   - avg 50 player age 25: 50² × 100 × 1.3 = 325_000 buy, 227_500 sell
 *   - avg 70 player age 22: 70² × 100 × 1.3 = 637_000 buy, 445_900 sell
 *   - avg 40 player age 34: 40² × 100 × 0.4 = 64_000 buy, 44_800 sell
 */
export function playerPrice(player: Player, kind: "buy" | "sell"): number {
  const avg = avgAttrs(player);
  const base = Math.round(avg * avg * 100 * ageMultiplier(player.age));
  return Math.round(base * (kind === "buy" ? BUY_MULTIPLIER : SELL_MULTIPLIER));
}

// ─── Buy / sell guards ────────────────────────────────────────────────────
//
// Pure validation. UI calls these to decide button enable/disable. The
// mutation flow (debit money, mutate userRoster, push to history) lives
// in E.1.e.2's TransferMarketView — these helpers just say yes/no plus
// a user-facing reason.

/**
 * Discriminated result. Letting `reason` be a separate field (not
 * stuffed into a string) makes it natural to surface in tooltips
 * without forcing the UI to parse a sentinel.
 */
export type CheckResult = { ok: true } | { ok: false; reason: string };

export function canBuy(career: Career, price: number): CheckResult {
  const team = userTeam(career);
  if (team.roster.length >= MAX_ROSTER) {
    return { ok: false, reason: `Roster cheio (${MAX_ROSTER})` };
  }
  if (career.manager.money < price) {
    return { ok: false, reason: "Dinheiro insuficiente" };
  }
  return { ok: true };
}

export function canSell(career: Career, playerId: number): CheckResult {
  const team = userTeam(career);
  if (team.roster.length <= MIN_ROSTER) {
    return { ok: false, reason: `Roster mínimo (${MIN_ROSTER})` };
  }
  // Effective XI: userTactics overlay wins if set; otherwise registry
  // default. The sell flow in E.1.e.2 will reconcile bench arrays with
  // a lazy-prune pattern, but XI is hard-blocked — user must move the
  // player out via TacticsView first.
  const effectiveXi =
    career.currentSeason.userTactics?.starting_xi ?? team.starting_xi;
  if (effectiveXi.includes(playerId)) {
    return { ok: false, reason: "Tire do XI antes" };
  }
  return { ok: true };
}

// ─── Action types (E.1.e.2 will consume) ──────────────────────────────────

/**
 * Reversible transfer-market action for the undo stack TransferMarketView
 * keeps in local state (E.1.e.2). Carries the full Player so undo can
 * restore the exact same record without rehydrating from the pool, and
 * the price so a refund/recharge round-trips exactly.
 */
export type TransferAction =
  | { kind: "buy"; player: Player; price: number }
  | { kind: "sell"; player: Player; price: number }
  | { kind: "expandStadium"; seats: number; price: number }
  | { kind: "runCampaign"; fanbase: number; momentum: number; price: number }
  // Sign a TV/sponsorship deal into the slot (takes effect next season). No
  // money delta — the revenue accrues per round. `previous` is the deal the new
  // one replaces (if any), captured for reverse.
  | { kind: "signDeal"; slot: "tv" | "sponsorship"; deal: Deal; previous?: Deal };

/** The roster the working career currently presents — the lazy-init the views
 *  used inline: `userRoster` once populated, else the registry default. Pure. */
function workingRoster(career: Career): Player[] {
  return career.userRoster.length === 0
    ? userTeam(career).roster.slice()
    : career.userRoster.slice();
}

/**
 * Apply a reversible transfer/commercial action to a career, returning the next
 * career. The single source of truth for the money + manager-state + roster +
 * transfer-history math, shared by the transfer market (buy/sell) and the
 * Finances screen (expandStadium/runCampaign) so the two can't drift. Pure;
 * callers are responsible for the `can*` gate before applying.
 *
 * `expandStadium`/`runCampaign` touch only `manager` (no TransferRecord — they
 * aren't player moves). `buy`/`sell` move money, the roster, and append a
 * TransferRecord; a sold player is lazy-pruned from `userTactics.bench`.
 */
export function applyTransferAction(career: Career, action: TransferAction): Career {
  switch (action.kind) {
    case "expandStadium":
      return {
        ...career,
        manager: {
          ...career.manager,
          money: career.manager.money - action.price,
          stadiumCapacity: career.manager.stadiumCapacity + action.seats,
        },
      };
    case "runCampaign":
      return {
        ...career,
        manager: {
          ...career.manager,
          money: career.manager.money - action.price,
          fanbase: career.manager.fanbase + action.fanbase,
          marketingMomentum: career.manager.marketingMomentum + action.momentum,
        },
      };
    case "buy": {
      const record: TransferRecord = {
        kind: "buy",
        playerName: action.player.name,
        position: action.player.position,
        price: action.price,
      };
      return {
        ...career,
        manager: { ...career.manager, money: career.manager.money - action.price },
        userRoster: [...workingRoster(career), action.player],
        currentSeason: {
          ...career.currentSeason,
          transfers: [...career.currentSeason.transfers, record],
        },
      };
    }
    case "sell": {
      const record: TransferRecord = {
        kind: "sell",
        playerName: action.player.name,
        position: action.player.position,
        price: action.price,
      };
      // Lazy-prune the sold id from the bench; the XI is hard-blocked by canSell.
      let userTactics = career.currentSeason.userTactics;
      if (userTactics?.bench.includes(action.player.id)) {
        userTactics = {
          ...userTactics,
          bench: userTactics.bench.filter((id) => id !== action.player.id),
        };
      }
      return {
        ...career,
        manager: { ...career.manager, money: career.manager.money + action.price },
        userRoster: workingRoster(career).filter((p) => p.id !== action.player.id),
        currentSeason: {
          ...career.currentSeason,
          transfers: [...career.currentSeason.transfers, record],
          userTactics,
        },
      };
    }
    case "signDeal":
      return {
        ...career,
        manager: {
          ...career.manager,
          activeDeals: {
            ...career.manager.activeDeals,
            [action.slot]: action.deal,
          },
        },
      };
  }
}

/**
 * Reverse the LAST-applied action (the undo). Inverse of
 * [`applyTransferAction`] for money/roster/manager state and pops the trailing
 * TransferRecord for buy/sell. The bench lazy-prune on a sell is intentionally
 * NOT restored: re-adding the player to the roster doesn't put them back on the
 * bench (same as a freshly bought player arriving outside the bench) — the user
 * re-slots via BenchEditor. Pure.
 */
export function reverseTransferAction(career: Career, action: TransferAction): Career {
  switch (action.kind) {
    case "expandStadium":
      return {
        ...career,
        manager: {
          ...career.manager,
          money: career.manager.money + action.price,
          stadiumCapacity: career.manager.stadiumCapacity - action.seats,
        },
      };
    case "runCampaign":
      return {
        ...career,
        manager: {
          ...career.manager,
          money: career.manager.money + action.price,
          fanbase: career.manager.fanbase - action.fanbase,
          marketingMomentum: career.manager.marketingMomentum - action.momentum,
        },
      };
    case "buy":
      return {
        ...career,
        manager: { ...career.manager, money: career.manager.money + action.price },
        userRoster: workingRoster(career).filter((p) => p.id !== action.player.id),
        currentSeason: {
          ...career.currentSeason,
          transfers: career.currentSeason.transfers.slice(0, -1),
        },
      };
    case "sell":
      return {
        ...career,
        manager: { ...career.manager, money: career.manager.money - action.price },
        userRoster: [...workingRoster(career), action.player],
        currentSeason: {
          ...career.currentSeason,
          transfers: career.currentSeason.transfers.slice(0, -1),
        },
      };
    case "signDeal":
      return {
        ...career,
        manager: {
          ...career.manager,
          activeDeals: {
            ...career.manager.activeDeals,
            // Restore the deal this one replaced (undefined ⇒ slot cleared).
            [action.slot]: action.previous,
          },
        },
      };
  }
}

/** Whether the club can expand the stadium right now (E.4.b.4): below the cap
 *  and enough cash for the next +STEP increment. */
export function canExpand(career: Career): CheckResult {
  if (career.manager.stadiumCapacity >= STADIUM_MAX_CAPACITY) {
    return { ok: false, reason: `Capacidade máxima (${STADIUM_MAX_CAPACITY})` };
  }
  if (career.manager.money < expansionCost(career.manager.stadiumCapacity)) {
    return { ok: false, reason: "Dinheiro insuficiente" };
  }
  return { ok: true };
}

/** Whether the club can run a marketing campaign now (E.4.b.5): below the
 *  momentum cap and enough cash for the next campaign. */
export function canMarket(career: Career): CheckResult {
  if (career.manager.marketingMomentum >= MARKETING_MOMENTUM_MAX) {
    return { ok: false, reason: "Marketing no limite" };
  }
  if (career.manager.money < marketingCost(career.manager.marketingMomentum)) {
    return { ok: false, reason: "Dinheiro insuficiente" };
  }
  return { ok: true };
}
