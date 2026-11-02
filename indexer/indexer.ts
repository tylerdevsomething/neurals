// The indexer: follows finalized transactions, keeps the ledger, and settles epochs.
//
// Watched addresses: the curve's token account, the Neurals program, and every token account of a
// wallet holding positions or of a checkpoint. Nothing else: AMM pools and exchanges are never
// followed (SPEC §5.6).
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
import type { Store, LogLine } from './store.ts';

export type IndexerConfig = DecoderConfig & {
  /** First slot of epoch 0. Transactions before it are not followed. */
  startSlot: number;
  epochSlots: number;
};

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

  constructor(config: IndexerConfig, rpc: Rpc, store: Store) {
    this.config = config;
    this.rpc = rpc;
    this.store = store;
    this.decoder = new Decoder(config);
    this.ledger = new Ledger({
      startSlot: config.startSlot,
      epochSlots: config.epochSlots,
      resolveReceipt: (h) => store.receipt(h)?.shares ?? null,
    });
    this.syncedSlot = config.startSlot - 1;
  }

  /** Rebuilds state from the log. */
  restore(): void {
    for (const line of this.store.readLog()) this.replay(line);
    const last = this.store.readSynced();
    if (last !== null) {
      this.syncedSlot = Math.max(this.syncedSlot, last);
      this.settle(this.ledger.advanceTo(this.syncedSlot), false);
    }
  }

  private replay(line: LogLine): void {
    if (line.kind === 'reveal') {
      this.ledger.reveal(line.partOfSlot, line.pointsOfPart);
      return;
    }
    for (const e of eventsOf(line.tx, this.book)) this.settle(this.ledger.apply(e), false);
  }

  /** Records the reveal at the current point of the event order (SPEC §6). */
  reveal(partOfSlot: number[], pointsOfPart: number[]): void {
    this.ledger.reveal(partOfSlot, pointsOfPart);
    this.store.appendLog({ kind: 'reveal', slot: this.syncedSlot, partOfSlot, pointsOfPart });
  }

  /** Addresses whose transactions must be followed. */
  watched(): Set<string> {
    const out = new Set([this.config.curveTokenAccount, this.config.programId]);
    for (const e of this.book.entries()) if (this.ledger.tracked(e.owner)) out.add(e.account);
    return out;
  }

  /** Follows the chain up to the finalized slot. Returns the number of transactions applied. */
  async syncOnce(): Promise<number> {
    const finalized = await this.rpc.slot('finalized');
    this.finalizedSlot = finalized;
    if (finalized <= this.syncedSlot) return 0;
    const from = this.syncedSlot;
    const scanned = new Set<string>();
    const pending = new Map<string, Pending>();
    const applied = new Set<string>();

    const scan = async (addresses: string[], afterSlot: number) => {
      const lists = await Promise.all(addresses.map((a) => this.rpc.signaturesSince(a, afterSlot, finalized)));
      for (const a of addresses) scanned.add(a);
      for (const list of lists) for (const s of list) {
        if (!s.err && !applied.has(s.signature) && !pending.has(s.signature)) pending.set(s.signature, { signature: s.signature, slot: s.slot });
      }
    };
    await scan([...this.watched()], from);

    let count = 0;
    while (pending.size) {
      const next = await this.nextInOrder(pending);
      pending.delete(next.signature);
      const raw = await this.rpc.transaction(next.signature);
      if (!raw) throw new Error(`finalized transaction ${next.signature} not served`);
      const tx = this.decoder.decode(raw);
      applied.add(next.signature);
      if (!tx) continue;
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
    this.syncedSlot = finalized;
    this.store.writeSynced(finalized);
    this.settle(this.ledger.advanceTo(finalized), true);
    return count;
  }

  private apply(tx: DecodedTx): void {
    this.store.appendLog({ kind: 'tx', tx });
    for (const e of eventsOf(tx, this.book)) this.settle(this.ledger.apply(e), true);
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
