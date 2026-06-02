import { points, type TeamStats } from "../types";
import { PROMOTION_SLOTS, RELEGATION_SLOTS } from "./promotion";

// E.5.b — Career objectives. Surface the natural difficulty ladder the RL data
// exposes (survive a season → get promoted → win Série A) as explicit, live
// goals, so the title reads as the frontier rather than the baseline. Pure
// derivation from the user's live standings — no new state, no engine touch.

export type ObjectiveStatus = "met" | "onTrack" | "atRisk" | "missed";

export type Objective = {
  /** Short label, e.g. "Subir de divisão" / "Ser campeão". */
  label: string;
  /** One-line current-state detail, e.g. "3º — dentro do G4". */
  detail: string;
  status: ObjectiveStatus;
  /** The headline goal for this tier (drawn first, emphasised). */
  primary: boolean;
};

/** 1-based position of the user in a standings list (computeStandings is already
 *  sorted by the league tiebreaker). Falls back to last if not found. */
export function userPositionIn(standings: TeamStats[], teamId: number): number {
  const idx = standings.findIndex((s) => s.team_id === teamId);
  return idx >= 0 ? idx + 1 : standings.length;
}

/**
 * The goal ladder for the user's current tier + live standings position.
 *
 * - Série C (3): promotion is the headline; the title is the long-horizon dream.
 * - Série B (2): promotion headline + an "avoid relegation" floor.
 * - Série A (1): survival floor + the title as the headline frontier.
 *
 * `position` is 1-based; `size` the league size (20). Status is computed from
 * where the user sits relative to the promotion/relegation cut lines NOW.
 */
export function objectivesFor(
  tier: 1 | 2 | 3,
  position: number,
  size: number,
  standings: TeamStats[],
  teamId: number,
): Objective[] {
  const promoteCut = PROMOTION_SLOTS; // top N promote
  const relegateCut = size - RELEGATION_SLOTS + 1; // ≥ this position relegates
  const pts = (() => {
    const s = standings.find((x) => x.team_id === teamId);
    return s ? points(s) : 0;
  })();

  const ordinal = `${position}º`;
  const out: Objective[] = [];

  if (tier === 1) {
    // Série A — survive, then chase the title.
    const champion: Objective = {
      label: "Ser campeão da Série A",
      detail:
        position === 1
          ? `1º — na liderança (${pts} pts)`
          : `${ordinal} — título é a fronteira`,
      status: position === 1 ? "met" : position <= 4 ? "onTrack" : "atRisk",
      primary: true,
    };
    const survive: Objective = {
      label: "Permanecer na Série A",
      detail:
        position < relegateCut
          ? `${ordinal} — fora do Z${RELEGATION_SLOTS}`
          : `${ordinal} — no Z${RELEGATION_SLOTS}, perigo`,
      status: position < relegateCut ? "onTrack" : "atRisk",
      primary: false,
    };
    out.push(champion, survive);
    return out;
  }

  // Série B / C — promotion is the headline.
  const promote: Objective = {
    label: "Subir de divisão",
    detail:
      position <= promoteCut
        ? `${ordinal} — dentro do G${PROMOTION_SLOTS} (${pts} pts)`
        : `${ordinal} — fora do G${PROMOTION_SLOTS} por ora`,
    status: position <= promoteCut ? "onTrack" : "atRisk",
    primary: true,
  };
  out.push(promote);

  if (tier === 2) {
    out.push({
      label: "Evitar o rebaixamento",
      detail:
        position < relegateCut
          ? `${ordinal} — fora do Z${RELEGATION_SLOTS}`
          : `${ordinal} — no Z${RELEGATION_SLOTS}, perigo`,
      status: position < relegateCut ? "onTrack" : "atRisk",
      primary: false,
    });
  }

  // The long-horizon dream, shown dimmed on the lower tiers.
  out.push({
    label: "Chegar e vencer a Série A",
    detail: tier === 2 ? "a uma promoção de distância" : "a duas promoções de distância",
    status: "onTrack",
    primary: false,
  });
  return out;
}
