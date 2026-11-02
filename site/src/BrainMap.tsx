// All 1,318 slots in forward-pass order: the Embedding, 28 rows of 12 attention heads and 35 neuron
// columns, then the Unembedding. Brightness is how much of a slot is sold; after the reveal, a
// slot with a trait takes that trait's colour. Slots the viewer owns are outlined.
import type { BrainSlot } from './api.ts';

const CELL = 13;
const GAP = 2;
const HEADS = 12;
const COLS = 35;
const PER_ROW = HEADS + COLS;
const ROWS = 28;
const SPLIT = 8; // a little space between the heads and the columns

export const TRAIT_COLOURS: Record<number, string> = {
  100: '#ffcf5a', // Super Weight
  85: '#ff7ab6', // Induction Head
  70: '#b08cff', // Massive Activation
  50: '#5ab8ff', // Attention Sink
  30: '#7cf3c8', // Monosemantic
};

function x(k: number) {
  return k * (CELL + GAP) + (k >= HEADS ? SPLIT : 0);
}

export function BrainMap(props: { slots: BrainSlot[]; owned?: Set<number>; onPick?: (i: number) => void; selected?: number }) {
  const width = x(PER_ROW - 1) + CELL;
  const rowH = CELL + GAP;
  const height = rowH * (ROWS + 2) + 2 * 10;
  const fill = (s: BrainSlot) => {
    const sold = Math.min(1, s.issued / (s.end - s.start));
    if (s.part && s.part.points > 0) return TRAIT_COLOURS[s.part.points] ?? '#7cf3c8';
    if (sold === 0) return '#18212b';
    return `rgba(124, 243, 200, ${0.25 + 0.75 * sold})`;
  };
  const cell = (s: BrainSlot, cx: number, cy: number, w: number) => (
    <rect
      key={s.index}
      x={cx}
      y={cy}
      width={w}
      height={CELL}
      rx={2}
      fill={fill(s)}
      stroke={props.selected === s.index ? '#fff' : props.owned?.has(s.index) ? '#ffcf5a' : 'none'}
      strokeWidth={props.selected === s.index || props.owned?.has(s.index) ? 1.5 : 0}
      style={{ cursor: props.onPick ? 'pointer' : 'default' }}
      onClick={() => props.onPick?.(s.index)}
    >
      <title>{label(s)}</title>
    </rect>
  );
  const [embedding, ...rest] = props.slots;
  const unembedding = rest.pop()!;
  return (
    <svg className="brainmap" viewBox={`-2 -2 ${width + 4} ${height + 4}`} role="img" aria-label="The brain: every slot">
      {cell(embedding, 0, 0, width)}
      {rest.map((s, i) => {
        const row = Math.floor(i / PER_ROW);
        const k = i % PER_ROW;
        return cell(s, x(k), 10 + rowH * (row + 1), CELL);
      })}
      {cell(unembedding, 0, 20 + rowH * (ROWS + 1), width)}
    </svg>
  );
}

export function label(s: BrainSlot): string {
  const sold = Math.round((100 * s.issued) / (s.end - s.start));
  const name = s.kind === 'embedding' ? 'Embedding' : s.kind === 'unembedding' ? 'Unembedding' : s.kind === 'head' ? 'Attention head slot' : 'Neuron column slot';
  const part = s.part
    ? s.part.layer === null ? '' : ` · layer ${s.part.layer} ${s.kind === 'head' ? 'head' : 'column'} ${s.part.within} (${s.part.stage})${s.part.trait ? ` · ${s.part.trait}` : ''}`
    : '';
  return `#${s.index} ${name}${part} · ${sold}% sold`;
}

export function Legend({ revealed }: { revealed: boolean }) {
  return (
    <div className="legend">
      <span><i style={{ background: '#18212b' }} /> unsold</span>
      <span><i style={{ background: 'rgba(124,243,200,.6)' }} /> sold</span>
      <span><i style={{ border: '1.5px solid #ffcf5a' }} /> yours</span>
      {revealed && Object.entries({ 'Super Weight': 100, 'Induction Head': 85, 'Massive Activation': 70, 'Attention Sink': 50, Monosemantic: 30 }).map(([n, p]) => (
        <span key={n}><i style={{ background: TRAIT_COLOURS[p] }} /> {n}</span>
      ))}
    </div>
  );
}
