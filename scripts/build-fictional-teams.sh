#!/usr/bin/env bash
# Generate the 60-team fictionalized "Brasileirão Imaginário" (Série A/B/C ×
# 20) from the FC25/SoFIFA Kaggle dataset.
#
# Pipeline (all inside the sibling gandula-import-sofifa repo):
#   new-players-data-full.csv  (Kaggle, gitignored — see that repo's README)
#     → adapt_fc25_csv.py    → input/players.csv   (granular skills → FIFA aggregates)
#     → import_sofifa.py     → output/teams/*.json  (~652 real clubs) + summary.csv
#     → fictionalize.py --count 60 --seed 1998 → output/fictional/*.json
#     → gandula/assets/teams/fictional/
#
# Picks the strongest 60 clubs by avg_overall, so divideIntoDivisions produces
# a clean monotonic talent gradient across the three tiers (locked by the
# world-fixture vitest). Run again with a different --seed to reroll names.
#
# NOTE: the original gandula-fictionalize repo was unavailable; adapt_fc25_csv.py
# and fictionalize.py now live in gandula-import-sofifa and are self-contained
# (deterministic, pandas-only). Same CSV + same seed → byte-identical output.

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────
SEED=1998
COUNT=60
CSV=new-players-data-full.csv

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GANDULA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="$(cd "$GANDULA_ROOT/.." && pwd)"

IMPORT_ROOT="$PROJECTS_ROOT/gandula-import-sofifa"
DEST="$GANDULA_ROOT/assets/teams/fictional"
PY="$IMPORT_ROOT/.venv/bin/python"
[ -x "$PY" ] || PY=python3

# ─── Sanity checks ──────────────────────────────────────────────────────────
echo "→ Sanity checks"
if [ ! -d "$IMPORT_ROOT" ]; then
  echo "ERROR: $IMPORT_ROOT does not exist." >&2
  echo "Clone git@github.com:felipedbene/gandula-import-sofifa.git next to gandula/." >&2
  exit 1
fi
if [ ! -f "$IMPORT_ROOT/$CSV" ]; then
  echo "ERROR: $IMPORT_ROOT/$CSV not found." >&2
  echo "Download the Kaggle 'EA Sports FC 25 + Real Player Data (SoFIFA Merge)' CSV." >&2
  exit 1
fi
echo "  ✓ import repo + CSV present"

cd "$IMPORT_ROOT"

# ─── Adapt → Import → Fictionalize ──────────────────────────────────────────
echo "→ Adapting CSV (granular skills → FIFA aggregates)"
"$PY" adapt_fc25_csv.py --input "$CSV" --out input/players.csv

echo "→ Importing teams"
"$PY" import_sofifa.py --input input/players.csv

echo "→ Fictionalizing top $COUNT clubs (seed $SEED)"
"$PY" fictionalize.py --count "$COUNT" --seed "$SEED"

# ─── Verify output count ────────────────────────────────────────────────────
out_count=$(find output/fictional -maxdepth 1 -name '*.json' \
  -not -name '_mapping.json' | wc -l | tr -d ' ')
if [ "$out_count" -ne "$COUNT" ]; then
  echo "ERROR: expected $COUNT output JSONs, got $out_count." >&2
  exit 1
fi
echo "  ✓ $out_count fictionalized JSONs produced"

# ─── Sync into the gandula repo ─────────────────────────────────────────────
echo "→ Copying fictional JSONs + _mapping.json into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp output/fictional/*.json "$DEST/"

echo
echo "✓ Done. $COUNT fictional teams + _mapping.json in:"
echo "  $DEST"
echo
echo "Inspect the mapping:"
echo "  cat \"$DEST/_mapping.json\" | python3 -m json.tool"
