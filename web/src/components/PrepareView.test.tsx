// Component test for PrepareView. Runs under happy-dom (default env) since
// rendering React needs a DOM. This is a .tsx file, so import.meta.url is
// file:// under happy-dom — see vitest.config.ts for the .ts vs .tsx note.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../test-utils";
import init, { run_season } from "../wasm/gandula_wasm.js";
import PrepareView from "./PrepareView";
import { ALL_TEAMS, teamById } from "../teams";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import { freshCopa } from "../util/copa";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  findUserDivisionIdxInSeason,
  type Career,
  type Division,
} from "../persistence";
import type { SeasonRecord } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../wasm/gandula_wasm_bg.wasm");

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  await init({ module_or_path: bytes });
});

/**
 * Build a Career with all three divisions simulated. User goes to the
 * weakest team in Série C (the bottom tier, deterministic via
 * pickStarterTeam), so `findUserDivisionIdxInSeason(...) === 2` is stable
 * across tests.
 */
function makeCareer(): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seed = 1998n;
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
  const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
  const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  return {
    schemaVersion: 8,
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
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
  };
}

/**
 * Build a Career whose user division has an ODD team count, so the engine
 * inserts virtual byes and the user gets a bye round. The 60-team world has
 * three 20-team (even) tiers with no byes, so the SEM JOGO branch can't be
 * reached from a real season — this synthesizes a 9-team Série C in isolation
 * to exercise that UI path. The other two tiers are stubbed minimally.
 */
function makeCareerWithBye(): Career {
  const [, , tierC] = divideIntoDivisions(ALL_TEAMS);
  const nine = tierC.slice(0, 9);
  const starter = pickStarterTeam(nine);
  const seed = 1998n;
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const recordC = run_season(nine, seasonSeed ^ 3n, "Série C") as SeasonRecord;
  return {
    schemaVersion: 8,
    savedAt: new Date().toISOString(),
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000 },
    userRoster: [],
  };
}

function userDivOf(career: Career): Division {
  const idx = findUserDivisionIdxInSeason(
    career.currentSeason,
    career.controlledTeamId,
  );
  return career.currentSeason.divisions[idx];
}

/** First round in the user's division where the controlled team plays. */
function findPlayingRound(career: Career): number {
  const div = userDivOf(career);
  for (let i = 0; i < div.record.fixtures.length; i++) {
    const m = div.record.matches[i];
    if (
      m.home === career.controlledTeamId ||
      m.away === career.controlledTeamId
    ) {
      return div.record.fixtures[i].round;
    }
  }
  return 0;
}

/** First round in the user's division where the team is on bye. Only the
 *  synthetic odd-N division (makeCareerWithBye) produces byes — the real
 *  60-team world is all-even, so no team ever sits a round out. */
function findByeRound(career: Career): number | null {
  const div = userDivOf(career);
  const rounds = new Set(div.record.fixtures.map((f) => f.round));
  for (const round of rounds) {
    const userPlays = div.record.fixtures.some((f, i) => {
      if (f.round !== round) return false;
      const m = div.record.matches[i];
      return (
        m.home === career.controlledTeamId || m.away === career.controlledTeamId
      );
    });
    if (!userPlays) return round;
  }
  return null;
}

describe("PrepareView", () => {
  it("renders PRÓXIMO JOGO card when user plays this round", () => {
    const career = makeCareer();
    const playingRound = findPlayingRound(career);
    userDivOf(career).currentRoundIdx = playingRound;
    render(<PrepareView career={career} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/PRÓXIMO JOGO/i)).toBeInTheDocument();
  });

  it("renders SEM JOGO card on bye rounds", () => {
    // Real tiers are even (no byes), so use the synthetic 9-team division.
    const career = makeCareerWithBye();
    const byeRound = findByeRound(career);
    if (byeRound === null) {
      throw new Error("Test setup: no bye found in synthetic 9-team division");
    }
    userDivOf(career).currentRoundIdx = byeRound;
    render(<PrepareView career={career} onPlay={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/SEM JOGO/i)).toBeInTheDocument();
    expect(screen.getByText(/descansa/i)).toBeInTheDocument();
  });

  it("VOLTAR fires onBack without re-simulating", () => {
    const career = makeCareer();
    userDivOf(career).currentRoundIdx = findPlayingRound(career);
    const onBack = vi.fn();
    const onPlay = vi.fn();
    render(<PrepareView career={career} onPlay={onPlay} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /voltar/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("JOGAR with no changes returns original career (resimCount = 0)", () => {
    const career = makeCareer();
    userDivOf(career).currentRoundIdx = findPlayingRound(career);
    const onPlay = vi.fn();
    render(<PrepareView career={career} onPlay={onPlay} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /jogar/i }));
    expect(onPlay).toHaveBeenCalledOnce();
    const [returnedCareer, resimMs, resimCount] = onPlay.mock.calls[0];
    expect(returnedCareer).toBe(career); // same reference — no re-sim
    expect(resimMs).toBe(0);
    expect(resimCount).toBe(0);
  });

  it("JOGAR with changes re-simulates and reports counters", () => {
    const career = makeCareer();
    userDivOf(career).currentRoundIdx = findPlayingRound(career);
    const onPlay = vi.fn();
    render(<PrepareView career={career} onPlay={onPlay} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/postura/i), {
      target: { value: "VeryAttacking" },
    });
    fireEvent.click(screen.getByRole("button", { name: /jogar/i }));
    expect(onPlay).toHaveBeenCalledOnce();
    const [newCareer, resimMs, resimCount] = onPlay.mock.calls[0];
    expect(newCareer).not.toBe(career); // new reference
    expect(newCareer.currentSeason.userTactics).toBeDefined();
    expect(newCareer.currentSeason.userTactics.tactics.mentality).toBe(
      "VeryAttacking",
    );
    expect(resimMs).toBeGreaterThanOrEqual(0);
    expect(resimCount).toBeGreaterThan(0);
  });

  it("initializes from userTactics when present", () => {
    const career = makeCareer();
    userDivOf(career).currentRoundIdx = findPlayingRound(career);
    const baseTeam = teamById(career.controlledTeamId)!;
    career.currentSeason.userTactics = {
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
    render(<PrepareView career={career} onPlay={() => {}} onBack={() => {}} />);
    const formationSel = screen.getByLabelText(/formação/i) as HTMLSelectElement;
    const posturaSel = screen.getByLabelText(/postura/i) as HTMLSelectElement;
    expect(formationSel.value).toBe("F352");
    expect(posturaSel.value).toBe("Defensive");
  });
});
