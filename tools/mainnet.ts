// Mainnet steps from LAUNCH.md as single commands, for the operator to run (they spend real SOL).
// The RPC is Helius mainnet, its key read from .env and masked in all output.
//
//   node tools/mainnet.ts deploy --yes     step 3: deploy the checked build (scripts/deploy-mainnet.sh, in WSL)
//   node tools/mainnet.ts init --yes       step 4: initialize (treasury = the multisig, settler, 1.5%)
//   node tools/mainnet.ts upload --yes [--rps 8]   step 5: start the brain upload in the background (log: out/inscribe/mainnet.log)
//   node tools/mainnet.ts stop             stops the upload (safe: upload again to resume where it stopped)
//   node tools/mainnet.ts status           balances, program, config, upload progress (read-only)
//   node tools/mainnet.ts rules --yes      step 6: write deploy/rules.mainnet.json (deadline 7 days out) and post its commit memo
//   node tools/mainnet.ts verify           step 5 end: add the rules to the brain on chain, write the manifest, read everything back
//   node tools/mainnet.ts readback         read every inscribed file back and compare it with the local copy (light, resumable, shows progress)
//   node tools/mainnet.ts preflight [--stage before-token|after-token|handed-over] [--brain <url>]
//   node tools/mainnet.ts launch --creator <wallet> --yes   step 7: watch for the token, record its mint (set_mint), write the config
//   node tools/mainnet.ts offer --yes      step 8: offer the admin role to the multisig (it accepts in Squads)
//   node tools/mainnet.ts print-accept     step 8: the instruction to propose in Squads
//   node tools/mainnet.ts upgrade-authority --yes   step 8: move the program's upgrade authority to the multisig
//   node tools/mainnet.ts railway-setup --yes       step 7.1: create the mainnet services, volumes, domains and
//                                                   variables (secrets go through stdin, never printed), and deploy the brain
//   node tools/mainnet.ts railway-fallback --yes    Alchemy as the RPC fallback on both mainnet services; redeploys the brain
//   node tools/mainnet.ts railway-deploy --yes      step 7.3: deploy the site and indexer (after the launch wrote the mint)

import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const [cmd] = process.argv.slice(2);
const yes = process.argv.includes('--yes');
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const PIDFILE = 'out/inscribe/mainnet.pid';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const env = readFileSync('.env', 'utf8');
const key = /^HELIUS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (!key) throw new Error('HELIUS_API_KEY missing from .env');
const HELIUS = `https://mainnet.helius-rpc.com/?api-key=${key}`;
const alchemyRpc = /^ALCHEMY_RPC_URL=(.+)$/m.exec(env)?.[1]?.trim();
/** Helius, unless it refuses right now (quota or outage): then Alchemy. */
async function pickRpc(): Promise<string> {
  try {
    const r = await fetch(HELIUS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['11111111111111111111111111111111'] }) });
    if (r.ok) return HELIUS;
  } catch { /* fall through */ }
  if (!alchemyRpc) return HELIUS;
  console.log('(Helius is refusing requests: using Alchemy)');
  return alchemyRpc;
}
const RPC = await pickRpc();
async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const j = (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()) as { result: T };
  return j.result;
}
/** Seconds per slot, measured over the last ~20,000 finalized slots (mainnet slots have run near 0.21 s, not 0.4). */
async function slotSeconds(): Promise<{ slot: number; perSlot: number }> {
  const slot = await rpcCall<number>('getSlot', [{ commitment: 'finalized' }]);
  const [t1, t0] = [await rpcCall<number>('getBlockTime', [slot]), await rpcCall<number>('getBlockTime', [slot - 20_000])];
  return { slot, perSlot: (t1 - t0) / 20_000 };
}
// More routes for sending only (each provider limits sending on its own): Alchemy (measured: 20+ per
// second accepted) and the second Helius key. Solana's public endpoint refuses bulk sending.
const key2 = /^HELIUS_BROWSER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
const alchemy = /^ALCHEMY_RPC_URL=(.+)$/m.exec(env)?.[1]?.trim();
const SEND_VIA = [...(alchemy ? [alchemy] : []), ...(key2 ? [`https://mainnet.helius-rpc.com/?api-key=${key2}`] : [])];
const mask = (s: string) => [[alchemy, '<alchemy>'], [key2, '<key2>'], [key, '<key>']].reduce((t, [v, r]) => (v ? t.split(v).join(r!) : t), s);
const KEYS = 'C:/Users/Admin/neurals-keys';
const WSL_KEYS = '/mnt/c/Users/Admin/neurals-keys';
const config = JSON.parse(readFileSync('deploy/indexer.mainnet.json', 'utf8')) as { multisig: string; programId: string };
const SETTLER = 'GfYPjZwq5eqraSCvQHgAaQmoUdqmuZVEEboNH9HauPPz';
const MODEL = 'models/qwen2.5-1.5b-instruct-q4_k_m.gguf';
const RUNTIME = ['site/public/wasm/neurals-wasm.wasm', 'site/public/wasm/neurals-wasm.js'];

/** Runs the Railway CLI (masked output); returns its stdout. */
function railway(args: string[], input?: string): { code: number; out: string } {
  const r = spawnSync('npx', ['-y', '@railway/cli@latest', ...args], { input, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 16 << 20 });
  const err = (r.stderr ?? '').split('\n').filter((l) => !/Config as Code|Migrate:|Existing files keep/.test(l)).join('\n').trim();
  if (err) process.stderr.write(mask(err) + '\n');
  return { code: r.status ?? 1, out: r.stdout ?? '' };
}
const SITE = 'neurals-mainnet';
const BRAIN = 'brain-mainnet';
/** The services that exist in the linked Railway project. */
function services(): string[] {
  const r = railway(['status', '--json']);
  const j = JSON.parse(r.out) as { environments: { edges: { node: { serviceInstances: { edges: { node: { serviceName: string } }[] } } }[] } };
  return j.environments.edges[0].node.serviceInstances.edges.map((e) => e.node.serviceName);
}
/** The service's Railway domain, generating one if it has none. */
function domainOf(service: string): string {
  const list = railway(['domain', 'list', '--service', service, '--json']);
  const found = /([a-z0-9-]+\.up\.railway\.app)/.exec(list.out);
  if (found) return found[1];
  const made = railway(['domain', '--service', service, '--json']);
  const m = /([a-z0-9-]+\.up\.railway\.app)/.exec(made.out);
  if (!m) throw new Error(`could not get a domain for ${service}: ${mask(made.out)}`);
  return m[1];
}
function setVar(service: string, name: string, value: string, secret: boolean) {
  const r = secret
    ? railway(['variable', 'set', name, '--stdin', '--service', service, '--skip-deploys'], value)
    : railway(['variable', 'set', `${name}=${value}`, '--service', service, '--skip-deploys']);
  console.log(`  ${service}: ${name} ${r.code === 0 ? 'set' : 'FAILED'}${secret ? ' (secret, not shown)' : ` = ${value}`}`);
  if (r.code !== 0) process.exit(1);
}

/** Runs a command with its output shown as it comes (masked), for long watchers. */
function runLive(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => process.stdout.write(mask(d.toString())));
    child.stderr.on('data', (d: Buffer) => process.stderr.write(mask(d.toString())));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Runs a command, streaming its output with the key masked. */
function run(bin: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): number {
  const r = spawnSync(bin, args, { input: opts.input, env: { ...process.env, ...opts.env }, encoding: 'utf8', maxBuffer: 64 << 20 });
  process.stdout.write(mask(r.stdout ?? ''));
  process.stderr.write(mask(r.stderr ?? ''));
  return r.status ?? 1;
}
const need = () => { if (!yes) { console.log('add --yes to run this step (it spends real SOL)'); process.exit(2); } };

switch (cmd) {
  case 'deploy': {
    need();
    const code = run('wsl', ['-e', 'bash', '/mnt/c/git/neurals/scripts/deploy-mainnet.sh'], {
      input: 'DEPLOY\n',
      env: {
        CONFIRM_MAINNET: 'yes', RPC, DEPLOYER: `${WSL_KEYS}/mainnet/deployer.json`, PROGRAM_KEY: `${WSL_KEYS}/program-devnet.json`,
        WSLENV: 'CONFIRM_MAINNET/u:RPC/u:DEPLOYER/u:PROGRAM_KEY/u', MSYS_NO_PATHCONV: '1',
      },
    });
    process.exit(code);
  }
  case 'init': {
    need();
    process.exit(run('node', ['tools/admin.ts', 'init', '--rpc', RPC, '--key', `${KEYS}/mainnet/deployer.json`,
      '--treasury', config.multisig, '--settler', SETTLER, '--fee-bps', '150', '--program', config.programId, '--yes']));
  }
  case 'upload': {
    need();
    mkdirSync('out/inscribe', { recursive: true });
    if (existsSync(PIDFILE) && alive(Number(readFileSync(PIDFILE, 'utf8')))) { console.log(`an upload is already running (process ${readFileSync(PIDFILE, 'utf8')}): node tools/mainnet.ts stop first`); process.exit(1); }
    // Helius counts every request (sends and status checks): keep the send rate under the plan's limit.
    const rps = argOf('--rps') ?? '20';
    const log = 'out/inscribe/mainnet.log';
    const out = openSync(log, 'a');
    // Detached, so it keeps running after this command returns. Interrupting is safe: rerun to resume.
    const child = spawn('node', ['tools/inscribe.ts', '--rpc', RPC, '--key', `${KEYS}/mainnet/writer.json`, '--model', MODEL,
      ...RUNTIME.flatMap((r) => ['--runtime', r]), '--rps', rps, '--micro-lamports', '5000', ...SEND_VIA.flatMap((u) => ['--send-rpc', u])],
    { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    writeFileSync(PIDFILE, String(child.pid));
    console.log(`brain upload started (process ${child.pid}); progress: node tools/mainnet.ts status, or the log ${log}`);
    break;
  }
  case 'rules': {
    need();
    const path = 'deploy/rules.mainnet.json';
    // --replace: only before the token exists (a later commit memo supersedes the earlier one; the
    // rules then go on chain again with the next verify, which gives the brain a new address).
    if (existsSync(path) && !process.argv.includes('--replace')) { console.log(`${path} exists already: its memo may be posted. Before the token exists, --replace writes and posts a new one`); process.exit(1); }
    const days = Number(argOf('--days') ?? 7);
    const { slot, perSlot } = await slotSeconds();
    const rules = JSON.parse(readFileSync('rules/neurals-v1.draft.json', 'utf8'));
    // The fallback if the curve never bonds, from the slot speed measured now.
    rules.seed = { delaySlots: 150, deadlineSlot: slot + Math.ceil((days * 86_400) / perSlot) };
    writeFileSync(path, JSON.stringify(rules, null, 2) + '\n');
    console.log(`wrote ${path}: deadline slot ${rules.seed.deadlineSlot} (slots now ${perSlot.toFixed(3)} s: about ${days} days, ${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16)} UTC)`);
    process.exit(run('node', ['tools/commit.ts', path, '--post', '--key', `${KEYS}/mainnet/deployer.json`, '--rpc', RPC]));
  }
  case 'readback': {
    if (existsSync(PIDFILE) && alive(Number(readFileSync(PIDFILE, 'utf8')))) { console.log('another upload or check is running: node tools/mainnet.ts stop first'); process.exit(1); }
    const WRITER = '3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH';
    const log = 'out/inscribe/readback.log';
    const out = openSync(log, 'a');
    const child = spawn('node', ['tools/readback.ts', '--rpc', RPC, '--writer', WRITER, '--rps', argOf('--rps') ?? '40',
      'out/inscribe/manifest-5eykt4Us.json', 'deploy/rules.mainnet.json', ...RUNTIME, MODEL], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    writeFileSync(PIDFILE, String(child.pid));
    console.log(`read-back started (process ${child.pid}); progress in ${log}. Stop it any time with: node tools/mainnet.ts stop (it resumes)`);
    break;
  }
  case 'verify': {
    if (existsSync(PIDFILE) && alive(Number(readFileSync(PIDFILE, 'utf8')))) { console.log('the upload is still running: wait for it to finish'); process.exit(1); }
    if (!existsSync('deploy/rules.mainnet.json')) { console.log('write and post the rules first (node tools/mainnet.ts rules --yes)'); process.exit(1); }
    const log = 'out/inscribe/verify.log';
    const out = openSync(log, 'a');
    // The same files as the upload, plus the rules: only what is missing is sent; then the manifest, then the read-back.
    const child = spawn('node', ['tools/inscribe.ts', '--rpc', RPC, '--key', `${KEYS}/mainnet/writer.json`, '--model', MODEL,
      ...RUNTIME.flatMap((r) => ['--runtime', r]), '--rules', 'deploy/rules.mainnet.json', '--rps', '20', '--micro-lamports', '5000',
      ...SEND_VIA.flatMap((u) => ['--send-rpc', u])], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    writeFileSync(PIDFILE, String(child.pid));
    console.log(`final pass started (process ${child.pid}); log ${log}. It prints the brain's address when done; then node tools/mainnet.ts readback checks it on chain (files already checked are skipped).`);
    break;
  }
  case 'preflight': {
    const extra = [...(argOf('--stage') ? ['--stage', argOf('--stage')!] : []), ...(argOf('--brain') ? ['--brain', argOf('--brain')!] : [])];
    process.exit(run('node', ['tools/preflight.ts', 'deploy/indexer.mainnet.json', '--rpc', RPC, '--so', 'out/mainnet/neurals.so', '--brain-config', 'deploy/brain.mainnet.json', ...extra]));
  }
  case 'launch': {
    need();
    const creator = argOf('--creator');
    if (!creator) { console.log('--creator <the wallet that will create the token on pump.fun>'); process.exit(2); }
    console.log('watching for the token: create it on pump.fun from that wallet now');
    process.exit(await runLive('node', ['tools/launch.ts', '--rpc', RPC, '--creator', creator, '--admin-key', `${KEYS}/mainnet/deployer.json`,
      '--config', 'deploy/indexer.mainnet.json', '--curve', 'pump', '--program', config.programId]));
  }
  case 'offer': {
    need();
    process.exit(run('node', ['tools/admin.ts', 'offer', '--rpc', RPC, '--key', `${KEYS}/mainnet/deployer.json`, '--to', config.multisig, '--program', config.programId, '--yes']));
  }
  case 'print-accept': {
    process.exit(run('node', ['tools/admin.ts', 'print', 'accept', '--admin', config.multisig, '--program', config.programId]));
  }
  case 'upgrade-authority': {
    need();
    process.exit(run('wsl', ['-e', 'bash', '-lc', `export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"; solana program set-upgrade-authority -u "$RPC" ${config.programId} --new-upgrade-authority ${config.multisig} --skip-new-upgrade-authority-signer-check -k ${WSL_KEYS}/mainnet/deployer.json`],
      { env: { RPC, WSLENV: 'RPC/u', MSYS_NO_PATHCONV: '1' } }));
  }
  case 'railway-setup': {
    need();
    const have = services();
    for (const name of [SITE, BRAIN]) {
      if (have.includes(name)) { console.log(`${name}: exists`); continue; }
      const r = railway(['add', '--service', name, '--json']);
      if (r.code !== 0) process.exit(1);
      const v = railway(['volume', '--service', name, 'add', '--mount-path', '/data', '--json']);
      console.log(`${name}: created, volume on /data ${v.code === 0 ? 'added' : 'FAILED'}`);
    }
    const site = domainOf(SITE);
    const brainHost = domainOf(BRAIN);
    console.log(`domains: https://${site} (site and indexer), https://${brainHost} (brain)`);
    const key2 = /^HELIUS_BROWSER_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
    if (!key2) throw new Error('HELIUS_BROWSER_API_KEY missing from .env');
    setVar(SITE, 'INDEXER_CONFIG', 'deploy/indexer.mainnet.json', false);
    setVar(SITE, 'BRAIN_URL', `https://${brainHost}`, false);
    setVar(SITE, 'RPC_URL', RPC, true);
    setVar(SITE, 'PUBLIC_RPC_URL', `https://mainnet.helius-rpc.com/?api-key=${key2}`, true);
    setVar(SITE, 'SETTLER_KEY', readFileSync(`${KEYS}/mainnet/settler.json`, 'utf8').trim(), true);
    setVar(BRAIN, 'BRAIN_CONFIG', 'deploy/brain.mainnet.json', false);
    setVar(BRAIN, 'INDEXER_URL', `https://${site}/api`, false);
    setVar(BRAIN, 'RPC_URL', RPC, true);
    setVar(BRAIN, 'PAYER_KEY', readFileSync(`${KEYS}/mainnet/brain.json`, 'utf8').trim(), true);
    console.log('deploying the brain (it fetches and checks the 1.1 GB model on first start)');
    if (run('bash', ['scripts/stage-brain.sh']) !== 0) process.exit(1);
    const up = railway(['up', 'out/brain-deploy', '--path-as-root', '--service', BRAIN, '--detach']);
    console.log(up.code === 0 ? `brain deploying: https://${brainHost}/health answers once it is up` : 'brain deploy FAILED');
    console.log(`the site and indexer deploy after the launch: node tools/mainnet.ts railway-deploy --yes`);
    break;
  }
  case 'railway-volumes': {
    // The CLI wants ids, not names, for volumes (with a name it crashes): look them up.
    const j = JSON.parse(railway(['status', '--json']).out) as { environments: { edges: { node: { id: string; serviceInstances: { edges: { node: { serviceName: string; serviceId: string } }[] } } }[] } };
    const envNode = j.environments.edges[0].node;
    for (const name of [SITE, BRAIN]) {
      const id = envNode.serviceInstances.edges.find((e) => e.node.serviceName === name)?.node.serviceId;
      if (!id) { console.log(`${name}: no such service`); continue; }
      const v = railway(['volume', '--service', id, '--environment', envNode.id, 'add', '--mount-path', '/data', '--json']);
      console.log(`${name}: volume on /data ${v.code === 0 ? 'added' : 'FAILED'}`);
    }
    break;
  }
  case 'railway-fallback': {
    // Alchemy behind Helius on both mainnet services: if Helius refuses (quota, rate limit), they carry on.
    need();
    const alchemyUrl = /^ALCHEMY_RPC_URL=(.+)$/m.exec(env)?.[1]?.trim();
    if (!alchemyUrl) throw new Error('ALCHEMY_RPC_URL missing from .env');
    setVar(SITE, 'RPC_FALLBACK_URLS', alchemyUrl, true);
    setVar(BRAIN, 'RPC_FALLBACK_URLS', alchemyUrl, true);
    console.log('redeploying the brain with the failover');
    if (run('bash', ['scripts/stage-brain.sh']) !== 0) process.exit(1);
    const up = railway(['up', 'out/brain-deploy', '--path-as-root', '--service', BRAIN, '--detach']);
    console.log(up.code === 0 ? 'brain redeploying; the site and indexer pick it up at railway-deploy' : 'brain deploy FAILED');
    break;
  }
  case 'railway-deploy': {
    need();
    const c = JSON.parse(readFileSync('deploy/indexer.mainnet.json', 'utf8')) as { mint?: string };
    if (!c.mint) { console.log('no mint in deploy/indexer.mainnet.json yet: run the launch first'); process.exit(1); }
    const up = railway(['up', '--service', SITE, '--detach']);
    console.log(up.code === 0 ? `site and indexer deploying: https://${domainOf(SITE)}` : 'deploy FAILED');
    break;
  }
  case 'stop': {
    const pid = Number(argOf('--pid') ?? (existsSync(PIDFILE) ? readFileSync(PIDFILE, 'utf8') : NaN));
    if (!pid || !alive(pid)) { console.log('no upload running'); rmSync(PIDFILE, { force: true }); break; }
    process.kill(pid);
    rmSync(PIDFILE, { force: true });
    console.log(`stopped the upload (process ${pid}); its progress is saved: upload again to resume`);
    break;
  }
  case 'slots': {
    const { slot, perSlot } = await slotSeconds();
    const r = existsSync('deploy/rules.mainnet.json') ? JSON.parse(readFileSync('deploy/rules.mainnet.json', 'utf8')) as { seed: { deadlineSlot: number } } : null;
    console.log(`slot ${slot}, ${perSlot.toFixed(4)} s per slot; 9,000 slots = ${((9000 * perSlot) / 60).toFixed(1)} minutes`);
    if (r) {
      const left = (r.seed.deadlineSlot - slot) * perSlot;
      console.log(left > 0 ? `rules deadline in ${(left / 86_400).toFixed(1)} days (${new Date(Date.now() + left * 1000).toISOString().slice(0, 16)} UTC)` : `rules deadline PASSED ${(-left / 86_400).toFixed(1)} days ago: run rules --replace --yes, then verify`);
    }
    break;
  }
  case 'status': {
    for (const [name, addr] of [['deployer', '3XKMThFUJT5kvNK7FMVoWFZcBW6xPrVPQqG6RTpaVj9e'], ['writer', '3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH'], ['settler', SETTLER], ['brain', '6aWy1UL2uuF8G7pTCqC6JhHtLoBuhccQGavjjoVmdmGH']]) {
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] }) });
      const v = ((await res.json()) as { result: { value: number } }).result.value;
      console.log(`${name.padEnd(9)} ${addr}  ${(v / 1e9).toFixed(4)} SOL`);
    }
    run('node', ['tools/admin.ts', 'show', '--rpc', RPC, '--program', config.programId]);
    const log = 'out/inscribe/mainnet.log';
    if (existsSync(log)) console.log(`upload: ${readFileSync(log, 'utf8').trim().split('\n').slice(-1)[0]}`);
    break;
  }
  default:
    console.log('usage: node tools/mainnet.ts deploy|init|upload --yes, or status');
}
