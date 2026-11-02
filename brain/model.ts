// The brain's shape (SPEC §2) and the sale's units (SPEC §3). Every other module derives from these.

/** Reference architecture: Qwen2.5-1.5B-Instruct. */
export const MODEL = {
  layers: 28,
  hidden: 1536,
  ffnWidth: 8960,
  heads: 12,
  headDim: 128,
} as const;

/** Token decimals on pump.fun; all positions and amounts are in base units. */
export const DECIMALS = 6;
export const UNIT = 10 ** DECIMALS;

/** pump.fun's saleable curve supply, in whole tokens. */
export const CURVE_SUPPLY = 793_100_000;

/** The sale's unit: every 3,000 tokens bought off the curve is one MLP neuron. */
export const TOKENS_PER_NEURON = 3_000;
export const NEURONS_PER_COLUMN = 256;
export const COLUMNS_PER_LAYER = MODEL.ffnWidth / NEURONS_PER_COLUMN; // 35

/** Whole tokens per segment kind. */
export const TOKENS = {
  embedding: 3_430_000,
  head: 100_000,
  column: NEURONS_PER_COLUMN * TOKENS_PER_NEURON, // 768,000
  unembedding: 3_430_000,
} as const;

export const HEAD_COUNT = MODEL.layers * MODEL.heads; // 336
export const COLUMN_COUNT = MODEL.layers * COLUMNS_PER_LAYER; // 980
export const SEGMENT_COUNT = 1 + HEAD_COUNT + COLUMN_COUNT + 1; // 1,318
export const TOKENS_PER_BAND = MODEL.heads * TOKENS.head + COLUMNS_PER_LAYER * TOKENS.column; // 28,080,000

if (!Number.isInteger(COLUMNS_PER_LAYER)) throw new Error('FFN width must divide into columns');
if (TOKENS.embedding + MODEL.layers * TOKENS_PER_BAND + TOKENS.unembedding !== CURVE_SUPPLY) {
  throw new Error('segment sizes must add up to the curve supply');
}

export type Kind = 'embedding' | 'head' | 'column' | 'unembedding';

/** Stage by layer depth (SPEC §3). */
export const STAGES = [
  { from: 0, to: 3, name: 'Tokenizer layers' },
  { from: 4, to: 7, name: 'Syntax layers' },
  { from: 8, to: 13, name: 'Semantic layers' },
  { from: 14, to: 19, name: 'Memory layers' },
  { from: 20, to: 24, name: 'Reasoning layers' },
  { from: 25, to: 27, name: 'Prediction layers' },
] as const;

export function stageOf(layer: number): string {
  const s = STAGES.find((x) => layer >= x.from && layer <= x.to);
  if (!s) throw new RangeError(`no layer ${layer}`);
  return s.name;
}
