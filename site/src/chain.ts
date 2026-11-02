// Wallet connection and transactions. Works with any injected Solana wallet that can sign a
// transaction (Phantom, Solflare, Backpack); the site sends and confirms through its own RPC.
import { Connection, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { useEffect, useState } from 'react';

type Provider = {
  publicKey?: { toBase58(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } } | void>;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  on?(event: string, fn: () => void): void;
};

declare global {
  interface Window {
    phantom?: { solana?: Provider };
    solflare?: Provider;
    backpack?: Provider;
    solana?: Provider;
  }
}

export function provider(): Provider | null {
  return window.phantom?.solana ?? window.solflare ?? window.backpack ?? window.solana ?? null;
}

let current: string | null = null;
const listeners = new Set<(w: string | null) => void>();
const set = (w: string | null) => { current = w; listeners.forEach((f) => f(w)); };

export async function connect(silent = false): Promise<string | null> {
  const p = provider();
  if (!p) {
    if (!silent) throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack.');
    return null;
  }
  try {
    const r = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
    const key = (r && 'publicKey' in r ? r.publicKey : p.publicKey)?.toBase58() ?? null;
    set(key);
    p.on?.('disconnect', () => set(null));
    p.on?.('accountChanged', () => set(p.publicKey?.toBase58() ?? null));
    return key;
  } catch (e) {
    if (!silent) throw e;
    return null;
  }
}

export async function disconnect() {
  await provider()?.disconnect();
  set(null);
}

/** The connected wallet, kept in sync with the wallet extension. */
export function useWallet(): string | null {
  const [w, setW] = useState(current);
  useEffect(() => {
    listeners.add(setW);
    if (!current) void connect(true);
    return () => { listeners.delete(setW); };
  }, []);
  return w;
}

/** Signs with the wallet and sends through the site's RPC; resolves once confirmed. */
export async function send(conn: Connection, ixs: TransactionInstruction[]): Promise<string> {
  const p = provider();
  const w = current;
  if (!p || !w) throw new Error('Connect a wallet first.');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(w), blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await p.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize());
  const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (r.value.err) throw new Error(`transaction failed: ${JSON.stringify(r.value.err)}`);
  return sig;
}
