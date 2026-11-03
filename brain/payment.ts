// Paying for a message (SPEC §7): the visitor's wallet sends the message fee to the brain, with a
// memo naming the message, then sends the message with that payment's signature. The brain checks
// the payment on chain, answers, and forwards the fee into the pool with the message's receipt.
// The memo binds a payment to one message, so someone who sees the payment on chain cannot spend
// it on a message of their own; each payment buys one reply.
import { createHash } from 'node:crypto';

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
/** How long a payment can be used for after it lands. */
export const PAYMENT_TTL_SECONDS = 15 * 60;

/** The memo a payment for `message` carries. */
export function paymentMemo(message: string): string {
  return `neurals:chat:${createHash('sha256').update(message).digest('hex')}`;
}

/** The parts of a confirmed transaction the check reads (as @solana/web3.js getTransaction returns them). */
export type PaymentTx = {
  blockTime?: number | null;
  meta: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
  transaction: { message: { staticAccountKeys: { toBase58(): string }[]; compiledInstructions: { programIdIndex: number; data: Uint8Array }[] } };
};

/** Why `tx` does not pay `lamports` to `payTo` for `message`, or null if it does. */
export function paymentProblem(tx: PaymentTx | null, o: { payTo: string; lamports: number; message: string; now: number }): string | null {
  if (!tx || !tx.meta) return 'payment not found (is it confirmed?)';
  if (tx.meta.err) return 'the payment failed on chain';
  if (!tx.blockTime || o.now - tx.blockTime > PAYMENT_TTL_SECONDS) return 'the payment is too old: pay again';
  const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  const i = keys.indexOf(o.payTo);
  if (i < 0 || tx.meta.postBalances[i] - tx.meta.preBalances[i] < o.lamports) return 'the payment does not pay the brain the message fee';
  const memo = paymentMemo(o.message);
  const named = tx.transaction.message.compiledInstructions.some((ix) =>
    keys[ix.programIdIndex] === MEMO_PROGRAM && new TextDecoder().decode(ix.data) === memo);
  if (!named) return 'the payment is for a different message';
  return null;
}
