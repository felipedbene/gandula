#!/usr/bin/env bash
# Bump the project version in lockstep across every place it lives:
#   - Cargo.toml            ([workspace.package].version → core/cli/wasm)
#   - web/package.json      (drives the UI footer via __APP_VERSION__)
#   - Cargo.lock            (the three workspace crates)
#   - web/package-lock.json
#
# This is the single source of truth for "what version are we". release-please
# normally drives the bump from conventional commits (see .github/workflows/
# release-please.yml); this script is the manual companion for a one-off bump or
# to re-sync the files if they ever drift.
#
# Usage:
#   ./scripts/bump-version.sh patch        # 1.1.0 → 1.1.1
#   ./scripts/bump-version.sh minor        # 1.1.0 → 1.2.0
#   ./scripts/bump-version.sh major        # 1.1.0 → 2.0.0
#   ./scripts/bump-version.sh 1.4.2        # set an explicit version
#   ./scripts/bump-version.sh --check      # print current version, change nothing

set -euo pipefail
cd "$(dirname "$0")/.."

PKG=web/package.json
CARGO=Cargo.toml

# Make cargo/npm reachable even from a fresh shell (rustup + nvm live in $HOME).
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

current() { sed -nE '0,/"version":/ s/.*"version": *"([^"]+)".*/\1/p' "$PKG"; }

CUR="$(current)"
[ -n "$CUR" ] || { echo "error: could not read current version from $PKG" >&2; exit 1; }

ARG="${1:-}"
if [ -z "$ARG" ] || [ "$ARG" = "-h" ] || [ "$ARG" = "--help" ]; then
  sed -n '2,18p' "$0"; exit 0
fi
if [ "$ARG" = "--check" ]; then
  echo "current version: $CUR"; exit 0
fi

IFS=. read -r MA MI PA <<EOF
$CUR
EOF
case "$ARG" in
  major) NEW="$((MA + 1)).0.0" ;;
  minor) NEW="${MA}.$((MI + 1)).0" ;;
  patch) NEW="${MA}.${MI}.$((PA + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*) NEW="$ARG" ;;
  *) echo "error: expected patch|minor|major|X.Y.Z, got '$ARG'" >&2; exit 2 ;;
esac

echo "Bumping $CUR → $NEW"

# 1. web/package.json — first "version" key only (the package's own).
sed -i -E "0,/\"version\":/ s/(\"version\": *\")[^\"]+\"/\1$NEW\"/" "$PKG"
echo "  ✓ $PKG"

# 2. Cargo.toml — the version inside [workspace.package] only (not dep versions).
awk -v new="$NEW" '
  /^\[/ { inpkg = ($0 ~ /^\[workspace\.package\]/) }
  inpkg && /^version *=/ { sub(/"[^"]+"/, "\"" new "\""); inpkg = 0 }
  { print }
' "$CARGO" > "$CARGO.tmp" && mv "$CARGO.tmp" "$CARGO"
echo "  ✓ $CARGO"

# 3. Cargo.lock — re-resolve the three workspace crates to the new version.
if command -v cargo >/dev/null 2>&1; then
  cargo update -p gandula-core -p gandula-cli -p gandula-wasm >/dev/null 2>&1 \
    && echo "  ✓ Cargo.lock" || echo "  ! Cargo.lock not updated (cargo update failed)"
else
  echo "  ! cargo not found — Cargo.lock not synced (regenerated on next build)"
fi

# 4. web/package-lock.json — sync without a full install.
if command -v npm >/dev/null 2>&1; then
  ( cd web && npm install --package-lock-only >/dev/null 2>&1 ) \
    && echo "  ✓ web/package-lock.json" || echo "  ! package-lock.json not updated"
else
  echo "  ! npm not found — web/package-lock.json not synced"
fi

echo "Done. Review with: git diff -- $PKG $CARGO Cargo.lock web/package-lock.json"
