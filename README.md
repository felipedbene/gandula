# Gandula

A text-based football management simulator. The name is the Portuguese word for
"ball boy" — a deliberate signal that this is a personal, affectionate project,
not a Football Manager competitor.

Gandula is a love letter to the 1998-era Brazilian text-based football
management games (Elifoot, mainly): tight simulation loop, legible numbers, one
season fits in an evening, and a clear cause-and-effect line between the
tactics you set and the result you read. The *feel* is retro; the *interface*
is a modern, mobile-friendly dark UI (electric-blue accent, Inter + JetBrains
Mono, generated club crests).

**Play it now:** [gandula.debene.dev](https://gandula.debene.dev). Each new
career drops you into a random **Série C** club at the bottom of a three-tier
Brasileirão Imaginário — climb the pyramid, win the Copa, build a champion.
State lives in your browser's IndexedDB; no account, no tracking, no server.

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

These three are CLI playthings (and test fixtures). The **web app** instead
uses a separate set of **60 fictional clubs** in `assets/teams/fictional/`,
which make up the three-tier Brasileirão Imaginário (Série A / B / C × 20).
Those 60 are generated deterministically from a public FC-25/SoFIFA dataset by
`scripts/build-fictional-teams.sh` (the strongest clubs, with names/badges
fictionalised) — see that script and `gandula-import-sofifa/`.

## Workspace layout

```
core/          — domain types, deterministic RNG wrapper, simulation engine
cli/           — `gandula` binary
wasm/          — wasm-bindgen wrapper around core for the browser
web/           — Vite + React + Mantine career-mode app (responsive)
assets/teams/  — 3 sample CLI clubs at top + 60 fictional/ clubs (the web world)
scripts/       — build helpers (wasm→web pipeline, fictional-team generation)
ARCHITECTURE.md — tick loop + event-weighting formulas (for tuning)
ROADMAP.md     — the (now largely shipped) plan and its history
```

The division pyramid, economy, Copa and transfer market are **pure TypeScript**
in `web/` — the Rust core stays a lean, division-agnostic match/season engine
(`play_match`, `run_season`). There is a sibling repo, **gandula-rl**, that
trains a reinforcement-learning agent against this same engine; its learned
policy was distilled into the in-game rival "coaches" (see the web section).

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
in `web/`, with a Mantine-based UI that's first-class on both mobile and
desktop — a modern dark theme (electric-blue accent, Inter + JetBrains Mono),
deterministic **generated club crests** (a two-tone shield + initials hashed
from each name, since the world ships no badge art), a persistent "your team"
header + standings highlight so you always know which club is yours, and
state-driven scorelines (the leading side's goals bright, the trailing side
dimmed). On phones the standings render as row-cards and the running phase has
a fixed bottom action nav; on desktop the full stats table and inline actions.
A responsive **formation pitch** drives lineup editing — players sit in their
position bands, tap one to swap — and the same pitch previews the next
opponent's shape. Screen changes fade, async re-sims show a loading state, and
goals pulse the scoreboard. Full career-mode loop:

- **A three-tier pyramid.** 60 fictional clubs in Série A / B / C (20 each). A
  new career starts you in a *random* Série C club (random season seed too — a
  fresh world every time), so reaching the top means **two promotions**.
- **Promotion / relegation across two boundaries.** 3 up / 3 down at A↔B and
  B↔C each season; the middle tier shuffles both ways. Careers span many
  seasons — your club plays whichever tier P/R left it in.
- **Copa do Brasil.** A season-long 60-club knockout running alongside the
  league, seeded by (evolved) strength. **Two-legged ties** decided on
  aggregate → away goals → penalty shootout, with prize money per round.
- **A full economy.** Per-round accrual of a home gate (fanbase × stadium
  capacity × opponent draw × form), a tier-keyed TV floor, sponsorship,
  win/draw bonuses, and Copa prizes, minus a strength-scaled wage bill — plus
  end-of-season placement prizes and P/R bonuses. Go broke and you're **fired**.
  A live **cash-runway** panel in the market projects your end-of-season balance
  vs. the wage bill before you commit to a buy.
- **Build-vs-buy levers.** Spend on **stadium expansion** (more gate capacity)
  and **marketing campaigns** (grow the fanbase, with decaying momentum) — the
  compounding flywheel behind the title.
- **Transfer market.** A deterministic free-agent pool per `(career.seed,
  year)`, with a rare-elite tail of title-grade players. Age-curve pricing,
  roster bounds [14..25], scouting verdicts, session-level undo.
- **Living, coached rivals.** Opponents age, retire, and bring through youth
  each season — *and* now **coach themselves**: a policy trained in the sibling
  **gandula-rl** repo was distilled into per-tier tactics + a transfer budget,
  so AI clubs genuinely strengthen and the table evolves year to year.
- **Career objectives.** A tier-aware goal ladder (survive → promote → win
  Série A) with live met / on-track / at-risk status off your standings.
- **Round-by-round reveal.** Pre-simulated season; rounds reveal one at a time
  with a tick-by-tick animation — a running match clock plus a live event feed
  that lingers on the big moments (goals, red cards, penalties). F5 mid-reveal
  autoloads cleanly into the saved state — animation is lost, save intact.
- **Tactics.** Per-season formation, mentality, tempo, pressing, width, plus
  starting XI + bench. Mid-season changes re-simulate the user's remaining
  fixtures only; other matches stay frozen, and the result is reproducible.
- **History.** Past seasons collapse to compact summaries (champion, your
  position, P/R outcome, Copa run, money delta, transfers).

State is a schema-versioned `Career` in IndexedDB (currently **v10**) with
additive in-place migrations — `loadCareer` cascades older saves forward
transparently (the most recent step re-derives the Copa as two-legged).

### Running locally

```bash
# One-time setup: builds the wasm module and installs npm deps.
./scripts/build-web.sh

# Dev server with hot reload at http://localhost:5173/
cd web && npm run dev

# Production bundle in web/dist/
cd web && npm run build

# Run the JS test suite (200+ tests covering schema/migrations, persistence,
# simulation parity, finances, Copa, transfer market, rival coaching,
# objectives, and components).
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

The planned *gameplay* arc has largely shipped — three-tier pyramid, Copa do
Brasil, the full economy, RL-distilled rival coaches, and a polish pass (career
objectives, cash-runway warning, two-leg cup, livelier playback). That part of
[`ROADMAP.md`](ROADMAP.md) is **parked**, with the remaining entries either
deliberately deferred or a settled design decision rather than missing work.

A **modern UI redesign** (on the `redesign/modern-sporty` branch) is essentially
complete: the dark-theme foundation, generated club crests, the "which team am
I?" identity pass, state-driven scorelines, motion & feedback (phase
transitions, button loading states, goal-pulse), mobile-native layout (standings
row-cards + fixed bottom nav), and a responsive formation pitch for lineup
editing + opponent scouting. Deliberately deferred for a later slice:
drag-and-drop on the pitch, a tactics board with arrows, and radar charts in the
transfer market.
