// Pure-component tests over LineupEditor — no WASM needed (the editor
// operates on props alone, no engine calls). Runs under happy-dom (vitest
// default); .tsx extension keeps import.meta.url file:// per the note in
// vitest.config.ts.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LineupEditor, {
  lineupStateEquals,
  type LineupState,
} from "./LineupEditor";
import { ALL_TEAMS } from "../teams";
import type { Team } from "../types";

const team = ALL_TEAMS.find((t) => t.name === "Baviera FC")!;

function fullState(): LineupState {
  return {
    starting_xi: team.starting_xi.slice(),
    bench: team.bench?.slice() ?? [],
  };
}

describe("lineupStateEquals", () => {
  it("returns true for identical states", () => {
    expect(lineupStateEquals(fullState(), fullState())).toBe(true);
  });

  it("returns false when XI order differs", () => {
    const a = fullState();
    const b = fullState();
    [b.starting_xi[0], b.starting_xi[1]] = [b.starting_xi[1], b.starting_xi[0]];
    expect(lineupStateEquals(a, b)).toBe(false);
  });

  it("returns false when bench differs", () => {
    const a = fullState();
    const b = fullState();
    if (b.bench.length > 0) b.bench[0] = -1;
    expect(lineupStateEquals(a, b)).toBe(false);
  });
});

describe("LineupEditor", () => {
  it("renders 11 XI slots", () => {
    render(<LineupEditor team={team} state={fullState()} onChange={() => {}} />);
    expect(screen.getAllByText(/STAM/i)).toHaveLength(11);
  });

  it("shows zero-GK warning when XI has no GK", () => {
    const state = fullState();
    const gkSlot = state.starting_xi.findIndex((id) => {
      const p = team.roster.find((pp) => pp.id === id);
      return p?.position === "GK";
    });
    const fwdReserve = team.roster.find(
      (p) => p.position === "FWD" && !state.starting_xi.includes(p.id),
    );
    if (gkSlot < 0 || !fwdReserve) {
      throw new Error("Test setup: Baviera FC should have one GK in XI and one FWD on bench");
    }
    state.starting_xi[gkSlot] = fwdReserve.id;
    render(<LineupEditor team={team} state={state} onChange={() => {}} />);
    expect(screen.getByText(/nenhum goleiro/i)).toBeInTheDocument();
  });

  it("shows multiple-GK warning when XI has more than one GK", () => {
    const state = fullState();
    const reserveGK = team.roster.find(
      (p) => p.position === "GK" && !state.starting_xi.includes(p.id),
    );
    if (!reserveGK) {
      throw new Error("Test setup: Baviera FC should have a reserve GK on bench");
    }
    const nonGkSlot = state.starting_xi.findIndex((id) => {
      const p = team.roster.find((pp) => pp.id === id);
      return p?.position !== "GK";
    });
    state.starting_xi[nonGkSlot] = reserveGK.id;
    render(<LineupEditor team={team} state={state} onChange={() => {}} />);
    expect(screen.getByText(/múltiplos goleiros/i)).toBeInTheDocument();
  });

  it("TROCAR is disabled when no same-position candidate exists", () => {
    // Force zero candidates by truncating roster to exactly the 11 XI
    // players (and clearing bench). candidatesFor filters from team.roster,
    // not from bench — so reducing only the bench would leave the unused
    // roster reserves as candidates. Trimming the roster itself is what
    // makes every position have exactly one player.
    const xiOnly = team.roster.filter((p) => team.starting_xi.includes(p.id));
    const minimalTeam: Team = { ...team, roster: xiOnly, bench: [] };
    const minimalState: LineupState = {
      starting_xi: team.starting_xi.slice(),
      bench: [],
    };
    render(
      <LineupEditor team={minimalTeam} state={minimalState} onChange={() => {}} />,
    );
    const buttons = screen.getAllByRole("button", { name: /trocar/i });
    expect(buttons).toHaveLength(11);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it("clicking TROCAR expands the candidate list inline", () => {
    render(<LineupEditor team={team} state={fullState()} onChange={() => {}} />);
    const firstTrocar = screen.getAllByRole("button", { name: /trocar/i })[0];
    fireEvent.click(firstTrocar);
    expect(screen.getByText(/Candidatos/i)).toBeInTheDocument();
  });

  it("ESCOLHER triggers onChange with swap-perfect XI and bench", () => {
    const initial = fullState();
    const onChange = vi.fn();
    render(<LineupEditor team={team} state={initial} onChange={onChange} />);

    // First XI slot whose position has a candidate sitting on the bench.
    const xiPositions = initial.starting_xi.map((id) => {
      const p = team.roster.find((pp) => pp.id === id);
      return p?.position;
    });
    let swapSlotIdx = -1;
    let benchCandidateId = -1;
    for (let i = 0; i < initial.starting_xi.length; i++) {
      const pos = xiPositions[i];
      const benchCandidate = initial.bench.find((bid) => {
        const p = team.roster.find((pp) => pp.id === bid);
        return p?.position === pos;
      });
      if (benchCandidate !== undefined) {
        swapSlotIdx = i;
        benchCandidateId = benchCandidate;
        break;
      }
    }
    if (swapSlotIdx < 0) {
      throw new Error("Test setup: no same-position bench candidate found");
    }

    const trocarBtns = screen.getAllByRole("button", { name: /trocar/i });
    fireEvent.click(trocarBtns[swapSlotIdx]);
    const escolherBtns = screen.getAllByRole("button", { name: /escolher/i });
    fireEvent.click(escolherBtns[0]);

    expect(onChange).toHaveBeenCalledOnce();
    const next: LineupState = onChange.mock.calls[0][0];

    expect(next.starting_xi[swapSlotIdx]).toBe(benchCandidateId);

    const outgoingId = initial.starting_xi[swapSlotIdx];
    const benchIdxOfIncoming = initial.bench.indexOf(benchCandidateId);
    expect(next.bench[benchIdxOfIncoming]).toBe(outgoingId);
    expect(next.bench.length).toBe(initial.bench.length);
  });
});
