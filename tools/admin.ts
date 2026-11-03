// Admin actions on the Neurals program (SPEC §6), for launch day and after.
//
//   node tools/admin.ts init   --rpc <url> --key <upgrade-authority.json> --treasury <pubkey> --settler <pubkey> [--fee-bps 150]
//   node tools/admin.ts offer  --rpc <url> --key <admin.json> --to <new admin pubkey>
//   node tools/admin.ts accept --rpc <url> --key <new-admin.json>
//   node tools/admin.ts roles  --rpc <url> --key <admin.json> --settler <pubkey> --treasury <pubkey> --fee-bps <n>
//   node tools/admin.ts show   --rpc <url>
//   node tools/admin.ts print  accept|roles|veto ... --admin <pubkey>   (instruction for a multisig, sends nothing)
// Every command takes [--program <id>]. Sending commands show what they will do and need --yes.
//
// init must be signed by the program's upgrade authority (the deploy key). The admin it sets is that
// key; hand the role to the treasury multisig with offer, then accept from the multisig (print accept
// shows the instruction to propose there). Nothing changes until the new admin accepts.

import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { NeuralsAccounts, parseConfig } from '../brain/accounts.ts';
import { sendAndPoll } from '../brain/send.ts';

const [cmd, ...args] = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const need = (n: string): string => { const v = opt(n); if (!v) { console.error(`missing ${n}`); process.exit(2); } return v; };
const acc = new NeuralsAccounts(opt('--program') ?? '9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR');
const key = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const conn = () => new Connection(need('--rpc'), 'confirmed');

async function show(c: Connection) {
  const info = await c.getAccountInfo(acc.config(), 'confirmed');
  if (!info) { console.log(`program ${acc.programId.toBase58()}: not initialized`); return null; }
  const cfg = parseConfig(Buffer.from(info.data));
  const offer = await c.getAccountInfo(acc.adminOffer(), 'confirmed');
  console.log(`program   ${acc.programId.toBase58()}`);
  console.log(`admin     ${cfg.admin.toBase58()}${offer ? `  (offered to ${new PublicKey(offer.data.subarray(8, 40)).toBase58()}, not yet accepted)` : ''}`);
  console.log(`settler   ${cfg.settler.toBase58()}`);
  console.log(`treasury  ${cfg.treasury.toBase58()}`);
  console.log(`fee       ${cfg.feeBps / 100}%`);
  console.log(`mint      ${cfg.mint.equals(PublicKey.default) ? '(not set)' : cfg.mint.toBase58()}`);
  return cfg;
}

async function send(c: Connection, signer: Keypair, what: string, ix: Parameters<Transaction['add']>[0]) {
  console.log(`${what}\n  signed by ${signer.publicKey.toBase58()} on ${need('--rpc').replace(/api-key=[^&]+/, 'api-key=…')}`);
  if (!args.includes('--yes')) { console.log('  (dry run: add --yes to send)'); return; }
  console.log(`  sent: ${await sendAndPoll(c, new Transaction().add(ix), [signer])}`);
}

/** Refuses early when the key is not the program's admin (the program would refuse it anyway). */
async function mustBeAdmin(c: Connection, k: Keypair) {
  const info = await c.getAccountInfo(acc.config(), 'confirmed');
  if (!info) throw new Error('the program is not initialized');
  const admin = parseConfig(Buffer.from(info.data)).admin;
  if (!admin.equals(k.publicKey)) throw new Error(`${k.publicKey.toBase58()} is not the admin (${admin.toBase58()} is)`);
}

/** An instruction as a multisig app needs it: program, accounts (with signer and writable flags), data. */
function print(ix: ReturnType<typeof acc.acceptAdmin>) {
  console.log(`program  ${ix.programId.toBase58()}`);
  for (const k of ix.keys) console.log(`account  ${k.pubkey.toBase58()}${k.isSigner ? '  signer' : ''}${k.isWritable ? '  writable' : ''}`);
  console.log(`data     ${ix.data.toString('hex')} (hex)  ${ix.data.toString('base64')} (base64)`);
}

switch (cmd) {
  case 'show': await show(conn()); break;
  case 'init': {
    const c = conn();
    const k = key(need('--key'));
    const feeBps = Number(opt('--fee-bps') ?? 150);
    const treasury = new PublicKey(need('--treasury'));
    const settler = new PublicKey(need('--settler'));
    if (await c.getAccountInfo(acc.config(), 'confirmed')) throw new Error('already initialized');
    await send(c, k, `initialize: admin ${k.publicKey.toBase58()}, treasury ${treasury.toBase58()}, settler ${settler.toBase58()}, fee ${feeBps / 100}%`,
      acc.initialize({ admin: k.publicKey, treasury, feeBps, settler }));
    break;
  }
  case 'offer': {
    const c = conn();
    const k = key(need('--key'));
    const to = new PublicKey(need('--to'));
    await mustBeAdmin(c, k);
    await send(c, k, `offer the admin role to ${to.toBase58()} (it changes nothing until that key accepts)`, acc.offerAdmin(k.publicKey, to));
    break;
  }
  case 'accept': {
    const c = conn();
    const k = key(need('--key'));
    await send(c, k, `accept the admin role as ${k.publicKey.toBase58()}`, acc.acceptAdmin(k.publicKey));
    break;
  }
  case 'roles': {
    const c = conn();
    const k = key(need('--key'));
    const settler = new PublicKey(need('--settler'));
    const treasury = new PublicKey(need('--treasury'));
    const feeBps = Number(need('--fee-bps'));
    await mustBeAdmin(c, k);
    await send(c, k, `set roles: settler ${settler.toBase58()}, treasury ${treasury.toBase58()}, fee ${feeBps / 100}%`, acc.setRoles(k.publicKey, settler, treasury, feeBps));
    break;
  }
  case 'print': {
    const what = args[0];
    const admin = new PublicKey(need('--admin'));
    if (what === 'accept') print(acc.acceptAdmin(admin));
    else if (what === 'roles') print(acc.setRoles(admin, new PublicKey(need('--settler')), new PublicKey(need('--treasury')), Number(need('--fee-bps'))));
    else if (what === 'veto') print(acc.vetoEpoch(admin, Number(need('--epoch'))));
    else { console.error('print accept|roles|veto'); process.exit(2); }
    break;
  }
  default:
    console.error('usage: node tools/admin.ts init|offer|accept|roles|show|print ... (see the top of this file)');
    process.exit(2);
}
