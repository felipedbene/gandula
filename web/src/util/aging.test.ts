// @vitest-environment node
//
// Pure unit tests for player aging — no WASM/DOM.
import { describe, expect, it } from "vitest";
import {
  DECLINE_FLOOR,
  GROWTH_CAP,
  MAX_AGE,
  ageDelta,
  agePlayer,
  ageRoster,
  applyAgingSeasons,
} from "./aging";
import type { Player } from "../types";

function player(age: number, attr: number): Player {
  return {
    id: 1,
    name: "Test",
    age,
    position: "MID",
    attributes: {
      pace: attr,
      technique: attr,
      passing: attr,
      defending: attr,
      finishing: attr,
      stamina: attr,
    },
  };
}

describe("ageDelta", () => {
  it("develops the young, plateaus the prime, declines the old", () => {
    expect(ageDelta(20)).toBe(1);
    expect(ageDelta(26)).toBe(0);
    expect(ageDelta(30)).toBe(0);
    expect(ageDelta(32)).toBe(-1);
    expect(ageDelta(35)).toBe(-2);
    expect(ageDelta(40)).toBe(-3);
  });
});

describe("agePlayer", () => {
  it("ages one year and nudges attributes up while developing", () => {
    const p = agePlayer(player(20, 60));
    expect(p.age).toBe(21);
    expect(p.attributes.pace).toBe(61); // ageDelta(21) = +1
  });

  it("leaves prime attributes unchanged", () => {
    const p = agePlayer(player(26, 70));
    expect(p.age).toBe(27);
    expect(p.attributes.technique).toBe(70);
  });

  it("declines veterans", () => {
    const p = agePlayer(player(36, 70)); // turns 37 → -3
    expect(p.age).toBe(37);
    expect(p.attributes.finishing).toBe(67);
  });

  it("floors decline and never reports an age above MAX_AGE", () => {
    const old = agePlayer(player(MAX_AGE, DECLINE_FLOOR + 1));
    expect(old.age).toBe(MAX_AGE); // capped
    expect(old.attributes.pace).toBe(DECLINE_FLOOR); // 26 → floor 25
    // already at the floor: stays put, not yanked.
    const atFloor = agePlayer(player(40, DECLINE_FLOOR));
    expect(atFloor.attributes.pace).toBe(DECLINE_FLOOR);
  });

  it("caps growth at GROWTH_CAP", () => {
    const p = agePlayer(player(20, GROWTH_CAP));
    expect(p.attributes.pace).toBe(GROWTH_CAP); // already capped, stays
  });

  it("does not mutate the input", () => {
    const base = player(30, 70);
    const snapshot = JSON.parse(JSON.stringify(base));
    agePlayer(base);
    expect(base).toEqual(snapshot);
  });
});

describe("ageRoster", () => {
  it("ages every player and returns a fresh array", () => {
    const roster = [player(20, 60), player(38, 60)];
    const aged = ageRoster(roster);
    expect(aged).not.toBe(roster);
    expect(aged[0].age).toBe(21);
    expect(aged[1].age).toBe(39);
    expect(aged[0].attributes.pace).toBe(61); // young: +1
    expect(aged[1].attributes.pace).toBe(57); // 39 → -3
  });
});

describe("applyAgingSeasons", () => {
  it("aging N times equals N successive seasons", () => {
    const roster = [player(38, 60)];
    const folded = applyAgingSeasons(roster, 2);
    const manual = ageRoster(ageRoster(roster));
    expect(folded[0].age).toBe(40);
    expect(folded[0].attributes.pace).toBe(manual[0].attributes.pace);
  });

  it("returns an unchanged copy for 0 seasons", () => {
    const roster = [player(30, 70)];
    const out = applyAgingSeasons(roster, 0);
    expect(out).not.toBe(roster);
    expect(out[0]).toEqual(roster[0]);
  });
});
