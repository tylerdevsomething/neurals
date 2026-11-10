import { useEffect, useState } from 'react';
import { api, fmt, fmtTokens, neurons, short, type SlotDetail } from '../api.ts';
import { slotLabel, TRAITS } from '../BrainMap.tsx';
import { PageHead, Loading, NeuronCount } from '../ui.tsx';
import { stageIcon, PART_ICONS } from '../icons.ts';
import { NeuronPfp } from './Market.tsx';
import { useWallet } from '../chain.ts';

const KIND: Record<string, string> = {
  embedding: 'The Embedding, where text enters the model. One of a kind.',
  unembedding: 'The Unembedding, where the model chooses its next token. One of a kind.',
  head: 'An attention head, 100,000 tokens.',
  column: 'A neuron column, 256 MLP neurons and 768,000 tokens.',
};

export function SlotPage({ index }: { index: number }) {
  const [s, setS] = useState<SlotDetail | null>(null);
  const [error, setError] = useState('');
  const me = useWallet();
  useEffect(() => { setS(null); api.slot(index).then(setS).catch((e) => setError(e.message)); }, [index]);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <Loading />;
  const size = s.end - s.start;
  const p = s.part;
  const kindName = s.kind === 'head' ? 'Attention head' : s.kind === 'column' ? 'Neuron column' : s.kind === 'embedding' ? 'Embedding' : 'Unembedding';
  const partTitle = p && p.layer !== null ? `Layer ${p.layer}, ${s.kind === 'head' ? 'Head' : 'Column'} ${p.within}` : kindName;
  const partSub = p ? `${kindName}, part ${fmt(p.index)}` : KIND[s.kind];
  return (
    <section className="slot-page">
      <div className="slot-nav"><a className="back-link" href="#/network"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3 L5 7 L9 11" /></svg>Back to the network</a>
</div>
      <PageHead title={partTitle} sub={partSub} stats={[[`${fmt((100 * s.issued) / size, 2)}%`, 'Sold'], [s.holders.length, 'Holders']]} />
      <div className="slot-grid">
        <section className="wallet-sec"><h2 className="cons-title wallet-title">The part</h2>
          <dl className="post-details">
            <dt>Kind</dt><dd className="stage-dd"><i className="part-ic" dangerouslySetInnerHTML={{ __html: PART_ICONS[s.kind] ?? '' }} />{s.kind === 'head' ? 'Attention head' : s.kind === 'column' ? 'Neuron column' : s.kind === 'embedding' ? 'Embedding' : 'Unembedding'}</dd>
            {p?.stage && <><dt>Stage</dt><dd><span className="stage-chip"><i className="stage-box" dangerouslySetInnerHTML={{ __html: stageIcon(p.stage) ?? '' }} /><b>{p.stage.replace(/ layers$/i, '')}</b></span></dd></>}
            {p && p.layer !== null && <><dt>Layer</dt><dd>{p.layer}</dd><dt>{s.kind === 'head' ? 'Head' : 'Column'}</dt><dd>{p.within}</dd></>}
            <dt>Part</dt><dd>{p ? fmt(p.index) : 'Drawn at the reveal'}</dd>
            <dt>Trait</dt><dd>{p?.points ? `${TRAITS[p.points]?.name}, ${p.points} points` : 'None'}</dd>
            <dt>Neurons</dt><dd><NeuronCount n={neurons(size)} /></dd>
            <dt>Slot</dt><dd>{s.index}</dd>
            <dt>Positions</dt><dd>{fmtTokens(s.start)} to {fmtTokens(s.end)}</dd>
          </dl>
          {p && <a className="pin-btn slot-pin" href={`#/network/part/${p.index}`}>[Show me in the network]</a>}
        </section>
        <section className="wallet-sec"><h2 className="cons-title wallet-title">Held by<sup className="wallet-count">{s.holders.length}</sup></h2>
          {s.holders.length === 0 ? <p className="empty-line">Nobody holds this part yet.</p> : (
            <table>
              <thead><tr><th>Holder</th><th>Where</th><th>Tokens</th><th>Share</th></tr></thead>
              <tbody>
                {s.holders.map((h) => (
                  <tr key={(h.checkpoint ?? '') + h.holder}>
                    <td><a className="holder-cell" href={`#/wallet/${h.holder}`}><span className={`avatar holder-av ${h.holder === me ? 'is-me' : ''}`} aria-hidden><NeuronPfp seed={h.holder} alt={false} color={h.holder === me ? '#ff3fa4' : undefined} /></span>{short(h.holder)}</a></td>
                    <td>{h.checkpoint ? `Checkpoint ${short(h.checkpoint)}` : 'Wallet'}</td>
                    <td>{fmtTokens(h.amount)}</td>
                    <td>{fmt((100 * h.amount) / size, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <div className="slot-pager">{index > 0 ? <a className="slot-page-btn" href={`#/slot/${index - 1}`}>[Previous]</a> : <span />}{index < 1317 && <a className="slot-page-btn" href={`#/slot/${index + 1}`}>[Next]</a>}</div>
      <p className="home-copy">© 2026 Neurals</p>
    </section>
  );
}
