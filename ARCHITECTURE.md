# Architecture — Phase 1 engine

This document describes the tick loop and the event-weighting formulas the
engine uses, so the numbers can be tuned later from a single place.

All tunables live in two files:

- `core/src/engine/strength.rs` — strength composition, formation/tactics
  modifiers, stamina mapping.
- `core/src/engine/tick.rs` — per-minute event rolls.

## Determinism

A match is a pure function of `(home_team, away_team, seed: u64)`. The RNG is
`ChaCha8Rng::seed_from_u64(seed)` wrapped in `MatchRng` (see `core/src/rng/`).
Nothing else in the engine reads from system time, environment, or unordered
collections. Same inputs → byte-identical `Match` (event log included). The
guarantee is asserted in `core/tests/determinism.rs`.

## Tick loop

One tick = one in-game minute. A match runs 90 ticks plus 0–4 minutes of
end-of-match injury time (the duration is drawn from the same RNG, so it's
deterministic for a given seed).

For each minute:

1. **Stamina drain** for every on-field player on both teams:
   ```
   drain = BASE_STAMINA_DRAIN(0.30) × tempo_factor(team.tempo) × pressing_factor(team.pressing)
   ```
   Stamina is clamped to `[0, 99]`.

2. **Compute current team strength** for both teams. See "Strength
   composition" below. Stamina is folded in via `stamina_effectiveness`.

3. **Possession draw** for this tick:
   ```
   p_home = clamp(0.5 + 0.005 × (home.midfield − away.midfield), 0.1, 0.9)
   attacker = Home with prob p_home, else Away
   ```

4. **Event roll** — most minutes pass silently:
   ```
   p_event = BASE_EVENT_RATE(0.18) × tempo_event_factor(attacker.tempo)
   ```

5. **Event classification** (only if an event fires). A single uniform draw
   `r ∈ [0, 1)` selects:
   ```
   shot_p = clamp(SHOT_BASE(0.70) × (1 + (attacker.attack − defender.defense)/200), 0.20, 0.95)
   foul_p = FOUL_BASE(0.15) × pressing_foul_factor(defender.pressing)
   if r < shot_p           → Shot
   else if r < shot_p+foul_p → Foul
   else                    → silent
   ```

At minute 45 a `HalfTime` event is emitted. At minute 90 + injury, a `FullTime`
event closes the log.

## Strength composition

Each team aggregates three meta-stats from its on-field starting XI: `attack`,
`midfield`, `defense`. Each stat is a weighted average of per-player
contributions across the 11.

**Per-player raw stat** (before stamina):

```
attack_attr   = 0.5·finishing + 0.3·technique + 0.2·pace
midfield_attr = 0.5·passing   + 0.3·technique + 0.2·stamina
defense_attr  = 0.5·defending + 0.2·pace      + 0.3·stamina
```

**Position weight** — how much a player at position P contributes to each meta-stat:

| Stat     | GK   | DEF  | MID  | FWD  |
|----------|------|------|------|------|
| attack   | 0.0  | 0.1  | 0.3  | 0.6  |
| midfield | 0.0  | 0.2  | 0.6  | 0.2  |
| defense  | 0.1  | 0.6  | 0.3  | 0.0  |

The per-player contribution is `raw_attr × position_weight`. The meta-stat is
the weighted average across the XI.

**Stamina effectiveness** (applied to each player's raw stats before
aggregation):

```
eff = 0.7 + 0.3 × (stamina / 99)
```

Fresh player = 100% effective. Fully depleted = 70%.

**Formation modifier** `(Δattack, Δmidfield, Δdefense)`:

| Formation | Δatt | Δmid | Δdef |
|-----------|------|------|------|
| F442      |  0   |  0   |  0   |
| F433      | +5   | −2   | −5   |
| F352      | −2   | +5   | −3   |
| F4231     | +3   | +3   | −3   |

**Mentality** `(Δattack, Δdefense)`:

| Mentality      | Δatt | Δdef |
|----------------|------|------|
| VeryDefensive  | −10  | +10  |
| Defensive      |  −5  |  +5  |
| Balanced       |   0  |   0  |
| Attacking      |  +5  |  −5  |
| VeryAttacking  | +10  | −10  |

**Pressing** disrupts the *opponent's* midfield (subtracted at the opponent's
strength computation) and increases the pressing team's own stamina drain:

| Pressing | Δopp_midfield | own stamina factor | foul factor |
|----------|---------------|--------------------|-------------|
| Low      | 0             | 0.85               | 0.8         |
| Medium   | −3            | 1.0                | 1.0         |
| High     | −6            | 1.25               | 1.3         |

**Tempo** multiplies event rate and stamina drain:

| Tempo  | event factor | stamina factor |
|--------|--------------|----------------|
| Slow   | 0.85         | 0.85           |
| Normal | 1.0          | 1.0            |
| Fast   | 1.15         | 1.25           |

**Width** multiplies shot accuracy:

| Width  | on-target factor |
|--------|------------------|
| Narrow | 0.97             |
| Normal | 1.0              |
| Wide   | 1.03             |

## Shot resolution

1. Pick a shooter from the attacking XI weighted by position
   `[GK: 0.05, DEF: 1, MID: 3, FWD: 5]`.
2. `on_target_p = clamp(0.35 + (shooter.technique − 50)/200, 0.1, 0.85) × width_factor`.
3. If off target → emit `Shot { on_target: false }`.
4. If on target:
   `goal_p = clamp(0.32 + (shooter.finishing − gk.defending)/200, 0.05, 0.7)`.
5. If goal:
   - 60% chance of assist, picked from teammates weighted
     `[GK: 0, DEF: 0.5, MID: 3, FWD: 2]`, excluding the shooter.
   - Increment scoreline; emit `Goal { scorer, assist }`.
6. Otherwise → emit `Shot { on_target: true }` (a save).

## Foul resolution

1. Pick offender from defending XI weighted `[GK: 0.1, DEF: 3, MID: 2, FWD: 1]`.
2. Pick victim from attacking XI weighted `[GK: 0.1, DEF: 1, MID: 2, FWD: 3]`.
3. Emit `Foul`. Then roll severity:
   - 70% nothing, 25% yellow, 5% red (slightly more cards under high pressing).
4. On red card: the player is removed from the field for the rest of the match.
   Phase 1 has no substitutions, so the team plays out the match with 10.

## Substitutions and the manager hook (Phase 2)

After each minute's events, the orchestrator runs both teams' managers via
`engine::manager::run_managers`. The manager is a pure (RNG-free) decision
function — it reads a `ManagerView` of the team's current state and may emit a
single `ManagerAction::Substitute { off_slot, on_bench_idx }`. Determinism
follows from the rules being deterministic and the bench/XI having stable
iteration order.

### State carried across ticks for subs

`MatchState` keeps, per team:

- `current_xi: [PlayerId; 11]` — starts as `team.starting_xi`, mutates when subs
  come on. Picks (shooters, fouls, GK) iterate this, not the immutable
  `team.starting_xi`.
- `bench_used: Vec<bool>` — parallel to `team.bench`; flipped to `true` when a
  bench player enters the field.
- `subs_used: u8` — capped at `MAX_SUBS_PER_MATCH` (3).
- A subbed-on player carries their *base* attribute stamina into the slot —
  they aren't fully fresh, just fresher than the player they replaced.

### Heuristic rules

Rules run in order; the first one that yields an action wins for that tick.
All thresholds are `pub const` in `core/src/engine/manager.rs`.

1. **GK emergency** — if our GK is off-field (red-carded) and a bench GK is
   available, bring on the bench GK by sacrificing the first on-field FWD
   (fallback: MID). Eats a sub slot. The original GK slot stays empty
   (on_field = false); the team plays 10 outfielders + the new GK.
2. **Stamina swap** — after minute `STAMINA_RULE_MIN_MINUTE` (55): for each
   on-field outfielder, if `stamina < STAMINA_SUB_THRESHOLD` (40) and a
   same-position bench player has `attribute_stamina >=
   STAMINA_FRESH_THRESHOLD` (70), swap.
3. **Game state** — after `GAME_STATE_RULE_MIN_MINUTE` (70):
   - Losing → swap the most-tired on-field FWD for any bench FWD.
   - Winning → swap the first on-field FWD for any bench DEF.

GK is never *preemptively* subbed; only rule 1 ever touches the keeper.

### When self-play managers arrive

`heuristic_decide` is a free function, not a trait method. When a learned
manager lands (Phase ≥ 4 territory), extract a `Manager` trait with one
implementor per strategy and add a per-team selector. That's the moment the
abstraction earns its keep — not before.

## Known simplifications

- No accumulating yellows → red.
- Possession is sampled per-minute; there's no continuous possession run.
- Injury time only at end of second half (0–4 min).
- Width affects shot accuracy only; doesn't redistribute shot locations.
- Manager runs at the *end* of each minute, never mid-event (so e.g. a red
  card at minute 78 is followed by the manager's response at the same minute
  boundary 78 — see sample outputs).

The data model (`Substitution`, `YellowCard`, `RedCard` in `MatchEventKind`)
supports richer behavior for future phases.

## Season layer (Phase 3)

A `League { name, teams }` runs through `simulate_season(&league, seed)` which:

1. Validates the league (≥2 teams, unique `TeamId`s, each team passes its own
   validation).
2. Generates a double round-robin schedule (see "Fixture generation" below).
3. Simulates each fixture with a per-match seed derived from the season seed
   and the fixture index (so changing fixture order changes the matches).
4. Folds match results into a sorted standings table.

Output: `SeasonRecord { league_name, fixtures, matches, standings }`. Full
event logs are kept on every match — fine for the small leagues Phase 3 ships
with; revisit when persistence arrives.

### Fixture generation — circle method

With N teams, working size `effective = N` (even) or `N+1` (odd, using a
virtual BYE that's filtered out). For `effective` teams, the first half is
`effective − 1` rounds; the second half mirrors the first with home/away
flipped. Total fixtures: `N × (N−1)`.

Rotation: position 0 is fixed; the last position slides to position 1 each
round, others shift right. Home/away within a round alternates by `(i + round)
% 2` so home games balance out across the full season.

### Per-match seed

```
match_seed(season_seed, fixture_idx) =
    ((season_seed × 0x9E3779B97F4A7C15) + (fixture_idx × 0xD1B54A32D192ED03))
    × 0xC6BC279692B5C323
```

Pure, deterministic, fixture-unique. No system entropy. Same `(league, seed)`
produces a byte-identical `SeasonRecord` — asserted in
`core/tests/season_determinism.rs`.

### Standings

Per team: P, W, D, L, GF, GA. Derived: GD = GF − GA, Pts = W·3 + D (modern
CBF rules). Sort order: Pts desc, GD desc, GF desc, then `team_id` asc as a
stability tiebreaker (so the table is deterministic even when teams are
otherwise equal).

### Known Phase 3 simplifications

- No carryover between matches — stamina, cards, injuries all reset.
- No promotion/relegation, no multi-season chains.
- No transfers, no per-season player movement.
- `SeasonRecord.matches` keeps full event logs. Large leagues would balloon
  memory; OK for the small demos shipping today.

## Persistence (Phase 4)

`cli/src/persistence.rs` exposes a `Store` over SQLite (bundled — no system
dep). Two tables, each one row per domain object with a JSON blob payload and
a few columns for filtering:

```sql
CREATE TABLE teams (
    id          INTEGER PRIMARY KEY,   -- mirrors TeamId.0
    name        TEXT NOT NULL,
    json        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE seasons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    league_name  TEXT NOT NULL,
    seed         INTEGER NOT NULL,
    team_count   INTEGER NOT NULL,
    json         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`Store::open` runs `CREATE TABLE IF NOT EXISTS` on first call. No migration
framework yet — add a `_schema_version` table when the schema needs to evolve.

### Why JSON blobs

The serde derives are already in place (Phase 1), so storing the full Team
or SeasonRecord as JSON is cheap and round-trips losslessly. Cost: no SQL
queries against player attributes. None of the current commands need that.
If analytics-style queries arrive, use SQLite's JSON1 extension on the blob
columns or normalize then.

### Lookup-by-id when showing a saved season

A loaded `SeasonRecord` carries `TeamId`s but not the original `Team` objects.
`show-season` reads the season, collects the `TeamId`s it references, and
calls `load_team` for each to resolve names. Missing teams display as
`Time {id}` rather than failing. The `season --save-to <db>` command
auto-saves the teams used so the saved season is always fully reconstructable.

### Module location

`Store` lives in `cli/src/persistence.rs`, not its own crate. Reasoning: only
one consumer right now. When the WASM frontend (or any second consumer) needs
its own storage, extract `storage-sqlite` then — matches the "concrete until a
second implementation justifies the abstraction" rule.

### Known Phase 4 simplifications

- No schema versioning / migrations.
- `INSERT OR REPLACE` for teams: re-importing silently overwrites by id.
- `seed` is stored as `INTEGER` (i64). u64 seeds with the high bit set become
  negative numbers in SQLite views, but the bit pattern round-trips.
- No `delete-team` / `delete-season` commands yet. Drop the db file if you
  want to start over.

## WASM + web frontend (Phase 5)

The same `core` simulation runs in the browser. Two additions, sibling to
`core`/`cli`:

```
wasm/   — Rust crate, cdylib, thin wasm-bindgen shim over core
web/    — Vite + React + TS app, consumes the wasm module
```

`core` and `cli` are unchanged in behavior — `cli` keeps SQLite, `wasm` never
sees SQLite.

### The wasm shim

`wasm/src/lib.rs` exports two functions: `play_match(home, away, seed)` and
`run_season(teams, seed, name)`. Inputs and outputs are converted via
`serde-wasm-bindgen`, so the JS side gets plain objects matching the existing
JSON shapes. The shim is thin enough that no separate test layer is needed —
the underlying `core` tests prove correctness; this shim just round-trips
JS values.

### Why `default-features = false` on `rand` / `rand_chacha`

The workspace pins both with default features off:

```toml
rand        = { version = "0.9", default-features = false }
rand_chacha = { version = "0.9", default-features = false }
```

Default features pull in `getrandom`, which doesn't auto-support
`wasm32-unknown-unknown` and would fail compilation. The engine only uses
`SeedableRng::seed_from_u64` + `RngCore`, neither of which needs OS randomness,
so disabling defaults costs nothing.

### Build pipeline

```bash
# scripts/build-web.sh
wasm-pack build wasm --target web --out-dir ../web/src/wasm
# then `cd web && npm install` if needed
```

`wasm-pack --target web` outputs an ES module Vite imports directly. Output
lives in `web/src/wasm/` (gitignored — regenerated on each build).

### Browser state

Ephemeral. No IndexedDB, no localStorage. SQLite doesn't compile cleanly to
WASM (and we don't ship a JS SQLite implementation either). When persistence
matters on the web, add IndexedDB or another browser-native store — that's a
later phase.

### Aesthetic

Monospace stack, dark-on-light, no animations. Goal lines highlighted green;
red cards highlighted red. Matches the CLI's tight-numbers, terminal-y feel.

### Known Phase 5 simplifications

- Only the 3 bundled sample teams are pickable in the UI (no team editor).
- No live tick-by-tick playback — the feed renders the full event log after
  the match completes.
- No browser persistence.
- No tests on the React side. Visual verification via dev server is enough at
  this stage; tests come when there's logic beyond rendering.
- Desktop-first layout. Mobile responsive comes later.

