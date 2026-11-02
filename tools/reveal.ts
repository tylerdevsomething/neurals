// Builds the reveal file from the rules and the seed block (SPEC §6).
//
//   node tools/reveal.ts <rules.json> --sold-out-slot <slot | none> --out reveal.json [--rpc <url>]
//
// The seed block is the first block at or after the seed slot the rules call for (a slot can be
// skipped). Its hash, as the chain reports it, seeds the permutation. Post the printed memo with
// tools/commit.ts-style tooling or any memo sender; the indexer rebuilds and checks the file.

import { readFileSync, writeFileSync } from 'node:fs';
import { Connection } from '@solana/web3.js';
import { buildReveal, checkRules, revealMemo, seedSlotFor, type Rules } from '../brain/reveal.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const path = args[0];
const sold = opt('--sold-out-slot');
const out = opt('--out');
if (!path || !sold || !out) {
  console.error('usage: node tools/reveal.ts <rules.json> --sold-out-slot <slot|none> --out reveal.json [--rpc <url>]');
  process.exit(2);
}
const rules = checkRules(JSON.parse(readFileSync(path, 'utf8')) as Rules);
const conn = new Connection(opt('--rpc') ?? 'http://127.0.0.1:8899', 'finalized');
const target = seedSlotFor(rules, sold === 'none' ? null : Number(sold));
const finalized = await conn.getSlot('finalized');
if (finalized < target) throw new Error(`the seed slot ${target} is not finalized yet (finalized: ${finalized})`);
const [seedSlot] = await conn.getBlocks(target, Math.min(target + 1000, finalized), 'finalized');
if (seedSlot === undefined) throw new Error(`no block at or after slot ${target}`);
const block = await conn.getBlock(seedSlot, { transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' });
if (!block) throw new Error(`block ${seedSlot} not served`);
const reveal = buildReveal(rules, seedSlot, block.blockhash);
writeFileSync(out, JSON.stringify(reveal));
console.log(`seed block ${seedSlot} (${block.blockhash})\nwrote ${out}\n${revealMemo(reveal)}`);
