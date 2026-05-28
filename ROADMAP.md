# Roadmap

Forward-looking plan for Gandula. Effort tags: **S** small, **M** medium,
**L** large. Items are grouped by epic; the suggested order is at the bottom.

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
- **E.2.a — Aging (your squad)** — players age +1/season and attributes drift
  along a curve (young develop, prime plateaus, veterans decline). Deterministic,
  web-only (the engine ignores age, so it rides on attributes). Scope: only the
  user's squad for now; opponents stay registry-default.
- **Platform** — Mantine UI (responsive, dark phosphor theme), tick-by-tick
  match reveal with a running clock (on bye rounds too), randomized new careers
  (random Série B club + random seed), and GitHub Actions CI/CD (build wasm →
  test → deploy).

## E.2 — Living world (players age & evolve)

- [x] **E.2.a — Aging (your squad)** · _M, web_ — shipped (see above).
- [x] **E.2.a.2 — League-wide aging** · _M, web_ — shipped: opponents aged on
  the fly by elapsed seasons (recompute from registry base, no per-team state).
- [x] **E.2.b — Youth / regen (opponents)** · _M, web_ — shipped: AI clubs
  retire ≥36 + intake youth + rebuild a valid XI each season (evolveTeam), so
  the league refreshes instead of decaying. The user refreshes via the market.
  (A visible youth academy for the user is a possible later add.)

## E.3 — Smarter opponents

- [ ] **Self-play rival managers** · _L, core + training_
  Learned per-club strategies instead of the single shared heuristic. Wants the
  `Manager` trait extraction that `ARCHITECTURE.md` already flags as
  "Phase ≥ 4 territory", and benefits from a richer world (E.2). The most
  ambitious item — research-y, do it last.

## Polish (small, slot in anytime)

- [~] **Live playback** · _S–M, web_
  Running match clock during the reveal landed (incl. bye rounds). Further
  playback polish (per-event pacing tweaks, highlights) can still be layered on.

## Suggested order

1. ~~E.1.f — manager firing~~ ✓ shipped (with per-round finances + mid-season market)
2. ~~Scout reports~~ ✓ shipped
3. ~~E.2.a — aging (your squad)~~ ✓ shipped
4. ~~E.2.a.2 — league-wide aging~~ ✓ shipped
5. ~~E.2.b — youth / regen (opponents)~~ ✓ shipped — E.2 living world complete
6. **E.3 — self-play AI** — last; biggest (Rust + training), benefits from the
   now-richer E.2 world + the `Manager`-trait extraction. ← next

Dependencies: self-play ← `Manager`-trait extraction + ideally E.2.
