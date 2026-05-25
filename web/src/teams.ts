// Bundled sample teams. Vite imports JSON at build time.
import santosJson from "../../assets/teams/santos_imperial.json";
import flamenguinhoJson from "../../assets/teams/flamenguinho_fc.json";
import ipanemaJson from "../../assets/teams/ipanema_atletico.json";
import type { Team } from "./types";

export const SAMPLE_TEAMS: Team[] = [
  santosJson as unknown as Team,
  flamenguinhoJson as unknown as Team,
  ipanemaJson as unknown as Team,
];

export function teamById(id: number): Team | undefined {
  return SAMPLE_TEAMS.find((t) => t.id === id);
}
