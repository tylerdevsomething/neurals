// Sends a transaction and confirms it by polling its status (no websocket subscription, which some
// RPC providers or networks do not let through).
import { Connection, Keypair, Transaction } from '@solana/web3.js';

export async function sendAndPoll(conn: Connection, tx: Transaction, signers: Keypair[], timeoutMs = 90_000): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer ??= signers[0].publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error('transaction expired before confirming');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed within ${timeoutMs / 1000} s: ${sig}`);
}
