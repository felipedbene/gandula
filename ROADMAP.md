# Roadmap

Forward-looking plan for Gandula. Effort tags: **S** small, **M** medium,
**L** large. Items are grouped by epic; the suggested order is at the bottom.
**Shipped history is below the active work.**

## The structural arc (re-sequenced)

The original plan tuned the economy (E.4) on the 17-team / 2-tier world. That
was reframed: building TV-money tiers around 17 teams and then expanding the
pyramid means redoing the finance tuning. So the order is **pyramid →
competitions → finances**, each shipping standalone value:

1. **E.2 — Expand the pyramid** → 3 tiers of 20 (Série A/B/C, 60 teams).
   **✓ Shipped** (see below). Division is the key everything downstream reads
   (TV tier, schedule size, prize money), so it's foundational. The richer
   60-club SoFIFA pool also lifts title-contender XI strength (~73 vs the old
   ~67–69), which already begins attacking the E.4.c "means wall".
2. **E.3 — Competition layer** (← next): Copa do Brasil knockout + a calendar.
   State championships deliberately deferred.
3. **E.4 — Finances** (after E.3): TV-deal tiers + a ledger, schema v6→v7.
   Asymmetric income keyed to division; the gandula-rl 4.7%-title analysis
   below still motivates it.

## E.3 — Competition layer (active priority)

The league spine already exists — each tier is a double round-robin via
`run_season`. E.3 adds the *other* competitions interleaved on a calendar.
The engine stays untouched: `play_match`, `run_season`, `derive_match_seed`
are exported via wasm and divisions/competitions are pure TS on top.

- [x] **E.3.a — Copa do Brasil knockout** · _M, web_ — **Shipped.** A pure-TS
  64-slot knockout over all 60 clubs (`util/copa.ts`): the 4 strongest Série A
  clubs bye the prelim, the other 56 play 28 ties → r32, then 32→16→8→4→2→1
  (6 named rounds). Each tie is one `play_match`; a draw is decided by a
  deterministic **seeded penalty shootout** (the engine has no extra-time). Cup
  ties **share matchdays** with mapped league rounds (`COPA_ROUND_AT_LEAGUE_ROUND`)
  — advancing a mapped round plays the user's tie (live tactics) and auto-sims
  the rest; after the user is out the cup completes in the background. Schema
  bumped **v6 → v7**: the cup is additive, so v6 saves migrate in-place
  (`initCopaForSeason` builds + fast-forwards the bracket — no wipe). UI:
  PrepareView banner, a `CopaView` bracket peek, the user's tie in the round
  reveal, and a finale cup-champion line. `cupResultFor` structures the result;
  **prize money is deferred to E.4** (not paid yet). Determinism: cup seed is
  its own namespace (`season.seed ^ 0xC09A`), tie seeds via `derive_match_seed`
  on a monotonic index; bracket pairing is no-PRNG strength-mirror.
- [ ] **E.3.b — Calendar polish** · _S, web_ — the matchday-sharing model
  shipped in E.3.a. Remaining: two-leg ties, evolved-strength seeding, a richer
  animated cup reveal.
- [ ] **E.3.c — State championship** · _S, web, DEFERRED_ — the scope trap (real
  Brazil has ~27 with disjoint team sets). If ever built: a short optional
  pre-season regional cup (3–4 geographic buckets, quick round-robin, small
  prize). Regional cups (Nordeste/Verde/Sul-Sudeste) skipped entirely.

## E.4 — Economy balance & squad strength (after E.3)

The gandula-rl numbers read the finances layer as a difficulty dial. Greedy
goes broke in 91–99% of careers; a careful agent survives 99.7% but still wins
the Série A title only **4.7%** of the time over 20 seasons — and pushing the
agent to take more table-climbing risk (RL "FIO 1") just bankrupted it with **no
title gain**. So: solvency is a real, learnable skill, and the title is gated by
squad _means_ (and the money to buy them), not by playing more aggressively.

**First slice shipped** (the title flywheel + cup prize + TV floor): the economy
now has, beyond the home gate + P/R bonus —
(1) a **TV-deal floor keyed to division** (`TV_DEAL_BY_TIER` A=4M/B=1.5M/C=600k,
sliced per round), so a careful Série C club is cash-positive before the gate —
this attacks the 91% firing; (2) a **per-match win/draw bonus** (40k/12k);
(3) a **per-position placement prize** (champion 2.5M decaying to 0 by 12th,
tier-scaled 1.0/0.4/0.15) — the compounding title flywheel; (4) **Copa prize
money** (per round reached + 1.2M champion bonus), paying what E.3 structured.
All derived from existing v7 state → **no schema bump**. Numbers are illustrative
and centralized in `finances.ts`, to be **re-measured + re-tuned by gandula-rl
(E.6)** — that re-measurement is the immediate next step. Still open below:
starting-money knob (b.3), the player-controlled build-vs-buy levers
(b.4–b.7: stadium / fanbase / marketing / sponsorship / momentum), and the
richer SoFIFA market (E.4.c).

- [ ] **E.4.a — Balance pass / difficulty tiers** · _M, core_
  Decide intent: if greedy-broke-91% is too punishing, loosen per-round accrual
  / starting cash; if intended, keep it but make solvency teachable (E.5).
  Either way, expose difficulty presets backed by _measured_ survival rates.
- [ ] **E.4.b — Title affordability** · _M, core_
  A 4.7% title ceiling over 20 seasons suggests the economy can't easily fund a
  champion. Today the only revenue is the home gate (`opponentStrength × 1000`,
  home games only) and the only standings-linked money is the step-function
  promotion bonus (500k) / relegation penalty (200k) — nothing rewards results
  _within_ a division. Add money so squad-building compounds:
  - [x] **E.4.b.1 — Per-match prize** · _S, core_ — **Shipped** (WIN_BONUS 40k /
    DRAW_BONUS 12k, accrued per round). Re-measure via E.6.
  - [x] **E.4.b.2 — Per-position prize** · _S, core_ — **Shipped** (placement
    prize, champion 2.5M decaying to 0 by 12th, tier-scaled, at the boundary).
    The flywheel that can break the title ceiling: finish high → more cash → buy
    stronger (E.4.c) → finish higher.
  - [ ] **E.4.b.3 — More starting money** · _S, core_ — raise `STARTING_MONEY`
    (currently 1M). Cheapest knob and the fastest A/B, but a _one-time_ bump: it
    eases early survival / promotion more than the title (it doesn't compound the
    way b.1/b.2 do). Useful mostly as a difficulty lever (E.4.a) and to fund the
    first strong buys; the prizes are what move the ceiling.
  - [x] **E.4.b.4 — Stadium expansion + fanbase substrate** · _M, core + web_ —
    **Shipped.** The gate is now `min(demand, capacity) × TICKET_PRICE`, with
    `demand = fanbase × tierMult × opponentDraw` (keeps the evolved-opponent
    term). Added **both** `stadiumCapacity` and `fanbase` to `Manager` (schema
    **v7→v8**, additive in-place migration seeding from the current tier — no
    wipe; v6→v7→v8 cascade in the load effect). A **spend action in the transfer
    market** pays a rising cost (`1.5M + cap×80`) for +5k seats up to an 80k cap,
    with undo — the build-vs-buy tension sits next to buying players. **fanbase
    drifts** each season toward a tier+placement target (capped step), so success
    compounds the crowd. Built the substrate per the shared-mechanic note so
    b.5–b.7 are additive; fanbase is first-class state for a future RL
    observation. Numbers illustrative (TICKET_PRICE=1.5 keeps a baseline A gate
    ~65k); re-measure via E.6.
  - [x] **E.4.b.5 — Marketing campaigns** · _M, core + web_ — **Shipped.** A
    paid campaign in the transfer market adds `+CAMPAIGN_FANBASE` (6k) now AND
    raises a decaying **`marketingMomentum`** that the seasonal fanbase-drift
    target reads, so a campaign persists ~3–4 seasons rather than snapping back
    (momentum halves each season, snapping to 0 at the tail). Rising cost
    (`800k + momentum×120`) up to a momentum cap; reversible like the stadium
    spend. Schema **v8→v9** (additive; `migratedV8` seeds momentum 0). The
    demand-side complement to the stadium: capacity raises supply, marketing
    raises the crowd to fill it — they compound only together. Re-measure via E.6.
  - [x] **E.4.b.6 — Patronage / sponsorship** · _M, core_ — **Shipped.** A
    passive recurring floor = `SPONSORSHIP_BASE_BY_TIER + fanbase×4 +
    placementBonus(lastSeasonPos)`, floored at 0. Accrues **per round** (sliced
    like TV) so it eases mid-season cash-flow / firing; not gated by home/away
    or capacity. Reads the fanbase substrate (so b.5 marketing compounds into
    it) and rewards sustained success via last-season placement (another
    flywheel input). Derived from tier/fanbase/history → **no schema bump**.
    New `sponsorship` line in `SeasonFinances` + finale panel. Passive (not a
    chosen deal) — re-measure via E.6.
  - [ ] **E.4.b.7 — Team momentum / form** · _M, core_ — recent form (win
    streak) acts as a transient multiplier on attendance: winning fills seats →
    more gate → fund better squad → keep winning. The _short-term, volatile_
    counterpart to the slow-moving fanbase. **Double-edged — cap it:** an
    unbounded loop also amplifies skids (losses → emptier stadium → less cash →
    can't reinforce → keep losing), which would _worsen_ the 91% firing rate.
    Bound the multiplier (floor + ceiling, decay toward 1.0) and re-measure
    firing via E.6 — it adds drama but must not turn a slump into a death spiral.

  _Shared mechanic:_ b.4–b.7 are best designed around one **`fanbase`** state
  value — marketing grows it, stadium capacity caps the gate it can convert,
  sponsorship scales with it, and momentum is a bounded short-term multiplier on
  the attendance it produces (form on top of the structural base). Build the
  fanbase substrate once; the levers read/write it. Caution: each adds state +
  UI surface — sequence them, don't ship all at once, and lean on E.6 to keep
  the economy in balance as each lands.

  _Fanbase is measurable — make it first-class:_ once it's real state it becomes
  (a) an **RL observation** so the policy _learns_ to grow it (build-vs-buy as a
  learned skill, not just a UI choice); (b) an **eval metric** in gandula-rl
  (report peak/final fanbase alongside reached-A / title / fired, to confirm the
  commercial levers actually compound); and (c) an in-game **objective** (E.5.b),
  e.g. "grow your fanbase to X". Build the state value with all three readouts in
  mind from the start.

  _Distinct from RL reward-shaping:_ b.1/b.2 are real in-game money (changes the
  economy/means), not a training signal. Placement _reward_-shaping was tried in
  gandula-rl (FIO 1) and reverted — it bankrupted the agent. Adding placement
  _revenue_ is a different, legitimate lever.
- [ ] **E.4.c — Richer market (SoFIFA import)** · _M, core + data_
  The 4.7% ceiling is also a market-_availability_ wall, not just an economy
  one: free agents top out at overall ~50–60 ("no superhuman free agents"),
  while the title contenders' starting XI averages ~67–69 (registry mean 63.6,
  max 74). **You can't buy anyone good enough to out-build the top clubs.** Lift
  the wall via [gandula-import-sofifa](https://github.com/felipedbene/gandula-import-sofifa)
  (maps real FC25/SoFIFA attributes, [1,99]):
  - seed the **free-agent generator** from the SoFIFA distribution instead of
    the flat [30,70]+cap-85 roll, so the market carries a realistic tail of
    rare, expensive elites; and/or
  - import **stronger registry clubs** so the league bar (and the talent in
    circulation via poaching) rises too.
  Pairs with E.4.b — a richer market only matters if a well-run club can afford
  the strong players. Distinct lever from E.4.b (means vs. money — they're the
  same wall from two sides). **Measure later** with the gandula-rl FIO A/B
  (baseline vs. richer-market vs. richer-market+revenue; 1M-step, fixed seed).

## E.5 — Teach solvency (where players actually lose)

- [ ] **E.5.a — Cash-runway / wage-bill warning in the market** · _S, web_
  Scout reports answer "is this player good?"; add "can I afford this _across a
  season_?" — project season-end balance vs. the strength-scaled wage bill and
  warn before away-heavy stretches. This is exactly the lever the RL agent
  learned and greedy never did.
- [ ] **E.5.b — Career objectives** · _S, web_
  Surface the natural difficulty tiers the RL data exposes — survive a season →
  promote (achievable) → win Série A (rare) — as explicit goals, so players see
  titles as the frontier, not the baseline.

## E.6 — Tooling

- [ ] **E.6 — RL eval as a balance-regression guard** · _S, core + CI_
  Any change to the finances module re-runs greedy + the trained agent over N
  careers and flags if firing or title rate moves past a threshold. The recent
  economy change swung greedy from 58% → 91% fired — exactly the regression this
  would catch. **Track `fanbase` as a reported metric** (peak/final) once it
  exists, so the commercial levers (E.4.b.4–b.7) can be shown to actually
  compound rather than just adding UI.

## E.3.c — Self-play search (open)

E.3.a/b shipped (see Shipped). The open piece is learned per-club managers.

- [ ] **E.3.c — Self-play search** · _L, core + training_
  Tune configs by simulated fitness (win rate), persist the winners. The
  research-y endgame; benefits from the now-richer E.2 world.

  _Reframed by gandula-rl._ A reactive MaskablePPO policy already trains on this
  engine and, from a random Série B club, **survives 99.7%** of careers and
  **promotes ~89%** (20-season horizon). The heuristic manager, by contrast, is
  **fired in 91–99%** of careers under the current economy — it is not a
  credible rival. So the research path is less "search the `ManagerConfig` space
  from scratch" and more "borrow the policy that already works":
  - [ ] **E.3.c.1 — Policy-driven rivals** · _L, core + training_ — drive rival
    transfer/tactic choices from the trained policy (or its value head) instead
    of the greedy heuristic.
  - [ ] **E.3.c.2 — Distill policy → `ManagerConfig`** · _M, core_ — if running a
    net per rival in-browser is too heavy, distill the learned behavior (spend
    ratio vs. wage bill, cash-buffer target) back into the E.3.a/b config knobs,
    so per-club styles become _learned_ rather than authored.

## Polish (small, slot in anytime)

- [~] **Live playback** · _S–M, web_
  Running match clock during the reveal landed (incl. bye rounds). Further
  playback polish (per-event pacing tweaks, highlights) can still be layered on.

## Suggested order

Shipped: ~~E.1.f firing~~, ~~scout reports~~, ~~E.2.a/a.2/b/c living world~~,
~~E.3.a ManagerConfig~~, ~~E.3.b per-club styles~~ ✓

Active, in priority order:

1. **E.4.a — balance pass / difficulty tiers** — decide intent; conditions everything below. ← next
2. **E.4.b.3 — more starting money** — cheapest affordability knob, quick A/B.
3. **E.4.b.1 + E.4.b.2 — match + position prizes** — performance revenue and the title flywheel.
4. **E.4.c — richer market (SoFIFA)** — the means lever; pair with E.4.b or strong players sit unbought.
5. **E.6 — RL balance-regression guard** — lock balance in once tuned (re-run after each lever).
6. **E.5.a — cash-runway warning** — addresses the dominant failure (going broke).
7. **Commercial levers (sequence, don't batch):** `fanbase` substrate (with RL
   observation + eval metric wired in) → **E.4.b.4 stadium** (supply) →
   **E.4.b.5 marketing** (demand) → **E.4.b.6 sponsorship** (floor) →
   **E.4.b.7 momentum** (bounded form multiplier). Player-controlled,
   compounding; the build-vs-buy depth layer.
8. **E.3.c.1 — policy-driven rivals** — credible opponents via the gandula-rl policy.
9. _Then:_ E.3.c.2 distillation, E.5.b objectives, Polish.

Dependencies: E.4.a should land before the other E.4 levers + E.6, since the
balance decision sets their targets. Self-play ← `Manager`-trait extraction +
ideally E.2. The gandula-rl repo is the measurement substrate for E.4/E.6.

## Shipped

- **E.2 — Three-tier pyramid (the structural-arc E.2)** — the world grew from
  17 teams / 2 tiers to **60 teams / 3 tiers** (Série A/B/C × 20). New careers
  start at the bottom (Série C) and climb; promotion/relegation now spans two
  boundaries (3 up / 3 down at A↔B and B↔C, the middle tier shuffling both
  ways). Schema bumped **v5 → v6** as a hard break — pre-v6 (2-tier) saves are
  discarded and a fresh 3-tier career auto-starts (no legacy 2-tier code path).
  Engine untouched: each tier is one `run_season(teams, seasonSeed ^ tier, …)`.
  Data: the 60 fictional clubs are the strongest by avg overall from the FC25/
  SoFIFA Kaggle set, via `scripts/build-fictional-teams.sh` (adapt → import →
  fictionalize, all in `gandula-import-sofifa`, deterministic & reproducible).
  A world-fixture test locks the monotonic A>B>C talent gradient. _(Note: the
  living-world epic below is the **older** "E.2" — same number, different work;
  this entry is the structural-arc E.2.)_
- **E.1.a–e** — career mode: two divisions (Série A/B), promotion/relegation,
  the `Career` schema (currently v5) + in-place migrations, the finances layer,
  and the transfer market.
- **E.1.f — Manager firing** — lose-condition when the balance goes negative.
  Grew beyond the plan: finances accrue **per round** (home gate + wage slice),
  so you can go broke — and be fired — mid-season, and the transfer market is
  openable **every round**, not just at the finale.
- **Scout reports** — free agents expand to an inline report: attribute bars,
  overall, and a verdict vs your squad at that position (delta + where they'd
  rank), so buys aren't blind.
- **Platform** — Mantine UI (responsive, dark phosphor theme), tick-by-tick
  match reveal with a running clock (on bye rounds too), randomized new careers
  (random Série B club + random seed), and GitHub Actions CI/CD (build wasm →
  test → deploy).

### E.2 — Living world (players age & evolve) — complete

- [x] **E.2.a — Aging (your squad)** · _M, web_ — players age +1/season and
  attributes drift along a curve (young develop, prime plateaus, veterans
  decline). Deterministic, web-only (the engine ignores age, so it rides on
  attributes).
- [x] **E.2.a.2 — League-wide aging** · _M, web_ — opponents aged on the fly by
  elapsed seasons (recompute from registry base, no per-team state).
- [x] **E.2.b — Youth / regen (opponents)** · _M, web_ — AI clubs retire ≥36 +
  intake youth + rebuild a valid XI each season (evolveTeam), so the league
  refreshes instead of decaying.
- [x] **E.2.c — Retire + regen (your squad)** · _M, web_ — the user's squad is
  symmetric with opponents — 36+ players retire and same-position youth come
  through (shared `evolveRoster`), holding roster size. `userTeam` reconciles
  the XI so a retired starter can't break re-sim. (A visible youth academy for
  the user is a possible later add.)

### E.3.a/b — Smarter opponents — shipped

- [x] **E.3.a — ManagerConfig** · _S, core_ — the heuristic manager's thresholds
  are now a `ManagerConfig` value (the search space), `balanced()` = the old
  constants. Behavior-preserving.
- [x] **E.3.b — Per-club styles** · _M, core_ — balanced / cautious / bold
  presets, assigned per club by id (manager_config_for), so rivals manage with
  distinct identities. Deterministic; subs tests held unchanged.
