# Roadmap

Forward-looking plan for Gandula. Effort tags: **S** small, **M** medium,
**L** large. Items are grouped by epic; the suggested order is at the bottom.
**Shipped history is below the active work** — current priority is the economy /
squad-strength cluster (E.4), informed by [gandula-rl](https://github.com/felipedbene/gandula-rl).

## E.4 — Economy balance & squad strength (active priority)

The gandula-rl numbers read the finances layer as a difficulty dial. Greedy
goes broke in 91–99% of careers; a careful agent survives 99.7% but still wins
the Série A title only **4.7%** of the time over 20 seasons — and pushing the
agent to take more table-climbing risk (RL "FIO 1") just bankrupted it with **no
title gain**. So: solvency is a real, learnable skill, and the title is gated by
squad _means_ (and the money to buy them), not by playing more aggressively.

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
  - [ ] **E.4.b.1 — Per-match prize** · _S, core_ — win/draw bonus on top of the
    gate. Also softens the survival economy (greedy is fired 91%), so it must be
    re-measured, not assumed (→ E.6).
  - [ ] **E.4.b.2 — Per-position prize** · _S, core_ — end-of-season payout
    scaled by final placement (champion ≫ mid-table). The flywheel that can
    actually break the title ceiling: finish high → more cash → buy stronger
    (E.4.c) → finish higher.
  - [ ] **E.4.b.3 — More starting money** · _S, core_ — raise `STARTING_MONEY`
    (currently 1M). Cheapest knob and the fastest A/B, but a _one-time_ bump: it
    eases early survival / promotion more than the title (it doesn't compound the
    way b.1/b.2 do). Useful mostly as a difficulty lever (E.4.a) and to fund the
    first strong buys; the prizes are what move the ceiling.
  - [ ] **E.4.b.4 — Stadium expansion** · _M, core + web_ — let the controlled
    club spend cash to grow stadium capacity, which raises every future home
    gate. Today the gate (`opponentStrength × 1000`) has _no capacity term_; add
    a `stadiumCapacity` to the career state and make the gate
    `min(demand, capacity) × price`, with demand rising in Série A / vs. strong
    opponents. Unlike b.1–b.3 this is a _player-controlled, compounding
    investment_ (capex now → more revenue every season) and creates a real
    build-vs-buy tension: spend on the stadium or the squad. Schema bump +
    a new spend action in the market/UI; the most design-rich of the revenue
    levers.
  - [ ] **E.4.b.5 — Marketing campaigns** · _M, core + web_ — a spend action
    that grows the **fanbase** (a new career-state value), which feeds demand
    for the gate (E.4.b.4) and sponsorship (E.4.b.6). The _demand_-side lever:
    stadium raises supply (seats), marketing raises demand (fans to fill them) —
    they compound only together. Player-controlled, build-vs-buy.
  - [ ] **E.4.b.6 — Patronage / sponsorship** · _M, core_ — recurring income
    (per-season or per-round), tiered by division + fanbase + recent
    performance. Unlike the gate it's not gated by home/away or capacity, so it
    acts as a **revenue floor** that directly attacks the 91% firing rate.
    Could be passive (auto-scaling) or a chosen deal with risk/reward terms.
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
