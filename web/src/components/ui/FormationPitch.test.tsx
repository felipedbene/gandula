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
  it("renders one tappable dot per XI player when interactive", () => {
    render(
      <FormationPitch team={team} state={fullState()} onChange={() => {}} />,
    );
    // Each dot is a button; there are exactly 11 in the XI.
    expect(screen.getAllByRole("button")).toHaveLength(11);
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
    // The dot's accessible text is the overall + surname.
    const surname = target.name.split(/\s+/).slice(-1)[0];
    const dot = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes(surname))!;
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

    const surname = outgoing.name.split(/\s+/).slice(-1)[0];
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.textContent?.includes(surname))!,
    );
    // Candidate rows are buttons in the menu; click the one for `incoming`.
    const ovr = String(playerOverall(incoming));
    const candidateBtn = screen
      .getAllByRole("button")
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
