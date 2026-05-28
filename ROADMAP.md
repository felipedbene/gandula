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
- **Platform** — Mantine UI (responsive, dark phosphor theme), tick-by-tick
  match reveal with a running clock (on bye rounds too), randomized new careers
  (random Série B club + random seed), and GitHub Actions CI/CD (build wasm →
  test → deploy).

## E.2 — Living world (players age & evolve) ← next

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

- [~] **Live playback** · _S–M, web_
  Running match clock during the reveal landed (incl. bye rounds). Further
  playback polish (per-event pacing tweaks, highlights) can still be layered on.

## Suggested order

1. ~~E.1.f — manager firing~~ ✓ shipped (with per-round finances + mid-season market)
2. ~~Scout reports~~ ✓ shipped
3. **E.2.a — aging** — deepens multi-season play. ← next
4. **E.3 — self-play AI** — last; biggest, and benefits from E.2 + the
   `Manager` trait extraction.

Dependencies: aging ← stays deterministic in `core` · self-play ←
`Manager`-trait extraction + ideally E.2.
