// Posts a memo on chain (e.g. the reveal memo printed by tools/reveal.ts).
//
//   node tools/post-memo.ts "<memo text>" --key <key.json> --rpc <url>
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { sendAndPoll } from './send.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const memo = args[0];
if (!memo || !opt('--key') || !opt('--rpc')) {
  console.error('usage: node tools/post-memo.ts "<memo>" --key <key.json> --rpc <url>');
  process.exit(2);
}
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--key')!, 'utf8'))));
const conn = new Connection(opt('--rpc')!, 'confirmed');
const sig = await sendAndPoll(conn, new Transaction().add(new TransactionInstruction({
  programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
  keys: [{ pubkey: key.publicKey, isSigner: true, isWritable: false }],
  data: Buffer.from(memo),
})), [key]);
console.log(`posted: ${sig}`);
