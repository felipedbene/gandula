// Pure-component tests over BenchEditor — no WASM needed. Runs under
// happy-dom (vitest default); .tsx extension keeps import.meta.url as
// file:// per the note in vitest.config.ts.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../test-utils";
import BenchEditor from "./BenchEditor";
import type { LineupState } from "./LineupEditor";
import { ALL_TEAMS } from "../teams";
import type { Player, Team } from "../types";

const team = ALL_TEAMS.find((t) => t.name === "Baviera FC")!;

function fullBenchState(): LineupState {
  return {
    starting_xi: team.starting_xi.slice(),
    bench: team.bench?.slice() ?? [],
  };
}

function emptyBenchState(): LineupState {
  return {
    starting_xi: team.starting_xi.slice(),
    bench: [],
  };
}

/** Builds a team big enough to reach bench=7. Baviera has 16 players
 *  (11 XI + 5 reserves) so its non-XI pool maxes at 5. Extend the roster
 *  with dummy MID players so we can fill the bench to the engine's
 *  MAX_BENCH cap of 7. */
function bigTeam(): Team {
  const extras: Player[] = [];
  for (let i = 0; i < 4; i++) {
    extras.push({
      id: 99000 + i,
      name: `Extra ${i}`,
      age: 25,
      position: "MID",
      attributes: {
        pace: 50,
        technique: 50,
        passing: 50,
        defending: 50,
        finishing: 50,
        stamina: 50,
      },
    });
  }
  return { ...team, roster: [...team.roster, ...extras] };
}

function maxBenchStateFor(t: Team): LineupState {
  const xi = new Set(t.starting_xi);
  const bench: number[] = [];
  for (const p of t.roster) {
    if (!xi.has(p.id) && bench.length < 7) bench.push(p.id);
  }
  return { starting_xi: t.starting_xi.slice(), bench };
}

describe("BenchEditor", () => {
  it("renders bench slots with REMOVER buttons", () => {
    render(<BenchEditor team={team} state={fullBenchState()} onChange={() => {}} />);
    const removerBtns = screen.getAllByRole("button", { name: /remover/i });
    expect(removerBtns).toHaveLength(team.bench?.length ?? 0);
  });

  it("renders BANCO header with count fraction", () => {
    render(<BenchEditor team={team} state={fullBenchState()} onChange={() => {}} />);
    expect(screen.getByText(/BANCO \(5 \/ 7\)/i)).toBeInTheDocument();
  });

  it("shows empty-bench warning when bench has zero players", () => {
    render(<BenchEditor team={team} state={emptyBenchState()} onChange={() => {}} />);
    expect(screen.getByText(/banco vazio/i)).toBeInTheDocument();
  });

  it("shows no-GK warning when bench has no goalkeeper", () => {
    // Baviera bench has one GK (25712). Remove only that one to trigger
    // the warning while keeping the bench non-empty.
    const state = fullBenchState();
    state.bench = state.bench.filter((id) => id !== 25712);
    render(<BenchEditor team={team} state={state} onChange={() => {}} />);
    expect(screen.getByText(/nenhum goleiro no banco/i)).toBeInTheDocument();
  });

  it("REMOVER on a bench slot calls onChange with shrunk bench", () => {
    const state = fullBenchState();
    const onChange = vi.fn();
    render(<BenchEditor team={team} state={state} onChange={onChange} />);
    const removerBtns = screen.getAllByRole("button", { name: /remover/i });
    fireEvent.click(removerBtns[0]);
    expect(onChange).toHaveBeenCalledOnce();
    const next: LineupState = onChange.mock.calls[0][0];
    expect(next.bench.length).toBe(state.bench.length - 1);
    expect(next.bench).not.toContain(state.bench[0]);
    expect(next.starting_xi).toEqual(state.starting_xi);
  });

  it("ADICIONAR JOGADOR expands candidate list when clicked", () => {
    // emptyBenchState → outside pool = 5 (Baviera's original reserves).
    render(<BenchEditor team={team} state={emptyBenchState()} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /adicionar jogador/i }));
    expect(screen.getByText(/Candidatos/i)).toBeInTheDocument();
    const escolherBtns = screen.getAllByRole("button", { name: /escolher/i });
    expect(escolherBtns.length).toBeGreaterThan(0);
  });

  it("ESCOLHER adds player to end of bench", () => {
    const state = emptyBenchState();
    const onChange = vi.fn();
    render(<BenchEditor team={team} state={state} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /adicionar jogador/i }));
    const escolherBtns = screen.getAllByRole("button", { name: /escolher/i });
    fireEvent.click(escolherBtns[0]);
    expect(onChange).toHaveBeenCalledOnce();
    const next: LineupState = onChange.mock.calls[0][0];
    expect(next.bench).toHaveLength(1);
    expect(next.starting_xi).toEqual(state.starting_xi);
  });

  it("ADICIONAR JOGADOR is disabled when bench is full (7)", () => {
    // Default Baviera roster maxes the bench at 5 (no players beyond
    // XI + reserves). Use bigTeam() so the bench can reach MAX_BENCH = 7
    // and the disable path actually fires.
    const bigT = bigTeam();
    render(
      <BenchEditor team={bigT} state={maxBenchStateFor(bigT)} onChange={() => {}} />,
    );
    const btn = screen.getByRole("button", { name: /adicionar jogador/i });
    expect(btn).toBeDisabled();
  });

  it("ADICIONAR JOGADOR is disabled when no outside players available", () => {
    // Baviera has exactly 16 players (11 XI + 5 bench → 0 outside). The
    // button must be disabled even though the bench is below MAX_BENCH.
    render(<BenchEditor team={team} state={fullBenchState()} onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: /adicionar jogador/i });
    expect(btn).toBeDisabled();
  });
});
