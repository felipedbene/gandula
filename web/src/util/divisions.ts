import type { Team } from "../types";

// Three tiers of 20 — Série A / B / C, 60 teams total. 20 is even, so the
// engine's circle-method schedule produces (20 - 1) * 2 = 38 rounds with NO
// byes in any tier (the old 9-team Série B had byes; that's gone).
/** Top-tier division: 20 teams. */
export const TIER_A_SIZE = 20;
/** Middle-tier division: 20 teams. Both promotes (to A) and is promoted-into
 *  (from C), and both relegates (to C) and is relegated-into (from A). */
export const TIER_B_SIZE = 20;
/** Bottom-tier division: 20 teams. New careers start here (weakest club). */
export const TIER_C_SIZE = 20;

/** Total teams across all tiers — the size divideIntoDivisions expects. */
export const WORLD_SIZE = TIER_A_SIZE + TIER_B_SIZE + TIER_C_SIZE;

/**
 * Average overall of a team's starting XI: per-player overall is the mean
 * of the six attributes, the team's number is the mean across the eleven
 * starters, rounded. Mirror of the inline avgStrength helpers in
 * PrepareView (D.1.d) — this is now the third caller, so the function
 * lives here as the single source of truth.
 */
export function avgStrength(team: Team): number {
  const starters = team.starting_xi
    .map((id) => team.roster.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  if (starters.length === 0) return 0;
  const sum = starters.reduce((acc, p) => {
    const a = p.attributes;
    return (
      acc +
      (a.pace + a.technique + a.passing + a.defending + a.finishing + a.stamina) /
        6
    );
  }, 0);
  return Math.round(sum / starters.length);
}

/**
 * Split WORLD_SIZE teams into three strength-ranked tiers — Série A
 * (strongest 20), Série B (next 20), Série C (weakest 20) — returned as
 * `[tierA, tierB, tierC]` (index 0 = strongest, == Division.tier − 1).
 *
 * The array shape (rather than named tierA/tierB/tierC) keeps later phases —
 * cup competitions, more tiers — additive: callers index by tier.
 *
 * Deterministic: same teams + same starting_xi ⇒ same partition every call.
 * Tiebreak on equal avgStrength is lower team_id wins (sorts higher) so the
 * partition is stable across rebuilds even if fictional roster seeds change.
 */
export function divideIntoDivisions(teams: Team[]): Team[][] {
  if (teams.length !== WORLD_SIZE) {
    throw new Error(
      `divideIntoDivisions expects ${WORLD_SIZE} teams, got ${teams.length}`,
    );
  }
  const sorted = teams.slice().sort((a, b) => {
    const sa = avgStrength(a);
    const sb = avgStrength(b);
    if (sa !== sb) return sb - sa; // strength desc — strongest first
    return a.id - b.id; // tiebreak: lower id first
  });
  return [
    sorted.slice(0, TIER_A_SIZE),
    sorted.slice(TIER_A_SIZE, TIER_A_SIZE + TIER_B_SIZE),
    sorted.slice(TIER_A_SIZE + TIER_B_SIZE),
  ];
}

/**
 * Pick the team the player will manage at the start of a new career:
 * the weakest team in the bottom tier (Série C) by avgStrength. Tiebreak on
 * highest team_id (opposite of divideIntoDivisions') so the starter is always
 * the deterministic "last" entry of the strength-ascending tail.
 */
export function pickStarterTeam(bottomTier: Team[]): Team {
  if (bottomTier.length === 0) {
    throw new Error("pickStarterTeam: empty bottom tier");
  }
  return bottomTier.slice().sort((a, b) => {
    const sa = avgStrength(a);
    const sb = avgStrength(b);
    if (sa !== sb) return sa - sb; // strength asc — weakest first
    return b.id - a.id; // tiebreak: higher id last in sort
  })[0];
}

/**
 * Pick the team the player manages at the start of a new career: any team
 * in the bottom tier (Série C), chosen at random. Intentionally
 * non-deterministic (Math.random) so every new career hands you a different
 * club instead of always the weakest. The season simulation stays fully
 * seed-deterministic — only which Série C team you control varies — and the
 * choice is persisted on the Career (controlledTeamId), so a reloaded career
 * is stable.
 */
export function pickRandomStarter(bottomTier: Team[]): Team {
  if (bottomTier.length === 0) {
    throw new Error("pickRandomStarter: empty bottom tier");
  }
  return bottomTier[Math.floor(Math.random() * bottomTier.length)];
}
