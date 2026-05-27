import { useEffect, useState } from "react";
import { run_season } from "../wasm/gandula_wasm.js";
import { ALL_TEAMS, teamById } from "../teams";
import type { SeasonRecord } from "../types";
import { clearSeason, loadSeason, saveSeason, type SavedSeason } from "../persistence";
import Card from "../srcl/Card";

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
  | { tag: "running"; saved: SavedSeason };

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
        <CampeonatoEmCurso saved={phase.saved} onReset={resetSeason} />
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
// Placeholder for the per-round reveal screen that lands in C3.2. Shows just
// enough metadata to confirm autoload + save state are wired correctly.
function CampeonatoEmCurso({
  saved,
  onReset,
}: {
  saved: SavedSeason;
  onReset: () => void;
}) {
  const team = teamById(saved.controlledTeamId);
  const teamName = team?.name ?? `Time ${saved.controlledTeamId}`;
  const totalRounds =
    saved.record.fixtures.length === 0
      ? 0
      : Math.max(...saved.record.fixtures.map((f) => f.round)) + 1;

  return (
    <Card title="CAMPEONATO EM CURSO">
      <pre className="campeonato-meta">
        {`Liga              : ${saved.record.league_name}\n`}
        {`Semente           : ${saved.seed.toString()}\n`}
        {`Time controlado   : ${teamName}\n`}
        {`Rodada atual      : ${saved.currentRoundIdx} / ${totalRounds}`}
      </pre>
      <p className="muted">Tela de rodada chega no C3.2.</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onReset}>
          [ NOVA TEMPORADA ]
        </button>
      </div>
    </Card>
  );
}
