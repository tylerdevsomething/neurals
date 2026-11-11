// Turns finalized transactions (getTransaction with encoding "jsonParsed") into ledger events.
//
// What it reads:
// - pump.fun curve buys and sell-backs: token transfers out of / into the curve's token account
//   whose direct parent is a pump.fun instruction. Buys are defined by exclusion: any pump.fun
//   instruction except the listed non-buy ones (migrations, withdraw), so new buy variants need no
//   change. A plain transfer into the curve (not under pump.fun) is a donation the curve never
//   resells; it is ignored.
// - The Neurals program's instructions (brain/program.ts): seal, carry, buy, gift, withdraw, payFee.
// - Token balances: every account of the mint in the transaction's pre- and post-balances. The
//   balance book turns those into each wallet's total across all its token accounts.
//
// Order within a transaction: its curve and program events in execution order, then its balance
// events. So a seal or carry is judged on the balance the wallet had before the transaction; the
// site never combines one with a buy in the same transaction.

import { createHash } from 'node:crypto';
import { decodeBase58 } from './base58.ts';
import { decode as decodeProgram, accountIndex } from './program.ts';
import type { Event } from './ledger.ts';

export type DecoderConfig = {
  mint: string;
  /** The bonding curve's token account for the mint. */
  curveTokenAccount: string;
  pumpProgramId: string;
  /** Anchor names of pump.fun instructions that move tokens out of the curve without selling them. */
  pumpNonBuyInstructions: string[];
  /** The Neurals program. */
  programId: string;
};

export type Observation = { account: string; owner: string; amount: number };

export type DecodedTx = {
  slot: number;
  signature: string;
  actions: Exclude<Event, { type: 'balance' | 'fee' }>[];
  pre: Observation[];
  post: Observation[];
};

export const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
]);

export class DecodeError extends Error {}

type Ix = { programId: string; parsed?: any; accounts?: string[]; data?: string; stackHeight?: number | null };

const anchorDisc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');

export class Decoder {
  readonly config: DecoderConfig;
  private readonly pumpNonBuy: Set<string>;

  constructor(config: DecoderConfig) {
    this.config = config;
    this.pumpNonBuy = new Set(config.pumpNonBuyInstructions.map(anchorDisc));
  }

  /** Returns null for a failed transaction (it changed nothing). */
  decode(tx: any): DecodedTx | null {
    if (!tx?.meta) throw new DecodeError('transaction has no meta');
    if (tx.meta.err) return null;
    const slot: number = tx.slot;
    const signature: string = tx.transaction.signatures[0];
    const keys = accountKeys(tx);
    const pre = this.observations(tx.meta.preTokenBalances, keys);
    const post = this.observations(tx.meta.postTokenBalances, keys);
    const ownerOf = new Map<string, string>();
    for (const o of [...pre, ...post]) ownerOf.set(o.account, o.owner);

    const actions: DecodedTx['actions'] = [];
    for (const { ix, parent } of executionOrder(tx)) {
      if (TOKEN_PROGRAMS.has(ix.programId) && ix.parsed) {
        const e = this.curveEvent(slot, ix, parent, ownerOf);
        if (e) actions.push(e);
      } else if (ix.programId === this.config.programId) {
        const e = this.programEvent(slot, ix);
        if (e) actions.push(e);
      }
    }
    return { slot, signature, actions, pre, post };
  }

  private observations(balances: any[] | undefined, keys: string[]): Observation[] {
    return (balances ?? [])
      .filter((b) => b.mint === this.config.mint)
      .map((b) => ({ account: keys[b.accountIndex], owner: b.owner, amount: safe(b.uiTokenAmount.amount) }));
  }

  private curveEvent(slot: number, ix: Ix, parent: Ix | null, ownerOf: Map<string, string>): Extract<Event, { type: 'curveBuy' | 'curveSell' }> | null {
    const { type, info } = ix.parsed;
    if (type !== 'transfer' && type !== 'transferChecked') return null;
    if (info.mint !== undefined && info.mint !== this.config.mint) return null;
    const curve = this.config.curveTokenAccount;
    if (info.source !== curve && info.destination !== curve) return null;
    if (!parent || parent.programId !== this.config.pumpProgramId) return null; // donations are ignored
    const amount = safe(info.amount ?? info.tokenAmount.amount);
    if (info.source === curve) {
      if (this.pumpNonBuy.has(discriminatorOf(parent))) return null; // migration: no positions
      const wallet = ownerOf.get(info.destination);
      if (!wallet) throw new DecodeError(`curve buy into ${info.destination}, which has no balance entry`);
      return { type: 'curveBuy', slot, wallet, amount };
    }
    const wallet = ownerOf.get(info.source);
    if (!wallet) throw new DecodeError(`curve sell from ${info.source}, which has no balance entry`);
    return { type: 'curveSell', slot, wallet, amount };
  }

  private programEvent(slot: number, ix: Ix): DecodedTx['actions'][number] | null {
    if (!ix.data || !ix.accounts) return null;
    const p = decodeProgram(decodeBase58(ix.data));
    if (!p) return null;
    const a = ix.accounts;
    switch (p.name) {
      case 'seal':
        return { type: 'seal', slot, checkpoint: a[accountIndex('seal', 'checkpoint')], wallet: a[accountIndex('seal', 'owner')], amount: p.amount, positions: p.positions };
      case 'carry':
        return { type: 'carry', slot, from: a[accountIndex('carry', 'from')], to: a[accountIndex('carry', 'to')], amount: p.amount, positions: p.positions };
      case 'buy':
        return { type: 'checkpointHolder', slot, checkpoint: a[accountIndex('buy', 'checkpoint')], holder: a[accountIndex('buy', 'buyer')] };
      case 'gift':
        return { type: 'checkpointHolder', slot, checkpoint: a[accountIndex('gift', 'checkpoint')], holder: p.newHolder };
      case 'withdraw':
        return { type: 'withdraw', slot, checkpoint: a[accountIndex('withdraw', 'checkpoint')] };
      case 'payFee':
        return { type: 'feeReceipt', slot, lamports: p.lamports, receipt: p.receipt, payer: a[accountIndex('payFee', 'payer')] };
      case 'list':
      case 'cancel':
      case 'postEpoch':
      case 'claim':
      case 'setRoles':
      case 'vetoEpoch':
      case 'offerAdmin':
      case 'acceptAdmin':
        return null; // the market's and the payouts' concern, not ownership
    }
  }
}

/**
 * Each wallet's total balance across its token accounts, kept from transactions' pre- and post-
 * balances. An account seen for the first time is taken at its pre-balance, so the book does not
 * need to have seen every earlier transaction of it. A wallet's other accounts it has never seen
 * count as 0; the indexer seeds a newly registered wallet from getTokenAccountsByOwner.
 */
export class BalanceBook {
  private readonly accounts = new Map<string, { owner: string; amount: number }>();
  private readonly totals = new Map<string, number>();

  total(wallet: string): number {
    return this.totals.get(wallet) ?? 0;
  }

  /** One token account as the book has it, or undefined if never seen. */
  get(account: string): { owner: string; amount: number } | undefined {
    return this.accounts.get(account);
  }

  /** Every token account the book knows, with its owner. */
  entries(): { account: string; owner: string; amount: number }[] {
    return [...this.accounts].map(([account, v]) => ({ account, owner: v.owner, amount: v.amount }));
  }

  /** Records an account's current state without emitting events (seeding). */
  seed(account: string, owner: string, amount: number): void {
    this.set(account, owner, amount);
  }

  /**
   * Applies a transaction's balances; returns balance events for wallets whose total changed.
   * Throws if a known account's pre-balance disagrees with the book: a transaction was missed, and
   * carrying on would pay the wrong neurons.
   */
  apply(slot: number, pre: Observation[], post: Observation[]): Event[] {
    for (const o of pre) {
      const known = this.accounts.get(o.account);
      if (!known) this.set(o.account, o.owner, o.amount);
      else if (known.amount !== o.amount || known.owner !== o.owner) {
        throw new DecodeError(`balance book out of step at slot ${slot}: ${o.account} held ${known.amount} (${known.owner}), the chain says ${o.amount} (${o.owner})`);
      }
    }
    const touched = new Set<string>();
    const before = new Map<string, number>();
    const note = (w: string) => { if (!before.has(w)) before.set(w, this.total(w)); touched.add(w); };
    const after = new Map(post.map((o) => [o.account, o]));
    for (const account of new Set([...pre.map((o) => o.account), ...post.map((o) => o.account)])) {
      const old = this.accounts.get(account);
      if (old) note(old.owner);
      const now = after.get(account);
      if (now) { note(now.owner); this.set(account, now.owner, now.amount); }
      else this.set(account, old?.owner ?? '', 0); // closed
    }
    return [...touched]
      .filter((w) => w !== '' && this.total(w) !== before.get(w))
      .sort()
      .map((wallet) => ({ type: 'balance', slot, wallet, balance: this.total(wallet) }));
  }

  private set(account: string, owner: string, amount: number): void {
    const old = this.accounts.get(account);
    if (old) this.totals.set(old.owner, this.total(old.owner) - old.amount);
    if (amount === 0 && owner === '') { this.accounts.delete(account); return; }
    this.accounts.set(account, { owner, amount });
    this.totals.set(owner, this.total(owner) + amount);
  }
}

/** A decoded transaction's events in the ledger's order: actions, then balance changes. */
export function eventsOf(tx: DecodedTx, book: BalanceBook): Event[] {
  return [...tx.actions, ...book.apply(tx.slot, tx.pre, tx.post)];
}

function safe(amount: string | number): number {
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || n < 0) throw new DecodeError(`token amount ${amount} out of range`);
  return n;
}

function discriminatorOf(ix: Ix): string {
  return ix.data ? Buffer.from(decodeBase58(ix.data).subarray(0, 8)).toString('hex') : '';
}

function accountKeys(tx: any): string[] {
  const raw = tx.transaction.message.accountKeys;
  const keys: string[] = raw.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  // jsonParsed normally lists lookup-table keys (source: "lookupTable"); add them if it did not.
  const loaded = tx.meta.loadedAddresses;
  if (loaded && !raw.some((k: any) => k?.source === 'lookupTable')) {
    keys.push(...(loaded.writable ?? []), ...(loaded.readonly ?? []));
  }
  return keys;
}

/** Top-level instructions, each followed by its inner instructions, with each one's direct parent. */
export function executionOrder(tx: any): { ix: Ix; parent: Ix | null }[] {
  const out: { ix: Ix; parent: Ix | null }[] = [];
  const inner = new Map<number, Ix[]>();
  for (const group of tx.meta.innerInstructions ?? []) inner.set(group.index, group.instructions);
  tx.transaction.message.instructions.forEach((top: Ix, i: number) => {
    out.push({ ix: top, parent: null });
    const stack: Ix[] = [top];
    for (const ix of inner.get(i) ?? []) {
      const height = ix.stackHeight ?? 2;
      stack.length = Math.max(1, height - 1);
      out.push({ ix, parent: stack[stack.length - 1] });
      stack.push(ix);
    }
  });
  return out;
}
