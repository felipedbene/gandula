# Roadmap

Forward-looking plan for Gandula. Effort tags: **S** small, **M** medium,
**L** large. Items are grouped by epic; the suggested order is at the bottom.

## Shipped

- **E.1.a–e** — career mode: two divisions (Série A/B), promotion/relegation,
  the `Career` schema (currently v5) + in-place migrations, the finances layer,
  and the transfer market.
- **Platform** — Mantine UI (responsive, dark phosphor theme), tick-by-tick
  match reveal with a running clock, randomized new careers (random Série B
  club + random seed), and GitHub Actions CI/CD (build wasm → test → deploy).

## E.1 — Career loop (closing out)

- [ ] **E.1.f — Manager firing** · _S, web-only_
  Go to a "fired" / game-over state when finances run dry. Builds entirely on
  the existing finances layer (`manager.money`, `computeSeasonFinances`) — no
  engine changes. Open UX decision: what the fired state looks like (a
  post-mortem screen → new career? a summary of what went wrong?).

## E.2 — Living world (players age & evolve)

- [ ] **E.2.a — Aging** · _M, core + wasm + web_
  Age++ per season and drift attributes along an age curve (peak years, decline
  for veterans). Must stay seed-deterministic, so it lives in `core` behind the
  RNG. Makes multi-season careers actually feel different.
- [ ] **E.2.b — Regen / youth (or form)** · _M, core_
  Optional follow-up so rosters refresh as veterans decline — otherwise the
  league strength slowly bleeds out.

## E.3 — Smarter opponents

- [ ] **Self-play rival managers** · _L, core + training_
  Learned per-club strategies instead of the single shared heuristic. Wants the
  `Manager` trait extraction that `ARCHITECTURE.md` already flags as
  "Phase ≥ 4 territory", and benefits from a richer world (E.2). The most
  ambitious item — research-y, do it last.

## Polish (small, slot in anytime)

- [ ] **Scout reports** · _S, web-only_
  Richer free-agent browsing layered on top of the transfer market (attributes,
  comparisons, recommendations).
- [~] **Live playback** · _S–M, web_
  Keep extending the reveal ticker. Partially done — the running match clock
  landed with the reveal-pacing work.

## Suggested order

1. **E.1.f — manager firing** — cheap, adds real stakes, closes the E.1 arc.
2. **Scout reports** — quick web-only win.
3. **E.2.a — aging** — deepens multi-season play.
4. **Live playback** — polish on the reveal.
5. **E.3 — self-play AI** — last; biggest, and benefits from E.2 + the
   `Manager` trait extraction.

Dependencies: E.1.f ← finances (done) · scout reports ← transfer market (done)
· self-play ← `Manager`-trait extraction + ideally E.2 (a richer world to play
against).
