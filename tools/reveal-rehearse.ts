// Rehearses the automatic reveal on a fresh local validator (scripts/localnet.sh): the whole curve
// sells out, and the indexer must find the seed block the rules name and reveal by itself.
//
//   node tools/reveal-rehearse.ts [rpcUrl=http://127.0.0.1:8899]
//
// Checks: the sellout slot is the slot of the buy that sold the last position; the seed block is the
// first block at or after sellout + delay; the reveal is exactly the one the rules give for that block;
// a second indexer syncing from scratch reveals identically; a restarted indexer re-checks and accepts
// its stored reveal; a reveal drawn from any other block is refused.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createMint, mintTo, setAuthority, AuthorityType, createAssociatedTokenAccountIdempotent } from '@solana/spl-token';
import { NeuralsAccounts, anchorDiscriminator } from '../brain/accounts.ts';
import { UNIT, CURVE_SUPPLY } from '../brain/model.ts';
import { buildReveal, checkRules, type Rules } from '../brain/reveal.ts';
import { Rpc } from '../indexer/rpc.ts';
import { Store } from '../indexer/store.ts';
import { Indexer } from '../indexer/indexer.ts';

const URL_ = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8899';
const EPOCH_SLOTS = 40;
const DELAY = 20;
const NEURALS = new PublicKey('9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const CURVE_PROGRAM = new PublicKey('D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8');
const conn = new Connection(URL_, 'confirmed');
const acc = new NeuralsAccounts(NEURALS);
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const send = (signers: Keypair[], ...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
const airdrop = async (to: PublicKey, sol: number) => { await conn.confirmTransaction(await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL), 'confirmed'); };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const curvePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], CURVE_PROGRAM)[0];
const curveTokens = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], CURVE_PROGRAM)[0];
const buyIx = (user: PublicKey, mint: PublicKey, amount: bigint) => new TransactionInstruction({
  programId: CURVE_PROGRAM, data: Buffer.concat([anchorDiscriminator('buy'), u64(amount), u64(0n)]),
  keys: [
    { pubkey: user, isSigner: true, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curvePda(mint), isSigner: false, isWritable: false }, { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
    { pubkey: acc.ata(user, mint), isSigner: false, isWritable: true }, { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
});
const canon = (x: unknown) => JSON.stringify(x);

console.log('\nlaunch');
const payer = Keypair.generate();
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('C:/Users/Admin/neurals-keys/localnet-admin.json', 'utf8'))));
const buyers = Array.from({ length: 3 }, () => Keypair.generate());
await airdrop(payer.publicKey, 20);
await airdrop(admin.publicKey, 5);
for (const b of buyers) await airdrop(b.publicKey, 2);
const mint = await createMint(conn, payer, payer.publicKey, null, 6, Keypair.generate(), { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await send([payer], new TransactionInstruction({
  programId: CURVE_PROGRAM, data: anchorDiscriminator('initialize_curve'),
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curvePda(mint), isSigner: false, isWritable: true }, { pubkey: curveTokens(mint), isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
}));
await mintTo(conn, payer, mint, curveTokens(mint), payer, 1_000_000_000n * BigInt(UNIT), [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await setAuthority(conn, payer, mint, payer, AuthorityType.MintTokens, null, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
if (!(await conn.getAccountInfo(acc.config()))) await send([admin], acc.initialize({ admin: admin.publicKey, treasury: Keypair.generate().publicKey, feeBps: 150, settler: Keypair.generate().publicKey }));
await send([admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens(mint) }));
for (const b of buyers) await createAssociatedTokenAccountIdempotent(conn, payer, mint, b.publicKey, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);

const startSlot = await conn.getSlot('confirmed');
const draft = JSON.parse(readFileSync('rules/neurals-v1.draft.json', 'utf8')) as Rules;
const rules = checkRules({ ...draft, seed: { delaySlots: DELAY, deadlineSlot: startSlot + 1_000_000 } });
const config = {
  mint: mint.toBase58(), curveTokenAccount: curveTokens(mint).toBase58(), pumpProgramId: CURVE_PROGRAM.toBase58(),
  pumpNonBuyInstructions: ['migrate', 'withdraw'], programId: NEURALS.toBase58(), startSlot, epochSlots: EPOCH_SLOTS,
};
const make = (dir: string) => { const ix = new Indexer(config, new Rpc(URL_), new Store(dir)); ix.setRules(rules); return ix; };
const dirA = mkdtempSync(join(tmpdir(), 'neurals-reveal-a-'));
const a = make(dirA);

console.log('\nthe curve sells out');
const third = BigInt(Math.floor(CURVE_SUPPLY / 3)) * BigInt(UNIT);
await send([buyers[0]], buyIx(buyers[0].publicKey, mint, third));
await send([buyers[1]], buyIx(buyers[1].publicKey, mint, third));
const last = await send([buyers[2]], buyIx(buyers[2].publicKey, mint, BigInt(CURVE_SUPPLY) * BigInt(UNIT) - 2n * third));
const soldOutAt = (await conn.getTransaction(last, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }))!.slot;
await send([buyers[0]], buyIx(buyers[0].publicKey, mint, 1_000n * BigInt(UNIT))); // past the sale: issues nothing new
console.log(`  sold out in slot ${soldOutAt}; the seed slot is ${soldOutAt + DELAY}`);

console.log('\nthe indexer reveals by itself');
for (let i = 0; i < 180 && !a.ledger.isRevealed; i++) { await a.syncOnce(); await new Promise((r) => setTimeout(r, 1000)); }
check(a.soldOutSlot === soldOutAt, `it found the sellout slot (${a.soldOutSlot})`);
const blocks = await conn.getBlocks(soldOutAt + DELAY, soldOutAt + DELAY + 500, 'finalized');
const seedBlock = await conn.getBlock(blocks[0], { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 });
check(a.revealed?.seedSlot === blocks[0], `its seed block is the first block at or after sellout + ${DELAY} (${blocks[0]})`);
check(!!a.revealed && canon(a.revealed) === canon(buildReveal(rules, blocks[0], seedBlock!.blockhash)), 'its reveal is exactly the one the rules give for that block');
check(a.ledger.isRevealed, 'the ledger applied it');

console.log('\nanyone gets the same reveal');
const dirB = mkdtempSync(join(tmpdir(), 'neurals-reveal-b-'));
const b = make(dirB);
for (let i = 0; i < 60 && (!b.ledger.isRevealed || b.syncedSlot < a.syncedSlot); i++) { await b.syncOnce(); await new Promise((r) => setTimeout(r, 1000)); }
const common = Math.max(a.syncedSlot, b.syncedSlot);
a.ledger.advanceTo(common);
b.ledger.advanceTo(common);
check(canon(a.revealed) === canon(b.revealed), 'a second indexer syncing from scratch built the identical reveal');
check(a.ledger.fingerprint() === b.ledger.fingerprint(), 'and reached the identical ledger');

console.log('\nrestarts');
const storeA = new Store(dirA);
const r = make(dirA);
r.useReveal(storeA.readReveal()!);
r.restore();
let ok = true;
try { await r.checkSeed(); } catch { ok = false; }
check(ok, 'a restarted indexer re-checks its stored reveal against the chain and accepts it');
r.ledger.advanceTo(common);
check(r.ledger.fingerprint() === a.ledger.fingerprint(), 'and rebuilds the identical ledger');

const other = await conn.getBlock(blocks[1], { transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 1 });
const forged = buildReveal(rules, blocks[1], other!.blockhash); // a valid draw, from a block the rules do not name
const f = make(mkdtempSync(join(tmpdir(), 'neurals-reveal-f-')));
f.useReveal(forged);
for (let i = 0; i < 60 && f.syncedSlot < a.syncedSlot; i++) await f.syncOnce();
let refused = false;
try { await f.checkSeed(); } catch (e) { refused = /not the canonical reveal/.test((e as Error).message); }
check(refused, `a reveal drawn from another block (${blocks[1]}) is refused`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
