#!/usr/bin/env bash
# Generate the 14-team fictionalized "Brasileirão Imaginário" from the real
# Brazilian club JSONs produced by gandula-import-sofifa.
#
# Pipeline:
#   gandula-import-sofifa/output/teams/{14 picks}.json
#     → gandula-fictionalize/input/
#     → fictionalize.py --seed 1998
#     → gandula-fictionalize/output/
#     → gandula/assets/teams/fictional/
#
# Idempotent: blows away gandula-fictionalize/{input,output}/ and the
# destination on each run. Run again with a different seed to reroll names.

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────
SEED=1998

# Repo paths (relative-from-this-script so we don't depend on $PWD).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GANDULA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="$(cd "$GANDULA_ROOT/.." && pwd)"

IMPORT_SOURCE="$PROJECTS_ROOT/gandula-import-sofifa/output/teams"
FICTIONALIZE_ROOT="$PROJECTS_ROOT/gandula-fictionalize"
DEST="$GANDULA_ROOT/assets/teams/fictional"

# The 14 Brazilian clubs present in the FC25 dataset, ranked by avg_overall
# (highest first). Filename stems as produced by gandula-import-sofifa —
# accents stripped, parens dropped, spaces underscored. Source: summary.csv
# entries with country=Brazilian, filtered to clubs whose names are
# unambiguously Brazilian (excludes mislabeled foreign clubs like CD Nacional,
# Santa Clara, AVS, Fenerbahçe, Real Madrid, etc).
CLUBS=(
  flamengo                # 76.38
  palmeiras               # 75.94
  atl_tico_mineiro        # 75.88
  botafogo                # 75.12
  internacional           # 74.44
  s_o_paulo               # 73.06
  fluminense              # 72.75
  cruzeiro                # 72.44
  bahia                   # 72.31
  gr_mio                  # 72.19
  corinthians             # 73.69
  fortaleza               # 71.31
  vasco_da_gama           # 70.19
  vit_ria                 # 69.75
)

# ─── Sanity checks ──────────────────────────────────────────────────────────
echo "→ Sanity checks"

if [ ! -d "$IMPORT_SOURCE" ]; then
  echo "ERROR: $IMPORT_SOURCE does not exist." >&2
  echo "Run gandula-import-sofifa first." >&2
  exit 1
fi

if [ ! -f "$FICTIONALIZE_ROOT/fictionalize.py" ]; then
  echo "ERROR: $FICTIONALIZE_ROOT/fictionalize.py not found." >&2
  exit 1
fi

# Verify each club JSON exists in import-sofifa output before doing anything.
missing=()
for club in "${CLUBS[@]}"; do
  if [ ! -f "$IMPORT_SOURCE/${club}.json" ]; then
    missing+=("$club")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: ${#missing[@]} club JSON(s) missing from $IMPORT_SOURCE:" >&2
  printf '  - %s.json\n' "${missing[@]}" >&2
  exit 1
fi
echo "  ✓ All ${#CLUBS[@]} source JSONs present in $IMPORT_SOURCE"

# ─── Reset fictionalize staging area ────────────────────────────────────────
echo "→ Resetting $FICTIONALIZE_ROOT/{input,output}/"
rm -rf "$FICTIONALIZE_ROOT/input" "$FICTIONALIZE_ROOT/output"
mkdir -p "$FICTIONALIZE_ROOT/input"

# ─── Copy the 14 picks into input/ ──────────────────────────────────────────
echo "→ Copying ${#CLUBS[@]} club JSONs into fictionalize input/"
for club in "${CLUBS[@]}"; do
  cp "$IMPORT_SOURCE/${club}.json" "$FICTIONALIZE_ROOT/input/"
done

# ─── Fictionalize ───────────────────────────────────────────────────────────
echo "→ Running fictionalize.py (seed $SEED)"
cd "$FICTIONALIZE_ROOT"
python3 fictionalize.py --seed "$SEED"
cd - > /dev/null

# ─── Verify output count ────────────────────────────────────────────────────
out_count=$(find "$FICTIONALIZE_ROOT/output" -maxdepth 1 -name '*.json' \
  -not -name '_mapping.json' | wc -l | tr -d ' ')
if [ "$out_count" -ne "${#CLUBS[@]}" ]; then
  echo "ERROR: expected ${#CLUBS[@]} output JSONs, got $out_count." >&2
  exit 1
fi
echo "  ✓ ${out_count} fictionalized JSONs produced"

# ─── Sync into the gandula repo ─────────────────────────────────────────────
echo "→ Copying fictional JSONs + _mapping.json into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$FICTIONALIZE_ROOT/output/"*.json "$DEST/"

# ─── Done ───────────────────────────────────────────────────────────────────
echo
echo "✓ Done. ${#CLUBS[@]} fictional teams + _mapping.json in:"
echo "  $DEST"
echo
echo "Inspect the mapping:"
echo "  cat \"$DEST/_mapping.json\" | python3 -m json.tool"
