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

import { readFileSync, existsSync } from 'node:fs';
import { Connection, Keypair } from '@solana/web3.js';
import { Rpc } from './rpc.ts';
import { Store } from './store.ts';
import { Indexer, type IndexerConfig } from './indexer.ts';
import { startApi } from './api.ts';
import { Settler } from './settler.ts';
import { NeuralsAccounts } from '../brain/accounts.ts';
import { checkReveal, checkRules, type Reveal, type Rules } from '../brain/reveal.ts';

type Config = IndexerConfig & {
  rpcUrl: string;
  port: number;
  dataDir: string;
  model: string;
  settlerKey?: string;
  pollMs?: number;
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
const publicRpcUrl = config.publicRpcUrl ?? config.rpcUrl;
// Hosting: secrets and paths from the environment, never from the config file or the image.
if (process.env.RPC_URL) config.rpcUrl = process.env.RPC_URL;
if (process.env.PORT) config.port = Number(process.env.PORT);
if (process.env.DATA_DIR) config.dataDir = process.env.DATA_DIR;
if (process.env.BRAIN_URL) config.brainUrl = process.env.BRAIN_URL;
const rpc = new Rpc(config.rpcUrl);
const store = new Store(config.dataDir);
const indexer = new Indexer(config, rpc, store);
indexer.restore();
console.log(`restored to slot ${indexer.syncedSlot}, epoch ${indexer.ledger.epoch}, fingerprint ${indexer.ledger.fingerprint().slice(0, 16)}`);

// The settler's key: SETTLER_KEY (its JSON array) when hosted, or a file path in the config.
const settlerSecret = process.env.SETTLER_KEY ?? (config.settlerKey ? readFileSync(config.settlerKey, 'utf8') : null);
if (settlerSecret) {
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(settlerSecret)));
  const settler = new Settler(new Connection(config.rpcUrl, 'confirmed'), key, new NeuralsAccounts(config.programId));
  indexer.onSettled = (s) => { const f = store.readEpoch(s.epoch); if (f) void settler.enqueue(f); };
  // Epochs settled before a restart may not have been posted or pushed yet.
  for (const s of indexer.settlements) { const f = store.readEpoch(s.epoch); if (f) void settler.enqueue(f); }
}

startApi({
  indexer, store, model: config.model,
  site: { rpcUrl: publicRpcUrl, brainUrl: config.brainUrl, cluster: config.cluster },
  staticDir: process.env.STATIC_DIR,
}, config.port);
console.log(`api on :${config.port}`);

let revealed = indexer.ledger.isRevealed;
for (;;) {
  const n = await indexer.syncOnce();
  if (n) console.log(`slot ${indexer.syncedSlot}: applied ${n} transactions; epoch ${indexer.ledger.epoch}`);
  if (!revealed && config.revealFile && existsSync(config.revealFile)) {
    if (!config.rulesFile) throw new Error('a reveal needs rulesFile to be checked against');
    const rules = checkRules(JSON.parse(readFileSync(config.rulesFile, 'utf8')) as Rules);
    if (rules.model !== config.model) throw new Error('the rules are for a different model');
    const r = JSON.parse(readFileSync(config.revealFile, 'utf8')) as Reveal;
    checkReveal(rules, r);
    const block = await rpc.call<{ blockhash: string }>('getBlock', [r.seedSlot, { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
    if (block.blockhash !== r.blockhash) throw new Error(`the reveal's seed block hash does not match block ${r.seedSlot} on chain`);
    indexer.reveal(r.partOfSlot, r.pointsOfPart);
    revealed = true;
    console.log('reveal recorded');
  }
  await new Promise((r) => setTimeout(r, config.pollMs ?? 2000));
}
