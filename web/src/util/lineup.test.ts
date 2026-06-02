import { describe, it, expect } from "vitest";
import { applySwap, swapFromDrop, MAX_BENCH, type Lineup } from "./lineup";

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
