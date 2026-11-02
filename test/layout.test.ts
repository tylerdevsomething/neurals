import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENT_COUNT, UNIT, MODEL, COLUMNS_PER_LAYER, stageOf } from '../brain/model.ts';
import { SLOTS, PARTS, SUPPLY, slotAt, slotsIn, permutation } from '../brain/layout.ts';

test('1,318 segments: 1 embedding, 336 heads, 980 columns, 1 unembedding', () => {
  assert.equal(SEGMENT_COUNT, 1318);
  const count = (k: string) => SLOTS.filter((s) => s.kind === k).length;
  assert.equal(count('embedding'), 1);
  assert.equal(count('head'), 336);
  assert.equal(count('column'), 980);
  assert.equal(count('unembedding'), 1);
});

test('slots tile the whole curve with no gaps or overlaps, in order', () => {
  assert.equal(SLOTS[0].start, 0);
  for (let i = 1; i < SLOTS.length; i++) assert.equal(SLOTS[i].start, SLOTS[i - 1].end, `gap before slot ${i}`);
  assert.equal(SLOTS.at(-1)!.end, SUPPLY);
  assert.equal(SUPPLY, 793_100_000 * UNIT);
});

test('sizes by kind: 3.43M, 100k, 768k (256 neurons × 3,000), 3.43M tokens', () => {
  const size = (i: number) => (SLOTS[i].end - SLOTS[i].start) / UNIT;
  assert.equal(size(0), 3_430_000);
  assert.equal(size(1), 100_000); // layer 0, head 0
  assert.equal(size(13), 768_000); // layer 0, column 0
  assert.equal(size(SEGMENT_COUNT - 1), 3_430_000);
});

test('the pattern follows the forward pass: embedding, then 12 heads and 35 columns per layer', () => {
  assert.deepEqual(PARTS[0], { index: 0, kind: 'embedding', layer: null, within: null });
  assert.deepEqual(PARTS[1], { index: 1, kind: 'head', layer: 0, within: 0 });
  assert.deepEqual(PARTS[12], { index: 12, kind: 'head', layer: 0, within: 11 });
  assert.deepEqual(PARTS[13], { index: 13, kind: 'column', layer: 0, within: 0 });
  assert.deepEqual(PARTS[47], { index: 47, kind: 'column', layer: 0, within: 34 });
  assert.deepEqual(PARTS[48], { index: 48, kind: 'head', layer: 1, within: 0 });
  assert.deepEqual(PARTS[1316], { index: 1316, kind: 'column', layer: 27, within: 34 });
  assert.equal(PARTS[1317].kind, 'unembedding');
  assert.equal(MODEL.layers * (MODEL.heads + COLUMNS_PER_LAYER), 1316);
});

test('slotAt finds the slot at each boundary', () => {
  assert.equal(slotAt(0).index, 0);
  assert.equal(slotAt(3_430_000 * UNIT - 1).index, 0);
  assert.equal(slotAt(3_430_000 * UNIT).index, 1);
  assert.equal(slotAt(SUPPLY - 1).index, SEGMENT_COUNT - 1);
  for (const s of SLOTS) {
    assert.equal(slotAt(s.start).index, s.index);
    assert.equal(slotAt(s.end - 1).index, s.index);
  }
  assert.throws(() => slotAt(SUPPLY));
  assert.throws(() => slotAt(-1));
});

test('slotsIn splits a buy across the slots it spans', () => {
  const s1 = SLOTS[1];
  const r = slotsIn(s1.start - 5, s1.end + 7);
  assert.deepEqual(r.map((x) => [x.slot.index, x.amount]), [[0, 5], [1, s1.end - s1.start], [2, 7]]);
  assert.deepEqual(slotsIn(10, 10), []);
});

test('stages by layer', () => {
  assert.equal(stageOf(0), 'Tokenizer layers');
  assert.equal(stageOf(14), 'Memory layers');
  assert.equal(stageOf(27), 'Prediction layers');
  assert.throws(() => stageOf(28));
});

test('permutation: deterministic, shuffles only within a kind, a true permutation', () => {
  const seed = new Uint8Array(32).fill(7);
  const p = permutation(seed);
  assert.deepEqual(p, permutation(seed));
  assert.equal(p[0], 0);
  assert.equal(p[SEGMENT_COUNT - 1], SEGMENT_COUNT - 1);
  assert.deepEqual([...p].sort((a, b) => a - b), PARTS.map((x) => x.index));
  p.forEach((partIndex, slotIndex) => assert.equal(PARTS[partIndex].kind, SLOTS[slotIndex].kind));
  const moved = p.filter((x, i) => x !== i).length;
  assert.ok(moved > 1200, `only ${moved} moved`);
  const other = permutation(new Uint8Array(32).fill(8));
  assert.notDeepEqual(p, other);
});
