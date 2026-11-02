#!/usr/bin/env bash
# Builds the browser verifier (probe/neurals-wasm.cpp) with Emscripten against the pinned llama.cpp.
# Output: site/public/wasm/neurals-wasm.js and .wasm (served by the site).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HOME/neurals-build}"
CMAKE="${CMAKE:-$WORK/cmake/bin/cmake}"
source "$WORK/emsdk/emsdk_env.sh" >/dev/null 2>&1
BUILD="$WORK/wasm"
emcmake "$CMAKE" -S "$REPO/probe" -B "$BUILD" -DLLAMA_DIR="$WORK/llama.cpp" -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_WASM_MEM64=OFF -DGGML_WASM_SINGLE_FILE=OFF -DLLAMA_WASM_SINGLE_FILE=OFF -DGGML_OPENMP=OFF >/dev/null
nice -n 15 "$CMAKE" --build "$BUILD" -j "${JOBS:-4}" --target neurals-wasm
mkdir -p "$REPO/site/public/wasm"
cp "$BUILD/neurals-wasm.js" "$BUILD/neurals-wasm.wasm" "$REPO/site/public/wasm/"
ls -la "$REPO/site/public/wasm"
