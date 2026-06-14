import type { Career, PlayerContract } from "../persistence";
import type { Attributes, Player, Position } from "../types";
import { userTeam } from "./roster";
import { SALARY_PER_PLAYER_STRENGTH } from "./finances";
import { MIN_ROSTER, playerPrice } from "./transfer-market";
import { mulberry32 } from "./prng";

// ─── E.7 — player contracts: wage demands, temperament, departures ───────────
//
// At each pre-season (the finale, before advancing) a deterministic subset of
// the user's squad demands a raise. The manager accepts (the wage multiplier
// rides on top of the base derived wage from then on) or refuses — and refusing
// has teeth, scaled by the player's TEMPERAMENT:
//   - loyal     → sulks: a one-off attribute drop + a morale dent, but stays.
//   - mercenary → walks for a cash-in fee (unless the squad is at the roster
//                 floor, in which case they're stuck and sulk instead).
//
// Everything is a pure function of (careerSeed, year, playerId) so F5 / re-sim
// reproduce the same demands and the same temperaments. The wage data lives in
// career.contracts (optional, additive) — absent ⇒ base wage at full morale.

export type Temperament = "loyal" | "mercenary";

/** Fraction of players that are mercenaries (temperament is stable per id). */
export const MERCENARY_FRACTION = 0.35;
/** Per-player chance of raising a demand in a given pre-season. */
export const DEMAND_CHANCE = 0.3;
/** Demanded raise on top of the current multiplier: DEMAND_MIN..DEMAND_MAX. */
export const DEMAND_MIN_INCREMENT = 0.15;
export const DEMAND_MAX_INCREMENT = 0.4;
/** Hard ceiling on a player's wage multiplier — bounds runaway raises. */
export const MULTIPLIER_CAP = 2.5;
/** Morale lost when a demand is refused. */
export const DENY_MORALE_HIT = 30;
/** One-off per-attribute drop when a refused player sulks (floored at 1). */
export const SULK_ATTR_DROP = 2;

const TEMPERAMENT_SALT = 0x7e3a;
const DEMAND_SALT = 0xc04dn;

/** Stable temperament for a player, derived from the id alone so it never
 *  changes season to season. ~MERCENARY_FRACTION are mercenaries. */
export function deriveTemperament(playerId: number): Temperament {
  const roll = mulberry32((playerId ^ TEMPERAMENT_SALT) >>> 0)();
  return roll < MERCENARY_FRACTION ? "mercenary" : "loyal";
}

/** A player's base season wage — the implicit wage the finance model has always
 *  charged: avg attributes × SALARY_PER_PLAYER_STRENGTH. */
export function baseWage(player: Player): number {
  return avgAttributes(player) * SALARY_PER_PLAYER_STRENGTH;
}

function avgAttributes(player: Player): number {
  const a = player.attributes;
  return Math.round(
    (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
      6,
  );
}

/** Round a multiplier to 2 decimals so persisted values + display stay tidy. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WageDemand = {
  playerId: number;
  name: string;
  position: Position;
  temperament: Temperament;
  currentMultiplier: number;
  demandedMultiplier: number;
  currentWage: number;
  demandedWage: number;
};

/**
 * The wage demands for the current pre-season. One deterministic roll per user
 * player decides whether they demand and by how much. Players already resolved
 * this year (`lastNegotiatedYear === year`) or already at the multiplier cap are
 * skipped, so the list is stable across re-mounts / F5 and can only shrink as
 * the user resolves it. Sorted by demanded wage descending (biggest asks
 * first). Pure.
 */
export function generateWageDemands(career: Career): WageDemand[] {
  const year = career.currentSeason.year;
  const roster = userTeam(career).roster;
  const demands: WageDemand[] = [];

  for (const p of roster) {
    const contract = career.contracts?.[p.id];
    if (contract?.lastNegotiatedYear === year) continue;
    const currentMultiplier = contract?.wageMultiplier ?? 1;
    if (currentMultiplier >= MULTIPLIER_CAP) continue;

    const folded =
      (career.seed ^ BigInt(year) ^ BigInt(p.id) ^ DEMAND_SALT) & 0xffffffffn;
    const rng = mulberry32(Number(folded));
    if (rng() >= DEMAND_CHANCE) continue;

    const increment =
      DEMAND_MIN_INCREMENT +
      rng() * (DEMAND_MAX_INCREMENT - DEMAND_MIN_INCREMENT);
    const demandedMultiplier = Math.min(
      MULTIPLIER_CAP,
      round2(currentMultiplier + increment),
    );
    const base = baseWage(p);
    demands.push({
      playerId: p.id,
      name: p.name,
      position: p.position,
      temperament: deriveTemperament(p.id),
      currentMultiplier,
      demandedMultiplier,
      currentWage: Math.round(base * currentMultiplier),
      demandedWage: Math.round(base * demandedMultiplier),
    });
  }

  return demands.sort((a, b) => b.demandedWage - a.demandedWage);
}

/** Set a player's contract entry, preserving any other entries. */
function withContract(
  career: Career,
  playerId: number,
  contract: PlayerContract,
): Record<number, PlayerContract> {
  return { ...(career.contracts ?? {}), [playerId]: contract };
}

/**
 * Grant the demand: the player's wage multiplier jumps to `demandedMultiplier`,
 * morale resets to full, and the resolution is stamped with the year. Pure.
 */
export function acceptDemand(
  career: Career,
  playerId: number,
  demandedMultiplier: number,
): Career {
  return {
    ...career,
    contracts: withContract(career, playerId, {
      wageMultiplier: demandedMultiplier,
      morale: 100,
      lastNegotiatedYear: career.currentSeason.year,
    }),
  };
}

export type DenyOutcome =
  | { kind: "walked"; name: string; cashIn: number }
  | { kind: "sulk"; name: string; forced: boolean };

/**
 * Refuse the demand. A mercenary with room below the roster floor walks for a
 * sell-price cash-in; everyone else (loyal, or a mercenary stuck at the floor)
 * sulks — a one-off attribute drop and a morale dent. Materializes the user
 * roster from the registry on first mutation, mirroring the transfer market.
 * Returns the new Career plus a structured outcome for the status line. Pure.
 */
export function denyDemand(
  career: Career,
  playerId: number,
): { career: Career; outcome: DenyOutcome } {
  const year = career.currentSeason.year;
  // Materialize the roster so we can mutate this specific player (an empty
  // userRoster means "registry default" — copy it in before editing).
  const roster =
    career.userRoster.length > 0
      ? career.userRoster
      : userTeam(career).roster.slice();
  const player = roster.find((p) => p.id === playerId);
  if (!player) {
    // Nothing to do (shouldn't happen — demands come from this roster).
    return { career, outcome: { kind: "sulk", name: `#${playerId}`, forced: false } };
  }

  const temperament = deriveTemperament(playerId);
  const canWalk = temperament === "mercenary" && roster.length > MIN_ROSTER;

  if (canWalk) {
    const cashIn = playerPrice(player, "sell");
    const nextRoster = roster.filter((p) => p.id !== playerId);
    const nextContracts = { ...(career.contracts ?? {}) };
    delete nextContracts[playerId];
    return {
      career: {
        ...career,
        userRoster: nextRoster,
        contracts: nextContracts,
        manager: { ...career.manager, money: career.manager.money + cashIn },
      },
      outcome: { kind: "walked", name: player.name, cashIn },
    };
  }

  // Sulk: drop the player's attributes once and dent morale; they stay.
  const nextRoster = roster.map((p) =>
    p.id === playerId ? { ...p, attributes: dropAttributes(p.attributes) } : p,
  );
  const prevMorale = career.contracts?.[playerId]?.morale ?? 100;
  const currentMultiplier = career.contracts?.[playerId]?.wageMultiplier ?? 1;
  return {
    career: {
      ...career,
      userRoster: nextRoster,
      contracts: withContract(career, playerId, {
        wageMultiplier: currentMultiplier,
        morale: Math.max(0, prevMorale - DENY_MORALE_HIT),
        lastNegotiatedYear: year,
      }),
    },
    outcome: {
      kind: "sulk",
      name: player.name,
      forced: temperament === "mercenary",
    },
  };
}

/** Lower every attribute by SULK_ATTR_DROP, floored at 1 so a player never
 *  drops to 0/negative. Pure. */
function dropAttributes(a: Attributes): Attributes {
  const d = (v: number) => Math.max(1, v - SULK_ATTR_DROP);
  return {
    pace: d(a.pace),
    technique: d(a.technique),
    passing: d(a.passing),
    defending: d(a.defending),
    finishing: d(a.finishing),
    stamina: d(a.stamina),
  };
}
