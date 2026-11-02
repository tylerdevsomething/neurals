// Launches the token on a test chain and writes ready-to-run configs for the indexer and the brain.
//
//   node tools/localnet-up.ts                                   a fresh local validator (airdrops)
//   node tools/localnet-up.ts https://api.devnet.solana.com --payer <funded key.json> [--cluster devnet]
//
// Creates a Token-2022 mint with a fixed supply on the test curve, initializes Neurals (admin,
// settler, treasury, 1.5% market fee), records the mint, and makes a few curve buys from demo
// wallets. Off localnet, the wallets are funded from --payer (about 2 SOL in all). Writes into
// out/<cluster>/ (git-ignored): keys, indexer.json and brain.json. The programs must already be
// deployed there (scripts/deploy-devnet.sh for devnet).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createMint, mintTo, setAuthority, AuthorityType, createAssociatedTokenAccountIdempotent } from '@solana/spl-token';
import { NeuralsAccounts, anchorDiscriminator } from '../brain/accounts.ts';
import { UNIT, TOKENS } from '../brain/model.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const URL_ = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8899';
const local = /127\.0\.0\.1|localhost/.test(URL_);
const CLUSTER = opt('--cluster') ?? (local ? 'localnet' : 'devnet');
const payer = opt('--payer') ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--payer')!, 'utf8')))) : null;
if (!local && !payer) throw new Error('off localnet, pass --payer <funded key.json>');
const NEURALS = new PublicKey('9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const CURVE_PROGRAM = new PublicKey('D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8');
const OUT = resolve(`out/${CLUSTER}`);
/** SHA-256 of models/qwen2.5-1.5b-instruct-q4_k_m.gguf (scripts/fetch-model.sh checks it against Hugging Face). */
const BRAIN_MODEL_SHA256 = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e';
const conn = new Connection(URL_, 'confirmed');
const acc = new NeuralsAccounts(NEURALS);

const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const curvePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], CURVE_PROGRAM)[0];
const curveTokens = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], CURVE_PROGRAM)[0];
const send = (signers: Keypair[], ...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
const save = (name: string, k: Keypair) => { const p = join(OUT, `key-${name}.json`); writeFileSync(p, JSON.stringify(Array.from(k.secretKey))); return p; };

mkdirSync(OUT, { recursive: true });
if (await conn.getAccountInfo(acc.config())) {
  throw new Error(local
    ? 'Neurals is already initialized on this validator: start a fresh one (scripts/localnet.sh)'
    : 'Neurals is already initialized on this cluster: its mint can be recorded only once. Redeploy under a new program id to launch again.');
}
const [admin, settler, brain, ...demo] = Array.from({ length: 7 }, () => Keypair.generate());
const treasury = Keypair.generate();
if (local) {
  for (const k of [admin, settler, brain, ...demo]) {
    await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL), 'confirmed');
  }
} else {
  // Admin pays for the mint, curve and config; the brain pays fees; demo wallets pay their own buys.
  const amounts: [Keypair, number][] = [[admin, 0.6], [settler, 0.3], [brain, 0.6], ...demo.map((k) => [k, 0.1] as [Keypair, number])];
  await send([payer!], ...amounts.map(([k, sol]) => SystemProgram.transfer({ fromPubkey: payer!.publicKey, toPubkey: k.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) })));
}
const mint = await createMint(conn, admin, admin.publicKey, null, 6, Keypair.generate(), { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await send([admin], new TransactionInstruction({
  programId: CURVE_PROGRAM, data: anchorDiscriminator('initialize_curve'),
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curvePda(mint), isSigner: false, isWritable: true },
    { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
}));
await mintTo(conn, admin, mint, curveTokens(mint), admin, BigInt(1_000_000_000) * BigInt(UNIT), [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await setAuthority(conn, admin, mint, admin, AuthorityType.MintTokens, null, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
const startSlot = await conn.getSlot('confirmed');
await send([admin], acc.initialize({ admin: admin.publicKey, treasury: treasury.publicKey, feeBps: 150, settler: settler.publicKey }));
await send([admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens(mint) }));

// Demo buyers: the Embedding and some heads, a few columns.
const buys = [TOKENS.embedding + 4 * TOKENS.head, 8 * TOKENS.head, 3 * TOKENS.column, 5 * TOKENS.column];
for (const [i, amount] of buys.entries()) {
  const k = demo[i];
  await createAssociatedTokenAccountIdempotent(conn, k, mint, k.publicKey, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
  await send([k], new TransactionInstruction({
    programId: CURVE_PROGRAM, data: Buffer.concat([anchorDiscriminator('buy'), u64(amount * UNIT), u64(0)]),
    keys: [
      { pubkey: k.publicKey, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: curvePda(mint), isSigner: false, isWritable: false },
      { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
      { pubkey: acc.ata(k.publicKey, mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
}

const keys = { admin: save('admin', admin), settler: save('settler', settler), brain: save('brain', brain), treasury: save('treasury', treasury) };
demo.forEach((k, i) => save(`demo-${i}`, k));
writeFileSync(join(OUT, 'demo-wallets.txt'), demo.map((k) => k.publicKey.toBase58()).join('\n') + '\n');
const indexer = {
  rpcUrl: URL_, port: 8787, dataDir: join(OUT, 'indexer-data'),
  programId: NEURALS.toBase58(), mint: mint.toBase58(), curveTokenAccount: curveTokens(mint).toBase58(),
  pumpProgramId: CURVE_PROGRAM.toBase58(), pumpNonBuyInstructions: ['migrate', 'withdraw'],
  startSlot, epochSlots: 150, model: BRAIN_MODEL_SHA256, settlerKey: keys.settler, pollMs: 2000,
  brainUrl: 'http://127.0.0.1:8788', cluster: CLUSTER,
};
const brainCfg = {
  port: 8788, probe: '/root/neurals-build/probe/neurals-probe',
  model: '/mnt/c/git/neurals/models/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  modelPath: resolve('models/qwen2.5-1.5b-instruct-q4_k_m.gguf'),
  indexerUrl: 'http://127.0.0.1:8787', rpcUrl: URL_, programId: NEURALS.toBase58(),
  payerKey: keys.brain, feeLamports: 1_000_000, threads: 4, maxTokens: 64,
};
writeFileSync(join(OUT, 'indexer.json'), JSON.stringify(indexer, null, 2));
writeFileSync(join(OUT, 'brain.json'), JSON.stringify(brainCfg, null, 2));
console.log(`mint ${mint.toBase58()}\ncurve tokens ${curveTokens(mint).toBase58()}\nstart slot ${startSlot}\ndemo wallets: ${demo.map((k) => k.publicKey.toBase58()).join(', ')}\nconfigs in ${OUT}`);
