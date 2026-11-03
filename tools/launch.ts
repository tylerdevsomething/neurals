// Launch day: watches for the token's creation, checks the mint, records it in the program and
// writes the indexer's config (SPEC §6).
//
//   node tools/launch.ts --rpc <url> --creator <wallet that creates the token> --admin-key <key.json>
//        --config <indexer.json to write> [--curve pump|test] [--since <slot>] [--mint <mint>] [--dry-run]
//
// Before the token exists: the program is deployed and initialized (admin, settler, treasury, fee)
// and the commit memo is posted. Start this, then create the token from the creator wallet. It
// polls the creator's transactions for a newly initialized mint, waits until the mint is final
// (6 decimals, a supply of 1,000,000,000, no mint or freeze authority), derives the curve's token
// account, sends set_mint (admin only, once), and writes the indexer config with the mint, the curve
// account and the creation slot as the start slot. --mint skips the watching. --dry-run sends
// nothing and writes nothing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { sendAndPoll } from '../brain/send.ts';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { NeuralsAccounts, parseConfig } from '../brain/accounts.ts';
import { TOKEN_PROGRAMS } from '../brain/decoder.ts';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TEST_CURVE = new PublicKey('D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8');
const SUPPLY = 1_000_000_000n * 1_000_000n;

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const need = (n: string) => opt(n) ?? (console.error(`missing ${n}`), process.exit(2));
const rpc = need('--rpc');
const configPath = need('--config');
const dry = args.includes('--dry-run');
const curveKind = (opt('--curve') ?? 'pump') as 'pump' | 'test';
const conn = new Connection(rpc, 'confirmed');
const programId = new PublicKey(opt('--program') ?? '9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const acc = new NeuralsAccounts(programId);
const admin = dry && !opt('--admin-key') ? null : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(need('--admin-key'), 'utf8'))));
const say = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/** The curve's token account for a mint: where the sale's tokens sit. */
function curveTokenAccount(mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  if (curveKind === 'test') return PublicKey.findProgramAddressSync([Buffer.from('curve_tokens'), mint.toBuffer()], TEST_CURVE)[0];
  const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP)[0];
  return getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);
}

type MintFacts = { decimals: number; supply: bigint; mintAuthority: string | null; freezeAuthority: string | null; program: PublicKey };
async function mintFacts(mint: PublicKey): Promise<MintFacts | null> {
  const info = await conn.getParsedAccountInfo(mint, 'confirmed');
  const v = info.value;
  if (!v || !('parsed' in v.data) || v.data.parsed.type !== 'mint') return null;
  const p = v.data.parsed.info;
  return { decimals: p.decimals, supply: BigInt(p.supply), mintAuthority: p.mintAuthority ?? null, freezeAuthority: p.freezeAuthority ?? null, program: v.owner };
}
const final = (f: MintFacts) => f.decimals === 6 && f.supply === SUPPLY && f.mintAuthority === null && f.freezeAuthority === null;

/** Polls the creator's transactions for a newly initialized mint; returns it and its slot. */
async function watch(creator: PublicKey, since: number): Promise<{ mint: PublicKey; slot: number }> {
  const seen = new Set<string>();
  say(`watching ${creator.toBase58()} from slot ${since}`);
  for (;;) {
    // Every transaction since `since`, oldest first, however busy the wallet is.
    const sigs: Awaited<ReturnType<typeof conn.getSignaturesForAddress>> = [];
    for (let before: string | undefined; ;) {
      const page = await conn.getSignaturesForAddress(creator, { limit: 1000, before }, 'confirmed');
      sigs.push(...page.filter((s) => s.slot >= since));
      if (page.length < 1000 || page[page.length - 1].slot < since) break;
      before = page[page.length - 1].signature;
    }
    for (const s of sigs.reverse()) {
      if (s.slot < since || seen.has(s.signature) || s.err) continue;
      seen.add(s.signature);
      const tx = await conn.getParsedTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
      const all = [...(tx?.transaction.message.instructions ?? []), ...(tx?.meta?.innerInstructions ?? []).flatMap((g) => g.instructions)];
      for (const ix of all) {
        if (!('parsed' in ix) || !TOKEN_PROGRAMS.has(ix.programId.toBase58())) continue;
        if (ix.parsed?.type === 'initializeMint' || ix.parsed?.type === 'initializeMint2') {
          const mint = new PublicKey(ix.parsed.info.mint);
          say(`new mint ${mint.toBase58()} in ${s.signature.slice(0, 16)}… (slot ${s.slot})`);
          return { mint, slot: s.slot };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const cfgInfo = await conn.getAccountInfo(acc.config(), 'confirmed');
if (!cfgInfo) throw new Error('the program is not initialized on this cluster');
const cfg = parseConfig(Buffer.from(cfgInfo.data));
if (!cfg.mint.equals(PublicKey.default)) say(`note: the program already has a mint recorded (${cfg.mint.toBase58()}); set_mint can only run once`);
if (admin && !cfg.admin.equals(admin.publicKey)) throw new Error('--admin-key is not the program admin');

const found = opt('--mint')
  ? { mint: new PublicKey(opt('--mint')!), slot: Number(opt('--slot') ?? (await conn.getSlot('confirmed'))) }
  : await watch(new PublicKey(need('--creator')), Number(opt('--since') ?? (await conn.getSlot('confirmed'))));

// Wait for the mint to be final: fixed supply, no mint or freeze authority.
let facts: MintFacts | null = null;
for (let i = 0; i < 120; i++) {
  facts = await mintFacts(found.mint);
  if (facts && final(facts)) break;
  if (i === 0) say('waiting for the mint to be final (fixed supply, no authorities)');
  await new Promise((r) => setTimeout(r, 1000));
}
if (!facts || !final(facts)) throw new Error(`mint ${found.mint.toBase58()} is not a fixed-supply 6-decimal mint without authorities: refusing`);
const curve = curveTokenAccount(found.mint, facts.program);
const curveBalance = await conn.getTokenAccountBalance(curve, 'confirmed').catch(() => null);
if (!curveBalance) throw new Error(`no curve token account at ${curve.toBase58()}: wrong --curve kind?`);
say(`mint is final; curve token account ${curve.toBase58()} holds ${curveBalance.value.uiAmountString}`);

if (dry) {
  say('dry run: not sending set_mint, not writing the config');
} else {
  if (!cfg.mint.equals(PublicKey.default)) throw new Error('the program already has a mint: set_mint can only run once');
  // Confirmed by polling: a websocket confirmation can hang on some RPC providers, and this must not stall.
  const sig = await sendAndPoll(conn, new Transaction().add(acc.setMint({ admin: admin!.publicKey, mint: found.mint, curveTokenAccount: curve })), [admin!]);
  say(`set_mint: ${sig}`);
  const base = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  Object.assign(base, {
    mint: found.mint.toBase58(),
    curveTokenAccount: curve.toBase58(),
    pumpProgramId: curveKind === 'pump' ? PUMP.toBase58() : TEST_CURVE.toBase58(),
    programId: programId.toBase58(),
    startSlot: found.slot,
  });
  writeFileSync(configPath, JSON.stringify(base, null, 2));
  say(`wrote ${configPath}: start the indexer with it now`);
}
