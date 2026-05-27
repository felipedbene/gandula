# Gandula — Fio B: fictionalize

Standalone tool that turns the real-name JSONs from `gandula-import-sofifa`
into fictionalized JSONs that ship with the Gandula game. Sibling repo, sibling
filesystem, sibling philosophy.

## Why a separate tool

`gandula-import-sofifa` already does the right thing: it converts SoFIFA CSV
into Gandula-shaped JSONs while **preserving real names**. Its README states the
intent literally — *"A later 'fictionalization' tool renames players and clubs
before anything ships in the game; this tool intentionally preserves real names
so the two concerns stay separate."*

This doc is the design brief for that later tool.

## Repository layout

```
~/Projects/
├── Gandula/                  ← engine (untouched here, except assets/teams/)
├── gandula-import-sofifa/    ← real-name extraction (untouched)
└── gandula-fictionalize/     ← THIS TOOL (new repo)
```

The Gandula repo itself doesn't grow Python code. The two helper tools stay
isolated.

## Decisions (all approved 2026-05-26)

| Decision                       | Value                                            |
|--------------------------------|--------------------------------------------------|
| Club naming style              | Parafrastic-charming (Flamenguinho FC vibes)     |
| Player name format             | Nome + sobrenome (Tarsílio Almeida)              |
| Curated by                     | Claude proposed 30, Felipe approved v2           |
| Mapping determinism            | Same seed → same fictional name, always          |
| Fallback when curated runs out | Procedural prefix + locator pools                |
| Override mechanism             | Optional `mappings/manual.json`                  |
| Output schema                  | Identical to import-sofifa JSON (drop-in)        |

### Curated club names (in priority order)

See `club_names.json` in this folder for the canonical list. 30 names total:
20 Brazilian-flavored (Flamenguinho FC, Palmeiral EC, Botafagonia, etc), 10
international-flavored (Real Madri, Mancesteres United, etc). Order matters —
items higher in the list are picked first by the deterministic mapper.

### Player names

See `player_names.json` in this folder. Three first-name pools (common,
football-historical, interior/nostalgic) + one surname pool. Each generated
player gets first + last.

**Important narration constraint:** the match feed must continue to use
first-name-only (`"Tarsílio aproveita o passe de Antônio"`) so the 80-column
DOS layout doesn't break. Full name (`Tarsílio Almeida`) appears in rosters,
substitutions log entries, scorers list, and stats tables — places where the
extra width is OK or even welcome.

This means the engine's narration template strings stay unchanged. Only the
`Player.name` field in the JSON grows. If the engine currently does
`player.name.split()[0]` to get the first name for narration, perfect — that
already handles both formats. If it doesn't, that's a tiny change in the
narration layer (not in the engine math).

## Algorithm

### Club name picking

Input: real club name (e.g. `"Flamengo"`), seed (e.g. `1998`), session state.

```
def pick_club_name(real_name, seed, used_set, manual_override):
    # 1. Manual override wins.
    if real_name in manual_override:
        return manual_override[real_name]
    
    # 2. Deterministic hash → index into curated list.
    #    Skip names already used in this session.
    h = stable_hash(f"{seed}:{real_name}")
    for offset in range(len(CURATED)):
        candidate = CURATED[(h + offset) % len(CURATED)]
        if candidate not in used_set:
            used_set.add(candidate)
            return candidate
    
    # 3. Curated exhausted → procedural.
    #    Same hash trick over prefix × locator product.
    prefix = PREFIXES[h % len(PREFIXES)]
    locator = LOCATORS[(h >> 8) % len(LOCATORS)]
    candidate = f"{prefix} {locator}"
    # Add disambiguator if collision (rare).
    return candidate
```

Stable hash: SHA-256 truncated to 64 bits, or FNV-1a. **Not** Python's
`hash()` — that's randomized per process and breaks determinism across runs.

### Player name picking

Input: SoFIFA player ID (e.g. `200010`), seed.

```
def pick_player_name(player_id, seed):
    h1 = stable_hash(f"{seed}:player:{player_id}:first")
    h2 = stable_hash(f"{seed}:player:{player_id}:last")
    
    # First name: weighted across the three pools.
    # Weights pick a personality balance: 40% common, 30% football, 30% interior.
    pool = pick_weighted_pool(h1, weights=[0.4, 0.3, 0.3])
    first = pool[h1 % len(pool)]
    
    last = SURNAMES[h2 % len(SURNAMES)]
    
    return f"{first} {last}"
```

Notes:
- No "used_set" for players — collisions across players are fine (real squads
  have two Joãos all the time).
- Player IDs from `import-sofifa` are stable as long as the input CSV is stable
  (see its README §Idempotency). So `(seed, player_id)` is a stable pair across
  re-imports of updated FC25 data.

### File-level output

For each input JSON in `input/`:

1. Read the file (it's an `import-sofifa` output, schema in that repo's README).
2. Map the team's `name` → fictional club name.
3. Map each player in `roster[]`'s `name` → fictional player name.
4. Write the result to `output/{slug}.json`.
   - Filename slug uses the **fictional** name (so `flamengo.json` →
     `flamenguinho_fc.json`).
5. Write `output/_mapping.json` — the full real↔fictional dictionary for this
   run. This is the artifact Felipe versions in Gandula's `assets/leagues/`
   when he wants narrative continuity for a save.

Everything else in the JSON (IDs, attributes, positions, formation, tactics,
starting_xi, bench) is copied verbatim. The fictionalizer is a renaming layer,
nothing more.

## CLI surface

```bash
# Fictionalize everything in input/
fictionalize --seed 1998

# Just a few specific clubs
fictionalize --seed 1998 --club flamengo --club palmeiras --club real_madrid

# Apply a manual mappings file (real_name → fictional_name), then fall back
# to the deterministic picker for everything else.
fictionalize --seed 1998 --use-manual mappings/brasileirao_principal.json

# Just dump the mapping without writing JSONs (useful for inspection / curation)
fictionalize --seed 1998 --dump-mapping > out_mapping.json
```

## Schema of `_mapping.json`

```json
{
  "seed": 1998,
  "clubs": {
    "Flamengo": "Flamenguinho FC",
    "Palmeiras": "Palmeiral EC",
    "Real Madrid": "Real Madri"
  },
  "players": {
    "200010": "Tarsílio Almeida",
    "200016": "Antônio Costa"
  }
}
```

The shape is intentionally simple — flat dicts. Felipe can hand-edit this file
before re-running the fictionalizer if he wants to fix a specific name without
touching seeds.

Timestamp omitted because byte-identical rerun is the contract; recover via
`git log` or file mtime if you need to know when a mapping was generated.

## Idempotency

`(input/, seed, manual_overrides)` → byte-identical output. Same as
`import-sofifa`. This is the contract — keep it.

## Repo conventions (mirror import-sofifa)

- Python 3.11+
- `requirements.txt` empty or minimal (stdlib + maybe `click` for CLI)
- `input/` and `output/` are gitignored
- `pools/*.json` files are tracked (the curated content)
- README points to this DESIGN_NOTES.md for the "why"
- A `_make_test_input.py` script generates a synthetic test input so the tool
  can self-test without depending on import-sofifa being run first

## What NOT to do

- **Don't import Gandula or import-sofifa as Python deps.** Sibling repos,
  filesystem-only contracts. The JSON schema is the contract.
- **Don't try to be clever about "translating" names** (no "Hulk" → "Hulkão",
  no per-player heuristics). The point is breaking the link to real data, not
  preserving it.
- **Don't ship the SoFIFA dataset** in this repo. It stays in the upstream
  repo's `input/`, gitignored.
- **Don't write to Gandula's `assets/teams/`** directly. Output to
  `./output/`, let Felipe copy manually. Keeps the boundary clean.

## After this lands

Once `gandula-fictionalize` is working:

1. Felipe runs `gandula-import-sofifa` against the FC25 CSV → 600+ real-name JSONs.
2. Felipe runs `gandula-fictionalize --seed 1998` → 600+ fictional JSONs.
3. Felipe picks the 20 he wants for the imaginary Brasileirão, copies them
   into `Gandula/assets/teams/`, and adds an `assets/leagues/brasileirao_imaginario.json`
   league preset referencing those 20.
4. That league preset becomes the input for **Fio C** (round screen UI),
   which is the next track.

The `_mapping.json` from step 2 goes into `Gandula/assets/leagues/` alongside
the league preset, so the narrative continuity ("Hulk is Tarsílio in this
universe") is reproducible.
