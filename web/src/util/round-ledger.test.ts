// @vitest-environment node
//
// Anti-drift guard for the per-round cash ledger (RevealRound's RoundLedger):
// the broken-out streams must sum EXACTLY to roundCashDelta — the money that
// actually moves manager.money each round. If finances.ts ever recomposes the
// delta differently, this fails before the UI can silently lie. Node env for
// the WASM init pattern (matches finances.test.ts).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, { run_season } from "../wasm/gandula_wasm.js";
import {
  homeTicketForRound,
  tvIncomeForRound,
  sponsorshipForRound,
  matchBonusForRound,
  salarySliceForRound,
  roundCashDelta,
} from "./finances";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  totalRoundsOf,
  findUserDivisionIdxInSeason,
  type Career,
} from "../persistence";
import { freshCopa } from "./copa";
import { ALL_TEAMS } from "../teams";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

function makeFinishedCareer(seed: bigint): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const totalA = Math.max(...recordA.fixtures.map((f) => f.round)) + 1;
  const totalB = Math.max(...recordB.fixtures.map((f) => f.round)) + 1;
  const totalC = Math.max(...recordC.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 11,
    savedAt: "2026-01-01T00:00:00Z",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: totalA },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: totalB },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: totalC },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: {
      money: STARTING_MONEY,
      stadiumCapacity: 12_000,
      fanbase: 10_000,
      marketingMomentum: 0,
    },
    userRoster: [],
  };
}

/** The five ledger lines, summed with the brief's signs (wages subtracted). */
function ledgerSum(career: Career, roundIdx: number): number {
  return (
    homeTicketForRound(career, roundIdx) +
    tvIncomeForRound(career, roundIdx) +
    sponsorshipForRound(career, roundIdx) +
    matchBonusForRound(career, roundIdx) -
    salarySliceForRound(career, roundIdx)
  );
}

/** Classify a round for the user's division: home / away / bye. */
function userVenue(career: Career, roundIdx: number): "home" | "away" | "bye" {
  const season = career.currentSeason;
  const div = season.divisions[findUserDivisionIdxInSeason(season, career.controlledTeamId)];
  for (let i = 0; i < div.record.fixtures.length; i++) {
    if (div.record.fixtures[i].round !== roundIdx) continue;
    const m = div.record.matches[i];
    if (m.home === career.controlledTeamId) return "home";
    if (m.away === career.controlledTeamId) return "away";
  }
  return "bye";
}

describe("round ledger (anti-drift)", () => {
  it("the ledger lines sum to roundCashDelta for every round, every seed", () => {
    for (const seed of [1998n, 7n, 2026n]) {
      const career = makeFinishedCareer(seed);
      const season = career.currentSeason;
      const div =
        season.divisions[findUserDivisionIdxInSeason(season, career.controlledTeamId)];
      const total = totalRoundsOf(div);
      for (let r = 0; r < total; r++) {
        expect(ledgerSum(career, r)).toBe(roundCashDelta(career, r));
      }
    }
  });

  it("covers home, away and (if any) bye rounds — the venues the ledger renders differently", () => {
    // Série C is odd-sized, so a bye round exists for some team each round; the
    // user's own bye may or may not occur, but home and away must both appear.
    const career = makeFinishedCareer(1998n);
    const season = career.currentSeason;
    const div =
      season.divisions[findUserDivisionIdxInSeason(season, career.controlledTeamId)];
    const total = totalRoundsOf(div);
    const venues = new Set<string>();
    for (let r = 0; r < total; r++) {
      venues.add(userVenue(career, r));
      // The invariant holds regardless of venue (re-asserted here so a venue
      // never slips through unchecked).
      expect(ledgerSum(career, r)).toBe(roundCashDelta(career, r));
    }
    expect(venues.has("home")).toBe(true);
    expect(venues.has("away")).toBe(true);
  });

  it("home rounds have a positive gate; away rounds have none", () => {
    const career = makeFinishedCareer(1998n);
    const season = career.currentSeason;
    const div =
      season.divisions[findUserDivisionIdxInSeason(season, career.controlledTeamId)];
    const total = totalRoundsOf(div);
    for (let r = 0; r < total; r++) {
      const gate = homeTicketForRound(career, r);
      if (userVenue(career, r) === "home") {
        expect(gate).toBeGreaterThan(0);
      } else {
        expect(gate).toBe(0); // away or bye → no gate line rendered
      }
    }
  });
});
