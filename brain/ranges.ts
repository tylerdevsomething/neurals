// Sets of curve positions, kept as sorted, disjoint, non-touching [start, end) ranges.
// Positions are base units on the curve (at most 7.931e14, well inside safe integers).

import { slotsIn } from './layout.ts';

export type Range = readonly [start: number, end: number];
export type Ranges = readonly Range[];

/** Sorts, drops empty ranges and merges overlapping or touching ones. */
export function normalize(rs: Iterable<Range>): Range[] {
  const sorted = [...rs].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e) || s < 0) throw new RangeError(`bad range [${s}, ${e})`);
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function total(a: Ranges): number {
  let t = 0;
  for (const [s, e] of a) t += e - s;
  return t;
}

export function union(a: Ranges, b: Ranges): Range[] {
  return normalize([...a, ...b]);
}

export function intersect(a: Ranges, b: Ranges): Range[] {
  const out: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

export function subtract(a: Ranges, b: Ranges): Range[] {
  const out: Range[] = [];
  let j = 0;
  for (const [s0, e] of a) {
    let s = s0;
    while (j < b.length && b[j][1] <= s) j++;
    for (let k = j; k < b.length && b[k][0] < e; k++) {
      if (b[k][0] > s) out.push([s, b[k][0]]);
      s = Math.max(s, b[k][1]);
    }
    if (s < e) out.push([s, e]);
  }
  return out;
}

export function equal(a: Ranges, b: Ranges): boolean {
  return a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
}

/**
 * The first `amount` positions of `a` in priority order: positions in slots with more points
 * first, then lower positions first. Used to decide which of a wallet's neurons stay awake.
 */
export function takeRarest(a: Ranges, amount: number, pointsOfSlot: (slot: number) => number): Range[] {
  if (amount <= 0) return [];
  if (amount >= total(a)) return a.slice();
  const pieces: { slot: number; points: number; start: number; end: number }[] = [];
  for (const [s, e] of a) {
    for (const { slot } of slotsIn(s, e)) {
      pieces.push({ slot: slot.index, points: pointsOfSlot(slot.index), start: Math.max(s, slot.start), end: Math.min(e, slot.end) });
    }
  }
  pieces.sort((x, y) => y.points - x.points || x.start - y.start);
  const out: Range[] = [];
  let left = amount;
  for (const p of pieces) {
    const n = Math.min(left, p.end - p.start);
    out.push([p.start, p.start + n]);
    left -= n;
    if (left === 0) break;
  }
  return normalize(out);
}
