import { openDB, type IDBPDatabase } from "idb";
import type { Formation, SeasonRecord, Tactics } from "./types";

/**
 * IndexedDB persistence for the in-progress Elifoot-mode career.
 *
 * Single save slot — exactly one career-in-progress at a time, replacing
 * whatever was there before. Schema is versioned via `schemaVersion` inside
 * the payload so future migrations can branch on it; the DB-level
 * `DB_VERSION` only governs object-store layout, not record shape.
 *
 * v2 (Fio E.1.a) introduces `divisions: Division[]`. Saves written under
 * v1 (single `record` + top-level `currentRoundIdx`) have no notion of
 * which division a team belonged to, so `loadSeason` discards them rather
 * than attempting a migration.
 *
 * Storage strategy: each division's SeasonRecord is simulated upfront at
 * save time and persisted whole. `currentRoundIdx` on each Division tracks
 * how many rounds have been "revealed" to the user — the spoiler sits in
 * IndexedDB the whole time; gameplay illusion is purely a reveal cursor
 * over a frozen record.
 *
 * BigInt support: `seed` is a u64 → `bigint` on the JS side. IndexedDB's
 * structured-clone codec supports BigInt natively in modern browsers
 * (Chrome 67+, Firefox 68+, Safari 14+); we rely on that and do not
 * stringify.
 */

const DB_NAME = "gandula";
const DB_VERSION = 1;
const STORE = "season";
const SLOT_KEY = "current";

/**
 * User's tactical overrides for their controlled team. When undefined on
 * SavedSeason, the team is used as-is from the JSON registry. When defined,
 * these fields override the JSON defaults at re-simulation time
 * (`util/resimulate.ts`). Stored as a complete object (not a diff) for
 * schema simplicity — applying it is straight field substitution.
 */
export type UserTactics = {
  formation: Formation;
  tactics: Tactics;
  starting_xi: number[];
  bench: number[];
};

/**
 * One competitive division within a career season. The Brasileirão
 * Imaginário has two tiers — Série A (top 8) and Série B (bottom 9) —
 * running in parallel. The user plays in exactly one of them per career.
 *
 * Each division carries its own pre-simulated SeasonRecord plus a
 * per-division `currentRoundIdx`. The fields are independent because
 * Série A finishes at round 14 (N=8 even → no byes) while Série B
 * continues through round 18 (N=9 odd → virtual BYE per turno).
 */
export type Division = {
  /** Tier index: 1 = Série A (top), 2 = Série B (bottom). Hardcoded for
   *  E.1.a — future tiers (Série C etc) extend this enumeration. */
  tier: 1 | 2;
  /** Display name: "Série A" or "Série B". */
  name: string;
  /** Pre-simulated schedule + matches + standings for this division. */
  record: SeasonRecord;
  /** 0-indexed; equals `totalRounds(record)` once the division is done. */
  currentRoundIdx: number;
};

export type SavedSeason = {
  /** Schema version. v1 saves (with top-level `record` + `currentRoundIdx`)
   *  are discarded on load — no migration path because v1 has no notion
   *  of which division a team belonged to. */
  schemaVersion: 2;
  savedAt: string;
  /** User-provided u64 seed for the career run. Per-division match seeds
   *  are derived via `seed XOR BigInt(division.tier)` so the two divisions
   *  never collide on fixture index in the engine's match_seed namespace. */
  seed: bigint;
  controlledTeamId: number;
  /** Always exactly the two divisions in E.1.a: [Série A, Série B].
   *  The user's controlledTeamId belongs to whichever division has it in
   *  `record.standings` (every team gets a TeamStats entry, even at
   *  zero matches — the engine guarantees this in `compute_standings`). */
  divisions: Division[];
  userTactics?: UserTactics;
};

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        // No keyPath — we pass the slot key explicitly on every put/get so
        // we never have to think about which field is the primary key.
        database.createObjectStore(STORE);
      }
    },
  });
}

/**
 * Result of `loadSeason`. Discriminated rather than just nullable so the
 * caller can distinguish "no save" from "v1 save discarded" and surface a
 * status message in the latter case.
 */
export type LoadResult =
  | { kind: "loaded"; save: SavedSeason }
  | { kind: "none" }
  | { kind: "discardedV1" };

/**
 * Read the current save. Returns `loaded` with a v2 SavedSeason; `none`
 * when the slot is empty; or `discardedV1` when a v1 payload was found
 * (we delete it in-place — v1 → v2 has no automatic migration because v1
 * has no notion of which division a team belonged to).
 */
export async function loadSeason(): Promise<LoadResult> {
  const conn = await db();
  const value = await conn.get(STORE, SLOT_KEY);
  if (!value) return { kind: "none" };
  const candidate = value as { schemaVersion?: number };
  if (candidate.schemaVersion !== 2) {
    await conn.delete(STORE, SLOT_KEY);
    return { kind: "discardedV1" };
  }
  return { kind: "loaded", save: value as SavedSeason };
}

export async function saveSeason(s: SavedSeason): Promise<void> {
  const conn = await db();
  await conn.put(STORE, s, SLOT_KEY);
}

export async function clearSeason(): Promise<void> {
  const conn = await db();
  await conn.delete(STORE, SLOT_KEY);
}

/**
 * Total rounds of a division — convenience helper that wraps the
 * `max(fixtures.round) + 1` shape this codebase uses everywhere.
 * Exported here because both UI and re-simulation paths need it.
 */
export function totalRoundsOf(div: Division): number {
  return div.record.fixtures.length === 0
    ? 0
    : Math.max(...div.record.fixtures.map((f) => f.round)) + 1;
}

/**
 * Find which division the controlled team belongs to. Throws when the
 * team isn't in any division's standings — that's a save invariant
 * violation, not a runtime expected case.
 */
export function findUserDivisionIdx(saved: SavedSeason): number {
  const idx = saved.divisions.findIndex((d) =>
    d.record.standings.some((s) => s.team_id === saved.controlledTeamId),
  );
  if (idx < 0) {
    throw new Error(
      `Controlled team ${saved.controlledTeamId} not in any division standings`,
    );
  }
  return idx;
}
