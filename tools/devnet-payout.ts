// Devnet payout check: pays one message fee, waits for the epoch it landed in to end, settles,
// posts the root and pushes payouts, then checks every demo wallet received exactly its payout.
// The demo wallets must have held their neurons since before that epoch began (true for any epoch
// after the launch epoch).
//
//   node tools/devnet-payout.ts      (after tools/localnet-up.ts on devnet; reads out/devnet/)

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { Rpc } from '../indexer/rpc.ts';
import { Store } from '../indexer/store.ts';
import { Indexer } from '../indexer/indexer.ts';
import { Settler } from '../indexer/settler.ts';
import { NeuralsAccounts } from '../brain/accounts.ts';
const cfg = JSON.parse(readFileSync('out/devnet/indexer.json', 'utf8'));
const brainCfg = JSON.parse(readFileSync('out/devnet/brain.json', 'utf8'));
const key = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const conn = new Connection(cfg.rpcUrl, 'confirmed');
const acc = new NeuralsAccounts(cfg.programId);
const store = new Store(mkdtempSync(join(tmpdir(), 'neurals-devnet-')));
const ix = new Indexer(cfg, new Rpc(cfg.rpcUrl, 4), store);
const settler = new Settler(conn, key(cfg.settlerKey), acc);
const pending: Promise<void>[] = [];
ix.onSettled = (s) => { const f = store.readEpoch(s.epoch); if (f) pending.push(settler.enqueue(f)); };
const until = async (slot: number) => { while ((await conn.getSlot('finalized')) < slot) await new Promise((r) => setTimeout(r, 3000)); };

await until(cfg.startSlot + cfg.epochSlots + 2); // the demo buys are a full epoch old
console.log('paying a message fee');
const brain = key(brainCfg.payerKey);
const receipt = createHash('sha256').update('devnet rehearsal message').digest('hex');
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(acc.payFee(brain.publicKey, receipt, 1_000_000)), [brain], { commitment: 'confirmed' });
const landed = (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }))!.slot;
const E = Math.floor((landed - cfg.startSlot) / cfg.epochSlots);
console.log(`fee paid: ${sig} (slot ${landed}, epoch ${E})`);
const wallets = readFileSync('out/devnet/demo-wallets.txt', 'utf8').trim().split(/\s+/);
const { PublicKey } = await import('@solana/web3.js');
const before = await Promise.all(wallets.map((w) => conn.getBalance(new PublicKey(w))));
await until(cfg.startSlot + (E + 1) * cfg.epochSlots + 2);
await ix.syncOnce();
await Promise.all(pending);
const s1 = ix.settlements.find((s) => s.epoch === E)!;
console.log(`epoch ${E} settled: fees ${s1.fees}, ${s1.payouts.size} payouts, carried ${s1.carried}`);
const after = await Promise.all(wallets.map((w) => conn.getBalance(new PublicKey(w))));
let ok = true;
wallets.forEach((w, i) => {
  // Every epoch settled in this run was pushed, including fees paid by earlier runs.
  const owed = ix.settlements.reduce((a, s) => a + (s.payouts.get(w) ?? 0n), 0n);
  const got = BigInt(after[i] - before[i]);
  ok &&= got === owed;
  console.log(`  ${w.slice(0, 6)}…: owed ${owed}, received ${got} ${got === owed ? 'ok' : 'MISMATCH'}`);
});
const e = await conn.getAccountInfo(acc.epoch(E));
console.log(`epoch ${E} account on devnet: ${e ? 'posted' : 'missing'}; ${ok ? 'all payouts exact' : 'payout mismatch'}`);
process.exit(ok && e ? 0 : 1);
