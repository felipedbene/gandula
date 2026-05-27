// Team registry — bundled at build time by Vite.
//
// Two pools:
//   - SAMPLE_TEAMS: the 3 hand-written debug teams (Santos Imperial,
//     Flamenguinho FC, Ipanema Atlético). Kept for backward compat with
//     existing components and for engine-level smoke testing.
//   - FICTIONAL_TEAMS: the 14-club "Brasileirão Imaginário" produced by
//     scripts/build-fictional-teams.sh — real FC25 Brazilian rosters
//     renamed through gandula-fictionalize with seed 1998.
//
// Both are merged into ALL_TEAMS, which is what teamById() searches.

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

export const ALL_TEAMS: Team[] = [...SAMPLE_TEAMS, ...FICTIONAL_TEAMS];

export function teamById(id: number): Team | undefined {
  return ALL_TEAMS.find((t) => t.id === id);
}
