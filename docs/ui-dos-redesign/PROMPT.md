# Prompt for Claude Code — Gandula DOS UI redesign

Paste this into a fresh Claude Code session at the repo root. Don't truncate.

---

I want to redesign the web UI of this project (`web/`) to commit to a DOS /
Elifoot 98 aesthetic — green phosphor on dark background, CRT scanlines and
vignette, ASCII box-drawing characters for panels, reverse-video for active
tabs and buttons, VT323 font. The engine and all Rust code stay untouched.

Before you start coding, please read these two files in full:

1. `docs/ui-dos-redesign/DESIGN_NOTES.md` — the design brief with tokens,
   visual primitives, an explicit "what NOT to do" list, and a suggested
   phase order. This is the source of truth for the redesign.
2. `docs/ui-dos-redesign/mockup.html` — a standalone HTML file that is the
   target. Open it in a browser before and during the work. Your output
   should be visually indistinguishable from this mockup when running the
   same `seed=1998` Santos × Flamenguinho match.

Then read the current state of the web app:

- `web/src/App.tsx`
- `web/src/styles.css`
- `web/src/components/MatchView.tsx`
- `web/src/components/SeasonView.tsx`
- `web/index.html`

## Scope

You may modify:
- `web/src/styles.css` (will likely be a near-full rewrite)
- `web/src/App.tsx` and `web/src/components/*.tsx` (structural changes to
  wrap things in ASCII boxes, change tab/button markup, swap event glyphs)
- `web/index.html` (add the VT323 Google Fonts link)
- `web/src/components/AsciiBox.tsx` (new file — the reusable box component
  described in DESIGN_NOTES.md §5.2)

You must NOT modify:
- Anything in `core/`, `cli/`, `wasm/`, or `assets/`
- `web/src/teams.ts` or `web/src/types.ts`
- `web/vite.config.ts`, `tsconfig.json`, `package.json` (unless adding a
  truly necessary dep — but the redesign should need zero new deps)

## Process I want you to follow

1. **Read first, then plan.** Read all the files above, then write out a
   short plan (5–10 bullets) of the changes you'll make, in the phase order
   from DESIGN_NOTES.md. Show me the plan before touching code.
2. **Implement in phases.** Don't ship one giant diff. Do the tokens +
   envelope first, run `npm run dev`, and let me eyeball it. Then the
   `AsciiBox` component. Then the match view. Then the season view. Then
   the footer.
3. **Verify against the mockup.** After each phase, compare the running app
   to `mockup.html` and call out any drift. Don't invent flourishes that
   aren't in the mockup or the design notes. If something feels wrong but
   isn't documented, ask.
4. **Don't touch the engine.** If you find yourself wanting to change a
   Rust file or modify `types.ts` to make the UI easier, stop and ask first.
   The engine outputs are the input to this UI; format on the React side.

## Hard constraints (from DESIGN_NOTES.md §"What NOT to do")

- No `border-radius` anywhere.
- No CSS transitions or animations except the blinking cursor.
- No gradients, no drop-shadows on panels.
- No icons, SVGs, or emoji — typography only. Glyphs are characters.
- One font (VT323), no second font for headings.
- Fixed-width 80-column desktop layout. No mobile responsive in v1.

If you catch yourself violating any of these because "it looked better" —
that's exactly when not to.

## Done criteria

- `npm run dev` shows an app that reads as a DOS terminal program at first
  glance.
- Running Santos × Flamenguinho with seed 1998 produces a visual match to
  `mockup.html` (same scoreline 4×0, same event types styled the same way).
- The season tab renders the standings table inside an ASCII box with the
  leader highlighted.
- No Rust files changed. `cargo test` and the existing `./scripts/build-web.sh`
  output unchanged.
- `npm run build` succeeds and the bundle size hasn't blown up (≤ ~400 KB
  raw, similar gzipped to the current ~127 KB target mentioned in README).

Start by reading the files and giving me the plan.
