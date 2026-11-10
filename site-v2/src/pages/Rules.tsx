import { type ReactNode } from 'react';
import { PageHead } from '../ui.tsx';
import { PART_ICONS } from '../icons.ts';
const PI = (k: string) => <i className="part-ic" dangerouslySetInnerHTML={{ __html: PART_ICONS[k] }} />;
import { TOKENS } from '../../../brain/model.ts';
import { fmt } from '../api.ts';

const SLOTS_PART = (
  <>
      <p>
        pump.fun's curve sells 793,100,000 tokens, and every one of them is a piece of the brain. In a neuron column, 3,000
        tokens are one MLP neuron (250,880 in all); the attention heads, the Embedding and the Unembedding are sold by
        the token too, and the site counts every holding in units of 3,000 tokens ("neurons"). The sale fills 1,318
        slots in buying order:
      </p>
      <table>
        <thead><tr><th>Slot</th><th>Count</th><th>Tokens each</th></tr></thead>
        <tbody>
          <tr><td>{PI('embedding')}Embedding: where text enters</td><td>1</td><td>{fmt(TOKENS.embedding)}</td></tr>
          <tr><td>{PI('head')}Attention head</td><td>336</td><td>{fmt(TOKENS.head)}</td></tr>
          <tr><td>{PI('column')}Neuron column (256 neurons)</td><td>980</td><td>{fmt(TOKENS.column)}</td></tr>
          <tr><td>{PI('unembedding')}Unembedding: where words come out</td><td>1</td><td>{fmt(TOKENS.unembedding)}</td></tr>
        </tbody>
      </table>
  </>
);

const REVEAL_PART = (
  <>
      <p>
        After the sale, a future block's hash shuffles the real heads and columns into the slots of their kind. So the
        traits below are known before launch, but nobody can aim a buy at one.
      </p>

  </>
);

const TRAITS_PART = (
  <>
      <p>A published tool measures them on the exact model on chain. Anyone can rerun it. A part with a trait earns a bonus: (100 + points)/100 times its share, within its kind's budget.</p>
      <p className="cons-more"><a className="home-cta" href="#/rarities">[See all rarities]</a></p>
  </>
);

const NEVER_PART = (
  <>
      <ul>
        <li>Your neurons earn as far as your token balance covers them, rarest first. Sell some tokens and some neurons go dormant. Buy back and they earn again.</li>
      </ul>
  </>
);

const CHECKPOINT_PART = (
  <>
      <ul>
        <li><b>Checkpoints</b> freeze neurons with their tokens. Neurons in a checkpoint always keep earning, and a checkpoint can be listed, sold or gifted without anything moving. Withdrawing returns everything.</li>
        <li><b>Carry</b> sends tokens with their neurons to another wallet. A plain transfer or swap moves tokens only.</li>
      </ul>
  </>
);

const PAID_PART = (
  <>
      <ul>
        <li>Each paid message posts a receipt: how much each of the 1,318 parts fired, in parts per million. The receipt is measured by a canonical replay that anyone can run.</li>
        <li>Each kind of part gets a fixed share of every fee by the tokens it was sold for; within a kind, by how much each part fired.</li>
        <li>Once per epoch, fees go to the neurons held active for the whole epoch, at each wallet's lowest balance of the epoch. Dormant neurons' shares go to the active ones.</li>
        <li>Payouts are posted on chain as one Merkle root and pushed to every owner. Anyone can rebuild the root from the public ledger.</li>
      </ul>
  </>
);

export function Rules() {
  const boxes: [string, string, ReactNode][] = [
    ['Every token is a piece of the brain', 'The curve sells 793,100,000 tokens and fills 1,318 slots in buying order.', SLOTS_PART],
    ['Which part you get is drawn later', 'After the sale a future block shuffles the real parts into their slots, so nobody can aim a buy.', REVEAL_PART],
    ['Traits are measured, not drawn', 'Five traits, measured on the exact inscribed model. A trait earns a bonus.', TRAITS_PART],
    ['Neurons never die', 'Sell and some go dormant. Buy back and they earn again. Nothing is lost.', NEVER_PART],
    ['Selling without moving anything', 'Checkpoints and carry move neurons with their tokens.', CHECKPOINT_PART],
    ['Paid by what fires', 'Every paid message posts a receipt. Each epoch the fees go to the parts that fired.', PAID_PART],
  ];
  return (
    <section className="rules">
      <PageHead title="Constraints" sub="The rules in six parts." />
      {/* one plain vertical list, every part open, no pop ups */}
      <div className="cons-list">
        {boxes.map(([t, short, body], i) => (
          <section key={t} className="cons-sec">
            <span className="cons-n">[{i + 1}]</span>
            <h2 className="cons-title">{t}</h2>
            <p className="cons-short">{short}</p>
            <div className="cons-body">{body}</div>
          </section>
        ))}
      </div>
      <p className="home-copy">© 2026 Neurals</p>
    </section>
  );
}
