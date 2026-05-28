import { useEffect, useMemo, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import type { SeasonRecord, TeamStats } from "../types";
import { computeStandings, goalDifference, points } from "../types";
import {
  clearSeason,
  findUserDivisionIdx,
  loadSeason,
  saveSeason,
  totalRoundsOf,
  type Division,
  type SavedSeason,
} from "../persistence";
import {
  biggestWin,
  buildPlayerLookup,
  cardLeader,
  topAssister,
  topScorer,
} from "../util/season-stats";
import { divideIntoDivisions, pickStarterTeam } from "../util/divisions";
import { computePromotionRelegation } from "../util/promotion";
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
 * the invariant that you can't be in `prepare` without a `saved` etc.).
 *
 * E.1.a removed the `picking` phase — `run()` now assigns the user
 * deterministically to the weakest Série B team via `pickStarterTeam`.
 * E.1.a added `viewOtherDivision` so the running player can peek at the
 * read-only standings of the other tier.
 */
type Phase =
  | { tag: "loading" }
  | { tag: "form" }
  | { tag: "running"; saved: SavedSeason }
  | { tag: "viewOtherDivision"; saved: SavedSeason }
  | { tag: "prepare"; saved: SavedSeason }
  | { tag: "revealing"; saved: SavedSeason }
  | { tag: "tactics"; saved: SavedSeason };

export function SeasonView({ onStatus }: SeasonViewProps) {
  const [phase, setPhase] = useState<Phase>({ tag: "loading" });

  // Form-field state — only relevant while `phase.tag === "form"`. Kept
  // as independent useStates because they're standard controlled-input
  // concerns. No more team-selection toggling — the 17 teams are fixed
  // (Brasileirão Imaginário Série A + B); team assignment happens at
  // run() time via pickStarterTeam.
  const [seed, setSeed] = useState<number>(1998);
  const [name, setName] = useState<string>("Brasileirão Imaginário 2026");
  const [error, setError] = useState<string | null>(null);

  // Autoload once on mount. Discriminated LoadResult lets us emit a
  // visible status when a v1 save is found and dropped — silent discard
  // would confuse the user (they'd open the app expecting their save and
  // find a fresh form with no explanation).
  useEffect(() => {
    loadSeason()
      .then((result) => {
        if (result.kind === "loaded") {
          const saved = result.save;
          const userDiv = saved.divisions[findUserDivisionIdx(saved)];
          const teamName =
            teamById(saved.controlledTeamId)?.name ??
            `Time ${saved.controlledTeamId}`;
          onStatus(
            `save carregado · ${teamName} (${userDiv.name}) · rodada ${userDiv.currentRoundIdx}`,
          );
          setPhase({ tag: "running", saved });
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
   * NOVA TEMPORADA. Builds two divisions in parallel (Série A + Série B)
   * from ALL_TEAMS, partitioned by `divideIntoDivisions`. Per-division
   * match-seed namespace via `seed XOR BigInt(tier)` so the two leagues
   * never collide on fixture index in the engine's match_seed derivation.
   * Same XOR is used on re-simulation (see `util/resimulate.ts`), keeping
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
      const userSeed = BigInt(seed);

      const start = performance.now();
      const recordA = run_season(tierA, userSeed ^ 1n, "Série A") as SeasonRecord;
      const recordB = run_season(tierB, userSeed ^ 2n, "Série B") as SeasonRecord;
      const ms = Math.round(performance.now() - start);

      const newSaved: SavedSeason = {
        schemaVersion: 2,
        savedAt: new Date().toISOString(),
        seed: userSeed,
        controlledTeamId: starterTeam.id,
        divisions: [
          { tier: 1, name: "Série A", record: recordA, currentRoundIdx: 0 },
          { tier: 2, name: "Série B", record: recordB, currentRoundIdx: 0 },
        ],
      };

      saveSeason(newSaved)
        .then(() => {
          onStatus(
            `nova carreira · ${starterTeam.name} (Série B) · 2 ligas simuladas em ${ms}ms · seed ${seed}`,
          );
          setPhase({ tag: "running", saved: newSaved });
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

  async function resetSeason() {
    try {
      await clearSeason();
      onStatus("nova carreira");
      setPhase({ tag: "form" });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao limpar: ${e}`);
    }
  }

  function openTactics(saved: SavedSeason) {
    const teamName =
      teamById(saved.controlledTeamId)?.name ?? `Time ${saved.controlledTeamId}`;
    onStatus(`editando tática · ${teamName}`);
    setPhase({ tag: "tactics", saved });
  }

  function backFromTactics(saved: SavedSeason) {
    onStatus("sem alterações");
    setPhase({ tag: "running", saved });
  }

  async function applyTactics(
    newSaved: SavedSeason,
    resimMs: number,
    resimCount: number,
  ) {
    try {
      await saveSeason(newSaved);
      const teamName =
        teamById(newSaved.controlledTeamId)?.name ??
        `Time ${newSaved.controlledTeamId}`;
      const plural = resimCount === 1 ? "" : "s";
      onStatus(
        `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms`,
      );
      setPhase({ tag: "running", saved: newSaved });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar tática: ${e}`);
    }
  }

  function openPrepare(saved: SavedSeason) {
    const userDiv = saved.divisions[findUserDivisionIdx(saved)];
    onStatus(`preparando rodada ${userDiv.currentRoundIdx + 1} (${userDiv.name})`);
    setPhase({ tag: "prepare", saved });
  }

  function backFromPrepare(saved: SavedSeason) {
    onStatus("voltou ao painel");
    setPhase({ tag: "running", saved });
  }

  function openOtherDivision(saved: SavedSeason) {
    const userDivIdx = findUserDivisionIdx(saved);
    const otherDiv = saved.divisions[1 - userDivIdx];
    onStatus(`visualizando ${otherDiv.name}`);
    setPhase({ tag: "viewOtherDivision", saved });
  }

  function backFromOtherDivision(saved: SavedSeason) {
    setPhase({ tag: "running", saved });
  }

  /**
   * Called when user clicks [ JOGAR ] from PrepareView. The view may have
   * re-simulated already (if dirty) or returned the original save (if no
   * tactical change). Either way, persist the incremented rounds FIRST
   * and THEN enter revealing — same persist-before-reveal ordering as
   * pre-E.1.a, so F5 mid-reveal autoloads straight back into running
   * with the new state committed.
   *
   * Both divisions advance in lockstep until one is exhausted. The other
   * division (Série A finishes at round 14, Série B at 18) holds at
   * `totalRounds` once done — see the `< total` guard below.
   */
  async function playRound(
    newSaved: SavedSeason,
    resimMs: number,
    resimCount: number,
  ) {
    const userDivIdx = findUserDivisionIdx(newSaved);
    const newDivisions = newSaved.divisions.map((d, i) => {
      const total = totalRoundsOf(d);
      if (i === userDivIdx) {
        return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      }
      if (d.currentRoundIdx < total) {
        return { ...d, currentRoundIdx: d.currentRoundIdx + 1 };
      }
      return d;
    });

    const advanced: SavedSeason = {
      ...newSaved,
      divisions: newDivisions,
      savedAt: new Date().toISOString(),
    };

    try {
      await saveSeason(advanced);
      const teamName =
        teamById(advanced.controlledTeamId)?.name ??
        `Time ${advanced.controlledTeamId}`;
      const userDiv = advanced.divisions[userDivIdx];
      if (resimCount > 0) {
        const plural = resimCount === 1 ? "" : "s";
        onStatus(
          `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms · rodada ${userDiv.currentRoundIdx} iniciada`,
        );
      } else {
        onStatus(`avançando para rodada ${userDiv.currentRoundIdx + 1}`);
      }
      setPhase({ tag: "revealing", saved: advanced });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar avanço: ${e}`);
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
          saved={phase.saved}
          onReset={resetSeason}
          onPrepare={() => openPrepare(phase.saved)}
          onTactics={() => openTactics(phase.saved)}
          onViewOtherDivision={() => openOtherDivision(phase.saved)}
        />
      )}
      {phase.tag === "viewOtherDivision" && (
        <OtherDivisionView
          saved={phase.saved}
          onBack={() => backFromOtherDivision(phase.saved)}
        />
      )}
      {phase.tag === "prepare" && (
        <PrepareView
          saved={phase.saved}
          onPlay={playRound}
          onBack={() => backFromPrepare(phase.saved)}
        />
      )}
      {phase.tag === "revealing" && (
        <RevealRound
          saved={phase.saved}
          onDone={() => setPhase({ tag: "running", saved: phase.saved })}
        />
      )}
      {phase.tag === "tactics" && (
        <TacticsView
          saved={phase.saved}
          onApply={applyTactics}
          onBack={() => backFromTactics(phase.saved)}
        />
      )}
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}

// ─── Phase: form ────────────────────────────────────────────────────────────
// E.1.a simplified this — the team checkboxes are gone (the Brasileirão
// Imaginário plays with all 17 teams fixed) and the user no longer picks
// a team (assigned to the weakest Série B team via pickStarterTeam).
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
// score) and partial standings up to that round. Hands off to the finale
// view once the user's division is exhausted; the other division may
// still be in progress at that point (Série A finishes early when user
// is in Série B), but the user already has nothing left to play.
function CampeonatoEmCurso({
  saved,
  onReset,
  onPrepare,
  onTactics,
  onViewOtherDivision,
}: {
  saved: SavedSeason;
  onReset: () => void;
  onPrepare: () => void;
  onTactics: () => void;
  onViewOtherDivision: () => void;
}) {
  const team = teamById(saved.controlledTeamId);
  const teamName = team?.name ?? `Time ${saved.controlledTeamId}`;
  const userDivIdx = findUserDivisionIdx(saved);
  const userDiv = saved.divisions[userDivIdx];
  const otherDiv = saved.divisions[1 - userDivIdx];
  const totalRounds = totalRoundsOf(userDiv);
  const isFinished = userDiv.currentRoundIdx >= totalRounds;

  if (isFinished) {
    return (
      <SeasonFinale
        saved={saved}
        userDiv={userDiv}
        totalRounds={totalRounds}
        onReset={onReset}
      />
    );
  }

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
        DIVISÃO: {userDiv.name} · TIME: {teamName} · RODADA{" "}
        {userDiv.currentRoundIdx + 1} / {totalRounds}
      </p>

      <Card title={`RODADA ${userDiv.currentRoundIdx + 1}`}>
        <div className="round-list">
          {currentRoundFixtures(saved, userDiv).map((row, i) => (
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
        highlightTeamId={saved.controlledTeamId}
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
          [ NOVA TEMPORADA ]
        </button>
      </div>
    </>
  );
}

// ─── Phase: viewOtherDivision ───────────────────────────────────────────────
// Read-only peek at the other tier's standings. Shows "ENCERRADA" when
// that division has already played all its rounds (Série A at 14 while
// user's Série B is still climbing 15-18).
function OtherDivisionView({
  saved,
  onBack,
}: {
  saved: SavedSeason;
  onBack: () => void;
}) {
  const userDivIdx = findUserDivisionIdx(saved);
  const otherDiv = saved.divisions[1 - userDivIdx];
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
        DIVISÃO: {otherDiv.name} ·{" "}
        {isFinished
          ? `ENCERRADA · ${total} / ${total}`
          : `RODADA ${otherDiv.currentRoundIdx + 1} / ${total}`}
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

// ─── Phase: running (finale) ────────────────────────────────────────────────
// Renders when the user's division is exhausted. Champion + season
// highlights + final standings, all sourced from the user's division.
// The other division may still be in progress but it doesn't affect the
// user's finale view.
function SeasonFinale({
  saved,
  userDiv,
  totalRounds,
  onReset,
}: {
  saved: SavedSeason;
  userDiv: Division;
  totalRounds: number;
  onReset: () => void;
}) {
  const champion = userDiv.record.standings[0];
  const champTeam = champion ? teamById(champion.team_id) : undefined;
  const champName = champTeam?.name ?? `Time ${champion?.team_id ?? "?"}`;
  const isUserChamp = champion?.team_id === saved.controlledTeamId;

  const userIdx = userDiv.record.standings.findIndex(
    (s) => s.team_id === saved.controlledTeamId,
  );
  const userStats = userIdx >= 0 ? userDiv.record.standings[userIdx] : undefined;
  const userTeamName =
    teamById(saved.controlledTeamId)?.name ?? `Time ${saved.controlledTeamId}`;

  // Player lookup + season-stats helpers operate on the user's division's
  // record. Cross-division stat highlights would be misleading (you don't
  // celebrate the other tier's golden boot in your own finale).
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
  const biggest = useMemo(
    () => biggestWin(userDiv.record),
    [userDiv.record],
  );
  const cards = useMemo(
    () => cardLeader(userDiv.record, playerLookup),
    [userDiv.record, playerLookup],
  );
  // Promotion/relegation is computed from BOTH divisions' final standings,
  // so it lives outside the per-division stat helpers above. The helper
  // throws if either division isn't done — at SeasonFinale time both
  // always are (Série A finishes round 14 < user's Série B 18), but the
  // throw is a defensive guarantee for E.1.c when the user can be in
  // either tier.
  const prResult = useMemo(
    () => computePromotionRelegation(saved, saved.controlledTeamId),
    [saved],
  );
  const tierASize =
    saved.divisions.find((d) => d.tier === 1)?.record.standings.length ?? 0;

  return (
    <>
      <p className="campeonato-header muted">
        DIVISÃO: {userDiv.name} · TIME: {userTeamName} · ENCERRADA · {totalRounds} /{" "}
        {totalRounds}
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
            const isUser = s.team_id === saved.controlledTeamId;
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
            const isUser = s.team_id === saved.controlledTeamId;
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
        highlightTeamId={saved.controlledTeamId}
        title={`CLASSIFICAÇÃO · ${userDiv.name.toUpperCase()}`}
      />

      <div className="form-actions">
        <button type="button" className="btn" onClick={onReset}>
          [ NOVA TEMPORADA ]
        </button>
      </div>
    </>
  );
}

/**
 * Current-round matchups in fixtures-array order. The circle-method
 * order is deterministic — ports of the season schedule depend on it,
 * we don't re-sort by name or anything else.
 */
function currentRoundFixtures(
  saved: SavedSeason,
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
          m.home === saved.controlledTeamId ||
          m.away === saved.controlledTeamId,
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
