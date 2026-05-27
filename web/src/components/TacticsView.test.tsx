// Component test for TacticsView. Runs under happy-dom (the vitest default
// env — see vitest.config.ts) since rendering React needs a DOM. The wasm
// binary is loaded via the file-anchor pattern; this is a .tsx file, so
// import.meta.url under happy-dom is file:// and fileURLToPath works (see
// the comment in vitest.config.ts for the .ts vs .tsx subtlety).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import init, { run_season } from "../wasm/gandula_wasm.js";
import TacticsView from "./TacticsView";
import { ALL_TEAMS, teamById } from "../teams";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import type { SavedSeason } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a v2 SavedSeason with both divisions simulated. User is the
 * weakest team in Série B via pickStarterTeam (deterministic). The
 * dropdown initialization in TacticsView reads from the base team via
 * teamById(saved.controlledTeamId), so we surface that team back to
 * the tests through `starterTeam` for assertions.
 */
function makeSaved(): { saved: SavedSeason; starterId: number } {
  const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierB);
  const seed = 1998n;
  const recordA = run_season(tierA, seed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seed ^ 2n, "Série B") as SeasonRecord;
  const saved: SavedSeason = {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    divisions: [
      { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
      { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
    ],
  };
  return { saved, starterId: starter.id };
}

describe("TacticsView", () => {
  it("initializes dropdowns from base team when no userTactics", () => {
    const { saved, starterId } = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const base = teamById(starterId)!;
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe(base.formation);
    expect(posturaSel.value).toBe(base.tactics.mentality);
  });

  it("APLICAR is disabled when no changes made", () => {
    const { saved } = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const apply = screen.getByRole("button", { name: /aplicar/i });
    expect(apply).toBeDisabled();
  });

  it("APLICAR becomes enabled after changing a dropdown", () => {
    const { saved } = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    expect(
      screen.getByRole("button", { name: /aplicar/i }),
    ).not.toBeDisabled();
  });

  it("calls onBack without re-simulating", () => {
    const { saved } = makeSaved();
    const onBack = vi.fn();
    const onApply = vi.fn();
    render(<TacticsView saved={saved} onApply={onApply} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("calls onApply with re-simulated save when APLICAR clicked", () => {
    const { saved } = makeSaved();
    const onApply = vi.fn();
    render(<TacticsView saved={saved} onApply={onApply} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    expect(onApply).toHaveBeenCalledOnce();
    const [newSaved, resimMs, resimCount] = onApply.mock.calls[0];
    expect(newSaved.userTactics).toBeDefined();
    expect(newSaved.userTactics.tactics.mentality).toBe("VeryAttacking");
    expect(resimMs).toBeGreaterThanOrEqual(0);
    expect(resimCount).toBeGreaterThan(0);
  });

  it("initializes from userTactics when present (precedence over base team)", () => {
    const { saved, starterId } = makeSaved();
    const baseTeam = teamById(starterId)!;
    saved.userTactics = {
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
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F433");
    expect(posturaSel.value).toBe("VeryDefensive");
  });
});
