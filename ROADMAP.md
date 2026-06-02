# Roadmap

Forward-looking plan for Gandula. Effort tags: **S** small, **M** medium,
**L** large. Items are grouped by epic; the suggested order is at the bottom.
**Shipped history is below the active work.**

> **Status (2026-06): gameplay roadmap parked; UI + analytics layers shipping.**
> The full gameplay arc shipped — three-tier pyramid → Copa do Brasil → full
> economy → RL-distilled rival coaches → objectives / cash-runway / two-leg cup /
> playback polish. On top of that, a **modern sporty dark-UI redesign** (crests +
> team identity, state-driven scorelines, motion, mobile-native layout, formation
> pitch), then an **analytics/finance layer**: half-time tactics with a live
> projection (engine split into first/second half), the matching pre-match
> projection, and a during-season **Finances screen** (cash runway, season ledger,
> recurring TV/sponsorship, build-vs-buy levers moved out of the market). All in
> Polish below. Deferred extras: pitch drag-and-drop, a tactics board. The
> handful of items still showing `[ ]`/`[~]` below are **deliberately parked**,
> not forgotten:
>   - **E.4.b — Title affordability**: a parent header; its children b.1–b.7 all
>     shipped. Effectively done.
>   - **E.3.c — Self-play `[~]`**: its outcome (policy-distilled rivals) shipped.
>   - **E.4.a — Balance / difficulty presets**: a *design decision*, not missing
>     code. E.6 measured the economy as no-bankruptcy / title-reachable and that
>     was accepted as the intended difficulty; presets are a "if we want knobs"
>     nice-to-have.
>   - **E.6 — RL CI regression guard `[~]`**: measurement done; only the optional
>     auto-run-on-finances-change CI wiring is open.
>   - **E.3.c — State championship**: long-standing `DEFERRED` scope-trap.
>
> Optional, off-roadmap follow-ups if we ever resume: a title-stronger RL policy
> to re-distill (rivals consolidate in Série A today), and syncing the gandula-rl
> harness to schema v10 (a training-dynamics decision, intentionally untouched).

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
- [x] **E.3.b — Calendar polish** · _S, web_ — **shipped.** Cup ties are now
  **two-legged** (home+away, decided on aggregate → away-goals → penalty
  shootout): `CupTie` carries `leg2`/`aggHome`/`aggAway`, `resolveTie` plays both
  legs from distinct leg seeds, schema bumped **v9→v10** (the v9→v10 migration
  re-derives the season's Copa as a deterministic two-leg replay). Evolved-
  strength seeding already landed with the rivals work (`buildCopa` ranks the
  composed/coached sides). The reveal animates both legs in sequence then shows
  the aggregate + AVANÇOU/ELIMINADO. (Determinism + bracket invariants covered by
  copa.test.ts.)
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
  - [x] **E.4.b.3 — More starting money** · _S, core_ — **Shipped.**
    `STARTING_MONEY` 1M → **2M** — funds a first strong buy without trivializing
    early survival. A one-time difficulty knob (doesn't compound like the
    prizes); gandula-rl (E.6) re-measures.
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
  - [x] **E.4.b.7 — Team momentum / form** · _M, core_ — **Shipped, tightly
    bounded.** A form multiplier from the user's last `FORM_WINDOW` (5) results
    (+0.05/win, −0.05/loss) applied to the **GATE ONLY**, clamped to
    **[0.9, 1.2]**, decaying toward 1.0. Crucially it does NOT touch the TV /
    sponsorship floors, so a skid dents matchday income but the floors keep the
    club solvent — drama without the death spiral the roadmap warns about. Read
    per-match (the run leading into each round), so the season gate still sums
    from the per-round gates. gandula-rl (E.6) tunes the bounds.

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
- [x] **E.4.c — Richer market (rare-elite tail)** · _M, core_ — **Shipped (the
  generator approach).** The free-agent generator now rolls a rare **elite tier**
  (`ELITE_AGENT_FRACTION` ~12%, attributes in [62,86] capped at
  `ELITE_ATTR_CAP` 92) on top of the common [30,70]+cap-85 roll — so the market
  carries the realistic tail of rare, expensive, title-grade players the old
  flat roll couldn't (free agents previously topped ~50–60 vs contenders' ~67–69
  XI). Deterministic in (seed, year); elites price up automatically via the
  avg²-based formula. Pairs with E.4.b — now a well-run, cash-rich club can
  actually out-build the top clubs. _(Still open: the full
  [gandula-import-sofifa](https://github.com/felipedbene/gandula-import-sofifa)
  path — real FC25 attribute distributions + stronger registry clubs — if the
  synthetic tail proves insufficient under the gandula-rl FIO A/B.)_

## E.5 — Teach solvency (where players actually lose)

- [x] **E.5.a — Cash-runway / wage-bill warning in the market** · _S, web_ —
  **shipped.** `projectSeasonRunway` (finances.ts) sums the rest-of-season
  per-round net (`roundCashDelta`) and surfaces a "Fôlego de caixa" panel in the
  market: remaining rounds, wage bill to season end, projected end balance, and a
  red overspend warning. Recomputes on every buy/sell, so the wage-bill impact
  shows before committing. Conservative (excludes placement/cup prizes).
- [x] **E.5.b — Career objectives** · _S, web_ — **shipped.** An "Objetivos da
  carreira" panel in the running season shows the tier-aware goal ladder
  (Série C/B: subir → [evitar rebaixamento] → chegar e vencer a Série A; Série A:
  ser campeão + permanecer), with live status (met / on-track / at-risk) read off
  the standings. Pure derivation (`objectivesFor`), no engine touch.

## E.6 — Tooling

- [~] **E.6 — RL eval as a balance-regression guard** · _S, core + CI_
  **Measured once (manual).** The gandula-rl harness was ported to the v9 /
  3-tier / full-economy game (3 divisions, Copa, stadium/fanbase/marketing/
  sponsorship/form on the 115-dim obs) and re-run. **Finding:** the E.4 economy
  decisively broke the old walls — greedy went from **91% fired / 4.7% title** to
  **0% fired / ~23% title** (from the harder Série-C start, half the horizon). A
  floor re-tune (TV/sponsorship/placement cut ~30–50%) barely moved it — greedy
  income is dominated by matchday (stadium×fanbase) + match/Copa bonuses + the
  cheap rare-elite market, not the structural floors. **Decision: accept the
  generous, no-bankruptcy economy as the intended design** (zero firings, title
  reachable in ~5–10 seasons) rather than chase solvency-as-skill, which would
  need a deeper matchday/bonus rebalance. Numbers + method in
  [gandula-rl/RESULTS.md](https://github.com/felipedbene/gandula-rl). _Still open:_
  wiring this as an automatic **CI regression guard** (re-run on finances
  changes, flag firing/title drift) and reporting peak/final `fanbase`.

## E.3.c — Self-play search (open)

E.3.a/b shipped (see Shipped). The open piece is learned per-club managers.

- [~] **E.3.c — Self-play search** · _L, core + training_
  Tune configs by simulated fitness (win rate), persist the winners. The
  research-y endgame; benefits from the now-richer E.2 world.

  _Reframed by gandula-rl, then DELIVERED via distillation._ A reactive
  MaskablePPO policy trains on this engine; the policy of record
  (`gandula-rl/models/maskppo_reshaped_probe`) reaches Série A in **98%** of
  careers and wins the title in **11%**, never fired. Rather than search the
  `ManagerConfig` space from scratch, we borrowed that policy:
  - [x] **E.3.c.1 / E.3.c.2 — Policy-distilled rivals** · _M, web_ — **shipped.**
    A probe (`gandula-rl/distill_probe.py`) ran the policy over 500 careers and
    distilled its per-tier behaviour to `gandula-rl/distill/rival_policy.json`
    (modal tactic + buy pattern). Those numbers are transcribed into
    `web/src/util/rival-coach.ts`, and `career.ts` `composeTeam` now applies the
    coach to every opponent each season (after aging/regen): a per-tier distilled
    **tactic** + a **stateless per-season transfer budget** → buy best-affordable
    squad upgrades. Rivals genuinely strengthen (~+2–3 avg overall vs aging-only)
    instead of only decaying. **Key architecture decision:** the policy learned
    season-level tactics + transfers, but the Rust `ManagerConfig` only governs
    in-match subs — so the distillation target is the **TS season-build path**,
    not the core. **No Rust/wasm change, no schema bump.** Budget depends only on
    (tier, seed, club, year) — never last season's finish — so the re-sim path
    (`resimulate.ts`) reconstructs the identical coached opponent and determinism
    holds. Season 0 stays the authored registry baseline (coach is a no-op at
    yearOffset 0).
  - Remaining (optional): rival **sells** (the probe showed sells were only
    roster-cap trims, not strategy — deferred); a title-stronger policy to
    distill (the current one consolidates in Série A — see gandula-rl RESULTS.md).

## Polish (small, slot in anytime)

- [x] **Live playback** · _S–M, web_ — running match clock landed earlier;
  **per-event pacing + highlights now shipped**: the reveal lingers on big
  moments (goals ~900ms, red cards / penalty awards ~650ms) before the next
  lance, and goals/red cards/penalties render larger with glyphs (◎ penalty, ✗
  miss). Purely presentational (MatchReveal.tsx) — no persistence/determinism
  impact.
- [x] **UI redesign — modern sporty dark UI** · _L, web_ — **shipped.** A
  presentational overhaul on `redesign/modern-sporty`, in independently-mergeable
  slices; no schema/determinism impact throughout. Slices:
  - **Foundation:** replaced the phosphor-green CRT theme with a "stadium night"
    dark theme — electric-blue accent + neutral ink ramp, rounded cards, a sticky
    blurred header, self-hosted **Inter** (UI) + **JetBrains Mono** (tabular data)
    via Fontsource (latin subset, no external font request).
  - **Team identity ("which team am I?"):** the controlled club's name in the
    header on every screen, a **"Seu time"** summary card + accent-bar/▸ row
    marker in the standings, and **deterministic generated crests** (two-tone
    shield + distinctive initials hashed from the name, since the world ships no
    badge data — `ui/TeamCrest.tsx`) in standings, scoreboard, opponent preview
    and other-match rows.
  - **State-driven scorelines:** leader's goals bright accent, loser dimmed, in
    both the live reveal and the round summary.
  - **Motion & feedback:** phase transitions (fade+slide, keyed remount), button
    loading states on the synchronous re-sim (Jogar/Aplicar, deferred a frame via
    rAF so the spinner paints), and a goal-pulse on the scoreboard. All respect
    `prefers-reduced-motion`.
  - **Mobile-native layout:** standings render as row-cards on phones (`hiddenFrom
    sm`) with the full stats `<Table>` on `sm`+; the running phase gets a fixed
    bottom action nav on mobile (the inline button row stays on desktop).
  - **Formation pitch** (`ui/FormationPitch.tsx`): a responsive portrait pitch
    (fixed 3:4, scales to width → same on phone/desktop) that groups the XI into
    position bands (FWD/MID/DEF/GK) — the honest layout, since `starting_xi` is 11
    ids with only a coarse Position and no stored slot mapping. Interactive in the
    lineup editor (tap a dot → same-position candidates → swap-perfect, mirroring
    `LineupEditor.swap`); read-only in PrepareView to scout the opponent's shape.
    Covered by `FormationPitch.test.tsx`.
  - _Deferred (later slice):_ pitch drag-and-drop, a tactics board with arrows.
- [x] **Half-time tactics** · _L, core + wasm + web_ — **shipped.** The user's
  match reveals in two halves with a real interval: it pauses at 45' on a closed
  scoreline, the player retunes the tactical dials for the second half, and an
  analytic projection (expected possession + per-side pressure, no projected
  score) updates live, already folding in the rival's symmetric per-tier
  response. Built as a 3-part sub-fio (PR #22):
  - **Engine split** — `simulate` becomes `simulate_first_half` (→ a
    serializable `HalfTimeSnapshot` carrying the full ChaCha8 RNG state incl.
    its u128 word_pos) + `simulate_second_half`, which resumes the EXACT stream
    (no re-seed). Proven byte-identical to the old one-shot by a property test
    over many seeds with a serde round-trip, a pinned penalty-at-45 case, and a
    real serde-wasm-bindgen round-trip test (`wasm-pack test --node`).
  - **Analytic projection** — `project_second_half` composes the SAME
    possession/event/shot helpers the live tick samples (extracted to
    `strength.rs` so engine and projection can't drift); RNG-free, monotonicity-
    tested. A 45' penalty is taken before the break (the one deliberate
    behaviour change; split↔one-shot equivalence preserved).
  - **Schema + UI** — schema **v10→v11** adds optional per-round
    `halftimeTactics`; `resimulateFromRound` replays the user's match in two
    phases so a re-sim / F5 reproduces the steered 90'. UI in `UserMatchReveal`
    + `HalftimePanel`, MatchReveal gaining a pause/resume seam at 45'.
- [x] **Pre-match projection** · _S, core + wasm + web_ — **shipped (PR #24).**
  The same analytic indicators (possession + per-side pressure) shown live in
  pre-match prep as the user edits tactics, from the kickoff state (no snapshot):
  `tick::kickoff_strength` + `project_match` reuse the shared helpers, so the
  projection can't drift from the engine; `current_strength` untouched → engine
  tests unchanged. `ProjectionIndicators` extracted and shared with
  `HalftimePanel`. Monotonicity + mirrored-symmetry tested.
- [x] **Finances screen** · _M, web_ — **shipped (PR #25).** A screen reachable
  during the running phase, surfacing what was locked in the between-seasons
  market: balance, the rest-of-season cash-runway projection, a season-to-date
  cash ledger (`seasonToDateLedger`: the 5 streams summed over played rounds,
  `net == Σ roundCashDelta` — anti-drift), the recurring TV + sponsorship floors,
  and stadium/fanbase with next-home demand vs. capacity (`matchDemand` /
  `nextHomeDemand`). The build-vs-buy levers (stadium expansion + marketing)
  **moved here** from the transfer market (now players-only); the screen is
  transactional with a draft + undo + confirm. `applyTransferAction` /
  `reverseTransferAction` extracted to one pure source shared by both screens.
  All finances.ts changes are pure additions — no behaviour moved.

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
8. ~~**E.3.c.1/E.3.c.2 — policy-distilled rivals**~~ ✓ shipped — credible
   opponents via the distilled gandula-rl policy (tactics + buy).
9. _Then:_ E.5.b objectives, Polish, (optional) a title-stronger policy to re-distill.

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
- **Platform** — Mantine UI (responsive, modern dark theme — see UI redesign
  under Polish; originally a phosphor-green CRT theme), tick-by-tick
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
