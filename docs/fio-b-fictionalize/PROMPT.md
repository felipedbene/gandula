# Prompt for Claude Code — Gandula Fictionalize tool

Paste this into a fresh Claude Code session. Recommended directory:
`~/Projects/` (NOT inside any existing repo — this creates a new one).

---

I want to create a new standalone Python CLI tool called `gandula-fictionalize`
in `~/Projects/gandula-fictionalize/`. It's a sibling to
`~/Projects/gandula-import-sofifa/` and follows the same conventions.

**Before you start coding, read these in full:**

1. `~/Projects/Gandula/docs/fio-b-fictionalize/DESIGN_NOTES.md` — the full
   design brief: algorithm, CLI surface, schemas, what NOT to do.
2. `~/Projects/Gandula/docs/fio-b-fictionalize/club_names.json` — the 30
   curated club names + procedural pools.
3. `~/Projects/Gandula/docs/fio-b-fictionalize/player_names.json` — first-name
   pools (3) + surnames pool.
4. `~/Projects/gandula-import-sofifa/README.md` — the upstream tool. Pay
   attention to the JSON output schema (the "Output schema" section), since
   the fictionalize tool consumes exactly that shape and emits exactly that
   shape with names swapped.
5. `~/Projects/gandula-import-sofifa/output/teams/flamengo.json` (or any one
   file in that folder) — to see a concrete example of the input shape.

## Goal

Build the tool described in DESIGN_NOTES.md. Specifically:

- A new repo at `~/Projects/gandula-fictionalize/` with the layout described
  in §"Repo conventions" of the design notes.
- A `fictionalize.py` CLI that implements the algorithm in §"Algorithm".
- The CLI surface in §"CLI surface" (the four modes).
- The output format in §"Schema of `_mapping.json`".
- A `_make_test_input.py` that generates a minimal synthetic input so the tool
  can self-test without running import-sofifa first.
- A `README.md` that points to DESIGN_NOTES.md for design rationale and gives
  quick-start instructions.

## Process I want you to follow

1. **Read first, then plan.** Read all the files above, then write a short
   plan (5–10 bullets) covering: directory structure, the hash function
   choice, the pool-loading approach, the CLI parsing approach (argparse vs
   click), and how you'll structure self-tests. Show me the plan before
   touching code.
2. **Build in phases.** Suggested order:
   - Phase 1: Repo skeleton + pools loading + stable hash function + unit
     test for determinism.
   - Phase 2: Club name picker + player name picker, with tests for
     "same seed → same name" and "collisions handled".
   - Phase 3: File-level pipeline (read input JSON → swap names → write
     output JSON + `_mapping.json`).
   - Phase 4: CLI wiring (--seed, --club, --use-manual, --dump-mapping).
   - Phase 5: `_make_test_input.py` + end-to-end self-test that doesn't
     require the upstream FC25 dataset.
3. **Show diffs at each phase boundary.** Don't ship a 500-line PR.
4. **Don't reach across into other repos.** This tool talks to the upstream
   only via JSON on disk. No Python imports of Gandula or import-sofifa.

## Hard constraints

- **Python 3.11+**, stdlib only (or `click` if you really want, but argparse
  is fine).
- **Determinism is non-negotiable.** Use `hashlib.sha256` truncated, or
  FNV-1a — NOT Python's built-in `hash()` (it's process-randomized).
- **Pools come from the JSON files in `Gandula/docs/fio-b-fictionalize/`.**
  Copy them into `gandula-fictionalize/pools/` as your starting content
  (don't symlink — these are owned files in the new repo from here on).
- **Output schema must round-trip cleanly.** A file produced by import-sofifa
  → fictionalize → opened by Gandula's `Team` deserializer must work without
  any field shape changes. The fictionalizer is a renaming layer, nothing more.
- **No Gandula code is modified by this task.** Not a single file under
  `~/Projects/Gandula/` changes. If you find yourself wanting to change
  something there, stop and ask.

## Done criteria

- `cd ~/Projects/gandula-fictionalize && python fictionalize.py --seed 1998`
  runs end-to-end on synthetic input from `_make_test_input.py`.
- Re-running with the same seed produces byte-identical output (verified by
  diff or hash).
- `--dump-mapping` produces a valid `_mapping.json` matching the schema in
  DESIGN_NOTES.md.
- A short manual smoke test: take 3 files from
  `~/Projects/gandula-import-sofifa/output/teams/` (e.g. `flamengo.json`,
  `palmeiras.json`, `real_madrid.json`), drop them in `input/`, run with
  seed 1998, and the output names match the curated list (`Flamenguinho FC`
  or similar, picked deterministically).
- README links to DESIGN_NOTES.md and explains the quick start.

Start by reading the files and giving me the plan.
