#!/usr/bin/env bash
# One-shot, idempotent dev-environment bootstrap for Gandula.
#
# Brings a bare machine to "can build + test the web app and the engine":
#   1. Rust (rustup) + the wasm32-unknown-unknown target
#   2. wasm-pack
#   3. Node (via nvm) at the version CI uses
#   4. builds the wasm module into web/src/wasm/
#   5. installs the web npm deps
#
# Safe to re-run: every step checks for what it needs and skips work already
# done. Installs into your home dir (rustup, nvm) — no root, and it sidesteps
# package-manager friction on immutable OSes (Bazzite/Silverblue/etc.) where a
# system install would need a layered package + reboot.
#
# Usage:
#   ./scripts/setup-dev.sh            # full setup
#   ./scripts/setup-dev.sh --no-deps  # toolchain + wasm only, skip `npm ci`
#   SKIP_RUST=1 ./scripts/setup-dev.sh   # assume Rust is already present
#
# After it finishes, open a new shell (or source the lines it prints) so
# cargo/nvm are on PATH permanently.

set -euo pipefail

NODE_MAJOR=24            # keep in sync with .github/workflows/deploy.yml
NVM_VERSION=v0.40.1
INSTALL_DEPS=1
for arg in "$@"; do
  case "$arg" in
    --no-deps) INSTALL_DEPS=0 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Pretty, dependency-free logging.
if [ -t 1 ]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
else BOLD=; GREEN=; YELLOW=; DIM=; RST=; fi
step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RST"; }
ok()   { printf '%s    ✓ %s%s\n' "$GREEN" "$1" "$RST"; }
note() { printf '%s    %s%s\n' "$DIM" "$1" "$RST"; }
warn() { printf '%s    ! %s%s\n' "$YELLOW" "$1" "$RST"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. Rust + wasm32 target
# ---------------------------------------------------------------------------
step "Rust toolchain (rustup) + wasm32-unknown-unknown target"
# Prefer the rustup-managed toolchain over any system/Homebrew rustc that may
# lack the wasm target (same reason build-web.sh front-loads ~/.cargo/bin).
export PATH="$HOME/.cargo/bin:$PATH"
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi

if [ "${SKIP_RUST:-0}" = "1" ]; then
  note "SKIP_RUST=1 set — assuming Rust is already installed"
elif have rustup || have cargo; then
  ok "rust present ($(rustc --version 2>/dev/null || echo 'cargo only'))"
else
  note "installing rustup (minimal profile)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
  . "$HOME/.cargo/env"
  ok "rustup installed"
fi

# Ensure the wasm target exists even if rustup was already present.
if have rustup; then
  if rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
    ok "wasm32-unknown-unknown target present"
  else
    note "adding wasm32-unknown-unknown target…"
    rustup target add wasm32-unknown-unknown
    ok "wasm target added"
  fi
fi

# ---------------------------------------------------------------------------
# 2. wasm-pack
# ---------------------------------------------------------------------------
step "wasm-pack"
if have wasm-pack; then
  ok "wasm-pack present ($(wasm-pack --version))"
else
  note "installing wasm-pack via cargo (one-time compile, ~1 min)…"
  cargo install wasm-pack
  ok "wasm-pack installed"
fi

# ---------------------------------------------------------------------------
# 3. Node via nvm
# ---------------------------------------------------------------------------
step "Node $NODE_MAJOR (via nvm)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
load_nvm() { [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; }

current_node_major() { have node && node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }

if [ "$(current_node_major)" = "$NODE_MAJOR" ]; then
  ok "node $(node -v) already active"
else
  load_nvm
  if ! have nvm && ! type nvm >/dev/null 2>&1; then
    note "installing nvm $NVM_VERSION…"
    curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
    load_nvm
  fi
  if type nvm >/dev/null 2>&1; then
    note "installing node $NODE_MAJOR…"
    nvm install "$NODE_MAJOR"
    nvm alias default "$NODE_MAJOR" >/dev/null
    nvm use "$NODE_MAJOR" >/dev/null
    ok "node $(node -v) active"
  else
    warn "nvm not loadable in this shell; skipping Node. Install Node $NODE_MAJOR manually."
  fi
fi

# ---------------------------------------------------------------------------
# 4. Build the wasm module
# ---------------------------------------------------------------------------
step "Build wasm module → web/src/wasm/"
wasm-pack build wasm --target web --out-dir ../web/src/wasm
ok "wasm module built"

# ---------------------------------------------------------------------------
# 5. Web npm deps
# ---------------------------------------------------------------------------
if [ "$INSTALL_DEPS" = "1" ]; then
  step "Install web npm deps"
  if have npm; then
    # `npm ci` is reproducible but needs a lockfile; fall back to install.
    if [ -f web/package-lock.json ]; then (cd web && npm ci); else (cd web && npm install); fi
    ok "npm deps installed"
  else
    warn "npm not on PATH — open a new shell (nvm) and run: cd web && npm ci"
  fi
else
  note "--no-deps: skipping npm install"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
printf '\n%s✓ Dev environment ready.%s\n' "$BOLD$GREEN" "$RST"
cat <<EOF

${BOLD}Next steps${RST}
  ${DIM}# if cargo/nvm aren't on PATH in this shell yet:${RST}
  . "\$HOME/.cargo/env"
  export NVM_DIR="\$HOME/.nvm"; . "\$NVM_DIR/nvm.sh"

  cd web && npm run dev        ${DIM}# hot-reload dev server → http://localhost:5173/${RST}
  cd web && npm run test:run   ${DIM}# JS test suite${RST}
  cargo test                   ${DIM}# engine determinism + sanity tests${RST}

${DIM}Re-run this script any time; it skips work already done. After changing
core/ or wasm/, rebuild the module with ./scripts/build-web.sh.${RST}
EOF
