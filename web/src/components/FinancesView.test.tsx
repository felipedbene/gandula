// Component test for the transactional Finances screen: expanding the stadium
// debits money + raises capacity in the working draft, Desfazer reverts it, and
// Fechar commits the working career via onClose. WASM-backed so runway/demand
// helpers run against a real season.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../test-utils";
import init, { run_season } from "../wasm/gandula_wasm.js";
import FinancesView from "./FinancesView";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import { expansionCost, STADIUM_EXPANSION_STEP } from "../util/finances";
import { freshCopa } from "../util/copa";
import { FIRST_YEAR, type Career } from "../persistence";
import { ALL_TEAMS } from "../teams";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  await init({ module_or_path: readFileSync(WASM_PATH) });
});

// A mid-season career (Série C at round 0) with plenty of cash so expansion is
// affordable and below the capacity cap.
function makeCareer(): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seasonSeed = 1998n ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const tot = (r: SeasonRecord) => Math.max(...r.fixtures.map((f) => f.round)) + 1;
  return {
    schemaVersion: 11,
    savedAt: "2026-01-01T00:00:00Z",
    seed: 1998n,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: tot(recordA) },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: tot(recordB) },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: 50_000_000, stadiumCapacity: 12_000, fanbase: 10_000, marketingMomentum: 0 },
    userRoster: [],
  };
}

describe("FinancesView (transactional)", () => {
  it("expanding the stadium debits money and raises capacity; Fechar commits it", () => {
    const career = makeCareer();
    const onClose = vi.fn();
    render(<FinancesView career={career} onClose={onClose} />);

    const cost = expansionCost(career.manager.stadiumCapacity);
    fireEvent.click(screen.getByRole("button", { name: /ampliar/i }));
    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));

    expect(onClose).toHaveBeenCalledOnce();
    const committed: Career = onClose.mock.calls[0][0];
    expect(committed.manager.stadiumCapacity).toBe(
      career.manager.stadiumCapacity + STADIUM_EXPANSION_STEP,
    );
    expect(committed.manager.money).toBe(career.manager.money - cost);
  });

  it("Desfazer reverts a pending expansion; Fechar then commits the original", () => {
    const career = makeCareer();
    const onClose = vi.fn();
    render(<FinancesView career={career} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /ampliar/i }));
    fireEvent.click(screen.getByRole("button", { name: /desfazer/i }));
    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));

    const committed: Career = onClose.mock.calls[0][0];
    expect(committed.manager.stadiumCapacity).toBe(career.manager.stadiumCapacity);
    expect(committed.manager.money).toBe(career.manager.money);
  });

  it("a read-only open (no actions) commits the career unchanged", () => {
    const career = makeCareer();
    const onClose = vi.fn();
    render(<FinancesView career={career} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));
    const committed: Career = onClose.mock.calls[0][0];
    expect(committed.manager.money).toBe(career.manager.money);
    expect(committed.manager.stadiumCapacity).toBe(career.manager.stadiumCapacity);
  });
});
