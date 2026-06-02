import { describe, it, expect } from "vitest";
import {
  applySwap,
  swapFromDrop,
  formationRows,
  MAX_BENCH,
  type Lineup,
} from "./lineup";

const base: Lineup = {
  starting_xi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  bench: [21, 22, 23],
};

describe("applySwap", () => {
  it("swaps a bench player into the XI slot, outgoing takes the bench slot", () => {
    const next = applySwap(base, 3, 22);
    expect(next.starting_xi).toEqual([1, 2, 22, 4, 5, 6, 7, 8, 9, 10, 11]);
    // outgoing (3) lands in 22's exact bench slot — order + size preserved.
    expect(next.bench).toEqual([21, 3, 23]);
  });

  it("does not mutate the input lineup", () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    applySwap(base, 3, 22);
    expect(base).toEqual(snapshot);
  });

  it("appends outgoing to the bench when incoming came from outside (room left)", () => {
    const next = applySwap(base, 5, 99); // 99 not on the bench
    expect(next.starting_xi).toContain(99);
    expect(next.starting_xi).not.toContain(5);
    expect(next.bench).toEqual([21, 22, 23, 5]); // appended at the end
  });

  it("drops outgoing silently when incoming is from outside and the bench is full", () => {
    const full: Lineup = { starting_xi: base.starting_xi.slice(), bench: [21, 22, 23, 24, 25, 26, 27] };
    expect(full.bench).toHaveLength(MAX_BENCH);
    const next = applySwap(full, 5, 99);
    expect(next.starting_xi).toContain(99);
    expect(next.bench).toHaveLength(MAX_BENCH); // unchanged size
    expect(next.bench).not.toContain(5); // 5 left the squad
  });

  it("returns the same state unchanged when outgoing isn't in the XI", () => {
    const next = applySwap(base, 999, 22);
    expect(next).toBe(base);
  });

  it("returns the same state unchanged when outgoing === incoming", () => {
    const next = applySwap(base, 3, 3);
    expect(next).toBe(base);
  });

  it("honours a custom maxBench", () => {
    const next = applySwap(base, 5, 99, 3); // bench already at this cap
    expect(next.starting_xi).toContain(99);
    expect(next.bench).toEqual([21, 22, 23]); // no room → 5 leaves
  });
});

describe("swapFromDrop", () => {
  // Positions: XI slot 3 and bench 22 are MID; bench 21 is GK; XI 7 is FWD.
  const pos: Record<number, string> = {
    3: "MID", 7: "FWD", 11: "DEF",
    21: "GK", 22: "MID", 23: "FWD",
  };
  const positionOf = (id: number) => pos[id];

  it("drags a bench player onto a same-position starter (bench→XI)", () => {
    const next = swapFromDrop(base, positionOf, 22, 3); // source bench, target XI
    expect(next).not.toBeNull();
    expect(next!.starting_xi).toContain(22);
    expect(next!.starting_xi).not.toContain(3);
    expect(next!.bench).toContain(3);
  });

  it("drags a starter onto a same-position bench player (XI→bench), same result", () => {
    const a = swapFromDrop(base, positionOf, 3, 22); // source XI, target bench
    const b = swapFromDrop(base, positionOf, 22, 3); // reverse direction
    expect(a).toEqual(b); // direction-independent: the XI endpoint is outgoing
  });

  it("rejects a cross-position drop", () => {
    expect(swapFromDrop(base, positionOf, 23, 3)).toBeNull(); // FWD onto MID
  });

  it("rejects an XI↔XI drop (both endpoints in the XI)", () => {
    expect(swapFromDrop(base, positionOf, 3, 7)).toBeNull();
  });

  it("rejects a bench↔bench drop (neither endpoint in the XI)", () => {
    const benchHeavy: Lineup = { starting_xi: base.starting_xi.slice(), bench: [22, 24] };
    expect(swapFromDrop(benchHeavy, positionOf, 22, 24)).toBeNull();
  });

  it("rejects dropping a dot on itself", () => {
    expect(swapFromDrop(base, positionOf, 3, 3)).toBeNull();
  });

  it("rejects when a position is unknown", () => {
    expect(swapFromDrop(base, positionOf, 3, 999)).toBeNull();
  });
});

describe("formationRows", () => {
  // A clean 4-4-2 XI: 1 GK, 4 DEF, 4 MID, 2 FWD.
  const pos: Record<number, string> = {
    1: "GK",
    2: "DEF", 3: "DEF", 4: "DEF", 5: "DEF",
    6: "MID", 7: "MID", 8: "MID", 9: "MID",
    10: "FWD", 11: "FWD",
  };
  const positionOf = (id: number) => pos[id];
  const xi = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  it("lays a matching XI into the formation's lines, top→bottom (FWD..GK)", () => {
    const rows = formationRows("F442", xi, positionOf);
    // [2 FWD, 4 MID, 4 DEF, 1 GK]
    expect(rows.map((r) => r.length)).toEqual([2, 4, 4, 1]);
    expect(rows[0].every((id) => pos[id] === "FWD")).toBe(true);
    expect(rows[3]).toEqual([1]); // GK row last
  });

  it("reshapes for a different formation (3-5-2)", () => {
    const rows = formationRows("F352", xi, positionOf);
    expect(rows.map((r) => r.length)).toEqual([2, 5, 3, 1]);
  });

  it("handles the 4-2-3-1 four-outfield-line shape", () => {
    const rows = formationRows("F4231", xi, positionOf);
    expect(rows.map((r) => r.length)).toEqual([1, 3, 2, 4, 1]);
  });

  it("always renders all 11 even when composition ≠ formation (spillover)", () => {
    const rows = formationRows("F352", xi, positionOf);
    const total = rows.reduce((n, r) => n + r.length, 0);
    expect(total).toBe(11);
  });

  it("falls back to position bands for an unknown formation", () => {
    const rows = formationRows("F999", xi, positionOf);
    // FWD / MID / DEF / GK
    expect(rows.map((r) => r.length)).toEqual([2, 4, 4, 1]);
  });
});
