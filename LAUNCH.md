# Mainnet launch checklist

Every step in order, with the command and what to check before going on. Nothing here has been run on
mainnet yet. Steps marked **SOL** spend real SOL. Steps marked **once** cannot be undone: a mistake
there means deploying under a new program id and starting again.

Rehearse the whole list on devnet first (with a fresh program id), exactly as written.

## Rehearsed on devnet (2026-11-03)

The whole list, with the same tools, on devnet with a fresh program (`8UKnARNNJVUBcaFXsqHzkw1nmD2Jt5Y4vG3HtPjQMdwz`):
deploy; initialize; rules posted before the token; preflight before the token (all ok); the launch
watcher saw the new token and recorded its mint 5 seconds after it appeared; the indexer and settler
started from the written config; preflight after the token (all ok); offer, accept by the stand-in
multisig, upgrade authority moved; preflight handed-over (all ok); the curve bought out in three buys;
the indexer found the sellout, used the seed block the rules name (sellout + 150 slots) and revealed by
itself; the reveal rebuilt by hand with `tools/reveal.ts` was identical; a message fee was split and
every wallet received exactly its payout (rounding dust paid the next period); a second indexer
syncing from scratch reached identical payout roots and reveal.

Not rehearsed: creating the token on pump.fun itself (a test curve stands in on devnet), accepting the
admin role through the Squads app (a plain key stood in), and the mainnet Railway services.

### The mainnet steps as single commands

`tools/mainnet.ts` runs each step with the Helius key from `.env` (masked in all output):

| Step | Command |
|---|---|
| 3 deploy | `node tools/mainnet.ts deploy --yes` (done 2026-11-03) |
| 4 initialize | `node tools/mainnet.ts init --yes` (done 2026-11-03) |
| 5 upload | `node tools/mainnet.ts upload --yes` (started 2026-11-03), then `node tools/mainnet.ts verify` after step 6 |
| 6 rules | `node tools/mainnet.ts rules --yes` |
| preflight | `node tools/mainnet.ts preflight [--stage after-token|handed-over] [--brain <url>]` |
| 7 launch | `node tools/mainnet.ts launch --creator <your pump.fun wallet> --yes`, then create the token |
| 8 handover | `node tools/mainnet.ts offer --yes`; `node tools/mainnet.ts print-accept` (propose it in Squads); `node tools/mainnet.ts upgrade-authority --yes` |
| progress | `node tools/mainnet.ts status` |


## 0. Decisions (before anything)

| Decision | Notes |
|---|---|
| Multisig | **Decided:** Squads vault `4mSYGQvZTpcdVhz3bbN1EtYhSjnnnSdZLfD3ZVJRcrfa` (recorded as `multisig` in `deploy/indexer.mainnet.json`). It becomes the treasury, the admin and the upgrade authority. Signers must be reachable within an hour: that is the window for vetoing a bad payout root. |
| Browser RPC | **Decided:** a second Helius key, kept in `.env` as `HELIUS_BROWSER_API_KEY` and given to the indexer host as `PUBLIC_RPC_URL` (never committed). In the Helius dashboard, restrict it to the site's domain: browsers see it. |
| Reveal | **Decided:** at bonding (the curve selling out), expected within about 30 minutes of launch. The indexer reveals by itself (step 9). The rules still need a **deadline**, the fallback if the curve never sells out: a short one fits a fast sale (for example 3 days, 648,000 slots after launch). |
| Audit | Recommended before real money sits in the program. |
| Launch date | The brain upload (step 5) takes about 33 hours and must finish first. |

## 1. Keys

**Created 2026-11-03** (files in `neurals-keys/mainnet/`, outside the repo; public addresses below):

| Key | Address | Fund with |
|---|---|---|
| deployer | `3XKMThFUJT5kvNK7FMVoWFZcBW6xPrVPQqG6RTpaVj9e` | 4.2 SOL |
| writer | `3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH` | 6.5 SOL |
| settler | `GfYPjZwq5eqraSCvQHgAaQmoUdqmuZVEEboNH9HauPPz` | 0.3 SOL |
| brain | `6aWy1UL2uuF8G7pTCqC6JhHtLoBuhccQGavjjoVmdmGH` | 0.1 SOL |
| program address | `9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR` (`neurals-keys/program-devnet.json`; unused on mainnet) | 0 |

Audit: decided against (2026-11-03). Launch: as soon as possible.


Make each key on its own and keep the files out of the repo (as with `neurals-keys/`).

| Key | Role | Lives | Fund with |
|---|---|---|---|
| program address | The program's id. Used once, by the deploy. | offline | 0 |
| deployer | Upgrade authority and first admin until handover (step 8) | your PC, then offline | ~4.2 SOL |
| writer | Uploads the brain (step 5) | your PC | ~6.5 SOL |
| settler | Posts each hour's payout root, pushes payouts | Railway (`SETTLER_KEY`) | ~0.3 SOL, topped up (about 0.05 SOL a day: rent for 24 payout records plus push fees) |
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

**Mainnet, done 4 Nov 2026:** 1,163,876 model chunks (about 5.9 SOL), runtime, rules and manifest on chain.
Brain address: `neurals:v1:3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH:54527f8dfab3275b0b9c18d15bb58ee5dc4f6c83a713e645a1db8dcf60879c5c:898`.
Rules commit memo: `3GBMoN7D29rj9sijU7MnjkvtkJbsbzSJtsWwg2Qv1rEXyyDXraGhXMrM3TkdSm9cYZMSGXsn8cvtcxRhrUw1TVTZ` (deadline slot 466593089).
Read-back (tools/readback.ts, 4 Nov 2026): every chunk of the model, runtime, rules and manifest on chain matches the local files, zero mismatches.

## 6. Rules and their commit memo — **once**

```bash
# deadline = launch slot estimate + ~648,000 (3 days): the fallback if the curve never sells out
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
   - `neurals-mainnet`: `INDEXER_CONFIG=deploy/indexer.mainnet.json`, `RPC_URL` (Helius mainnet, private), `PUBLIC_RPC_URL` (the browser key's URL), `SETTLER_KEY`, `BRAIN_URL`.
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

## 9. The reveal (automatic, at bonding)

Nothing to run. When the last position on the curve is bought (bonding), the indexer records that
slot, waits for the seed block the rules name (the first block at or after sellout + `delaySlots`,
about a minute later), builds the reveal itself and applies it at the next epoch boundary. Nobody picks
the seed block, and an indexer refuses any reveal drawn from another block, so nobody can steer
traits to chosen wallets. If the curve never sells out, the same happens at the deadline.

Check, minutes after bonding:

```bash
curl <site>/api/health        # soldOutSlot and seedSlot are set
curl <site>/api/reveal        # the reveal; anyone can rebuild it:
node tools/reveal.ts deploy/rules.mainnet.json --sold-out-slot <soldOutSlot> --out /tmp/check.json --rpc <url>   # must be identical
```

Optionally post its memo for the record (`node tools/post-memo.ts` with the memo `tools/reveal.ts` prints).
Rehearsed by `tools/reveal-rehearse.ts` on a local chain: sellout found, the named seed block used, a
second indexer from scratch identical, a restart re-checked, a reveal from any other block refused.

## Running it

- **Monitor emails** (every 15 minutes): act on any failure. `ALERT` means a posted payout root differs
  from the one the indexer computed: veto it **within the hour**, from Squads, with the instruction from
  `node tools/admin.ts print veto --epoch <n> --admin <vault>`. The settler then posts the right root.
- Keep the settler and brain keys topped up; the monitor warns when the brain key runs low.
- Payouts under 0.0001 SOL are not pushed (their fee would eat them); owners claim them from the site.
- Role changes (settler, treasury, fee up to 5%) go through Squads: `node tools/admin.ts print roles ...`.
