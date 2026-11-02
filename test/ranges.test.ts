import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, total, union, intersect, subtract, equal, takeRarest } from '../brain/ranges.ts';
import { SLOTS } from '../brain/layout.ts';

test('normalize sorts, merges touching and overlapping ranges, drops empty ones', () => {
  assert.deepEqual(normalize([[5, 7], [0, 2], [2, 3], [6, 9], [10, 10]]), [[0, 3], [5, 9]]);
  assert.throws(() => normalize([[-1, 2]]));
});

test('union, intersect, subtract, total', () => {
  const a = normalize([[0, 10], [20, 30]]);
  const b = normalize([[5, 25]]);
  assert.deepEqual(union(a, b), [[0, 30]]);
  assert.deepEqual(intersect(a, b), [[5, 10], [20, 25]]);
  assert.deepEqual(subtract(a, b), [[0, 5], [25, 30]]);
  assert.deepEqual(subtract(b, a), [[10, 20]]);
  assert.deepEqual(subtract(a, []), a);
  assert.deepEqual(intersect(a, []), []);
  assert.equal(total(a), 20);
  assert.ok(equal(a, [[0, 10], [20, 30]]));
});

test('subtract handles many holes in one range', () => {
  assert.deepEqual(subtract([[0, 100]], [[10, 20], [30, 40], [90, 120]]), [[0, 10], [20, 30], [40, 90]]);
});

test('takeRarest: highest points first, then lowest positions', () => {
  const s1 = SLOTS[1];
  const s2 = SLOTS[2];
  const both = normalize([[s1.start, s1.end], [s2.start, s2.end]]);
  const size = s1.end - s1.start;
  // No points: lowest positions first.
  assert.deepEqual(takeRarest(both, 10, () => 0), [[s1.start, s1.start + 10]]);
  // Slot 2 is rare: it stays awake first.
  assert.deepEqual(takeRarest(both, 10, (i) => (i === 2 ? 50 : 0)), [[s2.start, s2.start + 10]]);
  assert.deepEqual(takeRarest(both, size + 5, (i) => (i === 2 ? 50 : 0)), [[s1.start, s1.start + 5], [s2.start, s2.end]]);
  assert.deepEqual(takeRarest(both, 0, () => 0), []);
  assert.deepEqual(takeRarest(both, 10 * size, () => 0), both);
});
