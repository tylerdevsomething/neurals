// The ownership ledger (SPEC §5) and the epoch fee split (SPEC §7).
//
// Deterministic: the same events in the same order give the same state and the same payouts on
// every machine. Events come from finalized transactions in (slot, position in block) order.
// Within one transaction, a seal, carry or withdraw comes before that transaction's balance events,
// so validity is judged on the balance the wallet had going in.
//
// An event that the program makes impossible (sealing into a checkpoint that already exists,
// withdrawing one that does not) throws: it means the decoder is wrong, and the indexer must halt
// rather than guess.

import { createHash } from 'node:crypto';
import { COLUMN_COUNT, HEAD_COUNT, SEGMENT_COUNT, type Kind } from './model.ts';
import { SLOTS, SUPPLY, slotsIn } from './layout.ts';
import { normalize, total, union, intersect, subtract, takeRarest, type Range, type Ranges } from './ranges.ts';
import { PPM, shares } from './receipt.ts';

export type Event =
  /** Tokens bought off the bonding curve by `wallet`. */
  | { type: 'curveBuy'; slot: number; wallet: string; amount: number }
  /** Tokens sold back into the bonding curve. */
  | { type: 'curveSell'; slot: number; wallet: string; amount: number }
  /** A registered wallet's new total balance of the token, across all its token accounts. */
  | { type: 'balance'; slot: number; wallet: string; balance: number }
  /** `wallet` moved `amount` tokens into a new checkpoint, naming the positions they carry. */
  | { type: 'seal'; slot: number; checkpoint: string; wallet: string; amount: number; positions: Ranges }
  /** A checkpoint changed holder: bought on the neuron market, or gifted. */
  | { type: 'checkpointHolder'; slot: number; checkpoint: string; holder: string }
  /** The holder took the tokens back out; the checkpoint is closed. */
  | { type: 'withdraw'; slot: number; checkpoint: string }
  /** `from` sent `amount` tokens to `to` with the positions they carry. */
  | { type: 'carry'; slot: number; from: string; to: string; amount: number; positions: Ranges }
  /** A paid message: its fee in lamports and its receipt's shares (ppm per part, model order). */
  | { type: 'fee'; slot: number; lamports: number; shares: readonly number[] }
  /**
   * A paid message as the chain records it: its fee and its receipt's hash. The receipt's shares are
   * looked up when the epoch settles (LedgerOptions.resolveReceipt). A receipt that is unavailable
   * then is split evenly within each kind's budget, so the outcome depends only on which receipts
   * were published, never on timing.
   */
  | { type: 'feeReceipt'; slot: number; lamports: number; receipt: string };

export type Settlement = {
  epoch: number;
  /** Fees paid in during the epoch, lamports. */
  fees: bigint;
  /** Lamports owed to each wallet for the epoch (a checkpoint's share goes to its holder). */
  payouts: Map<string, bigint>;
  /** Left over from rounding, or from an epoch where nothing was awake; added to the next epoch. */
  carried: bigint;
};

export type LedgerOptions = {
  /** First slot of epoch 0 (the launch slot). */
  startSlot: number;
  /** Epoch length in slots (SPEC §5.2, OPEN: proposed one day). */
  epochSlots: number;
  /** The checked shares of a receipt by its hash, or null if unavailable (see the feeReceipt event). */
  resolveReceipt?: (receipt: string) => readonly number[] | null;
};

/** The split used for a fee whose receipt is unavailable: each kind's budget, evenly over its parts. */
export const EVEN_SHARES: readonly number[] = shares(new Array(SEGMENT_COUNT).fill(1));

const wallet = (w: string) => `w:${w}`;
const checkpoint = (c: string) => `c:${c}`;

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b;
const SIZE = SLOTS.map((s) => BigInt(s.end - s.start));
/** Common multiple of all slot sizes, so per-position weights stay whole numbers. */
const SIZE_LCM = SIZE.reduce(lcm, 1n);
const KIND_COUNT: Record<Kind, number> = { embedding: 1, head: HEAD_COUNT, column: COLUMN_COUNT, unembedding: 1 };
const COUNT_LCM = Object.values(KIND_COUNT).map(BigInt).reduce(lcm, 1n);

export class Ledger {
  readonly options: LedgerOptions;
  /** Next fresh position the curve will issue. */
  cursor = 0;
  /** Tokens sold back into the curve and not yet bought again; re-buying them issues nothing. */
  returned = 0;
  epoch = 0;

  /** Positions by holder key: `w:<wallet>` or `c:<checkpoint>`. */
  private readonly reg = new Map<string, Range[]>();
  /** Registrations at the start of the current epoch. */
  private start = new Map<string, Range[]>();
  private readonly holders = new Map<string, string>();
  private readonly balances = new Map<string, number>();
  /** Lowest balance of each wallet during the current epoch. */
  private minBalances = new Map<string, number>();
  /** Fee weight per part this epoch: sum over messages of lamports × ppm share. */
  private pool: bigint[] = new Array<bigint>(SEGMENT_COUNT).fill(0n);
  private fees = 0n;
  /** This epoch's receipt-referenced fees, lamports by receipt hash (in first-seen order). */
  private pending = new Map<string, bigint>();
  private carried = 0n;
  private revealed: { partOfSlot: readonly number[]; pointsOfPart: readonly number[] } | null = null;
  private lastSlot = -Infinity;

  constructor(options: LedgerOptions) {
    if (!(options.epochSlots > 0) || !Number.isSafeInteger(options.epochSlots)) throw new Error('epochSlots must be a positive integer');
    this.options = options;
  }

  /** Records the reveal: which part fills each slot, and each part's trait points. Once only. */
  reveal(partOfSlot: readonly number[], pointsOfPart: readonly number[]): void {
    if (this.revealed) throw new Error('already revealed');
    if (partOfSlot.length !== SEGMENT_COUNT || pointsOfPart.length !== SEGMENT_COUNT) throw new Error('reveal must cover every slot and part');
    this.revealed = { partOfSlot: partOfSlot.slice(), pointsOfPart: pointsOfPart.slice() };
  }

  /** Trait points of the part in a slot; 0 for every slot before the reveal. */
  pointsOfSlot = (slot: number): number => (this.revealed ? this.revealed.pointsOfPart[this.revealed.partOfSlot[slot]] : 0);

  positions(w: string): Range[] {
    return (this.reg.get(wallet(w)) ?? []).slice();
  }

  checkpointPositions(c: string): Range[] {
    return (this.reg.get(checkpoint(c)) ?? []).slice();
  }

  holderOf(c: string): string | undefined {
    return this.holders.get(c);
  }

  balanceOf(w: string): number {
    return this.balances.get(w) ?? 0;
  }

  /** Wallets holding positions, sorted. */
  wallets(): string[] {
    return [...this.reg.keys()].filter((k) => k.startsWith('w:')).map((k) => k.slice(2)).sort();
  }

  /** Open checkpoints with their holder and positions, sorted by address. */
  checkpoints(): { checkpoint: string; holder: string; positions: Range[] }[] {
    return [...this.holders].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([checkpoint, holder]) => ({
      checkpoint, holder, positions: this.reg.get(checkpoint === '' ? '' : `c:${checkpoint}`)?.slice() ?? [],
    }));
  }

  /** Whether the indexer must follow this owner's token accounts: a wallet with positions, or a checkpoint. */
  tracked(owner: string): boolean {
    return this.reg.has(`w:${owner}`) || this.holders.has(owner);
  }

  /** Who holds each base-unit range of a slot right now: wallets and checkpoints, with amounts. */
  holdersOf(start: number, end: number): { holder: string; checkpoint?: string; amount: number }[] {
    const out: { holder: string; checkpoint?: string; amount: number }[] = [];
    for (const [key, rs] of this.reg) {
      const amount = total(intersect(rs, [[start, end]]));
      if (amount === 0) continue;
      if (key.startsWith('w:')) out.push({ holder: key.slice(2), amount });
      else out.push({ holder: this.holders.get(key.slice(2))!, checkpoint: key.slice(2), amount });
    }
    return out.sort((a, b) => b.amount - a.amount || (a.holder < b.holder ? -1 : 1));
  }

  get isRevealed(): boolean {
    return this.revealed !== null;
  }

  /** The part in a slot after the reveal, or null before it. */
  partOfSlot(slot: number): number | null {
    return this.revealed ? this.revealed.partOfSlot[slot] : null;
  }

  /** The wallet's neurons that are awake right now: covered by its current balance, rarest first. */
  awake(w: string): Range[] {
    const mine = this.reg.get(wallet(w)) ?? [];
    return takeRarest(mine, Math.min(this.balanceOf(w), total(mine)), this.pointsOfSlot);
  }

  /**
   * Applies one event. Returns the settlements of any epochs that ended before it (usually none,
   * one at an epoch boundary).
   */
  apply(e: Event): Settlement[] {
    if (e.slot < this.lastSlot) throw new Error(`event at slot ${e.slot} after slot ${this.lastSlot}: events must be in order`);
    this.lastSlot = e.slot;
    const done = this.advanceTo(e.slot);
    switch (e.type) {
      case 'curveBuy': {
        positive(e.amount);
        const fromReturned = Math.min(this.returned, e.amount);
        this.returned -= fromReturned;
        const fresh = Math.min(e.amount - fromReturned, SUPPLY - this.cursor);
        if (fresh > 0) {
          this.add(wallet(e.wallet), [[this.cursor, this.cursor + fresh]]);
          this.cursor += fresh;
        }
        break;
      }
      case 'curveSell':
        positive(e.amount);
        this.returned += e.amount;
        break;
      case 'balance': {
        if (!Number.isSafeInteger(e.balance) || e.balance < 0) throw new Error(`bad balance ${e.balance}`);
        this.balances.set(e.wallet, e.balance);
        // A wallet with no balance at the epoch's start held 0 then.
        this.minBalances.set(e.wallet, Math.min(this.minBalances.get(e.wallet) ?? 0, e.balance));
        break;
      }
      case 'seal': {
        positive(e.amount);
        const key = checkpoint(e.checkpoint);
        if (this.holders.has(e.checkpoint) || this.reg.has(key)) throw new Error(`checkpoint ${e.checkpoint} already exists`);
        const valid = this.validMove(e.wallet, e.amount, e.positions);
        this.remove(wallet(e.wallet), valid);
        this.holders.set(e.checkpoint, e.wallet);
        this.reg.set(key, valid);
        break;
      }
      case 'checkpointHolder':
        if (!this.holders.has(e.checkpoint)) throw new Error(`no checkpoint ${e.checkpoint}`);
        this.holders.set(e.checkpoint, e.holder);
        break;
      case 'withdraw': {
        const holder = this.holders.get(e.checkpoint);
        if (holder === undefined) throw new Error(`no checkpoint ${e.checkpoint}`);
        this.add(wallet(holder), this.reg.get(checkpoint(e.checkpoint)) ?? []);
        this.reg.delete(checkpoint(e.checkpoint));
        this.holders.delete(e.checkpoint);
        break;
      }
      case 'carry': {
        positive(e.amount);
        const valid = this.validMove(e.from, e.amount, e.positions);
        this.remove(wallet(e.from), valid);
        this.add(wallet(e.to), valid);
        break;
      }
      case 'fee': {
        if (!Number.isSafeInteger(e.lamports) || e.lamports < 0) throw new Error(`bad fee ${e.lamports}`);
        checkShares(e.shares);
        this.addToPool(BigInt(e.lamports), e.shares);
        this.fees += BigInt(e.lamports);
        break;
      }
      case 'feeReceipt': {
        if (!Number.isSafeInteger(e.lamports) || e.lamports < 0) throw new Error(`bad fee ${e.lamports}`);
        if (!/^[0-9a-f]{64}$/.test(e.receipt)) throw new Error(`bad receipt hash ${e.receipt}`);
        this.pending.set(e.receipt, (this.pending.get(e.receipt) ?? 0n) + BigInt(e.lamports));
        this.fees += BigInt(e.lamports);
        break;
      }
    }
    return done;
  }

  /** Settles every epoch that ends at or before `slot`. */
  advanceTo(slot: number): Settlement[] {
    const out: Settlement[] = [];
    const epochOf = Math.floor((slot - this.options.startSlot) / this.options.epochSlots);
    while (this.epoch < epochOf) out.push(this.settle());
    return out;
  }

  /**
   * Ends the current epoch and splits its fees (SPEC §5.2, §7):
   * - A position earns only if it was with the same holder at the start and the end of the epoch.
   * - In a wallet, the awake amount is the wallet's lowest balance during the epoch, rarest first.
   *   In a checkpoint, every position is awake, and its holder at the end is paid.
   * - Each slot's weight is its part's fee weight (before the reveal: its kind's weight, split
   *   evenly over the slots of that kind). Owners are paid by weight per position held awake;
   *   whatever is dormant or unissued is renormalised away.
   */
  private settle(): Settlement {
    for (const [receipt, lamports] of this.pending) {
      let s = this.options.resolveReceipt?.(receipt) ?? null;
      if (s) {
        try { checkShares(s); } catch { s = null; }
      }
      this.addToPool(lamports, s ?? EVEN_SHARES);
    }
    this.pending = new Map();
    const pot = this.fees + this.carried;
    // A pot carried into an epoch that brought no fee weights of its own (rounding dust alone, or
    // nothing new) is split by the kind budgets, evenly: otherwise it could never be paid out.
    if (pot > 0n && this.pool.every((w) => w === 0n)) this.addToPool(pot, EVEN_SHARES);
    const paid = new Map<string, bigint>();
    const unit = this.slotUnits();
    for (const [key, now] of this.reg) {
      const eligible = intersect(this.start.get(key) ?? [], now);
      if (eligible.length === 0) continue;
      let payee: string;
      let awake: Range[];
      if (key.startsWith('w:')) {
        payee = key.slice(2);
        const low = this.minBalances.get(payee) ?? 0;
        awake = takeRarest(eligible, Math.min(low, total(eligible)), this.pointsOfSlot);
      } else {
        payee = this.holders.get(key.slice(2))!;
        awake = eligible;
      }
      let num = 0n;
      for (const [s, e] of awake) for (const { slot, amount } of slotsIn(s, e)) num += unit[slot.index] * BigInt(amount);
      if (num > 0n) paid.set(payee, (paid.get(payee) ?? 0n) + num);
    }

    let z = 0n;
    for (const v of paid.values()) z += v;
    const payouts = new Map<string, bigint>();
    let given = 0n;
    if (z > 0n) {
      for (const w of [...paid.keys()].sort()) {
        const amount = (pot * paid.get(w)!) / z;
        if (amount > 0n) payouts.set(w, amount);
        given += amount;
      }
    }
    const settlement: Settlement = { epoch: this.epoch, fees: this.fees, payouts, carried: pot - given };

    this.carried = pot - given;
    this.fees = 0n;
    // When nothing was awake, the whole pot carries over with its weights, so it is later paid by
    // what actually fired. Otherwise only rounding dust carries, and the weights start afresh.
    if (z > 0n) this.pool = new Array<bigint>(SEGMENT_COUNT).fill(0n);
    this.start = new Map([...this.reg].map(([k, v]) => [k, v.slice()]));
    this.minBalances = new Map(this.balances);
    this.epoch++;
    return settlement;
  }

  private addToPool(lamports: bigint, s: readonly number[]): void {
    s.forEach((x, p) => (this.pool[p] += lamports * BigInt(x)));
  }

  /** Fee weight per base-unit position of each slot, scaled to whole numbers. */
  private slotUnits(): bigint[] {
    const kindWeight: Record<Kind, bigint> = { embedding: 0n, head: 0n, column: 0n, unembedding: 0n };
    SLOTS.forEach((s, i) => (kindWeight[s.kind] += this.pool[i]));
    if (!this.revealed) {
      return SLOTS.map((s, i) => kindWeight[s.kind] * (COUNT_LCM / BigInt(KIND_COUNT[s.kind])) * (SIZE_LCM / SIZE[i]));
    }
    // After the reveal, a part with a trait earns (100 + points) / 100 of its weight (SPEC §4), and
    // each kind's total stays its budget: the bonus moves share between parts of a kind, never
    // between kinds. Exact: boosted weights are rescaled with a common multiple, not divided.
    const { partOfSlot, pointsOfPart } = this.revealed;
    const boosted = SLOTS.map((_, i) => this.pool[partOfSlot[i]] * BigInt(100 + pointsOfPart[partOfSlot[i]]));
    const boostedKind: Record<Kind, bigint> = { embedding: 0n, head: 0n, column: 0n, unembedding: 0n };
    SLOTS.forEach((s, i) => (boostedKind[s.kind] += boosted[i]));
    const common = (Object.values(boostedKind).filter((b) => b > 0n)).reduce((a, b) => a * b, 1n);
    return SLOTS.map((s, i) => {
      const b = boostedKind[s.kind];
      if (b === 0n) return 0n;
      return boosted[i] * kindWeight[s.kind] * (common / b) * (SIZE_LCM / SIZE[i]);
    });
  }

  /**
   * The named positions that may move with a seal or carry (SPEC §5.5): those the wallet owns and
   * has awake right now. A list naming more positions than the tokens moved is ignored entirely.
   */
  private validMove(from: string, amount: number, named: Ranges): Range[] {
    const want = normalize(named);
    if (total(want) > amount) return [];
    return intersect(want, this.awake(from));
  }

  private add(key: string, rs: Ranges): void {
    if (rs.length) this.reg.set(key, union(this.reg.get(key) ?? [], rs));
  }

  private remove(key: string, rs: Ranges): void {
    if (!rs.length) return;
    const left = subtract(this.reg.get(key) ?? [], rs);
    if (left.length) this.reg.set(key, left);
    else this.reg.delete(key);
  }

  /** SHA-256 of the whole state, for two independent indexers to compare. */
  fingerprint(): string {
    const sorted = <T>(m: Map<string, T>) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const state = {
      epoch: this.epoch,
      cursor: this.cursor,
      returned: this.returned,
      reg: sorted(this.reg),
      start: sorted(this.start),
      holders: sorted(this.holders),
      balances: sorted(this.balances),
      minBalances: sorted(this.minBalances),
      pool: this.pool.map(String),
      pending: [...this.pending].map(([k, v]) => [k, String(v)]),
      fees: String(this.fees),
      carried: String(this.carried),
      revealed: this.revealed,
    };
    return createHash('sha256').update('neurals:v1:ledger').update(JSON.stringify(state)).digest('hex');
  }
}

function checkShares(s: readonly number[]): void {
  if (s.length !== SEGMENT_COUNT) throw new Error('a fee needs a share for every part');
  let sum = 0;
  for (const x of s) {
    if (!Number.isSafeInteger(x) || x < 0) throw new Error(`bad share ${x}`);
    sum += x;
  }
  if (sum !== PPM) throw new Error('shares must add up to 1,000,000');
}

function positive(n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`bad amount ${n}`);
}
