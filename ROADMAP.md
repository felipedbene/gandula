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
- [ ] **E.2.a.2 — League-wide aging** · _M, web_
  Extend aging to opponents. They reset to the registry each season today, so
  this needs per-team evolving rosters (persist them, or recompute from a base
  age + elapsed seasons). Makes the whole world age, not just you.
- [ ] **E.2.b — Youth / regen** · _M, web_
  Young players entering the pool / an academy, so squads (and eventually the
  league) refresh rather than only decline.

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
4. **E.2.a.2 league-wide aging** or **E.2.b youth/regen** — finish the living
   world (contained, web). ← next
5. **E.3 — self-play AI** — last; biggest (Rust + training), benefits from a
   richer E.2 world + the `Manager`-trait extraction.

Dependencies: league-wide aging ← per-team roster state · self-play ←
`Manager`-trait extraction + ideally E.2.
