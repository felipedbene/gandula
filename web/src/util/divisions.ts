import type { Team } from "../types";

/** Top-tier division: 8 teams. With N even the engine produces
 *  (8 - 1) * 2 = 14 rounds and no byes. */
export const TIER_A_SIZE = 8;
/** Bottom-tier division: 9 teams. N odd ⇒ engine inserts a virtual BYE,
 *  schedule has 9 * 2 = 18 rounds, every team gets 2 byes (one per turno). */
export const TIER_B_SIZE = 9;

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
 * Split TIER_A_SIZE + TIER_B_SIZE teams into Série A (strongest) and
 * Série B (the rest), ranked by avgStrength.
 *
 * Deterministic: same teams + same starting_xi ⇒ same partition every
 * call. Tiebreak on equal avgStrength is lower team_id wins (goes to
 * Série A) so the partition is stable across rebuilds even if fictional
 * roster generation seeds change.
 */
export function divideIntoDivisions(teams: Team[]): {
  tierA: Team[];
  tierB: Team[];
} {
  const expected = TIER_A_SIZE + TIER_B_SIZE;
  if (teams.length !== expected) {
    throw new Error(
      `divideIntoDivisions expects ${expected} teams, got ${teams.length}`,
    );
  }
  const sorted = teams.slice().sort((a, b) => {
    const sa = avgStrength(a);
    const sb = avgStrength(b);
    if (sa !== sb) return sb - sa; // strength desc — strongest first
    return a.id - b.id; // tiebreak: lower id first
  });
  return {
    tierA: sorted.slice(0, TIER_A_SIZE),
    tierB: sorted.slice(TIER_A_SIZE),
  };
}

/**
 * Pick the team the player will manage at the start of a new career:
 * the weakest team in Série B by avgStrength. Tiebreak on highest
 * team_id (opposite of divideIntoDivisions') so the starter is always
 * the deterministic "last" entry of the strength-ascending tail.
 */
export function pickStarterTeam(tierB: Team[]): Team {
  if (tierB.length === 0) {
    throw new Error("pickStarterTeam: empty tierB");
  }
  return tierB.slice().sort((a, b) => {
    const sa = avgStrength(a);
    const sb = avgStrength(b);
    if (sa !== sb) return sa - sb; // strength asc — weakest first
    return b.id - a.id; // tiebreak: higher id last in sort
  })[0];
}
