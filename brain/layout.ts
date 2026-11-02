// Slots and parts (SPEC §3).
//
// A *slot* is a range of curve positions, in buying order. A *part* is a real piece of the model.
// Slot i and part i follow the same pattern (Embedding, then per layer 12 heads and 35 columns,
// then Unembedding); the reveal's permutation decides which part of a kind fills which slot of
// that kind. Before the reveal, a slot's kind is known but its part is not.

import { createHash } from 'node:crypto';
import {
  COLUMNS_PER_LAYER, CURVE_SUPPLY, MODEL, SEGMENT_COUNT, TOKENS, TOKENS_PER_BAND, UNIT, type Kind,
} from './model.ts';

export type Slot = {
  index: number; // 0 .. 1317
  kind: Kind;
  /** Base-unit positions [start, end). */
  start: number;
  end: number;
};

export type Part = {
  index: number; // 0 .. 1317, model order
  kind: Kind;
  layer: number | null; // null for the Embedding and Unembedding
  /** Head number within the layer (0..11), or column number within the layer (0..34). */
  within: number | null;
};

const BAND_START = TOKENS.embedding * UNIT;
const BAND = TOKENS_PER_BAND * UNIT;
const HEADS_IN_BAND = MODEL.heads * TOKENS.head * UNIT;
export const SUPPLY = CURVE_SUPPLY * UNIT;

/** The kind and in-layer index of the n-th segment, in the shared slot/part pattern. */
function shape(i: number): { kind: Kind; layer: number | null; within: number | null } {
  if (!Number.isInteger(i) || i < 0 || i >= SEGMENT_COUNT) throw new RangeError(`no segment ${i}`);
  if (i === 0) return { kind: 'embedding', layer: null, within: null };
  if (i === SEGMENT_COUNT - 1) return { kind: 'unembedding', layer: null, within: null };
  const perLayer = MODEL.heads + COLUMNS_PER_LAYER;
  const layer = Math.floor((i - 1) / perLayer);
  const k = (i - 1) % perLayer;
  return k < MODEL.heads
    ? { kind: 'head', layer, within: k }
    : { kind: 'column', layer, within: k - MODEL.heads };
}

export function part(i: number): Part {
  return { index: i, ...shape(i) };
}

export function slot(i: number): Slot {
  const { kind, layer, within } = shape(i);
  if (kind === 'embedding') return { index: i, kind, start: 0, end: BAND_START };
  if (kind === 'unembedding') return { index: i, kind, start: SUPPLY - TOKENS.unembedding * UNIT, end: SUPPLY };
  const band = BAND_START + layer! * BAND;
  const start = kind === 'head'
    ? band + within! * TOKENS.head * UNIT
    : band + HEADS_IN_BAND + within! * TOKENS.column * UNIT;
  return { index: i, kind, start, end: start + (kind === 'head' ? TOKENS.head : TOKENS.column) * UNIT };
}

export const SLOTS: readonly Slot[] = Array.from({ length: SEGMENT_COUNT }, (_, i) => slot(i));
export const PARTS: readonly Part[] = Array.from({ length: SEGMENT_COUNT }, (_, i) => part(i));

/** The slot holding a base-unit position. */
export function slotAt(position: number): Slot {
  if (!Number.isSafeInteger(position) || position < 0 || position >= SUPPLY) {
    throw new RangeError(`position ${position} is outside the curve`);
  }
  let lo = 0;
  let hi = SLOTS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SLOTS[mid].start <= position) lo = mid;
    else hi = mid - 1;
  }
  return SLOTS[lo];
}

/** How much of each slot a base-unit range [start, end) covers. */
export function slotsIn(start: number, end: number): { slot: Slot; amount: number }[] {
  if (end <= start) return [];
  const out: { slot: Slot; amount: number }[] = [];
  for (let s = slotAt(start); ; s = SLOTS[s.index + 1]) {
    out.push({ slot: s, amount: Math.min(end, s.end) - Math.max(start, s.start) });
    if (end <= s.end || s.index === SLOTS.length - 1) break;
  }
  return out;
}

/**
 * The reveal's permutation: which part fills each slot. The Embedding and Unembedding stay put;
 * heads are shuffled among head slots and columns among column slots (Fisher–Yates, randomness
 * from SHA-256 of the seed and a counter, rejection sampling so every order is equally likely).
 * Returns partOfSlot[slotIndex] = partIndex.
 */
export function permutation(seed: Uint8Array): number[] {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const partOfSlot = Array.from({ length: SEGMENT_COUNT }, (_, i) => i);
  let counter = 0;
  let pool: number[] = [];
  const next32 = (): number => {
    if (pool.length === 0) {
      const h = createHash('sha256').update('neurals:v1:permutation').update(seed);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter++);
      const d = h.update(c).digest();
      for (let o = 0; o < 32; o += 4) pool.push(d.readUInt32BE(o));
    }
    return pool.shift()!;
  };
  const below = (n: number): number => {
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const x = next32();
      if (x < limit) return x % n;
    }
  };
  for (const kind of ['head', 'column'] as const) {
    const idx = SLOTS.filter((s) => s.kind === kind).map((s) => s.index);
    const parts = idx.slice();
    for (let i = parts.length - 1; i > 0; i--) {
      const j = below(i + 1);
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    idx.forEach((s, k) => (partOfSlot[s] = parts[k]));
  }
  return partOfSlot;
}
