// Runs the indexer: follows the chain, serves the API, and (with a settler key) settles epochs.
//
//   node indexer/main.ts <config.json>
//
// Config: { rpcUrl, port, dataDir, programId, mint, curveTokenAccount, pumpProgramId,
//           pumpNonBuyInstructions, startSlot, epochSlots, model, settlerKey?, pollMs?,
//           rulesFile?, revealFile? }
// The reveal is applied only once revealFile exists, matches rulesFile and the seed block on chain.
// Any error stops the process: run it under a supervisor that restarts it. The log makes restarts
// safe; a halt from the ledger or balance book means a decoding problem and needs a human.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair } from '@solana/web3.js';
import { Rpc } from './rpc.ts';
import { Store } from './store.ts';
import { Indexer, type IndexerConfig } from './indexer.ts';
import { startApi } from './api.ts';
import { Settler } from './settler.ts';
import { NeuralsAccounts, parseConfig } from '../brain/accounts.ts';
import { checkReveal, checkRules, type Reveal, type Rules } from '../brain/reveal.ts';
import { failoverFetch, hostOf, rpcList } from '../brain/rpcs.ts';

type Config = IndexerConfig & {
  /** The dev wallet that creates the token: only its mint is taken when the site goes live by itself. */
  creator?: string;
  rpcUrl: string;
  port: number;
  dataDir: string;
  model: string;
  settlerKey?: string;
  pollMs?: number;
  /** Slots between posting a root and its first claim: the program's CHALLENGE_SLOTS (default 9,000). */
  challengeSlots?: number;
  /** Payouts below this are left for their owners to claim (default 100,000 lamports). */
  minPushLamports?: number;
  /** The committed rules file; needed to check a reveal. */
  rulesFile?: string;
  revealFile?: string;
  /** Shown to the site: the RPC browsers should use, and the brain's URL. */
  publicRpcUrl?: string;
  brainUrl?: string;
  cluster?: string;
};

const path = process.argv[2];
if (!path) {
  console.error('usage: node indexer/main.ts <config.json>');
  process.exit(2);
}
const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
// What browsers are told to use: never the private RPC below, which may carry an API key.
// PUBLIC_RPC_URL (hosted): a key meant for browsers, restricted to the site's domain.
const publicRpcUrl = process.env.PUBLIC_RPC_URL ?? config.publicRpcUrl ?? config.rpcUrl;
// Hosting: secrets and paths from the environment, never from the config file or the image.
// RPC_FALLBACK_URLS: comma-separated endpoints used in turn when the main one refuses (quota, rate limit,
// outage); the config file's own public endpoint is always the last resort.
const rpcUrls = rpcList(process.env.RPC_URL ?? config.rpcUrl, process.env.RPC_FALLBACK_URLS, config.rpcUrl);
const rpcFetch = failoverFetch(rpcUrls);
if (process.env.RPC_URL) config.rpcUrl = process.env.RPC_URL;
console.log(`rpc: ${rpcUrls.map(hostOf).join(" then ")}`);
if (process.env.PORT) config.port = Number(process.env.PORT);
if (process.env.DATA_DIR) config.dataDir = process.env.DATA_DIR;
if (process.env.BRAIN_URL) config.brainUrl = process.env.BRAIN_URL;
// The token found on chain after the launch (see the waiting loop below), kept on the data volume: it
// completes a config deployed before the launch, so no redeploy is needed to go live.
const launchFile = join(config.dataDir, 'launch.json');
if (!config.mint && existsSync(launchFile)) {
  const l = JSON.parse(readFileSync(launchFile, 'utf8')) as { mint: string; curveTokenAccount: string; startSlot: number };
  Object.assign(config, { mint: l.mint, curveTokenAccount: l.curveTokenAccount, startSlot: l.startSlot });
  console.log(`token from ${launchFile}: mint ${l.mint}, start slot ${l.startSlot}`);
}
// Before the token exists (no mint yet: the launch writes it), the site and API are served and nothing
// is followed, settled or revealed; nothing is written to the data volume either.
const waiting = !config.mint;
if (waiting) {
  config.startSlot ??= 0;
  config.curveTokenAccount ??= '';
  console.log('WAITING for the token: no mint in the config yet. Serving the site; not following the chain.');
}
const rpc = new Rpc(config.rpcUrl, 8, rpcFetch);
const store = new Store(config.dataDir);
const indexer = new Indexer(config, rpc, store);
// The rules fix the reveal (SPEC §6): the indexer finds the seed block itself once the curve sells out
// or the deadline passes. A reveal already built (by this indexer, or given as revealFile) is checked
// against the rules and the seed block on chain, then set before the log is replayed, so it lands at
// its canonical place; after the replay, its seed block must be the one the sellout calls for.
if (config.rulesFile && !waiting) {
  const rules = checkRules(JSON.parse(readFileSync(config.rulesFile, 'utf8')) as Rules);
  if (rules.model !== config.model) throw new Error('the rules are for a different model');
  indexer.setRules(rules);
  const r = store.readReveal() ?? (config.revealFile && existsSync(config.revealFile) ? JSON.parse(readFileSync(config.revealFile, 'utf8')) as Reveal : null);
  if (r) {
    checkReveal(rules, r);
    const block = await rpc.call<{ blockhash: string }>('getBlock', [r.seedSlot, { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
    if (block.blockhash !== r.blockhash) throw new Error(`the reveal's seed block hash does not match block ${r.seedSlot} on chain`);
    const p = indexer.useReveal(r);
    console.log(`reveal checked: seed block ${r.seedSlot}, takes effect at slot ${p.effectiveSlot}`);
  }
} else if (config.revealFile && !waiting) {
  throw new Error('a reveal needs rulesFile to be checked against');
}
if (!waiting) {
indexer.restore();
await indexer.checkSeed();
}
console.log(`restored to slot ${indexer.syncedSlot}, epoch ${indexer.ledger.epoch}, fingerprint ${indexer.ledger.fingerprint().slice(0, 16)}`);

// The settler's key: SETTLER_KEY (its JSON array) when hosted, or a file path in the config.
const settlerSecret = process.env.SETTLER_KEY ?? (config.settlerKey ? readFileSync(config.settlerKey, 'utf8') : null);
let settler: Settler | null = null;
const paused = !!process.env.SETTLER_PAUSED && process.env.SETTLER_PAUSED !== '0';
if (settlerSecret && !waiting) {
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(settlerSecret)));
  settler = new Settler(new Connection(config.rpcUrl, { commitment: 'confirmed', fetch: rpcFetch }), key, new NeuralsAccounts(config.programId));
  const st = settler;
  if (config.challengeSlots !== undefined) st.challengeSlots = config.challengeSlots;
  if (config.minPushLamports !== undefined) st.minPushLamports = config.minPushLamports;
  // SETTLER_PAUSED: payouts are still worked out and kept, but nothing is posted or pushed. Unset it and
  // restart to resume: every epoch not yet posted is posted then, in order.
  if (paused) console.log('settler PAUSED (SETTLER_PAUSED): epochs are kept, nothing is posted until it is unset');
  else {
    indexer.onSettled = (s) => { const f = store.readEpoch(s.epoch); if (f) void st.enqueue(f); };
    // Epochs settled before a restart may not have been posted or pushed yet.
    for (const s of indexer.settlements) { const f = store.readEpoch(s.epoch); if (f) void st.enqueue(f); }
  }
}

startApi({
  indexer, store, model: config.model, brainKey: config.brainKey,
  site: { rpcUrl: publicRpcUrl, brainUrl: config.brainUrl, cluster: config.cluster },
  staticDir: process.env.STATIC_DIR,
  waiting,
  settler: settler ? () => ({ alerts: settler!.alerts, lastError: settler!.lastError, ...(paused ? { paused: true } : {}) }) : undefined,
}, config.port);
console.log(`api on :${config.port}`);

/** Waiting: the mint the admin recorded in the program (set_mint, by tools/launch.ts watching the creator's
 *  wallet), with the slot of the transaction that created it, which must be the creator's. */
async function launched(): Promise<{ mint: string; curveTokenAccount: string; startSlot: number } | null> {
  const a = await rpc.accountData(new NeuralsAccounts(config.programId).config().toBase58());
  if (!a) return null;
  const c = parseConfig(a.data);
  if (c.mint.toBase58() === '11111111111111111111111111111111') return null;
  const mint = c.mint.toBase58();
  // The oldest page of the mint's transactions (oldest last in each page).
  let oldest: { signature: string; slot: number; err: unknown }[] = [];
  for (let before: string | undefined; ;) {
    const page = await rpc.call<{ signature: string; slot: number; err: unknown }[]>('getSignaturesForAddress', [mint, { limit: 1000, before, commitment: 'finalized' }]);
    if (page.length) oldest = page;
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  // The start slot is the creation: the earliest successful transaction paid by the dev wallet (what
  // tools/launch.ts records). Without a dev wallet configured, the earliest successful one.
  let first: { slot: number } | null = null;
  let payer: string | undefined;
  for (const s of oldest.filter((x) => !x.err).reverse().slice(0, 25)) {
    const tx = await rpc.transaction(s.signature);
    payer = tx?.transaction?.message?.accountKeys?.[0]?.pubkey as string | undefined;
    if (!config.creator || payer === config.creator) { first = { slot: s.slot }; break; }
  }
  if (!oldest.length) return null; // recorded but not final yet
  if (!first) {
    console.log(`ALERT: the program's mint ${mint} was not created by the dev wallet ${config.creator} (first payer ${payer}): not going live`);
    return null;
  }
  // Rules whose fallback deadline has already passed would reveal at once: post new rules and redeploy first.
  if (config.rulesFile) {
    const deadline = (JSON.parse(readFileSync(config.rulesFile, 'utf8')) as Rules).seed.deadlineSlot;
    if (deadline <= first.slot) {
      console.log(`ALERT: the rules deadline (slot ${deadline}) is before the launch (slot ${first.slot}): new rules are needed (tools/mainnet.ts rules --replace, then redeploy); not going live`);
      return null;
    }
  }
  return { mint, curveTokenAccount: c.curveTokenAccount.toBase58(), startSlot: first.slot };
}

for (;;) {
  if (waiting) {
    try {
      const l = await launched();
      if (l) {
        mkdirSync(config.dataDir, { recursive: true });
        writeFileSync(launchFile, JSON.stringify({ ...l, foundAt: new Date().toISOString() }, null, 2));
        console.log(`TOKEN LAUNCHED: mint ${l.mint}, curve ${l.curveTokenAccount}, start slot ${l.startSlot}. Restarting live.`);
        process.exit(0); // the host restarts the service, which reads launch.json and goes live
      }
    } catch (e) {
      console.log(`waiting: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
    continue;
  }
  const n = await indexer.syncOnce();
  if (n) console.log(`slot ${indexer.syncedSlot}: applied ${n} transactions; epoch ${indexer.ledger.epoch}`);
  await new Promise((r) => setTimeout(r, config.pollMs ?? 2000));
}
