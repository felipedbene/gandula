import { openDB, type IDBPDatabase } from "idb";
import type { Formation, SeasonRecord, Tactics } from "./types";

/**
 * IndexedDB persistence for the in-progress Elifoot-mode career.
 *
 * Single save slot — exactly one Career-in-progress at a time, replacing
 * whatever was there before. Schema is versioned via `schemaVersion` inside
 * the payload so future migrations can branch on it; the DB-level
 * `DB_VERSION` only governs object-store layout, not record shape.
 *
 * Schema history:
 *   - v1 (pre-E.1.a): single record + currentRoundIdx. Discarded on load.
 *   - v2 (E.1.a): divisions[]. Auto-migrated to v3 by `loadCareer`.
 *   - v3 (E.1.c): Career wrapping currentSeason + seasons[] history.
 *
 * Storage strategy: each division's SeasonRecord is simulated upfront and
 * persisted whole. `currentRoundIdx` on each Division tracks how many
 * rounds have been "revealed" to the user — the spoiler sits in IDB the
 * whole time; gameplay illusion is purely a reveal cursor over a frozen
 * record.
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
 * a Season, the team is used as-is from the JSON registry. When defined,
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
 * running in parallel. The user plays in exactly one of them per season.
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
  /** 0-indexed; equals `totalRoundsOf(div)` once the division is done. */
  currentRoundIdx: number;
};

// ─── Schema v3 (E.1.c) — Career multi-temporada ──────────────────────────

/** First year of any new career. Subsequent seasons increment by 1.
 *  Chosen to reflect "current year + a little" so the Brasileirão
 *  Imaginário feels like a near-future fictional league. */
export const FIRST_YEAR = 2026;

/**
 * A career season in progress. Mirrors the v2 SavedSeason payload minus
 * the career-level fields (schemaVersion, seed, controlledTeamId — those
 * live on Career). Adds `year` and a per-season `seed` derived from the
 * career seed.
 *
 * Per-season seed: `career.seed XOR BigInt(year)`. Combines with the
 * per-tier XOR (`divSeed = season.seed XOR BigInt(tier)` in run_season /
 * resimulate) to give every (career, year, tier) combination a unique
 * match-seed namespace.
 */
export type Season = {
  year: number;
  /** Derived: `career.seed XOR BigInt(year)`. Stored explicitly so
   *  resimulate doesn't need to know the parent career. */
  seed: bigint;
  divisions: Division[];
  userTactics?: UserTactics;
};

/**
 * Compact summary of a finished season. Kept on `Career.seasons[]` to
 * support a "previous seasons" history view without bloating storage —
 * full match logs from past seasons would balloon IDB quickly across a
 * long career (~128 matches × ~20 events × 10+ seasons).
 *
 * What's preserved: champion, user's outcome, P/R applied. What's lost:
 * fixtures, individual match results, player stats, standings beyond the
 * top of each division. If we ever want a "view 2026 final standings"
 * feature, that'll need a richer history shape — call it E.future.
 */
export type SeasonHistory = {
  year: number;
  /** Division the user finished in (before P/R applied). */
  userDivision: { tier: 1 | 2; name: string };
  /** 1-based position in userDivision's final standings. */
  userPosition: number;
  userPoints: number;
  /** Champion of the user's division. Cross-division champions
   *  (e.g. the Série A champion when user was in Série B) aren't
   *  tracked — Elifoot-style focus on the user's own story. */
  champion: { tier: 1 | 2; teamId: number; teamName: string };
  /** Teams that earned promotion to Série A this season. */
  promoted: Array<{ teamId: number; teamName: string }>;
  /** Teams that got relegated to Série B this season. */
  relegated: Array<{ teamId: number; teamName: string }>;
  /** What happened to the user as a result of this season's P/R. */
  userOutcome: "promoted" | "relegated" | "stayed";
};

/**
 * Top-level career save. One per user, persisted in IDB under SLOT_KEY.
 *
 * `seasons` holds FINISHED seasons as compact histories; `currentSeason`
 * holds the in-progress one (mutable, has divisions with currentRoundIdx).
 *
 * `manager` (reputation, money) intentionally omitted in E.1.c — adds in
 * E.1.d when finances ship. Schema bump to v4 will be in-place migration
 * with default values.
 */
export type Career = {
  schemaVersion: 3;
  savedAt: string;
  /** User-provided base seed. Stable across the entire career. Each season
   *  derives its own seed via `seed XOR BigInt(year)`. */
  seed: bigint;
  /** Constant across the career (E.1.c) — user manages the same team the
   *  whole time, even after promotion/relegation. E.1.e (firing) is what
   *  will eventually mutate this. */
  controlledTeamId: number;
  /** Finished seasons in chronological order (oldest first, newest last). */
  seasons: SeasonHistory[];
  /** Season currently being played. */
  currentSeason: Season;
};

/**
 * Legacy v2 payload shape. Kept exported because `migrateV2toV3` (and its
 * tests) consume it — UI code never touches it directly. After enough
 * time has passed that no v2 saves exist in the wild, the migration code
 * and this type can be deleted together.
 */
export type SavedSeason = {
  schemaVersion: 2;
  savedAt: string;
  seed: bigint;
  controlledTeamId: number;
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

// ─── Load / save / clear / migrate (v3) ──────────────────────────────────

/**
 * Result of `loadCareer`. Discriminated with four kinds:
 *   - `loaded`: a v3 Career was read directly.
 *   - `migratedV2`: a v2 SavedSeason was found and converted in-place to
 *     v3 (the migrated Career is persisted before returning). User's
 *     progress is preserved.
 *   - `discardedV1`: a v1 payload (no division info) was found and
 *     deleted. No migration possible.
 *   - `none`: empty slot.
 */
export type LoadCareerResult =
  | { kind: "loaded"; career: Career }
  | { kind: "migratedV2"; career: Career }
  | { kind: "discardedV1" }
  | { kind: "none" };

/**
 * Read the current career. Handles three eras of payloads:
 *   - v3 (current): returned as-is.
 *   - v2 (E.1.a — divisions but no career wrapping): migrated in-place
 *     to a v3 Career with `seasons: []` and currentSeason wrapping the
 *     v2 divisions. The migrated career is persisted before returning,
 *     so subsequent loads return `kind: "loaded"`.
 *   - v1 (pre-E.1.a — no division info): discarded. User starts fresh.
 *
 * Empty slot returns `kind: "none"`.
 */
export async function loadCareer(): Promise<LoadCareerResult> {
  const conn = await db();
  const value = await conn.get(STORE, SLOT_KEY);
  if (!value) return { kind: "none" };
  const candidate = value as { schemaVersion?: number };

  if (candidate.schemaVersion === 3) {
    return { kind: "loaded", career: value as Career };
  }
  if (candidate.schemaVersion === 2) {
    const career = migrateV2toV3(value as SavedSeason);
    await conn.put(STORE, career, SLOT_KEY);
    return { kind: "migratedV2", career };
  }
  await conn.delete(STORE, SLOT_KEY);
  return { kind: "discardedV1" };
}

export async function saveCareer(c: Career): Promise<void> {
  const conn = await db();
  await conn.put(STORE, c, SLOT_KEY);
}

export async function clearCareer(): Promise<void> {
  const conn = await db();
  await conn.delete(STORE, SLOT_KEY);
}

/**
 * In-place migration of a v2 SavedSeason to a v3 Career. The v2 payload
 * becomes the `currentSeason` of a brand-new Career with `seasons: []`.
 *
 * Year for the migrated season is FIRST_YEAR (2026). The Career-level
 * `seed` carries v2's `seed` verbatim; the migrated Season's `seed` is
 * re-derived (`career.seed XOR BigInt(year)`).
 *
 * Drift note: this seed re-derivation means future re-simulations
 * (resimulate.ts) will use a different match-seed namespace than what
 * v2 used originally. BUT the drift is invisible to the user:
 *   - Already-played rounds are frozen in `record.matches` and never
 *     re-rolled — resimulate only re-runs from currentRoundIdx forward.
 *   - Rounds the user had NOT YET REVEALED at migration time will play
 *     out with new seeds if a re-sim is triggered after migration, but
 *     the user never saw the pre-migration versions of those matches,
 *     so there is no perceived inconsistency.
 *
 * Exported for tests; UI never calls this directly (loadCareer handles
 * the migration path).
 */
export function migrateV2toV3(v2: SavedSeason): Career {
  return {
    schemaVersion: 3,
    savedAt: v2.savedAt,
    seed: v2.seed,
    controlledTeamId: v2.controlledTeamId,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: v2.seed ^ BigInt(FIRST_YEAR),
      divisions: v2.divisions,
      userTactics: v2.userTactics,
    },
  };
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
 * Locate the user's division within a Season. Throws when the team isn't
 * in any division's standings — that's a save invariant violation, not a
 * runtime expected case. Used by every UI/util path that needs to single
 * out the user's tier from `currentSeason.divisions`.
 */
export function findUserDivisionIdxInSeason(
  season: Season,
  controlledTeamId: number,
): number {
  const idx = season.divisions.findIndex((d) =>
    d.record.standings.some((s) => s.team_id === controlledTeamId),
  );
  if (idx < 0) {
    throw new Error(
      `Controlled team ${controlledTeamId} not in any division standings`,
    );
  }
  return idx;
}
