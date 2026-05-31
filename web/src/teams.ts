// Team registry — bundled at build time by Vite.
//
// Two pools:
//   - SAMPLE_TEAMS: the 3 hand-written debug teams (Santos Imperial,
//     Flamenguinho FC, Ipanema Atlético). Kept for engine-level smoke
//     testing ONLY — deliberately excluded from ALL_TEAMS so they don't
//     pollute the talent gradient (and because their ids 1–3 collide with
//     fictional team ids). Import SAMPLE_TEAMS directly where you need them.
//   - FICTIONAL_TEAMS: the 60-club "Brasileirão Imaginário" (Série A/B/C ×
//     20) produced by scripts/build-fictional-teams.sh — the strongest 60
//     FC25 clubs by avg overall, renamed deterministically (seed 1998).
//     Ranked overall spans a clean three-tier gradient (see
//     util/divisions world-fixture test).
//
// ALL_TEAMS = FICTIONAL_TEAMS only (the 60-team world). teamById() searches it.

import santosJson from "../../assets/teams/santos_imperial.json";
import flamenguinhoJson from "../../assets/teams/flamenguinho_fc.json";
import ipanemaJson from "../../assets/teams/ipanema_atletico.json";
import type { Team } from "./types";

export const SAMPLE_TEAMS: Team[] = [
  santosJson as unknown as Team,
  flamenguinhoJson as unknown as Team,
  ipanemaJson as unknown as Team,
];

// Eager glob: Vite resolves these imports at build time, so the bundle gets
// the JSON inlined just like an explicit `import x from '...'`. No runtime
// fetch, no async, no code splitting required. Re-running
// scripts/build-fictional-teams.sh and rebuilding picks up new files
// automatically — no edits here needed.
//
// `_mapping.json` lives in the same directory but isn't a Team — exclude it.
const fictionalModules = import.meta.glob<{ default: unknown }>(
  "../../assets/teams/fictional/*.json",
  { eager: true },
);

export const FICTIONAL_TEAMS: Team[] = Object.entries(fictionalModules)
  .filter(([path]) => !path.endsWith("/_mapping.json"))
  .map(([, mod]) => mod.default as Team)
  // Stable ordering: ascending by id, so UI lists don't shuffle between
  // builds (glob iteration order isn't guaranteed across platforms).
  .sort((a, b) => a.id - b.id);

export const ALL_TEAMS: Team[] = [...FICTIONAL_TEAMS];

export function teamById(id: number): Team | undefined {
  return ALL_TEAMS.find((t) => t.id === id);
}
