// Checks a deployment before (and after) launch: the configs, the program on chain, its roles, the
// rules and the brain all agree. Read-only. Exits 1 if anything fails.
//
//   node tools/preflight.ts <indexer.json> [--brain-config <brain.json>] [--rpc <url>] [--brain <url>]
//        [--so <program.so>] [--multisig <pubkey>] [--stage before-token|after-token|handed-over]
//
// --stage: before-token (default) expects no mint yet; after-token expects the mint recorded;
// handed-over also expects the admin and upgrade authority to be the multisig (--multisig).

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { NeuralsAccounts, parseConfig } from '../brain/accounts.ts';
import { checkRules, type Rules } from '../brain/reveal.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const path = args[0];
if (!path || path.startsWith('--')) {
  console.error('usage: node tools/preflight.ts <indexer.json> [--brain-config <brain.json>] [--rpc <url>] [--brain <url>] [--so <file>] [--multisig <pubkey>] [--stage before-token|after-token|handed-over]');
  process.exit(2);
}
const stage = opt('--stage') ?? 'before-token';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const NON_BUY = ['migrate', 'migrate_v2', 'migrate_v3', 'withdraw', 'withdraw_v2'];
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

let fails = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { fails++; console.log(`  FAIL  ${m}`); };
const check = (cond: boolean, good: string, bad: string = good) => (cond ? ok(good) : fail(bad));
const note = (m: string) => console.log(`  note  ${m}`);

type IndexerConfig = Record<string, unknown> & { rpcUrl: string; programId: string; model: string; cluster?: string; epochSlots: number; challengeSlots?: number; pumpProgramId: string; pumpNonBuyInstructions: string[]; brainKey?: string; rulesFile?: string; mint?: string; minPushLamports?: number };
const config = JSON.parse(readFileSync(path, 'utf8')) as IndexerConfig;
const mainnet = config.cluster === 'mainnet';
const rpcUrl = opt('--rpc') ?? process.env.RPC_URL ?? config.rpcUrl;
const conn = new Connection(rpcUrl, 'confirmed');
const acc = new NeuralsAccounts(config.programId);

console.log(`\nconfig ${path} (${config.cluster ?? 'no cluster'})`);
const placeholders = JSON.stringify(config).match(/<[^>]+>/g);
check(!placeholders, 'no placeholders left', `placeholders still to fill: ${placeholders?.join(', ')}`);
if (mainnet) {
  check(config.epochSlots === 9_000, 'epochs are one hour (9,000 slots)', `epochSlots is ${config.epochSlots}, not 9,000`);
  check((config.challengeSlots ?? 9_000) === 9_000, 'challenge window matches the mainnet build (9,000 slots)', `challengeSlots is ${config.challengeSlots}: the mainnet program uses 9,000`);
  check(config.pumpProgramId === PUMP, 'pump.fun program', `pumpProgramId is ${config.pumpProgramId}, not pump.fun's`);
  check(NON_BUY.every((n) => config.pumpNonBuyInstructions.includes(n)), 'pump.fun non-buy instructions listed', `pumpNonBuyInstructions misses some of ${NON_BUY.join(', ')}`);
  check((config.minPushLamports ?? 100_000) >= 50_000, 'small payouts are left to claim, not pushed at a loss', `minPushLamports ${config.minPushLamports} pushes payouts smaller than their fee`);
}
check(!!config.brainKey, 'brain key set: only its fees and signed receipts count', 'brainKey missing: anyone could publish receipts');
if (mainnet) note('the site browser RPC comes from PUBLIC_RPC_URL on the host (never the private RPC_URL)');

console.log('\nprogram on chain');
const programInfo = await conn.getAccountInfo(acc.programId, 'confirmed');
let upgradeAuthority: string | null = null;
if (!programInfo) fail(`no program at ${acc.programId.toBase58()} on this cluster`);
else {
  check(programInfo.executable && programInfo.owner.toBase58() === UPGRADEABLE_LOADER, 'deployed, upgradeable', 'not an upgradeable program');
  const programData = new PublicKey(programInfo.data.subarray(4, 36));
  const pd = await conn.getAccountInfo(programData, 'confirmed');
  if (pd) {
    upgradeAuthority = pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null;
    note(`upgrade authority: ${upgradeAuthority ?? 'none (immutable)'}`);
    const so = opt('--so');
    if (so) {
      const want = readFileSync(so);
      const have = pd.data.subarray(45, 45 + want.length);
      const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
      check(sha(have) === sha(want) && pd.data.subarray(45 + want.length).every((b) => b === 0), `the deployed code is exactly ${so} (sha256 ${sha(want).slice(0, 16)}…)`, `the deployed code is NOT ${so}`);
    } else note('pass --so out/mainnet/neurals.so to check the deployed code byte for byte');
  }
}

console.log('\nprogram config');
const cfgInfo = await conn.getAccountInfo(acc.config(), 'confirmed');
if (!cfgInfo) fail('not initialized (node tools/admin.ts init)');
else {
  const cfg = parseConfig(Buffer.from(cfgInfo.data));
  note(`admin ${cfg.admin.toBase58()}, settler ${cfg.settler.toBase58()}, treasury ${cfg.treasury.toBase58()}`);
  check(cfg.feeBps === 150, 'market fee 1.5%', `market fee is ${cfg.feeBps / 100}%, not 1.5%`);
  check(!cfg.treasury.equals(cfg.settler) && !cfg.treasury.equals(cfg.admin) || !mainnet, 'treasury is its own key', 'the treasury is the same key as the admin or settler');
  const mintSet = !cfg.mint.equals(PublicKey.default);
  if (stage === 'before-token') check(!mintSet, 'no mint recorded yet (set_mint runs on launch day)', `a mint is already recorded (${cfg.mint.toBase58()}): this program can never launch another token`);
  else check(mintSet && cfg.mint.toBase58() === config.mint, `mint recorded and matches the config (${cfg.mint.toBase58()})`, 'the recorded mint does not match the config');
  const multisig = opt('--multisig') ?? (config.multisig as string | undefined);
  if (stage === 'handed-over') {
    if (!multisig) fail('--multisig <vault> is needed to check the handover');
    else {
      check(cfg.admin.toBase58() === multisig, 'the admin is the multisig', `the admin is still ${cfg.admin.toBase58()}`);
      check(upgradeAuthority === multisig, 'the upgrade authority is the multisig', `the upgrade authority is ${upgradeAuthority}`);
    }
  }
  for (const [name, k] of [['settler', cfg.settler]] as const) {
    const sol = (await conn.getBalance(k, 'confirmed')) / 1e9;
    check(sol >= 0.05, `${name} has ${sol.toFixed(3)} SOL for fees`, `${name} has ${sol} SOL: fund it (posting and pushing payouts costs fees)`);
  }
}

console.log('\nrules');
if (!config.rulesFile || !existsSync(config.rulesFile)) fail(`rules file ${config.rulesFile ?? '(none)'} missing`);
else {
  try {
    const rules = checkRules(JSON.parse(readFileSync(config.rulesFile, 'utf8')) as Rules);
    check(rules.model === config.model, 'rules are for this model', 'the rules are for a different model');
    ok(`${Object.keys(rules.traits).length} traits; seed ${JSON.stringify(rules.seed)}`);
    if (mainnet) check(rules.seed.deadlineSlot > (await conn.getSlot('confirmed')), 'the reveal deadline is in the future', 'the reveal deadline slot has passed');
    note(`commit memo: node tools/commit.ts ${config.rulesFile}  (post it before the token exists)`);
  } catch (e) {
    fail(`rules: ${(e as Error).message}`);
  }
}

const brainConfigPath = opt('--brain-config');
const brainUrl = opt('--brain') ?? (config.brainUrl as string | undefined);
if (brainConfigPath || brainUrl) console.log('\nbrain');
if (brainConfigPath) {
  const b = JSON.parse(readFileSync(brainConfigPath, 'utf8')) as Record<string, unknown>;
  check(b.programId === config.programId, 'brain config names the same program', 'the brain config names a different program');
  check(b.requirePayment !== false, 'visitors pay for messages', 'requirePayment is off: the brain pays for everyone');
  check(typeof b.feeLamports === 'number' && b.feeLamports === 1_000_000, 'message fee 0.001 SOL', `message fee is ${b.feeLamports} lamports`);
}
if (brainUrl) {
  try {
    const h = (await (await fetch(`${brainUrl}/health`)).json()) as { model: string; payer: string; requirePayment?: boolean };
    check(h.model === config.model, 'the running brain is the model', 'the running brain has a different model');
    check(h.payer === config.brainKey, 'the running brain\'s key is the brainKey', `the running brain's key ${h.payer} is not brainKey ${config.brainKey}`);
    check(h.requirePayment !== false, 'the running brain asks visitors to pay', 'the running brain does not ask for payment');
    const sol = (await conn.getBalance(new PublicKey(h.payer), 'confirmed')) / 1e9;
    check(sol >= 0.02, `brain key has ${sol.toFixed(3)} SOL for fees`, `brain key has ${sol} SOL: fund it for network fees`);
  } catch (e) {
    fail(`brain ${brainUrl}: ${(e as Error).message}`);
  }
}

console.log(fails ? `\n${fails} problem(s): fix them before going on` : '\nall checks passed');
process.exit(fails ? 1 : 0);
