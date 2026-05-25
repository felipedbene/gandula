# Gandula

A text-based football management simulator. The name is the Portuguese word for
"ball boy" — a deliberate signal that this is a personal, affectionate project,
not a Football Manager competitor.

Gandula is a love letter to the 1998-era Brazilian text-based football
management games: tight simulation loop, legible numbers, one season fits in an
evening, and a clear cause-and-effect line between the tactics you set and the
result you read.

This repository is Phase 1 — the deterministic match engine and a CLI to play a
single match. No UI, no AI managers, no league/season logic, no persistence.
Those come later.

## Running a match

You'll need Rust (`rustup` installs the stable toolchain in one command).
From the repository root:

```bash
cargo run --release --bin gandula -- play \
  --home assets/teams/santos_imperial.json \
  --away assets/teams/flamenguinho_fc.json \
  --seed 1998
```

You'll get the minute-by-minute feed in Brazilian Portuguese:

```
=== Santos Imperial 4 x 0 Flamenguinho FC (semente 1998) ===
11' GOOOL do Santos Imperial! Tarsílio aproveita o passe de Antônio!
22' Júnior arrisca de longe... pra fora!
...
45' Fim do primeiro tempo. Santos Imperial 1x0 Flamenguinho FC.
...
78' Falta de Ferraz em Maurício.
78' VERMELHO! Ferraz expulso de campo!
...
90' Fim de jogo. Santos Imperial 4x0 Flamenguinho FC.
```

Same `--seed` + same team files always produces the same match — this is the
single most important property of the engine. See `core/tests/determinism.rs`.

## Sample teams

Three made-up Brazilian clubs ship in `assets/teams/`:

| File                       | Vibe                       | Avg. strength |
|----------------------------|----------------------------|---------------|
| `santos_imperial.json`     | Strong, attacking F433     | ~78           |
| `flamenguinho_fc.json`     | Balanced F442              | ~68           |
| `ipanema_atletico.json`    | Defensive F352 underdog    | ~55           |

## Workspace layout

```
core/          — domain types, deterministic RNG wrapper, simulation engine
cli/           — `gandula` binary
assets/teams/  — sample team JSONs
ARCHITECTURE.md — tick loop + event-weighting formulas (for tuning)
```

## Building and testing

```bash
cargo build           # build everything
cargo test            # determinism + statistical sanity tests
```

## Substitutions and managers (Phase 2)

Each team can carry a `bench` of up to 7 players in its JSON. Between minutes,
a small rule-based manager runs for both sides and may swap in a fresh player:

- A tired outfielder with a fresh same-position bench player → swap.
- Losing late → trade a forward for a fresher forward.
- Winning late → trade a forward for a defender.
- GK red-carded? Bring on a bench keeper (sacrificing a forward).

Max 3 subs per side. See `ARCHITECTURE.md` for the constants and the rule
order.

## Running a season (Phase 3)

Drop in any number of team JSONs and watch a double round-robin play out:

```bash
cargo run --release --bin gandula -- season \
  --team assets/teams/santos_imperial.json \
  --team assets/teams/flamenguinho_fc.json \
  --team assets/teams/ipanema_atletico.json \
  --name "Brasileirão Imaginário 2026" \
  --seed 1998 \
  --show both
```

```
--- Rodada 1 ---
Ipanema Atlético       0 - 3 Flamenguinho FC
...
--- Rodada 6 ---
Flamenguinho FC        1 - 0 Santos Imperial

Pos   Time                      P    V    E    D    GP    GC    SG   Pts
1.    Santos Imperial           4    3    0    1     7     1    +6     9
2.    Flamenguinho FC           4    2    1    1     5     2    +3     7
3.    Ipanema Atlético          4    0    1    3     1    10    -9     1
```

`--show table` (default), `--show matches`, or `--show both`. Same
`(team files, seed, name)` always reproduces the same season — see
`core/tests/season_determinism.rs`.

## Saving and loading (Phase 4)

Teams and seasons can be persisted to a SQLite file:

```bash
# Import teams once.
gandula save-team --db data.db --from assets/teams/santos_imperial.json
gandula save-team --db data.db --from assets/teams/flamenguinho_fc.json
gandula save-team --db data.db --from assets/teams/ipanema_atletico.json
gandula list-teams --db data.db

# Run a season and save it. The teams used are saved alongside, so the
# season is fully reconstructable later.
gandula season \
  --team assets/teams/santos_imperial.json \
  --team assets/teams/flamenguinho_fc.json \
  --team assets/teams/ipanema_atletico.json \
  --name "Brasileirão Imaginário 2026" \
  --seed 1998 \
  --save-to data.db

# List and replay later.
gandula list-seasons --db data.db
gandula show-season  --db data.db --id 1 --show both
```

SQLite is bundled (no system dep). Schema is a tiny two-table store with
JSON blobs for the full domain objects — see `ARCHITECTURE.md`.

## Web app (Phase 5)

The same engine runs in the browser via WebAssembly. A small Vite + React + TS
app lives in `web/`. Two screens: **Partida** (single match) and **Temporada**
(double round-robin with the standings table).

```bash
# One-time setup: builds the wasm module and installs npm deps.
./scripts/build-web.sh

# Dev server with hot reload at http://localhost:5173/
cd web && npm run dev

# Production bundle in web/dist/ (≈ 365 KB, ≈ 127 KB gzipped)
cd web && npm run build
```

If you change anything in `core/` or `wasm/`, re-run `./scripts/build-web.sh`
to regenerate the wasm module.

The web app ships with the same three sample teams as the CLI (bundled at
build time). Browser state is purely in-memory for now — no save/load on the
web side. SQLite stays in the terminal world.

## What's next

On the roadmap:

- Self-play training for rival managers
- Promotion/relegation, multi-season, transfers
- Browser persistence (IndexedDB)
- Tick-by-tick live playback in the web app
