// The indexer against a small fake chain: holders' accounts are followed through one balance snapshot
// per poll (not one transaction scan per holder), and what the snapshot cannot see is still found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer } from '../indexer/indexer.ts';
import { Store } from '../indexer/store.ts';
import { encodeBase58 } from '../brain/base58.ts';
import type { Rpc } from '../indexer/rpc.ts';
Indexer.LAG = 0; // the fake chain's transaction lists are never behind

const MINT = 'Mint1111111111111111111111111111111111111111';
const CURVE = 'Curve111111111111111111111111111111111111111';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PROGRAM = 'NeuraLs1111111111111111111111111111111111111';
const TOKEN = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const NEURON = 3_000_000_000; // 3,000 tokens of 6 decimals

type Bal = { account: string; owner: string; amount: number };
type ChainTx = { sig: string; slot: number; raw: any; pre: Bal[]; post: Bal[] };

const pumpIx = { programId: PUMP, accounts: [], data: encodeBase58(createHash('sha256').update('global:buy').digest().subarray(0, 8)) };
const transferIx = (source: string, destination: string, amount: number, stackHeight: number | null) => ({
  programId: TOKEN, stackHeight,
  parsed: { type: 'transferChecked', info: { source, destination, mint: MINT, tokenAmount: { amount: String(amount) } } },
});

/** A fake chain: token balances move only through the transactions added to it. */
class Chain {
  txs: ChainTx[] = [];
  balances = new Map<string, Bal>([[CURVE, { account: CURVE, owner: 'curve-pda', amount: 793_100_000 * 1e6 }]]);
  finalized = 0;
  calls: Record<string, number> = {};
  /** Make the next snapshot report these accounts as the book last had them (a read that raced a change). */
  staleSnapshot = new Map<string, Bal>();

  private add(slot: number, moves: { from: string; to: string; toOwner: string; amount: number }[], viaCurve: boolean) {
    const sig = `sig${this.txs.length + 1}`.padEnd(64, 'x');
    const touched = [...new Set(moves.flatMap((m) => [m.from, m.to]))];
    const pre = touched.map((a) => ({ ...(this.balances.get(a) ?? { account: a, owner: moves.find((m) => m.to === a)!.toOwner, amount: 0 }) }));
    for (const m of moves) {
      const f = this.balances.get(m.from)!;
      f.amount -= m.amount;
      const t = this.balances.get(m.to) ?? { account: m.to, owner: m.toOwner, amount: 0 };
      t.amount += m.amount;
      this.balances.set(m.to, t);
    }
    const post = touched.map((a) => ({ ...this.balances.get(a)! }));
    const keys = [...touched];
    const bal = (bs: Bal[]) => bs.map((b) => ({ accountIndex: keys.indexOf(b.account), mint: MINT, owner: b.owner, uiTokenAmount: { amount: String(b.amount) } }));
    const top = viaCurve ? [pumpIx] : moves.map((m) => transferIx(m.from, m.to, m.amount, null));
    const inner = viaCurve ? [{ index: 0, instructions: moves.map((m) => transferIx(m.from, m.to, m.amount, 2)) }] : [];
    const raw = {
      slot,
      transaction: { signatures: [sig], message: { accountKeys: keys.map((pubkey) => ({ pubkey, signer: false })), instructions: top } },
      meta: { err: null, preTokenBalances: bal(pre), postTokenBalances: bal(post), innerInstructions: inner },
    };
    this.txs.push({ sig, slot, raw, pre, post });
  }
  buy(slot: number, wallet: string, neurons: number) { this.add(slot, [{ from: CURVE, to: `${wallet}Ata`, toOwner: wallet, amount: neurons * NEURON }], true); }
  send(slot: number, from: string, to: string, amount: number) { this.add(slot, [{ from: `${from}Ata`, to: `${to}Ata`, toOwner: to, amount }], false); }

  /** Each account as of the finalized slot. */
  private stateAt(slot: number, account: string): Bal | null {
    let last: Bal | null = null;
    for (const t of this.txs) if (t.slot <= slot) for (const b of t.post) if (b.account === account) last = b;
    return last;
  }

  rpc(): Rpc {
    const count = (m: string) => { this.calls[m] = (this.calls[m] ?? 0) + 1; };
    return {
      slot: async () => { count('getSlot'); return this.finalized; },
      tokenSnapshot: async (accounts: string[]) => {
        if (accounts.length) count('getMultipleAccounts');
        const states = new Map<string, { owner: string; amount: number } | null>();
        for (const a of accounts) {
          const s = this.staleSnapshot.get(a) ?? this.stateAt(this.finalized, a);
          states.set(a, s && { owner: s.owner, amount: s.amount });
        }
        this.staleSnapshot.clear();
        return { slot: accounts.length ? this.finalized : null, states };
      },
      signaturesSince: async (address: string, after: number, max: number) => {
        count(`sigs:${address}`);
        return this.txs.filter((t) => t.slot > after && t.slot <= max && t.pre.some((b) => b.account === address))
          .map((t) => ({ signature: t.sig, slot: t.slot, err: null }));
      },
      transaction: async (sig: string) => { count('getTransaction'); return this.txs.find((t) => t.sig === sig)!.raw; },
      blockSignatures: async (slot: number) => this.txs.filter((t) => t.slot === slot).map((t) => t.sig),
    } as unknown as Rpc;
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'neurals-indexer-'));
  const chain = new Chain();
  const indexer = new Indexer({ mint: MINT, curveTokenAccount: CURVE, pumpProgramId: PUMP, pumpNonBuyInstructions: ['migrate', 'withdraw'], programId: PROGRAM, startSlot: 1, epochSlots: 1000 }, chain.rpc(), new Store(dir));
  return { chain, indexer, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('holders are read in one snapshot; only a changed account is scanned for transactions', async () => {
  const { chain, indexer, done } = setup();
  chain.buy(10, 'alice', 3);
  chain.buy(11, 'bob', 2);
  chain.finalized = 15;
  await indexer.syncOnce();
  assert.equal(indexer.book.total('alice'), 3 * NEURON);

  // A quiet poll: one snapshot, the curve and the program, and no holder scanned.
  chain.calls = {};
  chain.finalized = 25;
  await indexer.syncOnce();
  assert.equal(chain.calls['getMultipleAccounts'], 1);
  assert.equal(chain.calls['sigs:aliceAta'], undefined);
  assert.equal(chain.calls['sigs:bobAta'], undefined);

  // Alice sends tokens away outside the curve: the snapshot sees her balance change, so she is scanned.
  chain.send(30, 'alice', 'carol', NEURON);
  chain.calls = {};
  chain.finalized = 35;
  await indexer.syncOnce();
  assert.equal(chain.calls['sigs:aliceAta'], 1);
  assert.equal(chain.calls['sigs:bobAta'], undefined);
  assert.equal(indexer.book.total('alice'), 2 * NEURON);
  assert.equal(indexer.ledger.balanceOf('alice'), 2 * NEURON);
  done();
});

test('a change the snapshot missed, inside the poll, is found and applied in order', async () => {
  const { chain, indexer, done } = setup();
  chain.buy(10, 'alice', 3);
  chain.finalized = 15;
  await indexer.syncOnce();

  chain.send(20, 'alice', 'carol', NEURON);
  chain.buy(22, 'alice', 1);
  chain.staleSnapshot.set('aliceAta', { account: 'aliceAta', owner: 'alice', amount: 3 * NEURON }); // the read raced the change
  chain.finalized = 25;
  await indexer.syncOnce();
  assert.deepEqual(indexer.repairs, { found: 1, corrected: 0 });
  assert.equal(indexer.book.total('alice'), 3 * NEURON);
  assert.equal(indexer.ledger.balanceOf('alice'), 3 * NEURON);
  done();
});

test('a change from an earlier poll that was never seen is corrected, not a halt', async () => {
  const { chain, indexer, done } = setup();
  chain.buy(10, 'alice', 3);
  chain.finalized = 15;
  await indexer.syncOnce();

  chain.send(20, 'alice', 'carol', NEURON);
  chain.staleSnapshot.set('aliceAta', { account: 'aliceAta', owner: 'alice', amount: 3 * NEURON });
  chain.finalized = 25;
  await indexer.syncOnce(); // missed: the snapshot said nothing changed
  assert.equal(indexer.book.total('alice'), 3 * NEURON);

  // Make the next snapshot miss it too, so the curve buy is what reveals it.
  chain.buy(30, 'alice', 1);
  chain.staleSnapshot.set('aliceAta', { account: 'aliceAta', owner: 'alice', amount: 3 * NEURON });
  chain.finalized = 35;
  await indexer.syncOnce();
  assert.deepEqual(indexer.repairs, { found: 0, corrected: 1 });
  assert.equal(indexer.book.total('alice'), 3 * NEURON);
  assert.equal(indexer.ledger.balanceOf('alice'), 3 * NEURON);
  done();
});

test('the log replays to the same ledger, corrections included', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'neurals-indexer-'));
  const chain = new Chain();
  const cfg = { mint: MINT, curveTokenAccount: CURVE, pumpProgramId: PUMP, pumpNonBuyInstructions: ['migrate', 'withdraw'], programId: PROGRAM, startSlot: 1, epochSlots: 10 };
  const a = new Indexer(cfg, chain.rpc(), new Store(dir));
  chain.buy(10, 'alice', 3);
  chain.finalized = 15; await a.syncOnce();
  chain.send(20, 'alice', 'carol', NEURON);
  chain.staleSnapshot.set('aliceAta', { account: 'aliceAta', owner: 'alice', amount: 3 * NEURON });
  chain.finalized = 25; await a.syncOnce();
  chain.buy(30, 'alice', 1);
  chain.staleSnapshot.set('aliceAta', { account: 'aliceAta', owner: 'alice', amount: 3 * NEURON });
  chain.finalized = 35; await a.syncOnce();

  const b = new Indexer(cfg, chain.rpc(), new Store(dir));
  b.restore();
  assert.equal(b.ledger.fingerprint(), a.ledger.fingerprint());
  assert.equal(b.syncedSlot, 35);
  rmSync(dir, { recursive: true, force: true });
});
