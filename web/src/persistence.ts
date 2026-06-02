import { openDB, type IDBPDatabase } from "idb";
import type {
  Formation,
  Match,
  Player,
  Position,
  SeasonRecord,
  Tactics,
} from "./types";

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
 *   - v2 (E.1.a): divisions[]. Auto-migrated via cascade v2→v3→v4→v5.
 *   - v3 (E.1.c): Career wrapping currentSeason + seasons[] history.
 *   - v4 (E.1.d): adds Manager (money) + SeasonHistory money fields.
 *   - v5 (E.1.e): adds Career.userRoster + Season/SeasonHistory transfers.
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
 * Imaginário has three tiers — Série A / B / C, 20 teams each — running in
 * parallel. The user plays in exactly one of them per season.
 *
 * Each division carries its own pre-simulated SeasonRecord plus a
 * per-division `currentRoundIdx`. All three tiers have 20 teams (even), so
 * every division runs (20−1)·2 = 38 rounds with no byes.
 */
export type Division = {
  /** Tier index: 1 = Série A (top), 2 = Série B, 3 = Série C (bottom). */
  tier: 1 | 2 | 3;
  /** Display name: "Série A" / "Série B" / "Série C". */
  name: string;
  /** Pre-simulated schedule + matches + standings for this division. */
  record: SeasonRecord;
  /** 0-indexed; equals `totalRoundsOf(div)` once the division is done. */
  currentRoundIdx: number;
};

// ─── Schema v3/v4 (E.1.c / E.1.d) — Career multi-temporada + finanças ────

/** First year of any new career. Subsequent seasons increment by 1.
 *  Chosen to reflect "current year + a little" so the Brasileirão
 *  Imaginário feels like a near-future fictional league. */
export const FIRST_YEAR = 2026;

/** Starting balance for any new career. Raised to 2M (E.4.b.3) — the cheapest
 *  affordability knob: enough to fund a first strong buy without trivializing
 *  early survival (the prizes/floors are what move the title ceiling, not this
 *  one-time bump). A difficulty lever; gandula-rl (E.6) re-measures. Generic
 *  "moedas", not tied to any real currency. */
export const STARTING_MONEY = 2_000_000;

/**
 * Manager-level state that persists across the entire career, separate
 * from per-season divisions/standings. Cross-season because all of it
 * carries forward untouched (or drifts slowly) at the season boundary.
 */
export type Manager = {
  money: number;
  /** Seats in the home stadium (E.4.b.4). The player pays to grow this; it
   *  caps home-gate attendance (`min(demand, capacity)`). Carried forward
   *  unchanged each season — the accumulated investment. */
  stadiumCapacity: number;
  /** Supporters count (E.4.b.4). Drives gate demand (and, in future, marketing
   *  / sponsorship). Drifts slowly toward a tier+placement target each season;
   *  first-class state so the RL policy can observe and learn to grow it. */
  fanbase: number;
  /** Marketing momentum (E.4.b.5): a decaying bonus to the fanbase drift target
   *  that paid campaigns raise, so a campaign's effect persists a few seasons
   *  rather than snapping back. Halves each season; 0 when no campaign is
   *  active. */
  marketingMomentum: number;
};

/**
 * Single transfer-market transaction. Recorded as a flat summary (no
 * full Player snapshot) — undo within a market session lives in
 * TransferMarketView's local state (E.1.e.2), the persisted record only
 * needs to survive long enough to surface in HistoryCard. `position` is
 * here so the history line can group by role without rehydrating the
 * player from anywhere.
 */
export type TransferRecord = {
  kind: "buy" | "sell";
  playerName: string;
  position: Position;
  price: number;
};

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
// ─── Copa do Brasil — season-long knockout cup (E.3) ─────────────────────
//
// A 64-slot bracket over all 60 clubs, seeded by tier. The 4 strongest Série
// A clubs get a prelim bye; the other 56 play 28 prelim ties → 28 winners, so
// the round of 32 is 28 winners + 4 byes. Then 32→16→8→4→2→1. Six named
// rounds, each played on a mapped league round (util/copa.ts). Single match
// per tie; a drawn tie is decided by a deterministic seeded shootout. Pure
// TS over the engine's play_match — no engine knowledge of cups.

/** Penalty-shootout outcome for a drawn tie. `winnerId` ∈ {tie.homeId, awayId}. */
export type CupShootout = { homeGoals: number; awayGoals: number; winnerId: number };

/** One knockout tie, played over TWO LEGS (E.3.b): leg 1 at `homeId`, leg 2 at
 *  `awayId` (sides reversed). The winner is decided on aggregate, with the
 *  away-goals rule as the first tiebreak and a penalty shootout (on leg 2) as
 *  the last. `homeId`/`awayId` are TEAM IDS. A bye tie has `bye: true` and
 *  `awayId === COPA_BYE` — `homeId` auto-advances unplayed (no legs).
 *
 *  Schema note (v10): single-leg v9 ties are migrated by re-deriving the
 *  season's Copa (deterministic replay), so `leg2` is always present on a
 *  played non-bye tie from v10 on. */
export type CupTie = {
  homeId: number;
  awayId: number;
  bye?: boolean;
  played: boolean;
  /** Leg 1 — homeId hosts. Present once a non-bye tie is played. */
  match?: Match;
  /** Leg 2 — awayId hosts (sides reversed). Present once played (v10+). */
  leg2?: Match;
  /** Present only when the aggregate (with away goals) was level and a
   *  shootout decided it. Shot at leg 2's venue. */
  shootout?: CupShootout;
  /** Aggregate goals for the leg-1 home side (homeId) across both legs. */
  aggHome?: number;
  /** Aggregate goals for the leg-1 away side (awayId) across both legs. */
  aggAway?: number;
  /** Set once resolved (the advancing club). */
  winnerId?: number;
};

export type CupRoundName = "prelim" | "r32" | "r16" | "qf" | "sf" | "final";

export type CupRound = { name: CupRoundName; ties: CupTie[] };

/**
 * Copa state for one season. `rounds[0]` (prelim) is built in full at season
 * start; later rounds are appended as each round's winners resolve, so a
 * round's `ties.length` is the source of truth for "has this round been
 * drawn yet". `currentCupRoundIdx` is the next round to play.
 */
export type Copa = {
  rounds: CupRound[];
  currentCupRoundIdx: number;
  /** Set when the final resolves. */
  championId?: number;
  /** Round index at which the user's club was knocked out (undefined while
   *  still in, or if they win it). For the "you went out in the QF" UI. */
  userEliminatedAtRoundIdx?: number;
};

export type Season = {
  year: number;
  /** Derived: `career.seed XOR BigInt(year)`. Stored explicitly so
   *  resimulate doesn't need to know the parent career. */
  seed: bigint;
  divisions: Division[];
  userTactics?: UserTactics;
  /** Half-time tactical changes the user confirmed at the interval, keyed by
   *  the division round index the match was played in (v11+). Absent entry =
   *  no half-time change (the first-half `userTactics` carries through). This
   *  is what lets `resimulateFromRound` deterministically reproduce a match
   *  whose second half was steered live at half-time — a future re-sim or an
   *  F5 mid-reveal rebuilds the identical 90'. */
  halftimeTactics?: Record<number, UserTactics>;
  /** Copa do Brasil bracket for this season (E.3). Always present in v7+. */
  copa: Copa;
  /** Transfer-market activity accumulated during this season. Mercado
   *  abre na phase entre `finale` e the next season's `running`, so by
   *  the time `advanceCareer` runs these are the year-N transfers being
   *  copied into year-N's SeasonHistory. Always present (empty when no
   *  transfers happened) — required field so consumers don't need to
   *  defensively `?? []`. */
  transfers: TransferRecord[];
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
  userDivision: { tier: 1 | 2 | 3; name: string };
  /** 1-based position in userDivision's final standings. */
  userPosition: number;
  userPoints: number;
  /** Champion of the user's division. Cross-division champions
   *  (e.g. the Série A champion when user was in Série C) aren't
   *  tracked — Elifoot-style focus on the user's own story. */
  champion: { tier: 1 | 2 | 3; teamId: number; teamName: string };
  /** Teams that earned promotion this season, across both boundaries
   *  (Série B→A and Série C→B). */
  promoted: Array<{ teamId: number; teamName: string }>;
  /** Teams that got relegated this season, across both boundaries
   *  (Série A→B and Série B→C). */
  relegated: Array<{ teamId: number; teamName: string }>;
  /** What happened to the user as a result of this season's P/R. */
  userOutcome: "promoted" | "relegated" | "stayed";
  /** Net money change for this season (revenue − salaries + P/R bonus).
   *  Negative when costs outweigh earnings. Backfilled to 0 for seasons
   *  that existed before E.1.d. */
  moneyDelta: number;
  /** Manager.money AFTER this season's delta applied. Snapshot, so the
   *  history UI doesn't need to cumulative-sum across all prior entries.
   *  Backfilled to STARTING_MONEY for seasons that existed before E.1.d. */
  moneyAfter: number;
  /** Transfer-market activity that happened between this season and the
   *  next. Optional because (a) seasons that existed pre-E.1.e have no
   *  transfer data to backfill, and (b) skipping the market entirely
   *  leaves no record either way. UI treats absent and empty the same. */
  transfers?: TransferRecord[];
  /** Copa do Brasil champion this season (E.3). Optional — absent on
   *  seasons archived before the cup existed. */
  copaChampionId?: number;
  /** How far the user's club got in the Copa: the round they were knocked
   *  out at, or "champion" if they won it. Absent pre-E.3. */
  copaUserResult?: CupRoundName | "champion";
};

/**
 * Top-level career save. One per user, persisted in IDB under SLOT_KEY.
 *
 * `seasons` holds FINISHED seasons as compact histories; `currentSeason`
 * holds the in-progress one (mutable, has divisions with currentRoundIdx).
 * `manager` carries cross-season state (money, eventually reputation).
 */
export type Career = {
  schemaVersion: 11;
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
  /** Cross-season manager state. Always present in v4+ saves. */
  manager: Manager;
  /** User team's actual roster after transfer-market activity. Empty
   *  array means "use the JSON registry default" (fresh career; no
   *  transfers yet). Resolved everywhere by util/roster.ts userTeam(). */
  userRoster: Player[];
};

// Schema v6 (E.2 — three-tier pyramid) is a HARD break: the world grew from
// 17 teams / 2 tiers to 60 teams / 3 tiers, and an in-progress 2-tier career
// can't be honestly inflated into the new world (there's no defensible way to
// place 43 new clubs or assign tiers retroactively). So loadCareer discards
// every pre-v6 save and the caller auto-starts a fresh 3-tier career — no
// migration cascade, no legacy 2-tier code path anywhere. The old v2→v5
// migration functions and their intermediate types were removed with this
// break.

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
 * Result of `loadCareer`. Discriminated kinds:
 *   - `loaded`: a current (v10) Career was read directly.
 *   - `migratedV9`: a v9 save (single-leg Copa) — the caller re-derives the
 *     current season's Copa as two-leg (deterministic) and re-saves v10.
 *   - `migratedV8`: a v8 save (no marketingMomentum) — the caller seeds it to 0
 *     and re-saves v10.
 *   - `migratedV7`: a v7 save (no stadium/fanbase) — the caller seeds the
 *     stadium fields (+ momentum 0) from the user's tier and re-saves v9.
 *   - `migratedV6`: a v6 save (no Copa AND no stadium) — the caller adds the
 *     Copa, then seeds the stadium fields (+ momentum), re-saving v9.
 *   - `expandedWorld`: a pre-v6 save was found and discarded because the world
 *     expanded to three tiers (E.2). The caller starts a fresh career.
 *   - `none`: empty slot.
 *
 * All additive migrations (Copa, stadium, marketing) run in the caller
 * (SeasonView load effect), so persistence has no runtime dependency on
 * copa / finances.
 */
export type LoadCareerResult =
  | { kind: "loaded"; career: Career }
  | { kind: "migratedV10"; career: Career }
  | { kind: "migratedV9"; career: Career }
  | { kind: "migratedV8"; career: Career }
  | { kind: "migratedV7"; career: Career }
  | { kind: "migratedV6"; career: Career }
  | { kind: "expandedWorld" }
  | { kind: "none" };

/**
 * Read the current career.
 *   - v9 (current): returned as-is.
 *   - v8 (pre-marketing): `migratedV8` — the caller adds marketingMomentum 0.
 *   - v7 (pre-stadium): `migratedV7` — the caller adds the stadium fields.
 *   - v6 (pre-Copa): `migratedV6` — the caller adds the Copa AND the stadium
 *     fields, re-saving v9.
 *   - v1–v5: discarded — the E.2 three-tier expansion is a hard break
 *     (`expandedWorld`).
 *   - empty slot: `none`.
 */
export async function loadCareer(): Promise<LoadCareerResult> {
  const conn = await db();
  const value = await conn.get(STORE, SLOT_KEY);
  if (!value) return { kind: "none" };
  const candidate = value as { schemaVersion?: number };

  if (candidate.schemaVersion === 11) {
    return { kind: "loaded", career: value as Career };
  }
  if (candidate.schemaVersion === 10) {
    // Pre-half-time-tactics. Purely additive: `halftimeTactics` is optional and
    // absent means "no half-time change" — the caller just stamps v11 and
    // re-saves. No field to seed.
    return { kind: "migratedV10", career: value as unknown as Career };
  }
  if (candidate.schemaVersion === 9) {
    // Single-leg Copa ties (pre-E.3.b). The caller re-derives the current
    // season's Copa as two-leg (initCopaForSeason, a deterministic replay) and
    // re-saves v10. Finished-season histories are unaffected (the cup result is
    // a round name / "champion", leg structure isn't stored there).
    return { kind: "migratedV9", career: value as unknown as Career };
  }
  if (candidate.schemaVersion === 8) {
    // Lacks manager.marketingMomentum; the caller seeds it to 0.
    return { kind: "migratedV8", career: value as unknown as Career };
  }
  if (candidate.schemaVersion === 7) {
    // Lacks the stadium fields; the caller seeds them by tier (+ momentum 0).
    return { kind: "migratedV7", career: value as unknown as Career };
  }
  if (candidate.schemaVersion === 6) {
    // Lacks both currentSeason.copa AND the stadium fields; the caller fills
    // the Copa (initCopaForSeason) then seeds the stadium, re-saving v9.
    return { kind: "migratedV6", career: value as unknown as Career };
  }
  await conn.delete(STORE, SLOT_KEY);
  return { kind: "expandedWorld" };
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
