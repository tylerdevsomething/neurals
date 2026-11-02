// Inscribes the brain's files on chain and writes their manifest (SPEC §2).
//
//   node tools/inscribe.ts --rpc <url> --key <writer.json> --model <file.gguf> [--runtime <file>...]
//        [--rules <rules.json>] [--rps 10] [--micro-lamports 0] [--verify]
//
// Each file is written as 960-byte chunks (brain/inscribe.ts). A journal per file and network
// (out/inscribe/<network>-<sha256>.json) records confirmed chunks, so an interrupted run resumes
// without resending them. When every file is on chain, the manifest is written as a file too, and
// its sha256 and size are printed: together with the writer, that is the brain's address.
// --verify reads every file back from chain and checks it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Connection, Keypair } from '@solana/web3.js';
import { writeFile, readFile, sha256Hex, chunkCount, encodeManifest, MANIFEST_FORMAT, type FileRef } from '../brain/inscribe.ts';

const args = process.argv.slice(2);
const all = (n: string) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const opt = (n: string) => all(n)[0];
const rpc = opt('--rpc');
const keyPath = opt('--key');
const modelPath = opt('--model');
if (!rpc || !keyPath || !modelPath) {
  console.error('usage: node tools/inscribe.ts --rpc <url> --key <writer.json> --model <file> [--runtime <file>...] [--rules <file>] [--rps 10] [--verify]');
  process.exit(2);
}
const conn = new Connection(rpc, 'confirmed');
const writer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
const genesis = (await conn.getGenesisHash()).slice(0, 8);
mkdirSync('out/inscribe', { recursive: true });

async function inscribe(role: FileRef['role'], path: string, label: string = role): Promise<FileRef> {
  const file = readFileSync(path);
  const sha = sha256Hex(file);
  const total = chunkCount(file.length);
  const journal = join('out/inscribe', `${genesis}-${sha}.json`);
  const done = new Set<number>(existsSync(journal) ? (JSON.parse(readFileSync(journal, 'utf8')) as number[]) : []);
  const save = () => writeFileSync(journal, JSON.stringify([...done]));
  console.log(`${label} ${basename(path)}: ${file.length.toLocaleString()} bytes, ${total.toLocaleString()} chunks, ${done.size.toLocaleString()} already on chain`);
  if (done.size < total) {
    let last = Date.now();
    let since = 0;
    await writeFile(conn, writer, file, {
      done, rps: Number(opt('--rps') ?? 10), microLamports: Number(opt('--micro-lamports') ?? 0),
      onConfirmed: () => { if (++since % 200 === 0) save(); },
      onProgress: (p) => {
        if (Date.now() - last < 5000) return;
        last = Date.now();
        console.log(`  ${p.done.toLocaleString()} / ${p.total.toLocaleString()} confirmed, ${p.inFlight} in flight, ${p.resent} resent`);
      },
    });
    save();
  }
  return { role, name: basename(path), size: file.length, sha256: sha, writer: writer.publicKey.toBase58() };
}

const files: FileRef[] = [await inscribe('model', modelPath)];
for (const r of all('--runtime')) files.push(await inscribe('runtime', r));
if (opt('--rules')) files.push(await inscribe('rules', opt('--rules')!));

const manifest = encodeManifest({ format: MANIFEST_FORMAT, model: files[0].sha256, files });
const manifestPath = join('out/inscribe', `manifest-${genesis}.json`);
writeFileSync(manifestPath, manifest);
const m = await inscribe('rules', manifestPath, 'manifest');
console.log(`\nmanifest on chain: writer ${m.writer}, sha256 ${m.sha256}, ${m.size} bytes`);
console.log(`brain address: neurals:v1:${m.writer}:${m.sha256}:${m.size}`);

if (args.includes('--verify')) {
  for (const f of [...files, m]) {
    const back = await readFile(conn, f);
    console.log(`verified ${f.name}: ${back.length.toLocaleString()} bytes match sha256 ${f.sha256.slice(0, 16)}…`);
  }
}
