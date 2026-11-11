// The indexer's read API, plus receipt submission for the brain.
//
//   GET  /config                 what the site needs: program, mint, RPC, epochs, brain URL
//   GET  /health                 synced and finalized slots, epoch, ledger fingerprint
//   GET  /brain                  every slot: kind, range, how much is issued, part and trait after the reveal
//   GET  /slot/:i                one slot and who holds it
//   GET  /wallet/:address        balance, positions, awake neurons, checkpoints held, payouts with proofs
//   GET  /checkpoints            open checkpoints: holder and positions
//   GET  /epochs                 settled epochs: fees, payouts, roots
//   GET  /claims/:epoch/:wallet  one payout and its proof
//   POST /receipts               a receipt (JSON) from the brain; answers its hash
//   GET  /receipts/:hash         a stored receipt
//   GET  /reveal                 the reveal in use (rebuildable from the rules and the seed block)
//   GET  /activity               how hard each part fired across the last 50 paid messages

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { SLOTS, PARTS } from '../brain/layout.ts';
import { stageOf } from '../brain/model.ts';
import { total, intersect } from '../brain/ranges.ts';
import { slotsIn } from '../brain/layout.ts';
import type { Receipt } from '../brain/receipt.ts';
import type { Indexer } from './indexer.ts';
import type { Store } from './store.ts';

export type ApiOptions = {
  indexer: Indexer;
  store: Store;
  model: string;
  /** The official brain's key: only receipts it signed are accepted. */
  brainKey?: string;
  traitNames?: Record<number, string>;
  /** Public settings for the site: program, mint, RPC, brain URL. */
  site?: { rpcUrl: string; brainUrl?: string; cluster?: string };
  /** The built website (site/dist), served for every path the API does not answer. */
  staticDir?: string;
  /** No token yet: /health says so and the site shows its waiting state. */
  waiting?: boolean;
  /** The settler's alerts and last error, shown in /health for monitoring. */
  settler?: () => { alerts: string[]; lastError: string | null; paused?: boolean };
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
};

async function body(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('request too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const API_ROUTES = new Set(['config', 'health', 'brain', 'slot', 'wallet', 'checkpoints', 'epochs', 'claims', 'receipts', 'activity', 'reveal']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

/** Serves the built site; unknown paths get index.html (the site routes by hash). */
function serveStatic(dir: string, pathname: string, res: ServerResponse, head = false) {
  const root = normalize(dir);
  let file = normalize(join(root, decodeURIComponent(pathname)));
  if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); return res.end(); }
  // A folder serves its own index.html (the 3D pages at /lab/); anything else unknown gets the site's.
  if (existsSync(file) && statSync(file).isDirectory() && existsSync(join(file, 'index.html'))) file = join(file, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('site not built'); }
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  res.end(head ? undefined : readFileSync(file));
}

export function startApi(o: ApiOptions, port: number): Server {
  const { indexer, store } = o;
  const ledger = indexer.ledger;

  const partInfo = (slot: number) => {
    const p = ledger.partOfSlot(slot);
    if (p === null) return null;
    const part = PARTS[p];
    return { index: p, kind: part.kind, layer: part.layer, within: part.within, stage: part.layer === null ? null : stageOf(part.layer), points: ledger.pointsOfSlot(slot), trait: o.traitNames?.[p] ?? null };
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, null);
      const url = new URL(req.url ?? '/', 'http://x');
      // The API answers at /api/... (same origin as the site) and, for local tools, at the root.
      const path = url.pathname.startsWith('/api/') || url.pathname === '/api' ? url.pathname.slice(4) || '/' : url.pathname;
      const parts = path.split('/').filter(Boolean);
      // A browser opening a page (it asks for HTML) gets the site, even at /wallet/<address> or /slot/<n>,
      // which the site uses as clean addresses; scripts asking for data still reach the API there.
      const page = (req.headers.accept ?? '').includes('text/html');
      if ((req.method === 'GET' || req.method === 'HEAD') && o.staticDir && !url.pathname.startsWith('/api') && (page || !API_ROUTES.has(parts[0] ?? ''))) {
        return serveStatic(o.staticDir, url.pathname, res, req.method === 'HEAD');
      }

      if (req.method === 'POST' && parts[0] === 'receipts') {
        const r = JSON.parse(await body(req)) as Receipt & { signature?: string };
        return json(res, 200, { hash: store.addReceipt(r, o.model, o.brainKey) });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

      switch (parts[0]) {
        case 'config': {
          const c = indexer.config;
          return json(res, 200, { programId: c.programId, mint: c.mint, curveTokenAccount: c.curveTokenAccount, pumpProgramId: c.pumpProgramId, startSlot: c.startSlot, epochSlots: c.epochSlots, model: o.model, ...o.site });
        }
        case 'health':
          return json(res, 200, { synced: indexer.syncedSlot, finalized: indexer.finalizedSlot, epoch: ledger.epoch, issued: ledger.cursor, revealed: ledger.isRevealed, soldOutSlot: indexer.soldOutSlot, seedSlot: indexer.seedSlot(indexer.syncedSlot), fingerprint: ledger.fingerprint(), settler: o.settler?.() ?? null, ...(o.waiting ? { waiting: true } : {}) });
        case 'brain':
          return json(res, 200, {
            revealed: ledger.isRevealed,
            issued: ledger.cursor,
            slots: SLOTS.map((s) => ({ index: s.index, kind: s.kind, start: s.start, end: s.end, issued: Math.max(0, Math.min(s.end, ledger.cursor) - s.start), part: partInfo(s.index) })),
          });
        case 'slot': {
          const i = Number(parts[1]);
          const s = SLOTS[i];
          if (!s) return json(res, 404, { error: 'no such slot' });
          return json(res, 200, { ...s, issued: Math.max(0, Math.min(s.end, ledger.cursor) - s.start), part: partInfo(i), holders: ledger.holdersOf(s.start, s.end) });
        }
        case 'wallet': {
          const w = parts[1] ?? '';
          const positions = ledger.positions(w);
          const awake = ledger.awake(w);
          const bySlot = new Map<number, { amount: number; awake: number }>();
          for (const [a, b] of positions) for (const { slot, amount } of slotsIn(a, b)) {
            const e = bySlot.get(slot.index) ?? { amount: 0, awake: 0 };
            e.amount += amount;
            e.awake += total(intersect(awake, [[Math.max(a, slot.start), Math.min(b, slot.end)]]));
            bySlot.set(slot.index, e);
          }
          const checkpoints = ledger.checkpoints().filter((c) => c.holder === w);
          const payouts = [...indexer.trees.values()].flatMap((t) => {
            const c = t.claims.get(w);
            return c ? [{ epoch: t.epoch, index: c.index, amount: c.amount, proof: c.proof.map((p) => p.toString('hex')) }] : [];
          });
          return json(res, 200, {
            wallet: w,
            balance: ledger.balanceOf(w),
            positions,
            awake,
            slots: [...bySlot].map(([slot, v]) => ({ slot, ...v, part: partInfo(slot) })),
            checkpoints,
            payouts,
          });
        }
        case 'checkpoints':
          return json(res, 200, ledger.checkpoints());
        case 'epochs':
          return json(res, 200, indexer.settlements.map((s) => ({ epoch: s.epoch, fees: s.fees, carried: s.carried, payouts: s.payouts.size, root: indexer.trees.get(s.epoch)?.root.toString('hex') })));
        case 'claims': {
          const t = indexer.trees.get(Number(parts[1]));
          const c = t?.claims.get(parts[2] ?? '');
          if (!t || !c) return json(res, 404, { error: 'no such payout' });
          return json(res, 200, { epoch: t.epoch, wallet: parts[2], index: c.index, amount: c.amount, proof: c.proof.map((p) => p.toString('hex')), root: t.root.toString('hex') });
        }
        case 'activity': {
          const recent = store.recentReceipts(50);
          const sum = new Array<number>(PARTS.length).fill(0);
          for (const r of recent) r.shares.forEach((s, i) => (sum[i] += s));
          return json(res, 200, { messages: recent.length, shares: sum.map((s) => (recent.length ? s / recent.length : 0)) });
        }
        case 'reveal':
          // The reveal in use: anyone can rebuild it from the committed rules and the seed block (tools/reveal.ts).
          return indexer.revealed ? json(res, 200, indexer.revealed) : json(res, 404, { error: 'not revealed yet', soldOutSlot: indexer.soldOutSlot, seedSlot: indexer.seedSlot(indexer.syncedSlot) });
        case 'receipts': {
          const r = store.receipt(parts[1] ?? '');
          return r ? json(res, 200, r) : json(res, 404, { error: 'no such receipt' });
        }
        default:
          return json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  });
  server.listen(port);
  return server;
}

