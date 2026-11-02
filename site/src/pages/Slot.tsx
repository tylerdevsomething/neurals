import { useEffect, useState } from 'react';
import { api, fmt, fmtTokens, neurons, short, type SlotDetail } from '../api.ts';
import { slotLabel, TRAITS } from '../BrainMap.tsx';

const KIND: Record<string, string> = {
  embedding: 'The Embedding: where text enters the model. One of a kind.',
  unembedding: 'The Unembedding: the output head, where the model chooses its next token. One of a kind.',
  head: 'An attention head slot: 100,000 tokens. Which head it holds is drawn at the reveal.',
  column: 'A neuron column slot: 256 MLP neurons, 768,000 tokens. Which column it holds is drawn at the reveal.',
};

export function SlotPage({ index }: { index: number }) {
  const [s, setS] = useState<SlotDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setS(null); api.slot(index).then(setS).catch((e) => setError(e.message)); }, [index]);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const size = s.end - s.start;
  return (
    <section>
      <p><a href="#/">← brain</a> · {index > 0 && <a href={`#/slot/${index - 1}`}>previous</a>} {index < 1317 && <a href={`#/slot/${index + 1}`}>next</a>}</p>
      <h1>Slot #{s.index}</h1>
      <p>{KIND[s.kind]}</p>
      <dl>
        <dt>Positions</dt><dd>{fmtTokens(s.start)} – {fmtTokens(s.end)} ({fmtTokens(size)} tokens, {fmt(neurons(size))} neurons)</dd>
        <dt>Sold</dt><dd>{fmt((100 * s.issued) / size, 2)}%</dd>
        <dt>Part</dt><dd>{s.part ? slotLabel(s).split(' · ').slice(1).join(' · ') || s.kind : 'drawn at the reveal'}</dd>
        {s.part && <><dt>Trait</dt><dd>{s.part.points ? `${TRAITS[s.part.points]?.name} (${s.part.points} points)` : 'none'}</dd></>}
      </dl>
      <h2>Held by</h2>
      {s.holders.length === 0 ? <p className="muted">Nobody yet.</p> : (
        <table>
          <thead><tr><th>Holder</th><th>Where</th><th>Tokens</th><th>Share of slot</th></tr></thead>
          <tbody>
            {s.holders.map((h) => (
              <tr key={(h.checkpoint ?? '') + h.holder}>
                <td><a href={`#/wallet/${h.holder}`}>{short(h.holder)}</a></td>
                <td>{h.checkpoint ? `checkpoint ${short(h.checkpoint)}` : 'wallet'}</td>
                <td>{fmtTokens(h.amount)}</td>
                <td>{fmt((100 * h.amount) / size, 2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
