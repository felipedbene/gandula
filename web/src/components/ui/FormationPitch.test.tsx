// Pure-component tests for FormationPitch — props only, no engine/WASM.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import FormationPitch from "./FormationPitch";
import type { LineupState } from "../LineupEditor";
import { ALL_TEAMS } from "../../teams";
import { playerOverall } from "../../util/transfer-market";

const team = ALL_TEAMS.find((t) => t.name === "Sociedade Onça SC")!;

function fullState(): LineupState {
  return {
    starting_xi: team.starting_xi.slice(),
    bench: team.bench?.slice() ?? [],
  };
}

describe("FormationPitch", () => {
  it("renders a tappable dot per XI player + bench player when interactive", () => {
    const state = fullState();
    const { container } = render(
      <FormationPitch team={team} state={state} onChange={() => {}} />,
    );
    // Each dot (XI on the pitch + bench rail) carries data-dot-id.
    const dots = container.querySelectorAll("[data-dot-id]");
    expect(dots).toHaveLength(state.starting_xi.length + state.bench.length);
    // Exactly 11 of them are the XI dots.
    const xiSet = new Set(state.starting_xi.map(String));
    const xiDots = [...dots].filter((d) =>
      xiSet.has(d.getAttribute("data-dot-id")!),
    );
    expect(xiDots).toHaveLength(11);
  });

  it("shows the bench rail only when interactive (with a bench)", () => {
    const state = fullState();
    expect(state.bench.length).toBeGreaterThan(0); // guard the assertion below
    const { rerender } = render(
      <FormationPitch team={team} state={state} onChange={() => {}} />,
    );
    expect(screen.getByText(/Banco · arraste/i)).toBeInTheDocument();
    // Read-only: no rail.
    rerender(<FormationPitch team={team} state={state} />);
    expect(screen.queryByText(/Banco · arraste/i)).not.toBeInTheDocument();
  });

  it("is read-only (no buttons) when onChange is omitted", () => {
    render(<FormationPitch team={team} state={fullState()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("tapping a player reveals same-position candidates", () => {
    // Find an outfield XI player who has a same-position reserve, so the menu
    // has at least one candidate.
    const state = fullState();
    const xiSet = new Set(state.starting_xi);
    const target = state.starting_xi
      .map((id) => team.roster.find((p) => p.id === id)!)
      .find((p) =>
        team.roster.some((r) => r.position === p.position && !xiSet.has(r.id)),
      );
    if (!target) throw new Error("Test setup: expected a swappable XI player");

    render(
      <FormationPitch team={team} state={state} onChange={() => {}} />,
    );
    // Target the exact XI dot by id (bench-rail dots share role/text).
    const dot = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-dot-id") === String(target.id))!;
    fireEvent.click(dot);
    expect(screen.getByText(/Trocar .* por:/i)).toBeInTheDocument();
  });

  it("picking a candidate fires onChange with a swap-perfect lineup", () => {
    const initial = fullState();
    const xiSet = new Set(initial.starting_xi);
    const outgoing = initial.starting_xi
      .map((id) => team.roster.find((p) => p.id === id)!)
      .find((p) =>
        team.roster.some((r) => r.position === p.position && !xiSet.has(r.id)),
      )!;
    const incoming = team.roster.find(
      (r) => r.position === outgoing.position && !xiSet.has(r.id),
    )!;

    const onChange = vi.fn();
    render(<FormationPitch team={team} state={initial} onChange={onChange} />);

    fireEvent.click(
      screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("data-dot-id") === String(outgoing.id))!,
    );
    // Candidate rows are the non-dot buttons in the menu; click `incoming`'s.
    const ovr = String(playerOverall(incoming));
    const candidateBtn = screen
      .getAllByRole("button")
      .filter((b) => !b.hasAttribute("data-dot-id"))
      .find((b) => b.textContent?.includes(incoming.name) && b.textContent?.includes(ovr))!;
    fireEvent.click(candidateBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const next: LineupState = onChange.mock.calls[0][0];
    expect(next.starting_xi).toContain(incoming.id);
    expect(next.starting_xi).not.toContain(outgoing.id);
    // swap-perfect: outgoing landed on the bench, sizes preserved.
    expect(next.bench).toContain(outgoing.id);
    expect(next.starting_xi).toHaveLength(11);
  });
});
