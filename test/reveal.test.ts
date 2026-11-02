import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReveal, checkReveal, checkRules, commitMemo, revealMemo, seedSlotFor, pointsOfParts, type Rules } from '../brain/reveal.ts';
import { encodeBase58 } from '../brain/base58.ts';
import { PARTS, SLOTS } from '../brain/layout.ts';

const rules = (): Rules => ({
  format: 'neurals:v1:rules',
  model: 'ab'.repeat(32),
  traits: { '13': 'Super Weight', '2': 'Induction Head', '1': 'Attention Sink' },
  measurement: { tool: 'cd'.repeat(32), referenceText: 'ef'.repeat(32), thresholds: { superWeight: 10 } },
  seed: { delaySlots: 150, deadlineSlot: 1_000_000 },
});
const hash = encodeBase58(new Uint8Array(32).fill(42));

test('a reveal is rebuilt exactly from the rules and the seed block', () => {
  const r = buildReveal(rules(), 500, hash);
  checkReveal(rules(), r);
  assert.equal(r.pointsOfPart[13], 100);
  assert.equal(r.pointsOfPart[2], 85);
  assert.equal(r.pointsOfPart[0], 0);
  // Each kind is shuffled within itself only.
  r.partOfSlot.forEach((p, s) => assert.equal(PARTS[p].kind, SLOTS[s].kind));
});

test('a reveal that differs in anything is refused', () => {
  const r = buildReveal(rules(), 500, hash);
  assert.throws(() => checkReveal(rules(), { ...r, blockhash: encodeBase58(new Uint8Array(32).fill(43)) }), /does not match/);
  const swapped = { ...r, partOfSlot: r.partOfSlot.slice() };
  [swapped.partOfSlot[1], swapped.partOfSlot[2]] = [swapped.partOfSlot[2], swapped.partOfSlot[1]];
  assert.throws(() => checkReveal(rules(), swapped), /does not match/);
  const other = rules();
  other.traits['14'] = 'Monosemantic';
  assert.throws(() => checkReveal(other, r), /does not match/);
});

test('traits must sit on their kind of part', () => {
  const bad = rules();
  bad.traits['13'] = 'Induction Head'; // 13 is a column
  assert.throws(() => checkRules(bad), /belongs on a head/);
  const unknown = rules();
  (unknown.traits as Record<string, string>)['13'] = 'Polysemantic';
  assert.throws(() => checkRules(unknown as Rules), /unknown trait/);
});

test('the seed slot: a delay after sellout, never past the deadline', () => {
  assert.equal(seedSlotFor(rules(), 1000), 1150);
  assert.equal(seedSlotFor(rules(), null), 1_000_000);
  assert.equal(seedSlotFor(rules(), 999_999), 1_000_000);
});

test('memos commit to the exact files', () => {
  assert.match(commitMemo(rules()), /^neurals:v1:commit:[0-9a-f]{64}:1000000$/);
  const changed = rules();
  changed.seed.delaySlots = 151;
  assert.notEqual(commitMemo(changed), commitMemo(rules()));
  assert.match(revealMemo(buildReveal(rules(), 500, hash)), /^neurals:v1:reveal:[0-9a-f]{64}$/);
  assert.equal(pointsOfParts(rules()).filter((p) => p > 0).length, 3);
});
