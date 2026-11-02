// The indexer's files, all under one data directory:
//   log.jsonl          every applied transaction (decoded) and the reveal, in order; replayed on start
//   synced.json        the last fully synced slot
//   epochs/<n>.json    each settled epoch: payouts and the claim tree (root, index, amount, proof)
//   receipts/<h>.json  receipts by hash, as submitted by the brain; served publicly

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DecodedTx } from '../brain/decoder.ts';
import type { Settlement } from '../brain/ledger.ts';
import type { ClaimTree } from '../brain/claims.ts';
import { receiptHash, PPM, type Receipt } from '../brain/receipt.ts';
import { SEGMENT_COUNT } from '../brain/model.ts';

export type LogLine =
  | { kind: 'tx'; tx: DecodedTx }
  | { kind: 'reveal'; slot: number; partOfSlot: number[]; pointsOfPart: number[] };

export type EpochFile = {
  epoch: number;
  fees: string;
  carried: string;
  root: string;
  total: string;
  claims: { wallet: string; index: number; amount: string; proof: string[] }[];
};

export class Store {
  readonly dir: string;
  private readonly receipts = new Map<string, Receipt>();
  /** Receipt hashes in arrival order (oldest first). */
  private readonly order: string[] = [];

  constructor(dir: string) {
    this.dir = dir;
    for (const d of [dir, join(dir, 'epochs'), join(dir, 'receipts')]) mkdirSync(d, { recursive: true });
    const files = readdirSync(join(dir, 'receipts')).filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: statSync(join(dir, 'receipts', f)).mtimeMs })).sort((a, b) => a.t - b.t);
    for (const { f } of files) {
      const r = JSON.parse(readFileSync(join(dir, 'receipts', f), 'utf8')) as Receipt;
      const h = receiptHash(r);
      this.receipts.set(h, r);
      this.order.push(h);
    }
  }

  *readLog(): Generator<LogLine> {
    const path = join(this.dir, 'log.jsonl');
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      try {
        yield JSON.parse(lines[i]) as LogLine;
      } catch (e) {
        // A line cut off by a crash can only be the last one; anything else is corruption.
        if (i >= lines.length - 2) return;
        throw new Error(`log.jsonl line ${i + 1} is corrupt: ${(e as Error).message}`);
      }
    }
  }

  appendLog(line: LogLine): void {
    appendFileSync(join(this.dir, 'log.jsonl'), JSON.stringify(line) + '\n');
  }

  readSynced(): number | null {
    const path = join(this.dir, 'synced.json');
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { slot: number }).slot : null;
  }

  writeSynced(slot: number): void {
    atomicWrite(join(this.dir, 'synced.json'), JSON.stringify({ slot }));
  }

  writeEpoch(s: Settlement, tree: ClaimTree): void {
    const file: EpochFile = {
      epoch: s.epoch,
      fees: String(s.fees),
      carried: String(s.carried),
      root: tree.root.toString('hex'),
      total: String(tree.total),
      claims: [...tree.claims].map(([wallet, c]) => ({ wallet, index: c.index, amount: String(c.amount), proof: c.proof.map((p) => p.toString('hex')) })),
    };
    atomicWrite(join(this.dir, 'epochs', `${s.epoch}.json`), JSON.stringify(file));
  }

  readEpoch(epoch: number): EpochFile | null {
    const path = join(this.dir, 'epochs', `${epoch}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as EpochFile) : null;
  }

  /** The most recent receipts, newest first. */
  recentReceipts(n: number): Receipt[] {
    return this.order.slice(-n).reverse().map((h) => this.receipts.get(h)!);
  }

  receipt(hash: string): Receipt | null {
    return this.receipts.get(hash) ?? null;
  }

  /** Stores a receipt after checking its shape; returns its hash. The model must be the brain's. */
  addReceipt(r: Receipt, model: string): string {
    if (r.model !== model) throw new Error('receipt is for a different model');
    if (!Array.isArray(r.prompt) || !Array.isArray(r.output) || !r.output.length) throw new Error('receipt needs prompt and reply tokens');
    for (const t of [...r.prompt, ...r.output]) if (!Number.isInteger(t) || t < 0) throw new Error('bad token id');
    if (!Array.isArray(r.shares) || r.shares.length !== SEGMENT_COUNT) throw new Error(`receipt needs ${SEGMENT_COUNT} shares`);
    let sum = 0;
    for (const s of r.shares) {
      if (!Number.isSafeInteger(s) || s < 0) throw new Error('bad share');
      sum += s;
    }
    if (sum !== PPM) throw new Error('shares must add up to 1,000,000');
    const clean: Receipt = { model: r.model, prompt: r.prompt, output: r.output, shares: r.shares };
    const hash = receiptHash(clean);
    if (!this.receipts.has(hash)) {
      atomicWrite(join(this.dir, 'receipts', `${hash}.json`), JSON.stringify(clean));
      this.receipts.set(hash, clean);
      this.order.push(hash);
    }
    return hash;
  }
}

function atomicWrite(path: string, data: string): void {
  writeFileSync(path + '.tmp', data);
  renameSync(path + '.tmp', path);
}
