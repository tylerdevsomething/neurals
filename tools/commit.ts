// Prints the commit memo for a rules file and, with --post, posts it on chain (SPEC §6).
//
//   node tools/commit.ts <rules.json> [--post --key <key.json> --rpc <url>]
//
// Post it before the token exists: the memo fixes the traits, the layout and the seed rule.

import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { sendAndPoll } from './send.ts';
import { checkRules, commitMemo, sha256Hex, canonical, type Rules } from '../brain/reveal.ts';

const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const path = args[0];
if (!path) {
  console.error('usage: node tools/commit.ts <rules.json> [--post --key <key.json> --rpc <url>]');
  process.exit(2);
}
const rules = checkRules(JSON.parse(readFileSync(path, 'utf8')) as Rules);
// The committed bytes are the canonical JSON, not the file's own formatting.
console.log(`rules sha256 ${sha256Hex(canonical(rules))}`);
console.log(`traits: ${Object.keys(rules.traits).length}; deadline slot ${rules.seed.deadlineSlot}`);
const memo = commitMemo(rules);
console.log(memo);
if (args.includes('--post')) {
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--key')!, 'utf8'))));
  const conn = new Connection(opt('--rpc') ?? 'http://127.0.0.1:8899', 'confirmed');
  const sig = await sendAndPoll(conn, new Transaction().add(new TransactionInstruction({
    programId: MEMO, keys: [{ pubkey: key.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo),
  })), [key]);
  console.log(`posted: ${sig}`);
}
