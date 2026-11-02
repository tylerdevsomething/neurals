// Milestone 1 experiment: do activation receipts reproduce?
//
//   node tools/determinism.ts [--probe <path in WSL>] [--model <path in WSL>] [-n 48]
//
// For each test prompt: generate once (4 threads, token by token, as the hosted brain would), then
// replay the same reply teacher-forced in one batch with 1, 4 and 12 threads, as verifiers on other
// machines would. Prints the largest per-part share difference (ppm) of every replay against the
// generation. Each probe run is a separate process, so nothing is shared between runs.
// Runs the probe through WSL on Windows, directly elsewhere.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { PPM, shares, maxDiff, check, type Receipt } from '../brain/receipt.ts';
import { SEGMENT_COUNT } from '../brain/model.ts';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PROBE = opt('--probe', '~/neurals-build/probe/neurals-probe');
const MODEL = opt('--model', '/mnt/c/git/neurals/models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const N = opt('-n', '48');
const TOLERANCE = 1; // ppm

const PROMPTS = [
  'Explain in two sentences why the sky is blue.',
  'Write a haiku about a lighthouse.',
  'What is 17 times 23? Show your working.',
  'Give three names for a coffee shop run by robots.',
];

type Run = { threads: number; mode: string; prompt: number[]; output: number[]; text: string; mass: number[] };

function probe(prompt: string, threads: number, replay?: number[]): Run {
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const cmd = [PROBE, '-m', q(MODEL), '-p', q(prompt), '-n', N, '-t', String(threads)];
  if (replay) cmd.push('--replay', replay.join(','));
  const line = process.platform === 'win32'
    ? execFileSync('wsl', ['-e', 'bash', '-lc', cmd.join(' ')], { encoding: 'utf8', maxBuffer: 64 << 20 })
    : execFileSync('bash', ['-lc', cmd.join(' ')], { encoding: 'utf8', maxBuffer: 64 << 20 });
  // The probe prints nan for a part whose mass is not a number; that is a broken run, not a result.
  if (/[,[]nan[,\]]/.test(line)) throw new Error(`probe produced NaN masses (${threads} threads): the computation was corrupted`);
  const run = JSON.parse(line) as Run;
  if (run.mass.length !== SEGMENT_COUNT) throw new Error(`probe gave ${run.mass.length} masses, expected ${SEGMENT_COUNT}`);
  return run;
}

async function modelHash(): Promise<string> {
  const path = process.platform === 'win32'
    ? MODEL.replace(/^\/mnt\/([a-z])\//, (_, d: string) => `${d.toUpperCase()}:/`)
    : MODEL;
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

const receipt = (model: string, r: Run): Receipt => ({ model, prompt: r.prompt, output: r.output, shares: shares(r.mass) });

const model = await modelHash();
console.log(`model sha256 ${model}`);
let worst = 0;
let failures = 0;
for (const prompt of PROMPTS) {
  const gen = probe(prompt, 4);
  const posted = receipt(model, gen);
  console.log(`\n"${prompt}"\n  reply (${gen.output.length} tokens): ${JSON.stringify(gen.text.slice(0, 80))}`);
  for (const threads of [1, 4, 12]) {
    const rep = probe(prompt, threads, gen.output);
    const r = check(posted, receipt(model, rep), TOLERANCE);
    // Raw relative difference too, to see how far floating point drifts before rounding.
    let rel = 0;
    gen.mass.forEach((m, i) => { if (m > 0) rel = Math.max(rel, Math.abs(m - rep.mass[i]) / m); });
    worst = Math.max(worst, r.diff);
    if (!r.ok) failures++;
    console.log(`  replay, ${String(threads).padStart(2)} threads: max diff ${r.diff} ppm, raw rel ${rel.toExponential(2)}  ${r.ok ? 'OK' : `FAIL (${r.why})`}`);
  }
  const again = receipt(model, probe(prompt, 4));
  console.log(`  generate again, 4 threads: max diff ${maxDiff(posted.shares, again.shares)} ppm, same reply: ${JSON.stringify(again.output) === JSON.stringify(gen.output)}`);
}
console.log(`\nworst replay difference ${worst} ppm of ${PPM}; ${failures} replays outside ±${TOLERANCE} ppm`);
process.exit(failures ? 1 : 0);
