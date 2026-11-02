import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, type Event, type Settlement } from '../brain/ledger.ts';
import { SLOTS, SUPPLY, PARTS } from '../brain/layout.ts';
import { UNIT, TOKENS, SEGMENT_COUNT } from '../brain/model.ts';
import { shares } from '../brain/receipt.ts';
import { total } from '../brain/ranges.ts';

const EPOCH = 100;
const t = (tokens: number) => tokens * UNIT;
const ledger = () => new Ledger({ startSlot: 0, epochSlots: EPOCH });
/** Applies events and collects every settlement. */
function run(l: Ledger, events: Event[]): Settlement[] {
  return events.flatMap((e) => l.apply(e));
}
/** A buy plus the balance it leaves (one wallet, one buy). */
const buy = (slot: number, wallet: string, tokens: number, balanceAfter = tokens): Event[] => [
  { type: 'curveBuy', slot, wallet, amount: t(tokens) },
  { type: 'balance', slot, wallet, balance: t(balanceAfter) },
];
const evenFee = (slot: number, lamports: number): Event => ({ type: 'fee', slot, lamports, shares: shares(PARTS.map(() => 1)) });

// Slot 0 is the Embedding, 1-12 the heads of band 0, 13.. its columns.
const COL0 = SLOTS[13];
const COL1 = SLOTS[14];

test('curve buys issue positions in buying order; re-bought sell-backs issue nothing', () => {
  const l = ledger();
  run(l, [...buy(1, 'A', TOKENS.embedding), ...buy(2, 'B', 1_000)]);
  assert.deepEqual(l.positions('A'), [[0, t(TOKENS.embedding)]]);
  assert.deepEqual(l.positions('B'), [[t(TOKENS.embedding), t(TOKENS.embedding + 1_000)]]);
  run(l, [{ type: 'curveSell', slot: 3, wallet: 'B', amount: t(400) }, ...buy(4, 'C', 1_000)]);
  // C's first 400 came from B's sell-back: no positions. The other 600 are fresh.
  assert.equal(total(l.positions('C')), t(600));
  assert.deepEqual(l.positions('B'), [[t(TOKENS.embedding), t(TOKENS.embedding + 1_000)]], 'B keeps every position: neurons never die');
  assert.equal(l.cursor, t(TOKENS.embedding + 1_600));
});

test('the curve never issues past its supply', () => {
  const l = ledger();
  run(l, buy(1, 'A', 900_000_000));
  assert.equal(l.cursor, SUPPLY);
  assert.equal(total(l.positions('A')), SUPPLY);
});

test('dormant and wake: the balance decides how many neurons are awake, lowest first before the reveal', () => {
  const l = ledger();
  run(l, buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head));
  assert.equal(total(l.awake('A')), total(l.positions('A')));
  run(l, [{ type: 'balance', slot: 2, wallet: 'A', balance: t(TOKENS.embedding) }]);
  assert.deepEqual(l.awake('A'), [[0, t(TOKENS.embedding)]], 'the embedding (lowest positions) stays awake');
  assert.equal(total(l.positions('A')), t(TOKENS.embedding + 2 * TOKENS.head), 'nothing is lost');
  run(l, [{ type: 'balance', slot: 3, wallet: 'A', balance: t(10_000_000) }]);
  assert.equal(total(l.awake('A')), total(l.positions('A')), 'buying back wakes them');
});

test('after the reveal, the rarest neurons stay awake first', () => {
  const l = ledger();
  run(l, buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head));
  const identity = SLOTS.map((s) => s.index);
  const points = PARTS.map((p) => (p.index === 2 ? 85 : 0)); // head 1 of layer 0 is an Induction Head
  l.reveal(identity, points);
  run(l, [{ type: 'balance', slot: 2, wallet: 'A', balance: t(TOKENS.head) }]);
  assert.deepEqual(l.awake('A'), [[SLOTS[2].start, SLOTS[2].end]]);
  assert.throws(() => l.reveal(identity, points), /already revealed/);
});

test('seal: only owned, awake positions move into the checkpoint; the rest are ignored', () => {
  const l = ledger();
  run(l, [...buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head), ...buy(2, 'B', TOKENS.head)]);
  const h1 = SLOTS[1];
  const h2 = SLOTS[2];
  const bHead = SLOTS[3];
  // A names its own head 1 and B's head: only head 1 moves.
  run(l, [{ type: 'seal', slot: 3, checkpoint: 'cp1', wallet: 'A', amount: t(2 * TOKENS.head), positions: [[h1.start, h1.end], [bHead.start, bHead.end]] }]);
  assert.deepEqual(l.checkpointPositions('cp1'), [[h1.start, h1.end]]);
  assert.equal(l.holderOf('cp1'), 'A');
  assert.deepEqual(l.positions('B'), [[bHead.start, bHead.end]], "B's neurons are untouched");
  // A's balance drops to cover only the embedding, so head 2 is dormant and cannot be sealed.
  run(l, [
    { type: 'balance', slot: 3, wallet: 'A', balance: t(TOKENS.embedding + TOKENS.head) },
    { type: 'balance', slot: 4, wallet: 'A', balance: t(TOKENS.embedding) },
    { type: 'seal', slot: 5, checkpoint: 'cp2', wallet: 'A', amount: t(TOKENS.head), positions: [[h2.start, h2.end]] },
  ]);
  assert.deepEqual(l.checkpointPositions('cp2'), []);
  // Naming more positions than tokens moved is ignored entirely.
  run(l, [{ type: 'seal', slot: 6, checkpoint: 'cp3', wallet: 'A', amount: t(1), positions: [[0, t(2)]] }]);
  assert.deepEqual(l.checkpointPositions('cp3'), []);
});

test('checkpoints change holder by sale or gift, and withdraw returns every position to the holder', () => {
  const l = ledger();
  run(l, buy(1, 'A', TOKENS.embedding + TOKENS.head));
  const h1 = SLOTS[1];
  run(l, [
    { type: 'seal', slot: 2, checkpoint: 'cp', wallet: 'A', amount: t(TOKENS.head), positions: [[h1.start, h1.end]] },
    { type: 'checkpointHolder', slot: 3, checkpoint: 'cp', holder: 'B' },
    { type: 'withdraw', slot: 4, checkpoint: 'cp' },
  ]);
  assert.deepEqual(l.positions('B'), [[h1.start, h1.end]]);
  assert.equal(l.holderOf('cp'), undefined);
  assert.throws(() => l.apply({ type: 'withdraw', slot: 5, checkpoint: 'cp' }), /no checkpoint/);
  assert.throws(() => l.apply({ type: 'checkpointHolder', slot: 5, checkpoint: 'zz', holder: 'C' }), /no checkpoint/);
});

test('sealing into a checkpoint that already exists is impossible and halts', () => {
  const l = ledger();
  run(l, buy(1, 'A', TOKENS.embedding));
  run(l, [{ type: 'seal', slot: 2, checkpoint: 'cp', wallet: 'A', amount: t(1), positions: [] }]);
  assert.throws(() => l.apply({ type: 'seal', slot: 3, checkpoint: 'cp', wallet: 'A', amount: t(1), positions: [] }), /already exists/);
});

test('carry moves tokens and their awake positions to another wallet', () => {
  const l = ledger();
  run(l, buy(1, 'A', TOKENS.embedding + TOKENS.head));
  const h1 = SLOTS[1];
  run(l, [{ type: 'carry', slot: 2, from: 'A', to: 'B', amount: t(TOKENS.head), positions: [[h1.start, h1.end]] }]);
  assert.deepEqual(l.positions('B'), [[h1.start, h1.end]]);
  assert.deepEqual(l.positions('A'), [[0, t(TOKENS.embedding)]]);
});

test('events out of slot order halt', () => {
  const l = ledger();
  l.apply({ type: 'curveSell', slot: 10, wallet: 'A', amount: 1 });
  assert.throws(() => l.apply({ type: 'curveSell', slot: 9, wallet: 'A', amount: 1 }), /in order/);
});

// --- Fees ---------------------------------------------------------------------------------

/** A fills the Embedding and both heads 1-2, C column 0, D column 1; all bought in epoch 0. */
function owners(): Ledger {
  const l = ledger();
  const filler = (COL0.start - SLOTS[3].start) / UNIT; // heads 3..12 go to a wallet that sells them all
  run(l, [
    ...buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head),
    ...buy(2, 'Z', filler, 0),
    ...buy(3, 'C', TOKENS.column),
    ...buy(4, 'D', TOKENS.column),
  ]);
  return l;
}

test('positions earn from the first full epoch they are held, not the epoch they were bought in', () => {
  const l = owners();
  const s0 = run(l, [evenFee(50, 1_000_000), evenFee(EPOCH + 1, 2_000_000)]);
  assert.equal(s0.length, 1);
  assert.equal(s0[0].payouts.size, 0, 'nobody held anything for the whole of epoch 0');
  assert.equal(s0[0].carried, 1_000_000n, 'the fee is carried to the next epoch, not lost');
  const s1 = l.advanceTo(2 * EPOCH);
  assert.equal(s1[0].fees, 2_000_000n);
  const paid = [...s1[0].payouts.values()].reduce((a, b) => a + b, 0n);
  assert.equal(paid + s1[0].carried, 3_000_000n, 'every lamport is paid or carried');
});

test('equal holdings of equal parts earn equally; kinds are paid by their budgets', () => {
  const l = owners();
  l.advanceTo(EPOCH);
  run(l, [evenFee(EPOCH + 5, 10_000_000_000)]);
  const [s] = l.advanceTo(2 * EPOCH);
  const c = s.payouts.get('C')!;
  const d = s.payouts.get('D')!;
  const a = s.payouts.get('A')!;
  assert.equal(c, d);
  assert.equal(s.payouts.has('Z'), false, 'a wallet holding no tokens earns nothing');
  // Before the reveal, a column earns its kind's budget / 980 and the Embedding its whole budget;
  // A also holds 2 of 336 heads.
  const budget = { embedding: TOKENS.embedding, head: 336 * TOKENS.head, column: 980 * TOKENS.column };
  const expectA = budget.embedding + (2 / 336) * budget.head;
  const expectC = budget.column / 980;
  const ratio = Number(a) / Number(c);
  // Receipts carry whole ppm (the Embedding's 4,324.8 ppm budget becomes 4,325), so the split
  // matches the exact budgets to within rounding, not exactly.
  assert.ok(Math.abs(ratio / (expectA / expectC) - 1) < 1e-4, `A/C ${ratio} vs ${expectA / expectC}`);
});

test('dormant neurons earn nothing and their share goes to the awake ones', () => {
  const l = owners();
  l.advanceTo(EPOCH);
  // D sells half its tokens during epoch 1: half its column is dormant for the epoch.
  run(l, [{ type: 'balance', slot: EPOCH + 10, wallet: 'D', balance: t(TOKENS.column / 2) }, evenFee(EPOCH + 20, 1_000_000_000)]);
  const [s] = l.advanceTo(2 * EPOCH);
  const c = Number(s.payouts.get('C')!);
  const d = Number(s.payouts.get('D')!);
  assert.ok(Math.abs(d / c - 0.5) < 1e-6);
  const paid = [...s.payouts.values()].reduce((x, y) => x + y, 0n);
  assert.equal(paid + s.carried, 1_000_000_000n);
  assert.ok(s.carried < BigInt(s.payouts.size), 'only rounding is carried');
});

test('the lowest balance of the epoch counts: dipping and buying back before the payout earns the dip', () => {
  const l = owners();
  l.advanceTo(EPOCH);
  run(l, [
    { type: 'balance', slot: EPOCH + 10, wallet: 'D', balance: 0 },
    { type: 'balance', slot: EPOCH + 90, wallet: 'D', balance: t(TOKENS.column) },
    evenFee(EPOCH + 95, 1_000_000_000),
  ]);
  const [s] = l.advanceTo(2 * EPOCH);
  assert.equal(s.payouts.has('D'), false);
  // From the next epoch on, D earns again.
  run(l, [evenFee(2 * EPOCH + 5, 1_000_000_000)]);
  const [s2] = l.advanceTo(3 * EPOCH);
  assert.equal(s2.payouts.get('D'), s2.payouts.get('C'));
});

test('a dormant wallet cannot buy back and seal at the last moment to earn the whole epoch', () => {
  const l = owners();
  run(l, [{ type: 'balance', slot: 10, wallet: 'D', balance: 0 }]); // D sold everything in epoch 0
  l.advanceTo(EPOCH);
  run(l, [
    evenFee(EPOCH + 5, 1_000_000_000),
    { type: 'balance', slot: EPOCH + 98, wallet: 'D', balance: t(TOKENS.column) }, // buys back on an exchange
    { type: 'seal', slot: EPOCH + 99, checkpoint: 'late', wallet: 'D', amount: t(TOKENS.column), positions: [[COL1.start, COL1.end]] },
    { type: 'balance', slot: EPOCH + 99, wallet: 'D', balance: 0 },
  ]);
  assert.deepEqual(l.checkpointPositions('late'), [[COL1.start, COL1.end]], 'the seal itself is valid');
  const [s] = l.advanceTo(2 * EPOCH);
  assert.equal(s.payouts.has('D'), false, 'but the checkpoint did not hold them for the whole epoch');
  run(l, [evenFee(2 * EPOCH + 5, 1_000_000_000)]);
  const [s2] = l.advanceTo(3 * EPOCH);
  assert.equal(s2.payouts.get('D'), s2.payouts.get('C'), 'from the next epoch the checkpoint earns in full');
});

test('a checkpoint earns for whoever holds it at the end of the epoch', () => {
  const l = owners();
  run(l, [{ type: 'seal', slot: 10, checkpoint: 'cp', wallet: 'D', amount: t(TOKENS.column), positions: [[COL1.start, COL1.end]] },
    { type: 'balance', slot: 10, wallet: 'D', balance: 0 }]);
  l.advanceTo(EPOCH);
  run(l, [evenFee(EPOCH + 5, 1_000_000_000), { type: 'checkpointHolder', slot: EPOCH + 50, checkpoint: 'cp', holder: 'E' }]);
  const [s] = l.advanceTo(2 * EPOCH);
  assert.equal(s.payouts.get('E'), s.payouts.get('C'));
  assert.equal(s.payouts.has('D'), false);
});

test('after the reveal, a part that fired more earns its slot owner more', () => {
  const l = owners();
  // Reveal: column slots 13 and 14 hold parts 13 and 14 (identity).
  l.reveal(SLOTS.map((s) => s.index), new Array(SEGMENT_COUNT).fill(0));
  l.advanceTo(EPOCH);
  const mass = PARTS.map((p) => (p.index === 13 ? 3 : 1)); // part 13 fired three times as hard
  run(l, [{ type: 'fee', slot: EPOCH + 5, lamports: 1_000_000_000, shares: shares(mass) }]);
  const [s] = l.advanceTo(2 * EPOCH);
  const ratio = Number(s.payouts.get('C')!) / Number(s.payouts.get('D')!);
  assert.ok(Math.abs(ratio - 3) < 0.01, `ratio ${ratio}`);
});

test('fees with bad shares halt', () => {
  const l = ledger();
  assert.throws(() => l.apply({ type: 'fee', slot: 1, lamports: 5, shares: [1, 2] }));
  const bad = shares(PARTS.map(() => 1));
  bad[0] += 1;
  assert.throws(() => l.apply({ type: 'fee', slot: 1, lamports: 5, shares: bad }), /1,000,000/);
});

test('same events, same fingerprint; any difference changes it', () => {
  const events: Event[] = [...buy(1, 'A', 5_000_000), evenFee(50, 123_456), { type: 'balance', slot: 60, wallet: 'A', balance: t(10) }];
  const a = ledger();
  const b = ledger();
  run(a, events);
  run(b, events);
  assert.equal(a.fingerprint(), b.fingerprint());
  b.apply({ type: 'balance', slot: 61, wallet: 'A', balance: t(11) });
  assert.notEqual(a.fingerprint(), b.fingerprint());
});

test('receipt fees: shares are looked up at settlement; unknown receipts split evenly by kind', () => {
  const known = 'aa'.repeat(32);
  const unknown = 'bb'.repeat(32);
  const mass = PARTS.map((p) => (p.index === 13 ? 3 : 1));
  const make = () => {
    const l = new Ledger({ startSlot: 0, epochSlots: EPOCH, resolveReceipt: (h) => (h === known ? shares(mass) : null) });
    const filler = (COL0.start - SLOTS[3].start) / UNIT;
    run(l, [...buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head), ...buy(2, 'Z', filler, 0), ...buy(3, 'C', TOKENS.column), ...buy(4, 'D', TOKENS.column)]);
    l.reveal(SLOTS.map((s) => s.index), new Array(SEGMENT_COUNT).fill(0));
    l.advanceTo(EPOCH);
    return l;
  };
  const a = make();
  run(a, [{ type: 'feeReceipt', slot: EPOCH + 5, lamports: 1_000_000_000, receipt: known }]);
  const [sa] = a.advanceTo(2 * EPOCH);
  assert.ok(Math.abs(Number(sa.payouts.get('C')!) / Number(sa.payouts.get('D')!) - 3) < 0.01, 'the known receipt says part 13 fired 3x');
  const b = make();
  run(b, [{ type: 'feeReceipt', slot: EPOCH + 5, lamports: 1_000_000_000, receipt: unknown }]);
  const [sb] = b.advanceTo(2 * EPOCH);
  assert.equal(sb.payouts.get('C'), sb.payouts.get('D'), 'an unknown receipt splits evenly');
  assert.throws(() => b.apply({ type: 'feeReceipt', slot: 2 * EPOCH + 1, lamports: 1, receipt: 'nothex' }), /receipt hash/);
});

test('a pot carried from an epoch where nothing was awake is paid out later, even with no new fees', () => {
  const l = ledger();
  const filler = (COL0.start - SLOTS[3].start) / UNIT;
  run(l, [...buy(1, 'A', TOKENS.embedding + 2 * TOKENS.head), ...buy(2, 'Z', filler, 0), ...buy(3, 'C', TOKENS.column), ...buy(4, 'D', TOKENS.column)]);
  run(l, [evenFee(50, 1_000_000)]); // epoch 0: nobody has held a whole epoch yet
  const [s0] = l.advanceTo(EPOCH);
  assert.equal(s0.payouts.size, 0);
  assert.equal(s0.carried, 1_000_000n);
  const [s1] = l.advanceTo(2 * EPOCH); // epoch 1: no fees at all
  const paid = [...s1.payouts.values()].reduce((a, b) => a + b, 0n);
  assert.ok(paid > 990_000n, `only ${paid} of the carried 1,000,000 was paid`);
  assert.equal(paid + s1.carried, 1_000_000n);
  assert.equal(s1.payouts.get('C'), s1.payouts.get('D'));
});

test('rounding dust alone, with no fees, is still paid out eventually', () => {
  const l = owners();
  l.advanceTo(EPOCH);
  run(l, [evenFee(EPOCH + 5, 7)]); // a tiny fee leaves dust after integer division
  const [s1] = l.advanceTo(2 * EPOCH);
  const [s2] = l.advanceTo(3 * EPOCH);
  const paid = [s1, s2].flatMap((x) => [...x.payouts.values()]).reduce((a, b) => a + b, 0n);
  assert.equal(paid + s2.carried, 7n);
  assert.ok(s2.carried <= s1.carried, 'dust never grows');
});

test('trait bonus: a part with a trait earns (100 + points)/100, and kind budgets stay fixed', () => {
  const settleWith = (points: number[]) => {
    const l = owners();
    l.reveal(SLOTS.map((s) => s.index), points);
    l.advanceTo(EPOCH);
    run(l, [evenFee(EPOCH + 5, 1_000_000_000)]);
    return l.advanceTo(2 * EPOCH)[0];
  };
  const plain = settleWith(new Array(SEGMENT_COUNT).fill(0));
  const pts = new Array(SEGMENT_COUNT).fill(0);
  pts[13] = 100; // column 0 of layer 0 (held by C) is a Super Weight
  const boosted = settleWith(pts);
  const c = Number(boosted.payouts.get('C')!);
  const d = Number(boosted.payouts.get('D')!);
  assert.ok(Math.abs(c / d - 2) < 1e-6, `C/D ${c / d}`);
  // The boost takes a little from every column of the kind, including the 978 nobody owns, whose
  // shares go to the awake owners anyway: so the owned columns gain on the other kinds overall.
  assert.ok(boosted.payouts.get('A')! < plain.payouts.get('A')!);
  const sum = (x: typeof plain) => [...x.payouts.values()].reduce((p, q) => p + q, 0n) + x.carried;
  assert.equal(sum(boosted), sum(plain), 'no lamport is lost');
});
