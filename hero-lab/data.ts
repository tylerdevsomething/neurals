// Live dev data shaped as a network: one node per real part of the model, in model order.
import { PARTS } from '../brain/layout.ts';
import { STAGES } from '../brain/model.ts';

export const API = 'https://neurals-production.up.railway.app/api';

export type Node = {
  part: number; kind: 'embedding' | 'head' | 'column' | 'unembedding';
  layer: number | null; within: number | null; stage: number; // stage index 0..5
  slot: number | null; sold: number; fire: number; hot: boolean; trait: number; mine: boolean;
};
export type Net = { nodes: Node[]; layers: Node[][]; input: Node; output: Node; messages: number; soldSlots: number; wallet: string | null };

export const STAGE_NAMES = STAGES.map((s) => s.name.replace(' layers', '').toLowerCase());
export const stageOfLayer = (l: number) => STAGES.findIndex((s) => l >= s.from && l <= s.to);

type Slot = { index: number; start: number; end: number; issued: number; part: { index: number; points: number } | null };

// Live data, cached in the browser: a repeat visit draws at once from the last copy while a fresh copy
// is fetched quietly for next time. The first ever visit waits for the network as before.
export function cj<T>(url: string): Promise<T> {
  const key = 'nrl:' + url, hit = localStorage.getItem(key);
  const net = fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((j) => { try { localStorage.setItem(key, JSON.stringify(j)); } catch { /* full */ } return j as T; });
  if (hit) { net.catch(() => null); return Promise.resolve(JSON.parse(hit) as T); }
  return net;
}
export async function load(wallet: string | null): Promise<Net> {
  const [brain, act] = await Promise.all([
    cj<{ slots: Slot[] }>(`${API}/brain`),
    cj<{ messages: number; shares: number[] }>(`${API}/activity`),
  ]);
  if (!wallet) {
    const first = brain.slots.find((s) => s.issued > 0);
    if (first) wallet = (await cj<{ holders?: { holder: string }[] }>(`${API}/slot/${first.index}`)).holders?.[0]?.holder ?? null;
  }
  const mine = new Set<number>();
  if (wallet) {
    try { (await cj<{ slots?: { slot: number }[] }>(`${API}/wallet/${wallet}`)).slots?.forEach((s: { slot: number }) => mine.add(s.slot)); } catch { /* not a holder */ }
  }
  const slotOfPart = new Map<number, Slot>();
  for (const s of brain.slots) if (s.part) slotOfPart.set(s.part.index, s);
  // Firing: each part's share against the average for its kind, as on the live site.
  const tot: Record<string, number> = {}, cnt: Record<string, number> = {};
  PARTS.forEach((p, i) => { tot[p.kind] = (tot[p.kind] ?? 0) + (act.shares[i] ?? 0); cnt[p.kind] = (cnt[p.kind] ?? 0) + 1; });
  const nodes: Node[] = PARTS.map((p, i) => {
    const s = slotOfPart.get(i);
    const ratio = act.messages ? (act.shares[i] ?? 0) / (tot[p.kind] / cnt[p.kind] || 1) : 0;
    return {
      part: i, kind: p.kind, layer: p.layer, within: p.within,
      stage: p.layer === null ? (p.kind === 'embedding' ? 0 : 5) : stageOfLayer(p.layer),
      slot: s?.index ?? null, sold: s ? s.issued / (s.end - s.start) : 0,
      fire: ratio > 0 ? Math.max(0, Math.min(1, (Math.log2(ratio) + 2) / 4)) : 0,
      hot: ratio >= 2.2, trait: s?.part?.points ?? 0, mine: !!s && mine.has(s.index),
    };
  });
  const layers = Array.from({ length: 28 }, (_, l) => nodes.filter((n) => n.layer === l));
  return { nodes, layers, input: nodes[0], output: nodes[nodes.length - 1], messages: act.messages, soldSlots: brain.slots.filter((s) => s.issued > 0).length, wallet };
}

/** A small seeded random, so every drawing is the same on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Sparse, fixed wiring between neighbouring layers: each node feeds k nodes of the next layer. */
export function wires(net: Net, k: number, seed = 7): [Node, Node][] {
  const r = rng(seed), out: [Node, Node][] = [];
  for (let l = 0; l < 27; l++) {
    const next = net.layers[l + 1];
    for (const n of net.layers[l]) for (let j = 0; j < k; j++) out.push([n, next[Math.floor(r() * next.length)]]);
  }
  return out;
}

export function describe(n: Node): string[] {
  const where = n.layer === null ? (n.kind === 'embedding' ? 'the embedding, where text enters' : 'the unembedding, where words come out') : `layer ${n.layer} ${n.kind === 'head' ? 'attention head' : 'neuron column'} ${n.within}`;
  return [
    where,
    `${STAGE_NAMES[n.stage]} layers${n.slot !== null ? `, slot ${n.slot}` : ''}`,
    n.sold === 0 ? 'on the curve, not bought yet' : n.sold >= 1 ? 'fully bought' : `${Math.round(n.sold * 100)}% bought`,
    n.hot ? 'firing hard in recent messages' : n.fire > 0 ? 'firing' : 'quiet',
    ...(n.mine ? ['yours'] : []),
  ];
}
