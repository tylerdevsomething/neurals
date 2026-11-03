// The settler: for each settled epoch, posts its payout root on chain (post_epoch), then pushes each
// payout to its wallet (claim). Idempotent: it reads the epoch account first, so a restart never
// posts twice or resends a claimed payout. Owners can always claim themselves with the proof from
// the API; this just saves them the trouble.

import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { sendAndPoll } from '../brain/send.ts';
import { NeuralsAccounts } from '../brain/accounts.ts';
import type { EpochFile } from './store.ts';

/** The posted root and the slot its claims open, from an epoch account. */
export function epochInfo(data: Buffer): { root: string; postedSlot: number } {
  const count = data.readUInt32LE(8 + 8 + 32 + 8 + 8);
  const after = 72 + Math.ceil(count / 8) + 1; // bits, then bump
  // Accounts posted before the challenge window existed have no posted slot: long open.
  const postedSlot = data.length >= after + 8 ? Number(data.readBigUInt64LE(after)) : 0;
  return { root: data.subarray(16, 48).toString('hex'), postedSlot };
}

/** Reads the claimed bits of a posted epoch account, or null if it is not posted. */
export function claimedBits(data: Buffer | null): Uint8Array | null {
  if (!data) return null;
  const count = data.readUInt32LE(8 + 8 + 32 + 8 + 8);
  const len = data.readUInt32LE(8 + 8 + 32 + 8 + 8 + 4);
  if (len !== Math.ceil(count / 8)) throw new Error('unexpected epoch account layout');
  return data.subarray(72, 72 + len);
}

export class Settler {
  private readonly conn: Connection;
  private readonly key: Keypair;
  private readonly accounts: NeuralsAccounts;
  private queue: Promise<void> = Promise.resolve();
  /** Slots after posting before claims open (CHALLENGE_SLOTS in the program: 9,000 on mainnet). */
  challengeSlots = 9_000;
  /**
   * Payouts smaller than this are not pushed: the network fee to send one (5,000 lamports, paid by the
   * settler) would be a large part of it. They stay claimable by their owners at any time.
   */
  minPushLamports = 100_000;
  log: (msg: string) => void = (m) => console.log(m);
  /** Posted roots that differ from ours (veto them), newest last. Monitoring reads these. */
  readonly alerts: string[] = [];
  /** The last settler failure, if the latest epoch did not settle. */
  lastError: string | null = null;

  constructor(conn: Connection, key: Keypair, accounts: NeuralsAccounts) {
    this.conn = conn;
    this.key = key;
    this.accounts = accounts;
  }

  /** Queues an epoch; epochs are handled one at a time, in order. */
  enqueue(file: EpochFile): Promise<void> {
    this.queue = this.queue.then(async () => { await this.settle(file); this.lastError = null; }).catch((e) => {
      this.lastError = `epoch ${file.epoch}: ${(e as Error).message}`;
      this.log(`settler: ${this.lastError}`);
    });
    return this.queue;
  }

  private async send(...ixs: Parameters<Transaction['add']>): Promise<string> {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...ixs);
    return sendAndPoll(this.conn, tx, [this.key]);
  }

  async settle(file: EpochFile): Promise<{ posted: boolean; claimed: number; failed: number }> {
    const total = BigInt(file.total);
    if (total === 0n || file.claims.length === 0) return { posted: false, claimed: 0, failed: 0 };
    const address = this.accounts.epoch(file.epoch);
    let info = await this.conn.getAccountInfo(address, 'confirmed');
    let posted = false;
    if (!info) {
      await this.send(this.accounts.postEpoch({ settler: this.key.publicKey, epoch: file.epoch, root: Buffer.from(file.root, 'hex'), total, count: file.claims.length }));
      posted = true;
      this.log(`settler: posted epoch ${file.epoch}: ${file.claims.length} payouts, ${total} lamports`);
      info = await this.conn.getAccountInfo(address, 'confirmed');
    }
    const data = Buffer.from(info!.data);
    const { root, postedSlot } = epochInfo(data);
    if (root !== file.root) {
      // Someone posted a root that is not ours: the settler key may be compromised. The admin can
      // veto it during the challenge window (tools/veto.ts). Push nothing.
      const alert = `ALERT: epoch ${file.epoch} on chain has root ${root}, but this indexer computed ${file.root}. Veto it before slot ${postedSlot + this.challengeSlots}: node tools/veto.ts ${file.epoch}`;
      this.alerts.push(alert);
      this.log(alert);
      return { posted, claimed: 0, failed: 0 };
    }
    for (let now = await this.conn.getSlot('confirmed'); now < postedSlot + this.challengeSlots; now = await this.conn.getSlot('confirmed')) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, (postedSlot + this.challengeSlots - now) * 400 + 1000)));
    }
    const bits = claimedBits(data)!;
    let claimed = 0;
    let failed = 0;
    let small = 0;
    for (const c of file.claims) {
      if (bits[c.index >> 3] & (1 << (c.index & 7))) continue;
      if (BigInt(c.amount) < BigInt(this.minPushLamports)) { small++; continue; }
      try {
        await this.send(this.accounts.claim({
          payer: this.key.publicKey, wallet: new PublicKey(c.wallet), epoch: file.epoch,
          index: c.index, amount: BigInt(c.amount), proof: c.proof.map((p) => Buffer.from(p, 'hex')),
        }));
        claimed++;
      } catch (e) {
        // For example, a payout smaller than rent to a wallet with no SOL: the owner claims later.
        failed++;
        this.log(`settler: epoch ${file.epoch} payout ${c.index} to ${c.wallet} not pushed: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    if (claimed || failed || small) this.log(`settler: epoch ${file.epoch}: pushed ${claimed} payouts${failed ? `, ${failed} failed` : ''}${small ? `, ${small} too small to push` : ''}; the rest stay claimable by their owners`);
    return { posted, claimed, failed };
  }
}
