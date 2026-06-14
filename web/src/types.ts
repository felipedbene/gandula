// Hand-written TS interfaces matching the JSON shapes produced by
// `gandula_core` via serde. Narrow: only what the UI uses.

export type Position = "GK" | "DEF" | "MID" | "FWD";
export type Formation = "F442" | "F433" | "F352" | "F4231";
export type Mentality =
  | "VeryDefensive"
  | "Defensive"
  | "Balanced"
  | "Attacking"
  | "VeryAttacking";
export type Tempo = "Slow" | "Normal" | "Fast";
export type Pressing = "Low" | "Medium" | "High";
export type Width = "Narrow" | "Normal" | "Wide";
export type Side = "Home" | "Away";

export interface Attributes {
  pace: number;
  technique: number;
  passing: number;
  defending: number;
  finishing: number;
  stamina: number;
}

export interface Player {
  id: number;
  name: string;
  age: number;
  position: Position;
  attributes: Attributes;
}

export interface Tactics {
  mentality: Mentality;
  tempo: Tempo;
  pressing: Pressing;
  width: Width;
}

export interface Team {
  id: number;
  name: string;
  roster: Player[];
  formation: Formation;
  tactics: Tactics;
  starting_xi: number[];
  bench?: number[];
}

export type NearMissKind = "Post" | "Crossbar" | "JustWide";

// MatchEventKind is a serde-tagged enum: an object with one key naming the
// variant and the variant's data inside.
export type MatchEventKind =
  | { Shot: { shooter: number; on_target: boolean } }
  | { Goal: { scorer: number; assist: number | null } }
  | { Foul: { offender: number; victim: number } }
  | { YellowCard: { player: number } }
  | { RedCard: { player: number } }
  | { Substitution: { off: number; on: number } }
  | { PenaltyAwarded: { taker: number } }
  | { PenaltyMissed: { taker: number } }
  | { NearMiss: { shooter: number; kind: NearMissKind } }
  | "HalfTime"
  | "FullTime";

export interface MatchEvent {
  minute: number;
  side: Side | null;
  kind: MatchEventKind;
  text: string;
}

export interface MatchResult {
  home_goals: number;
  away_goals: number;
}

export interface Match {
  home: number;
  away: number;
  // u64 — comes through as BigInt because per-match derived seeds exceed 2^53.
  seed: bigint;
  result: MatchResult;
  events: MatchEvent[];
}

/** A half-time substitution: take `off` (an on-field player) out, bring `on`
 *  (a bench player) in. Matches the engine's `HalfTimeSub` shape passed to
 *  `play_second_half`. */
export interface HalfTimeSub {
  off: number;
  on: number;
}

export interface Fixture {
  round: number;
  home_idx: number;
  away_idx: number;
}

export interface TeamStats {
  team_id: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
}

export interface SeasonRecord {
  league_name: string;
  fixtures: Fixture[];
  matches: Match[];
  standings: TeamStats[];
}

// Helpers for derived stats (kept here so the UI mirrors the Rust impl).
export function goalDifference(s: TeamStats): number {
  return s.goals_for - s.goals_against;
}

export function points(s: TeamStats): number {
  return s.won * 3 + s.drawn;
}

export function eventKindName(k: MatchEventKind): string {
  return typeof k === "string" ? k : Object.keys(k)[0];
}

/**
 * Partial standings derived on the fly from a subset of matches. Used by
 * the running-phase view to show classification after N rounds, where the
 * `SeasonRecord.standings` field would spoil the full season.
 *
 * Tiebreaker mirrors core/src/season/mod.rs:249-254 — Pts desc, GD desc,
 * GF desc, team_id asc. Don't invent a different order on the JS side.
 *
 * `teamIds` includes every team in the league (even ones with zero matches
 * so far) so the table never gains/loses rows as the season advances.
 */
export function computeStandings(
  matches: Match[],
  fixtures: Fixture[],
  upToRoundExclusive: number,
  teamIds: number[],
): TeamStats[] {
  const stats = new Map<number, TeamStats>();
  for (const id of teamIds) {
    stats.set(id, {
      team_id: id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
    });
  }
  fixtures.forEach((f, i) => {
    if (f.round >= upToRoundExclusive) return;
    const m = matches[i];
    if (!m) return;
    const home = stats.get(m.home);
    const away = stats.get(m.away);
    if (!home || !away) return;
    const hg = m.result.home_goals;
    const ag = m.result.away_goals;
    home.played += 1;
    away.played += 1;
    home.goals_for += hg;
    home.goals_against += ag;
    away.goals_for += ag;
    away.goals_against += hg;
    if (hg > ag) {
      home.won += 1;
      away.lost += 1;
    } else if (hg < ag) {
      away.won += 1;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
    }
  });
  return Array.from(stats.values()).sort((a, b) => {
    const dp = points(b) - points(a);
    if (dp !== 0) return dp;
    const dgd = goalDifference(b) - goalDifference(a);
    if (dgd !== 0) return dgd;
    const dgf = b.goals_for - a.goals_for;
    if (dgf !== 0) return dgf;
    return a.team_id - b.team_id;
  });
}
