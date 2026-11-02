// Checks a receipt by replaying it (SPEC §7): anyone can run this against any paid message.
//
//   node tools/verify-receipt.ts <receipt hash> [--indexer http://127.0.0.1:8787]
//        [--probe /root/neurals-build/probe/neurals-probe] [--model <gguf as the probe sees it>]
//        [--model-file <gguf here, for its hash>] [--threads 2] [--tolerance 1]
//
// Fetches the receipt, checks its hash and that it names this model, replays the prompt and reply
// teacher-forced with the probe, and compares every part's share with the posted one.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { check, receiptHash, shares, type Receipt } from '../brain/receipt.ts';

const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const hash = args[0];
if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
  console.error('usage: node tools/verify-receipt.ts <receipt hash> [options]');
  process.exit(2);
}
const indexer = opt('--indexer', 'http://127.0.0.1:8787');
const probe = opt('--probe', '/root/neurals-build/probe/neurals-probe');
const model = opt('--model', '/mnt/c/git/neurals/models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const modelFile = opt('--model-file', 'models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const threads = opt('--threads', '2');
const tolerance = Number(opt('--tolerance', '1'));

const res = await fetch(`${indexer}/receipts/${hash}`);
if (!res.ok) throw new Error(`no receipt ${hash} at ${indexer}`);
const posted = (await res.json()) as Receipt;
console.log(`receipt ${hash.slice(0, 16)}…: ${posted.prompt.length} prompt tokens, ${posted.output.length} reply tokens`);
if (receiptHash(posted) !== hash) throw new Error('the receipt does not hash to its name');

const h = createHash('sha256');
for await (const c of createReadStream(modelFile)) h.update(c as Buffer);
const modelHash = h.digest('hex');
if (modelHash !== posted.model) throw new Error(`the receipt is for model ${posted.model.slice(0, 16)}…, this file is ${modelHash.slice(0, 16)}…`);

// Replay the receipt's exact token ids (no chat template, no re-tokenizing).
const argv = ['-m', model, '-p', 'replay', '--prompt-ids', posted.prompt.join(','), '--replay', posted.output.join(','), '-t', threads];
const out = process.platform === 'win32' ? execFileSync('wsl', ['-e', probe, ...argv], { encoding: 'utf8', maxBuffer: 64 << 20 }) : execFileSync(probe, argv, { encoding: 'utf8', maxBuffer: 64 << 20 });
const run = JSON.parse(out) as { prompt: number[]; output: number[]; mass: number[] };
const replayed: Receipt = { model: modelHash, prompt: run.prompt, output: run.output, shares: shares(run.mass) };
const r = check(posted, replayed, tolerance);
console.log(r.ok ? `VALID: every share within ±${tolerance} ppm (largest difference ${r.diff} ppm)` : `INVALID: ${r.why}`);
process.exit(r.ok ? 0 : 1);
