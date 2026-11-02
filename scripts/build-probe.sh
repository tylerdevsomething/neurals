#!/usr/bin/env bash
# Builds probe/neurals-probe in WSL (or any Linux) against a pinned llama.cpp release.
# Needs git, a C++ compiler and cmake >= 3.16 (CMAKE=/path/to/cmake to use a local copy).
# Output: $BUILD/neurals-probe   (BUILD defaults to ~/neurals-build/probe)
set -euo pipefail
LLAMA_TAG=b12033
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HOME/neurals-build}"
BUILD="${BUILD:-$WORK/probe}"
CMAKE="${CMAKE:-cmake}"
mkdir -p "$WORK"
if [ ! -d "$WORK/llama.cpp" ]; then
  git clone -q --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$WORK/llama.cpp"
fi
[ "$(git -C "$WORK/llama.cpp" describe --tags --exact-match)" = "$LLAMA_TAG" ] || { echo "llama.cpp is not at $LLAMA_TAG"; exit 1; }
# Fixed CPU features (not -march=native), so every machine that runs it takes the same kernels.
"$CMAKE" -S "$REPO/probe" -B "$BUILD" -DLLAMA_DIR="$WORK/llama.cpp" -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_OPENMP=OFF >/dev/null
"$CMAKE" --build "$BUILD" -j "$(nproc)" --target neurals-probe
cp "$BUILD/neurals-probe" "$BUILD/../neurals-probe" 2>/dev/null || true
echo "built $BUILD/neurals-probe"
