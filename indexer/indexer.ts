// The indexer: follows finalized transactions, keeps the ledger, and settles epochs.
//
// Watched addresses: the curve's token account, the Neurals program, and every token account of a
// wallet holding positions or of a checkpoint. Nothing else: AMM pools and exchanges are never
// followed (SPEC §5.6). The curve and the program are scanned every poll; holders' accounts are read
// together in one balance snapshot (100 per call) and only those that changed are scanned, so the
// cost of a poll does not grow with every holder (see syncOnce).
//
// Order: transactions are applied by (slot, position in block). When applying a transaction makes
// a new wallet tracked, that wallet's accounts are scanned from that slot on and merged into the
// queue, so nothing it does later in the window is missed.
//
// Persistence: every applied transaction is appended to a log; the ledger is rebuilt from the log
// on start (it is deterministic), so a crash loses nothing that was applied.

import { Ledger, type Settlement } from '../brain/ledger.ts';
import { Decoder, BalanceBook, eventsOf, type DecodedTx, type DecoderConfig } from '../brain/decoder.ts';
import { buildTree, type ClaimTree } from '../brain/claims.ts';
import type { Rpc } from './rpc.ts';
import type { Receipt } from '../brain/receipt.ts';
import type { Store, LogLine } from './store.ts';
import { SUPPLY } from '../brain/layout.ts';
import { buildReveal, seedSlotFor, type Reveal, type Rules } from '../brain/reveal.ts';

export type IndexerConfig = DecoderConfig & {
  /** First slot of epoch 0. Transactions before it are not followed. */
  startSlot: number;
  epochSlots: number;
  /**
   * Another indexer's API (…/api) to fetch published receipts from, when a fee names a receipt
   * this indexer has not been sent. Independent indexers settle on the same receipts this way.
   */
  receiptsFrom?: string;
  /** The official brain's key: it pays the fees and signs the receipts (SPEC §7). */
  brainKey?: string;
};

/** A checked reveal and the slot it takes effect (the first epoch boundary after its seed block). */
export type PendingReveal = { partOfSlot: number[]; pointsOfPart: number[]; effectiveSlot: number };

type Pending = { signature: string; slot: number };

export class Indexer {
  readonly config: IndexerConfig;
  readonly ledger: Ledger;
  readonly book = new BalanceBook();
  readonly decoder: Decoder;
  syncedSlot: number;
  finalizedSlot = 0;
  readonly settlements: Settlement[] = [];
  readonly trees = new Map<number, ClaimTree>();
  /** Called for each newly settled epoch (the settler posts its root and pushes claims). */
  onSettled?: (s: Settlement, tree: ClaimTree) => void;
  private readonly rpc: Rpc;
  private readonly store: Store;
  private readonly blockOrder = new Map<number, Map<string, number>>();
  private reveal: PendingReveal | null = null;
  /** The committed rules (SPEC §6): with them, the indexer finds the seed block and builds the reveal itself. */
  private rules: Rules | null = null;
  /** The reveal in use, as built (or read) and checked. */
  revealed: Reveal | null = null;
  /** The slot of the transaction that sold the last position on the curve, or null while unsold. */
  soldOutSlot: number | null = null;

  constructor(config: IndexerConfig, rpc: Rpc, store: Store) {
    this.config = config;
    this.rpc = rpc;
    this.store = store;
    this.decoder = new Decoder(config);
    this.ledger = new Ledger({
      startSlot: config.startSlot,
      epochSlots: config.epochSlots,
      resolveReceipt: (h) => store.receipt(h)?.shares ?? null,
      brainKey: config.brainKey,
    });
    this.syncedSlot = config.startSlot - 1;
  }

  /** Rebuilds state from the log. Set the reveal first (setReveal), so it lands where it belongs. */
  restore(): void {
    for (const line of this.store.readLog()) this.replay(line);
    const last = this.store.readSynced();
    if (last !== null) {
      this.syncedSlot = Math.max(this.syncedSlot, last);
      this.revealIfDue(this.syncedSlot, false);
      this.settle(this.ledger.advanceTo(this.syncedSlot), false);
    }
  }

  private replay(line: LogLine): void {
    if (line.kind === 'reveal') return; // older logs recorded when the file was read: not canonical
    for (const e of eventsOf(line.tx, this.book)) {
      this.revealIfDue(e.slot, false);
      this.settle(this.ledger.apply(e), false);
      this.noteSellout(e.slot);
    }
  }

  /** Records the slot the curve sold out in: the first time every position has been issued. */
  private noteSellout(slot: number): void {
    if (this.soldOutSlot === null && this.ledger.cursor >= SUPPLY) this.soldOutSlot = slot;
  }

  /**
   * The rules the reveal follows. With them the indexer reveals by itself: when the curve sells out
   * (or the deadline passes), it takes the seed block the rules name, builds the reveal and applies
   * it at the first epoch boundary after that block. Nobody picks the seed block.
   */
  setRules(rules: Rules): void {
    this.rules = rules;
  }

  /** The seed slot the rules call for, once it is known from the chain (sellout or deadline), else null. */
  seedSlot(upTo: number): number | null {
    if (!this.rules) return null;
    if (this.soldOutSlot !== null) return seedSlotFor(this.rules, this.soldOutSlot);
    return upTo > this.rules.seed.deadlineSlot ? this.rules.seed.deadlineSlot : null;
  }

  /** The first block produced at or after a slot (slots can be skipped). */
  private async firstBlockFrom(slot: number): Promise<{ slot: number; blockhash: string }> {
    const slots = await this.rpc.call<number[]>('getBlocks', [slot, slot + 500, { commitment: 'finalized' }]);
    if (!slots.length) throw new Error(`no finalized block in slots ${slot}..${slot + 500}`);
    const block = await this.rpc.call<{ blockhash: string }>('getBlock', [slots[0], { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
    return { slot: slots[0], blockhash: block.blockhash };
  }

  /**
   * Builds the reveal before the event order can pass its effective slot. Called before applying
   * anything at or after `upTo`.
   */
  private async ensureReveal(upTo: number): Promise<void> {
    if (!this.rules || this.reveal) return;
    const seed = this.seedSlot(upTo);
    if (seed === null) return;
    const { startSlot, epochSlots } = this.config;
    // The effective slot is the first epoch boundary after the seed block, which is at or after the seed slot.
    const earliest = startSlot + (Math.floor((seed - startSlot) / epochSlots) + 1) * epochSlots;
    if (upTo < earliest) return;
    const block = await this.firstBlockFrom(seed);
    const reveal = buildReveal(this.rules, block.slot, block.blockhash);
    this.store.writeReveal(reveal);
    this.revealed = reveal;
    this.setReveal(reveal.partOfSlot, reveal.pointsOfPart, reveal.seedSlot);
  }

  /**
   * Uses a reveal read from a file or an earlier run. Call checkSeed() after restore(): the seed
   * block must be the one the rules call for, given when the curve sold out.
   */
  useReveal(reveal: Reveal): PendingReveal {
    this.revealed = reveal;
    return this.setReveal(reveal.partOfSlot, reveal.pointsOfPart, reveal.seedSlot);
  }

  /** Throws unless the reveal in use was drawn from the seed block the rules call for. */
  async checkSeed(): Promise<void> {
    if (!this.revealed || !this.rules) return;
    const seed = this.seedSlot(Math.max(this.syncedSlot, this.revealed.seedSlot));
    if (seed === null) throw new Error('a reveal exists, but the curve has not sold out and the deadline has not passed');
    const block = await this.firstBlockFrom(seed);
    if (block.slot !== this.revealed.seedSlot) {
      throw new Error(`the reveal uses block ${this.revealed.seedSlot}, but the rules call for block ${block.slot} (sold out in slot ${this.soldOutSlot ?? 'none'}): it is not the canonical reveal`);
    }
  }

  /**
   * The checked reveal (SPEC §6). It takes effect at a point fixed by the chain, the first epoch
   * boundary after the seed block, never at the moment an indexer happens to read it, so every
   * indexer applies it at the same place in the event order and settles identically.
   */
  setReveal(partOfSlot: number[], pointsOfPart: number[], seedSlot: number): PendingReveal {
    const { startSlot, epochSlots } = this.config;
    const effectiveSlot = startSlot + (Math.floor((seedSlot - startSlot) / epochSlots) + 1) * epochSlots;
    this.reveal = { partOfSlot, pointsOfPart, effectiveSlot };
    return this.reveal;
  }

  /** Applies the pending reveal once the event order reaches its effective slot. */
  private revealIfDue(slot: number, fresh: boolean): void {
    if (!this.reveal || this.ledger.isRevealed || slot < this.reveal.effectiveSlot) return;
    this.settle(this.ledger.advanceTo(this.reveal.effectiveSlot), fresh);
    this.ledger.reveal(this.reveal.partOfSlot, this.reveal.pointsOfPart);
  }

  /** Addresses whose transactions must be followed. */
  watched(): Set<string> {
    const out = new Set([this.config.curveTokenAccount, this.config.programId]);
    for (const e of this.book.entries()) if (this.ledger.tracked(e.owner)) out.add(e.account);
    return out;
  }

  /** The holders' token accounts the indexer follows (wallets with positions, checkpoints). */
  trackedAccounts(): string[] {
    const fixed = new Set([this.config.curveTokenAccount, this.config.programId]);
    return [...this.watched()].filter((a) => !fixed.has(a));
  }

  /** RPC calls the last poll's balance snapshot took: the main loop paces itself by it. */
  snapshotCalls = 0;
  /** Missed transactions found by the balance check, and corrections made (shown in /health). */
  readonly repairs = { found: 0, corrected: 0 };

  /** Follows the chain up to the finalized slot. Returns the number of transactions applied. */
  async syncOnce(): Promise<number> {
    // Credits: a holder's token account is not asked for its transactions every poll (one call per
    // holder, every few seconds, does not scale). One snapshot reads every followed account's balance,
    // 100 per call, at the finalized slot this poll syncs to; only accounts whose balance or owner
    // differs from the book are scanned for transactions. The curve and the program are always scanned.
    const tracked = this.trackedAccounts();
    const snap = await this.rpc.tokenSnapshot(tracked);
    this.snapshotCalls = Math.ceil(tracked.length / 100);
    const finalized = snap.slot ?? (await this.rpc.slot('finalized'));
    this.finalizedSlot = finalized;
    if (finalized <= this.syncedSlot) return 0;
    const from = this.syncedSlot;
    const changed = tracked.filter((a) => {
      const known = this.book.get(a), now = snap.states.get(a);
      if (!known) return true;
      return now ? now.amount !== known.amount || now.owner !== known.owner : known.amount !== 0;
    });
    const scanned = new Set<string>(tracked);
    const pending = new Map<string, Pending>();
    const applied = new Set<string>();

    const scan = async (addresses: string[], afterSlot: number) => {
      const lists = await Promise.all(addresses.map((a) => this.rpc.signaturesSince(a, afterSlot, finalized)));
      for (const a of addresses) scanned.add(a);
      for (const list of lists) for (const s of list) {
        if (!s.err && !applied.has(s.signature) && !pending.has(s.signature)) pending.set(s.signature, { signature: s.signature, slot: s.slot });
      }
    };
    await scan([this.config.curveTokenAccount, this.config.programId, ...changed], from);

    let count = 0;
    const rechecked = new Set<string>();
    const staleIn = (t: DecodedTx) => t.pre.filter((o) => { const k = this.book.get(o.account); return k !== undefined && (k.amount !== o.amount || k.owner !== o.owner); });
    while (pending.size) {
      const next = await this.nextInOrder(pending);
      pending.delete(next.signature);
      const raw = await this.rpc.transaction(next.signature);
      if (!raw) throw new Error(`finalized transaction ${next.signature} not served`);
      const tx = this.decoder.decode(raw);
      if (tx) {
        // A followed account that does not start this transaction where the book left it: something
        // touched it that the snapshot could not see (changed and changed back within one poll). Its
        // transactions are scanned and applied first, in order; if none is found (it happened before
        // this poll), the book takes the chain's balance here, logged as a correction.
        const stale = staleIn(tx);
        if (stale.length && !rechecked.has(next.signature)) {
          rechecked.add(next.signature);
          const before = new Set(pending.keys());
          await scan(stale.map((o) => o.account), from);
          pending.delete(next.signature); // the scan finds this one too: it is being handled now
          const earlier = [...pending.values()].filter((p) => !before.has(p.signature) && p.signature !== next.signature && p.slot <= next.slot);
          if (earlier.length) {
            this.repairs.found += earlier.length;
            console.log(`balance check: ${earlier.length} missed transaction(s) before ${next.signature.slice(0, 12)}…, applying them first`);
            pending.set(next.signature, next);
            continue;
          }
        }
        const still = staleIn(tx);
        if (still.length) {
          this.repairs.corrected += still.length;
          console.log(`balance check: ${still.map((o) => o.account.slice(0, 8)).join(', ')} corrected to the chain's balance at slot ${tx.slot}`);
          this.apply({ slot: tx.slot, signature: `correction:${next.signature}`, actions: [], pre: [], post: still });
        }
      }
      applied.add(next.signature);
      if (!tx) continue;
      await this.fetchReceipts(tx);
      await this.ensureReveal(tx.slot);
      this.apply(tx);
      count++;
      const fresh = [...this.watched()].filter((a) => !scanned.has(a));
      // New wallets: their activity from this slot on. Earlier transactions in this slot came
      // before they were tracked; the balance book takes their accounts at first sight.
      if (fresh.length) await scan(fresh, next.slot - 1);
      for (const [sig, p] of pending) {
        if (p.slot < next.slot || (p.slot === next.slot && (await this.before(p, next)))) pending.delete(sig);
      }
    }
    await this.ensureReveal(finalized);
    this.syncedSlot = finalized;
    this.store.writeSynced(finalized);
    this.revealIfDue(finalized, true);
    this.settle(this.ledger.advanceTo(finalized), true);
    return count;
  }

  private apply(tx: DecodedTx): void {
    this.store.appendLog({ kind: 'tx', tx });
    for (const e of eventsOf(tx, this.book)) {
      this.revealIfDue(e.slot, true);
      this.settle(this.ledger.apply(e), true);
      this.noteSellout(e.slot);
    }
  }

  /** Fetches published receipts this indexer was not sent (receiptsFrom), before their fees apply. */
  private async fetchReceipts(tx: DecodedTx): Promise<void> {
    if (!this.config.receiptsFrom) return;
    for (const a of tx.actions) {
      if (a.type !== 'feeReceipt' || this.store.receipt(a.receipt)) continue;
      if (this.config.brainKey && a.payer !== this.config.brainKey) continue; // split evenly anyway
      const res = await fetch(`${this.config.receiptsFrom}/receipts/${a.receipt}`).catch(() => null);
      if (!res?.ok) continue; // unpublished: the fee is split evenly by kind, as for everyone
      const r = (await res.json()) as Receipt;
      try {
        // No signature needed here: the brain itself named this hash on chain when it paid the fee.
        if (this.store.addReceipt(r, r.model) !== a.receipt) continue; // hashed: it cannot be faked
      } catch { /* malformed: treated as unpublished */ }
    }
  }

  private settle(done: Settlement[], fresh: boolean): void {
    for (const s of done) {
      const tree = buildTree(s.epoch, s.payouts);
      this.settlements.push(s);
      this.trees.set(s.epoch, tree);
      if (fresh) {
        this.store.writeEpoch(s, tree);
        this.onSettled?.(s, tree);
      }
    }
  }

  /** The earliest pending transaction by (slot, position in block). */
  private async nextInOrder(pending: Map<string, Pending>): Promise<Pending> {
    let min = Infinity;
    for (const p of pending.values()) min = Math.min(min, p.slot);
    const same = [...pending.values()].filter((p) => p.slot === min);
    if (same.length === 1) return same[0];
    const order = await this.order(min);
    return same.sort((a, b) => (order.get(a.signature) ?? 0) - (order.get(b.signature) ?? 0))[0];
  }

  private async before(a: Pending, b: Pending): Promise<boolean> {
    const order = await this.order(a.slot);
    return (order.get(a.signature) ?? 0) < (order.get(b.signature) ?? 0);
  }

  private async order(slot: number): Promise<Map<string, number>> {
    let o = this.blockOrder.get(slot);
    if (!o) {
      const sigs = await this.rpc.blockSignatures(slot);
      o = new Map(sigs.map((s, i) => [s, i]));
      this.blockOrder.set(slot, o);
      if (this.blockOrder.size > 2000) this.blockOrder.delete(this.blockOrder.keys().next().value!);
    }
    return o;
  }
}
