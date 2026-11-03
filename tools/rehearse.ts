// End-to-end rehearsal on a local validator (or devnet): the whole system on a real chain.
//
//   node tools/rehearse.ts [rpcUrl=http://127.0.0.1:8899] [--payer <key.json>] [--epoch-slots 60]
//
// The validator must have the neurals, test-curve and SPL Noop programs loaded (README). On a local
// validator the payer is airdropped; elsewhere pass a funded --payer.
//
// Epoch 0: launch (Token-2022 mint with a fixed supply, test curve, config, set_mint), curve buys
//          (including a newer buy variant), a sell-back, a buy partly of sold-back tokens, a seal
//          and a carry.
// Epoch 1: the checkpoint is listed and bought; two paid messages, one with a published receipt.
// Epoch 2: the indexer settles epoch 1, posts the root and pushes payouts; every wallet must
//          receive exactly its payout.
// Then: a second indexer rebuilt from the log, and a third syncing the chain from scratch, must
// reach the same ledger fingerprint; and a file inscribed as chunks must read back intact.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createMint, mintTo, setAuthority, AuthorityType, createAssociatedTokenAccountIdempotent,
} from '@solana/spl-token';
import { NeuralsAccounts, anchorDiscriminator, parseConfig } from '../brain/accounts.ts';
import { UNIT, TOKENS } from '../brain/model.ts';
import { SLOTS, PARTS } from '../brain/layout.ts';
import { shares, type Receipt } from '../brain/receipt.ts';
import { total } from '../brain/ranges.ts';
import { writeFile, readFile, sha256Hex } from '../brain/inscribe.ts';
import { Rpc } from '../indexer/rpc.ts';
import { Store } from '../indexer/store.ts';
import { Indexer } from '../indexer/indexer.ts';
import { Settler } from '../indexer/settler.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const URL_ = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8899';
const EPOCH_SLOTS = Number(opt('--epoch-slots') ?? 60);
const local = URL_.includes('127.0.0.1') || URL_.includes('localhost');

const NEURALS = new PublicKey('9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const CURVE_PROGRAM = new PublicKey('D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8');
const MODEL = 'ab'.repeat(32); // stand-in model hash for receipts
const conn = new Connection(URL_, 'confirmed');
const acc = new NeuralsAccounts(NEURALS);
const T = (tokens: number) => tokens * UNIT;

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const step = (s: string) => console.log(`\n${s}`);

async function send(signers: Keypair[], ...ixs: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
}

async function fund(to: PublicKey, sol: number, payer: Keypair) {
  if (local) {
    const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
  } else {
    await send([payer], SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: sol * LAMPORTS_PER_SOL }));
  }
}

// ---- the test curve's instructions ----
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const curvePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], CURVE_PROGRAM)[0];
const curveTokens = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], CURVE_PROGRAM)[0];
function curveIx(name: 'buy' | 'buy_exact_sol_in' | 'sell', user: PublicKey, mint: PublicKey, amount: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: CURVE_PROGRAM,
    data: Buffer.concat([anchorDiscriminator(name), u64(amount), u64(0)]),
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: curvePda(mint), isSigner: false, isWritable: false },
      { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
      { pubkey: acc.ata(user, mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

/** Waits until everything confirmed so far is finalized, then syncs the indexer to it. */
async function catchUp(ix: { syncOnce(): Promise<number> }) {
  await waitForSlot(await conn.getSlot('confirmed'));
  await ix.syncOnce();
}

async function waitForSlot(slot: number) {
  for (;;) {
    const now = await conn.getSlot('finalized');
    if (now >= slot) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------------------------------------------------------------------------------------------
step('launch');
const payer = opt('--payer') ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--payer')!, 'utf8')))) : Keypair.generate();
const [alice, bob, carol, eve, settlerKey, apiKey] = Array.from({ length: 6 }, () => Keypair.generate());
const treasury = Keypair.generate().publicKey;
if (local) await fund(payer.publicKey, 50, payer);
// Initialize must be signed by the program's upgrade authority (scripts/localnet.sh sets it to this key).
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(opt('--admin') ?? 'C:/Users/Admin/neurals-keys/localnet-admin.json', 'utf8'))));
if (local) await fund(admin.publicKey, 5, payer);
for (const k of [alice, bob, carol, eve, settlerKey, apiKey]) await fund(k.publicKey, 2, payer);

const mint = await createMint(conn, payer, payer.publicKey, null, 6, Keypair.generate(), { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await send([payer], new TransactionInstruction({
  programId: CURVE_PROGRAM,
  data: anchorDiscriminator('initialize_curve'),
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curvePda(mint), isSigner: false, isWritable: true },
    { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
}));
await mintTo(conn, payer, mint, curveTokens(mint), payer, BigInt(1_000_000_000) * BigInt(UNIT), [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await setAuthority(conn, payer, mint, payer, AuthorityType.MintTokens, null, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
const configExists = await conn.getAccountInfo(acc.config());
if (!configExists) await send([admin], acc.initialize({ admin: admin.publicKey, treasury, feeBps: 150, settler: settlerKey.publicKey }));
await send([admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens(mint) }));
const cfg = parseConfig(Buffer.from((await conn.getAccountInfo(acc.config()))!.data));
check(cfg.mint.equals(mint), 'set_mint recorded the mint');
for (const k of [alice, bob, carol, eve]) await createAssociatedTokenAccountIdempotent(conn, payer, mint, k.publicKey, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);

const startSlot = await conn.getSlot('confirmed');
const dataDir = mkdtempSync(join(tmpdir(), 'neurals-rehearse-'));
const config = {
  mint: mint.toBase58(), curveTokenAccount: curveTokens(mint).toBase58(), pumpProgramId: CURVE_PROGRAM.toBase58(),
  pumpNonBuyInstructions: ['migrate', 'withdraw'], programId: NEURALS.toBase58(), startSlot, epochSlots: EPOCH_SLOTS,
};
const store = new Store(dataDir);
const indexer = new Indexer(config, new Rpc(URL_), store);
const settler = new Settler(conn, settlerKey, acc);
settler.minPushLamports = 0; // push every payout, however small, so the checks see them all
settler.log = (m) => console.log(`  ${m}`);
settler.challengeSlots = 20; // CHALLENGE_SLOTS of the --features devnet build
const settled: Promise<void>[] = [];
indexer.onSettled = (s) => { const f = store.readEpoch(s.epoch); if (f) settled.push(settler.enqueue(f)); };
console.log(`  start slot ${startSlot}, epochs of ${EPOCH_SLOTS} slots, data in ${dataDir}`);

// ---------------------------------------------------------------------------------------------
step('epoch 0: buys, a sell-back, a seal, a carry');
await send([alice], curveIx('buy', alice.publicKey, mint, T(TOKENS.embedding + 2 * TOKENS.head)));
await send([bob], curveIx('buy', bob.publicKey, mint, T(10 * TOKENS.head)));
await send([carol], curveIx('buy_exact_sol_in', carol.publicKey, mint, T(TOKENS.column)));
await send([bob], curveIx('sell', bob.publicKey, mint, T(400_000)));
await send([eve], curveIx('buy', eve.publicKey, mint, T(500_000))); // 400,000 of it is bob's sell-back
const head1 = SLOTS[1];
await send([alice], acc.seal({ owner: alice.publicKey, mint, nextId: cfg.nextId, positions: [[head1.start, head1.end]], amount: T(TOKENS.head) }));
const cp = acc.checkpoint(cfg.nextId);
await send([alice], acc.carry({ from: alice.publicKey, to: carol.publicKey, mint, positions: [[0, T(1_000_000)]], amount: T(1_000_000) }));
await catchUp(indexer);
const L = indexer.ledger;
check(total(L.positions(alice.publicKey.toBase58())) === T(TOKENS.embedding + TOKENS.head - 1_000_000), 'alice: embedding and head 2, less what she sealed and carried');
check(total(L.positions(bob.publicKey.toBase58())) === T(10 * TOKENS.head), 'bob keeps all 10 heads after selling 400,000 back (dormant, not lost)');
check(total(L.awake(bob.publicKey.toBase58())) === T(600_000), "bob's awake neurons follow his balance");
check(total(L.positions(eve.publicKey.toBase58())) === T(100_000), 'eve: only 100,000 fresh; the rest was sold-back tokens');
check(total(L.positions(carol.publicKey.toBase58())) === T(TOKENS.column + 1_000_000), 'carol: her column (newer buy variant) and the carried 1,000,000');
check(JSON.stringify(L.checkpointPositions(cp.toBase58())) === JSON.stringify([[head1.start, head1.end]]), 'the checkpoint holds head 1');

// ---------------------------------------------------------------------------------------------
step('epoch 1: the checkpoint is sold; two paid messages');
await waitForSlot(startSlot + EPOCH_SLOTS + 1);
const price = BigInt(LAMPORTS_PER_SOL / 2);
await send([alice], acc.list(alice.publicKey, cp, price));
const aliceBefore = await conn.getBalance(alice.publicKey);
await send([bob], acc.buy({ buyer: bob.publicKey, checkpoint: cp, holder: alice.publicKey, treasury, maxPrice: price }));
check((await conn.getBalance(alice.publicKey)) - aliceBefore === Number(price) * (1 - 0.015), 'the seller got the price less the 1.5% market fee');
check((await conn.getBalance(treasury)) === Number(price) * 0.015, 'the treasury got the fee');
const receipt: Receipt = { model: MODEL, prompt: [1, 2, 3], output: [4, 5], shares: shares(PARTS.map((p) => (p.kind === 'head' ? 5 : 1))) };
const known = store.addReceipt(receipt, MODEL);
await send([apiKey], acc.payFee(apiKey.publicKey, known, LAMPORTS_PER_SOL / 5));
await send([apiKey], acc.payFee(apiKey.publicKey, createHash('sha256').update('never published').digest('hex'), LAMPORTS_PER_SOL / 10));
await catchUp(indexer);
check(L.holderOf(cp.toBase58()) === bob.publicKey.toBase58(), 'the ledger shows bob holding the checkpoint');

// ---------------------------------------------------------------------------------------------
step('epoch 2: settle epoch 1, post the root, push payouts');
const watch = [alice, bob, carol, eve].map((k) => k.publicKey);
const before = await Promise.all(watch.map((k) => conn.getBalance(k)));
await waitForSlot(startSlot + 2 * EPOCH_SLOTS + 1);
await catchUp(indexer);
await Promise.all(settled);
const s1 = indexer.settlements.find((s) => s.epoch === 1);
check(!!s1, 'epoch 1 settled');
if (s1) {
  const paid = [...s1.payouts.values()].reduce((a, b) => a + b, 0n);
  check(s1.fees === 300_000_000n, 'epoch 1 took in 0.3 SOL of fees');
  check(paid + s1.carried === 300_000_000n + (indexer.settlements.find((s) => s.epoch === 0)?.carried ?? 0n), 'every lamport is paid or carried');
  const after = await Promise.all(watch.map((k) => conn.getBalance(k)));
  watch.forEach((k, i) => {
    const owed = s1.payouts.get(k.toBase58()) ?? 0n;
    check(BigInt(after[i] - before[i]) === owed, `${['alice', 'bob', 'carol', 'eve'][i]} received exactly the payout (${owed} lamports)`);
  });
  check((s1.payouts.get(bob.publicKey.toBase58()) ?? 0n) > (s1.payouts.get(eve.publicKey.toBase58()) ?? 0n), 'bob (awake heads and the checkpoint) out-earned eve');
  const epochAcct = await conn.getAccountInfo(acc.epoch(1));
  check(!!epochAcct, 'the epoch 1 root is on chain');
}
const again = await settler.settle(store.readEpoch(1)!);
check(!again.posted && again.claimed === 0, 'settling again posts nothing and pushes nothing');

// ---------------------------------------------------------------------------------------------
step('withdraw: the checkpoint returns its neurons');
await send([bob], acc.withdraw({ holder: bob.publicKey, checkpoint: cp, mint }));
await catchUp(indexer);
check(total(L.positions(bob.publicKey.toBase58())) === T(11 * TOKENS.head), 'bob now holds head 1 in his wallet too');
check(L.holderOf(cp.toBase58()) === undefined, 'the checkpoint is closed');

step('determinism: rebuilt from the log, and synced from scratch');
const rebuilt = new Indexer(config, new Rpc(URL_), new Store(dataDir));
rebuilt.restore();
check(rebuilt.ledger.fingerprint() === L.fingerprint(), 'a restart rebuilds the identical ledger');
// An independent indexer with the same published receipts, following the chain from the start.
const secondStore = new Store(mkdtempSync(join(tmpdir(), 'neurals-second-')));
secondStore.addReceipt(receipt, MODEL);
const second = new Indexer(config, new Rpc(URL_), secondStore);
await second.syncOnce();
await indexer.syncOnce();
const common = Math.max(second.syncedSlot, indexer.syncedSlot);
second.ledger.advanceTo(common);
L.advanceTo(common);
check(second.ledger.fingerprint() === L.fingerprint(), 'a second indexer syncing from scratch reaches the identical ledger');
check(second.trees.get(1)?.root.equals(indexer.trees.get(1)!.root) === true, 'and the identical epoch 1 payout root');

// ---------------------------------------------------------------------------------------------
step('inscription: write a file as chunks and read it back');
const file = randomBytes(5000);
const written = await writeFile(conn, payer, file, { rps: 20 });
const back = await readFile(conn, { sha256: written.sha256, size: file.length, writer: payer.publicKey.toBase58() });
check(written.chunks === 6 && back.equals(file) && sha256Hex(back) === written.sha256, `5,000 bytes in ${written.chunks} chunks read back intact`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
