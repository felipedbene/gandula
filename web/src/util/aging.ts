import type { Player } from "../types";

// Player aging (E.2.a). Deterministic, no RNG — applied once per season at
// career advance. The match engine ignores age, so the *effect* comes from
// drifting the six attributes along an age curve; we cap age at the engine's
// validation ceiling so a long career never produces an out-of-range player.

/** Engine validates age ∈ 15..=50 (core/src/domain/player.rs); never exceed it. */
export const MAX_AGE = 50;
/** Aging-driven growth won't push an attribute past this. */
export const GROWTH_CAP = 90;
/** Aging-driven decline won't push an attribute below this. */
export const DECLINE_FLOOR = 25;

/**
 * Per-season attribute delta (applied uniformly to all six attributes) for a
 * player who is now `age`. Young players develop, prime is a plateau, and
 * veterans decline progressively. Applied incrementally each season, so the
 * cumulative effect over a career is the full curve (integer deltas → no
 * rounding drift).
 */
export function ageDelta(age: number): number {
  if (age < 23) return 1; // developing toward prime
  if (age <= 30) return 0; // prime plateau
  if (age <= 33) return -1;
  if (age <= 36) return -2;
  return -3; // 37+
}

/** Apply a delta to one attribute, clamped so growth can't exceed GROWTH_CAP
 *  and decline can't drop below DECLINE_FLOOR — but an attribute already past
 *  a bound is left where it is rather than yanked to it. */
function applyDelta(value: number, delta: number): number {
  if (delta > 0) return value >= GROWTH_CAP ? value : Math.min(GROWTH_CAP, value + delta);
  if (delta < 0) return value <= DECLINE_FLOOR ? value : Math.max(DECLINE_FLOOR, value + delta);
  return value;
}

/** Age a single player by one season: age+1 (capped at MAX_AGE) and every
 *  attribute drifted by `ageDelta(newAge)`. Pure — returns a new Player. */
export function agePlayer(p: Player): Player {
  const age = Math.min(MAX_AGE, p.age + 1);
  const delta = ageDelta(age);
  const a = p.attributes;
  return {
    ...p,
    age,
    attributes: {
      pace: applyDelta(a.pace, delta),
      technique: applyDelta(a.technique, delta),
      passing: applyDelta(a.passing, delta),
      defending: applyDelta(a.defending, delta),
      finishing: applyDelta(a.finishing, delta),
      stamina: applyDelta(a.stamina, delta),
    },
  };
}

/** Age every player in a roster by one season. Pure — new array, new players. */
export function ageRoster(roster: Player[]): Player[] {
  return roster.map(agePlayer);
}

/**
 * Age a roster by `seasons` whole seasons (E.2.a.2). Because aging is pure and
 * deterministic, applying it N times reproduces what an N-season-old roster
 * would be — so opponents (who reset to the immutable registry each season)
 * can be aged on the fly from their base rather than persisting per-team state.
 * `seasons <= 0` returns a fresh copy unchanged.
 */
export function applyAgingSeasons(roster: Player[], seasons: number): Player[] {
  let r = roster.map((p) => ({ ...p }));
  for (let i = 0; i < seasons; i++) r = ageRoster(r);
  return r;
}
