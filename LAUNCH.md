# Mainnet launch checklist

Every step in order, with the command and what to check before going on. Nothing here has been run on
mainnet yet. Steps marked **SOL** spend real SOL. Steps marked **once** cannot be undone: a mistake
there means deploying under a new program id and starting again.

Rehearse the whole list on devnet first (with a fresh program id), exactly as written.

## 0. Decisions (before anything)

| Decision | Notes |
|---|---|
| Multisig | A Squads multisig (for example 2 of 3). Its **vault** address becomes the treasury, the admin and the upgrade authority. Signers must be reachable within an hour: that is the window for vetoing a bad payout root. |
| Browser RPC | The RPC the site gives visitors' browsers. Not the private Helius key: a second Helius key restricted to the site's domain, or another provider. |
| Reveal deadline | The slot by which the reveal happens even if the curve has not sold out (about 7 days is 1,512,000 slots after launch). Fixed in the rules before the token exists. |
| Audit | Recommended before real money sits in the program. |
| Launch date | The brain upload (step 5) takes about 33 hours and must finish first. |

## 1. Keys

Make each key on its own and keep the files out of the repo (as with `neurals-keys/`).

| Key | Role | Lives | Fund with |
|---|---|---|---|
| program address | The program's id. Used once, by the deploy. | offline | 0 |
| deployer | Upgrade authority and first admin until handover (step 8) | your PC, then offline | ~4.2 SOL |
| writer | Uploads the brain (step 5) | your PC | ~6.5 SOL |
| settler | Posts each day's payout root, pushes payouts | Railway (`SETTLER_KEY`) | ~0.3 SOL, topped up |
| brain | Receives visitors' message payments, forwards them with receipts, signs receipts | Railway (`PAYER_KEY`) | ~0.1 SOL |
| creator | Creates the token on pump.fun | Phantom | pump.fun's creation fee (+ any first buy) |

Total, roughly: **11–12 SOL**, of which ~3.7 SOL is the program's rent (held, not spent).

The program id: the devnet program's address key (`neurals-keys/program-devnet.json`, id
`9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR`) can deploy the same id on mainnet, which keeps every
tool's default. A fresh key works too: pass `--program <id>` to the tools and set `programId` in the configs.

## 2. The build

```bash
# WSL. The mainnet build has no devnet feature: a 9,000-slot (~1 hour) challenge window.
anchor build -p neurals && mkdir -p out/mainnet && cp target/deploy/neurals.so out/mainnet/neurals.so
sha256sum out/mainnet/neurals.so      # must equal deploy/neurals.mainnet.so.sha256
```

Checked so far (2026-11-03): `tools/attacks.ts` (all attacks refused, admin handover included) and
`tools/rehearse.ts` pass on a local chain with the devnet build of the same source; `tools/pump-check.ts`
classifies 23 of 23 live pump.fun transfers correctly. Rebuilding the program changes the hash: re-run
the checks and record the new hash in `deploy/neurals.mainnet.so.sha256`.

Optional, recommended: a verifiable build (`solana-verify`), so anyone can check the deployed code
matches this source.

## 3. Deploy the program — **SOL**

```bash
CONFIRM_MAINNET=yes DEPLOYER=<deployer.json> PROGRAM_KEY=<program-address.json> RPC=<helius mainnet url> \
  bash scripts/deploy-mainnet.sh
```

It refuses any file but the checked build, and any RPC that is not mainnet, then asks you to type
`DEPLOY`. Check: `solana program show <id>` lists the deployer as the upgrade authority.

## 4. Initialize — **SOL (small), once**

```bash
node tools/admin.ts init --rpc <url> --key <deployer.json> --treasury <multisig vault> --settler <settler pubkey> --fee-bps 150
node tools/admin.ts init ... --yes        # the same, sent
node tools/admin.ts show --rpc <url>
```

Only the upgrade authority can initialize, so nobody can take the roles first. The admin is now the
deployer; it stays admin until the mint is recorded (step 7), then passes to the multisig (step 8).

## 5. Upload the brain — **SOL (~6 SOL), ~33 hours**

```bash
node tools/inscribe.ts --rpc <helius mainnet url> --key <writer.json> --model models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --runtime <runtime files> --rules deploy/rules.mainnet.json --rps 10 --micro-lamports <priority fee>
```

About 1.16 million transactions at ~10 per second (measured on devnet through Helius: 9.9 per second,
no failures). Interrupting is safe: the journal resumes it. At the end, run it again with `--verify`
(reads every byte back from chain) and keep the printed manifest hash and writer address: they are the
brain's address on Solana.

## 6. Rules and their commit memo — **once**

```bash
# deadline = launch slot estimate + ~1,512,000 (7 days)
node tools/traits.ts out/traits-raw.json --deadline <slot> --out deploy/rules.mainnet.json
#   (or copy rules/neurals-v1.draft.json and set seed.deadlineSlot: the traits are the same)
node tools/commit.ts deploy/rules.mainnet.json                                   # shows the memo
node tools/commit.ts deploy/rules.mainnet.json --post --key <deployer.json> --rpc <url>
```

Post it **before the token exists**: the memo fixes the traits, the slot layout and the seed rule, so
nobody (us included) can change them after seeing who bought what. Commit the rules file to the repo.

Then fill `deploy/indexer.mainnet.json`: `brainKey` (the brain key's public key) and `publicRpcUrl`.

### Preflight

```bash
node tools/preflight.ts deploy/indexer.mainnet.json --brain-config deploy/brain.mainnet.json \
  --so out/mainnet/neurals.so --rpc <url> --stage before-token
```

Every line must be `ok`. It checks the configs (one-day epochs, the 9,000-slot window, pump.fun's
program and instructions, the brain key), that the deployed code is the checked build byte for byte,
the roles and fee, that no mint is recorded yet, the rules and their deadline, and the settler's SOL.

## 7. Launch day — **once**

1. Hosting (Railway): two new services from this repo, each with its own volume on `/data`:
   - `neurals-mainnet`: `INDEXER_CONFIG=deploy/indexer.mainnet.json`, `RPC_URL` (Helius mainnet), `SETTLER_KEY`, `BRAIN_URL`.
   - `brain-mainnet` (staged by `scripts/stage-brain.sh`): `BRAIN_CONFIG=deploy/brain.mainnet.json`, `PAYER_KEY` (the brain key), `RPC_URL`, `INDEXER_URL`. Healthcheck path `/health`, timeout 300 s.
2. Start the watcher, then create the token from the creator wallet on pump.fun:
   ```bash
   node tools/launch.ts --rpc <url> --creator <creator pubkey> --admin-key <deployer.json> --config deploy/indexer.mainnet.json
   ```
   It sees the new mint, waits until it is final (fixed supply, no mint or freeze authority), sends
   `set_mint` (once only) and writes the mint, curve account and start slot into the config.
3. Commit the config and deploy `neurals-mainnet`; then deploy `brain-mainnet`.
4. Preflight again, with the brain:
   ```bash
   node tools/preflight.ts deploy/indexer.mainnet.json --brain-config deploy/brain.mainnet.json --so out/mainnet/neurals.so \
     --rpc <url> --brain <brain url> --stage after-token
   ```
5. Add the mainnet site to the monitor (`.github/workflows/monitor.yml`: a second `run:` line with its URL).
6. Buy a little from a test wallet; check the site shows the neurons within a minute.

## 8. Hand the keys to the multisig — **same day**

```bash
node tools/admin.ts offer --rpc <url> --key <deployer.json> --to <multisig vault> --yes
node tools/admin.ts print accept --admin <multisig vault>      # the instruction to propose in Squads
#   Squads: new transaction → custom instruction, with the program, accounts and data printed above.
#   Approve it with the signers; then:
node tools/admin.ts show --rpc <url>                           # admin = the vault, no pending offer
solana program set-upgrade-authority <program id> --new-upgrade-authority <multisig vault> \
  --skip-new-upgrade-authority-signer-check -k <deployer.json> -u <url>
node tools/preflight.ts deploy/indexer.mainnet.json --rpc <url> --stage handed-over --multisig <multisig vault>
```

The offer changes nothing until the vault accepts, so a mistyped address cannot lock the program.
After this the deployer key controls nothing: store it offline.

## 9. The reveal (after sellout or the deadline)

```bash
node tools/reveal.ts deploy/rules.mainnet.json --sold-out-slot <slot | none> --out deploy/reveal.mainnet.json --rpc <url>
node tools/post-memo.ts "<memo printed above>" --key <deployer or any key> --rpc <url>
```

Commit `deploy/reveal.mainnet.json` and redeploy `neurals-mainnet`. The indexer checks the reveal against
the rules and the seed block, and applies it at the first epoch boundary after the seed block.

## Running it

- **Monitor emails** (every 15 minutes): act on any failure. `ALERT` means a posted payout root differs
  from the one the indexer computed: veto it **within the hour**, from Squads, with the instruction from
  `node tools/admin.ts print veto --epoch <n> --admin <vault>`. The settler then posts the right root.
- Keep the settler and brain keys topped up; the monitor warns when the brain key runs low.
- Payouts under 0.0001 SOL are not pushed (their fee would eat them); owners claim them from the site.
- Role changes (settler, treasury, fee up to 5%) go through Squads: `node tools/admin.ts print roles ...`.
