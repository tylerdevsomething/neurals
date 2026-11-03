#!/usr/bin/env bash
# Deploys the Neurals program to MAINNET (WSL or Linux). Spends real SOL: about 3.7 SOL of rent for the
# program's 522 KB, held while the program exists, plus fees. LAUNCH.md step 3.
#
#   CONFIRM_MAINNET=yes DEPLOYER=<deployer.json> PROGRAM_KEY=<program-address.json> \
#     RPC=<mainnet rpc url> bash scripts/deploy-mainnet.sh
#
# It deploys out/mainnet/neurals.so (built without the devnet feature: 9,000-slot challenge window)
# and refuses anything else: the file's sha256 must match deploy/neurals.mainnet.so.sha256, recorded when
# the build was checked. The deployer becomes the upgrade authority, so it alone can initialize the
# program; hand both roles to the multisig afterwards (LAUNCH.md step 8).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ "${CONFIRM_MAINNET:-}" = "yes" ] || { echo "refusing: set CONFIRM_MAINNET=yes (this spends real SOL)"; exit 2; }
: "${DEPLOYER:?set DEPLOYER to the deployer keypair}" "${PROGRAM_KEY:?set PROGRAM_KEY to the program address keypair}" "${RPC:?set RPC to a mainnet RPC url}"
SO="$REPO/out/mainnet/neurals.so"
WANT="$(cut -d" " -f1 "$REPO/deploy/neurals.mainnet.so.sha256")"
HAVE="$(sha256sum "$SO" | cut -d' ' -f1)"
[ "$WANT" = "$HAVE" ] || { echo "refusing: $SO is not the checked mainnet build ($HAVE, want $WANT)"; exit 1; }
GENESIS="$(solana genesis-hash -u "$RPC")"
[ "$GENESIS" = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ] || { echo "refusing: $RPC is not mainnet (genesis $GENESIS)"; exit 1; }
echo "program  $(solana address -k "$PROGRAM_KEY")"
echo "deployer $(solana address -k "$DEPLOYER"): $(solana balance -u "$RPC" -k "$DEPLOYER")"
echo "code     $SO ($HAVE)"
read -r -p "type DEPLOY to deploy to mainnet: " answer
[ "$answer" = "DEPLOY" ] || { echo "not deployed"; exit 1; }
solana program deploy -u "$RPC" -k "$DEPLOYER" --program-id "$PROGRAM_KEY" --upgrade-authority "$DEPLOYER" \
  --with-compute-unit-price 50000 --max-sign-attempts 50 "$SO"
solana program show -u "$RPC" "$(solana address -k "$PROGRAM_KEY")"
