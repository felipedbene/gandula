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
import { ALL_TEAMS } from "../teams";
import type { SavedSeason } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

function makeSaved(): SavedSeason {
  const record = run_season(ALL_TEAMS, 1998n, "Test") as SeasonRecord;
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    seed: 1998n,
    controlledTeamId: ALL_TEAMS[0].id,
    currentRoundIdx: 0,
    record,
  };
}

describe("TacticsView", () => {
  it("initializes dropdowns from base team when no userTactics", () => {
    const saved = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const base = ALL_TEAMS[0];
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe(base.formation);
    expect(posturaSel.value).toBe(base.tactics.mentality);
  });

  it("APLICAR is disabled when no changes made", () => {
    const saved = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const apply = screen.getByRole("button", { name: /aplicar/i });
    expect(apply).toBeDisabled();
  });

  it("APLICAR becomes enabled after changing a dropdown", () => {
    const saved = makeSaved();
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    expect(
      screen.getByRole("button", { name: /aplicar/i }),
    ).not.toBeDisabled();
  });

  it("calls onBack without re-simulating", () => {
    const saved = makeSaved();
    const onBack = vi.fn();
    const onApply = vi.fn();
    render(<TacticsView saved={saved} onApply={onApply} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("calls onApply with re-simulated save when APLICAR clicked", () => {
    const saved = makeSaved();
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
    const saved = makeSaved();
    saved.userTactics = {
      formation: "F433",
      tactics: {
        mentality: "VeryDefensive",
        tempo: "Slow",
        pressing: "Low",
        width: "Narrow",
      },
      starting_xi: ALL_TEAMS[0].starting_xi.slice(),
      bench: ALL_TEAMS[0].bench?.slice() ?? [],
    };
    render(<TacticsView saved={saved} onApply={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F433");
    expect(posturaSel.value).toBe("VeryDefensive");
  });
});
