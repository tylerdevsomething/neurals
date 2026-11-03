import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentMemo, paymentProblem, MEMO_PROGRAM, type PaymentTx } from '../brain/payment.ts';

const key = (s: string) => ({ toBase58: () => s });
const BRAIN = 'Brain1111111111111111111111111111111111111';
const NOW = 1_800_000_000;
const tx = (o: { to?: string; lamports?: number; memo?: string; err?: unknown; age?: number } = {}): PaymentTx => ({
  blockTime: NOW - (o.age ?? 10),
  meta: { err: o.err ?? null, preBalances: [5_000_000, 0, 1, 1], postBalances: [5_000_000 - (o.lamports ?? 1_000_000) - 5000, o.lamports ?? 1_000_000, 1, 1] },
  transaction: { message: {
    staticAccountKeys: [key('Visitor'), key(o.to ?? BRAIN), key('11111111111111111111111111111111'), key(MEMO_PROGRAM)],
    compiledInstructions: [{ programIdIndex: 2, data: new Uint8Array(12) }, { programIdIndex: 3, data: new TextEncoder().encode(o.memo ?? paymentMemo('hello')) }],
  } },
});
const check = (t: PaymentTx | null, message = 'hello') => paymentProblem(t, { payTo: BRAIN, lamports: 1_000_000, message, now: NOW });

test('a payment buys exactly the message it names, paid to the brain, recently, in full', () => {
  assert.equal(check(tx()), null);
  assert.match(check(null)!, /not found/);
  assert.match(check(tx({ err: { x: 1 } }))!, /failed/);
  assert.match(check(tx({ age: 3600 }))!, /too old/);
  assert.match(check(tx({ to: 'Someone11111111111111111111111111111111111' }))!, /does not pay/);
  assert.match(check(tx({ lamports: 999_999 }))!, /does not pay/);
  assert.match(check(tx(), 'a different message')!, /different message/);
  assert.match(check(tx({ memo: 'neurals:chat:' + '0'.repeat(64) }))!, /different message/);
});
