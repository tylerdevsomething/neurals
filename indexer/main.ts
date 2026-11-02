// Runs the indexer: follows the chain, serves the API, and (with a settler key) settles epochs.
//
//   node indexer/main.ts <config.json>
//
// Config: { rpcUrl, port, dataDir, programId, mint, curveTokenAccount, pumpProgramId,
//           pumpNonBuyInstructions, startSlot, epochSlots, model, settlerKey?, pollMs?, revealFile? }
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

type Config = IndexerConfig & {
  rpcUrl: string;
  port: number;
  dataDir: string;
  model: string;
  settlerKey?: string;
  pollMs?: number;
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
const rpc = new Rpc(config.rpcUrl);
const store = new Store(config.dataDir);
const indexer = new Indexer(config, rpc, store);
indexer.restore();
console.log(`restored to slot ${indexer.syncedSlot}, epoch ${indexer.ledger.epoch}, fingerprint ${indexer.ledger.fingerprint().slice(0, 16)}`);

if (config.settlerKey) {
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(config.settlerKey, 'utf8'))));
  const settler = new Settler(new Connection(config.rpcUrl, 'confirmed'), key, new NeuralsAccounts(config.programId));
  indexer.onSettled = (s) => { const f = store.readEpoch(s.epoch); if (f) void settler.enqueue(f); };
  // Epochs settled before a restart may not have been posted or pushed yet.
  for (const s of indexer.settlements) { const f = store.readEpoch(s.epoch); if (f) void settler.enqueue(f); }
}

startApi({ indexer, store, model: config.model, site: { rpcUrl: config.publicRpcUrl ?? config.rpcUrl, brainUrl: config.brainUrl, cluster: config.cluster } }, config.port);
console.log(`api on :${config.port}`);

let revealed = indexer.ledger.isRevealed;
for (;;) {
  const n = await indexer.syncOnce();
  if (n) console.log(`slot ${indexer.syncedSlot}: applied ${n} transactions; epoch ${indexer.ledger.epoch}`);
  if (!revealed && config.revealFile && existsSync(config.revealFile)) {
    const r = JSON.parse(readFileSync(config.revealFile, 'utf8')) as { partOfSlot: number[]; pointsOfPart: number[] };
    indexer.reveal(r.partOfSlot, r.pointsOfPart);
    revealed = true;
    console.log('reveal recorded');
  }
  await new Promise((r) => setTimeout(r, config.pollMs ?? 2000));
}
