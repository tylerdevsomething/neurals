// Writing the brain's files to Solana, and reading them back (SPEC §2).
//
// A file is cut into 960-byte chunks; each chunk is one transaction calling the SPL Noop ("ink")
// program, so the bytes live in transaction history rather than in rent-paying accounts. Every
// chunk names the file's tag, sha256("neurals:v1:file" ‖ file sha256 ‖ writer), as a read-only
// account, so getSignaturesForAddress(tag) lists the whole file. Only chunks signed by the writer
// count: anyone can name a tag, nobody else can sign as its writer. A chunk of the wrong length, or
// two different versions of one chunk, means the file is broken.
//
// Chunk data: "NRLS" | version u8 (1) | kind u8 (1 = chunk) | index u32 LE | bytes.

import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  type Commitment, type TransactionSignature,
} from '@solana/web3.js';

export const INK_PROGRAM = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
export const MAGIC = Buffer.from('NRLS');
export const VERSION = 1;
export const KIND_CHUNK = 1;
export const HEADER_BYTES = 10;
/** Fits a legacy transaction (1,232 bytes) with the payer, the tag, the ink program and both
 *  compute-budget instructions. Fixed for v1: changing it changes how every file is split. */
export const CHUNK_BYTES = 960;
export const CHUNK_COMPUTE_UNITS = 10_000;

export const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export const chunkCount = (size: number) => Math.ceil(size / CHUNK_BYTES);

export function chunkSlice(file: Uint8Array, index: number): Uint8Array {
  return file.subarray(index * CHUNK_BYTES, Math.min(file.length, (index + 1) * CHUNK_BYTES));
}

export function encodeChunk(index: number, bytes: Uint8Array): Buffer {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error(`bad chunk index ${index}`);
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES) throw new Error(`bad chunk length ${bytes.length}`);
  const head = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(head, 0);
  head[4] = VERSION;
  head[5] = KIND_CHUNK;
  head.writeUInt32LE(index, 6);
  return Buffer.concat([head, bytes]);
}

export function decodeChunk(data: Uint8Array): { index: number; bytes: Uint8Array } | null {
  if (data.length <= HEADER_BYTES || data.length > HEADER_BYTES + CHUNK_BYTES) return null;
  const d = Buffer.from(data.buffer, data.byteOffset, data.length);
  if (!d.subarray(0, 4).equals(MAGIC) || d[4] !== VERSION || d[5] !== KIND_CHUNK) return null;
  return { index: d.readUInt32LE(6), bytes: data.subarray(HEADER_BYTES) };
}

export function fileTag(sha256hex: string, writer: PublicKey): PublicKey {
  return new PublicKey(createHash('sha256').update('neurals:v1:file').update(Buffer.from(sha256hex, 'hex')).update(writer.toBytes()).digest());
}

export function chunkTransaction(o: { writer: PublicKey; tag: PublicKey; index: number; bytes: Uint8Array; blockhash: string; microLamports: number; program?: PublicKey }): Transaction {
  const tx = new Transaction({ feePayer: o.writer, recentBlockhash: o.blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: CHUNK_COMPUTE_UNITS }));
  if (o.microLamports > 0) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.microLamports }));
  tx.add(new TransactionInstruction({
    programId: o.program ?? INK_PROGRAM,
    keys: [{ pubkey: o.tag, isSigner: false, isWritable: false }],
    data: encodeChunk(o.index, o.bytes),
  }));
  return tx;
}

// ---- the manifest ------------------------------------------------------------------------------

export const MANIFEST_FORMAT = 'neurals:v1:manifest';
export type FileRef = { role: 'model' | 'runtime' | 'rules'; name: string; size: number; sha256: string; writer: string };
export type Manifest = { format: typeof MANIFEST_FORMAT; model: string; files: FileRef[] };

const HEX64 = /^[0-9a-f]{64}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = /^[A-Za-z0-9._-]{1,128}$/;

/** Checks a manifest; files come back sorted by role then name, so every writer gets the same bytes. */
export function checkManifest(m: unknown): Manifest {
  const x = m as Manifest;
  if (typeof x !== 'object' || x === null || x.format !== MANIFEST_FORMAT) throw new Error('not a neurals v1 manifest');
  if (!Array.isArray(x.files) || x.files.length === 0) throw new Error('manifest has no files');
  const roles = ['model', 'runtime', 'rules'];
  const files = x.files.map((f) => {
    if (!roles.includes(f?.role)) throw new Error(`unknown role ${f?.role}`);
    if (!NAME.test(f.name)) throw new Error(`bad file name ${f.name}`);
    if (!Number.isSafeInteger(f.size) || f.size <= 0) throw new Error(`bad size for ${f.name}`);
    if (!HEX64.test(f.sha256)) throw new Error(`bad sha256 for ${f.name}`);
    if (!B58.test(f.writer)) throw new Error(`bad writer for ${f.name}`);
    return { role: f.role, name: f.name, size: f.size, sha256: f.sha256, writer: f.writer };
  }).sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < files.length; i++) if (files[i].role === files[i - 1].role && files[i].name === files[i - 1].name) throw new Error(`duplicate file ${files[i].name}`);
  if (!files.some((f) => f.role === 'model' && f.sha256 === x.model)) throw new Error('the brain model is not among the files');
  return { format: MANIFEST_FORMAT, model: x.model, files };
}

export const encodeManifest = (m: Manifest) => Buffer.from(JSON.stringify(checkManifest(m)));

// ---- reading -----------------------------------------------------------------------------------

async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

export type FileId = { sha256: string; size: number; writer: string };

/** Rebuilds a file from chain and checks it against its size and sha256. */
export async function readFile(conn: Connection, ref: FileId, opts: { program?: PublicKey; commitment?: 'confirmed' | 'finalized'; concurrency?: number } = {}): Promise<Buffer> {
  const program = opts.program ?? INK_PROGRAM;
  const commitment = opts.commitment ?? 'confirmed';
  const writer = new PublicKey(ref.writer);
  const tag = fileTag(ref.sha256, writer);
  const total = chunkCount(ref.size);
  const chunks: (Uint8Array | undefined)[] = new Array(total);
  let found = 0;
  const sigs: TransactionSignature[] = [];
  for (let before: string | undefined; ;) {
    const page = await retry(() => conn.getSignaturesForAddress(tag, { before, limit: 1000 }, commitment));
    for (const s of page) if (!s.err) sigs.push(s.signature);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, sigs.length) }, async () => {
    while (next < sigs.length && found < total) {
      const sig = sigs[next++];
      const tx = await retry(() => conn.getTransaction(sig, { commitment, maxSupportedTransactionVersion: 0 }));
      if (!tx || tx.meta?.err) continue;
      const keys = tx.transaction.message.staticAccountKeys;
      if (!keys[0].equals(writer)) continue; // not signed by the writer: ignored
      for (const ix of tx.transaction.message.compiledInstructions) {
        if (!keys[ix.programIdIndex]?.equals(program) || !ix.accountKeyIndexes.some((k) => keys[k]?.equals(tag))) continue;
        const c = decodeChunk(ix.data);
        if (!c || c.index >= total) continue;
        const want = c.index === total - 1 ? ref.size - c.index * CHUNK_BYTES : CHUNK_BYTES;
        if (c.bytes.length !== want) throw new Error(`chunk ${c.index} has the wrong length`);
        const have = chunks[c.index];
        if (have) {
          if (!Buffer.from(have).equals(Buffer.from(c.bytes))) throw new Error(`the writer signed two different versions of chunk ${c.index}`);
          continue;
        }
        chunks[c.index] = c.bytes.slice();
        found++;
      }
    }
  }));
  if (found < total) throw new Error(`only ${found} of ${total} chunks are on chain`);
  const file = Buffer.concat(chunks as Uint8Array[]);
  if (file.length !== ref.size || sha256Hex(file) !== ref.sha256) throw new Error('rebuilt file does not match its size and sha256');
  return file;
}

// ---- writing -----------------------------------------------------------------------------------

export type WriteOptions = {
  program?: PublicKey;
  /** Transactions sent per second. */
  rps?: number;
  maxInFlight?: number;
  microLamports?: number;
  /** Chunk indices already confirmed (to resume). */
  done?: Set<number>;
  onConfirmed?: (index: number) => void;
  onProgress?: (p: { done: number; total: number; inFlight: number; resent: number }) => void;
  commitment?: Commitment;
  /**
   * Where transactions are sent, in turn (default: conn). Providers limit sending separately from
   * reading, so several routes send faster; a route that is rate limited rests for a second alone.
   * Create them with disableRetryOnRateLimit, so a limit fails fast instead of stalling the upload.
   */
  sendVia?: Connection[];
};

/**
 * Sends every chunk of a file and returns once each is confirmed. A chunk whose transaction expires
 * unconfirmed is sent again; a chunk confirmed twice is harmless (same bytes, same index).
 */
export async function writeFile(conn: Connection, writer: Keypair, file: Uint8Array, opts: WriteOptions = {}): Promise<{ sha256: string; chunks: number; resent: number }> {
  const sha = sha256Hex(file);
  const tag = fileTag(sha, writer.publicKey);
  const total = chunkCount(file.length);
  const done = opts.done ?? new Set<number>();
  const rps = opts.rps ?? 10;
  const maxInFlight = opts.maxInFlight ?? 500;
  const commitment = opts.commitment ?? 'confirmed';
  const queue: number[] = [];
  for (let i = 0; i < total; i++) if (!done.has(i)) queue.push(i);
  const inFlight = new Map<string, { index: number; lastValid: number }>();
  let resent = 0;
  let sending = 0;
  let failure: unknown = null;
  let hash = await retry(() => conn.getLatestBlockhash(commitment));
  let hashAt = Date.now();
  const report = () => opts.onProgress?.({ done: done.size, total, inFlight: inFlight.size, resent });

  const checker = (async () => {
    while ((queue.length || inFlight.size || sending) && !failure) {
      await new Promise((r) => setTimeout(r, 1000));
      const sigs = [...inFlight.keys()];
      if (!sigs.length) continue;
      try {
        const height = await retry(() => conn.getBlockHeight(commitment));
        for (let i = 0; i < sigs.length; i += 256) {
          const part = sigs.slice(i, i + 256);
          const { value } = await retry(() => conn.getSignatureStatuses(part));
          value.forEach((st, k) => {
            const f = inFlight.get(part[k]);
            if (!f) return;
            if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
              inFlight.delete(part[k]);
              if (!done.has(f.index)) { done.add(f.index); opts.onConfirmed?.(f.index); }
            } else if (st?.err) {
              failure = new Error(`chunk ${f.index} failed on chain: ${JSON.stringify(st.err)}`);
            } else if (height > f.lastValid) {
              inFlight.delete(part[k]);
              if (!done.has(f.index)) { queue.push(f.index); resent++; }
            }
          });
        }
        report();
      } catch (e) {
        failure = e;
      }
    }
  })();

  const gap = 1000 / rps;
  let nextAt = Date.now();
  const routes = opts.sendVia?.length ? opts.sendVia : [conn];
  const restUntil = routes.map(() => 0);
  let turn = 0;
  /** The next route that is not resting, or -1. */
  const nextRoute = () => {
    for (let k = 0; k < routes.length; k++) {
      const r = (turn + k) % routes.length;
      if (Date.now() >= restUntil[r]) { turn = r + 1; return r; }
    }
    return -1;
  };
  while ((queue.length || inFlight.size || sending) && !failure) {
    if (!queue.length || inFlight.size + sending >= maxInFlight || restUntil.every((t) => Date.now() < t)) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    if (Date.now() - hashAt > 20_000) { hash = await retry(() => conn.getLatestBlockhash(commitment)); hashAt = Date.now(); }
    const wait = nextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextAt = Math.max(nextAt + gap, Date.now());
    const route = nextRoute();
    if (route < 0) continue;
    const index = queue.shift()!;
    if (done.has(index)) continue;
    const tx = chunkTransaction({ writer: writer.publicKey, tag, index, bytes: chunkSlice(file, index), blockhash: hash.blockhash, microLamports: opts.microLamports ?? 0, program: opts.program });
    tx.sign(writer);
    const lastValid = hash.lastValidBlockHeight;
    sending++;
    routes[route].sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 })
      .then((sig) => { inFlight.set(sig, { index, lastValid }); })
      .catch(() => { queue.unshift(index); restUntil[route] = Date.now() + 1000; }) // rate limited or rejected: this route rests
      .finally(() => { sending--; });
  }
  await checker;
  if (failure) throw failure;
  return { sha256: sha, chunks: total, resent };
}
