// Checks that the hosted services are alive and healthy; exits 1 with every problem listed.
// Run on a schedule (.github/workflows/monitor.yml), so a failure emails the repository owner.
//
//   node tools/monitor.ts --site <https://site> [--brain <https://brain>] [--rpc <url>]
//        [--max-lag 300] [--min-brain-sol 0.05]
//
// No dependencies: it runs anywhere Node 22+ runs.

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const site = opt('--site');
if (!site) {
  console.error('usage: node tools/monitor.ts --site <url> [--brain <url>] [--rpc <url>] [--max-lag 300] [--min-brain-sol 0.05]');
  process.exit(2);
}
const maxLag = Number(opt('--max-lag', '300'));
const minBrainSol = Number(opt('--min-brain-sol', '0.05'));
const problems: string[] = [];
const ok: string[] = [];

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

type Health = { synced: number; finalized: number; epoch: number; settler: { alerts: string[]; lastError: string | null; paused?: boolean } | null };
type Config = { rpcUrl: string; brainUrl?: string };

let config: Config | null = null;
try {
  config = await get<Config>(`${site}/api/config`);
  const h = await get<Health>(`${site}/api/health`);
  const chainRpc = opt('--rpc', config.rpcUrl)!;
  const finalized = await rpc<number>(chainRpc, 'getSlot', [{ commitment: 'finalized' }]);
  const lag = finalized - h.synced;
  if (lag > maxLag) problems.push(`indexer is ${lag} slots behind the chain (synced ${h.synced}, chain ${finalized}): it may be stuck`);
  else ok.push(`indexer synced (${lag} slots behind), epoch ${h.epoch}`);
  if (!h.settler) problems.push('the indexer is not settling (no settler key?)');
  else {
    for (const a of h.settler.alerts) problems.push(a);
    if (h.settler.lastError) problems.push(`settler failing: ${h.settler.lastError}`);
    if (h.settler.paused) ok.push('settler: PAUSED on purpose (SETTLER_PAUSED), nothing is being paid out');
    else if (!h.settler.alerts.length && !h.settler.lastError) ok.push('settler: no alerts');
  }
} catch (e) {
  problems.push(`site/indexer ${site} not answering: ${(e as Error).message}`);
}

const brainUrl = opt('--brain', config?.brainUrl);
if (brainUrl) {
  try {
    const b = await get<{ payer: string; served: number }>(`${brainUrl}/health`);
    ok.push(`brain answering (${b.served} receipts since its last start)`);
    if (config) {
      const lamports = (await rpc<{ value: number }>(opt('--rpc', config.rpcUrl)!, 'getBalance', [b.payer, { commitment: 'confirmed' }])).value;
      if (lamports / 1e9 < minBrainSol) problems.push(`the brain's wallet has ${lamports / 1e9} SOL, under ${minBrainSol}: it cannot pay network fees for long`);
      else ok.push(`brain wallet ${(lamports / 1e9).toFixed(3)} SOL`);
    }
  } catch (e) {
    problems.push(`brain ${brainUrl} not answering: ${(e as Error).message}`);
  }
}

for (const m of ok) console.log(`ok   ${m}`);
for (const p of problems) console.log(`FAIL ${p}`);
process.exit(problems.length ? 1 : 0);
