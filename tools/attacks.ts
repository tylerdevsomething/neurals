// Adversarial tests of the Neurals program on a fresh local validator (scripts/localnet.sh, with
// the program built with --features devnet for a short challenge window).
//
//   node tools/attacks.ts [rpcUrl=http://127.0.0.1:8899]
//
// Every attack must fail with the expected error; the legitimate paths around each must still work.

import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createMint, mintTo, setAuthority, AuthorityType, createAssociatedTokenAccountIdempotent } from '@solana/spl-token';
import { NeuralsAccounts, anchorDiscriminator, parseConfig } from '../brain/accounts.ts';
import { buildTree } from '../brain/claims.ts';
import { UNIT } from '../brain/model.ts';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8899';
const NEURALS = new PublicKey('9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const CURVE = new PublicKey('D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8');
const CHALLENGE = 20; // CHALLENGE_SLOTS with --features devnet
const conn = new Connection(URL_, 'confirmed');
const acc = new NeuralsAccounts(NEURALS);
const T = (n: number) => n * UNIT;

let failures = 0;
const ok = (c: boolean, what: string) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${what}`); if (!c) failures++; };
const send = (signers: Keypair[], ...ixs: TransactionInstruction[]) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed', skipPreflight: false });

/** The attack must fail with this Anchor error (or, for token/system errors, any failure). */
async function refused(what: string, code: string | null, signers: Keypair[], ...ixs: TransactionInstruction[]) {
  try {
    await send(signers, ...ixs);
    ok(false, `${what}: it SUCCEEDED`);
  } catch (e) {
    const logs = ((e as { logs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs ?? []).join('\n') + String((e as Error).message);
    ok(code === null || logs.includes(`Error Code: ${code}`), `${what}: refused${code ? ` (${code})` : ''}${code && !logs.includes(`Error Code: ${code}`) ? ` -- but with: ${logs.split('\n').find((l) => l.includes('Error')) ?? 'another error'}` : ''}`);
  }
}
const airdrop = async (k: PublicKey, sol: number) => conn.confirmTransaction(await conn.requestAirdrop(k, sol * LAMPORTS_PER_SOL), 'confirmed');
const waitSlots = async (n: number) => { const s = await conn.getSlot('confirmed'); while ((await conn.getSlot('confirmed')) < s + n) await new Promise((r) => setTimeout(r, 400)); };

// ---- setup ----
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('C:/Users/Admin/neurals-keys/localnet-admin.json', 'utf8'))));
const [attacker, settler, alice, bob, payer] = Array.from({ length: 5 }, () => Keypair.generate());
const treasury = Keypair.generate().publicKey;
for (const k of [admin, attacker, settler, alice, bob, payer]) await airdrop(k.publicKey, 10);

console.log('\ninitialization');
await refused('an attacker initializes the program first', 'NotUpgradeAuthority', [attacker], acc.initialize({ admin: attacker.publicKey, treasury: attacker.publicKey, feeBps: 0, settler: attacker.publicKey }));
await refused('an attacker passes a fake program-data account', null, [attacker], (() => {
  const ix = acc.initialize({ admin: attacker.publicKey, treasury, feeBps: 0, settler: attacker.publicKey });
  ix.keys[5] = { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false };
  return ix;
})());
await send([admin], acc.initialize({ admin: admin.publicKey, treasury, feeBps: 150, settler: settler.publicKey }));
ok(true, 'the upgrade authority initializes');

const mint = await createMint(conn, admin, admin.publicKey, null, 6, Keypair.generate(), { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
const curvePda = PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], CURVE)[0];
const curveTokens = PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], CURVE)[0];
await send([admin], new TransactionInstruction({ programId: CURVE, data: anchorDiscriminator('initialize_curve'), keys: [
  { pubkey: admin.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
  { pubkey: curvePda, isSigner: false, isWritable: true }, { pubkey: curveTokens, isSigner: false, isWritable: true },
  { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
] }));
await mintTo(conn, admin, mint, curveTokens, admin, BigInt(1e9) * BigInt(UNIT), [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);

console.log('\nroles and the mint');
await refused('set_mint before the mint is final (it still has a mint authority)', 'BadMint', [admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens }));
await setAuthority(conn, admin, mint, admin, AuthorityType.MintTokens, null, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
await refused('an attacker records the mint', 'NotAdmin', [attacker], acc.setMint({ admin: attacker.publicKey, mint, curveTokenAccount: curveTokens }));
await send([admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens }));
await refused('the mint is recorded a second time', 'MintAlreadySet', [admin], acc.setMint({ admin: admin.publicKey, mint, curveTokenAccount: curveTokens }));
await refused('an attacker makes themselves the settler', 'NotAdmin', [attacker], acc.setRoles(attacker.publicKey, attacker.publicKey, attacker.publicKey, 0));
await refused('the admin sets a market fee above 5%', 'FeeTooHigh', [admin], acc.setRoles(admin.publicKey, settler.publicKey, treasury, 501));

// Alice and Bob buy off the curve.
const buy = async (k: Keypair, n: number) => {
  await createAssociatedTokenAccountIdempotent(conn, k, mint, k.publicKey, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
  const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  await send([k], new TransactionInstruction({ programId: CURVE, data: Buffer.concat([anchorDiscriminator('buy'), u64(T(n)), u64(0)]), keys: [
    { pubkey: k.publicKey, isSigner: true, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curvePda, isSigner: false, isWritable: false }, { pubkey: curveTokens, isSigner: false, isWritable: true },
    { pubkey: acc.ata(k.publicKey, mint), isSigner: false, isWritable: true }, { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ] }));
};
await buy(alice, 1_000_000);
await buy(bob, 1_000_000);
await createAssociatedTokenAccountIdempotent(conn, attacker, mint, attacker.publicKey, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);

console.log('\ncheckpoints and the market');
const cfg = () => conn.getAccountInfo(acc.config()).then((i) => parseConfig(Buffer.from(i!.data)));
await refused('a seal names more positions than the tokens it moves', 'PositionsExceedAmount', [alice], acc.seal({ owner: alice.publicKey, mint, nextId: (await cfg()).nextId, positions: [[0, T(2)]], amount: T(1) }));
await refused('a seal with unsorted, overlapping positions', 'UnsortedPositions', [alice], acc.seal({ owner: alice.publicKey, mint, nextId: (await cfg()).nextId, positions: [[0, 10], [5, 20]], amount: 100 }));
await refused('an attacker seals Alice\'s tokens', null, [attacker], (() => {
  const ix = acc.seal({ owner: attacker.publicKey, mint, nextId: 0n, positions: [[0, 10]], amount: 10 });
  ix.keys[4] = { pubkey: acc.ata(alice.publicKey, mint), isSigner: false, isWritable: true };
  return ix;
})());
const id = (await cfg()).nextId;
await send([alice], acc.seal({ owner: alice.publicKey, mint, nextId: id, positions: [[0, T(100_000)]], amount: T(100_000) }));
const cp = acc.checkpoint(id);
await refused('an attacker withdraws Alice\'s checkpoint to themselves', 'WrongHolder', [attacker], acc.withdraw({ holder: attacker.publicKey, checkpoint: cp, mint }));
await refused('an attacker lists Alice\'s checkpoint', 'WrongHolder', [attacker], acc.list(attacker.publicKey, cp, 1n));
await refused('an attacker gifts Alice\'s checkpoint to themselves', 'WrongHolder', [attacker], acc.gift(attacker.publicKey, cp, attacker.publicKey));
await send([alice], acc.list(alice.publicKey, cp, BigInt(LAMPORTS_PER_SOL)));
await refused('Alice withdraws the tokens while the checkpoint is listed', 'WrongState', [alice], acc.withdraw({ holder: alice.publicKey, checkpoint: cp, mint }));
await refused('Alice gifts it away while it is listed', 'WrongState', [alice], acc.gift(alice.publicKey, cp, bob.publicKey));
await refused('Alice buys her own listing', 'SelfPurchase', [alice], acc.buy({ buyer: alice.publicKey, checkpoint: cp, holder: alice.publicKey, treasury, maxPrice: BigInt(LAMPORTS_PER_SOL) }));
await refused('Bob is charged more than his maximum (the price changed)', 'PriceChanged', [bob], acc.buy({ buyer: bob.publicKey, checkpoint: cp, holder: alice.publicKey, treasury, maxPrice: BigInt(LAMPORTS_PER_SOL - 1) }));
await refused('the market fee is sent to an attacker instead of the treasury', 'WrongTreasury', [bob], acc.buy({ buyer: bob.publicKey, checkpoint: cp, holder: alice.publicKey, treasury: attacker.publicKey, maxPrice: BigInt(LAMPORTS_PER_SOL) }));
await refused('the sale proceeds are sent to an attacker instead of the seller', 'WrongHolder', [bob], acc.buy({ buyer: bob.publicKey, checkpoint: cp, holder: attacker.publicKey, treasury, maxPrice: BigInt(LAMPORTS_PER_SOL) }));
await send([bob], acc.buy({ buyer: bob.publicKey, checkpoint: cp, holder: alice.publicKey, treasury, maxPrice: BigInt(LAMPORTS_PER_SOL) }));
ok(true, 'Bob buys the checkpoint at the listed price');
await refused('Alice (no longer the holder) withdraws it', 'WrongHolder', [alice], acc.withdraw({ holder: alice.publicKey, checkpoint: cp, mint }));
await refused('a carry to oneself', 'SelfCarry', [bob], acc.carry({ from: bob.publicKey, to: bob.publicKey, mint, positions: [], amount: 1 }));

console.log('\nthe fee pool and payouts');
await send([payer], acc.payFee(payer.publicKey, 'ab'.repeat(32), LAMPORTS_PER_SOL / 2));
const payouts = new Map([[alice.publicKey.toBase58(), 200_000_000n], [bob.publicKey.toBase58(), 100_000_000n]]);
const tree = buildTree(1, payouts);
await refused('an attacker posts a payout root', 'NotSettler', [attacker], acc.postEpoch({ settler: attacker.publicKey, epoch: 1, root: tree.root, total: tree.total, count: 2 }));
await refused('the settler posts more than the pool holds', 'PoolShort', [settler], acc.postEpoch({ settler: settler.publicKey, epoch: 1, root: tree.root, total: 600_000_000n, count: 2 }));

// A stolen settler key posts a root paying the attacker everything: the admin vetoes it in time.
const theft = buildTree(1, new Map([[attacker.publicKey.toBase58(), 400_000_000n]]));
await send([settler], acc.postEpoch({ settler: settler.publicKey, epoch: 1, root: theft.root, total: theft.total, count: 1 }));
const c0 = theft.claims.get(attacker.publicKey.toBase58())!;
await refused('the thief claims during the challenge window', 'ChallengeWindow', [attacker], acc.claim({ payer: attacker.publicKey, wallet: attacker.publicKey, epoch: 1, index: c0.index, amount: c0.amount, proof: c0.proof }));
await refused('an attacker vetoes (only the admin can)', 'NotAdmin', [attacker], acc.vetoEpoch(attacker.publicKey, 1));
await send([admin], acc.vetoEpoch(admin.publicKey, 1));
ok(!(await conn.getAccountInfo(acc.epoch(1))), 'the admin vetoes the bad root: the epoch account is closed');

// The correct root is posted, waits out the window, and pays exactly once.
await send([settler], acc.postEpoch({ settler: settler.publicKey, epoch: 1, root: tree.root, total: tree.total, count: 2 }));
ok(true, 'the settler re-posts the correct root (the vetoed amount was released back to the pool)');
const a = tree.claims.get(alice.publicKey.toBase58())!;
const b = tree.claims.get(bob.publicKey.toBase58())!;
await waitSlots(CHALLENGE + 2);
await refused('an attacker veto after the window has passed', 'ChallengeOver', [admin], acc.vetoEpoch(admin.publicKey, 1));
await refused('Alice claims more than her payout', 'BadProof', [alice], acc.claim({ payer: alice.publicKey, wallet: alice.publicKey, epoch: 1, index: a.index, amount: a.amount + 1n, proof: a.proof }));
await refused('an attacker claims Alice\'s payout to their own wallet', 'BadProof', [attacker], acc.claim({ payer: attacker.publicKey, wallet: attacker.publicKey, epoch: 1, index: a.index, amount: a.amount, proof: a.proof }));
await refused('Bob uses Alice\'s index', 'BadProof', [bob], acc.claim({ payer: bob.publicKey, wallet: bob.publicKey, epoch: 1, index: a.index, amount: b.amount, proof: b.proof }));
const before = await conn.getBalance(alice.publicKey);
await send([payer], acc.claim({ payer: payer.publicKey, wallet: alice.publicKey, epoch: 1, index: a.index, amount: a.amount, proof: a.proof }));
ok(BigInt((await conn.getBalance(alice.publicKey)) - before) === a.amount, 'anyone pushes Alice her exact payout after the window');
await refused('the same payout claimed twice', 'AlreadyClaimed', [payer], acc.claim({ payer: payer.publicKey, wallet: alice.publicKey, epoch: 1, index: a.index, amount: a.amount, proof: a.proof }));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nevery attack was refused; every legitimate path worked');
process.exit(failures ? 1 : 0);
