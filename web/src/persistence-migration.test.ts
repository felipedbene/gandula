// Tests for the v3 (Career) persistence layer + v2 → v3 migration. Pure
// unit tests for `migrateV2toV3` plus integration tests for `loadCareer`
// that exercise the real IDB code path via `fake-indexeddb` (in-memory
// IndexedDB polyfill, registered globally via the `auto` side-effect
// import below).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  clearCareer,
  loadCareer,
  migrateV2toV3,
  saveCareer,
  type Career,
  type SavedSeason,
} from "./persistence";
import type { Fixture, Match, SeasonRecord, TeamStats } from "./types";

// ─── Fixture builders ────────────────────────────────────────────────────

function ts(team_id: number): TeamStats {
  return {
    team_id,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
  };
}

function makeSeasonRecord(
  standings: TeamStats[],
  totalRounds: number,
): SeasonRecord {
  const fixtures: Fixture[] = Array.from({ length: totalRounds }, (_, i) => ({
    round: i,
    home_idx: 0,
    away_idx: 1,
  }));
  const matches: Match[] = fixtures.map(() => ({
    home: standings[0]?.team_id ?? 0,
    away: standings[1]?.team_id ?? 0,
    seed: 0n,
    result: { home_goals: 0, away_goals: 0 },
    events: [],
  }));
  return { league_name: "test", fixtures, matches, standings };
}

function makeV2Save(opts: {
  seed: bigint;
  controlledTeamId: number;
}): SavedSeason {
  return {
    schemaVersion: 2,
    savedAt: "2026-01-01T00:00:00Z",
    seed: opts.seed,
    controlledTeamId: opts.controlledTeamId,
    divisions: [
      {
        tier: 1,
        name: "Série A",
        record: makeSeasonRecord([ts(101), ts(102)], 14),
        currentRoundIdx: 7,
      },
      {
        tier: 2,
        name: "Série B",
        record: makeSeasonRecord([ts(opts.controlledTeamId), ts(202)], 18),
        currentRoundIdx: 5,
      },
    ],
  };
}

// Same IDB coords as persistence.ts. We hit the DB directly here to seed
// pre-v3 payloads so loadCareer can exercise the migration / discard paths.
const DB_NAME = "gandula";
const DB_VERSION = 1;
const STORE = "season";
const SLOT_KEY = "current";

async function writeRaw(value: unknown): Promise<void> {
  const conn = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
  await conn.put(STORE, value, SLOT_KEY);
}

// ─── Pure migration tests ────────────────────────────────────────────────

describe("migrateV2toV3", () => {
  it("wraps v2 into Career with seasons=[] and currentSeason", () => {
    const v2 = makeV2Save({ seed: 1998n, controlledTeamId: 201 });
    const v3 = migrateV2toV3(v2);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.seasons).toEqual([]);
    expect(v3.controlledTeamId).toBe(201);
    expect(v3.currentSeason.year).toBe(FIRST_YEAR);
    expect(v3.currentSeason.divisions).toBe(v2.divisions);
    expect(v3.currentSeason.userTactics).toBe(v2.userTactics);
  });

  it("preserves the v2 seed at career level", () => {
    const v2 = makeV2Save({ seed: 42n, controlledTeamId: 201 });
    const v3 = migrateV2toV3(v2);
    expect(v3.seed).toBe(42n);
  });

  it("derives season seed via career.seed XOR BigInt(year)", () => {
    const v2 = makeV2Save({ seed: 1998n, controlledTeamId: 201 });
    const v3 = migrateV2toV3(v2);
    expect(v3.currentSeason.seed).toBe(1998n ^ BigInt(FIRST_YEAR));
  });

  it("preserves savedAt timestamp", () => {
    const v2 = makeV2Save({ seed: 1n, controlledTeamId: 201 });
    const v3 = migrateV2toV3(v2);
    expect(v3.savedAt).toBe(v2.savedAt);
  });
});

// ─── Integration tests against fake-indexeddb ────────────────────────────

describe("loadCareer", () => {
  beforeEach(async () => {
    await clearCareer();
  });

  it("returns kind:'none' when slot is empty", async () => {
    const result = await loadCareer();
    expect(result.kind).toBe("none");
  });

  it("returns kind:'loaded' when a v4 Career is present", async () => {
    const career: Career = {
      schemaVersion: 4,
      savedAt: "2026-01-01T00:00:00Z",
      seed: 1998n,
      controlledTeamId: 201,
      seasons: [],
      currentSeason: {
        year: FIRST_YEAR,
        seed: 1998n ^ BigInt(FIRST_YEAR),
        divisions: [],
      },
      manager: { money: STARTING_MONEY },
    };
    await saveCareer(career);
    const result = await loadCareer();
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.career.controlledTeamId).toBe(201);
      expect(result.career.manager.money).toBe(STARTING_MONEY);
    }
  });

  it("cascades a v2 payload through v3 to v4 in one load", async () => {
    const v2 = makeV2Save({ seed: 1998n, controlledTeamId: 201 });
    await writeRaw(v2);

    const first = await loadCareer();
    // Kind preserves the original starting point even though the
    // cascade went v2 → v3 → v4 internally.
    expect(first.kind).toBe("migratedV2");
    if (first.kind === "migratedV2") {
      expect(first.career.schemaVersion).toBe(4);
      expect(first.career.controlledTeamId).toBe(201);
      expect(first.career.currentSeason.year).toBe(FIRST_YEAR);
      expect(first.career.currentSeason.divisions).toHaveLength(2);
      expect(first.career.manager.money).toBe(STARTING_MONEY);
    }

    // Second call must read the persisted v4 directly — proves the
    // cascade write hit the store.
    const second = await loadCareer();
    expect(second.kind).toBe("loaded");
  });

  it("migrates a v3 payload in place to v4", async () => {
    // Hand-write a v3-shaped payload (no manager, no money fields on
    // history) and confirm loadCareer upgrades it.
    const v3 = {
      schemaVersion: 3,
      savedAt: "2026-01-01T00:00:00Z",
      seed: 42n,
      controlledTeamId: 201,
      seasons: [],
      currentSeason: {
        year: FIRST_YEAR,
        seed: 42n ^ BigInt(FIRST_YEAR),
        divisions: [],
      },
    };
    await writeRaw(v3);

    const first = await loadCareer();
    expect(first.kind).toBe("migratedV3");
    if (first.kind === "migratedV3") {
      expect(first.career.schemaVersion).toBe(4);
      expect(first.career.controlledTeamId).toBe(201);
      expect(first.career.manager.money).toBe(STARTING_MONEY);
    }

    // Persisted as v4 — second load is the fast path.
    const second = await loadCareer();
    expect(second.kind).toBe("loaded");
  });

  it("backfills moneyDelta=0 and moneyAfter=STARTING_MONEY on v3 history entries", async () => {
    // v3 history entries had no money fields; the cascade backfills.
    const v3 = {
      schemaVersion: 3,
      savedAt: "2026-01-01T00:00:00Z",
      seed: 7n,
      controlledTeamId: 201,
      seasons: [
        {
          year: 2025,
          userDivision: { tier: 2, name: "Série B" },
          userPosition: 3,
          userPoints: 30,
          champion: { tier: 2, teamId: 209, teamName: "x" },
          promoted: [],
          relegated: [],
          userOutcome: "stayed",
        },
      ],
      currentSeason: {
        year: FIRST_YEAR,
        seed: 7n ^ BigInt(FIRST_YEAR),
        divisions: [],
      },
    };
    await writeRaw(v3);

    const result = await loadCareer();
    expect(result.kind).toBe("migratedV3");
    if (result.kind === "migratedV3") {
      expect(result.career.seasons).toHaveLength(1);
      expect(result.career.seasons[0].moneyDelta).toBe(0);
      expect(result.career.seasons[0].moneyAfter).toBe(STARTING_MONEY);
    }
  });

  it("discards a payload with no recognisable schemaVersion", async () => {
    const v1Like = {
      savedAt: "2025-01-01T00:00:00Z",
      seed: 1n,
      controlledTeamId: 201,
      record: {},
      currentRoundIdx: 0,
    };
    await writeRaw(v1Like);

    const first = await loadCareer();
    expect(first.kind).toBe("discardedV1");

    const second = await loadCareer();
    expect(second.kind).toBe("none");
  });
});
