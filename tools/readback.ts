// Reads inscribed files back from chain and checks every chunk against the local copy, a page at a time.
// Unlike `inscribe.ts --verify` it never holds a file in memory (the local file is read at each chunk's
// offset), shows its progress, runs at low priority, keeps under a request rate, and resumes where it
// stopped (state in out/inscribe/readback.json).
//
//   node tools/readback.ts --rpc <url> --writer <pubkey> [--rps 40] [--concurrency 8] <file>...
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { setPriority, constants } from 'node:os';
import { Connection, PublicKey } from '@solana/web3.js';
import { INK_PROGRAM, CHUNK_BYTES, chunkCount, decodeChunk, fileTag } from '../brain/inscribe.ts';

const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const rpc = argOf('--rpc');
const writerArg = argOf('--writer');
const rps = Number(argOf('--rps') ?? 40);
const concurrency = Number(argOf('--concurrency') ?? 8);
const files = args;
if (!rpc || !writerArg || !files.length) { console.error('usage: node tools/readback.ts --rpc <url> --writer <pubkey> [--rps 40] <file>...'); process.exit(2); }
try { setPriority(constants.priority.PRIORITY_LOW); } catch { /* best effort */ }

const writer = new PublicKey(writerArg);
const conn = new Connection(rpc, { commitment: 'finalized', disableRetryOnRateLimit: true });
const STATE = 'out/inscribe/readback.json';
type FileState = { done: string; before?: string; finished?: boolean; mismatches?: number[] };
const state: Record<string, FileState> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state));

// At most `rps` requests a second, spread evenly.
let nextAt = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + 1000 / rps;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
async function call<T>(f: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try { return await f(); } catch (e) {
      if (attempt >= 12) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** attempt)));
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b as Buffer);
  return h.digest('hex');
}

let failed = false;
for (const path of files) {
  const size = statSync(path).size;
  const sha = await sha256File(path);
  const total = chunkCount(size);
  const st = (state[sha] ??= { done: Buffer.alloc(Math.ceil(total / 8)).toString('base64') });
  const bits = Buffer.from(st.done, 'base64');
  const has = (i: number) => (bits[i >> 3] & (1 << (i & 7))) !== 0;
  let checked = 0;
  for (let i = 0; i < total; i++) if (has(i)) checked++;
  if (st.finished) { console.log(`${basename(path)}: already checked, ${checked.toLocaleString()} / ${total.toLocaleString()} chunks match`); continue; }
  console.log(`${basename(path)}: ${size.toLocaleString()} bytes, ${total.toLocaleString()} chunks, ${checked.toLocaleString()} checked before`);

  const fd = openSync(path, 'r');
  const local = Buffer.alloc(CHUNK_BYTES);
  const tag = fileTag(sha, writer);
  const started = Date.now();
  const startedAt = checked;
  let lastReport = 0;
  for (;;) {
    const page = await call(() => conn.getSignaturesForAddress(tag, { before: st.before, limit: 1000 }, 'finalized'));
    const sigs = page.filter((s) => !s.err).map((s) => s.signature);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, sigs.length) }, async () => {
      while (next < sigs.length) {
        const sig = sigs[next++];
        const tx = await call(() => conn.getTransaction(sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }));
        if (!tx || tx.meta?.err) continue;
        const keys = tx.transaction.message.staticAccountKeys;
        if (!keys[0].equals(writer)) continue; // not signed by the writer: ignored
        for (const ix of tx.transaction.message.compiledInstructions) {
          if (!keys[ix.programIdIndex]?.equals(INK_PROGRAM) || !ix.accountKeyIndexes.some((k) => keys[k]?.equals(tag))) continue;
          const c = decodeChunk(ix.data);
          if (!c || c.index >= total) continue;
          const want = c.index === total - 1 ? size - c.index * CHUNK_BYTES : CHUNK_BYTES;
          readSync(fd, local, 0, want, c.index * CHUNK_BYTES);
          if (c.bytes.length !== want || !local.subarray(0, want).equals(Buffer.from(c.bytes))) {
            (st.mismatches ??= []).push(c.index);
            console.log(`MISMATCH: chunk ${c.index} on chain differs from the local file (tx ${sig})`);
            continue;
          }
          if (!has(c.index)) { bits[c.index >> 3] |= 1 << (c.index & 7); checked++; }
        }
      }
    }));
    if (page.length) st.before = page[page.length - 1].signature;
    st.done = bits.toString('base64');
    save();
    if (Date.now() - lastReport > 30_000 || page.length < 1000) {
      lastReport = Date.now();
      const rate = (checked - startedAt) / Math.max(1, (Date.now() - started) / 1000);
      const left = rate > 0 ? (total - checked) / rate / 3600 : NaN;
      console.log(`  ${checked.toLocaleString()} / ${total.toLocaleString()} chunks match (${((checked / total) * 100).toFixed(1)}%), ${rate.toFixed(1)}/s, about ${left.toFixed(1)} h left`);
    }
    if (page.length < 1000) break;
  }
  closeSync(fd);
  st.finished = true;
  save();
  if (checked === total && !st.mismatches?.length) console.log(`verified ${basename(path)}: all ${total.toLocaleString()} chunks on chain match the local file (sha256 ${sha.slice(0, 16)}…)`);
  else {
    failed = true;
    const missing: number[] = [];
    for (let i = 0; i < total && missing.length < 20; i++) if (!has(i)) missing.push(i);
    console.log(`PROBLEM with ${basename(path)}: ${checked.toLocaleString()} / ${total.toLocaleString()} chunks match; missing ${missing.join(', ')}${total - checked > 20 ? '…' : ''}; mismatches ${st.mismatches?.length ?? 0}`);
  }
}
console.log(failed ? 'read-back found problems (above)' : 'read-back: every file matches');
process.exit(failed ? 1 : 0);
