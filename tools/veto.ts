// Vetoes a posted epoch root during its challenge window (admin only). Use it when the indexer's
// settler logs an ALERT: the root on chain is not the one the public ledger produces.
//
//   node tools/veto.ts <epoch> --key <admin.json> --rpc <url> [--program <id>]
//
// The epoch account is closed and its total released back to the pool; the settler can then post
// the correct root. On mainnet the admin is a multisig: build the same instruction there instead.
import { readFileSync } from 'node:fs';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { NeuralsAccounts } from '../brain/accounts.ts';
import { sendAndPoll } from '../brain/send.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const epoch = Number(args[0]);
if (!Number.isInteger(epoch) || !opt('--key') || !opt('--rpc')) {
  console.error('usage: node tools/veto.ts <epoch> --key <admin.json> --rpc <url> [--program <id>]');
  process.exit(2);
}
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--key')!, 'utf8'))));
const conn = new Connection(opt('--rpc')!, 'confirmed');
const acc = new NeuralsAccounts(opt('--program') ?? '9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const sig = await sendAndPoll(conn, new Transaction().add(acc.vetoEpoch(admin.publicKey, epoch)), [admin]);
console.log(`epoch ${epoch} vetoed: ${sig}`);
