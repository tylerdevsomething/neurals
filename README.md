# Neurals

An AI brain written byte for byte onto Solana. Its neurons are numbered and owned through a
pump.fun token, and every paid thought pays the neurons that fired.

Rules: [SPEC.md](SPEC.md), the single source of truth.

| Path | What |
|---|---|
| `brain/model.ts` | The brain's shape and the sale's units: 3,000 tokens per neuron, 1,318 segments (SPEC §2–3) |
| `brain/layout.ts` | Slots (curve positions in buying order), parts (real pieces of the model), the reveal's permutation (SPEC §3) |
| `brain/receipt.ts` | Activation masses → ppm fee shares, receipt hash and check (SPEC §7) |
| `brain/ranges.ts` | Sets of curve positions; which neurons stay awake (rarest first) |
| `brain/ledger.ts` | Ownership ledger: curve buys, dormant and wake, checkpoints, carry, epoch fee settlement (SPEC §5, §7) |
| `brain/program.ts` | The Neurals program's instruction interface: names, Borsh arguments, account order (shared by program, decoder, site) |
| `brain/decoder.ts` | Finalized transactions → ledger events: pump.fun curve buys and sell-backs, program instructions, wallet balance totals |
| `probe/` | `neurals-probe`: runs the brain on llama.cpp and measures how much each part fired |
| `tools/determinism.ts` | Milestone 1 experiment: do receipts reproduce across runs and thread counts? |
| `tools/pump-check.ts` | Runs the decoder on real pump.fun mainnet transactions (read-only) and checks every curve transfer |
| `tools/names-check.ts` | Fails if another project's name appears in the repo |

## Development

Node ≥ 23.6 (runs TypeScript directly, no build step).

```sh
npm install
npm test
npm run typecheck
npm run names        # before every commit
```

## Milestone 1: activation receipts

In WSL (or any Linux) with git, a C++ compiler and cmake:

```sh
bash scripts/fetch-model.sh      # models/qwen2.5-1.5b-instruct-q4_k_m.gguf (~1.1 GB), hash checked
bash scripts/build-probe.sh      # llama.cpp b12033 + probe → ~/neurals-build/probe/neurals-probe
```

Then, from the repo root (on Windows it runs the probe through WSL):

```sh
node tools/determinism.ts
```

It generates a reply to each test prompt, replays it teacher-forced with 1, 4 and 12 threads,
and reports how far the replayed shares land from the posted ones.
