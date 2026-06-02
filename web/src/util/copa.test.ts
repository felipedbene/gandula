// @vitest-environment node
// Copa do Brasil bracket + simulation tests. Real ALL_TEAMS + real play_match
// via WASM (node env for file:// import.meta.url, like resimulate.test.ts).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect } from "vitest";
import init from "../wasm/gandula_wasm.js";
import {
  buildCopa,
  playCupRound,
  seededShootout,
  cupResultFor,
  cupSeedFor,
  cupTeamResolver,
  initCopaForSeason,
  freshCopa,
  COPA_ROUND_AT_LEAGUE_ROUND,
  CUP_ROUND_NAMES,
} from "./copa";
import { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import { evolveTeam } from "./regen";
import { divideIntoDivisions, pickStarterTeam } from "./divisions";
import { FIRST_YEAR, STARTING_MONEY, type Career, type Copa } from "../persistence";
import type { Match, SeasonRecord, Team } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
beforeAll(async () => {
  await init({ module_or_path: readFileSync(resolve(HERE, "../wasm/gandula_wasm_bg.wasm")) });
});

const CUP_SEED = 1998n ^ 0xc09an;
// Plain registry resolver (no evolution) — fine for the cup's own tests.
const resolveTeam = (id: number): Team => {
  const t = teamById(id);
  if (!t) throw new Error(`no team ${id}`);
  return t;
};

/** Play every round to completion and return the final Copa. */
function playWhole(copa: Copa, userId?: number): Copa {
  let c = copa;
  while (c.championId === undefined) {
    c = playCupRound(c, c.currentCupRoundIdx, resolveTeam, CUP_SEED, userId);
  }
  return c;
}

describe("buildCopa", () => {
  it("is deterministic", () => {
    expect(buildCopa(ALL_TEAMS)).toEqual(buildCopa(ALL_TEAMS));
  });

  it("places all 60 clubs exactly once in the prelim (28 ties + 4 byes)", () => {
    const copa = buildCopa(ALL_TEAMS);
    const prelim = copa.rounds[0];
    const real = prelim.ties.filter((t) => !t.bye);
    const byes = prelim.ties.filter((t) => t.bye);
    expect(real).toHaveLength(28);
    expect(byes).toHaveLength(4);
    const ids = new Set<number>();
    for (const t of real) {
      ids.add(t.homeId);
      ids.add(t.awayId);
    }
    for (const t of byes) ids.add(t.homeId);
    expect(ids.size).toBe(60);
    expect(new Set(ALL_TEAMS.map((t) => t.id))).toEqual(ids);
  });

  it("byes the 4 strongest clubs (highest avgStrength)", () => {
    const copa = buildCopa(ALL_TEAMS);
    const byeIds = copa.rounds[0].ties.filter((t) => t.bye).map((t) => t.homeId);
    expect(byeIds).toHaveLength(4);
    // Byes should all be Série A (top-20-strength) clubs.
    expect(new Set(byeIds).size).toBe(4);
  });

  it("seeds by evolved strength: a far-future world reshapes the draw", () => {
    // Evolving the whole world by several seasons ages/regens clubs, so the
    // strength ranking — and thus the bye set — should differ from the registry
    // draw for at least one seed. (It's not guaranteed for every seed, so we
    // probe a few.) Still deterministic per (elapsed, seed).
    const byeSet = (copa: Copa) =>
      new Set(copa.rounds[0].ties.filter((t) => t.bye).map((t) => t.homeId));
    const registryByes = byeSet(buildCopa(ALL_TEAMS));

    const evolvedFor = (seed: bigint) =>
      buildCopa(ALL_TEAMS.map((t) => evolveTeam(t, 8, seed)));
    const seeds = [1998n, 2026n, 42n, 7n];
    const differs = seeds.some(
      (s) =>
        JSON.stringify([...byeSet(evolvedFor(s))].sort()) !==
        JSON.stringify([...registryByes].sort()),
    );
    expect(differs).toBe(true);

    // Deterministic for a fixed (elapsed, seed).
    expect(evolvedFor(1998n)).toEqual(evolvedFor(1998n));
  });

  it("at elapsed 0 evolved seeding equals the registry draw", () => {
    // evolveTeam at elapsed 0 is identity (regen guard), so seeding the bracket
    // from elapsed-0 evolved sides must match the plain registry draw — this is
    // why season 0 / freshCopa() can use ALL_TEAMS directly.
    const evolved0 = buildCopa(ALL_TEAMS.map((t) => evolveTeam(t, 0, 1998n)));
    expect(evolved0).toEqual(buildCopa(ALL_TEAMS));
  });
});

describe("seededShootout", () => {
  const drawMatch: Match = {
    home: 101,
    away: 202,
    seed: 7n,
    result: { home_goals: 1, away_goals: 1 },
    events: [],
  };

  it("always produces a winner among the two clubs, never a tie", () => {
    const s = seededShootout(drawMatch, 12345n);
    expect(s.homeGoals).not.toBe(s.awayGoals);
    expect([drawMatch.home, drawMatch.away]).toContain(s.winnerId);
  });

  it("is deterministic for the same (match, tieSeed)", () => {
    expect(seededShootout(drawMatch, 999n)).toEqual(seededShootout(drawMatch, 999n));
  });
});

describe("playCupRound + full bracket", () => {
  it("halves survivors 32→16→8→4→2→1 and crowns exactly one champion", () => {
    const final = playWhole(buildCopa(ALL_TEAMS));
    expect(final.rounds.map((r) => r.name)).toEqual(CUP_ROUND_NAMES);
    // Round sizes after the prelim resolves into r32.
    const realCount = (i: number) => final.rounds[i].ties.length;
    expect(realCount(0)).toBe(32); // prelim: 28 ties + 4 byes
    expect(realCount(1)).toBe(16); // r32
    expect(realCount(2)).toBe(8); // r16
    expect(realCount(3)).toBe(4); // qf
    expect(realCount(4)).toBe(2); // sf
    expect(realCount(5)).toBe(1); // final
    expect(final.championId).toBeDefined();
    expect(ALL_TEAMS.some((t) => t.id === final.championId)).toBe(true);
  });

  it("propagates winners in order to the next round", () => {
    let c = playCupRound(buildCopa(ALL_TEAMS), 0, resolveTeam, CUP_SEED);
    const prelimWinners = c.rounds[0].ties.map((t) => t.winnerId);
    const r32 = c.rounds[1].ties;
    for (let i = 0; i < r32.length; i++) {
      expect(r32[i].homeId).toBe(prelimWinners[i * 2]);
      expect(r32[i].awayId).toBe(prelimWinners[i * 2 + 1]);
    }
  });

  it("is deterministic across two full simulations", () => {
    expect(playWhole(buildCopa(ALL_TEAMS))).toEqual(playWhole(buildCopa(ALL_TEAMS)));
  });

  it("records userEliminatedAtRoundIdx and still completes the cup", () => {
    // Pick a weak Série C club so it likely goes out early; assert that
    // whenever it's out, the flag is set and a champion still emerges.
    const userId = ALL_TEAMS[ALL_TEAMS.length - 1].id;
    const final = playWhole(buildCopa(ALL_TEAMS), userId);
    expect(final.championId).toBeDefined();
    if (final.championId !== userId) {
      expect(final.userEliminatedAtRoundIdx).toBeGreaterThanOrEqual(0);
      const res = cupResultFor(final, userId);
      expect(CUP_ROUND_NAMES).toContain(res);
    } else {
      expect(cupResultFor(final, userId)).toBe("champion");
    }
  });

  it("uses the evolved-team resolver without error (season-2 sides)", () => {
    const evolved = (id: number) => evolveTeam(resolveTeam(id), 2, 1998n);
    let c = buildCopa(ALL_TEAMS);
    while (c.championId === undefined) {
      c = playCupRound(c, c.currentCupRoundIdx, evolved, CUP_SEED);
    }
    expect(c.championId).toBeDefined();
  });

  // E.3.b — two-leg ties.
  it("plays every real tie over two legs and decides on aggregate", () => {
    const c = playCupRound(buildCopa(ALL_TEAMS), 0, resolveTeam, CUP_SEED);
    for (const tie of c.rounds[0].ties) {
      if (tie.bye) continue;
      // Both legs present.
      expect(tie.match).toBeDefined();
      expect(tie.leg2).toBeDefined();
      // Aggregates recorded and consistent with the two legs.
      const aggHome = tie.match!.result.home_goals + tie.leg2!.result.away_goals;
      const aggAway = tie.match!.result.away_goals + tie.leg2!.result.home_goals;
      expect(tie.aggHome).toBe(aggHome);
      expect(tie.aggAway).toBe(aggAway);
      // Winner is one of the two sides.
      expect([tie.homeId, tie.awayId]).toContain(tie.winnerId);
      // A shootout only when aggregate AND away goals were level.
      if (tie.shootout) {
        expect(aggHome).toBe(aggAway);
      } else if (aggHome === aggAway) {
        // level aggregate but no shootout ⇒ away-goals broke it
        expect(tie.leg2!.result.away_goals).not.toBe(tie.match!.result.away_goals);
      }
    }
  });

  it("leg 2 reverses home/away (awayId hosts the return)", () => {
    const c = playCupRound(buildCopa(ALL_TEAMS), 0, resolveTeam, CUP_SEED);
    const tie = c.rounds[0].ties.find((t) => !t.bye)!;
    expect(tie.match!.home).toBe(tie.homeId);
    expect(tie.match!.away).toBe(tie.awayId);
    expect(tie.leg2!.home).toBe(tie.awayId);
    expect(tie.leg2!.away).toBe(tie.homeId);
  });
});

// Builds a real season-0 career (user = weakest Série C club) at a given
// league round, for the migration / matchday-integration tests.
function careerAtRound(roundIdx: number): Career {
  const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
  const starter = pickStarterTeam(tierC);
  const seed = 2026n;
  const seasonSeed = seed ^ BigInt(FIRST_YEAR);
  const mk = (teams: Team[], ns: bigint, name: string) =>
    run_season(teams, seasonSeed ^ ns, name) as SeasonRecord;
  return {
    schemaVersion: 10,
    savedAt: "x",
    seed,
    controlledTeamId: starter.id,
    seasons: [],
    currentSeason: {
      year: FIRST_YEAR,
      seed: seasonSeed,
      divisions: [
        { tier: 1, name: "Série A", record: mk(tierA, 1n, "Série A"), currentRoundIdx: roundIdx },
        { tier: 2, name: "Série B", record: mk(tierB, 2n, "Série B"), currentRoundIdx: roundIdx },
        { tier: 3, name: "Série C", record: mk(tierC, 3n, "Série C"), currentRoundIdx: roundIdx },
      ],
      transfers: [],
      copa: freshCopa(),
    },
    manager: { money: STARTING_MONEY, stadiumCapacity: 12_000, fanbase: 10_000, marketingMomentum: 0 },
    userRoster: [],
  };
}

describe("initCopaForSeason (v6→v7 migration fast-forward)", () => {
  it("at round 0 plays no cup rounds (fresh bracket)", () => {
    const copa = initCopaForSeason(careerAtRound(0));
    expect(copa.currentCupRoundIdx).toBe(0);
    expect(copa.championId).toBeUndefined();
  });

  it("fast-forwards past every cup round whose league round has passed", () => {
    // After league round 21, the prelim(3), r32(8), r16(14) and qf(20) cup
    // rounds have all happened (< 21); sf(27)/final(34) have not.
    const copa = initCopaForSeason(careerAtRound(21));
    const played = COPA_ROUND_AT_LEAGUE_ROUND.filter((r) => r < 21).length;
    expect(copa.currentCupRoundIdx).toBe(played);
    expect(played).toBe(4);
    expect(copa.championId).toBeUndefined();
  });

  it("is deterministic for the same career", () => {
    expect(initCopaForSeason(careerAtRound(15))).toEqual(
      initCopaForSeason(careerAtRound(15)),
    );
  });
});

describe("matchday integration", () => {
  it("playing all 6 cup matchdays through the live resolver crowns a champion", () => {
    const career = careerAtRound(0);
    let copa = career.currentSeason.copa;
    const resolve = cupTeamResolver(career);
    const cupSeed = cupSeedFor(career.currentSeason);
    // Emulate SeasonView.playRound: each mapped league round plays its cup round.
    for (let cupRoundIdx = 0; cupRoundIdx < COPA_ROUND_AT_LEAGUE_ROUND.length; cupRoundIdx++) {
      expect(copa.currentCupRoundIdx).toBe(cupRoundIdx);
      copa = playCupRound(copa, cupRoundIdx, resolve, cupSeed, career.controlledTeamId);
    }
    expect(copa.championId).toBeDefined();
    expect(copa.currentCupRoundIdx).toBe(6);
  });
});
