// Component test for TacticsView. Runs under happy-dom (the vitest default
// env — see vitest.config.ts) since rendering React needs a DOM. The wasm
// binary is loaded via the file-anchor pattern; this is a .tsx file, so
// import.meta.url under happy-dom is file:// and fileURLToPath works (see
// the comment in vitest.config.ts for the .ts vs .tsx subtlety).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "../test-utils";
import init, { run_season } from "../wasm/gandula_wasm.js";
import TacticsView from "./TacticsView";
import { ALL_TEAMS, teamById } from "../teams";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import { freshCopa } from "../util/copa";
import { FIRST_YEAR, STARTING_MONEY, type Career } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a v3 Career with all divisions simulated. User is the weakest
 * team in Série C via pickStarterTeam (deterministic). The dropdown
 * initialization in TacticsView reads from the base team via
 * teamById(career.controlledTeamId), so we surface that team back to the
 * tests through `starterId` for assertions.
 */
function makeCareer(): { career: Career; starterId: number } {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seed = 1998n;
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  const career: Career = {
    schemaVersion: 12,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
        { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000, marketingMomentum: 0 },
    userRoster: [],
  };
  return { career, starterId: starter.id };
}

describe("TacticsView", () => {
  it("initializes dropdowns from base team when no userTactics", () => {
    const { career, starterId } = makeCareer();
    render(<TacticsView career={career} onApply={() => {}} onBack={() => {}} />);
    const base = teamById(starterId)!;
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe(base.formation);
    expect(posturaSel.value).toBe(base.tactics.mentality);
  });

  it("APLICAR is disabled when no changes made", () => {
    const { career } = makeCareer();
    render(<TacticsView career={career} onApply={() => {}} onBack={() => {}} />);
    const apply = screen.getByRole("button", { name: /aplicar/i });
    expect(apply).toBeDisabled();
  });

  it("APLICAR becomes enabled after changing a dropdown", () => {
    const { career } = makeCareer();
    render(<TacticsView career={career} onApply={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    expect(
      screen.getByRole("button", { name: /aplicar/i }),
    ).not.toBeDisabled();
  });

  it("calls onBack without re-simulating", () => {
    const { career } = makeCareer();
    const onBack = vi.fn();
    const onApply = vi.fn();
    render(<TacticsView career={career} onApply={onApply} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("calls onApply with re-simulated career when APLICAR clicked", async () => {
    const { career } = makeCareer();
    const onApply = vi.fn();
    render(<TacticsView career={career} onApply={onApply} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    // The re-sim is deferred a frame so the button's loading state can paint.
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const [newCareer, resimMs, resimCount] = onApply.mock.calls[0];
    expect(newCareer.currentSeason.userTactics).toBeDefined();
    expect(newCareer.currentSeason.userTactics.tactics.mentality).toBe(
      "VeryAttacking",
    );
    expect(resimMs).toBeGreaterThanOrEqual(0);
    expect(resimCount).toBeGreaterThan(0);
  });

  it("initializes from userTactics when present (precedence over base team)", () => {
    const { career, starterId } = makeCareer();
    const baseTeam = teamById(starterId)!;
    career.currentSeason.userTactics = {
      formation: "F433",
      tactics: {
        mentality: "VeryDefensive",
        tempo: "Slow",
        pressing: "Low",
        width: "Narrow",
      },
      starting_xi: baseTeam.starting_xi.slice(),
      bench: baseTeam.bench?.slice() ?? [],
    };
    render(<TacticsView career={career} onApply={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F433");
    expect(posturaSel.value).toBe("VeryDefensive");
  });
});
