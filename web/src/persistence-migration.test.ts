// Tests for the v6 persistence layer. The E.2 three-tier expansion is a hard
// break: every pre-v6 save is discarded on load (no migration cascade — see
// loadCareer in persistence.ts), so these tests confirm the wipe behavior and
// the v6 fast path. Integration tests exercise the real IDB code path via
// `fake-indexeddb` (in-memory IndexedDB polyfill, registered globally via the
// `auto` side-effect import below).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  clearCareer,
  loadCareer,
  saveCareer,
  type Career,
} from "./persistence";
import { freshCopa } from "./util/copa";

// Same IDB coords as persistence.ts. We hit the DB directly here to seed
// pre-v6 payloads so loadCareer can exercise the discard path.
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

function makeV8Career(opts: { seed: bigint; controlledTeamId: number }): Career {
  return {
    schemaVersion: 8,
    savedAt: "2026-01-01T00:00:00Z",
    seed: opts.seed,
    controlledTeamId: opts.controlledTeamId,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: opts.seed ^ BigInt(FIRST_YEAR),
      divisions: [],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
  };
}

describe("loadCareer", () => {
  beforeEach(async () => {
    await clearCareer();
  });

  it("returns kind:'none' when slot is empty", async () => {
    const result = await loadCareer();
    expect(result.kind).toBe("none");
  });

  it("returns kind:'loaded' when a v8 Career is present", async () => {
    await saveCareer(makeV8Career({ seed: 1998n, controlledTeamId: 60 }));
    const result = await loadCareer();
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.career.controlledTeamId).toBe(60);
      expect(result.career.manager.money).toBe(STARTING_MONEY);
      expect(result.career.userRoster).toEqual([]);
    }
  });

  // A v6 save (3-tier world, but pre-Copa: no currentSeason.copa) is no longer
  // discarded — it migrates forward. loadCareer returns kind:'migratedV6' and
  // the caller fills in the Copa via initCopaForSeason + re-saves as v7.
  it("returns kind:'migratedV6' for a v6 save (3-tier, no copa)", async () => {
    await writeRaw({
      schemaVersion: 6,
      savedAt: "2026-01-01T00:00:00Z",
      seed: 1998n,
      controlledTeamId: 60,
      seasons: [],
      currentSeason: {
        year: FIRST_YEAR,
        seed: 1998n ^ BigInt(FIRST_YEAR),
        divisions: [
          { tier: 1, name: "Série A", record: {}, currentRoundIdx: 0 },
          { tier: 2, name: "Série B", record: {}, currentRoundIdx: 0 },
          { tier: 3, name: "Série C", record: {}, currentRoundIdx: 0 },
        ],
        transfers: [],
      },
      manager: { money: STARTING_MONEY },
      userRoster: [],
    });
    const result = await loadCareer();
    expect(result.kind).toBe("migratedV6");
  });

  // A v7 save (3-tier world WITH copa, but pre-stadium: manager has no
  // stadiumCapacity/fanbase) migrates forward. loadCareer returns
  // kind:'migratedV7' and the caller seeds the stadium fields by tier and
  // re-saves as v8.
  it("returns kind:'migratedV7' for a v7 save (copa, no stadium fields)", async () => {
    await writeRaw({
      schemaVersion: 7,
      savedAt: "2026-01-01T00:00:00Z",
      seed: 1998n,
      controlledTeamId: 60,
      seasons: [],
      currentSeason: {
        year: FIRST_YEAR,
        seed: 1998n ^ BigInt(FIRST_YEAR),
        divisions: [
          { tier: 1, name: "Série A", record: {}, currentRoundIdx: 0 },
          { tier: 2, name: "Série B", record: {}, currentRoundIdx: 0 },
          { tier: 3, name: "Série C", record: {}, currentRoundIdx: 0 },
        ],
        transfers: [],
        copa: { rounds: [], currentCupRoundIdx: 0 },
      },
      manager: { money: STARTING_MONEY },
      userRoster: [],
    });
    const result = await loadCareer();
    expect(result.kind).toBe("migratedV7");
  });

  // Every pre-v6 schema (v2 2-tier saves, v3/v4/v5 careers, and v1-like
  // garbage) is discarded uniformly — the world expanded and a 2-tier career
  // can't be inflated into the 60-team / 3-tier world.
  it.each([
    ["v2 (2-tier SavedSeason)", { schemaVersion: 2, divisions: [{ tier: 1 }, { tier: 2 }] }],
    ["v5 (2-tier Career)", { schemaVersion: 5, controlledTeamId: 201, currentSeason: {} }],
    ["v1-like (no schemaVersion)", { savedAt: "2025", record: {} }],
  ])("discards a pre-v6 payload: %s", async (_label, payload) => {
    await writeRaw({ savedAt: "2025-01-01T00:00:00Z", seed: 1n, ...payload });

    const first = await loadCareer();
    expect(first.kind).toBe("expandedWorld");

    // The slot was cleared, so a second load sees an empty slot.
    const second = await loadCareer();
    expect(second.kind).toBe("none");
  });
});
