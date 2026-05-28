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
} from "../persistence";
import {
  biggestWin,
  buildPlayerLookup,
  cardLeader,
  topAssister,
  topScorer,
} from "../util/season-stats";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import {
  computePromotionRelegation,
  userOutcomeFromPRResult,
} from "../util/promotion";
import { advanceCareer } from "../util/career";
import { computeSeasonFinances } from "../util/finances";
import { formatMoney } from "../util/money";
import Card from "../srcl/Card";
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
  | { tag: "history"; career: Career };

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

export function SeasonView({ onStatus }: SeasonViewProps) {
  const [phase, setPhase] = useState<Phase>({ tag: "loading" });

  // Form-field state — only relevant while `phase.tag === "form"`. Kept
  // as independent useStates because they're standard controlled-input
  // concerns. Team assignment happens at run() time via pickStarterTeam.
  const [seed, setSeed] = useState<number>(1998);
  const [name, setName] = useState<string>("Brasileirão Imaginário 2026");
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
          result.kind === "migratedV3"
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
      const starterTeam = pickStarterTeam(tierB);
      const careerSeed = BigInt(seed);
      const seasonSeed = careerSeed ^ BigInt(FIRST_YEAR);

      const start = performance.now();
      const recordA = run_season(tierA, seasonSeed ^ 1n, "Série A") as SeasonRecord;
      const recordB = run_season(tierB, seasonSeed ^ 2n, "Série B") as SeasonRecord;
      const ms = Math.round(performance.now() - start);

      const newCareer: Career = {
        schemaVersion: 4,
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
        },
        manager: { money: STARTING_MONEY },
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
    <div className="season-view">
      {phase.tag === "loading" && <p className="muted">Carregando save…</p>}
      {phase.tag === "form" && (
        <NewSeasonForm
          name={name}
          onNameChange={setName}
          seed={seed}
          onSeedChange={setSeed}
          onSubmit={run}
        />
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
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}

// ─── Phase: form ────────────────────────────────────────────────────────────
// The team checkboxes are gone (the Brasileirão Imaginário plays with all
// 17 teams fixed) and the user no longer picks a team (assigned to the
// weakest Série B team via pickStarterTeam).
function NewSeasonForm({
  name,
  onNameChange,
  seed,
  onSeedChange,
  onSubmit,
}: {
  name: string;
  onNameChange: (s: string) => void;
  seed: number;
  onSeedChange: (n: number) => void;
  onSubmit: () => void;
}) {
  return (
    <Card title="NOVA CARREIRA">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <p className="muted">
          17 times divididos em Série A (8) + Série B (9). Você assume o time
          mais fraco da Série B.
        </p>
        <label>
          <span>Liga</span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <label>
          <span>Semente</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => onSeedChange(Number(e.target.value))}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn">
            [ INICIAR CARREIRA ]
          </button>
        </div>
      </form>
    </Card>
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
    <>
      <p className="campeonato-header muted">
        ANO {season.year} · DIVISÃO: {userDiv.name} · TIME: {teamName} · RODADA{" "}
        {userDiv.currentRoundIdx + 1} / {totalRounds} · $ {formatMoney(career.manager.money)}
      </p>

      <Card title={`RODADA ${userDiv.currentRoundIdx + 1}`}>
        <div className="round-list">
          {currentRoundFixtures(career, userDiv).map((row, i) => (
            <div
              key={i}
              className={`round-list__row${row.isUser ? " round-list__row--user" : ""}`}
            >
              <span className="round-list__glyph">{row.isUser ? "►" : " "}</span>
              <span>
                {row.homeName.padEnd(24)}
                {"×  "}
                {row.awayName}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <StandingsTable
        standings={standings}
        highlightTeamId={career.controlledTeamId}
        title={`CLASSIFICAÇÃO · ${userDiv.name.toUpperCase()}`}
      />

      <div className="form-actions form-actions--quadruple">
        <button type="button" className="btn" onClick={onPrepare}>
          [ AVANÇAR RODADA ]
        </button>
        <button type="button" className="btn" onClick={onTactics}>
          [ TÁTICA ]
        </button>
        <button type="button" className="btn" onClick={onViewOtherDivision}>
          [ VER {otherDiv.name.toUpperCase()} ]
        </button>
        <button type="button" className="btn" onClick={onReset}>
          [ NOVA CARREIRA ]
        </button>
      </div>
    </>
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
    <>
      <p className="campeonato-header muted">
        ANO {season.year} · DIVISÃO: {otherDiv.name} ·{" "}
        {isFinished
          ? `ENCERRADA · ${total} / ${total}`
          : `RODADA ${otherDiv.currentRoundIdx + 1} / ${total}`}{" "}
        · $ {formatMoney(career.manager.money)}
      </p>

      <StandingsTable
        standings={standings}
        title={`CLASSIFICAÇÃO · ${otherDiv.name.toUpperCase()}`}
      />

      <div className="form-actions">
        <button type="button" className="btn" onClick={onBack}>
          [ VOLTAR ]
        </button>
      </div>
    </>
  );
}

// ─── Phase: finale ──────────────────────────────────────────────────────────
// Renders when both divisions are exhausted. Champion + season highlights
// + P/R + final standings, all sourced from the user's division. The
// silent-advance in playRound guarantees both tiers are done by the time
// we render here, so `computePromotionRelegation` is safe to call.
function SeasonFinale({
  career,
  onAdvanceSeason,
  onOpenHistory,
  onReset,
}: {
  career: Career;
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
    <>
      <p className="campeonato-header muted">
        ANO {season.year} · DIVISÃO: {userDiv.name} · TIME: {userTeamName} · ENCERRADA · {totalRounds} /{" "}
        {totalRounds} · $ {formatMoney(career.manager.money)}
      </p>

      <Card title={isUserChamp ? "*** CAMPEÃO ***" : "CAMPEÃO"}>
        {isUserChamp ? (
          <p className="finale-champ">
            PARABÉNS! {champName} venceu o {userDiv.name}.
          </p>
        ) : (
          <p>{champName}</p>
        )}
      </Card>

      <Card title="DESTAQUES DA TEMPORADA">
        <ul className="finale-stats">
          {scorer && (
            <li>
              Artilheiro: {scorer.name} ({scorer.teamName}) — {scorer.goals} gols
            </li>
          )}
          {assister && (
            <li>
              Líder de assistências: {assister.name} ({assister.teamName}) —{" "}
              {assister.assists} assistências
            </li>
          )}
          {biggest && (
            <li>
              Maior goleada:{" "}
              {teamById(biggest.match.home)?.name ?? `Time ${biggest.match.home}`}{" "}
              {biggest.match.result.home_goals} x {biggest.match.result.away_goals}{" "}
              {teamById(biggest.match.away)?.name ?? `Time ${biggest.match.away}`}{" "}
              (rodada {biggest.round + 1})
            </li>
          )}
          {cards && (
            <li>
              Mais cartões: {cards.name} ({cards.teamName}) — {cards.yellow}{" "}
              amarelos, {cards.red} vermelhos
            </li>
          )}
          {userStats && !isUserChamp && (
            <li className="finale-stats__user">
              Sua colocação: {userTeamName} — {userIdx + 1}º lugar,{" "}
              {points(userStats)} pts, {userStats.won}V {userStats.drawn}E{" "}
              {userStats.lost}D
            </li>
          )}
        </ul>
      </Card>

      <Card title="FINANÇAS DA TEMPORADA">
        <ul className="finances-list">
          <li className="finances-row">
            <span>Receita de bilheteria</span>
            <span className="finances-row--positive">
              + $ {formatMoney(finances.ticketRevenue)}
            </span>
          </li>
          <li className="finances-row">
            <span>Salários</span>
            <span className="finances-row--negative">
              − $ {formatMoney(finances.salaries)}
            </span>
          </li>
          {finances.prBonus > 0 && (
            <li className="finances-row">
              <span>Bônus promoção</span>
              <span className="finances-row--positive">
                + $ {formatMoney(finances.prBonus)}
              </span>
            </li>
          )}
          {finances.prBonus < 0 && (
            <li className="finances-row">
              <span>Multa rebaixamento</span>
              <span className="finances-row--negative">
                − $ {formatMoney(Math.abs(finances.prBonus))}
              </span>
            </li>
          )}
          <li className="finances-divider" />
          <li className="finances-row">
            <span>Saldo da temporada</span>
            <span
              className={
                finances.net >= 0
                  ? "finances-row--positive"
                  : "finances-row--negative"
              }
            >
              {finances.net >= 0 ? "+" : "−"} $ {formatMoney(Math.abs(finances.net))}
            </span>
          </li>
          <li className="finances-row">
            <span>Saldo total</span>
            <span>$ {formatMoney(career.manager.money + finances.net)}</span>
          </li>
        </ul>
      </Card>

      <Card title="PROMOÇÃO E REBAIXAMENTO">
        {prResult.userPromoted && (
          <p className="pr-banner pr-banner--promoted">
            *** SEU TIME SUBIU PARA A SÉRIE A! ***
          </p>
        )}
        {prResult.userRelegated && (
          <p className="pr-banner pr-banner--relegated">
            *** SEU TIME FOI REBAIXADO PARA A SÉRIE B ***
          </p>
        )}

        <p className="pr-section-title">▲ SOBEM PARA A SÉRIE A:</p>
        <ul className="pr-list">
          {prResult.promoted.map((s, i) => {
            const team = teamById(s.team_id);
            const name = team?.name ?? `Time ${s.team_id}`;
            const isUser = s.team_id === career.controlledTeamId;
            return (
              <li
                key={s.team_id}
                className={isUser ? "pr-list__item standings-hi" : "pr-list__item"}
              >
                {i + 1}º {name} ({points(s)} pts)
              </li>
            );
          })}
        </ul>

        <p className="pr-section-title">▼ DESCEM PARA A SÉRIE B:</p>
        <ul className="pr-list">
          {prResult.relegated.map((s, i) => {
            const team = teamById(s.team_id);
            const name = team?.name ?? `Time ${s.team_id}`;
            const isUser = s.team_id === career.controlledTeamId;
            // Position in Série A's standings: with 8 teams and 2 relegated,
            // relegated[0] is 7º, relegated[1] is 8º. Derive from tier A's
            // standings length so the same code works if RELEGATION_SLOTS
            // ever changes.
            const positionInTierA = tierASize - prResult.relegated.length + i + 1;
            return (
              <li
                key={s.team_id}
                className={isUser ? "pr-list__item standings-hi" : "pr-list__item"}
              >
                {positionInTierA}º {name} ({points(s)} pts)
              </li>
            );
          })}
        </ul>
      </Card>

      <StandingsTable
        standings={userDiv.record.standings}
        highlightTeamId={career.controlledTeamId}
        title={`CLASSIFICAÇÃO · ${userDiv.name.toUpperCase()}`}
      />

      <div
        className={`form-actions ${hasHistory ? "form-actions--triple" : "form-actions--pair"}`}
      >
        <button type="button" className="btn" onClick={onAdvanceSeason}>
          [ INICIAR PRÓXIMA TEMPORADA ]
        </button>
        {hasHistory && (
          <button type="button" className="btn" onClick={onOpenHistory}>
            [ HISTÓRICO ]
          </button>
        )}
        <button type="button" className="btn" onClick={onReset}>
          [ NOVA CARREIRA ]
        </button>
      </div>
    </>
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
    <>
      <p className="campeonato-header muted">
        HISTÓRICO · {career.seasons.length} temporada
        {career.seasons.length === 1 ? "" : "s"}
      </p>

      {career.seasons.map((s) => (
        <HistoryCard key={s.year} entry={s} />
      ))}

      <div className="form-actions">
        <button type="button" className="btn" onClick={onBack}>
          [ VOLTAR ]
        </button>
      </div>
    </>
  );
}

function HistoryCard({ entry }: { entry: SeasonHistory }) {
  const outcomeText =
    entry.userOutcome === "promoted"
      ? "▲ Subiu para a Série A"
      : entry.userOutcome === "relegated"
        ? "▼ Desceu para a Série B"
        : `→ Permaneceu na ${entry.userDivision.name}`;
  const outcomeClass = `history-card__outcome history-card__outcome--${entry.userOutcome}`;
  const moneyClass =
    entry.moneyDelta >= 0
      ? "history-card__money history-card__money--positive"
      : "history-card__money history-card__money--negative";
  const moneySign = entry.moneyDelta >= 0 ? "+" : "−";

  return (
    <Card title={`TEMPORADA ${entry.year}`}>
      <div className="history-card">
        <p>
          {entry.userDivision.name} · {entry.userPosition}º lugar · {entry.userPoints} pts
        </p>
        <p className="muted">Campeão: {entry.champion.teamName}</p>
        <p className="muted">
          ▲ Subiram: {entry.promoted.map((p) => p.teamName).join(", ")}
        </p>
        <p className="muted">
          ▼ Desceram: {entry.relegated.map((r) => r.teamName).join(", ")}
        </p>
        <p className={outcomeClass}>{outcomeText}</p>
        <p className={moneyClass}>
          {moneySign} $ {formatMoney(Math.abs(entry.moneyDelta))} · saldo ${" "}
          {formatMoney(entry.moneyAfter)}
        </p>
      </div>
    </Card>
  );
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
function pad(v: string | number, w: number, dir: "L" | "R" = "R"): string {
  return dir === "L" ? String(v).padEnd(w) : String(v).padStart(w);
}

const COL_GAP = "  ";

function StandingsTable({
  standings,
  highlightTeamId,
  title = "CLASSIFICAÇÃO",
}: {
  standings: TeamStats[];
  /** When provided, this team gets the bright row instead of the leader. */
  highlightTeamId?: number;
  title?: string;
}) {
  const headerLine = [
    pad("POS", 3),
    pad("TIME", 24, "L"),
    pad("P", 3),
    pad("V", 3),
    pad("E", 3),
    pad("D", 3),
    pad("GP", 3),
    pad("GC", 3),
    pad("SG", 4),
    pad("PTS", 3),
  ].join(COL_GAP);

  const dividerLine = [
    "───",
    "─".repeat(24),
    "──",
    "──",
    "──",
    "──",
    "──",
    "──",
    "───",
    "──",
  ]
    .map((s, i) => (i === 1 ? s : pad(s, [3, 24, 3, 3, 3, 3, 3, 3, 4, 3][i])))
    .join(COL_GAP);

  return (
    <Card title={title}>
      <pre className="standings">
        <span className="standings-dim">{headerLine}</span>
        {"\n"}
        <span className="standings-dim">{dividerLine}</span>
        {"\n"}
        {standings.map((s, i) => {
          const team = teamById(s.team_id);
          const teamName = team?.name ?? `Time ${s.team_id}`;
          const gd = goalDifference(s);
          const gdStr = gd > 0 ? `+${gd}` : String(gd);
          const pts = points(s);
          const hi =
            highlightTeamId !== undefined
              ? s.team_id === highlightTeamId
                ? "standings-hi"
                : ""
              : i === 0
                ? "standings-hi"
                : "";
          return (
            <span key={s.team_id}>
              {pad(`${i + 1}.`, 3)}
              {COL_GAP}
              <span className={hi}>{pad(teamName, 24, "L")}</span>
              {COL_GAP}
              {pad(s.played, 3)}
              {COL_GAP}
              {pad(s.won, 3)}
              {COL_GAP}
              {pad(s.drawn, 3)}
              {COL_GAP}
              {pad(s.lost, 3)}
              {COL_GAP}
              {pad(s.goals_for, 3)}
              {COL_GAP}
              {pad(s.goals_against, 3)}
              {COL_GAP}
              {pad(gdStr, 4)}
              {COL_GAP}
              <span className={hi}>{pad(pts, 3)}</span>
              {"\n"}
            </span>
          );
        })}
      </pre>
    </Card>
  );
}
