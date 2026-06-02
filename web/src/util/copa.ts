// Copa do Brasil — a season-long knockout cup over all 60 clubs (E.3).
//
// Pure TS over the engine's `play_match`: the engine has no notion of a cup,
// of byes, or of a shootout — this module layers the knockout structure on
// top of single-match simulation, exactly the way util/resimulate.ts layers
// re-simulation. Determinism is end-to-end: the bracket is a pure function of
// the team set + a cup seed (no PRNG — strength-mirror pairing), and every tie
// derives its match seed from the cup seed, so the whole cup replays
// identically.
//
// Bracket shape (64 slots): the 4 strongest Série A clubs get a prelim bye;
// the other 56 play 28 prelim ties → 28 winners, so the round of 32 is 28
// winners + 4 byes. Then 32→16→8→4→2→1. Six named rounds.
import { play_match, derive_match_seed } from "../wasm/gandula_wasm.js";
import { mulberry32 } from "./prng";
import { divideIntoDivisions } from "./divisions";
import { evolveTeam } from "./regen";
import { userTeam } from "./roster";
import { ALL_TEAMS, teamById } from "../teams";
import type { Match, Team } from "../types";
import type { Career, Copa, CupRoundName, CupShootout, CupTie, Season } from "../persistence";
import { FIRST_YEAR, findUserDivisionIdxInSeason, totalRoundsOf } from "../persistence";

/** Sentinel `awayId` for a bye tie (no real opponent). Lives here (cup logic)
 *  rather than in persistence so copa.ts has no runtime dep on persistence —
 *  persistence imports the v6→v7 migration from here, and a value import the
 *  other way would make a cycle. */
export const COPA_BYE = -1;

/** Cup seed namespace — XORed into the season seed to derive the cup seed.
 *  Distinct from the per-tier league namespaces (1n/2n/3n) and from the
 *  next-season namespace (BigInt(year)), so cup match seeds never collide
 *  with any league fixture's seed. */
const CUP_SEED_NS = 0xc09an;

/** Number of strongest Série A clubs that bye the prelim (→ round of 32). */
const PRELIM_BYES = 4;

/** The six cup rounds, in order. `rounds[i].name === CUP_ROUND_NAMES[i]`. */
export const CUP_ROUND_NAMES: CupRoundName[] = [
  "prelim",
  "r32",
  "r16",
  "qf",
  "sf",
  "final",
];

/**
 * Which league round (0-based `currentRoundIdx`) each cup round is played on.
 * Index i = cup round i (prelim..final). Spread across the 38-round league,
 * with the final before the last league rounds so the user keeps playing
 * league fixtures after the cup concludes.
 */
export const COPA_ROUND_AT_LEAGUE_ROUND: number[] = [3, 8, 14, 20, 27, 34];

/** The cup seed for a season — its own namespace off the season seed. */
export function cupSeedFor(season: Season): bigint {
  return season.seed ^ BigInt(CUP_SEED_NS);
}

/** Fold a bigint seed into a 32-bit Mulberry32 generator (same fold as
 *  prng.revealMinutes / regen.rngFor). */
function rngFromSeed(seed: bigint): () => number {
  const lo = Number(seed & 0xffffffffn);
  const hi = Number((seed >> 32n) & 0xffffffffn);
  return mulberry32((lo ^ hi) >>> 0);
}

/**
 * Build the initial Copa bracket: the prelim round drawn in full, later rounds
 * empty (appended by playCupRound as winners resolve). Seeds by tier strength
 * (Série A strongest) via divideIntoDivisions; the 4 strongest A clubs bye,
 * the other 56 are paired strongest-vs-weakest (strength-mirror) — no PRNG, so
 * the draw is trivially reproducible.
 *
 * Seeding ranks by the strength of the teams PASSED IN. Callers pass the
 * season's EVOLVED sides (via cupTeamResolver / composeTeam), so the bracket
 * shape reflects the aged/regen'd/transfer-aware world and shifts season to
 * season as clubs rise and fall. Deterministic per season: evolved strength is
 * a pure function of (registry, elapsed, seed), so a given season's draw always
 * replays identically. (freshCopa() with no resolver — season 0 / tests — falls
 * back to registry strength, which equals the evolved strength at elapsed 0.)
 */
export function buildCopa(teams: Team[]): Copa {
  const [tierA, tierB, tierC] = divideIntoDivisions(teams);

  // 4 strongest A clubs bye straight to the round of 32.
  const byeClubs = tierA.slice(0, PRELIM_BYES);
  // Everyone else plays the prelim, ordered strongest → weakest so the
  // strength-mirror pairing gives the strongest a winnable opener.
  const prelimClubs = [...tierA.slice(PRELIM_BYES), ...tierB, ...tierC];

  const ties: CupTie[] = [];
  // Strength-mirror: strongest vs weakest, working inward. 56 clubs → 28 ties.
  for (let i = 0; i < prelimClubs.length / 2; i++) {
    const home = prelimClubs[i];
    const away = prelimClubs[prelimClubs.length - 1 - i];
    ties.push({ homeId: home.id, awayId: away.id, played: false });
  }
  // The 4 byes ride through the prelim as resolved bye ties.
  for (const club of byeClubs) {
    ties.push({ homeId: club.id, awayId: COPA_BYE, bye: true, played: true, winnerId: club.id });
  }

  return {
    rounds: [{ name: "prelim", ties }],
    currentCupRoundIdx: 0,
  };
}

/**
 * Deterministic penalty shootout for a drawn tie. Best-of-5 then sudden death,
 * each kick a seeded coin weighted slightly by nothing (50/50) — the drama is
 * deterministic from the tie seed. Never returns a tie.
 */
export function seededShootout(match: Match, tieSeed: bigint): CupShootout {
  const rng = rngFromSeed(tieSeed ^ match.seed ^ 0x5e_0c_0an);
  let home = 0;
  let away = 0;
  // Five kicks each.
  for (let i = 0; i < 5; i++) {
    if (rng() < 0.75) home++;
    if (rng() < 0.75) away++;
  }
  // Sudden death until decided.
  while (home === away) {
    const h = rng() < 0.75;
    const a = rng() < 0.75;
    if (h) home++;
    if (a) away++;
  }
  return {
    homeGoals: home,
    awayGoals: away,
    winnerId: home > away ? match.home : match.away,
  };
}

/** Leg-seed namespaces — XORed into the tie seed so the two legs draw distinct
 *  (but deterministic) match seeds and never collide with each other or the
 *  shootout's `0x5e0c0a` fold in seededShootout. */
const LEG1_NS = 0x1e_60_01n;
const LEG2_NS = 0x1e_60_02n;

/**
 * Resolve a single non-bye tie over TWO LEGS (E.3.b). Leg 1: homeId hosts.
 * Leg 2: awayId hosts (sides reversed). Winner is decided on AGGREGATE goals,
 * then the AWAY-GOALS rule (the leg-1 away side's goals scored AT homeId count
 * extra if aggregate is level), then a penalty shootout at leg 2's venue.
 * Returns a resolved copy with both legs, aggregates, and (if needed) shootout.
 *
 * Determinism: each leg derives its own seed from the tie seed via a fixed XOR,
 * so the whole two-leg tie is a pure function of (tieSeed, the two sides).
 */
function resolveTie(tie: CupTie, tieSeed: bigint, resolveTeam: (id: number) => Team): CupTie {
  const homeTeam = resolveTeam(tie.homeId);
  const awayTeam = resolveTeam(tie.awayId);

  // Leg 1 at homeId; leg 2 at awayId (reversed).
  const match = play_match(homeTeam, awayTeam, tieSeed ^ LEG1_NS) as Match;
  const leg2 = play_match(awayTeam, homeTeam, tieSeed ^ LEG2_NS) as Match;

  // Aggregate from each side's perspective. In leg 2 the sides are swapped, so
  // homeId's goals are leg2.away_goals and awayId's are leg2.home_goals.
  const aggHome = match.result.home_goals + leg2.result.away_goals;
  const aggAway = match.result.away_goals + leg2.result.home_goals;

  if (aggHome !== aggAway) {
    const winnerId = aggHome > aggAway ? tie.homeId : tie.awayId;
    return { ...tie, played: true, match, leg2, aggHome, aggAway, winnerId };
  }

  // Aggregate level → away-goals rule. Goals scored AWAY: homeId scored away in
  // leg 2 (leg2.away_goals); awayId scored away in leg 1 (match.away_goals).
  const homeAwayGoals = leg2.result.away_goals;
  const awayAwayGoals = match.result.away_goals;
  if (homeAwayGoals !== awayAwayGoals) {
    const winnerId = homeAwayGoals > awayAwayGoals ? tie.homeId : tie.awayId;
    return { ...tie, played: true, match, leg2, aggHome, aggAway, winnerId };
  }

  // Still level → penalty shootout at leg 2's venue (awayId hosts). seededShootout
  // returns winner ∈ {leg2.home, leg2.away} = {awayId, homeId}; map back.
  const shootout = seededShootout(leg2, tieSeed);
  const winnerId = shootout.winnerId; // already a team id (leg2.home/away)
  return { ...tie, played: true, match, leg2, aggHome, aggAway, shootout, winnerId };
}

/** Count of real (non-bye) ties in all rounds strictly before `roundIdx` — the
 *  base for a monotonic global tie index, so derive_match_seed never repeats a
 *  fixture index within one cup. */
function tieSeedBase(copa: Copa, roundIdx: number): number {
  let base = 0;
  for (let r = 0; r < roundIdx; r++) {
    base += copa.rounds[r].ties.filter((t) => !t.bye).length;
  }
  return base;
}

const nextRoundName = (name: CupRoundName): CupRoundName | undefined => {
  const i = CUP_ROUND_NAMES.indexOf(name);
  return CUP_ROUND_NAMES[i + 1];
};

/**
 * Play every unresolved tie in round `roundIdx`, then draw the next round from
 * the winners (strongest-line preserved: winner of tie 0 vs winner of tie 1,
 * etc.). Pure — returns a new Copa. Sets `championId` when the final resolves
 * and `userEliminatedAtRoundIdx` if `controlledTeamId` loses here.
 *
 * `resolveTeam` maps a team id to the Team to field — the caller supplies the
 * evolved-opponent / userTeam-aware resolver (identical to resimulate.ts), so
 * the cup fields the same sides the league does.
 */
export function playCupRound(
  copa: Copa,
  roundIdx: number,
  resolveTeam: (id: number) => Team,
  cupSeed: bigint,
  controlledTeamId?: number,
): Copa {
  const round = copa.rounds[roundIdx];
  if (!round) throw new Error(`playCupRound: no round at index ${roundIdx}`);

  const base = tieSeedBase(copa, roundIdx);
  let tieCounter = 0;
  const playedTies: CupTie[] = round.ties.map((tie) => {
    if (tie.bye || tie.played) return tie; // byes (and any already-played) pass through
    const tieSeed = derive_match_seed(cupSeed, base + tieCounter);
    tieCounter += 1;
    return resolveTie(tie, BigInt(tieSeed), resolveTeam);
  });

  const rounds = copa.rounds.slice();
  rounds[roundIdx] = { ...round, ties: playedTies };

  // Did the user go out this round?
  let userEliminatedAtRoundIdx = copa.userEliminatedAtRoundIdx;
  if (controlledTeamId !== undefined && userEliminatedAtRoundIdx === undefined) {
    const userTie = playedTies.find(
      (t) => t.homeId === controlledTeamId || t.awayId === controlledTeamId,
    );
    if (userTie && userTie.winnerId !== controlledTeamId) {
      userEliminatedAtRoundIdx = roundIdx;
    }
  }

  // Draw the next round from this round's winners, or crown the champion.
  let championId = copa.championId;
  const winners = playedTies.map((t) => t.winnerId!).filter((id) => id !== undefined);
  const nextName = nextRoundName(round.name);
  if (nextName === undefined) {
    // This was the final.
    championId = winners[0];
  } else if (rounds[roundIdx + 1] === undefined) {
    const nextTies: CupTie[] = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextTies.push({ homeId: winners[i], awayId: winners[i + 1], played: false });
    }
    rounds[roundIdx + 1] = { name: nextName, ties: nextTies };
  }

  return {
    ...copa,
    rounds,
    currentCupRoundIdx: copa.currentCupRoundIdx + 1,
    championId,
    userEliminatedAtRoundIdx,
  };
}

/** The user's tie in a given cup round, or undefined (not in it / eliminated). */
export function userTieInRound(
  copa: Copa,
  roundIdx: number,
  controlledTeamId: number,
): CupTie | undefined {
  const round = copa.rounds[roundIdx];
  if (!round) return undefined;
  return round.ties.find(
    (t) => !t.bye && (t.homeId === controlledTeamId || t.awayId === controlledTeamId),
  );
}

/** The user's Copa outcome for season history: "champion", the round-name they
 *  were knocked out at, or undefined if the cup isn't finished / they had a bye
 *  to the end somehow. */
export function cupResultFor(
  copa: Copa,
  controlledTeamId: number,
): CupRoundName | "champion" | undefined {
  if (copa.championId === controlledTeamId) return "champion";
  if (copa.userEliminatedAtRoundIdx !== undefined) {
    return copa.rounds[copa.userEliminatedAtRoundIdx]?.name;
  }
  return undefined;
}

/**
 * The team-resolver every cup sim uses: the user's club resolves to its
 * effective (transfer/aging-aware) squad via userTeam(); opponents resolve to
 * the same evolved side the league fields — evolveTeam(registry, elapsed,
 * seed) — so a cup result matches the league's notion of strength. Identical
 * in spirit to the resolver in resimulate.ts. Memoized per call.
 */
export function cupTeamResolver(career: Career): (id: number) => Team {
  const elapsed = career.currentSeason.year - FIRST_YEAR;
  const cache = new Map<number, Team>();
  const user = userTeam(career);
  return (id: number): Team => {
    if (id === career.controlledTeamId) return user;
    const hit = cache.get(id);
    if (hit) return hit;
    const base = teamById(id);
    if (!base) throw new Error(`copa: team ${id} not in registry`);
    const evolved = elapsed > 0 ? evolveTeam(base, elapsed, career.seed) : base;
    cache.set(id, evolved);
    return evolved;
  };
}

/**
 * Build the Copa for a freshly-started season: the prelim drawn, no rounds
 * played. Used by the NEW-CAREER path (season 0), where the world hasn't aged
 * yet — so it seeds from registry strength, which equals the evolved strength
 * at elapsed 0. Subsequent seasons seed from evolved sides directly (career.ts
 * buildNextSeason maps ALL_TEAMS through composeTeam into buildCopa).
 */
export function freshCopa(): Copa {
  return buildCopa(ALL_TEAMS);
}

/**
 * Build (or rebuild) a season's Copa and fast-forward it past every cup round
 * whose mapped league round has ALREADY been played in the user's division.
 * Used by the v6→v7 migration so a mid-season save shows correct bracket
 * progress, and is a pure deterministic replay (same career → same bracket).
 */
export function initCopaForSeason(career: Career): Copa {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const playedRounds = Math.min(userDiv.currentRoundIdx, totalRoundsOf(userDiv));

  const resolve = cupTeamResolver(career);
  // Seed the bracket from the season's evolved sides (resolver-mapped), so the
  // draw reflects the aged world at this point in the career. At elapsed 0 the
  // resolver yields the registry sides, so season 0 is unchanged.
  let copa = buildCopa(ALL_TEAMS.map((t) => resolve(t.id)));
  const cupSeed = cupSeedFor(season);

  // A cup round "has happened" if its mapped league round index is strictly
  // less than the number of league rounds already played.
  for (let cupRoundIdx = 0; cupRoundIdx < COPA_ROUND_AT_LEAGUE_ROUND.length; cupRoundIdx++) {
    if (COPA_ROUND_AT_LEAGUE_ROUND[cupRoundIdx] < playedRounds) {
      copa = playCupRound(copa, cupRoundIdx, resolve, cupSeed, career.controlledTeamId);
    } else {
      break; // mapping is ascending — once one is in the future, all later are
    }
  }
  return copa;
}
