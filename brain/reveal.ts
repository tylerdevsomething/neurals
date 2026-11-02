// The commit and the reveal (SPEC §6).
//
// Before the token exists, the rules file is fixed and its SHA-256 posted on chain in a memo:
//   neurals:v1:commit:<sha256 of the rules file>:<deadline slot>
// The rules file holds the model hash, the measured traits of every part, the tool and reference
// text that measured them, and the seed rule. After the curve sells out (or at the deadline), the
// hash of the seed block decides which real part fills each slot (layout.permutation). The reveal
// file is posted the same way:
//   neurals:v1:reveal:<sha256 of the reveal file>
// Anyone can rebuild the reveal from the rules file and the seed block, and so can the indexer,
// which refuses a reveal that does not match.

import { createHash } from 'node:crypto';
import { SEGMENT_COUNT } from './model.ts';
import { PARTS, permutation } from './layout.ts';
import { decodeBase58 } from './base58.ts';

export const TRAITS = {
  'Super Weight': { points: 100, kind: 'column' },
  'Induction Head': { points: 85, kind: 'head' },
  'Massive Activation': { points: 70, kind: 'column' },
  'Attention Sink': { points: 50, kind: 'head' },
  Monosemantic: { points: 30, kind: 'column' },
} as const;
export type TraitName = keyof typeof TRAITS;

export type Rules = {
  format: 'neurals:v1:rules';
  /** SHA-256 of the inscribed model file. */
  model: string;
  /** Measured traits: part index -> trait. At most one per part. */
  traits: Record<string, TraitName>;
  /** How the traits were measured: the tool's hash, the reference text's hash, the thresholds. */
  measurement: { tool: string; referenceText: string; thresholds: Record<string, number> };
  /**
   * The seed block: the first block at least `delaySlots` after the slot in which the curve sold
   * out, or `deadlineSlot` if it never sells out.
   */
  seed: { delaySlots: number; deadlineSlot: number };
};

export type Reveal = {
  format: 'neurals:v1:reveal';
  rules: string; // sha256 of the rules file
  seedSlot: number;
  blockhash: string; // base58, as the chain reports it
  partOfSlot: number[];
  pointsOfPart: number[];
};

export const sha256Hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

/** Canonical bytes of a rules or reveal file: what gets hashed and committed. */
export const canonical = (x: Rules | Reveal) => JSON.stringify(x);

export function checkRules(r: Rules): Rules {
  if (r.format !== 'neurals:v1:rules') throw new Error('not a neurals v1 rules file');
  if (!/^[0-9a-f]{64}$/.test(r.model)) throw new Error('bad model hash');
  for (const [k, t] of Object.entries(r.traits)) {
    const p = PARTS[Number(k)];
    if (!p || String(p.index) !== k) throw new Error(`no part ${k}`);
    const def = TRAITS[t];
    if (!def) throw new Error(`unknown trait ${t}`);
    if (def.kind !== p.kind) throw new Error(`${t} belongs on a ${def.kind}, part ${k} is a ${p.kind}`);
  }
  if (!(r.seed.delaySlots >= 0) || !(r.seed.deadlineSlot > 0)) throw new Error('bad seed rule');
  return r;
}

export function pointsOfParts(r: Rules): number[] {
  const out = new Array<number>(SEGMENT_COUNT).fill(0);
  for (const [k, t] of Object.entries(r.traits)) out[Number(k)] = TRAITS[t].points;
  return out;
}

/** The seed slot the rules call for, given the slot the curve sold out in (or null). */
export function seedSlotFor(r: Rules, soldOutSlot: number | null): number {
  return soldOutSlot === null ? r.seed.deadlineSlot : Math.min(soldOutSlot + r.seed.delaySlots, r.seed.deadlineSlot);
}

export function buildReveal(rules: Rules, seedSlot: number, blockhash: string): Reveal {
  checkRules(rules);
  const seed = decodeBase58(blockhash);
  if (seed.length !== 32) throw new Error('a blockhash is 32 bytes');
  return {
    format: 'neurals:v1:reveal',
    rules: sha256Hex(canonical(rules)),
    seedSlot,
    blockhash,
    partOfSlot: permutation(seed),
    pointsOfPart: pointsOfParts(rules),
  };
}

/** Rebuilds the reveal and requires an exact match. */
export function checkReveal(rules: Rules, reveal: Reveal): void {
  const want = buildReveal(rules, reveal.seedSlot, reveal.blockhash);
  if (canonical(want) !== canonical(reveal)) throw new Error('the reveal does not match the rules and the seed block');
}

export const commitMemo = (rules: Rules) => `neurals:v1:commit:${sha256Hex(canonical(rules))}:${rules.seed.deadlineSlot}`;
export const revealMemo = (reveal: Reveal) => `neurals:v1:reveal:${sha256Hex(canonical(reveal))}`;
