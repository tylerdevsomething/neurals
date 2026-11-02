// Activation shares for a receipt (SPEC §7).
//
// Activation from different kinds of part is measured on different tensors (MLP neurons, attention
// head outputs, embeddings, the output head), so the raw numbers are not comparable across kinds.
// Each kind therefore gets a fixed budget of every fee, in proportion to the tokens it was sold for,
// and within a kind the budget is split by activation mass. A neuron column and an attention head
// that fire at their kind's average earn the same per token held.

import { createHash } from 'node:crypto';
import { CURVE_SUPPLY, HEAD_COUNT, COLUMN_COUNT, SEGMENT_COUNT, TOKENS, type Kind } from './model.ts';
import { PARTS } from './layout.ts';

export const PPM = 1_000_000;

/** Fraction of each fee that goes to each kind of part. */
export const BUDGET: Record<Kind, number> = {
  embedding: TOKENS.embedding / CURVE_SUPPLY,
  head: (HEAD_COUNT * TOKENS.head) / CURVE_SUPPLY,
  column: (COLUMN_COUNT * TOKENS.column) / CURVE_SUPPLY,
  unembedding: TOKENS.unembedding / CURVE_SUPPLY,
};

/**
 * Turns activation masses (one per part, model order) into whole parts-per-million shares that
 * add up to exactly 1,000,000. Rounding is largest remainder, ties to the lower part index.
 */
export function shares(mass: readonly number[]): number[] {
  if (mass.length !== SEGMENT_COUNT) throw new Error(`expected ${SEGMENT_COUNT} masses, got ${mass.length}`);
  for (const m of mass) if (!Number.isFinite(m) || m < 0) throw new Error(`bad mass ${m}`);

  const sum: Record<Kind, number> = { embedding: 0, head: 0, column: 0, unembedding: 0 };
  const count: Record<Kind, number> = { embedding: 0, head: 0, column: 0, unembedding: 0 };
  PARTS.forEach((p, i) => { sum[p.kind] += mass[i]; count[p.kind]++; });

  const exact = PARTS.map((p, i) => {
    const within = sum[p.kind] > 0 ? mass[i] / sum[p.kind] : 1 / count[p.kind];
    return BUDGET[p.kind] * within * PPM;
  });
  const out = exact.map(Math.floor);
  let left = PPM - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) out[order[k].i]++;
  return out;
}

/** The largest per-part difference between two share lists, in ppm. */
export function maxDiff(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('share lists differ in length');
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

export type Receipt = {
  model: string; // SHA-256 of the inscribed GGUF, hex
  prompt: number[]; // token ids
  output: number[]; // token ids of the reply
  shares: number[]; // ppm per part, model order
};

/** Canonical hash of a receipt: what gets posted on chain with the fee. */
export function receiptHash(r: Receipt): string {
  const canon = JSON.stringify({ v: 1, model: r.model, prompt: r.prompt, output: r.output, shares: r.shares });
  return createHash('sha256').update('neurals:v1:receipt').update(canon).digest('hex');
}

/**
 * A replay checks a posted receipt: same model and tokens, and every replayed share within
 * `tolerance` ppm of the posted one. The replay is teacher-forced (it feeds the posted reply rather
 * than generating its own), so a near-tie between two next tokens on another machine cannot change
 * the reply.
 */
export function check(posted: Receipt, replayed: Receipt, tolerance: number): { ok: boolean; diff: number; why?: string } {
  if (posted.model !== replayed.model) return { ok: false, diff: Infinity, why: 'different model' };
  if (JSON.stringify(posted.prompt) !== JSON.stringify(replayed.prompt)) return { ok: false, diff: Infinity, why: 'different prompt' };
  if (JSON.stringify(posted.output) !== JSON.stringify(replayed.output)) return { ok: false, diff: Infinity, why: 'different reply' };
  if (posted.shares.reduce((a, b) => a + b, 0) !== PPM) return { ok: false, diff: Infinity, why: 'shares do not add up to 1,000,000' };
  const diff = maxDiff(posted.shares, replayed.shares);
  return diff <= tolerance ? { ok: true, diff } : { ok: false, diff, why: `a share differs by ${diff} ppm` };
}
