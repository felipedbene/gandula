#!/usr/bin/env bash
# Cross-build all utilities for 68K and PowerPC classic Mac OS.
# Requires a built Retro68 toolchain; point RETRO68 at it, e.g.
#   RETRO68=~/Retro68-build/toolchain ./scripts/build-retro68.sh
set -eu

cd "$(dirname "$0")/.."

: "${RETRO68:?set RETRO68 to your Retro68-build/toolchain directory}"

M68K_TOOLCHAIN="$RETRO68/m68k-apple-macos/cmake/retro68.toolchain.cmake"
PPC_TOOLCHAIN="$RETRO68/powerpc-apple-macos/cmake/retroppc.toolchain.cmake"

if [ -f "$M68K_TOOLCHAIN" ]; then
    echo "== 68K build =="
    cmake -S . -B build-m68k -DCMAKE_TOOLCHAIN_FILE="$M68K_TOOLCHAIN"
    cmake --build build-m68k
else
    echo "skipping 68K: $M68K_TOOLCHAIN not found"
fi

if [ -f "$PPC_TOOLCHAIN" ]; then
    echo "== PowerPC build =="
    cmake -S . -B build-ppc -DCMAKE_TOOLCHAIN_FILE="$PPC_TOOLCHAIN"
    cmake --build build-ppc
else
    echo "skipping PowerPC: $PPC_TOOLCHAIN not found"
fi

echo "done. Look for per-tool .bin / .dsk / .APPL files in build-m68k/ and build-ppc/."
