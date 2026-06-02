import { useEffect, useMemo, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import type { SeasonRecord, TeamStats } from "../types";
import { computeStandings, goalDifference, points } from "../types";
import {
  FIRST_YEAR,
  STARTING_MONEY,
  clearCareer,
  findUserDivisionIdxInSeason,
  loadCareer,
  saveCareer,
  totalRoundsOf,
  type Career,
  type Division,
  type SeasonHistory,
  type TransferRecord,
} from "../persistence";
import {
  biggestWin,
  buildPlayerLookup,
  cardLeader,
  topAssister,
  topScorer,
} from "../util/season-stats";
import {
  divideIntoDivisions,
  pickRandomStarter,
  WORLD_SIZE,
} from "../util/divisions";
import {
  computePromotionRelegation,
  userOutcomeFromPRResult,
} from "../util/promotion";
import {
  COPA_ROUND_AT_LEAGUE_ROUND,
  cupResultFor,
  cupSeedFor,
  cupTeamResolver,
  freshCopa,
  initCopaForSeason,
  playCupRound,
} from "../util/copa";
import { advanceCareer } from "../util/career";
import {
  computeSeasonFinances,
  cupPrizeForAdvance,
  isManagerFired,
  roundCashDelta,
  seedStadiumForTier,
} from "../util/finances";
import { formatMoney } from "../util/money";
import TransferMarketView from "./TransferMarketView";
import SupportView from "./SupportView";
import { Button, Divider, Group, Stack, Table, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";
import RevealRound from "./RevealRound";
import CopaView from "./CopaView";
import TacticsView from "./TacticsView";
import PrepareView from "./PrepareView";
import { Objectives } from "./Objectives";

type SeasonViewProps = {
  onStatus: (msg: string) => void;
};

/**
 * The view is a state machine bundled into a single useState so the phase
 * tag and its associated data can't drift apart (type-narrowing enforces
 * the invariant that you can't be in `prepare` without a `career` etc.).
 *
 * Phase taxonomy:
 *   - `loading`/`form`: bootstrap.
 *   - `running`: user's division still has rounds left to play.
 *   - `viewOtherDivision`/`prepare`/`revealing`/`tactics`: branches off of
 *     running; all return there or to `finale` once the user's last round
 *     finishes revealing.
 *   - `finale`: user's division is done (and so is the other tier — see
 *     silent-advance in `playRound`). Shows champion, P/R outcome, and
 *     the next-season / history / new-career buttons.
 *   - `history`: read-only list of past SeasonHistory entries.
 */
type Phase =
  | { tag: "loading" }
  | { tag: "form" }
  | { tag: "running"; career: Career }
  | { tag: "viewOtherDivision"; career: Career }
  | { tag: "copa"; career: Career }
  | { tag: "prepare"; career: Career }
  | { tag: "revealing"; career: Career }
  | { tag: "tactics"; career: Career }
  | { tag: "finale"; career: Career }
  | { tag: "history"; career: Career }
  | { tag: "transferMarket"; career: Career; returnTo: "running" | "finale" }
  | { tag: "fired"; career: Career; finalBalance: number }
  | { tag: "support" };

/**
 * Pick the right initial phase for a loaded/migrated Career. If the user's
 * division has played all its rounds, jump straight to `finale` — otherwise
 * resume in `running`. Used by both the autoload path and by the round
 * reveal's onDone handoff.
 */
function initialPhaseFor(career: Career): Phase {
  const userDivIdx = findUserDivisionIdxInSeason(
    career.currentSeason,
    career.controlledTeamId,
  );
  const userDiv = career.currentSeason.divisions[userDivIdx];
  if (userDiv.currentRoundIdx >= totalRoundsOf(userDiv)) {
    return { tag: "finale", career };
  }
  return { tag: "running", career };
}

/** A fresh pseudo-random seed for a new career, so each one gets a different
 *  league by default. The field stays editable — type a fixed seed (e.g. 1998)
 *  to reproduce or share a specific career. */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export function SeasonView({ onStatus }: SeasonViewProps) {
  const [phase, setPhase] = useState<Phase>({ tag: "loading" });

  // The new-career form has no inputs now: the seed is generated randomly at
  // run() time and the team is assigned via pickRandomStarter — see run().
  const [error, setError] = useState<string | null>(null);

  // Autoload once on mount. Discriminated LoadCareerResult lets us surface
  // distinct status messages per scenario (loaded / expandedWorld / none) —
  // silent transitions would confuse the user.
  useEffect(() => {
    loadCareer()
      .then(async (result) => {
        if (
          result.kind === "loaded" ||
          result.kind === "migratedV6" ||
          result.kind === "migratedV7" ||
          result.kind === "migratedV8" ||
          result.kind === "migratedV9"
        ) {
          let career = result.career;
          const migrated =
            result.kind === "migratedV6" ||
            result.kind === "migratedV7" ||
            result.kind === "migratedV8" ||
            result.kind === "migratedV9";
          if (migrated) {
            // Additive cascade v6→v7→v8→v9→v10 — progress preserved.
            //   v6 lacks the Copa (deterministic from the season seed,
            //     fast-forwarded past played cup rounds);
            //   v6 + v7 lack the stadium/fanbase fields (seeded by tier);
            //   v6 + v7 + v8 lack marketingMomentum (→ 0);
            //   v6 + v9 have a single-leg Copa → re-derive as two-leg (E.3.b),
            //     a deterministic replay fast-forwarded past played cup rounds.
            // seedStadiumForTier supplies stadiumCapacity/fanbase/momentum;
            // a v8/v9 save already has the stadium fields, so v8 only needs
            // momentum 0 added and v9 needs nothing on the manager. Per-kind:
            const userTierForSeed = career.currentSeason.divisions[
              findUserDivisionIdxInSeason(
                career.currentSeason,
                career.controlledTeamId,
              )
            ].tier;
            const managerFields =
              result.kind === "migratedV9"
                ? career.manager // v9 already has every manager field
                : result.kind === "migratedV8"
                  ? { ...career.manager, marketingMomentum: 0 }
                  : { ...career.manager, ...seedStadiumForTier(userTierForSeed) };
            // v6 (no Copa) and v9 (single-leg Copa) both (re)derive the Copa;
            // initCopaForSeason now builds two-leg ties and replays played
            // rounds, so a mid-season v9 save keeps correct bracket progress.
            const needsCopaRebuild =
              result.kind === "migratedV6" || result.kind === "migratedV9";
            career = {
              ...career,
              schemaVersion: 10,
              currentSeason: needsCopaRebuild
                ? { ...career.currentSeason, copa: initCopaForSeason(career) }
                : career.currentSeason,
              manager: managerFields,
            };
            await saveCareer(career);
          }
          const userDivIdx = findUserDivisionIdxInSeason(
            career.currentSeason,
            career.controlledTeamId,
          );
          const userDiv = career.currentSeason.divisions[userDivIdx];
          const teamName =
            teamById(career.controlledTeamId)?.name ??
            `Time ${career.controlledTeamId}`;
          const prefix =
            result.kind === "migratedV6"
              ? "save v6 migrado (Copa + estádio + marketing)"
              : result.kind === "migratedV7"
                ? "save v7 migrado (estádio + marketing)"
                : result.kind === "migratedV8"
                  ? "save v8 migrado (marketing)"
                  : result.kind === "migratedV9"
                    ? "save v9 migrado (Copa em ida e volta)"
                    : "save carregado";
          onStatus(
            `${prefix} · ${teamName} (${userDiv.name}) · ano ${career.currentSeason.year} · rodada ${userDiv.currentRoundIdx} · $ ${formatMoney(career.manager.money)}`,
          );
          setPhase(initialPhaseFor(career));
        } else if (result.kind === "expandedWorld") {
          // Pre-v6 (2-tier) save discarded by the E.2 expansion — start a
          // fresh 3-tier career immediately so the user never sees an empty
          // slate. run() emits its own status message.
          onStatus("mundo expandido para 3 divisões · iniciando carreira nova");
          run();
        } else {
          setPhase({ tag: "form" });
        }
      })
      .catch((e) => {
        // IDB unavailable (private mode, quota exhausted, etc.) — fail
        // open to the form so the UI still renders.
        onStatus(`erro ao carregar save: ${e}`);
        setPhase({ tag: "form" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * NOVA CARREIRA. Builds three divisions in parallel (Série A / B / C, 20
   * teams each) from ALL_TEAMS, partitioned by `divideIntoDivisions`. The
   * user takes a random Série C club (bottom tier) — the climb starts at the
   * bottom of the pyramid. Per-division match-seed namespace via
   * `seasonSeed XOR BigInt(tier)` so the three leagues never collide on
   * fixture index in the engine's match_seed derivation. Same XOR is used on
   * re-simulation (see `util/resimulate.ts`) and on next-season generation
   * (see `util/career.ts`), keeping determinism end-to-end.
   */
  function run() {
    setError(null);
    try {
      if (ALL_TEAMS.length !== WORLD_SIZE) {
        throw new Error(
          `Esperado ${WORLD_SIZE} times, encontrado ${ALL_TEAMS.length}. Verifique assets/teams/.`,
        );
      }
      const [tierA, tierB, tierC] = divideIntoDivisions(ALL_TEAMS);
      const starterTeam = pickRandomStarter(tierC);
      const seed = randomSeed();
      const careerSeed = BigInt(seed);
      const seasonSeed = careerSeed ^ BigInt(FIRST_YEAR);

      const start = performance.now();
      const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
      const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
      const recordC = run_season(tierC, seasonSeed ^ 3n, "Série C") as SeasonRecord;
      const ms = Math.round(performance.now() - start);

      const newCareer: Career = {
        schemaVersion: 10,
        savedAt: new Date().toISOString(),
        seed: careerSeed,
        controlledTeamId: starterTeam.id,
        seasons: [],
        currentSeason: {
          year: FIRST_YEAR,
          seed: seasonSeed,
          divisions: [
            { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
            { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
            { tier: 3, name: "Série C", record: recordC, currentRoundIdx: 0 },
          ],
          transfers: [],
          // Season 0: the world hasn't aged (elapsed 0) and the user roster is
          // still empty, so evolved seeding == registry seeding — freshCopa()'s
          // registry draw is correct here. Later seasons seed from evolved
          // sides (career.ts buildNextSeason).
          copa: freshCopa(),
        },
        // User starts in Série C (tier 3): smallest stadium + fanbase.
        manager: { money: STARTING_MONEY, ...seedStadiumForTier(3) },
        userRoster: [],
      };

      saveCareer(newCareer)
        .then(() => {
          onStatus(
            `nova carreira · ${starterTeam.name} (Série C) · ano ${FIRST_YEAR} · 3 ligas simuladas em ${ms}ms · seed ${seed} · $ ${formatMoney(STARTING_MONEY)}`,
          );
          setPhase({ tag: "running", career: newCareer });
        })
        .catch((e) => {
          setError(String(e));
          onStatus(`erro ao salvar: ${e}`);
        });
    } catch (e) {
      setError(String(e));
      onStatus(`erro: ${e}`);
    }
  }

  async function resetCareer() {
    try {
      await clearCareer();
      onStatus("nova carreira");
      setPhase({ tag: "form" });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao limpar: ${e}`);
    }
  }

  function openTactics(career: Career) {
    const teamName =
      teamById(career.controlledTeamId)?.name ??
      `Time ${career.controlledTeamId}`;
    onStatus(`editando tática · ${teamName}`);
    setPhase({ tag: "tactics", career });
  }

  function backFromTactics(career: Career) {
    onStatus("sem alterações");
    setPhase({ tag: "running", career });
  }

  async function applyTactics(
    newCareer: Career,
    resimMs: number,
    resimCount: number,
  ) {
    try {
      await saveCareer(newCareer);
      const teamName =
        teamById(newCareer.controlledTeamId)?.name ??
        `Time ${newCareer.controlledTeamId}`;
      const plural = resimCount === 1 ? "" : "s";
      onStatus(
        `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms`,
      );
      setPhase({ tag: "running", career: newCareer });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar tática: ${e}`);
    }
  }

  function openPrepare(career: Career) {
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const userDiv = career.currentSeason.divisions[userDivIdx];
    onStatus(`preparando rodada ${userDiv.currentRoundIdx + 1} (${userDiv.name})`);
    setPhase({ tag: "prepare", career });
  }

  function backFromPrepare(career: Career) {
    onStatus("voltou ao painel");
    setPhase({ tag: "running", career });
  }

  function openOtherDivision(career: Career) {
    onStatus("visualizando outras divisões");
    setPhase({ tag: "viewOtherDivision", career });
  }

  function backFromOtherDivision(career: Career) {
    setPhase({ tag: "running", career });
  }

  function openCopa(career: Career) {
    onStatus("Copa do Brasil");
    setPhase({ tag: "copa", career });
  }

  function backFromCopa(career: Career) {
    setPhase({ tag: "running", career });
  }

  function openHistory(career: Career) {
    onStatus(`histórico (${career.seasons.length} temporadas)`);
    setPhase({ tag: "history", career });
  }

  function backFromHistory(career: Career) {
    setPhase({ tag: "finale", career });
  }

  function openTransferMarket(career: Career, returnTo: "running" | "finale") {
    onStatus(`mercado aberto · ano ${career.currentSeason.year}`);
    setPhase({ tag: "transferMarket", career, returnTo });
  }

  function openSupport() {
    onStatus("apoiar o projeto");
    setPhase({ tag: "support" });
  }

  function backFromSupport() {
    onStatus("pronto");
    setPhase({ tag: "form" });
  }

  /**
   * Called when TransferMarketView fires onClose. The view passes back
   * a Career with userRoster / manager.money / currentSeason.transfers
   * (and optionally userTactics.bench after lazy-prune) already mutated.
   * Persist and return to wherever the market was opened from — mid-season
   * (`running`) or at the season boundary (`finale`).
   */
  async function closeTransferMarket(
    newCareer: Career,
    returnTo: "running" | "finale",
  ) {
    try {
      await saveCareer(newCareer);
      const txCount = newCareer.currentSeason.transfers.length;
      onStatus(
        txCount === 0
          ? "mercado fechado · sem transações"
          : `mercado fechado · ${txCount} transação${txCount === 1 ? "" : "ões"}`,
      );
      if (returnTo === "running") {
        setPhase({ tag: "running", career: newCareer });
      } else {
        setPhase({ tag: "finale", career: newCareer });
      }
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar mercado: ${e}`);
    }
  }

  /**
   * Called when user clicks [ JOGAR ] from PrepareView. The view may have
   * re-simulated already (if dirty) or returned the original career (if no
   * tactical change). Either way, persist the incremented rounds FIRST
   * and THEN enter revealing — same persist-before-reveal ordering as
   * pre-E.1.a, so F5 mid-reveal autoloads straight back into running
   * with the new state committed.
   *
   * Both divisions advance in lockstep until one is exhausted. Silent
   * advance: when the user's division JUST finished its last round, the
   * other tier is fast-forwarded to its own total — guarantees
   * `computePromotionRelegation` invariants are satisfied at finale time
   * even when the user is in Série A (which finishes earlier than Série B).
   */
  async function playRound(
    newCareer: Career,
    resimMs: number,
    resimCount: number,
  ) {
    const season = newCareer.currentSeason;
    const userDivIdx = findUserDivisionIdxInSeason(season, newCareer.controlledTeamId);
    const advancedDivisions: Division[] = season.divisions.map((d, i) => {
      const total = totalRoundsOf(d);
      if (i === userDivIdx) {
        return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      }
      if (d.currentRoundIdx < total) {
        return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      }
      return d;
    });

    // Silent-advance: if the user's division just hit its terminal round,
    // fast-forward any other division still in progress. Without this, a
    // future user-in-Série-A season would enter `finale` with Série B
    // still mid-table, and `computePromotionRelegation` would throw.
    const userDivAdvanced = advancedDivisions[userDivIdx];
    if (userDivAdvanced.currentRoundIdx >= totalRoundsOf(userDivAdvanced)) {
      advancedDivisions.forEach((d, i) => {
        if (i !== userDivIdx) {
          const total = totalRoundsOf(d);
          if (d.currentRoundIdx < total) {
            advancedDivisions[i] = { ...d, currentRoundIdx: total };
          }
        }
      });
    }

    // Per-round cash flow: the round being played is the pre-increment index.
    // Bank the home gate (if mandante) and pay the wage slice — money moves
    // every matchday, persisted here with the round advance.
    const playedRound = season.divisions[userDivIdx].currentRoundIdx;
    const cashDelta = roundCashDelta(newCareer, playedRound);
    const cashStr =
      cashDelta >= 0
        ? `+ $ ${formatMoney(cashDelta)}`
        : `− $ ${formatMoney(Math.abs(cashDelta))}`;

    // Copa do Brasil: if this matchday hosts a cup round and it hasn't been
    // played yet, play the whole round now (the user's tie uses the live
    // userTeam/tactics; the rest auto-sims) and advance the cup cursor. The
    // cup prize (E.4) is paid here — the guard fires exactly once per round, so
    // it can't double-pay.
    let copa = season.copa;
    let cupPrize = 0;
    const cupRoundIdx = COPA_ROUND_AT_LEAGUE_ROUND.indexOf(playedRound);
    if (cupRoundIdx >= 0 && copa.currentCupRoundIdx === cupRoundIdx) {
      const nextCopa = playCupRound(
        copa,
        cupRoundIdx,
        cupTeamResolver(newCareer),
        cupSeedFor(season),
        newCareer.controlledTeamId,
      );
      cupPrize = cupPrizeForAdvance(copa, nextCopa, newCareer.controlledTeamId);
      copa = nextCopa;
    }
    const cupStr = cupPrize > 0 ? ` · copa + $ ${formatMoney(cupPrize)}` : "";

    const advanced: Career = {
      ...newCareer,
      savedAt: new Date().toISOString(),
      currentSeason: {
        ...season,
        divisions: advancedDivisions,
        copa,
      },
      manager: {
        ...newCareer.manager,
        money: newCareer.manager.money + cashDelta + cupPrize,
      },
    };

    try {
      await saveCareer(advanced);
      const teamName =
        teamById(advanced.controlledTeamId)?.name ??
        `Time ${advanced.controlledTeamId}`;
      const userDiv = advanced.currentSeason.divisions[userDivIdx];
      if (resimCount > 0) {
        const plural = resimCount === 1 ? "" : "s";
        onStatus(
          `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms · rodada ${userDiv.currentRoundIdx} · caixa ${cashStr}${cupStr}`,
        );
      } else {
        onStatus(
          `rodada ${userDiv.currentRoundIdx} · caixa ${cashStr}${cupStr} · saldo $ ${formatMoney(advanced.manager.money)}`,
        );
      }
      setPhase({ tag: "revealing", career: advanced });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar avanço: ${e}`);
    }
  }

  /**
   * Called when RevealRound finishes. Same picker as autoload: if the
   * user's division wrapped up, jump to finale; otherwise return to
   * running for the next round.
   */
  function afterReveal(career: Career) {
    // Mid-season firing: if this round's wage slice pushed the balance below
    // the floor, the board fires you right after the reveal.
    if (isManagerFired(career.manager.money)) {
      onStatus("demitido · saldo negativo");
      setPhase({ tag: "fired", career, finalBalance: career.manager.money });
      return;
    }
    setPhase(initialPhaseFor(career));
  }

  /**
   * INICIAR PRÓXIMA TEMPORADA. Computes P/R from the just-finished season,
   * calls advanceCareer to recompose + re-simulate divisions, appends a
   * SeasonHistory entry to seasons[], persists, transitions to running.
   * Errors surface via the error pre (e.g., IDB write failure).
   */
  async function advanceToNextSeason(career: Career) {
    try {
      const pr = computePromotionRelegation(
        career.currentSeason,
        career.controlledTeamId,
      );

      // Tickets/salaries already accrued per round, so the only money event
      // left at the boundary is the P/R bonus/penalty. Lose-condition: if the
      // (signed) bonus pushes the balance below the floor — e.g. a relegation
      // penalty — the board fires the manager. Checked before the expensive
      // advanceCareer resim so a doomed career never wastes one.
      const projectedFinances = computeSeasonFinances(
        career,
        userOutcomeFromPRResult(pr),
      );
      // Boundary money = P/R bonus + placement prize (cup prize + TV + match
      // bonuses already accrued into manager.money during the season).
      const boundaryDelta =
        projectedFinances.prBonus + projectedFinances.placementPrize;
      const balanceAfterBonus = career.manager.money + boundaryDelta;
      if (isManagerFired(balanceAfterBonus)) {
        onStatus("demitido · saldo negativo");
        setPhase({ tag: "fired", career, finalBalance: balanceAfterBonus });
        return;
      }

      const start = performance.now();
      const {
        history,
        nextSeason,
        finances,
        agedUserRoster,
        nextFanbase,
        nextMarketingMomentum,
      } = advanceCareer(career, pr);
      const ms = Math.round(performance.now() - start);
      const newCareer: Career = {
        ...career,
        savedAt: new Date().toISOString(),
        seasons: [...career.seasons, history],
        currentSeason: nextSeason,
        userRoster: agedUserRoster,
        manager: {
          ...career.manager,
          money: career.manager.money + finances.prBonus + finances.placementPrize,
          // Stadium capacity carries forward via the spread; fanbase drifts and
          // marketing momentum decays (E.4.b.4/b.5).
          fanbase: nextFanbase,
          marketingMomentum: nextMarketingMomentum,
        },
      };
      await saveCareer(newCareer);
      const teamName =
        teamById(newCareer.controlledTeamId)?.name ??
        `Time ${newCareer.controlledTeamId}`;
      const newUserDivIdx = findUserDivisionIdxInSeason(
        nextSeason,
        newCareer.controlledTeamId,
      );
      const newUserDiv = nextSeason.divisions[newUserDivIdx];
      const bonusSign = finances.prBonus >= 0 ? "+" : "−";
      const bonusStr =
        finances.prBonus !== 0
          ? `bônus ${bonusSign} $ ${formatMoney(Math.abs(finances.prBonus))} · `
          : "";
      onStatus(
        `temporada ${nextSeason.year} iniciada · ${teamName} (${newUserDiv.name}) · ${bonusStr}saldo $ ${formatMoney(newCareer.manager.money)} · ${ms}ms`,
      );
      setPhase({ tag: "running", career: newCareer });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao avançar temporada: ${e}`);
    }
  }

  return (
    <>
      {phase.tag === "loading" && <Text c="dimmed">Carregando save…</Text>}
      {phase.tag === "form" && (
        <NewSeasonForm onSubmit={run} onSupport={openSupport} />
      )}
      {phase.tag === "running" && (
        <CampeonatoEmCurso
          career={phase.career}
          onReset={resetCareer}
          onPrepare={() => openPrepare(phase.career)}
          onTactics={() => openTactics(phase.career)}
          onViewOtherDivision={() => openOtherDivision(phase.career)}
          onViewCopa={() => openCopa(phase.career)}
          onOpenMarket={() => openTransferMarket(phase.career, "running")}
        />
      )}
      {phase.tag === "viewOtherDivision" && (
        <OtherDivisionView
          career={phase.career}
          onBack={() => backFromOtherDivision(phase.career)}
        />
      )}
      {phase.tag === "copa" && (
        <CopaView career={phase.career} onBack={() => backFromCopa(phase.career)} />
      )}
      {phase.tag === "prepare" && (
        <PrepareView
          career={phase.career}
          onPlay={playRound}
          onBack={() => backFromPrepare(phase.career)}
        />
      )}
      {phase.tag === "revealing" && (
        <RevealRound
          career={phase.career}
          onDone={() => afterReveal(phase.career)}
        />
      )}
      {phase.tag === "tactics" && (
        <TacticsView
          career={phase.career}
          onApply={applyTactics}
          onBack={() => backFromTactics(phase.career)}
        />
      )}
      {phase.tag === "finale" && (
        <SeasonFinale
          career={phase.career}
          onOpenMarket={() => openTransferMarket(phase.career, "finale")}
          onAdvanceSeason={() => advanceToNextSeason(phase.career)}
          onOpenHistory={() => openHistory(phase.career)}
          onReset={resetCareer}
        />
      )}
      {phase.tag === "history" && (
        <HistoryView
          career={phase.career}
          onBack={() => backFromHistory(phase.career)}
        />
      )}
      {phase.tag === "transferMarket" && (
        <TransferMarketView
          career={phase.career}
          onClose={(c) => closeTransferMarket(c, phase.returnTo)}
        />
      )}
      {phase.tag === "fired" && (
        <FiredView
          career={phase.career}
          finalBalance={phase.finalBalance}
          onNewCareer={resetCareer}
        />
      )}
      {phase.tag === "support" && <SupportView onBack={backFromSupport} />}
      {error && (
        <Text c="red" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </Text>
      )}
    </>
  );
}

// ─── Phase: form ────────────────────────────────────────────────────────────
// The team checkboxes are gone (the Brasileirão Imaginário plays with all
// 60 teams fixed) and the user no longer picks a team (assigned to a random
// Série C club — the bottom of the pyramid — via pickRandomStarter).
function NewSeasonForm({
  onSubmit,
  onSupport,
}: {
  onSubmit: () => void;
  onSupport: () => void;
}) {
  return (
    <Panel title="Nova carreira">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            60 times divididos em Série A (20) + Série B (20) + Série C (20).
            Você assume um time aleatório da Série C e começa a escalada do
            fundo da pirâmide.
          </Text>
          <Group justify="center" gap="sm">
            <Button type="submit">Iniciar carreira</Button>
            <Button type="button" variant="default" onClick={onSupport}>
              Apoiar projeto
            </Button>
          </Group>
        </Stack>
      </form>
    </Panel>
  );
}

// ─── Phase: running ─────────────────────────────────────────────────────────
// Reads from the user's division — fixtures of the current round (no
// score) and partial standings up to that round. The finale split is now
// explicit: `running` always implies "user's division still has rounds",
// and the autoload/afterReveal pickers route to `finale` when done.
function CampeonatoEmCurso({
  career,
  onReset,
  onPrepare,
  onTactics,
  onViewOtherDivision,
  onViewCopa,
  onOpenMarket,
}: {
  career: Career;
  onReset: () => void;
  onPrepare: () => void;
  onTactics: () => void;
  onViewOtherDivision: () => void;
  onViewCopa: () => void;
  onOpenMarket: () => void;
}) {
  const team = teamById(career.controlledTeamId);
  const teamName = team?.name ?? `Time ${career.controlledTeamId}`;
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const totalRounds = totalRoundsOf(userDiv);

  const teamIds = userDiv.record.standings.map((s) => s.team_id);
  const standings = computeStandings(
    userDiv.record.matches,
    userDiv.record.fixtures,
    userDiv.currentRoundIdx,
    teamIds,
  );

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        <Text span c="gray.0" fw={700}>
          {teamName} (Você)
        </Text>{" "}
        · {userDiv.name} · ANO {season.year} · RODADA {userDiv.currentRoundIdx + 1} / {totalRounds} · $ {formatMoney(career.manager.money)}
      </Text>

      <Panel title={`Rodada ${userDiv.currentRoundIdx + 1}`}>
        <Stack gap={4}>
          {currentRoundFixtures(career, userDiv).map((row, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Text span w={14} ta="center" c="accent.4">
                {row.isUser ? "►" : ""}
              </Text>
              <Text
                span
                c={row.isUser ? "accent.4" : undefined}
                fw={row.isUser ? 600 : undefined}
              >
                {row.homeName} × {row.awayName}
              </Text>
            </Group>
          ))}
        </Stack>
      </Panel>

      <Objectives
        tier={userDiv.tier}
        standings={standings}
        teamId={career.controlledTeamId}
      />

      <StandingsTable
        standings={standings}
        highlightTeamId={career.controlledTeamId}
        title={`Classificação · ${userDiv.name}`}
      />

      <Group justify="center" gap="sm">
        <Button onClick={onPrepare}>Avançar rodada</Button>
        <Button variant="default" onClick={onTactics}>
          Tática
        </Button>
        <Button variant="default" onClick={onOpenMarket}>
          Mercado
        </Button>
        <Button variant="default" onClick={onViewCopa}>
          Copa
        </Button>
        <Button variant="default" onClick={onViewOtherDivision}>
          Outras divisões
        </Button>
        <Button variant="subtle" color="red" onClick={onReset}>
          Nova carreira
        </Button>
      </Group>
    </Stack>
  );
}

// ─── Phase: viewOtherDivision ───────────────────────────────────────────────
// Read-only peek at the OTHER tiers' standings (the two divisions the user
// isn't in). Each shows "ENCERRADA" when it has played all its rounds.
function OtherDivisionView({
  career,
  onBack,
}: {
  career: Career;
  onBack: () => void;
}) {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const others = season.divisions.filter((_, i) => i !== userDivIdx);

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        ANO {season.year} · OUTRAS DIVISÕES · $ {formatMoney(career.manager.money)}
      </Text>

      {others.map((div) => {
        const total = totalRoundsOf(div);
        const isFinished = div.currentRoundIdx >= total;
        const standings = computeStandings(
          div.record.matches,
          div.record.fixtures,
          div.currentRoundIdx,
          div.record.standings.map((s) => s.team_id),
        );
        return (
          <StandingsTable
            key={div.tier}
            standings={standings}
            title={`${div.name} · ${
              isFinished ? `ENCERRADA ${total}/${total}` : `RODADA ${div.currentRoundIdx + 1}/${total}`
            }`}
          />
        );
      })}

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
}

// Copa do Brasil result line for the season finale: the cup champion and how
// far the user's club got.
function CopaFinaleLine({ career }: { career: Career }) {
  const copa = career.currentSeason.copa;
  if (copa.championId === undefined) return null;
  const champName =
    teamById(copa.championId)?.name ?? `Time ${copa.championId}`;
  const userWon = copa.championId === career.controlledTeamId;
  const result = cupResultFor(copa, career.controlledTeamId);
  const userLine =
    result === "champion"
      ? null
      : result
        ? `Seu time caiu na Copa: ${copaRoundLabel(result)}.`
        : null;
  return (
    <Panel title={userWon ? "*** Campeão da Copa do Brasil ***" : "Copa do Brasil"}>
      {userWon ? (
        <Text c="accent.4" fw={700}>
          PARABÉNS! {champName} levantou a Copa do Brasil.
        </Text>
      ) : (
        <Stack gap={2}>
          <Text>Campeão: {champName}</Text>
          {userLine && (
            <Text size="sm" c="dimmed">
              {userLine}
            </Text>
          )}
        </Stack>
      )}
    </Panel>
  );
}

function copaRoundLabel(name: string): string {
  switch (name) {
    case "prelim": return "fase preliminar";
    case "r32": return "rodada de 32";
    case "r16": return "oitavas";
    case "qf": return "quartas";
    case "sf": return "semifinal";
    case "final": return "final (vice)";
    default: return name;
  }
}

// ─── Phase: finale ──────────────────────────────────────────────────────────
// Renders when both divisions are exhausted. Champion + season highlights
// + P/R + final standings, all sourced from the user's division. The
// silent-advance in playRound guarantees both tiers are done by the time
// we render here, so `computePromotionRelegation` is safe to call.
function SeasonFinale({
  career,
  onOpenMarket,
  onAdvanceSeason,
  onOpenHistory,
  onReset,
}: {
  career: Career;
  onOpenMarket: () => void;
  onAdvanceSeason: () => void;
  onOpenHistory: () => void;
  onReset: () => void;
}) {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const totalRounds = totalRoundsOf(userDiv);

  const champion = userDiv.record.standings[0];
  const champTeam = champion ? teamById(champion.team_id) : undefined;
  const champName = champTeam?.name ?? `Time ${champion?.team_id ?? "?"}`;
  const isUserChamp = champion?.team_id === career.controlledTeamId;

  const userIdx = userDiv.record.standings.findIndex(
    (s) => s.team_id === career.controlledTeamId,
  );
  const userStats = userIdx >= 0 ? userDiv.record.standings[userIdx] : undefined;
  const userTeamName =
    teamById(career.controlledTeamId)?.name ?? `Time ${career.controlledTeamId}`;

  const playerLookup = useMemo(
    () => buildPlayerLookup(userDiv.record),
    [userDiv.record],
  );
  const scorer = useMemo(
    () => topScorer(userDiv.record, playerLookup),
    [userDiv.record, playerLookup],
  );
  const assister = useMemo(
    () => topAssister(userDiv.record, playerLookup),
    [userDiv.record, playerLookup],
  );
  const biggest = useMemo(() => biggestWin(userDiv.record), [userDiv.record]);
  const cards = useMemo(
    () => cardLeader(userDiv.record, playerLookup),
    [userDiv.record, playerLookup],
  );
  const prResult = useMemo(
    () => computePromotionRelegation(season, career.controlledTeamId),
    [season, career.controlledTeamId],
  );
  const finances = useMemo(
    () => computeSeasonFinances(career, userOutcomeFromPRResult(prResult)),
    [career, prResult],
  );
  const tierASize =
    season.divisions.find((d) => d.tier === 1)?.record.standings.length ?? 0;
  const tierBSize =
    season.divisions.find((d) => d.tier === 2)?.record.standings.length ?? 0;

  const hasHistory = career.seasons.length >= 1;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        <Text span c="gray.0" fw={700}>
          {userTeamName} (Você)
        </Text>{" "}
        · {userDiv.name} · ANO {season.year} · ENCERRADA · {totalRounds} / {totalRounds} · $ {formatMoney(career.manager.money)}
      </Text>

      <Panel title={isUserChamp ? "*** Campeão ***" : "Campeão"}>
        {isUserChamp ? (
          <Text c="accent.4" fw={700}>
            PARABÉNS! {champName} venceu o {userDiv.name}.
          </Text>
        ) : (
          <Text>{champName}</Text>
        )}
      </Panel>

      <CopaFinaleLine career={career} />

      <Panel title="Destaques da temporada">
        <Stack gap={4}>
          {scorer && (
            <Text size="sm">
              Artilheiro: {scorer.name} ({scorer.teamName}) — {scorer.goals} gols
            </Text>
          )}
          {assister && (
            <Text size="sm">
              Líder de assistências: {assister.name} ({assister.teamName}) —{" "}
              {assister.assists} assistências
            </Text>
          )}
          {biggest && (
            <Text size="sm">
              Maior goleada:{" "}
              {teamById(biggest.match.home)?.name ?? `Time ${biggest.match.home}`}{" "}
              {biggest.match.result.home_goals} x {biggest.match.result.away_goals}{" "}
              {teamById(biggest.match.away)?.name ?? `Time ${biggest.match.away}`}{" "}
              (rodada {biggest.round + 1})
            </Text>
          )}
          {cards && (
            <Text size="sm">
              Mais cartões: {cards.name} ({cards.teamName}) — {cards.yellow}{" "}
              amarelos, {cards.red} vermelhos
            </Text>
          )}
          {userStats && !isUserChamp && (
            <Text size="sm" c="accent.3" fw={600}>
              Sua colocação: {userTeamName} — {userIdx + 1}º lugar,{" "}
              {points(userStats)} pts, {userStats.won}V {userStats.drawn}E{" "}
              {userStats.lost}D
            </Text>
          )}
        </Stack>
      </Panel>

      <Panel title="Finanças da temporada">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            Já creditado no caixa ao longo da temporada:
          </Text>
          <FinanceRow
            label="Bilheteria (mandante)"
            value={`+ $ ${formatMoney(finances.ticketRevenue)}`}
            c="accent.4"
          />
          <FinanceRow
            label="Cota de TV"
            value={`+ $ ${formatMoney(finances.tvRevenue)}`}
            c="accent.4"
          />
          <FinanceRow
            label="Patrocínio"
            value={`+ $ ${formatMoney(finances.sponsorship)}`}
            c="accent.4"
          />
          <FinanceRow
            label="Bônus de vitórias/empates"
            value={`+ $ ${formatMoney(finances.matchBonuses)}`}
            c="accent.4"
          />
          {finances.cupPrize > 0 && (
            <FinanceRow
              label="Premiação Copa do Brasil"
              value={`+ $ ${formatMoney(finances.cupPrize)}`}
              c="accent.4"
            />
          )}
          <FinanceRow
            label="Salários"
            value={`− $ ${formatMoney(finances.salaries)}`}
            c="red.5"
          />
          <Divider my={4} />
          {finances.prBonus > 0 && (
            <FinanceRow
              label="Bônus promoção (ao avançar)"
              value={`+ $ ${formatMoney(finances.prBonus)}`}
              c="accent.4"
            />
          )}
          {finances.prBonus < 0 && (
            <FinanceRow
              label="Multa rebaixamento (ao avançar)"
              value={`− $ ${formatMoney(Math.abs(finances.prBonus))}`}
              c="red.5"
            />
          )}
          {finances.placementPrize > 0 && (
            <FinanceRow
              label="Premiação por classificação (ao avançar)"
              value={`+ $ ${formatMoney(finances.placementPrize)}`}
              c="accent.4"
            />
          )}
          <FinanceRow
            label="Saldo atual"
            value={`$ ${formatMoney(career.manager.money)}`}
          />
          {(finances.prBonus !== 0 || finances.placementPrize > 0) && (
            <FinanceRow
              label="Saldo ao iniciar a próxima"
              value={`$ ${formatMoney(
                career.manager.money + finances.prBonus + finances.placementPrize,
              )}`}
            />
          )}
        </Stack>
      </Panel>

      <Panel title="Promoção e rebaixamento">
        <Stack gap="xs">
          {prResult.userPromoted && (
            <Text ta="center" fw={700} c="accent.4">
              *** SEU TIME SUBIU DE DIVISÃO! ***
            </Text>
          )}
          {prResult.userRelegated && (
            <Text ta="center" fw={700} c="red.5">
              *** SEU TIME FOI REBAIXADO ***
            </Text>
          )}

          {/* Promotions: numbered from the top of the SOURCE tier (1º, 2º…). */}
          <MovementGroup
            label="▲ Sobem da Série B para a Série A:"
            teams={prResult.promotedBtoA}
            startPosition={1}
            controlledTeamId={career.controlledTeamId}
          />
          <MovementGroup
            label="▲ Sobem da Série C para a Série B:"
            teams={prResult.promotedCtoB}
            startPosition={1}
            controlledTeamId={career.controlledTeamId}
          />
          {/* Relegations: numbered from the BOTTOM of the source tier, so the
              first relegated team's position is (sourceSize − count + 1). */}
          <MovementGroup
            label="▼ Descem da Série A para a Série B:"
            teams={prResult.relegatedAtoB}
            startPosition={tierASize - prResult.relegatedAtoB.length + 1}
            controlledTeamId={career.controlledTeamId}
          />
          <MovementGroup
            label="▼ Descem da Série B para a Série C:"
            teams={prResult.relegatedBtoC}
            startPosition={tierBSize - prResult.relegatedBtoC.length + 1}
            controlledTeamId={career.controlledTeamId}
          />
        </Stack>
      </Panel>

      <StandingsTable
        standings={userDiv.record.standings}
        highlightTeamId={career.controlledTeamId}
        title={`Classificação · ${userDiv.name}`}
      />

      <Group justify="center" gap="sm">
        <Button onClick={onOpenMarket}>Abrir mercado</Button>
        <Button onClick={onAdvanceSeason}>Iniciar próxima temporada</Button>
        {hasHistory && (
          <Button variant="default" onClick={onOpenHistory}>
            Histórico
          </Button>
        )}
        <Button variant="subtle" color="red" onClick={onReset}>
          Nova carreira
        </Button>
      </Group>
    </Stack>
  );
}

/** Label-left / signed-amount-right row used by the FINANÇAS panel. */
function FinanceRow({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c?: string;
}) {
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Text size="sm">{label}</Text>
      <Text size="sm" c={c} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Group>
  );
}

// One promotion/relegation movement group (e.g. "▲ Sobem da Série B para a
// Série A"). `startPosition` is the 1-based finishing position of the first
// team in the list within its SOURCE tier — 1 for promotions (top of the
// table), or sourceSize−count+1 for relegations (bottom of the table). Hidden
// when empty so legacy/degenerate seasons don't render blank groups.
function MovementGroup({
  label,
  teams,
  startPosition,
  controlledTeamId,
}: {
  label: string;
  teams: TeamStats[];
  startPosition: number;
  controlledTeamId: number;
}) {
  if (teams.length === 0) return null;
  return (
    <div>
      <Text size="sm" c="dimmed" mb={4}>
        {label}
      </Text>
      <Stack gap={1}>
        {teams.map((s, i) => {
          const name = teamById(s.team_id)?.name ?? `Time ${s.team_id}`;
          const isUser = s.team_id === controlledTeamId;
          return (
            <Text
              key={s.team_id}
              size="sm"
              c={isUser ? "accent.3" : undefined}
              fw={isUser ? 700 : undefined}
            >
              {startPosition + i}º {name} ({points(s)} pts)
            </Text>
          );
        })}
      </Stack>
    </div>
  );
}

// ─── Phase: fired (E.1.f) ────────────────────────────────────────────────────
// Game over — reached when the balance drops below the firing floor, either
// mid-season (after a round's wage slice, via afterReveal) or at the boundary
// (after a relegation penalty, via advanceToNextSeason). Takes the triggering
// `finalBalance` directly rather than recomputing finances/P-R, since
// mid-season the season isn't over and computePromotionRelegation would throw.
// The only way out is a new career.
function FiredView({
  career,
  finalBalance,
  onNewCareer,
}: {
  career: Career;
  finalBalance: number;
  onNewCareer: () => void;
}) {
  const season = career.currentSeason;
  const teamName =
    teamById(career.controlledTeamId)?.name ?? `Time ${career.controlledTeamId}`;
  const seasonsInCharge = career.seasons.length + 1;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        <Text span c="gray.0" fw={700}>
          {teamName} (Você)
        </Text>{" "}
        · FIM DE LINHA
      </Text>

      <Panel title="*** Demitido ***">
        <Stack gap="sm">
          <Text c="red.5" fw={700}>
            O conselho perdeu a paciência: as contas do {teamName} ficaram no
            vermelho e você foi demitido.
          </Text>
          <FinanceRow
            label="Saldo final"
            value={`− $ ${formatMoney(Math.abs(finalBalance))}`}
            c="red.5"
          />
          <Text size="sm" c="dimmed">
            {seasonsInCharge} temporada{seasonsInCharge === 1 ? "" : "s"} no
            comando · ano {season.year}.
          </Text>
        </Stack>
      </Panel>

      <Group justify="center">
        <Button onClick={onNewCareer}>Nova carreira</Button>
      </Group>
    </Stack>
  );
}

// ─── Phase: history ─────────────────────────────────────────────────────────
// Read-only list of past SeasonHistory entries (oldest first, newest last).
// Compact card per season; full match logs are intentionally not stored
// (see SeasonHistory doc-comment in persistence.ts).
function HistoryView({
  career,
  onBack,
}: {
  career: Career;
  onBack: () => void;
}) {
  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        HISTÓRICO · {career.seasons.length} temporada
        {career.seasons.length === 1 ? "" : "s"}
      </Text>

      {career.seasons.map((s) => (
        <HistoryCard key={s.year} entry={s} />
      ))}

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
}

function HistoryCard({ entry }: { entry: SeasonHistory }) {
  const outcomeText =
    entry.userOutcome === "promoted"
      ? `▲ Subiu da ${entry.userDivision.name}`
      : entry.userOutcome === "relegated"
        ? `▼ Desceu da ${entry.userDivision.name}`
        : `→ Permaneceu na ${entry.userDivision.name}`;
  const outcomeColor =
    entry.userOutcome === "promoted"
      ? "accent.4"
      : entry.userOutcome === "relegated"
        ? "red.5"
        : "dimmed";
  const moneyColor = entry.moneyDelta >= 0 ? "accent.4" : "red.5";
  const moneySign = entry.moneyDelta >= 0 ? "+" : "−";

  return (
    <Panel title={`Temporada ${entry.year}`}>
      <Stack gap={2}>
        <Text size="sm">
          {entry.userDivision.name} · {entry.userPosition}º lugar · {entry.userPoints} pts
        </Text>
        <Text size="sm" c="dimmed">
          Campeão: {entry.champion.teamName}
        </Text>
        <Text size="sm" c="dimmed">
          ▲ Subiram: {entry.promoted.map((p) => p.teamName).join(", ")}
        </Text>
        <Text size="sm" c="dimmed">
          ▼ Desceram: {entry.relegated.map((r) => r.teamName).join(", ")}
        </Text>
        <Text size="sm" fw={700} c={outcomeColor} mt={4}>
          {outcomeText}
        </Text>
        <Text size="sm" fw={700} c={moneyColor}>
          {moneySign} $ {formatMoney(Math.abs(entry.moneyDelta))} · saldo ${" "}
          {formatMoney(entry.moneyAfter)}
        </Text>
        {entry.transfers && entry.transfers.length > 0 && (
          <Text size="sm" c="dimmed">
            Transferências: {countTransfers(entry.transfers)}
          </Text>
        )}
      </Stack>
    </Panel>
  );
}

/**
 * Compact one-liner summary of a season's transfer activity. Parity
 * with the FINANÇAS Card register: uses the proper minus sign (U+2212)
 * for outflows. Either side (buys / sells) is omitted when zero so the
 * line stays short when only one direction had activity.
 */
function countTransfers(transfers: TransferRecord[]): string {
  const buys = transfers.filter((t) => t.kind === "buy");
  const sells = transfers.filter((t) => t.kind === "sell");
  const buyTotal = buys.reduce((s, t) => s + t.price, 0);
  const sellTotal = sells.reduce((s, t) => s + t.price, 0);
  const parts: string[] = [];
  if (buys.length > 0) {
    parts.push(
      `${buys.length} compra${buys.length === 1 ? "" : "s"} (− $ ${formatMoney(buyTotal)})`,
    );
  }
  if (sells.length > 0) {
    parts.push(
      `${sells.length} venda${sells.length === 1 ? "" : "s"} (+ $ ${formatMoney(sellTotal)})`,
    );
  }
  return parts.join(", ");
}

/**
 * Current-round matchups in fixtures-array order. The circle-method
 * order is deterministic — ports of the season schedule depend on it,
 * we don't re-sort by name or anything else.
 */
function currentRoundFixtures(
  career: Career,
  div: Division,
): Array<{ homeName: string; awayName: string; isUser: boolean }> {
  const round = div.currentRoundIdx;
  return div.record.fixtures
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.round === round)
    .map(({ i }) => {
      const m = div.record.matches[i];
      return {
        homeName: teamById(m.home)?.name ?? `Time ${m.home}`,
        awayName: teamById(m.away)?.name ?? `Time ${m.away}`,
        isUser:
          m.home === career.controlledTeamId ||
          m.away === career.controlledTeamId,
      };
    });
}

// ─── Shared: standings table ────────────────────────────────────────────────
function StandingsTable({
  standings,
  highlightTeamId,
  title = "Classificação",
}: {
  standings: TeamStats[];
  /** When provided, this team gets the bright row instead of the leader. */
  highlightTeamId?: number;
  title?: string;
}) {
  return (
    <Panel title={title}>
      <Table.ScrollContainer minWidth={320}>
        <Table
          highlightOnHover
          verticalSpacing={6}
          horizontalSpacing="sm"
          fz="sm"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Time</Table.Th>
              <Table.Th ta="right">P</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">V</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">E</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">D</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">GP</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">GC</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">SG</Table.Th>
              <Table.Th ta="right">Pts</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {standings.map((s, i) => {
              const teamName = teamById(s.team_id)?.name ?? `Time ${s.team_id}`;
              const gd = goalDifference(s);
              const isHi =
                highlightTeamId !== undefined
                  ? s.team_id === highlightTeamId
                  : i === 0;
              return (
                <Table.Tr key={s.team_id} bg={isHi ? "accent.9" : undefined}>
                  <Table.Td>{i + 1}</Table.Td>
                  <Table.Td c={isHi ? "accent.3" : undefined} fw={isHi ? 700 : undefined}>
                    {teamName}
                  </Table.Td>
                  <Table.Td ta="right">{s.played}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{s.won}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{s.drawn}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{s.lost}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{s.goals_for}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{s.goals_against}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{gd > 0 ? `+${gd}` : gd}</Table.Td>
                  <Table.Td ta="right" fw={700}>{points(s)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  );
}
