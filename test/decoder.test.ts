import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Decoder, BalanceBook, eventsOf, executionOrder } from '../brain/decoder.ts';
import { encode, decode, discriminator, ACCOUNTS } from '../brain/program.ts';
import { encodeBase58 } from '../brain/base58.ts';
import { Ledger, type Event } from '../brain/ledger.ts';
import { total } from '../brain/ranges.ts';

const MINT = 'Mint1111111111111111111111111111111111111111';
const CURVE = 'Curve111111111111111111111111111111111111111';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PROGRAM = 'NeuraLs1111111111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const decoder = new Decoder({ mint: MINT, curveTokenAccount: CURVE, pumpProgramId: PUMP, pumpNonBuyInstructions: ['migrate', 'withdraw'], programId: PROGRAM });

const pumpData = (name: string) => encodeBase58(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
const pumpIx = (name: string) => ({ programId: PUMP, accounts: [], data: pumpData(name) });
const transfer = (source: string, destination: string, amount: number, stackHeight = 2) => ({
  programId: TOKEN, stackHeight,
  parsed: { type: 'transferChecked', info: { source, destination, mint: MINT, tokenAmount: { amount: String(amount) } } },
});
type Bal = { account: string; owner: string; amount: number; mint?: string };

/** Builds a jsonParsed transaction: top-level instructions, their inner ones, and token balances. */
function tx(o: { slot?: number; top: any[]; inner?: Record<number, any[]>; pre?: Bal[]; post?: Bal[]; err?: unknown }) {
  const keys: string[] = [];
  const key = (k: string) => { let i = keys.indexOf(k); if (i < 0) { keys.push(k); i = keys.length - 1; } return i; };
  const bal = (bs: Bal[] = []) => bs.map((b) => ({ accountIndex: key(b.account), mint: b.mint ?? MINT, owner: b.owner, uiTokenAmount: { amount: String(b.amount) } }));
  const pre = bal(o.pre);
  const post = bal(o.post);
  return {
    slot: o.slot ?? 10,
    transaction: { signatures: ['sig'], message: { accountKeys: keys.map((pubkey) => ({ pubkey, signer: false })), instructions: o.top } },
    meta: {
      err: o.err ?? null,
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: Object.entries(o.inner ?? {}).map(([index, instructions]) => ({ index: Number(index), instructions })),
    },
  };
}

/** A pump.fun instruction moving `amount` from the curve to `ata` (owned by `wallet`). */
const curveTx = (name: string, wallet: string, ata: string, amount: number, before = 0) => tx({
  top: [pumpIx(name)],
  inner: { 0: [transfer(CURVE, ata, amount)] },
  pre: [{ account: CURVE, owner: 'curve-pda', amount: 1e15 }, { account: ata, owner: wallet, amount: before }],
  post: [{ account: CURVE, owner: 'curve-pda', amount: 1e15 - amount }, { account: ata, owner: wallet, amount: before + amount }],
});

test('a pump.fun buy is a curve buy for the owner of the receiving account', () => {
  const d = decoder.decode(curveTx('buy', 'alice', 'aliceAta', 5_000))!;
  assert.deepEqual(d.actions, [{ type: 'curveBuy', slot: 10, wallet: 'alice', amount: 5_000 }]);
});

test('buys are defined by exclusion: new buy variants count, migrations do not', () => {
  assert.equal(decoder.decode(curveTx('buy_exact_sol_in', 'a', 'aAta', 7))!.actions[0].type, 'curveBuy');
  assert.equal(decoder.decode(curveTx('buy_v2', 'a', 'aAta', 7))!.actions[0].type, 'curveBuy');
  assert.deepEqual(decoder.decode(curveTx('migrate', 'pool', 'poolAta', 7))!.actions, []);
});

test('a pump.fun sell is a sell-back; a plain transfer into the curve is a donation and ignored', () => {
  const sell = tx({
    top: [pumpIx('sell')],
    inner: { 0: [transfer('aAta', CURVE, 300)] },
    pre: [{ account: 'aAta', owner: 'a', amount: 1_000 }], post: [{ account: 'aAta', owner: 'a', amount: 700 }],
  });
  assert.deepEqual(decoder.decode(sell)!.actions, [{ type: 'curveSell', slot: 10, wallet: 'a', amount: 300 }]);
  const donation = tx({
    top: [transfer('aAta', CURVE, 300, 1)],
    pre: [{ account: 'aAta', owner: 'a', amount: 1_000 }], post: [{ account: 'aAta', owner: 'a', amount: 700 }],
  });
  assert.deepEqual(decoder.decode(donation)!.actions, []);
});

test('other mints and failed transactions change nothing', () => {
  const other = tx({
    top: [pumpIx('buy')],
    inner: { 0: [{ ...transfer(CURVE, 'aAta', 5), parsed: { type: 'transferChecked', info: { source: CURVE, destination: 'aAta', mint: 'OtherMint', tokenAmount: { amount: '5' } } } }] },
  });
  assert.deepEqual(decoder.decode(other)!.actions, []);
  assert.equal(decoder.decode({ ...curveTx('buy', 'a', 'aAta', 5), meta: { ...curveTx('buy', 'a', 'aAta', 5).meta, err: { InstructionError: [0, 'Custom'] } } }), null);
});

test('inner instructions get their direct parent from stack height', () => {
  const t = tx({ top: [{ programId: 'Router' }], inner: { 0: [pumpIx('buy'), { ...transfer(CURVE, 'x', 1), stackHeight: 3 }] } });
  const order = executionOrder(t);
  assert.equal(order[2].parent!.programId, PUMP);
  // A buy routed through an aggregator is still a curve buy.
  const routed = tx({
    top: [{ programId: 'Router' }],
    inner: { 0: [{ ...pumpIx('buy'), stackHeight: 2 }, transfer(CURVE, 'bAta', 9, 3)] },
    pre: [{ account: 'bAta', owner: 'b', amount: 0 }], post: [{ account: 'bAta', owner: 'b', amount: 9 }],
  });
  assert.deepEqual(decoder.decode(routed)!.actions, [{ type: 'curveBuy', slot: 10, wallet: 'b', amount: 9 }]);
});

test('program instructions round-trip through encode and decode', () => {
  const holder = encodeBase58(new Uint8Array(32).fill(9));
  const cases = [
    { name: 'seal', positions: [[0, 100], [500, 900]], amount: 500 },
    { name: 'carry', positions: [[3, 4]], amount: 1 },
    { name: 'list', price: 123n },
    { name: 'cancel' },
    { name: 'buy', maxPrice: 456n },
    { name: 'gift', newHolder: holder },
    { name: 'withdraw' },
    { name: 'payFee', receipt: 'ab'.repeat(32), lamports: 5_000 },
    { name: 'postEpoch', epoch: 3, root: 'cd'.repeat(32), total: 10n ** 12n, count: 17 },
    { name: 'claim', epoch: 3, index: 5, amount: 99n, proof: ['ee'.repeat(32), 'ff'.repeat(32)] },
    { name: 'setRoles', settler: holder, treasury: holder, feeBps: 150 },
    { name: 'vetoEpoch', epoch: 4 },
  ] as const;
  for (const c of cases) assert.deepEqual(decode(encode(c as any)), c);
  assert.equal(decode(Buffer.from('not ours at all')), null);
  assert.throws(() => decode(Buffer.concat([encode({ name: 'cancel' }), Buffer.from([1])])), /trailing/);
  assert.throws(() => decode(discriminator('seal')), /too short/);
  assert.equal(discriminator('payFee').toString('hex'), createHash('sha256').update('global:pay_fee').digest().subarray(0, 8).toString('hex'));
});

const programIx = (ix: Parameters<typeof encode>[0], accounts: Record<string, string>) => ({
  programId: PROGRAM,
  accounts: (ACCOUNTS[ix.name] as readonly string[]).map((a) => accounts[a] ?? `${a}-acct`),
  data: encodeBase58(encode(ix)),
});

test('program instructions become ledger events with the right accounts', () => {
  const d = (ix: Parameters<typeof encode>[0], accounts: Record<string, string>) => decoder.decode(tx({ top: [programIx(ix, accounts)] }))!.actions;
  assert.deepEqual(d({ name: 'seal', positions: [[10, 20]], amount: 10 }, { owner: 'alice', checkpoint: 'cp1' }),
    [{ type: 'seal', slot: 10, checkpoint: 'cp1', wallet: 'alice', amount: 10, positions: [[10, 20]] }]);
  assert.deepEqual(d({ name: 'carry', positions: [[1, 2]], amount: 1 }, { from: 'alice', to: 'bob' }),
    [{ type: 'carry', slot: 10, from: 'alice', to: 'bob', amount: 1, positions: [[1, 2]] }]);
  assert.deepEqual(d({ name: 'buy', maxPrice: 9n }, { buyer: 'bob', checkpoint: 'cp1' }),
    [{ type: 'checkpointHolder', slot: 10, checkpoint: 'cp1', holder: 'bob' }]);
  const carol = encodeBase58(new Uint8Array(32).fill(3));
  assert.deepEqual(d({ name: 'gift', newHolder: carol }, { checkpoint: 'cp1' }),
    [{ type: 'checkpointHolder', slot: 10, checkpoint: 'cp1', holder: carol }]);
  assert.deepEqual(d({ name: 'withdraw' }, { checkpoint: 'cp1' }), [{ type: 'withdraw', slot: 10, checkpoint: 'cp1' }]);
  assert.deepEqual(d({ name: 'payFee', receipt: 'cd'.repeat(32), lamports: 77 }, { payer: 'api' }),
    [{ type: 'feeReceipt', slot: 10, lamports: 77, receipt: 'cd'.repeat(32), payer: 'api' }]);
  assert.deepEqual(d({ name: 'list', price: 1n }, {}), []);
});

test('balance book: wallet totals across accounts, owner changes, first sight from pre-balances', () => {
  const book = new BalanceBook();
  // First sight of aAta: it already held 100 before this transaction.
  assert.deepEqual(book.apply(1, [{ account: 'aAta', owner: 'a', amount: 100 }], [{ account: 'aAta', owner: 'a', amount: 150 }]),
    [{ type: 'balance', slot: 1, wallet: 'a', balance: 150 }]);
  // A second account of the same wallet adds to its total.
  assert.deepEqual(book.apply(2, [], [{ account: 'a2', owner: 'a', amount: 50 }]), [{ type: 'balance', slot: 2, wallet: 'a', balance: 200 }]);
  // Handing an account to another owner moves its balance between wallets.
  assert.deepEqual(book.apply(3, [{ account: 'a2', owner: 'a', amount: 50 }], [{ account: 'a2', owner: 'b', amount: 50 }]),
    [{ type: 'balance', slot: 3, wallet: 'a', balance: 150 }, { type: 'balance', slot: 3, wallet: 'b', balance: 50 }]);
  // A closed account (gone from post-balances) counts as 0.
  assert.deepEqual(book.apply(4, [{ account: 'a2', owner: 'b', amount: 50 }], []), [{ type: 'balance', slot: 4, wallet: 'b', balance: 0 }]);
  // A pre-balance that disagrees with the book means a missed transaction: halt.
  assert.throws(() => book.apply(6, [{ account: 'aAta', owner: 'a', amount: 999 }], []), /out of step/);
  // No change, no event.
  assert.deepEqual(book.apply(5, [{ account: 'aAta', owner: 'a', amount: 150 }], [{ account: 'aAta', owner: 'a', amount: 150 }]), []);
});

test('end to end: decoded transactions drive the ledger', () => {
  const ledger = new Ledger({ startSlot: 0, epochSlots: 1000 });
  const book = new BalanceBook();
  const feed = (t: any) => { for (const e of eventsOf(decoder.decode(t)!, book)) ledger.apply(e); };
  feed(curveTx('buy', 'alice', 'aliceAta', 5_000_000));
  assert.equal(total(ledger.positions('alice')), 5_000_000);
  assert.equal(ledger.balanceOf('alice'), 5_000_000);
  // Alice sells 2,000,000 back to the curve: her neurons stay registered, part goes dormant.
  feed(tx({
    slot: 11, top: [pumpIx('sell')], inner: { 0: [transfer('aliceAta', CURVE, 2_000_000)] },
    pre: [{ account: 'aliceAta', owner: 'alice', amount: 5_000_000 }], post: [{ account: 'aliceAta', owner: 'alice', amount: 3_000_000 }],
  }));
  assert.equal(total(ledger.positions('alice')), 5_000_000);
  assert.equal(total(ledger.awake('alice')), 3_000_000);
  assert.equal(ledger.returned, 2_000_000);
  // Seal: the program event comes before the same transaction's balance change, so it is judged on
  // the balance going in.
  const seal = tx({
    slot: 12, top: [programIx({ name: 'seal', positions: [[0, 1_000_000]], amount: 1_000_000 }, { owner: 'alice', checkpoint: 'cp' })],
    pre: [{ account: 'aliceAta', owner: 'alice', amount: 3_000_000 }],
    post: [{ account: 'aliceAta', owner: 'alice', amount: 2_000_000 }, { account: 'cpTokens', owner: 'cp', amount: 1_000_000 }],
  });
  const ordered = eventsOf(decoder.decode(seal)!, book);
  assert.deepEqual(ordered.map((e) => e.type), ['seal', 'balance', 'balance']);
  for (const e of ordered) ledger.apply(e);
  assert.deepEqual(ledger.checkpointPositions('cp'), [[0, 1_000_000]]);
});

test('malformed amounts halt decoding', () => {
  assert.throws(() => decoder.decode(curveTx('buy', 'a', 'aAta', 1e17)), /out of range/);
  assert.throws(() => decoder.decode({ slot: 1, transaction: {} }), /no meta/);
});
