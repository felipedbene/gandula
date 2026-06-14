import type { Career, TransferRecord } from "../persistence";
import type { Player, Position } from "../types";
import { ALL_TEAMS, teamById } from "../teams";
import { userTeam } from "./roster";
import { MIN_ROSTER, playerOverall, playerPrice } from "./transfer-market";
import { mulberry32 } from "./prng";

// ─── E.7.b — rival poaching: other clubs bid for the user's stars ────────────
//
// At each pre-season a rival club may make a firm, premium bid for the user's
// best player. The manager can cash in (sell above market value) or hold on
// (the snubbed suitor leaves the player a touch disgruntled — a morale dent via
// the contracts overlay). Deterministic in (careerSeed, year, playerId) so F5 /
// re-sim reproduce the same bid. Complements the wage-demand system (#48):
// demands are the player pushing, poaching is a rival pulling.

/** Per-pre-season chance that a bid appears for the squad's best player. */
export const POACH_CHANCE = 0.4;
/** Premium over the player's sell value the rival pays: POACH_MIN..POACH_MAX. */
export const POACH_PREMIUM_MIN = 1.4;
export const POACH_PREMIUM_MAX = 2.0;
/** Morale lost when the user rejects a bid (the player wanted the move). */
export const REJECT_MORALE_HIT = 20;

const POACH_SALT = 0xb1d5n;

export type PoachBid = {
  playerId: number;
  name: string;
  position: Position;
  overall: number;
  fee: number;
  rivalId: number;
  rivalName: string;
};

/**
 * The pre-season poaching bid, if any. Picks the user's best player (by overall,
 * lower id breaking ties) and, on a deterministic roll, returns a premium bid
 * from a rival club. Returns null when: the squad is at the roster floor (can't
 * afford to lose anyone), the best player already had their pre-season resolved
 * this year (`lastNegotiatedYear`), or the roll declines. Pure.
 */
export function generatePoachBid(career: Career): PoachBid | null {
  const year = career.currentSeason.year;
  const roster = userTeam(career).roster;
  if (roster.length <= MIN_ROSTER) return null;

  const best = roster.reduce((a, b) =>
    playerOverall(b) > playerOverall(a) ||
    (playerOverall(b) === playerOverall(a) && b.id < a.id)
      ? b
      : a,
  );
  if (career.contracts?.[best.id]?.lastNegotiatedYear === year) return null;

  const rng = mulberry32(
    Number((career.seed ^ BigInt(year) ^ BigInt(best.id) ^ POACH_SALT) & 0xffffffffn),
  );
  if (rng() >= POACH_CHANCE) return null;

  const premium =
    POACH_PREMIUM_MIN + rng() * (POACH_PREMIUM_MAX - POACH_PREMIUM_MIN);
  const fee = Math.round(playerPrice(best, "sell") * premium);

  // A deterministic rival, never the user's own club.
  const rivals = ALL_TEAMS.filter((t) => t.id !== career.controlledTeamId);
  const rival = rivals[Math.floor(rng() * rivals.length)] ?? rivals[0];

  return {
    playerId: best.id,
    name: best.name,
    position: best.position,
    overall: playerOverall(best),
    fee,
    rivalId: rival.id,
    rivalName: teamById(rival.id)?.name ?? `Time ${rival.id}`,
  };
}

/** The user's effective roster as a mutable copy (registry default when the
 *  custom roster hasn't been materialized yet). Mirrors transfer-market's
 *  workingRoster so a poach sale and a market sale agree. */
function workingRoster(career: Career): Player[] {
  return career.userRoster.length === 0
    ? userTeam(career).roster.slice()
    : career.userRoster.slice();
}

/**
 * Accept the bid: the player leaves for the (premium) fee, recorded as a sell so
 * it surfaces in the season's transfer history. The contract entry is dropped.
 * Pure.
 */
export function acceptPoach(career: Career, bid: PoachBid): Career {
  const nextRoster = workingRoster(career).filter((p) => p.id !== bid.playerId);
  const record: TransferRecord = {
    kind: "sell",
    playerName: bid.name,
    position: bid.position,
    price: bid.fee,
  };
  const nextContracts = { ...(career.contracts ?? {}) };
  delete nextContracts[bid.playerId];
  return {
    ...career,
    userRoster: nextRoster,
    contracts: nextContracts,
    manager: { ...career.manager, money: career.manager.money + bid.fee },
    currentSeason: {
      ...career.currentSeason,
      transfers: [...career.currentSeason.transfers, record],
    },
  };
}

/**
 * Reject the bid: the player stays but is left disgruntled — a morale dent, and
 * the resolution is stamped with the year so no second bid lands for them this
 * pre-season. Pure.
 */
export function rejectPoach(career: Career, bid: PoachBid): Career {
  const prev = career.contracts?.[bid.playerId];
  return {
    ...career,
    contracts: {
      ...(career.contracts ?? {}),
      [bid.playerId]: {
        wageMultiplier: prev?.wageMultiplier ?? 1,
        morale: Math.max(0, (prev?.morale ?? 100) - REJECT_MORALE_HIT),
        lastNegotiatedYear: career.currentSeason.year,
      },
    },
  };
}
