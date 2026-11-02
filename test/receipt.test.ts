import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENT_COUNT } from '../brain/model.ts';
import { PARTS } from '../brain/layout.ts';
import { BUDGET, PPM, shares, maxDiff, check, receiptHash, type Receipt } from '../brain/receipt.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byKind = (s: number[], k: string) => sum(s.filter((_, i) => PARTS[i].kind === k));

test('budgets follow tokens sold and add up to 1', () => {
  assert.ok(Math.abs(sum(Object.values(BUDGET)) - 1) < 1e-12);
  assert.ok(Math.abs(BUDGET.column - 752_640_000 / 793_100_000) < 1e-12);
});

test('shares are whole ppm, add up to exactly 1,000,000, and keep each kind on budget', () => {
  const mass = Array.from({ length: SEGMENT_COUNT }, (_, i) => ((i * 7919) % 1000) + 0.123);
  const s = shares(mass);
  assert.equal(sum(s), PPM);
  s.forEach((x) => assert.ok(Number.isInteger(x) && x >= 0));
  for (const k of ['embedding', 'head', 'column', 'unembedding'] as const) {
    assert.ok(Math.abs(byKind(s, k) - BUDGET[k] * PPM) <= 1000, k);
  }
});

test('within a kind, more activation means a bigger share; scale does not matter across kinds', () => {
  const mass: number[] = PARTS.map((p) => (p.kind === 'head' ? 1e6 : 1)); // heads measured on a much bigger scale
  mass[13] = 2; // one column fires twice as hard as the others
  const s = shares(mass);
  assert.ok(Math.abs(byKind(s, 'head') - BUDGET.head * PPM) <= 336); // huge raw numbers buy no extra
  assert.ok(s[13] > s[14] * 1.9 && s[13] < s[14] * 2.1);
});

test('a kind with no activation splits its budget evenly', () => {
  const mass = PARTS.map((p) => (p.kind === 'head' ? 0 : 1));
  const s = shares(mass);
  const heads = s.filter((_, i) => PARTS[i].kind === 'head');
  assert.ok(Math.max(...heads) - Math.min(...heads) <= 1);
});

test('rejects wrong lengths and bad numbers', () => {
  assert.throws(() => shares([1, 2, 3]));
  assert.throws(() => shares(PARTS.map(() => -1)));
  assert.throws(() => shares(PARTS.map(() => NaN)));
});

test('check: same tokens and shares within tolerance pass; anything else fails', () => {
  const base: Receipt = { model: 'ab', prompt: [1, 2], output: [3, 4], shares: shares(PARTS.map((_, i) => i + 1)) };
  const near = { ...base, shares: base.shares.slice() };
  near.shares[5] += 1; near.shares[6] -= 1;
  assert.equal(maxDiff(base.shares, near.shares), 1);
  assert.equal(check(base, near, 1).ok, true);
  assert.equal(check(base, near, 0).ok, false);
  assert.equal(check(base, { ...near, output: [3, 5] }, 5).why, 'different reply');
  assert.equal(check(base, { ...near, model: 'cd' }, 5).why, 'different model');
  assert.notEqual(receiptHash(base), receiptHash(near));
  assert.equal(receiptHash(base), receiptHash({ ...base }));
});
