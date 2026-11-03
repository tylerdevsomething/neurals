// The official brain signs each receipt it publishes (SPEC §7), so indexers keep only the brain's
// receipts. Ed25519 with the brain's Solana key; the signed message is domain-separated.
import { ed25519 } from '@noble/curves/ed25519';
import { decodeBase58 } from './base58.ts';

const message = (hash: string) => new TextEncoder().encode(`neurals:v1:receipt-signature:${hash}`);

/** Signs a receipt hash with a Solana secret key (64 bytes: seed then public key); hex signature. */
export function signReceipt(hash: string, secretKey: Uint8Array): string {
  return Buffer.from(ed25519.sign(message(hash), secretKey.subarray(0, 32))).toString('hex');
}

/** Whether `signature` (hex) is the brain's (base58 public key) signature of the receipt hash. */
export function verifyReceipt(hash: string, signature: string | undefined, brainKey: string): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) return false;
  try {
    return ed25519.verify(Buffer.from(signature, 'hex'), message(hash), decodeBase58(brainKey));
  } catch {
    return false;
  }
}
