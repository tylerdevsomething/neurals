// A small Solana JSON-RPC client: retries with backoff on rate limits, server errors and network
// failures, and a cap on requests in flight.

export class Rpc {
  readonly url: string;
  private inFlight = 0;
  private readonly max: number;
  private readonly waiting: (() => void)[] = [];

  constructor(url: string, maxInFlight = 8) {
    this.url = url;
    this.max = maxInFlight;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    while (this.inFlight >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.inFlight++;
    try {
      for (let attempt = 0; ; attempt++) {
        let retryable = false;
        try {
          const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
          if (res.status === 429 || res.status >= 500) {
            retryable = true;
            throw new Error(`${method}: HTTP ${res.status}`);
          }
          const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (body.error) {
            // Node behind or a transaction not yet served: worth another try.
            retryable = body.error.code === -32004 || body.error.code === -32005 || body.error.code === -32007 || body.error.code === -32014;
            throw new Error(`${method}: ${body.error.message}`);
          }
          return body.result as T;
        } catch (e) {
          const network = e instanceof TypeError; // fetch failed
          if ((!retryable && !network) || attempt >= 7) throw e;
          await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
        }
      }
    } finally {
      this.inFlight--;
      this.waiting.shift()?.();
    }
  }

  slot = (commitment = 'finalized') => this.call<number>('getSlot', [{ commitment }]);

  /** Signatures touching `address` newer than `afterSlot`, oldest first, up to `maxSlot`. */
  async signaturesSince(address: string, afterSlot: number, maxSlot: number): Promise<{ signature: string; slot: number; err: unknown }[]> {
    const out: { signature: string; slot: number; err: unknown }[] = [];
    for (let before: string | undefined; ;) {
      const page = await this.call<{ signature: string; slot: number; err: unknown }[]>('getSignaturesForAddress', [address, { limit: 1000, before, commitment: 'finalized' }]);
      let done = page.length < 1000;
      for (const s of page) {
        if (s.slot <= afterSlot) { done = true; break; }
        if (s.slot <= maxSlot) out.push(s);
      }
      if (done) break;
      before = page[page.length - 1].signature;
    }
    return out.reverse();
  }

  transaction = (signature: string) =>
    this.call<any>('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);

  /** A block's transaction signatures, in execution order. */
  blockSignatures = (slot: number) =>
    this.call<{ signatures: string[] }>('getBlock', [slot, { transactionDetails: 'signatures', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 }]).then((b) => b.signatures);

  /** A wallet's token accounts for a mint, with balances (seeding a newly registered wallet). */
  async tokenAccounts(owner: string, mint: string): Promise<{ account: string; amount: number }[]> {
    const r = await this.call<{ value: { pubkey: string; account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(
      'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'finalized' }]);
    return r.value.map((v) => ({ account: v.pubkey, amount: Number(v.account.data.parsed.info.tokenAmount.amount) }));
  }

  accountData = (address: string) =>
    this.call<{ value: { data: [string, string]; lamports: number } | null }>('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }])
      .then((r) => (r.value ? { data: Buffer.from(r.value.data[0], 'base64'), lamports: r.value.lamports } : null));
}
