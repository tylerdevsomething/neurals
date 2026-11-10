// Replaying a receipt on the visitor's computer: download the brain's model once (kept in the
// browser's cache), check its SHA-256, then replay in a Web Worker with the WebAssembly verifier.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { check, shares, type Receipt } from '../../brain/receipt.ts';

export const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';
const CACHE = 'neurals-model-v1';

export type Progress =
  | { stage: 'downloading'; done: number; total: number }
  | { stage: 'checking'; done: number; total: number }
  | { stage: 'loading' }
  | { stage: 'replaying' };

/** The model as a Blob: from the browser's cache, or downloaded (with progress) and cached. */
async function modelBlob(onProgress: (p: Progress) => void): Promise<Blob> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(MODEL_URL);
  if (hit) return hit.blob();
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  // Streamed straight into the cache (on disk), counting progress on the way: the gigabyte never
  // sits in the page's memory.
  let done = 0;
  let last = 0;
  const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      done += chunk.length;
      if (done - last > 8 << 20) { last = done; onProgress({ stage: 'downloading', done, total }); }
      ctl.enqueue(chunk);
    },
  }));
  await cache.put(MODEL_URL, new Response(counted, { headers: { 'content-length': String(total) } }));
  const stored = await cache.match(MODEL_URL);
  if (!stored) throw new Error('the browser did not keep the model (storage full?)');
  return stored.blob();
}

/** SHA-256 of a Blob, read in slices so a 1 GB file never sits in memory twice. */
async function hashBlob(blob: Blob, onProgress: (p: Progress) => void): Promise<string> {
  const h = sha256.create();
  const step = 32 << 20;
  for (let o = 0; o < blob.size; o += step) {
    h.update(new Uint8Array(await blob.slice(o, o + step).arrayBuffer()));
    onProgress({ stage: 'checking', done: Math.min(o + step, blob.size), total: blob.size });
  }
  return bytesToHex(h.digest());
}

let worker: Worker | null = null;
let checkedModel: Blob | null = null;

/** Replays a receipt here. Returns the largest per-part difference (ppm) and whether it is valid. */
export async function replay(receipt: Receipt, brainModel: string, onProgress: (p: Progress) => void): Promise<{ ok: boolean; diff: number; why?: string; seconds: number }> {
  // A receipt naming another model is not the brain's: no replay can make it genuine.
  if (receipt.model !== brainModel) throw new Error('this receipt names a different model than the brain');
  if (!checkedModel) {
    const blob = await modelBlob(onProgress);
    const hash = await hashBlob(blob, onProgress);
    if (hash !== brainModel) {
      await caches.delete(CACHE);
      throw new Error(`the downloaded model is not the brain (sha256 ${hash.slice(0, 16)}…); the cached copy was removed`);
    }
    checkedModel = blob;
  }
  worker ??= new Worker(new URL('./verifier.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const out = await new Promise<{ mass: number[]; seconds: number }>((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.stage === 'done') resolve(m);
      else if (m.stage === 'error') reject(new Error(m.error));
      else onProgress(m);
    };
    w.postMessage({ model: checkedModel, prompt: receipt.prompt, reply: receipt.output });
  });
  const r = check(receipt, { ...receipt, shares: shares(out.mass) }, 1);
  return { ok: r.ok, diff: r.diff, why: r.why, seconds: out.seconds };
}
