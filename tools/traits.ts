// Turns the trait tool's raw measurements into the rules draft (SPEC §4).
//
//   node tools/traits.ts out/traits-raw.json [--out rules/neurals-v1.draft.json] [--deadline <slot>]
//        [--super 100] [--induction 0.4] [--massive 1000] [--sink 0.8] [--mono 0.875] [--lift 20]
//
// A part qualifies only if it passes its threshold; the counts are caps. Each part takes at most
// one trait, from the most points down. The rules record the tool's and the reference text's
// hashes, so anyone can rerun probe/neurals-traits and get the same list.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MODEL, COLUMNS_PER_LAYER, NEURONS_PER_COLUMN } from '../brain/model.ts';
import { checkRules, canonical, sha256Hex, TRAITS, type Rules, type TraitName } from '../brain/reveal.ts';

type Raw = {
  tokens: number;
  k: number;
  perplexity: number;
  heads: { layer: number; head: number; sink: number; induction: number }[];
  superWeight: { layer: number; neuron: number; out: number; weight: number; input: number; output: number; perplexityRatio: number }[];
  outliers: { layer: number; out: number; neuron: number; weight: number; ratio: number }[];
  neurons: { layer: number; neuron: number; ratio: number; same: number; token: number; freq: number }[];
};

const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const raw = JSON.parse(readFileSync(args[0] ?? 'out/traits-raw.json', 'utf8')) as Raw;
const T = {
  /** A weight's magnitude against its layer's root-mean-square weight. */
  superWeight: Number(opt('--super', '100')),
  induction: Number(opt('--induction', '0.4')),
  massive: Number(opt('--massive', '1000')),
  sink: Number(opt('--sink', '0.8')),
  monosemantic: Number(opt('--mono', '0.875')),
  /** How many times more often than chance the neuron's token must fill its top positions. */
  lift: Number(opt('--lift', '20')),
};
const CAPS: Record<TraitName, number> = { 'Super Weight': 3, 'Induction Head': 6, 'Massive Activation': 6, 'Attention Sink': 12, Monosemantic: 24 };

const perLayer = MODEL.heads + COLUMNS_PER_LAYER;
const headPart = (layer: number, head: number) => 1 + layer * perLayer + head;
const columnPart = (layer: number, neuron: number) => 1 + layer * perLayer + MODEL.heads + Math.floor(neuron / NEURONS_PER_COLUMN);

// Candidates per trait, best first.
const candidates: Record<TraitName, { part: number; score: number; what: string }[]> = {
  // The largest outlier weights (SPEC §4): the column holding the neuron the weight leads out of.
  'Super Weight': raw.outliers.filter((o) => o.ratio >= T.superWeight).sort((a, b) => b.ratio - a.ratio)
    .map((o) => ({ part: columnPart(o.layer, o.neuron), score: o.ratio, what: `layer ${o.layer} neuron ${o.neuron} -> dim ${o.out}: weight ${o.weight.toFixed(2)}, ${Math.round(o.ratio)}x the layer's RMS weight` })),
  'Induction Head': raw.heads.filter((h) => h.induction >= T.induction).sort((a, b) => b.induction - a.induction)
    .map((h) => ({ part: headPart(h.layer, h.head), score: h.induction, what: `layer ${h.layer} head ${h.head}: induction score ${h.induction.toFixed(3)}` })),
  'Massive Activation': raw.neurons.filter((n) => n.ratio >= T.massive).sort((a, b) => b.ratio - a.ratio)
    .map((n) => ({ part: columnPart(n.layer, n.neuron), score: n.ratio, what: `layer ${n.layer} neuron ${n.neuron}: ${Math.round(n.ratio)}x the layer median` })),
  'Attention Sink': raw.heads.filter((h) => h.sink >= T.sink).sort((a, b) => b.sink - a.sink)
    .map((h) => ({ part: headPart(h.layer, h.head), score: h.sink, what: `layer ${h.layer} head ${h.head}: ${(100 * h.sink).toFixed(1)}% of attention on the first token` })),
  // Consistent on a token found everywhere is not selective: score by lift over chance.
  Monosemantic: raw.neurons.map((n) => ({ n, lift: n.freq ? (n.same / raw.k) / (n.freq / raw.tokens) : 0 }))
    .filter((x) => x.n.same / raw.k >= T.monosemantic && x.lift >= T.lift).sort((a, b) => b.lift - a.lift || b.n.ratio - a.n.ratio)
    .map(({ n, lift }) => ({ part: columnPart(n.layer, n.neuron), score: lift, what: `layer ${n.layer} neuron ${n.neuron}: ${n.same} of its top ${raw.k} on token ${n.token}, which is ${n.freq} of ${raw.tokens} tokens (${lift.toFixed(0)}x chance)` })),
};

const traits: Record<string, TraitName> = {};
const report: string[] = [];
for (const name of (Object.keys(TRAITS) as TraitName[]).sort((a, b) => TRAITS[b].points - TRAITS[a].points)) {
  let given = 0;
  for (const c of candidates[name]) {
    if (given >= CAPS[name]) break;
    if (traits[c.part]) continue; // already has a higher trait; the next one takes its place
    traits[c.part] = name;
    given++;
    report.push(`  ${name.padEnd(18)} part ${String(c.part).padStart(4)}  ${c.what}`);
  }
  console.log(`${name}: ${given} given (${candidates[name].length} qualified, cap ${CAPS[name] === Infinity ? 'none' : CAPS[name]})`);
}
console.log(report.join('\n'));
console.log(`reference text: ${raw.tokens} tokens, perplexity ${raw.perplexity.toFixed(2)}`);

const tool = createHash('sha256').update(readFileSync('probe/neurals-traits.cpp')).update('llama.cpp b12033').digest('hex');
const rules: Rules = {
  format: 'neurals:v1:rules',
  model: opt('--model', '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'),
  traits,
  measurement: { tool, referenceText: sha256Hex(readFileSync('rules/reference.txt')), thresholds: { ...T, k: raw.k } },
  seed: { delaySlots: Number(opt('--delay', '150')), deadlineSlot: Number(opt('--deadline', '1')) },
};
checkRules(rules);
const out = opt('--out', 'rules/neurals-v1.draft.json');
writeFileSync(out, JSON.stringify(rules, null, 2) + '\n');
console.log(`wrote ${out} (sha256 of canonical form ${sha256Hex(canonical(rules)).slice(0, 16)}…; set the deadline slot at launch)`);
