#!/usr/bin/env bash
# Starts a fresh local validator with the Neurals program, the test curve and SPL Noop loaded at
# genesis (run in WSL or Linux after `anchor build`). Every start wipes the previous chain.
# The Noop program is fetched once from mainnet (read-only) into $WORK/noop.so.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HOME/neurals-build}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
mkdir -p "$WORK"
[ -f "$WORK/noop.so" ] || solana program dump -u https://api.mainnet-beta.solana.com noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV "$WORK/noop.so"
exec nice -n 15 solana-test-validator --reset --quiet --ledger "$WORK/test-ledger" \
  --bpf-program 9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR "$REPO/target/deploy/neurals.so" \
  --bpf-program D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8 "$REPO/target/deploy/test_curve.so" \
  --bpf-program noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV "$WORK/noop.so"
