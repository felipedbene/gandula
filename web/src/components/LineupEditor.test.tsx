// Pure-component tests over LineupEditor — no WASM needed (the editor
// operates on props alone, no engine calls). Runs under happy-dom (vitest
// default); .tsx extension keeps import.meta.url file:// per the note in
// vitest.config.ts.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../test-utils";
import LineupEditor, {
  lineupStateEquals,
  type LineupState,
} from "./LineupEditor";
import { ALL_TEAMS } from "../teams";
import type { Player, Team } from "../types";

const team = ALL_TEAMS.find((t) => t.name === "Sociedade Onça SC")!;

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

  // ─── D.1.f outside-path coverage ──────────────────────────────────────
  // When the incoming player wasn't on the bench (D.1.f's BenchEditor
  // REMOVERs surface this path), the swap function tries to spill the
  // outgoing player back onto the bench rather than silently dropping
  // them — but only if there's room. These tests exercise both branches.

  it("swap from outside with space in bench moves outgoing to bench end", () => {
    const xiSet = new Set(team.starting_xi);
    const posOf = (id: number) =>
      team.roster.find((p) => p.id === id)?.position;

    // Find an XI slot whose position has EXACTLY ONE roster player not in the
    // XI — that lone player is our single "outside" candidate once we keep it
    // off the bench. Derived dynamically so it's robust to the chosen team.
    let swapSlotIdx = -1;
    let outsideId = -1;
    for (let i = 0; i < team.starting_xi.length; i++) {
      const pos = posOf(team.starting_xi[i]);
      const nonXi = team.roster.filter(
        (p) => p.position === pos && !xiSet.has(p.id),
      );
      if (nonXi.length === 1) {
        swapSlotIdx = i;
        outsideId = nonXi[0].id;
        break;
      }
    }
    if (swapSlotIdx < 0) {
      throw new Error("Test setup: no XI slot with a lone outside candidate");
    }

    // Bench = the team's bench minus the lone outside candidate, so that
    // candidate is truly "outside" (in roster, not in XI, not on bench) and
    // there's still room (< MAX_BENCH) for the outgoing player to land.
    const bench = (team.bench ?? []).filter((id) => id !== outsideId);
    const state: LineupState = {
      starting_xi: team.starting_xi.slice(),
      bench,
    };
    const onChange = vi.fn();
    render(<LineupEditor team={team} state={state} onChange={onChange} />);

    const trocarBtns = screen.getAllByRole("button", { name: /trocar/i });
    fireEvent.click(trocarBtns[swapSlotIdx]);
    const escolherBtns = screen.getAllByRole("button", { name: /escolher/i });
    expect(escolherBtns).toHaveLength(1);
    fireEvent.click(escolherBtns[0]);

    const outgoingId = state.starting_xi[swapSlotIdx];
    const next: LineupState = onChange.mock.calls[0][0];
    expect(next.starting_xi[swapSlotIdx]).toBe(outsideId);
    expect(next.bench).toHaveLength(bench.length + 1);
    // Outgoing lands at the end of the bench (appended from outside path).
    expect(next.bench).toEqual([...bench, outgoingId]);
  });

  it("swap from outside with full bench (7) drops outgoing silently", () => {
    // Need a team big enough for bench=7 AND at least one outside player of a
    // position matching some XI slot. The team has 16 players (XI=11 + 5
    // bench), so we extend its roster with 3 dummies of an XI position — that
    // gives bench=7 (5 originals + 2 dummies) plus 1 dummy left outside.
    const posOf = (id: number) =>
      team.roster.find((p) => p.id === id)?.position;
    // First XI slot whose position is MID (derived dynamically).
    const swapSlotIdx = team.starting_xi.findIndex(
      (id) => posOf(id) === "MID",
    );
    if (swapSlotIdx < 0) {
      throw new Error("Test setup: no MID in the XI");
    }
    const swapPos = "MID" as const;

    const extras: Player[] = [];
    for (let i = 0; i < 3; i++) {
      extras.push({
        id: 99000 + i,
        name: `Extra ${i}`,
        age: 25,
        position: swapPos,
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
    const bigT: Team = { ...team, roster: [...team.roster, ...extras] };
    // 7-player bench = the team's actual bench + dummy MIDs to reach 7. The
    // last dummy (99002) stays outside (in roster, not XI, not bench).
    const baseBench = (team.bench ?? []).slice();
    const benchDummies: number[] = [];
    let d = 0;
    while (baseBench.length + benchDummies.length < 7 && d < 2) {
      benchDummies.push(99000 + d);
      d++;
    }
    const bench = [...baseBench, ...benchDummies];
    expect(bench).toHaveLength(7);
    const outsideId = 99000 + d; // first dummy not placed on the bench
    const state: LineupState = {
      starting_xi: bigT.starting_xi.slice(),
      bench,
    };
    const onChange = vi.fn();
    render(<LineupEditor team={bigT} state={state} onChange={onChange} />);

    // MID candidates not in XI = roster MIDs outside the XI + dummies not in
    // XI. Compute expected count and the outside (off-bench) candidate index.
    const xiSet = new Set(bigT.starting_xi);
    const candidates = bigT.roster.filter(
      (p) => p.position === swapPos && !xiSet.has(p.id),
    );
    const candidateIdx = candidates.findIndex((c) => c.id === outsideId);
    expect(candidateIdx).toBeGreaterThanOrEqual(0);

    const trocarBtns = screen.getAllByRole("button", { name: /trocar/i });
    fireEvent.click(trocarBtns[swapSlotIdx]);
    const escolherBtns = screen.getAllByRole("button", { name: /escolher/i });
    expect(escolherBtns).toHaveLength(candidates.length);
    fireEvent.click(escolherBtns[candidateIdx]);

    const outgoingId = state.starting_xi[swapSlotIdx];
    const next: LineupState = onChange.mock.calls[0][0];
    expect(next.starting_xi[swapSlotIdx]).toBe(outsideId);
    // Bench is at MAX_BENCH (7) and incoming came from outside → outgoing is
    // silently dropped. Bench length AND contents unchanged.
    expect(next.bench).toHaveLength(7);
    expect(next.bench).toEqual(state.bench);
    expect(next.bench).not.toContain(outgoingId);
  });
});
