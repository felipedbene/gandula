import { mulberry32 } from "./prng";
import { ageRoster } from "./aging";
import { buildYouth, playerOverall, regenId } from "./transfer-market";
import type { Player, Team } from "../types";

/** Engine bench cap (mirrors core/src/domain/team.rs MAX_BENCH). */
const MAX_BENCH = 7;

// E.2.b — opponent regen. Opponents reset to the immutable registry each
// season, so we replay their evolution from the registry base each time we
// compose a season (deterministic, no per-team persistence). Each season:
// age → retire the old → bring in youth → rebuild a valid XI/bench. The user's
// squad isn't touched here (it ages via E.2.a and refreshes via the market).

/** Players this age or older retire at season's end. */
export const RETIREMENT_AGE = 36;

/** Evolve a registry team forward `seasons` years (age + retire + youth +
 *  rebuild). Pure + deterministic in (team, seasons, careerSeed). The result
 *  always satisfies the engine: 11 distinct XI in roster, valid bench. */
export function evolveTeam(team: Team, seasons: number, careerSeed: bigint): Team {
  let t = team;
  for (let offset = 1; offset <= seasons; offset++) {
    t = evolveOneSeason(t, careerSeed, offset);
  }
  return t;
}

function rngFor(careerSeed: bigint, teamId: number, yearOffset: number): () => number {
  const s =
    (careerSeed ^ BigInt(teamId) ^ (BigInt(yearOffset) * 0x9e37n) ^ 0x4ee7n) &
    0xffffffffn;
  return mulberry32(Number(s));
}

function evolveOneSeason(team: Team, careerSeed: bigint, yearOffset: number): Team {
  const rng = rngFor(careerSeed, team.id, yearOffset);

  // 1. Age, then split into who stays and who retires.
  const aged = ageRoster(team.roster);
  const agedById = new Map(aged.map((p) => [p.id, p]));
  const retired = aged.filter((p) => p.age >= RETIREMENT_AGE);
  const retiredIds = new Set(retired.map((p) => p.id));
  const survivors = aged.filter((p) => !retiredIds.has(p.id));

  // 2. One youth per retiree, same position — roster size holds constant.
  const youth: Player[] = retired.map((r, slot) =>
    buildYouth(rng, regenId(team.id, yearOffset, slot), r.position),
  );
  const roster = [...survivors, ...youth];

  // 3. Rebuild XI + bench so they stay valid (no retired ids, 11 in roster).
  const startingXi = backfillXI(team.starting_xi, retiredIds, roster, agedById);
  const bench = backfillBench(team.bench ?? [], retiredIds, roster, startingXi);

  return { ...team, roster, starting_xi: startingXi, bench };
}

/** Replace each retired XI slot with the best available roster player,
 *  preferring the retiree's position. Survivors keep their slots. */
function backfillXI(
  oldXi: number[],
  retiredIds: Set<number>,
  roster: Player[],
  agedById: Map<number, Player>,
): number[] {
  const rosterIds = new Set(roster.map((p) => p.id));
  const result = oldXi.filter((id) => !retiredIds.has(id) && rosterIds.has(id));
  const used = new Set(result);
  const byOverall = roster
    .filter((p) => !used.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a) || a.id - b.id);

  const lostPositions = oldXi
    .filter((id) => retiredIds.has(id))
    .map((id) => agedById.get(id)?.position);

  const take = (pred: (p: Player) => boolean): boolean => {
    const pick = byOverall.find((p) => !used.has(p.id) && pred(p));
    if (!pick) return false;
    result.push(pick.id);
    used.add(pick.id);
    return true;
  };

  for (const pos of lostPositions) {
    if (!take((p) => p.position === pos)) take(() => true);
  }
  // Safety net (roster size is held constant, so this rarely fires).
  while (result.length < 11 && take(() => true)) {
    /* fill */
  }
  return result;
}

/** Drop retirees from the bench, then top it back up from the best remaining
 *  non-XI players, keeping the original depth (≤ MAX_BENCH). */
function backfillBench(
  oldBench: number[],
  retiredIds: Set<number>,
  roster: Player[],
  xi: number[],
): number[] {
  const xiSet = new Set(xi);
  const rosterIds = new Set(roster.map((p) => p.id));
  const bench = oldBench.filter(
    (id) => !retiredIds.has(id) && rosterIds.has(id) && !xiSet.has(id),
  );
  const target = Math.min(MAX_BENCH, oldBench.length);
  if (bench.length >= target) return bench;

  const used = new Set([...xiSet, ...bench]);
  const fill = roster
    .filter((p) => !used.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a) || a.id - b.id)
    .slice(0, target - bench.length)
    .map((p) => p.id);
  return [...bench, ...fill];
}
