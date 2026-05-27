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
