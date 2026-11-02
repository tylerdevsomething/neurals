// The site's receipt checks (site/src/pages/Receipt.tsx), from the command line:
//
//   node tools/check-receipt.ts <receipt hash> <payment signature> [--site https://...] [--rpc <url>]
//
// Recomputes the receipt's hash, checks its model and shares, and reads the payment from the chain.
// (tools/verify-receipt.ts goes further and replays the model.)
import { Connection, PublicKey } from '@solana/web3.js';
import { receiptHash, PPM, type Receipt } from '../brain/receipt.ts';
import { decode } from '../brain/program.ts';

const [hash, signature] = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const site = opt('--site', 'https://neurals-production.up.railway.app');
const cfg = (await (await fetch(`${site}/api/config`)).json()) as { model: string; programId: string; rpcUrl: string };
const r = (await (await fetch(`${site}/api/receipts/${hash}`)).json()) as Receipt;
const conn = new Connection(opt('--rpc', cfg.rpcUrl), 'confirmed');
const ok = (c: boolean, what: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`); return c; };
let all = ok(receiptHash(r) === hash, 'not tampered with: the receipt hashes to its name');
all = ok(r.model === cfg.model, 'made by the brain: the model is the inscribed brain') && all;
all = ok(r.shares.length === 1318 && r.shares.reduce((a, b) => a + b, 0) === PPM, 'shares: 1,318 parts adding up to 1,000,000') && all;
const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
const keys = tx?.transaction.message.staticAccountKeys ?? [];
const paid = (tx?.transaction.message.compiledInstructions ?? []).some((ix) => keys[ix.programIdIndex]?.equals(new PublicKey(cfg.programId)) && (() => { const d = decode(ix.data); return d?.name === 'payFee' && d.receipt === hash; })());
all = ok(paid && !tx?.meta?.err, 'fee paid on chain naming this receipt') && all;
process.exit(all ? 0 : 1);
