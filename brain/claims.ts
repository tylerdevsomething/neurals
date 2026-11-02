// Claims (SPEC §7): each epoch's payouts are committed on chain as one Merkle root; every owner then
// claims their own amount with a proof. Anyone can rebuild the tree from the public ledger, so the
// root can be checked by anyone before or after it is posted.
//
// Leaf: sha256(0x00 ‖ index (u32 LE) ‖ wallet (32 bytes) ‖ epoch (u64 LE) ‖ amount (u64 LE)).
// The index is the wallet's position in the sorted list; the program keeps one bit per index, so
// each payout can be claimed once, by anyone, on the owner's behalf.
// Node: sha256(0x01 ‖ smaller child ‖ larger child), so a proof is just the list of siblings.
// The 0x00 / 0x01 prefixes keep a leaf from ever being passed off as a node. The program
// (programs/neurals, `claim`) checks proofs the same way.

import { createHash } from 'node:crypto';
import { decodeBase58 } from './base58.ts';

const sha = (...parts: Uint8Array[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

function u64(v: bigint): Buffer {
  if (v < 0n || v >= 1n << 64n) throw new RangeError(`u64 out of range: ${v}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export function leaf(index: number, wallet: string, epoch: number, amount: bigint): Buffer {
  const w = decodeBase58(wallet);
  if (w.length !== 32) throw new Error(`not a 32-byte address: ${wallet}`);
  const i = Buffer.alloc(4);
  i.writeUInt32LE(index);
  return sha(Buffer.from([0]), i, w, u64(BigInt(epoch)), u64(amount));
}

function node(a: Buffer, b: Buffer): Buffer {
  return Buffer.compare(a, b) <= 0 ? sha(Buffer.from([1]), a, b) : sha(Buffer.from([1]), b, a);
}

export type ClaimTree = {
  epoch: number;
  root: Buffer;
  total: bigint;
  /** Each wallet's index, amount and proof (sibling hashes, leaf to root). */
  claims: Map<string, { index: number; amount: bigint; proof: Buffer[] }>;
};

/**
 * Builds the tree of one epoch's payouts. Wallets are sorted, so every builder gets the same root.
 * An odd node at the end of a level is carried up unchanged. An epoch with no payouts has an
 * all-zero root, which can never match a claim.
 */
export function buildTree(epoch: number, payouts: Map<string, bigint>): ClaimTree {
  const wallets = [...payouts.keys()].filter((w) => payouts.get(w)! > 0n).sort();
  const claims = new Map<string, { index: number; amount: bigint; proof: Buffer[] }>();
  let total = 0n;
  if (wallets.length === 0) return { epoch, root: Buffer.alloc(32), total, claims };

  let level = wallets.map((w, i) => leaf(i, w, epoch, payouts.get(w)!));
  // Position of each wallet's hash in the current level.
  const at = new Map(wallets.map((w, i) => [w, i]));
  for (const [i, w] of wallets.entries()) {
    claims.set(w, { index: i, amount: payouts.get(w)!, proof: [] });
    total += payouts.get(w)!;
  }
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    for (const w of wallets) {
      const i = at.get(w)!;
      const sibling = i ^ 1;
      if (sibling < level.length) claims.get(w)!.proof.push(level[sibling]);
      at.set(w, i >> 1);
    }
    level = next;
  }
  return { epoch, root: level[0], total, claims };
}

/** Checks a proof the way the program does. */
export function verify(root: Buffer, index: number, wallet: string, epoch: number, amount: bigint, proof: Buffer[]): boolean {
  let h = leaf(index, wallet, epoch, amount);
  for (const p of proof) h = node(h, p);
  return h.equals(root);
}
