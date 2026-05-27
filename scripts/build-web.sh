#!/usr/bin/env bash
# Build the WASM module and prepare the web app for `npm run dev` / build.
# Run from the repo root.

set -euo pipefail

# Prefer the rustup-managed toolchain over a Homebrew-installed rustc that
# may lack the wasm32-unknown-unknown target. Without this, wasm-pack picks
# up /opt/homebrew/bin/rustc first (if present) and fails with
# "wasm32-unknown-unknown target not found in sysroot".
export PATH="$HOME/.cargo/bin:$PATH"

cd "$(dirname "$0")/.."

# 1. Compile the wasm crate to a web-target ES module.
wasm-pack build wasm --target web --out-dir ../web/src/wasm

# 2. Install JS deps if missing.
if [ ! -d web/node_modules ]; then
  (cd web && npm install)
fi

echo
echo "Build pronto. Próximos passos:"
echo "  cd web && npm run dev      # servidor de desenvolvimento"
echo "  cd web && npm run build    # bundle de produção em web/dist/"
