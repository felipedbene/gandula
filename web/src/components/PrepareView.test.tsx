// Component test for PrepareView. Runs under happy-dom (default env) since
// rendering React needs a DOM. This is a .tsx file, so import.meta.url is
// file:// under happy-dom — see vitest.config.ts for the .ts vs .tsx note.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import init, { run_season } from "../wasm/gandula_wasm.js";
import PrepareView from "./PrepareView";
import { ALL_TEAMS } from "../teams";
import type { SavedSeason } from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

function makeSaved(controlledTeamId = ALL_TEAMS[0].id): SavedSeason {
  const record = run_season(ALL_TEAMS, 1998n, "Test") as SeasonRecord;
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    seed: 1998n,
    controlledTeamId,
    currentRoundIdx: 0,
    record,
  };
}

/** First round in the schedule where the controlled team has a fixture. */
function findPlayingRound(saved: SavedSeason): number {
  for (let i = 0; i < saved.record.fixtures.length; i++) {
    const m = saved.record.matches[i];
    if (
      m.home === saved.controlledTeamId ||
      m.away === saved.controlledTeamId
    ) {
      return saved.record.fixtures[i].round;
    }
  }
  return 0;
}

/** First round where the controlled team has NO fixture (bye). With 17
 *  teams the circle-method schedule gives every team 2 byes per season. */
function findByeRound(saved: SavedSeason): number | null {
  const rounds = new Set(saved.record.fixtures.map((f) => f.round));
  for (const round of rounds) {
    const userPlays = saved.record.fixtures.some((f, i) => {
      if (f.round !== round) return false;
      const m = saved.record.matches[i];
      return (
        m.home === saved.controlledTeamId || m.away === saved.controlledTeamId
      );
    });
    if (!userPlays) return round;
  }
  return null;
}

describe("PrepareView", () => {
  it("renders PRÓXIMO JOGO card when user plays this round", () => {
    const saved = makeSaved();
    saved.currentRoundIdx = findPlayingRound(saved);
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/PRÓXIMO JOGO/i)).toBeInTheDocument();
  });

  it("renders SEM JOGO card on bye rounds", () => {
    const saved = makeSaved();
    const byeRound = findByeRound(saved);
    if (byeRound === null) {
      throw new Error("Test setup: no bye found in default 17-team season");
    }
    saved.currentRoundIdx = byeRound;
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/SEM JOGO/i)).toBeInTheDocument();
    expect(screen.getByText(/descansa/i)).toBeInTheDocument();
  });

  it("VOLTAR fires onBack without re-simulating", () => {
    const saved = makeSaved();
    saved.currentRoundIdx = findPlayingRound(saved);
    const onBack = vi.fn();
    const onPlay = vi.fn();
    render(<PrepareView saved={saved} onPlay={onPlay} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("JOGAR with no changes returns original save (resimCount = 0)", () => {
    const saved = makeSaved();
    saved.currentRoundIdx = findPlayingRound(saved);
    const onPlay = vi.fn();
    render(<PrepareView saved={saved} onPlay={onPlay} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /jogar/i }));
    expect(onPlay).toHaveBeenCalledOnce();
    const [returnedSaved, resimMs, resimCount] = onPlay.mock.calls[0];
    expect(returnedSaved).toBe(saved); // same reference — no re-sim
    expect(resimMs).toBe(0);
    expect(resimCount).toBe(0);
  });

  it("JOGAR with changes re-simulates and reports counters", () => {
    const saved = makeSaved();
    saved.currentRoundIdx = findPlayingRound(saved);
    const onPlay = vi.fn();
    render(<PrepareView saved={saved} onPlay={onPlay} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    fireEvent.click(screen.getByRole("button", { name: /jogar/i }));
    expect(onPlay).toHaveBeenCalledOnce();
    const [newSaved, resimMs, resimCount] = onPlay.mock.calls[0];
    expect(newSaved).not.toBe(saved); // new reference
    expect(newSaved.userTactics).toBeDefined();
    expect(newSaved.userTactics.tactics.mentality).toBe("VeryAttacking");
    expect(resimMs).toBeGreaterThanOrEqual(0);
    expect(resimCount).toBeGreaterThan(0);
  });

  it("initializes from userTactics when present", () => {
    const saved = makeSaved();
    saved.currentRoundIdx = findPlayingRound(saved);
    saved.userTactics = {
      formation: "F352",
      tactics: {
        mentality: "Defensive",
        tempo: "Slow",
        pressing: "Low",
        width: "Wide",
      },
      starting_xi: ALL_TEAMS[0].starting_xi.slice(),
      bench: ALL_TEAMS[0].bench?.slice() ?? [],
    };
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F352");
    expect(posturaSel.value).toBe("Defensive");
  });
});
