# Gandula

A text-based football management simulator. The name is the Portuguese word for
"ball boy" — a deliberate signal that this is a personal, affectionate project,
not a Football Manager competitor.

Gandula is a love letter to the 1998-era Brazilian text-based football
management games (Elifoot, mainly): tight simulation loop, legible numbers, one
season fits in an evening, and a clear cause-and-effect line between the
tactics you set and the result you read.

**Play it now:** [gandula.debene.dev](https://gandula.debene.dev). Each new
career drops you into a random Série B club in the Brasileirão Imaginário —
try to climb. State lives in your browser's IndexedDB; no account, no
tracking, no server.

Enjoying it? [Buy me a coffee on Ko-fi](https://ko-fi.com/felipedebene) — keeps
the side-project lights on.

The repo is split between a Rust simulation core (used by the CLI and compiled
to WebAssembly for the web) and a React+Vite web app.

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

`assets/teams/` ships three fully-detailed sample clubs at the top level:

| File                       | Vibe                       | Avg. strength |
|----------------------------|----------------------------|---------------|
| `santos_imperial.json`     | Strong, attacking F433     | ~78           |
| `flamenguinho_fc.json`     | Balanced F442              | ~68           |
| `ipanema_atletico.json`    | Defensive F352 underdog    | ~55           |

…plus 14 more in `assets/teams/fictional/` — together they make up the
17-team Brasileirão Imaginário the web app uses for its two-tier league
(Série A 8 + Série B 9).

## Workspace layout

```
core/          — domain types, deterministic RNG wrapper, simulation engine
cli/           — `gandula` binary
wasm/          — wasm-bindgen wrapper around core for the browser
web/           — Vite + React + Mantine career-mode app (responsive)
assets/teams/  — sample team JSONs (3 at top + 14 in fictional/)
scripts/       — build helpers (mainly the wasm→web pipeline)
ARCHITECTURE.md — tick loop + event-weighting formulas (for tuning)
```

## Building and testing

```bash
cargo build           # build everything
cargo test            # determinism + statistical sanity tests
```

## Substitutions and managers

Each team can carry a `bench` of up to 7 players in its JSON. Between minutes,
a small rule-based manager runs for both sides and may swap in a fresh player:

- A tired outfielder with a fresh same-position bench player → swap.
- Losing late → trade a forward for a fresher forward.
- Winning late → trade a forward for a defender.
- GK red-carded? Bring on a bench keeper (sacrificing a forward).

Max 3 subs per side. See `ARCHITECTURE.md` for the constants and the rule
order.

## Running a season (CLI)

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

## Saving and loading (CLI)

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

## Web app — career mode

The same engine runs in the browser via WebAssembly. A Vite + React app lives
in `web/`, with a Mantine-based UI that's responsive on both mobile and
desktop. Full career-mode loop:

- **Two divisions in parallel.** 17 fictional Brazilian clubs split into Série A
  (top 8) and Série B (bottom 9). Each new career drops you into a *random*
  Série B club (the season seed is randomized too — a fresh league every time).
- **Round-by-round reveal.** Pre-simulated season; rounds reveal one at a time
  with a tick-by-tick animation — a running match clock plus a live event feed
  (goals, cards, subs). F5 mid-reveal autoloads cleanly into the saved state —
  animation is lost, save intact.
- **Tactics.** Per-season formation, mentality, tempo, pressing, width, plus
  starting XI + bench. Mid-season changes re-simulate the user's remaining
  fixtures only; other matches stay frozen.
- **Promotion / relegation.** Top 2 of Série B go up, bottom 2 of Série A come
  down. Survives multi-season careers — your team plays whichever tier P/R
  placed it.
- **Finances.** Per-season net of ticket revenue (home opponent strength ×
  factor), salaries (full-roster × player avg × factor), and a promotion/
  relegation bonus or penalty. Money carries across seasons.
- **Transfer market.** Between seasons, a deterministic free agent pool (2 GK,
  4 DEF, 4 MID, 2 FWD) generated per `(career.seed, year)`. Buy / sell with
  age-curve pricing and roster bounds [14..25]. Session-level undo.
- **History.** Past seasons collapsed to compact summaries (champion, user's
  position, P/R outcome, money delta, transfers).

Schema is versioned (currently v5) with in-place migrations from every prior
version — `loadCareer` cascades v2→v3→v4→v5 transparently.

### Running locally

```bash
# One-time setup: builds the wasm module and installs npm deps.
./scripts/build-web.sh

# Dev server with hot reload at http://localhost:5173/
cd web && npm run dev

# Production bundle in web/dist/
cd web && npm run build

# Run the JS test suite (117 tests covering schema, persistence,
# simulation parity, finances, transfer market, components).
cd web && npm run test:run
```

If you change anything in `core/` or `wasm/`, re-run `./scripts/build-web.sh`
to regenerate the wasm module.

### Deploy

The production site at [gandula.debene.dev](https://gandula.debene.dev) runs
as a Cloudflare Workers static-asset deploy. `wrangler.toml` in `web/` carries
the full config.

Pushes to `main` that touch `web/`, `wasm/`, or `core/` **auto-deploy** via
GitHub Actions (`.github/workflows/deploy.yml`): it builds the wasm module,
runs the test suite as a gate, then deploys. Needs a `CLOUDFLARE_API_TOKEN`
repo secret. To deploy by hand instead, run `npm run deploy` from `web/`.

## What's next

See [`ROADMAP.md`](ROADMAP.md) for the structured plan. In short: **E.1.f**
manager firing (next), then **E.2** player aging/evolution, **E.3** self-play
rival AIs, plus a polish track (scout reports, live playback).
