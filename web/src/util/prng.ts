/**
 * Tiny deterministic PRNG for UI-side reveal ordering. Mulberry32 — single
 * 32-bit state, ~4G period, no external deps. Not crypto-grade; used only
 * for picking when each parallel-match scoreline appears during the round
 * reveal animation.
 *
 * Determinism contract: same `(seed, round)` pair always produces the same
 * sequence — F5 mid-reveal would replay identical reveal ordering (though
 * C3.3 opts to skip the animation entirely on reload, this property is
 * still load-bearing for any future "rewatch this round" feature).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` reveal minutes in [30, 89] for the non-user matches of a
 * single round. Seed combines the season's u64 seed with `round * 31`,
 * then folds the 64-bit value into a 32-bit seed for Mulberry32 via xor
 * of the high and low halves.
 *
 * Range rationale: minute 30 is the earliest a "natural" final scoreline
 * could appear in a broadcast feel; minute 89 keeps every other match
 * finishing before the user's match wraps at ~93' (the "último apito é o
 * seu" rule).
 */
export function revealMinutes(seed: bigint, round: number, count: number): number[] {
  const combined = seed ^ BigInt(round * 31);
  const lo = Number(combined & 0xffffffffn);
  const hi = Number((combined >> 32n) & 0xffffffffn);
  const rng = mulberry32((lo ^ hi) >>> 0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Uniform [30, 89] inclusive — 60 possible values.
    out.push(30 + Math.floor(rng() * 60));
  }
  return out;
}
