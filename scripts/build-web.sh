#!/usr/bin/env bash
# Build the WASM module and prepare the web app for `npm run dev` / build.
# Run from the repo root.

set -euo pipefail

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
