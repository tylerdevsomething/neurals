// Checks the decoder against REAL pump.fun transactions on mainnet (read-only).
//
//   node tools/pump-check.ts [count=150] [rpcUrl]
//
// For every token transfer directly under a pump.fun instruction, it derives that token's real
// bonding-curve token account (the associated token account of the PDA ["bonding-curve", mint]),
// which is what the indexer is configured with in production, and runs the decoder:
// - a transfer out of the curve must decode as a curve buy exactly when pump.fun's log names a buy
//   (or a multi-hop swap that buys off the curve);
// - a transfer into the curve under a sell must decode as a sell-back;
// - no other transfer may decode as either.
// Requests are sequential and paced, so a public RPC is fine.

import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Decoder, executionOrder } from '../brain/decoder.ts';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const NON_BUY = ['migrate', 'migrate_v2', 'migrate_v3', 'withdraw', 'withdraw_v2'];
const COUNT = Number(process.argv[2] ?? 150);
const RPC = process.argv[3] ?? 'https://api.mainnet-beta.solana.com';
const UNUSED = '11111111111111111111111111111111';

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (res.status === 429 && attempt < 8) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const body = (await res.json()) as any;
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
}

const curveCache = new Map<string, string>();
function curveTokenAccount(mint: string, tokenProgramId: string): string {
  const key = `${mint}:${tokenProgramId}`;
  let v = curveCache.get(key);
  if (!v) {
    const m = new PublicKey(mint);
    const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), m.toBuffer()], PUMP)[0];
    const program = tokenProgramId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    v = getAssociatedTokenAddressSync(m, bondingCurve, true, program).toBase58();
    curveCache.set(key, v);
  }
  return v;
}

/** pump.fun instruction names, in invocation order, from the transaction's logs. */
function pumpNamesFromLogs(logs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].startsWith(`Program ${PUMP.toBase58()} invoke`)) out.push(/Instruction: (\w+)/.exec(logs[i + 1] ?? '')?.[1] ?? '(event)');
  }
  return out;
}

const sigs = await rpc<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [PUMP.toBase58(), { limit: COUNT }]);
const byIx = new Map<string, number>();
const byTokenProgram = new Map<string, number>();
let txs = 0, buys = 0, sells = 0, routed = 0, correct = 0;
const problems: string[] = [];

for (const s of sigs.filter((x) => x.err === null)) {
  await new Promise((r) => setTimeout(r, 200));
  const tx = await rpc<any>('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  if (!tx || tx.meta.err) continue;
  txs++;
  const order = executionOrder(tx);
  const names = pumpNamesFromLogs(tx.meta.logMessages ?? []);
  const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => k.pubkey);
  const balances = [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])];
  const balanceOf = (acct: string) => balances.find((b: any) => keys[b.accountIndex] === acct);
  const tag = `${s.signature.slice(0, 12)}…`;

  order.filter((o) => o.ix.programId === PUMP.toBase58()).forEach((p, i) => {
    const name = names[i] ?? '?';
    const transfers = order.filter((o) => o.parent === p.ix && o.ix.parsed
      && (o.ix.programId === TOKEN_PROGRAM_ID.toBase58() || o.ix.programId === TOKEN_2022_PROGRAM_ID.toBase58())
      && /^transfer(Checked)?$/.test(o.ix.parsed.type));
    for (const c of transfers) {
      const info = c.ix.parsed.info;
      const b = balanceOf(info.source) ?? balanceOf(info.destination);
      const mint: string | undefined = info.mint ?? b?.mint;
      if (!mint) { problems.push(`${tag} ${name}: token transfer with no identifiable mint`); continue; }
      const curve = curveTokenAccount(mint, c.ix.programId);
      const decoder = new Decoder({ mint, curveTokenAccount: curve, pumpProgramId: PUMP.toBase58(), pumpNonBuyInstructions: NON_BUY, programId: UNUSED });
      let actions;
      try {
        actions = decoder.decode(tx)!.actions;
      } catch (e) {
        problems.push(`${tag} ${name}: decoder threw: ${(e as Error).message}`);
        continue;
      }
      const amount = Number(info.amount ?? info.tokenAmount.amount);
      const ownerOf = (acct: string) => balanceOf(acct)?.owner;
      const gotBuy = actions.some((e) => e.type === 'curveBuy' && e.amount === amount && e.wallet === ownerOf(info.destination));
      const gotSell = actions.some((e) => e.type === 'curveSell' && e.amount === amount && e.wallet === ownerOf(info.source));
      const tp = c.ix.programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'Token-2022' : 'SPL Token';

      if (info.source === curve) {
        buys++;
        if (p.parent) routed++;
        byIx.set(name, (byIx.get(name) ?? 0) + 1);
        byTokenProgram.set(tp, (byTokenProgram.get(tp) ?? 0) + 1);
        const isBuy = /^Buy/.test(name) || name === 'MultiHopCurveSwap';
        if (gotBuy === isBuy) correct++;
        else problems.push(`${tag} ${name}: curve outflow decoded as ${gotBuy ? 'a buy' : 'NOT a buy'}`);
      } else if (info.destination === curve) {
        sells++;
        byIx.set(name, (byIx.get(name) ?? 0) + 1);
        const isSell = /^Sell/.test(name) || name === 'MultiHopCurveSwap';
        if (gotSell === isSell) correct++;
        else problems.push(`${tag} ${name}: curve inflow decoded as ${gotSell ? 'a sell-back' : 'NOT a sell-back'}`);
      } else if (gotBuy || gotSell) {
        problems.push(`${tag} ${name}: a transfer not touching the curve decoded as a ${gotBuy ? 'buy' : 'sell-back'}`);
      }
    }
  });
}

console.log(`transactions examined: ${txs}`);
console.log('curve transfers by pump.fun instruction:', Object.fromEntries(byIx));
console.log('token programs (buys):', Object.fromEntries(byTokenProgram));
console.log(`curve outflows: ${buys} (routed via another program: ${routed}); curve inflows: ${sells}; classified correctly: ${correct} of ${buys + sells}`);
console.log(problems.length ? `\nproblems:\n  ${problems.join('\n  ')}` : '\nno problems');
process.exit(problems.length ? 1 : 0);
