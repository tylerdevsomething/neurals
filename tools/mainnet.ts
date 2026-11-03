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
//   node tools/mainnet.ts preflight [--stage before-token|after-token|handed-over] [--brain <url>]
//   node tools/mainnet.ts launch --creator <wallet> --yes   step 7: watch for the token, record its mint (set_mint), write the config
//   node tools/mainnet.ts offer --yes      step 8: offer the admin role to the multisig (it accepts in Squads)
//   node tools/mainnet.ts print-accept     step 8: the instruction to propose in Squads
//   node tools/mainnet.ts upgrade-authority --yes   step 8: move the program's upgrade authority to the multisig

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
const RPC = `https://mainnet.helius-rpc.com/?api-key=${key}`;
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
    if (existsSync(path)) { console.log(`${path} exists already: its memo may be posted; delete it only if it was never posted`); process.exit(1); }
    const slot = ((await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'finalized' }] }) })).json()) as { result: number }).result;
    const rules = JSON.parse(readFileSync('rules/neurals-v1.draft.json', 'utf8'));
    rules.seed = { delaySlots: 150, deadlineSlot: slot + 1_512_000 }; // the fallback if the curve never bonds: ~7 days
    writeFileSync(path, JSON.stringify(rules, null, 2) + '\n');
    console.log(`wrote ${path}: deadline slot ${rules.seed.deadlineSlot} (about 7 days from now)`);
    process.exit(run('node', ['tools/commit.ts', path, '--post', '--key', `${KEYS}/mainnet/deployer.json`, '--rpc', RPC]));
  }
  case 'verify': {
    if (existsSync(PIDFILE) && alive(Number(readFileSync(PIDFILE, 'utf8')))) { console.log('the upload is still running: wait for it to finish'); process.exit(1); }
    if (!existsSync('deploy/rules.mainnet.json')) { console.log('write and post the rules first (node tools/mainnet.ts rules --yes)'); process.exit(1); }
    const log = 'out/inscribe/verify.log';
    const out = openSync(log, 'a');
    // The same files as the upload, plus the rules: only what is missing is sent; then the manifest, then the read-back.
    const child = spawn('node', ['tools/inscribe.ts', '--rpc', RPC, '--key', `${KEYS}/mainnet/writer.json`, '--model', MODEL,
      ...RUNTIME.flatMap((r) => ['--runtime', r]), '--rules', 'deploy/rules.mainnet.json', '--rps', '20', '--micro-lamports', '5000',
      ...SEND_VIA.flatMap((u) => ['--send-rpc', u]), '--verify'], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    writeFileSync(PIDFILE, String(child.pid));
    console.log(`final pass and read-back started (process ${child.pid}); log ${log}. It prints the brain's address when done.`);
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
  case 'stop': {
    const pid = Number(argOf('--pid') ?? (existsSync(PIDFILE) ? readFileSync(PIDFILE, 'utf8') : NaN));
    if (!pid || !alive(pid)) { console.log('no upload running'); rmSync(PIDFILE, { force: true }); break; }
    process.kill(pid);
    rmSync(PIDFILE, { force: true });
    console.log(`stopped the upload (process ${pid}); its progress is saved: upload again to resume`);
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
