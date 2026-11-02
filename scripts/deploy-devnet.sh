#!/usr/bin/env bash
# Deploys the Neurals program and the test curve to devnet (WSL or Linux, after `anchor build`).
# Payer: C:\Users\Admin\neurals-keys\payer-devnet.json, which needs about 5 devnet SOL
# (both programs' deposits, ~2.9 + ~1.9 SOL, plus fees). The program ids come from their keypairs:
# neurals-keys\program-devnet.json and neurals-keys\test-curve.json.
# Then: node tools/localnet-up.ts https://api.devnet.solana.com --payer <payer-devnet.json>
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="${KEYS:-/mnt/c/Users/Admin/neurals-keys}"
URL="${URL:-https://api.devnet.solana.com}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PAYER="$KEYS/payer-devnet.json"
echo "payer $(solana address -k "$PAYER"): $(solana balance -u "$URL" -k "$PAYER")"
solana program deploy -u "$URL" -k "$PAYER" --program-id "$KEYS/program-devnet.json" "$REPO/target/deploy/neurals.so"
solana program deploy -u "$URL" -k "$PAYER" --program-id "$KEYS/test-curve.json" "$REPO/target/deploy/test_curve.so"
echo "deployed: $(solana address -k "$KEYS/program-devnet.json") and $(solana address -k "$KEYS/test-curve.json")"
