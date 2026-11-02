import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, verify, leaf } from '../brain/claims.ts';
import { encodeBase58 } from '../brain/base58.ts';

const wallet = (n: number) => encodeBase58(new Uint8Array(32).fill(n));

test('every wallet can prove its amount; nothing else proves', () => {
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const payouts = new Map(Array.from({ length: n }, (_, i) => [wallet(i + 1), BigInt((i + 1) * 1000)]));
    const t = buildTree(7, payouts);
    assert.equal(t.total, [...payouts.values()].reduce((a, b) => a + b, 0n));
    for (const [w, { index, amount, proof }] of t.claims) {
      assert.ok(verify(t.root, index, w, 7, amount, proof), `${n} wallets: ${w}`);
      assert.ok(!verify(t.root, index, w, 7, amount + 1n, proof), 'a bigger amount fails');
      assert.ok(!verify(t.root, index, w, 8, amount, proof), 'another epoch fails');
      if (n > 1) assert.ok(!verify(t.root, (index + 1) % n, w, 7, amount, proof), 'another index fails');
    }
    const outsider = wallet(200);
    const [, any] = [...t.claims][0];
    assert.ok(!verify(t.root, any.index, outsider, 7, any.amount, any.proof), 'another wallet fails');
  }
});

test('the root does not depend on insertion order', () => {
  const a = new Map([[wallet(1), 5n], [wallet(2), 6n], [wallet(3), 7n]]);
  const b = new Map([[wallet(3), 7n], [wallet(1), 5n], [wallet(2), 6n]]);
  assert.deepEqual(buildTree(1, a).root, buildTree(1, b).root);
});

test('zero payouts are left out; an empty epoch has an all-zero root', () => {
  const t = buildTree(1, new Map([[wallet(1), 0n], [wallet(2), 3n]]));
  assert.deepEqual([...t.claims.keys()], [wallet(2)]);
  assert.deepEqual(buildTree(1, new Map()).root, Buffer.alloc(32));
});

test('a leaf cannot pose as a node', () => {
  const t = buildTree(1, new Map([[wallet(1), 1n], [wallet(2), 2n]]));
  assert.notDeepEqual(t.root, leaf(0, wallet(1), 1, 1n));
  assert.throws(() => leaf(0, 'short', 1, 1n));
});
