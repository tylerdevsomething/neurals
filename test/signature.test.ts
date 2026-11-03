import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { signReceipt, verifyReceipt } from '../brain/signature.ts';

test('receipt signatures: the brain\'s verify; another key, another hash or junk do not', () => {
  const brain = Keypair.generate();
  const other = Keypair.generate();
  const hash = 'ab'.repeat(32);
  const sig = signReceipt(hash, brain.secretKey);
  assert.ok(verifyReceipt(hash, sig, brain.publicKey.toBase58()));
  assert.ok(!verifyReceipt(hash, signReceipt(hash, other.secretKey), brain.publicKey.toBase58()));
  assert.ok(!verifyReceipt('cd'.repeat(32), sig, brain.publicKey.toBase58()));
  assert.ok(!verifyReceipt(hash, undefined, brain.publicKey.toBase58()));
  assert.ok(!verifyReceipt(hash, 'zz', brain.publicKey.toBase58()));
});
