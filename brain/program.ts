// The Neurals program's instruction interface: names, arguments (Borsh) and account order.
//
// This module is the contract between the on-chain program (to be written against it) and
// everything that reads or builds its transactions: the decoder, the site and the tests.
// Discriminators follow Anchor: the first 8 bytes of sha256("global:<name>").

import { createHash } from 'node:crypto';
import { decodeBase58, encodeBase58 } from './base58.ts';
import type { Range } from './ranges.ts';

/** Accounts of each instruction, in order. */
export const ACCOUNTS = {
  /** Moves `amount` tokens into a new checkpoint, naming the positions they carry (SPEC §5.3). */
  seal: ['owner', 'config', 'checkpoint', 'checkpointTokens', 'ownerTokens', 'mint', 'tokenProgram', 'systemProgram'],
  /** Sends `amount` tokens and the positions they carry to another wallet (SPEC §5.4). */
  carry: ['from', 'to', 'fromTokens', 'toTokens', 'mint', 'tokenProgram', 'config'],
  list: ['holder', 'checkpoint'],
  cancel: ['holder', 'checkpoint'],
  /** Buys a listed checkpoint; the tokens never move. */
  buy: ['buyer', 'checkpoint', 'holder', 'treasury', 'config', 'systemProgram'],
  gift: ['holder', 'checkpoint'],
  /** Returns a checkpoint's tokens (and, by the ledger, its positions) to the holder; closes it. */
  withdraw: ['holder', 'checkpoint', 'checkpointTokens', 'holderTokens', 'mint', 'tokenProgram'],
  /** Pays a message's fee into the pool, naming its receipt hash (SPEC §7). */
  payFee: ['payer', 'config', 'pool', 'systemProgram'],
} as const;

export type InstructionName = keyof typeof ACCOUNTS;

/** Positions travel as (start, length) pairs of base units. */
export type Instruction =
  | { name: 'seal'; positions: Range[]; amount: number }
  | { name: 'carry'; positions: Range[]; amount: number }
  | { name: 'list'; price: bigint }
  | { name: 'cancel' }
  | { name: 'buy'; maxPrice: bigint }
  | { name: 'gift'; newHolder: string }
  | { name: 'withdraw' }
  | { name: 'payFee'; receipt: string; lamports: number };

/** Anchor's instruction name is the snake_case of ours. */
const anchorName = (n: string) => n.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function discriminator(name: InstructionName): Buffer {
  return createHash('sha256').update(`global:${anchorName(name)}`).digest().subarray(0, 8);
}

const BY_DISCRIMINATOR = new Map(
  (Object.keys(ACCOUNTS) as InstructionName[]).map((n) => [discriminator(n).toString('hex'), n]),
);

/** The index of a named account in an instruction's account list. */
export function accountIndex<N extends InstructionName>(name: N, account: (typeof ACCOUNTS)[N][number]): number {
  return (ACCOUNTS[name] as readonly string[]).indexOf(account);
}

export function encode(ix: Instruction): Buffer {
  const parts: Buffer[] = [discriminator(ix.name)];
  const u64 = (v: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    parts.push(b);
  };
  const positions = (rs: Range[]) => {
    const n = Buffer.alloc(4);
    n.writeUInt32LE(rs.length);
    parts.push(n);
    for (const [s, e] of rs) { u64(s); u64(e - s); }
  };
  switch (ix.name) {
    case 'seal':
    case 'carry': positions(ix.positions); u64(ix.amount); break;
    case 'list': u64(ix.price); break;
    case 'buy': u64(ix.maxPrice); break;
    case 'gift': parts.push(Buffer.from(decodeBase58(ix.newHolder))); break;
    case 'payFee': parts.push(Buffer.from(ix.receipt, 'hex')); u64(ix.lamports); break;
    case 'cancel': case 'withdraw': break;
  }
  return Buffer.concat(parts);
}

/** Decodes instruction data, or returns null if it is not one of ours. Throws on malformed data. */
export function decode(data: Uint8Array): Instruction | null {
  if (data.length < 8) return null;
  const name = BY_DISCRIMINATOR.get(Buffer.from(data.subarray(0, 8)).toString('hex'));
  if (!name) return null;
  const buf = Buffer.from(data);
  let off = 8;
  const need = (n: number) => { if (off + n > buf.length) throw new Error(`${name}: data too short`); };
  const u64 = (): number => {
    need(8);
    const v = buf.readBigUInt64LE(off);
    off += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name}: value out of range`);
    return Number(v);
  };
  const u64big = (): bigint => { need(8); const v = buf.readBigUInt64LE(off); off += 8; return v; };
  const positions = (): Range[] => {
    need(4);
    const n = buf.readUInt32LE(off);
    off += 4;
    const out: Range[] = [];
    for (let i = 0; i < n; i++) {
      const s = u64();
      const len = u64();
      if (!Number.isSafeInteger(s + len)) throw new Error(`${name}: position out of range`);
      out.push([s, s + len]);
    }
    return out;
  };
  let ix: Instruction;
  switch (name) {
    case 'seal':
    case 'carry': { const p = positions(); ix = { name, positions: p, amount: u64() }; break; }
    case 'list': ix = { name, price: u64big() }; break;
    case 'buy': ix = { name, maxPrice: u64big() }; break;
    case 'gift': need(32); ix = { name, newHolder: encodeBase58(buf.subarray(off, off + 32)) }; off += 32; break;
    case 'payFee': need(32); { const receipt = buf.subarray(off, off + 32).toString('hex'); off += 32; ix = { name, receipt, lamports: u64() }; } break;
    case 'cancel': ix = { name }; break;
    case 'withdraw': ix = { name }; break;
  }
  if (off !== buf.length) throw new Error(`${name}: ${buf.length - off} unexpected trailing bytes`);
  return ix;
}
