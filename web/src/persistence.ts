import { openDB, type IDBPDatabase } from "idb";
import type { SeasonRecord } from "./types";

/**
 * IndexedDB persistence for the in-progress Elifoot-mode season.
 *
 * Single save slot — exactly one season-in-progress at a time, replacing
 * whatever was there before. Schema is versioned via `schemaVersion: 1`
 * inside the payload so future migrations can branch on it; the DB-level
 * `DB_VERSION` only governs object-store layout, not record shape.
 *
 * Storage strategy — Caminho 2: the entire `SeasonRecord` is simulated
 * upfront at save time and persisted whole. `currentRoundIdx` tracks how
 * many rounds have been "revealed" to the controlled team during play.
 * That means the spoiler is sitting in IndexedDB the whole time; the
 * gameplay illusion is purely a reveal cursor over a frozen record.
 *
 * BigInt support: `seed` is a u64 → `bigint` on the JS side. IndexedDB's
 * structured-clone codec supports BigInt natively in modern browsers
 * (Chrome 67+, Firefox 68+, Safari 14+) — we rely on that and do not
 * stringify. If we ever need to support an environment without BigInt
 * structured-clone, switch to `seed.toString()` and parse back on load;
 * the field name stays the same.
 */

const DB_NAME = "gandula";
const DB_VERSION = 1;
const STORE = "season";
const SLOT_KEY = "current";

export type SavedSeason = {
  schemaVersion: 1;
  savedAt: string;            // ISO 8601 timestamp at last save
  seed: bigint;               // user-provided u64 seed for the season run
  controlledTeamId: number;   // which team the player is managing
  currentRoundIdx: number;    // 0-indexed, next round to reveal
  record: SeasonRecord;       // entire pre-simulated season
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

export async function loadSeason(): Promise<SavedSeason | null> {
  const conn = await db();
  const value = await conn.get(STORE, SLOT_KEY);
  return (value as SavedSeason | undefined) ?? null;
}

export async function saveSeason(s: SavedSeason): Promise<void> {
  const conn = await db();
  await conn.put(STORE, s, SLOT_KEY);
}

export async function clearSeason(): Promise<void> {
  const conn = await db();
  await conn.delete(STORE, SLOT_KEY);
}
