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
import { ALL_TEAMS, teamById } from "../teams";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import {
  findUserDivisionIdx,
  type Division,
  type SavedSeason,
} from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a v2 SavedSeason with both divisions simulated. User goes to the
 * weakest team in Série B (deterministic via pickStarterTeam), so
 * `findUserDivisionIdx(saved) === 1` is stable across tests.
 */
function makeSaved(): SavedSeason {
  const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierB);
  const seed = 1998n;
  const recordA = run_season(tierA, seed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seed ^ 2n, "Série B") as SeasonRecord;
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    divisions: [
      { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
      { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
    ],
  };
}

function userDivOf(saved: SavedSeason): Division {
  return saved.divisions[findUserDivisionIdx(saved)];
}

/** First round in the user's division where the controlled team plays. */
function findPlayingRound(saved: SavedSeason): number {
  const div = userDivOf(saved);
  for (let i = 0; i < div.record.fixtures.length; i++) {
    const m = div.record.matches[i];
    if (
      m.home === saved.controlledTeamId ||
      m.away === saved.controlledTeamId
    ) {
      return div.record.fixtures[i].round;
    }
  }
  return 0;
}

/** First round in the user's division where the team is on bye. Série B
 *  has 9 teams ⇒ 2 byes per team per season via the engine's virtual BYE
 *  — `findUserDivisionIdx` puts the user in B, so this always finds one. */
function findByeRound(saved: SavedSeason): number | null {
  const div = userDivOf(saved);
  const rounds = new Set(div.record.fixtures.map((f) => f.round));
  for (const round of rounds) {
    const userPlays = div.record.fixtures.some((f, i) => {
      if (f.round !== round) return false;
      const m = div.record.matches[i];
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
    const playingRound = findPlayingRound(saved);
    userDivOf(saved).currentRoundIdx = playingRound;
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/PRÓXIMO JOGO/i)).toBeInTheDocument();
  });

  it("renders SEM JOGO card on bye rounds", () => {
    const saved = makeSaved();
    const byeRound = findByeRound(saved);
    if (byeRound === null) {
      throw new Error("Test setup: no bye found in Série B (9-team odd)");
    }
    userDivOf(saved).currentRoundIdx = byeRound;
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/SEM JOGO/i)).toBeInTheDocument();
    expect(screen.getByText(/descansa/i)).toBeInTheDocument();
  });

  it("VOLTAR fires onBack without re-simulating", () => {
    const saved = makeSaved();
    userDivOf(saved).currentRoundIdx = findPlayingRound(saved);
    const onBack = vi.fn();
    const onPlay = vi.fn();
    render(<PrepareView saved={saved} onPlay={onPlay} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("JOGAR with no changes returns original save (resimCount = 0)", () => {
    const saved = makeSaved();
    userDivOf(saved).currentRoundIdx = findPlayingRound(saved);
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
    userDivOf(saved).currentRoundIdx = findPlayingRound(saved);
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
    userDivOf(saved).currentRoundIdx = findPlayingRound(saved);
    const baseTeam = teamById(saved.controlledTeamId)!;
    saved.userTactics = {
      formation: "F352",
      tactics: {
        mentality: "Defensive",
        tempo: "Slow",
        pressing: "Low",
        width: "Wide",
      },
      starting_xi: baseTeam.starting_xi.slice(),
      bench: baseTeam.bench?.slice() ?? [],
    };
    render(<PrepareView saved={saved} onPlay={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F352");
    expect(posturaSel.value).toBe("Defensive");
  });
});
