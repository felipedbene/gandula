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
import { divideIntoDivisions, pickRandomStarter } from "../util/divisions";
import {
  computePromotionRelegation,
  userOutcomeFromPRResult,
} from "../util/promotion";
import { advanceCareer } from "../util/career";
import { computeSeasonFinances } from "../util/finances";
import { formatMoney } from "../util/money";
import TransferMarketView from "./TransferMarketView";
import SupportView from "./SupportView";
import { Button, Divider, Group, Stack, Table, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";
import RevealRound from "./RevealRound";
import TacticsView from "./TacticsView";
import PrepareView from "./PrepareView";

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
  | { tag: "prepare"; career: Career }
  | { tag: "revealing"; career: Career }
  | { tag: "tactics"; career: Career }
  | { tag: "finale"; career: Career }
  | { tag: "history"; career: Career }
  | { tag: "transferMarket"; career: Career }
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
  // distinct status messages per scenario (loaded / migratedV2 / discardedV1
  // / none) — silent transitions would confuse the user.
  useEffect(() => {
    loadCareer()
      .then((result) => {
        if (
          result.kind === "loaded" ||
          result.kind === "migratedV2" ||
          result.kind === "migratedV3" ||
          result.kind === "migratedV4"
        ) {
          const career = result.career;
          const userDivIdx = findUserDivisionIdxInSeason(
            career.currentSeason,
            career.controlledTeamId,
          );
          const userDiv = career.currentSeason.divisions[userDivIdx];
          const teamName =
            teamById(career.controlledTeamId)?.name ??
            `Time ${career.controlledTeamId}`;
          const prefix =
            result.kind === "migratedV2"
              ? "save v2 migrado"
              : result.kind === "migratedV3"
                ? "save v3 migrado"
                : result.kind === "migratedV4"
                  ? "save v4 migrado"
                  : "save carregado";
          onStatus(
            `${prefix} · ${teamName} (${userDiv.name}) · ano ${career.currentSeason.year} · rodada ${userDiv.currentRoundIdx} · $ ${formatMoney(career.manager.money)}`,
          );
          setPhase(initialPhaseFor(career));
        } else if (result.kind === "discardedV1") {
          onStatus("save antigo (v1) descartado · iniciando carreira nova");
          setPhase({ tag: "form" });
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
   * NOVA CARREIRA. Builds two divisions in parallel (Série A + Série B)
   * from ALL_TEAMS, partitioned by `divideIntoDivisions`. Per-division
   * match-seed namespace via `seasonSeed XOR BigInt(tier)` so the two
   * leagues never collide on fixture index in the engine's match_seed
   * derivation. Same XOR is used on re-simulation (see `util/resimulate.ts`)
   * and on next-season generation (see `util/career.ts`), keeping
   * determinism end-to-end.
   */
  function run() {
    setError(null);
    try {
      if (ALL_TEAMS.length !== 17) {
        throw new Error(
          `Esperado 17 times, encontrado ${ALL_TEAMS.length}. Verifique assets/teams/.`,
        );
      }
      const { tierA, tierB } = divideIntoDivisions(ALL_TEAMS);
      const starterTeam = pickRandomStarter(tierB);
      const seed = randomSeed();
      const careerSeed = BigInt(seed);
      const seasonSeed = careerSeed ^ BigInt(FIRST_YEAR);

      const start = performance.now();
      const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
      const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
      const ms = Math.round(performance.now() - start);

      const newCareer: Career = {
        schemaVersion: 5,
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
          ],
          transfers: [],
        },
        manager: { money: STARTING_MONEY },
        userRoster: [],
      };

      saveCareer(newCareer)
        .then(() => {
          onStatus(
            `nova carreira · ${starterTeam.name} (Série B) · ano ${FIRST_YEAR} · 2 ligas simuladas em ${ms}ms · seed ${seed} · $ ${formatMoney(STARTING_MONEY)}`,
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
    const userDivIdx = findUserDivisionIdxInSeason(
      career.currentSeason,
      career.controlledTeamId,
    );
    const otherDiv = career.currentSeason.divisions[1 - userDivIdx];
    onStatus(`visualizando ${otherDiv.name}`);
    setPhase({ tag: "viewOtherDivision", career });
  }

  function backFromOtherDivision(career: Career) {
    setPhase({ tag: "running", career });
  }

  function openHistory(career: Career) {
    onStatus(`histórico (${career.seasons.length} temporadas)`);
    setPhase({ tag: "history", career });
  }

  function backFromHistory(career: Career) {
    setPhase({ tag: "finale", career });
  }

  function openTransferMarket(career: Career) {
    onStatus(`mercado aberto · ano ${career.currentSeason.year}`);
    setPhase({ tag: "transferMarket", career });
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
   * (and optionally userTactics.bench after lazy-prune) already
   * mutated. Persist and bounce back to finale — the user still hasn't
   * advanced to next year.
   */
  async function closeTransferMarket(newCareer: Career) {
    try {
      await saveCareer(newCareer);
      const txCount = newCareer.currentSeason.transfers.length;
      onStatus(
        txCount === 0
          ? "mercado fechado · sem transações"
          : `mercado fechado · ${txCount} transação${txCount === 1 ? "" : "ões"}`,
      );
      setPhase({ tag: "finale", career: newCareer });
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

    const advanced: Career = {
      ...newCareer,
      savedAt: new Date().toISOString(),
      currentSeason: {
        ...season,
        divisions: advancedDivisions,
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
          `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms · rodada ${userDiv.currentRoundIdx} iniciada`,
        );
      } else {
        onStatus(`avançando para rodada ${userDiv.currentRoundIdx + 1}`);
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
      const start = performance.now();
      const { history, nextSeason, finances } = advanceCareer(career, pr);
      const ms = Math.round(performance.now() - start);
      const newCareer: Career = {
        ...career,
        savedAt: new Date().toISOString(),
        seasons: [...career.seasons, history],
        currentSeason: nextSeason,
        manager: {
          ...career.manager,
          money: career.manager.money + finances.net,
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
      const deltaSign = finances.net >= 0 ? "+" : "−";
      onStatus(
        `temporada ${nextSeason.year} iniciada · ${teamName} (${newUserDiv.name}) · ${deltaSign} $ ${formatMoney(Math.abs(finances.net))} · saldo $ ${formatMoney(newCareer.manager.money)} · ${ms}ms`,
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
        />
      )}
      {phase.tag === "viewOtherDivision" && (
        <OtherDivisionView
          career={phase.career}
          onBack={() => backFromOtherDivision(phase.career)}
        />
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
          onOpenMarket={() => openTransferMarket(phase.career)}
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
          onClose={closeTransferMarket}
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
// 17 teams fixed) and the user no longer picks a team (assigned to the
// weakest Série B team via pickStarterTeam).
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
            17 times divididos em Série A (8) + Série B (9). Você assume um time
            aleatório da Série B.
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
}: {
  career: Career;
  onReset: () => void;
  onPrepare: () => void;
  onTactics: () => void;
  onViewOtherDivision: () => void;
}) {
  const team = teamById(career.controlledTeamId);
  const teamName = team?.name ?? `Time ${career.controlledTeamId}`;
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const userDiv = season.divisions[userDivIdx];
  const otherDiv = season.divisions[1 - userDivIdx];
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
        ANO {season.year} · DIVISÃO: {userDiv.name} · TIME: {teamName} · RODADA{" "}
        {userDiv.currentRoundIdx + 1} / {totalRounds} · $ {formatMoney(career.manager.money)}
      </Text>

      <Panel title={`Rodada ${userDiv.currentRoundIdx + 1}`}>
        <Stack gap={4}>
          {currentRoundFixtures(career, userDiv).map((row, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Text span w={14} ta="center" c="phosphor.4">
                {row.isUser ? "►" : ""}
              </Text>
              <Text
                span
                c={row.isUser ? "phosphor.4" : undefined}
                fw={row.isUser ? 600 : undefined}
              >
                {row.homeName} × {row.awayName}
              </Text>
            </Group>
          ))}
        </Stack>
      </Panel>

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
        <Button variant="default" onClick={onViewOtherDivision}>
          Ver {otherDiv.name}
        </Button>
        <Button variant="subtle" color="red" onClick={onReset}>
          Nova carreira
        </Button>
      </Group>
    </Stack>
  );
}

// ─── Phase: viewOtherDivision ───────────────────────────────────────────────
// Read-only peek at the other tier's standings. Shows "ENCERRADA" when
// that division has already played all its rounds.
function OtherDivisionView({
  career,
  onBack,
}: {
  career: Career;
  onBack: () => void;
}) {
  const season = career.currentSeason;
  const userDivIdx = findUserDivisionIdxInSeason(season, career.controlledTeamId);
  const otherDiv = season.divisions[1 - userDivIdx];
  const total = totalRoundsOf(otherDiv);
  const isFinished = otherDiv.currentRoundIdx >= total;

  const standings = computeStandings(
    otherDiv.record.matches,
    otherDiv.record.fixtures,
    otherDiv.currentRoundIdx,
    otherDiv.record.standings.map((s) => s.team_id),
  );

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        ANO {season.year} · DIVISÃO: {otherDiv.name} ·{" "}
        {isFinished
          ? `ENCERRADA · ${total} / ${total}`
          : `RODADA ${otherDiv.currentRoundIdx + 1} / ${total}`}{" "}
        · $ {formatMoney(career.manager.money)}
      </Text>

      <StandingsTable
        standings={standings}
        title={`Classificação · ${otherDiv.name}`}
      />

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
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

  const hasHistory = career.seasons.length >= 1;

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        ANO {season.year} · DIVISÃO: {userDiv.name} · TIME: {userTeamName} · ENCERRADA · {totalRounds} /{" "}
        {totalRounds} · $ {formatMoney(career.manager.money)}
      </Text>

      <Panel title={isUserChamp ? "*** Campeão ***" : "Campeão"}>
        {isUserChamp ? (
          <Text c="phosphor.4" fw={700}>
            PARABÉNS! {champName} venceu o {userDiv.name}.
          </Text>
        ) : (
          <Text>{champName}</Text>
        )}
      </Panel>

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
            <Text size="sm" c="phosphor.3" fw={600}>
              Sua colocação: {userTeamName} — {userIdx + 1}º lugar,{" "}
              {points(userStats)} pts, {userStats.won}V {userStats.drawn}E{" "}
              {userStats.lost}D
            </Text>
          )}
        </Stack>
      </Panel>

      <Panel title="Finanças da temporada">
        <Stack gap={2}>
          <FinanceRow
            label="Receita de bilheteria"
            value={`+ $ ${formatMoney(finances.ticketRevenue)}`}
            c="phosphor.4"
          />
          <FinanceRow
            label="Salários"
            value={`− $ ${formatMoney(finances.salaries)}`}
            c="red.5"
          />
          {finances.prBonus > 0 && (
            <FinanceRow
              label="Bônus promoção"
              value={`+ $ ${formatMoney(finances.prBonus)}`}
              c="phosphor.4"
            />
          )}
          {finances.prBonus < 0 && (
            <FinanceRow
              label="Multa rebaixamento"
              value={`− $ ${formatMoney(Math.abs(finances.prBonus))}`}
              c="red.5"
            />
          )}
          <Divider my={4} />
          <FinanceRow
            label="Saldo da temporada"
            value={`${finances.net >= 0 ? "+" : "−"} $ ${formatMoney(Math.abs(finances.net))}`}
            c={finances.net >= 0 ? "phosphor.4" : "red.5"}
          />
          <FinanceRow
            label="Saldo total"
            value={`$ ${formatMoney(career.manager.money + finances.net)}`}
          />
        </Stack>
      </Panel>

      <Panel title="Promoção e rebaixamento">
        <Stack gap="xs">
          {prResult.userPromoted && (
            <Text ta="center" fw={700} c="phosphor.4">
              *** SEU TIME SUBIU PARA A SÉRIE A! ***
            </Text>
          )}
          {prResult.userRelegated && (
            <Text ta="center" fw={700} c="red.5">
              *** SEU TIME FOI REBAIXADO PARA A SÉRIE B ***
            </Text>
          )}

          <div>
            <Text size="sm" c="dimmed" mb={4}>
              ▲ Sobem para a Série A:
            </Text>
            <Stack gap={1}>
              {prResult.promoted.map((s, i) => {
                const name = teamById(s.team_id)?.name ?? `Time ${s.team_id}`;
                const isUser = s.team_id === career.controlledTeamId;
                return (
                  <Text
                    key={s.team_id}
                    size="sm"
                    c={isUser ? "phosphor.3" : undefined}
                    fw={isUser ? 700 : undefined}
                  >
                    {i + 1}º {name} ({points(s)} pts)
                  </Text>
                );
              })}
            </Stack>
          </div>

          <div>
            <Text size="sm" c="dimmed" mb={4}>
              ▼ Descem para a Série B:
            </Text>
            <Stack gap={1}>
              {prResult.relegated.map((s, i) => {
                const name = teamById(s.team_id)?.name ?? `Time ${s.team_id}`;
                const isUser = s.team_id === career.controlledTeamId;
                // Position in Série A's standings: with 8 teams and 2
                // relegated, relegated[0] is 7º, relegated[1] is 8º. Derived
                // from tier A's standings length so the same code works if
                // RELEGATION_SLOTS ever changes.
                const positionInTierA =
                  tierASize - prResult.relegated.length + i + 1;
                return (
                  <Text
                    key={s.team_id}
                    size="sm"
                    c={isUser ? "phosphor.3" : undefined}
                    fw={isUser ? 700 : undefined}
                  >
                    {positionInTierA}º {name} ({points(s)} pts)
                  </Text>
                );
              })}
            </Stack>
          </div>
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
      ? "▲ Subiu para a Série A"
      : entry.userOutcome === "relegated"
        ? "▼ Desceu para a Série B"
        : `→ Permaneceu na ${entry.userDivision.name}`;
  const outcomeColor =
    entry.userOutcome === "promoted"
      ? "phosphor.4"
      : entry.userOutcome === "relegated"
        ? "red.5"
        : "dimmed";
  const moneyColor = entry.moneyDelta >= 0 ? "phosphor.4" : "red.5";
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
        <Table highlightOnHover verticalSpacing={6} horizontalSpacing="sm" fz="sm">
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
                <Table.Tr key={s.team_id} bg={isHi ? "phosphor.9" : undefined}>
                  <Table.Td>{i + 1}</Table.Td>
                  <Table.Td c={isHi ? "phosphor.3" : undefined} fw={isHi ? 700 : undefined}>
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
