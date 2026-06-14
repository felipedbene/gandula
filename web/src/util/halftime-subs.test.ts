// @vitest-environment node
//
// End-to-end check that the rebuilt WASM `play_second_half` honors half-time
// substitutions (#62): passing a sub brings the bench player on and a
// Substitution event appears, whereas the no-sub path is unchanged. Node env +
// real WASM, mirroring career.test.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import init, {
  derive_match_seed,
  play_first_half,
  play_second_half,
} from "../wasm/gandula_wasm.js";
import { ALL_TEAMS } from "../teams";
import { eventKindName } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
beforeAll(async () => {
  await init({
    module_or_path: readFileSync(resolve(HERE, "../wasm/gandula_wasm_bg.wasm")),
  });
});

const teamWithBench = ALL_TEAMS.find((t) => (t.bench ?? []).length > 0)!;
const opponent = ALL_TEAMS.find((t) => t.id !== teamWithBench.id)!;

function subEvents(m: any): any[] {
  return m.events.filter((e: any) => eventKindName(e.kind) === "Substitution");
}

describe("play_second_half half-time subs", () => {
  it("no subs is unchanged; a sub brings the bench player on", () => {
    const home = teamWithBench;
    const away = opponent;
    const seed = derive_match_seed(2024n, 0);

    const snapA = play_first_half(home, away, seed);
    const noSubs = play_second_half(snapA, home, away, [], []) as any;

    const off = home.starting_xi[10];
    const on = home.bench![0];
    const snapB = play_first_half(home, away, seed);
    const withSub = play_second_half(snapB, home, away, [{ off, on }], []) as any;

    // The chosen sub shows up as a home Substitution off→on.
    const hit = subEvents(withSub).find(
      (e) =>
        typeof e.kind === "object" &&
        e.kind.Substitution?.off === off &&
        e.kind.Substitution?.on === on,
    );
    expect(hit).toBeDefined();
    expect(hit.side).toBe("Home");

    // The sub steered the half: the event streams diverge from the no-sub run.
    expect(JSON.stringify(withSub.events)).not.toBe(JSON.stringify(noSubs.events));
  });

  it("is deterministic for the same (snapshot, subs)", () => {
    const home = teamWithBench;
    const away = opponent;
    const seed = derive_match_seed(99n, 3);
    const sub = [{ off: home.starting_xi[9], on: home.bench![0] }];

    const a = play_second_half(play_first_half(home, away, seed), home, away, sub, []) as any;
    const b = play_second_half(play_first_half(home, away, seed), home, away, sub, []) as any;
    // Compare events + result (the Match also carries a BigInt seed that
    // JSON.stringify can't serialize).
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toEqual(b.result);
  });
});
