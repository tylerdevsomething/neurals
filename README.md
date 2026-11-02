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
node tools/devnet-payout.ts                                      # a paid message, settlement, exact payouts
```

Deployed on devnet: the Neurals program `9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR` and the test curve
`D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8`. The public devnet RPC throttles sends: inscribing the
full model needs a paid RPC.

## Online (devnet)

- Site and indexer: https://neurals-production.up.railway.app (API at `/api`)
- Brain: https://brain-production-ec65.up.railway.app (`POST /chat`)
- Check a receipt: `#/receipt/<hash>/<signature>` on the site, `node tools/check-receipt.ts <hash> <signature>`,
  or replay it with the model: `node tools/verify-receipt.ts <hash> --indexer https://neurals-production.up.railway.app/api`

Redeploy: `railway up --service neurals` (indexer and site); `bash scripts/stage-brain.sh && railway up out/brain-deploy --path-as-root --service brain`.

## Hosting

Two services, both from this repo (Railway builds `Dockerfile` per `railway.json`):

| Service | Image | Serves | Environment |
|---|---|---|---|
| Indexer + site | `Dockerfile` | the website at `/`, the API at `/api`, the settler | `RPC_URL` (private RPC, never shown to browsers), `SETTLER_KEY` (keypair JSON), `INDEXER_CONFIG` (default `deploy/indexer.devnet.json`), a volume at `/data` |
| Brain | `Dockerfile.brain` | `/chat` | `PAYER_KEY` (keypair JSON), `INDEXER_URL`, `RPC_URL`, a volume at `/data` (the model is fetched there on first start and hash-checked) |

Secrets are never in the images, the configs or the repo. Locally, the same works without Docker:

```sh
npm run site:build
RPC_URL=<private rpc> PORT=8080 STATIC_DIR=site/dist DATA_DIR=out/hosted node indexer/main.ts deploy/indexer.devnet.json
```

## Mainnet launch (checklist; nothing here has been run on mainnet)

Before launch day:
1. Set the treasury wallet (a multisig), the settler and admin keys.
2. Deploy the program and initialize it (admin, treasury, 1.5% fee, settler); hand upgrade authority to the multisig.
3. Inscribe the model, runtime and rules (`tools/inscribe.ts` through a paid RPC); publish the brain address.
4. Measure traits (`neurals-traits`, then `tools/traits.ts --deadline <slot>`) and post the commit memo (`tools/commit.ts --post`).
5. Host the indexer, brain and site.

The moment:
6. Start `node tools/launch.ts --rpc <rpc> --creator <creator wallet> --admin-key <admin.json> --config <indexer.json>`,
   then create the token on pump.fun from the creator wallet. It records the mint (`set_mint`) and writes the
   indexer config; start the indexer with it.

After the sellout or the deadline:
7. `node tools/reveal.ts <rules> --sold-out-slot <slot> --out reveal.json`; post the reveal memo; set
   `rulesFile` and `revealFile` in the indexer config.

## Checks against reality

- `node tools/pump-check.ts 150` runs the decoder on real pump.fun mainnet transactions (read-only).
- `node tools/determinism.ts` checks receipts reproduce across runs and thread counts. Rerun it on a
  machine without CPU faults (SPEC §7, milestone 1).
