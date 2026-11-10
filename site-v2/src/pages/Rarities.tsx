// Rarities: every trait from rarest to most common, in one container. DRAFT wording, counts from SPEC.md (measured 2026-11-02).
import { PageHead } from '../ui.tsx';
import { LAB } from '../lab.ts';

const TIERS = ['Most rare', 'Very rare', 'Rare', 'Uncommon', 'Least rare', 'Common'];
const COUNT = [3, 6, 6, 3, 24, 1276];

const fmtN = (n: number) => n.toLocaleString('en-US');

const RARITIES: [string, number, string, string, string, string][] = [
  ['Super Weight', 100, 'Neuron columns', '3 parts', 'Holds one of the largest outlier weights in the model, a single number in an MLP down projection far larger than the weights around it.', 'Strongest is layer 1 column 21, a weight of 11.84 below zero, 1,437 times the layer average.'],
  ['Induction Head', 85, 'Attention heads', '6 parts', 'The circuit that spots a pattern earlier in the text and continues it.', 'Strongest is layer 14 head 3, with a score of 0.98.'],
  ['Massive Activation', 70, 'Neuron columns', '6 parts', 'Holds a neuron that fires thousands of times harder than typical, which the model depends on.', 'Strongest is layer 1 neuron 7401, 8,544 times the layer median.'],
  ['Attention Sink', 50, 'Attention heads', '3 parts', 'A head that parks its attention on the first token when it has nowhere useful to look, which keeps the model stable.', 'Strongest is layer 14 head 5, with 97.6% of its attention on the first token.'],
  ['Monosemantic', 30, 'Neuron columns', '24 parts', 'Holds a neuron that responds to one clear thing. Rare, because most neurons mix many.', 'The strongest put 7 or 8 of their top 8 activations on one rare word, 56 to 63 times chance.'],
  ['No trait', 0, 'Heads and columns', '1,276', 'A part with no measured trait. It still earns its full share by how hard it fires.', 'The Embedding and Unembedding are one of a kind and take no trait.'],
];


/* flat 2D pictures, one per rarity: navy, cobalt and grey only */
const N = '#17306e', C = '#2a5dff', G = '#c3c7ce';
const grid = (hi: number) => { let o = ''; for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { const k = r * 6 + c; o += k === hi ? '' : `<rect x="${8 + c * 14}" y="${8 + r * 14}" width="8" height="8" fill="${G}"/>`; } return o; };
const ART = [
  `${grid(14)}<rect x="30" y="24" width="28" height="28" fill="${C}"/>`,
  `<path d="M14 40 Q48 4 82 40" fill="none" stroke="${N}" stroke-width="2.5"/><path d="M76 33 L82 40 L73 42" fill="none" stroke="${N}" stroke-width="2.5"/>${['A', 'B', 'C', 'A', 'B'].map((t, i) => `<rect x="${4 + i * 18}" y="50" width="16" height="16" fill="${i === 4 ? C : i === 0 || i === 1 ? N : G}"/><text x="${12 + i * 18}" y="62" font-size="10" text-anchor="middle" fill="#ffffff" font-family="monospace">${t}</text>`).join('')}`,
  `${[10, 16, 8, 72, 12, 18, 9].map((h, i) => `<rect x="${8 + i * 12}" y="${88 - h}" width="8" height="${h}" fill="${i === 3 ? C : G}"/>`).join('')}<path d="M4 88 H92" stroke="${N}" stroke-width="2"/>`,
  `${[[70, 18], [82, 44], [74, 72], [50, 84], [44, 20]].map(([x, y]) => `<path d="M${x} ${y} L18 48" stroke="${N}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5" fill="${G}"/>`).join('')}<circle cx="18" cy="48" r="11" fill="${C}"/>`,
  `<path d="M28 48 H58" stroke="${N}" stroke-width="2.5"/><circle cx="24" cy="48" r="9" fill="${N}"/>${[[12, 30], [10, 62], [26, 72], [30, 26]].map(([x, y]) => `<path d="M24 48 L${x} ${y}" stroke="${N}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="3.5" fill="${N}"/>`).join('')}<rect x="58" y="38" width="32" height="20" fill="${C}"/><text x="74" y="52" font-size="10" text-anchor="middle" fill="#ffffff" font-family="monospace">word</text>`,
  `${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="34" y="${6 + i * 14}" width="28" height="10" fill="${G}"/>`).join('')}`,
];

export function Rarities() {
  return (
    <section className="rules rarities">
      <PageHead title={<><iframe className="title-star" title="star" tabIndex={-1} scrolling="no" src={`${LAB}/neuron.html?star&fast&c=pink`} />Rarities</>} sub="Every trait, from rarest to most common." />
      <div className="cons-list">
        {RARITIES.map(([name, pts, kind, count, what, best], i) => (
          <section key={name} className={`cons-sec rar-box rar-t${i}`}>
            <span className="cons-n">[{i + 1}]</span>
            <span className="rar-corner"><span className="rar-tier-name">{TIERS[i]}</span><span className="rar-stars" aria-label={`${5 - i} of 5 stars`}>{[0, 1, 2, 3, 4].map((k) => <svg key={k} viewBox="0 0 16 16" width="12" height="12" className={k < 5 - i ? 'on' : ''}><path d="M8 1.5l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.2l-3.9 2.1.9-4.3-3.2-3 4.3-.5z" /></svg>)}</span></span>
            <h2 className="cons-title">{name}</h2>
            <p className="cons-short">{what}</p>
            <div className="cons-body rar-body">
              
              <div className="rar-facts">
                <div><b>{((100 + pts) / 100).toFixed(2).replace(/\.?0+$/, '')}x</b><span>Share of fees</span></div>
                <div><b>{pts}</b><span>Points</span></div>
                <div><b>{i < 5 ? `1 in ${Math.round(1318 / COUNT[i])}` : fmtN(COUNT[i])}</b><span>{i < 5 ? 'Parts' : 'Of 1,318 parts'}</span></div>
                <div><b>{count.replace(' parts', '')}</b><span>{kind}</span></div>
              </div>
              <p className="rar-best">{best}</p>
            </div>
          </section>
        ))}
      </div>
      <p className="home-copy">© 2026 Neurals</p>
    </section>
  );
}
