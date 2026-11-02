# Neurals

An AI brain written byte for byte onto Solana. Its neurons are numbered and owned through a
pump.fun token, and every paid thought pays the neurons that fired.

Rules: [SPEC.md](SPEC.md), the single source of truth.

## What is where

| Path | What |
|---|---|
| `brain/model.ts` | The brain's shape and the sale's units: 3,000 tokens per neuron, 1,318 segments (SPEC §2–3) |
| `brain/layout.ts` | Slots (curve positions in buying order), parts (real pieces of the model), the reveal's permutation |
| `brain/receipt.ts` | Activation masses → ppm fee shares, receipt hash and check (SPEC §7) |
| `brain/ranges.ts` | Sets of curve positions; which neurons stay awake (rarest first) |
| `brain/ledger.ts` | Ownership ledger: curve buys, dormant and wake, checkpoints, carry, epoch fee settlement (SPEC §5, §7) |
| `brain/program.ts` | The program's instruction interface: names, Borsh arguments, account order (shared by program, decoder, site) |
| `brain/decoder.ts` | Finalized transactions → ledger events; wallet balance totals |
| `brain/accounts.ts` | PDAs and instruction builders |
| `brain/claims.ts` | Each epoch's payouts as a Merkle tree; proofs |
| `brain/reveal.ts` | The rules file, commit and reveal memos, the seed block and the checked reveal (SPEC §6) |
| `brain/inscribe.ts` | Writing the brain's files on chain as 960-byte chunks and reading them back |
| `programs/neurals` | Anchor program: checkpoints, carry, fee pool, epoch roots and claims |
| `programs/test-curve` | A stand-in for pump.fun's curve, for localnet and devnet rehearsals |
| `probe/neurals-probe` | Runs the brain on llama.cpp and measures how much each part fired (receipts) |
| `probe/neurals-traits` | Measures the traits on the exact model file (SPEC §4) |
| `indexer/` | Follows the chain, keeps the ledger, settles epochs, posts roots and pushes payouts, serves the API |
| `brainserver/` | The hosted brain: chat, receipts, fee payments |
| `site/` | The website: brain map, slots, my neurons, market, chat, rules |
| `rules/` | The reference text the traits are measured on; the rules draft |
| `tools/` | Rehearsal, launch, commit, reveal, traits, receipt verifier, real-transaction check, names check |

## Development

Node ≥ 23.6 runs the TypeScript directly; no build step.

```sh
npm install
npm test                 # unit tests
npm run typecheck
npm run site:typecheck
npm run names            # before every commit: no other project's names in the repo
```

## Building (WSL or Linux)

```sh
bash scripts/fetch-model.sh                 # models/qwen2.5-1.5b-instruct-q4_k_m.gguf (~1.1 GB), hash checked
bash scripts/build-probe.sh                 # llama.cpp b12033 + neurals-probe and neurals-traits
anchor build                                # programs/neurals and programs/test-curve
cargo test -p neurals --lib                 # program unit tests
```

Program keypairs live outside the repo, in `C:\Users\Admin\neurals-keys\`; Anchor expects copies in
`target/deploy/` (git-ignored).

## Running everything locally

```sh
bash scripts/localnet.sh                    # WSL: a fresh validator with the three programs at genesis
node tools/rehearse.ts                      # the whole system end to end, with checks
```

Or a long-running local stack to click around in:

```sh
bash scripts/localnet.sh                    # WSL, fresh validator
node tools/localnet-up.ts                   # launch the token, demo buys, configs in out/localnet/
node indexer/main.ts out/localnet/indexer.json
node brainserver/server.ts out/localnet/brain.json
npm run site                                # http://localhost:5173
node tools/verify-receipt.ts <receipt hash> # replay any paid message's receipt
```

## Traits, commit and reveal

```sh
~/neurals-build/probe/neurals-traits -m models/qwen2.5-1.5b-instruct-q4_k_m.gguf -f rules/reference.txt -t 2 > out/traits-raw.json
node tools/traits.ts out/traits-raw.json --deadline <slot>      # rules/neurals-v1.draft.json
node tools/commit.ts rules/neurals-v1.draft.json --post --key <reveal-authority.json> --rpc <url>
# after the sellout (or the deadline):
node tools/reveal.ts rules/neurals-v1.draft.json --sold-out-slot <slot> --out reveal.json --rpc <url>
```

The indexer applies the reveal only if it matches the committed rules and the seed block on chain.

## Devnet

The devnet RPC faucet is closed: fund `payer-devnet.json` (about 5 SOL) from the web faucet, then:

```sh
bash scripts/deploy-devnet.sh                                    # WSL: both programs
node tools/localnet-up.ts https://api.devnet.solana.com --payer C:/Users/Admin/neurals-keys/payer-devnet.json
node indexer/main.ts out/devnet/indexer.json
```

## Checks against reality

- `node tools/pump-check.ts 150` runs the decoder on real pump.fun mainnet transactions (read-only).
- `node tools/determinism.ts` checks receipts reproduce across runs and thread counts. Rerun it on a
  machine without CPU faults (SPEC §7, milestone 1).
