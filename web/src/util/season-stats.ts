import type { Match, MatchEventKind, SeasonRecord } from "../types";
import { teamById } from "../teams";

/**
 * Pure helpers that walk a finished SeasonRecord to derive the season's
 * highlight reel — top scorer, top assister, biggest win, card leader.
 * No engine work; everything's already in `record.matches[*].events`.
 *
 * All helpers are deterministic: equal records produce equal outputs, with
 * ties broken by lowest player_id (or fixture index for matches) so the
 * same seed always yields the same highlights.
 *
 * Each helper returns `null` when there's nothing to report (e.g. league
 * with zero goals). SeasonFinale omits the corresponding bullet — no
 * placeholder dashes or "n/a".
 */

export type PlayerInfo = { name: string; teamName: string };

export type TopScorer = PlayerInfo & { playerId: number; goals: number };
export type TopAssister = PlayerInfo & { playerId: number; assists: number };
export type CardLeader = PlayerInfo & { playerId: number; yellow: number; red: number };
export type BiggestWin = { match: Match; round: number; margin: number };

/**
 * Map every player on every team in this season to their `(name, teamName)`.
 * Built once per finale render via `useMemo`. Walks `record.standings` to
 * derive which teams actually played — handles custom team selections
 * without dragging in the full ALL_TEAMS roster.
 */
export function buildPlayerLookup(record: SeasonRecord): Map<number, PlayerInfo> {
  const map = new Map<number, PlayerInfo>();
  for (const s of record.standings) {
    const team = teamById(s.team_id);
    if (!team) continue;
    for (const player of team.roster) {
      map.set(player.id, { name: player.name, teamName: team.name });
    }
  }
  return map;
}

// Type guards over the serde-tagged variant shape.
function isGoal(k: MatchEventKind): k is { Goal: { scorer: number; assist: number | null } } {
  return typeof k !== "string" && "Goal" in k;
}
function isYellow(k: MatchEventKind): k is { YellowCard: { player: number } } {
  return typeof k !== "string" && "YellowCard" in k;
}
function isRed(k: MatchEventKind): k is { RedCard: { player: number } } {
  return typeof k !== "string" && "RedCard" in k;
}

/**
 * Resolve the (id, score) tuple with the highest score, ties broken by
 * lowest id. Returns null when the counts map is empty.
 */
function pickBest(counts: Map<number, number>): { id: number; score: number } | null {
  let best: { id: number; score: number } | null = null;
  for (const [id, score] of counts) {
    if (best === null || score > best.score || (score === best.score && id < best.id)) {
      best = { id, score };
    }
  }
  return best;
}

export function topScorer(
  record: SeasonRecord,
  lookup: Map<number, PlayerInfo>,
): TopScorer | null {
  const counts = new Map<number, number>();
  for (const match of record.matches) {
    for (const e of match.events) {
      if (isGoal(e.kind)) {
        const id = e.kind.Goal.scorer;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  const best = pickBest(counts);
  if (best === null) return null;
  const info = lookup.get(best.id);
  if (!info) return null;
  return { playerId: best.id, name: info.name, teamName: info.teamName, goals: best.score };
}

export function topAssister(
  record: SeasonRecord,
  lookup: Map<number, PlayerInfo>,
): TopAssister | null {
  const counts = new Map<number, number>();
  for (const match of record.matches) {
    for (const e of match.events) {
      if (isGoal(e.kind) && e.kind.Goal.assist !== null) {
        const id = e.kind.Goal.assist;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  const best = pickBest(counts);
  if (best === null) return null;
  const info = lookup.get(best.id);
  if (!info) return null;
  return { playerId: best.id, name: info.name, teamName: info.teamName, assists: best.score };
}

export function biggestWin(record: SeasonRecord): BiggestWin | null {
  let best: BiggestWin | null = null;
  record.fixtures.forEach((f, i) => {
    const m = record.matches[i];
    if (!m) return;
    const margin = Math.abs(m.result.home_goals - m.result.away_goals);
    if (best === null || margin > best.margin) {
      best = { match: m, round: f.round, margin };
    }
  });
  return best;
}

export function cardLeader(
  record: SeasonRecord,
  lookup: Map<number, PlayerInfo>,
): CardLeader | null {
  const yellow = new Map<number, number>();
  const red = new Map<number, number>();
  const total = new Map<number, number>();
  for (const match of record.matches) {
    for (const e of match.events) {
      if (isYellow(e.kind)) {
        const id = e.kind.YellowCard.player;
        yellow.set(id, (yellow.get(id) ?? 0) + 1);
        total.set(id, (total.get(id) ?? 0) + 1);
      } else if (isRed(e.kind)) {
        const id = e.kind.RedCard.player;
        red.set(id, (red.get(id) ?? 0) + 1);
        total.set(id, (total.get(id) ?? 0) + 1);
      }
    }
  }
  const best = pickBest(total);
  if (best === null) return null;
  const info = lookup.get(best.id);
  if (!info) return null;
  return {
    playerId: best.id,
    name: info.name,
    teamName: info.teamName,
    yellow: yellow.get(best.id) ?? 0,
    red: red.get(best.id) ?? 0,
  };
}
