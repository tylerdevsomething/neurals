// The hosted brain: answers chat messages and pays the neurons that fired (SPEC §7).
//
//   node brainserver/server.ts <config.json>
//
// For each message: the probe generates the reply and measures it with the canonical pass; the
// receipt (model hash, prompt and reply tokens, 1,318 ppm shares) is published to the indexer;
// then the fee is paid on chain naming the receipt's hash. The reply comes back with the receipt
// hash and the payment's signature, so anyone can replay the receipt and check it.
//
// Messages run one at a time, with a fixed thread count: the probe's arithmetic is the receipt.
//
// Config: { port, probe, model (path as the probe sees it), modelPath (path here, for hashing),
//           indexerUrl, rpcUrl, programId, payerKey, feeLamports, threads?, maxTokens?, wsl? }
//
//   POST /chat  { "message": "..." }  ->  { reply, tokens, receipt, signature, fee }
//   GET  /health

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NeuralsAccounts } from '../brain/accounts.ts';
import { shares, receiptHash, type Receipt } from '../brain/receipt.ts';
import { SEGMENT_COUNT } from '../brain/model.ts';

type Config = {
  port: number;
  probe: string;
  model: string;
  modelPath: string;
  indexerUrl: string;
  rpcUrl: string;
  programId: string;
  payerKey: string;
  feeLamports: number;
  threads?: number;
  maxTokens?: number;
  /** Run the probe through WSL (Windows host, Linux probe). Default: true on Windows. */
  wsl?: boolean;
};

type ProbeRun = { prompt: number[]; output: number[]; text: string; mass: number[] };

export function runProbe(c: Pick<Config, 'probe' | 'model' | 'threads' | 'maxTokens' | 'wsl'>, message: string): Promise<ProbeRun> {
  const args = ['-m', c.model, '-p', message, '-n', String(c.maxTokens ?? 96), '-t', String(c.threads ?? 2)];
  const wsl = c.wsl ?? process.platform === 'win32';
  const [cmd, argv] = wsl ? ['wsl', ['-e', c.probe, ...args]] : [c.probe, args];
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { maxBuffer: 64 << 20, timeout: 10 * 60_000 }, (err, stdout) => {
      if (err) return reject(new Error(`probe failed: ${err.message}`));
      if (/[,[]nan[,\]]/.test(stdout)) return reject(new Error('probe produced NaN masses: the computation was corrupted'));
      const run = JSON.parse(stdout) as ProbeRun;
      if (run.mass.length !== SEGMENT_COUNT) return reject(new Error(`probe gave ${run.mass.length} masses`));
      resolve(run);
    });
  });
}

async function hashFile(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16_384) throw new Error('message too long');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startBrain(config: Config) {
  const modelHash = await hashFile(config.modelPath);
  // The payer's key: PAYER_KEY (its JSON array) when hosted, or a file path in the config.
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.PAYER_KEY ?? readFileSync(config.payerKey, 'utf8'))));
  const conn = new Connection(config.rpcUrl, 'confirmed');
  const accounts = new NeuralsAccounts(config.programId);
  let queue: Promise<unknown> = Promise.resolve();
  let served = 0;

  async function think(message: string) {
    const run = await runProbe(config, message);
    const receipt: Receipt = { model: modelHash, prompt: run.prompt, output: run.output, shares: shares(run.mass) };
    const hash = receiptHash(receipt);
    // Publish first: the indexer must have the receipt before the fee that names it settles.
    const res = await fetch(`${config.indexerUrl}/receipts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(receipt) });
    const body = (await res.json()) as { hash?: string; error?: string };
    if (!res.ok || body.hash !== hash) throw new Error(`indexer refused the receipt: ${body.error ?? body.hash}`);
    const signature = await sendAndConfirmTransaction(conn, new Transaction().add(accounts.payFee(payer.publicKey, hash, config.feeLamports)), [payer], { commitment: 'confirmed' });
    served++;
    return { reply: run.text, tokens: run.output.length, receipt: hash, signature, fee: config.feeLamports };
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, null);
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { model: modelHash, served, payer: payer.publicKey.toBase58(), fee: config.feeLamports });
      if (req.method === 'POST' && req.url === '/chat') {
        const { message } = JSON.parse(await readBody(req)) as { message?: string };
        if (typeof message !== 'string' || !message.trim()) return json(res, 400, { error: 'message required' });
        const job = queue.then(() => think(message.slice(0, 4000)));
        queue = job.catch(() => undefined);
        return json(res, 200, await job);
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });
  server.listen(config.port);
  console.log(`brain on :${config.port}, model ${modelHash.slice(0, 16)}…, payer ${payer.publicKey.toBase58()}, ${config.threads ?? 2} threads`);
  return { server, modelHash };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('brainserver/server.ts')) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node brainserver/server.ts <config.json>');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  // Hosting: secrets and addresses from the environment.
  if (process.env.PORT) config.port = Number(process.env.PORT);
  if (process.env.RPC_URL) config.rpcUrl = process.env.RPC_URL;
  if (process.env.INDEXER_URL) config.indexerUrl = process.env.INDEXER_URL;
  await startBrain(config);
}
