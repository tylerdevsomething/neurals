// The brain map: 1,318 cells laid out as the model is built. The Embedding (text in) on top, then
// 28 rows of 12 attention heads and 35 neuron columns, then the Unembedding (words out).
//
// Colour encodes ONE magnitude at a time on a single-hue sequential ramp (dark = little, bright =
// a lot): how much of a slot is sold, or how hard a part fired. Traits are never colour-coded:
// five categories cannot be told apart reliably side by side (validated), so a trait is a letter
// in the cell plus an outline. Every cell has a hover/focus tooltip (value first), and every map
// has a table view.
import { useMemo, useRef, useState } from 'react';
import type { Brain, BrainSlot } from './api.ts';
import { fmt } from './api.ts';
import { STAGES, MODEL } from '../../brain/model.ts';
import { PARTS } from '../../brain/layout.ts';
import { BUDGET } from '../../brain/receipt.ts';

// Sequential ramp (blue, dark mode): low recedes toward the dark surface, high is bright.
const RAMP = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const EMPTY = '#1a2531'; // exactly nothing (unsold, never fired): one step off the surface
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function rampColour(v: number): string {
  if (!(v > 0)) return EMPTY;
  const x = Math.min(1, v) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const t = x - i;
  const [a, b] = [hexRgb(RAMP[i]), hexRgb(RAMP[i + 1])];
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * t)).join(',')})`;
}

/** Ink that reads on a cell of ramp value v: dark on the bright end, light on the dark end. */
const ink = (v: number) => (v > 0.55 ? '#0b0f14' : '#f0efec');

export const TRAITS: Record<number, { letter: string; name: string }> = {
  100: { letter: 'S', name: 'Super Weight' },
  85: { letter: 'I', name: 'Induction Head' },
  70: { letter: 'M', name: 'Massive Activation' },
  50: { letter: 'A', name: 'Attention Sink' },
  30: { letter: 'O', name: 'Monosemantic (one clear thing)' },
};

export type Cell = {
  /** 0..1 on the ramp; 0 is "nothing". */
  v: number;
  /** The value, shown first in the tooltip. */
  value: string;
  /** Tooltip lines after the value. */
  lines: string[];
  trait?: number;
  owned?: boolean;
  href?: string;
};

export type MapData = { top: Cell; rows: Cell[][]; bottom: Cell; rowLabel: (r: number) => string; anatomical: boolean };

const C = 13;
const G = 2;
const SPLIT = 8;
const GUTTER = 128;
const HEAD = 18;
const colX = (k: number) => GUTTER + k * (C + G) + (k >= MODEL.heads ? SPLIT : 0);
const WIDTH = colX(MODEL.heads + 35 - 1) + C;

export function BrainMap({ data, legend, onPick }: { data: MapData; legend: { low: string; high: string; title: string }; onPick?: (href: string) => void }) {
  const [tip, setTip] = useState<{ x: number; y: number; cell: Cell } | null>(null);
  const [table, setTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const rowY = (r: number) => HEAD + (C + 8) + r * (C + G);
  const bottomY = rowY(28) + 6;
  const height = bottomY + C + 4;

  const show = (e: React.PointerEvent | React.FocusEvent, cell: Cell) => {
    const box = wrap.current!.getBoundingClientRect();
    const p = 'clientX' in e ? { x: e.clientX, y: e.clientY } : (() => { const r = (e.target as Element).getBoundingClientRect(); return { x: r.right, y: r.top }; })();
    setTip({ x: p.x - box.left, y: p.y - box.top, cell });
  };

  const onPICK = (href: string) => (onPick ? onPick(href) : (location.hash = href));
  const cellEl = (cell: Cell, x: number, y: number, w: number, key: string) => (
    <g key={key}>
      <rect
        x={x} y={y} width={w} height={C} rx={2}
        fill={rampColour(cell.v)}
        stroke={cell.trait ? ink(cell.v) : 'none'}
        strokeWidth={cell.trait ? 1.5 : 0}
        tabIndex={-1}
        style={{ cursor: cell.href ? 'pointer' : 'default' }}
        onPointerMove={(e) => show(e, cell)}
        onPointerLeave={() => setTip(null)}
        onClick={() => cell.href && onPICK(cell.href)}
      />
      {cell.trait ? (
        <text x={x + w / 2} y={y + C / 2 + 3.5} textAnchor="middle" className="glyph" fill={ink(cell.v)} pointerEvents="none">
          {TRAITS[cell.trait]?.letter}
        </text>
      ) : null}
      {cell.owned ? <path d={`M${x + 1} ${y + 1}h6l-6 6z`} fill={ink(cell.v)} pointerEvents="none" /> : null}
    </g>
  );

  // Stage brackets (anatomical maps only): which layers do what.
  const stages = data.anatomical ? STAGES : [];
  const all = useMemo(() => [data.top, ...data.rows.flat(), data.bottom], [data]);

  return (
    <div className="brainmap-wrap" ref={wrap}>
      <svg className="brainmap" viewBox={`0 0 ${WIDTH + 4} ${height}`} role="img" aria-label={legend.title}>
        <text x={colX(0)} y={12} className="axis">12 attention heads</text>
        <text x={colX(MODEL.heads)} y={12} className="axis">35 neuron columns (256 neurons each)</text>
        <text x={GUTTER - 8} y={HEAD + C - 3} textAnchor="end" className="axis">text in</text>
        {cellEl(data.top, GUTTER, HEAD, WIDTH - GUTTER, 'top')}
        {data.rows.map((row, r) => (
          <g key={r}>
            <text x={GUTTER - 8} y={rowY(r) + C - 3} textAnchor="end" className="axis small">{data.rowLabel(r)}</text>
            {row.map((cell, k) => cellEl(cell, colX(k), rowY(r), C, `${r}:${k}`))}
          </g>
        ))}
        {stages.map((s) => (
          <g key={s.name}>
            <line x1={6} x2={6} y1={rowY(s.from) + 1} y2={rowY(s.to) + C - 1} className="bracket" />
            <text x={12} y={(rowY(s.from) + rowY(s.to) + C) / 2 + 3} className="axis stage">{s.name.replace(' layers', '')}</text>
          </g>
        ))}
        <text x={GUTTER - 8} y={bottomY + C - 3} textAnchor="end" className="axis">words out</text>
        {cellEl(data.bottom, GUTTER, bottomY, WIDTH - GUTTER, 'bottom')}
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 600) - 260), top: tip.y + 14 }}>
          <strong>{tip.cell.value}</strong>
          {tip.cell.lines.map((l, i) => <span key={i}>{l}</span>)}
          {tip.cell.trait ? <span>trait: {TRAITS[tip.cell.trait].name}</span> : null}
          {tip.cell.owned ? <span>yours</span> : null}
        </div>
      )}
      <div className="legend">
        <span className="ramp">
          <span>{legend.low}</span>
          <i style={{ background: `linear-gradient(90deg, ${EMPTY}, ${RAMP.join(', ')})` }} />
          <span>{legend.high}</span>
        </span>
        {all.some((c) => c.owned) && <span><i className="swatch owned" /> yours</span>}
        {all.some((c) => c.trait) && Object.values(TRAITS).map((t) => <span key={t.letter}><b className="glyph-key">{t.letter}</b> {t.name}</span>)}
        <button className="link" onClick={() => setTable(!table)}>{table ? 'hide table' : 'show as a table'}</button>
      </div>
      {table && <MapTable cells={all} />}
    </div>
  );
}

function MapTable({ cells }: { cells: Cell[] }) {
  const top = cells.map((c, i) => ({ c, i })).filter((x) => x.c.v > 0 || x.c.owned || x.c.trait).sort((a, b) => b.c.v - a.c.v).slice(0, 40);
  return (
    <table className="maptable">
      <thead><tr><th>Value</th><th>Part</th><th>Trait</th></tr></thead>
      <tbody>
        {top.map(({ c, i }) => (
          <tr key={i}>
            <td>{c.value}</td>
            <td>{c.href ? <a href={c.href}>{c.lines[0]}</a> : c.lines[0]}</td>
            <td>{c.trait ? TRAITS[c.trait].name : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A slot in words: what kind it is and, after the reveal, which part it holds. */
export function slotLabel(s: BrainSlot): string {
  const kind = s.kind === 'embedding' ? 'the Embedding' : s.kind === 'unembedding' ? 'the Unembedding' : s.kind === 'head' ? 'an attention head' : 'a neuron column';
  if (!s.part || s.part.layer === null) return `#${s.index} · ${kind}`;
  const trait = s.part.points ? ` · ${TRAITS[s.part.points]?.name}` : '';
  return `#${s.index} · layer ${s.part.layer} ${s.kind === 'head' ? 'head' : 'column'} ${s.part.within} (${s.part.stage})${trait}`;
}

// ---- builders --------------------------------------------------------------------------------

const PER_ROW = MODEL.heads + 35;
const partLabel = (p: number) => {
  const x = PARTS[p];
  if (x.kind === 'embedding') return 'the Embedding: where text enters';
  if (x.kind === 'unembedding') return 'the Unembedding: where words come out';
  return `layer ${x.layer} ${x.kind === 'head' ? 'attention head' : 'neuron column'} ${x.within}`;
};
const stageLine = (p: number) => {
  const l = PARTS[p].layer;
  return l === null ? null : STAGES.find((s) => l >= s.from && l <= s.to)!.name;
};

function arrange(cells: Cell[], anatomical: boolean, revealed: boolean): MapData {
  return {
    top: cells[0],
    rows: Array.from({ length: 28 }, (_, r) => cells.slice(1 + r * PER_ROW, 1 + (r + 1) * PER_ROW)),
    bottom: cells[cells.length - 1],
    rowLabel: (r) => (anatomical ? `layer ${r}` : revealed ? `layer ${r}` : `band ${r + 1}`),
    anatomical,
  };
}

/** Who owns it: how much of each slot is sold. After the reveal, laid out as the real model. */
export function ownershipMap(brain: Brain, owned?: Set<number>): MapData {
  const slotOfPart = new Map<number, BrainSlot>();
  for (const s of brain.slots) if (s.part) slotOfPart.set(s.part.index, s);
  const anatomical = brain.revealed;
  const cells = PARTS.map((part, i) => {
    const s = anatomical ? slotOfPart.get(part.index)! : brain.slots[i];
    const size = s.end - s.start;
    const sold = s.issued / size;
    const lines = [anatomical ? partLabel(part.index) : `slot #${s.index}: ${s.kind === 'head' ? 'an attention head' : s.kind === 'column' ? 'a neuron column' : s.kind}`];
    if (anatomical && stageLine(part.index)) lines.push(stageLine(part.index)!);
    lines.push(`${fmt(size / 1e6 / 3000)} neurons in slot #${s.index}`);
    return {
      v: sold, value: sold === 0 ? 'not sold yet' : `${fmt(sold * 100, 1)}% sold`, lines,
      trait: s.part?.points || undefined, owned: owned?.has(s.index), href: `#/slot/${s.index}`,
    };
  });
  return arrange(cells, anatomical, brain.revealed);
}

/**
 * What fires: each part's share of the fee, against the average for its kind (heads and columns
 * have different budgets, so raw shares would make every head look dim). Laid out as the real model.
 */
export function activityMap(shares: readonly number[], brain?: Brain | null): MapData {
  const kindTotal = { embedding: 0, head: 0, column: 0, unembedding: 0 } as Record<string, number>;
  const kindCount = { embedding: 0, head: 0, column: 0, unembedding: 0 } as Record<string, number>;
  PARTS.forEach((p, i) => { kindTotal[p.kind] += shares[i]; kindCount[p.kind]++; });
  const slotOfPart = new Map<number, BrainSlot>();
  for (const s of brain?.slots ?? []) if (s.part) slotOfPart.set(s.part.index, s);
  const cells = PARTS.map((p, i) => {
    const avg = kindTotal[p.kind] / kindCount[p.kind];
    const ratio = avg > 0 ? shares[i] / avg : 0;
    const slot = slotOfPart.get(i);
    const lines = [partLabel(i)];
    if (stageLine(i)) lines.push(stageLine(i)!);
    lines.push(`${fmt(shares[i] / 10_000, 3)}% of each fee`);
    if (p.kind === 'embedding' || p.kind === 'unembedding') lines.push(`a fixed ${fmt(BUDGET[p.kind] * 100, 2)}% budget`);
    if (slot) lines.push(`held in slot #${slot.index}`);
    return {
      v: p.kind === 'embedding' || p.kind === 'unembedding' ? (shares[i] > 0 ? 0.5 : 0) : ratio > 0 ? Math.max(0.02, Math.min(1, (Math.log2(ratio) + 2) / 4)) : 0,
      value: shares[i] === 0 ? 'no activity yet' : p.kind === 'embedding' || p.kind === 'unembedding' ? `${fmt(shares[i] / 10_000, 2)}% of each fee` : `${fmt(ratio, 2)}× the average ${p.kind === 'head' ? 'head' : 'column'}`,
      lines,
      trait: slot?.part?.points || undefined,
      href: slot ? `#/slot/${slot.index}` : undefined,
    };
  });
  return arrange(cells, true, !!brain?.revealed);
}
