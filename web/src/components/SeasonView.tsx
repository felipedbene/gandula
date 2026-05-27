import { useEffect, useMemo, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import type { SeasonRecord, TeamStats } from "../types";
import { computeStandings, goalDifference, points } from "../types";
import { clearSeason, loadSeason, saveSeason, type SavedSeason } from "../persistence";
import {
  biggestWin,
  buildPlayerLookup,
  cardLeader,
  topAssister,
  topScorer,
} from "../util/season-stats";
import Card from "../srcl/Card";
import RevealRound from "./RevealRound";
import TacticsView from "./TacticsView";
import PrepareView from "./PrepareView";

type SeasonViewProps = {
  onStatus: (msg: string) => void;
};

/**
 * The view is a 4-phase state machine bundled into a single useState so the
 * phase tag and its associated data can't drift apart (you literally can't
 * be in `picking` without a `pendingRecord` — type-narrowing enforces it).
 */
type Phase =
  | { tag: "loading" }
  | { tag: "form" }
  | { tag: "picking"; pendingRecord: SeasonRecord }
  | { tag: "running"; saved: SavedSeason }
  | { tag: "prepare"; saved: SavedSeason }
  | { tag: "revealing"; saved: SavedSeason }
  | { tag: "tactics"; saved: SavedSeason };

export function SeasonView({ onStatus }: SeasonViewProps) {
  const [phase, setPhase] = useState<Phase>({ tag: "loading" });

  // Form-field state — only relevant in `phase.tag === "form"`. Kept as
  // independent useStates because they're standard controlled-input concerns
  // with no transitions of their own.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(ALL_TEAMS.map((t) => t.id))
  );
  const [seed, setSeed] = useState<number>(1998);
  const [name, setName] = useState<string>("Brasileirão Imaginário 2026");
  const [error, setError] = useState<string | null>(null);

  // Autoload once on mount. `onStatus` is App-owned useState setState, stable
  // in practice — but `[]` makes the "load once" intent explicit instead of
  // relying on that stability.
  useEffect(() => {
    loadSeason()
      .then((saved) => {
        if (saved) {
          const teamName = teamById(saved.controlledTeamId)?.name ?? `Time ${saved.controlledTeamId}`;
          onStatus(`save carregado · ${teamName} · rodada ${saved.currentRoundIdx}`);
          setPhase({ tag: "running", saved });
        } else {
          setPhase({ tag: "form" });
        }
      })
      .catch((e) => {
        // IDB unavailable (private mode, quota exhausted, etc.) — fail open
        // to the form, surface the reason in the status line, don't block
        // the UI from rendering.
        onStatus(`erro ao carregar save: ${e}`);
        setPhase({ tag: "form" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run() {
    setError(null);
    try {
      const teams = ALL_TEAMS.filter((t) => selected.has(t.id));
      if (teams.length < 2) throw new Error("Selecione pelo menos 2 times.");
      const start = performance.now();
      const pendingRecord = run_season(teams, BigInt(seed), name) as SeasonRecord;
      const ms = Math.round(performance.now() - start);
      onStatus(`temporada simulada em ${ms}ms · seed ${seed}`);
      setPhase({ tag: "picking", pendingRecord });
    } catch (e) {
      setError(String(e));
      onStatus(`erro: ${e}`);
    }
  }

  async function confirmTeam(pendingRecord: SeasonRecord, teamId: number) {
    const saved: SavedSeason = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      seed: BigInt(seed),
      controlledTeamId: teamId,
      currentRoundIdx: 0,
      record: pendingRecord,
    };
    try {
      await saveSeason(saved);
      const teamName = teamById(teamId)?.name ?? `Time ${teamId}`;
      onStatus(`campeonato iniciado · ${teamName} · seed ${seed}`);
      setPhase({ tag: "running", saved });
    } catch (e) {
      setError(String(e));
      onStatus(`erro ao salvar: ${e}`);
    }
  }

  async function resetSeason() {
    try {
      await clearSeason();
      onStatus("nova temporada");
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
    onStatus(`preparando rodada ${saved.currentRoundIdx + 1}`);
    setPhase({ tag: "prepare", saved });
  }

  function backFromPrepare(saved: SavedSeason) {
    onStatus("voltou ao painel");
    setPhase({ tag: "running", saved });
  }

  /**
   * Called when user clicks [ JOGAR ] from PrepareView. The view may have
   * re-simulated already (if dirty) or returned the original save (if no
   * tactical change). Either way, persist the incremented round FIRST and
   * THEN enter revealing — same persist-before-reveal ordering the old
   * advanceRound used so F5 mid-reveal autoloads straight into running
   * with the new round already committed.
   */
  async function playRound(
    newSaved: SavedSeason,
    resimMs: number,
    resimCount: number,
  ) {
    const advanced: SavedSeason = {
      ...newSaved,
      currentRoundIdx: newSaved.currentRoundIdx + 1,
      savedAt: new Date().toISOString(),
    };
    try {
      await saveSeason(advanced);
      const teamName =
        teamById(advanced.controlledTeamId)?.name ??
        `Time ${advanced.controlledTeamId}`;
      if (resimCount > 0) {
        const plural = resimCount === 1 ? "" : "s";
        onStatus(
          `tática aplicada · ${teamName} · ${resimCount} partida${plural} re-simulada${plural} em ${resimMs}ms · rodada ${advanced.currentRoundIdx} iniciada`,
        );
      } else {
        onStatus(`avançando para rodada ${advanced.currentRoundIdx + 1}`);
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
          selected={selected}
          onToggle={toggle}
          name={name}
          onNameChange={setName}
          seed={seed}
          onSeedChange={setSeed}
          onSubmit={run}
        />
      )}
      {phase.tag === "picking" && (
        <TeamPicker
          record={phase.pendingRecord}
          onConfirm={(teamId) => confirmTeam(phase.pendingRecord, teamId)}
        />
      )}
      {phase.tag === "running" && (
        <CampeonatoEmCurso
          saved={phase.saved}
          onReset={resetSeason}
          onPrepare={() => openPrepare(phase.saved)}
          onTactics={() => openTactics(phase.saved)}
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
function NewSeasonForm({
  selected,
  onToggle,
  name,
  onNameChange,
  seed,
  onSeedChange,
  onSubmit,
}: {
  selected: Set<number>;
  onToggle: (id: number) => void;
  name: string;
  onNameChange: (s: string) => void;
  seed: number;
  onSeedChange: (n: number) => void;
  onSubmit: () => void;
}) {
  return (
    <Card title="NOVA TEMPORADA">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <fieldset>
          <legend>Times</legend>
          {ALL_TEAMS.map((t) => (
            <label key={t.id} className="checkbox">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => onToggle(t.id)}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
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
          <button type="submit" className="btn" disabled={selected.size < 2}>
            [ RODAR TEMPORADA ]
          </button>
        </div>
      </form>
    </Card>
  );
}

// ─── Phase: picking ─────────────────────────────────────────────────────────
// Lists every team that ran in the season — derived from record.standings
// (canonical team set for the season). Clicking a button commits the save
// and transitions to "running".
function TeamPicker({
  record,
  onConfirm,
}: {
  record: SeasonRecord;
  onConfirm: (teamId: number) => void;
}) {
  return (
    <Card title="ESCOLHA SEU TIME">
      <p className="muted">
        Temporada {record.league_name} simulada. Escolha qual time você quer controlar:
      </p>
      <div className="team-picker">
        {record.standings.map((s) => {
          const t = teamById(s.team_id);
          const label = t?.name ?? `Time ${s.team_id}`;
          return (
            <button
              key={s.team_id}
              type="button"
              className="btn team-picker__btn"
              onClick={() => onConfirm(s.team_id)}
            >
              [ {label} ]
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Phase: running ─────────────────────────────────────────────────────────
// Two cards: current-round fixture list (no score) and partial standings
// computed up to the current round. No reveal logic here — that's C3.3's
// AVANÇAR button. Edge case: currentRoundIdx === totalRounds renders the
// CAMPEONATO ENCERRADO branch so C3.4 has a stable hook point.
function CampeonatoEmCurso({
  saved,
  onReset,
  onPrepare,
  onTactics,
}: {
  saved: SavedSeason;
  onReset: () => void;
  onPrepare: () => void;
  onTactics: () => void;
}) {
  const team = teamById(saved.controlledTeamId);
  const teamName = team?.name ?? `Time ${saved.controlledTeamId}`;
  const totalRounds =
    saved.record.fixtures.length === 0
      ? 0
      : Math.max(...saved.record.fixtures.map((f) => f.round)) + 1;
  const isFinished = saved.currentRoundIdx >= totalRounds;

  // Once the season's done, hand off to the finale view. It owns its own
  // header / cards / button layout; the in-progress branch below stays
  // untouched.
  if (isFinished) {
    return <SeasonFinale saved={saved} totalRounds={totalRounds} onReset={onReset} />;
  }

  const teamIds = saved.record.standings.map((s) => s.team_id);
  const standings = computeStandings(
    saved.record.matches,
    saved.record.fixtures,
    saved.currentRoundIdx,
    teamIds,
  );

  return (
    <>
      <p className="campeonato-header muted">
        LIGA: {saved.record.league_name} · SEMENTE: {saved.seed.toString()} ·
        {" "}TIME: {teamName} · RODADA {saved.currentRoundIdx + 1} / {totalRounds}
      </p>

      <Card title={`RODADA ${saved.currentRoundIdx + 1}`}>
        <div className="round-list">
          {currentRoundFixtures(saved).map((row, i) => (
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
      />

      <div className="form-actions form-actions--triple">
        <button type="button" className="btn" onClick={onPrepare}>
          [ AVANÇAR RODADA ]
        </button>
        <button type="button" className="btn" onClick={onTactics}>
          [ TÁTICA ]
        </button>
        <button type="button" className="btn" onClick={onReset}>
          [ NOVA TEMPORADA ]
        </button>
      </div>
    </>
  );
}

// ─── Phase: running (finale) ────────────────────────────────────────────────
// Renders when the season is over (currentRoundIdx >= totalRounds). Owns its
// own layout — champion card, season highlights, final standings, reset.
function SeasonFinale({
  saved,
  totalRounds,
  onReset,
}: {
  saved: SavedSeason;
  totalRounds: number;
  onReset: () => void;
}) {
  const champion = saved.record.standings[0];
  const champTeam = champion ? teamById(champion.team_id) : undefined;
  const champName = champTeam?.name ?? `Time ${champion?.team_id ?? "?"}`;
  const isUserChamp = champion?.team_id === saved.controlledTeamId;

  const userIdx = saved.record.standings.findIndex(
    (s) => s.team_id === saved.controlledTeamId,
  );
  const userStats = userIdx >= 0 ? saved.record.standings[userIdx] : undefined;
  const userTeamName =
    teamById(saved.controlledTeamId)?.name ?? `Time ${saved.controlledTeamId}`;

  // Build the player lookup once per season — every stat helper needs it,
  // and walking ~17 rosters every render would be wasted work.
  const playerLookup = useMemo(() => buildPlayerLookup(saved.record), [saved.record]);
  const scorer = useMemo(() => topScorer(saved.record, playerLookup), [saved.record, playerLookup]);
  const assister = useMemo(() => topAssister(saved.record, playerLookup), [saved.record, playerLookup]);
  const biggest = useMemo(() => biggestWin(saved.record), [saved.record]);
  const cards = useMemo(() => cardLeader(saved.record, playerLookup), [saved.record, playerLookup]);

  return (
    <>
      <p className="campeonato-header muted">
        LIGA: {saved.record.league_name} · SEMENTE: {saved.seed.toString()} ·
        {" "}TIME: {userTeamName} · ENCERRADA · {totalRounds} / {totalRounds}
      </p>

      <Card title={isUserChamp ? "*** CAMPEÃO ***" : "CAMPEÃO"}>
        {isUserChamp ? (
          <p className="finale-champ">
            PARABÉNS! {champName} venceu o {saved.record.league_name}.
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

      <StandingsTable
        standings={saved.record.standings}
        highlightTeamId={saved.controlledTeamId}
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
 * Pull the current-round matchups in **fixtures-array order** — the circle-
 * method order is deterministic, ports of the season schedule depend on it,
 * we don't re-sort by name or anything else.
 */
function currentRoundFixtures(saved: SavedSeason): Array<{
  homeName: string;
  awayName: string;
  isUser: boolean;
}> {
  const round = saved.currentRoundIdx;
  return saved.record.fixtures
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.round === round)
    .map(({ i }) => {
      const m = saved.record.matches[i];
      return {
        homeName: teamById(m.home)?.name ?? `Time ${m.home}`,
        awayName: teamById(m.away)?.name ?? `Time ${m.away}`,
        isUser: m.home === saved.controlledTeamId || m.away === saved.controlledTeamId,
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
  /** When provided, this team gets the bright row instead of the leader. In
   *  running mode the user's controlled team is the natural focal point;
   *  outside running mode (none in-tree today), falls back to i === 0. */
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
