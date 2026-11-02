// Checks a receipt by replaying it (SPEC §7): anyone can run this against any paid message.
//
//   node tools/verify-receipt.ts <receipt hash> [--indexer https://neurals-production.up.railway.app/api]
//        [--model models/qwen2.5-1.5b-instruct-q4_k_m.gguf] [--wasm site/public/wasm/neurals-wasm.js] [--tolerance 1]
//
// Fetches the receipt, checks its hash and that it names this model, replays the prompt and reply
// with the WebAssembly verifier (the same build the brain measures with, and the same the site's
// replay button runs), and compares every part's share with the posted one.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { check, receiptHash, shares, type Receipt } from '../brain/receipt.ts';
import { loadWasmInNode } from '../brain/wasm-node.ts';

const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const hash = args[0];
if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
  console.error('usage: node tools/verify-receipt.ts <receipt hash> [options]');
  process.exit(2);
}
const indexer = opt('--indexer', 'https://neurals-production.up.railway.app/api');
const modelFile = opt('--model', 'models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const tolerance = Number(opt('--tolerance', '1'));

const res = await fetch(`${indexer}/receipts/${hash}`);
if (!res.ok) throw new Error(`no receipt ${hash} at ${indexer}`);
const posted = (await res.json()) as Receipt;
console.log(`receipt ${hash.slice(0, 16)}…: ${posted.prompt.length} prompt tokens, ${posted.output.length} reply tokens`);
if (receiptHash(posted) !== hash) throw new Error('the receipt does not hash to its name');

const h = createHash('sha256');
for await (const c of createReadStream(modelFile)) h.update(c as Buffer);
if (h.digest('hex') !== posted.model) throw new Error('the receipt is for a different model than this file');

const verifier = await loadWasmInNode(opt('--wasm', 'site/public/wasm/neurals-wasm.js'), modelFile);
const t = Date.now();
const mass = verifier.measure(posted.prompt, posted.output);
const r = check(posted, { ...posted, shares: shares(mass) }, tolerance);
console.log(`replayed in ${((Date.now() - t) / 1000).toFixed(1)} s`);
console.log(r.ok ? `VALID: every share within ±${tolerance} ppm (largest difference ${r.diff} ppm)` : `INVALID: ${r.why}`);
process.exit(r.ok ? 0 : 1);
