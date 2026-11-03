import { useEffect, useState } from 'react';
import { api, fmt, fmtTokens, sol, type Brain, type Health, type EpochView, type Activity } from '../api.ts';
import { BrainMap, ownershipMap, activityMap } from '../BrainMap.tsx';
import { CURVE_SUPPLY, UNIT } from '../../../brain/model.ts';

export function Home() {
  const [brain, setBrain] = useState<Brain | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [epochs, setEpochs] = useState<EpochView[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [view, setView] = useState<'owned' | 'fires'>('owned');
  useEffect(() => {
    const load = () => {
      api.brain().then(setBrain).catch(() => {});
      api.health().then(setHealth).catch(() => {});
      api.epochs().then(setEpochs).catch(() => {});
      api.activity().then(setActivity).catch(() => {});
    };
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  const fees = epochs.reduce((a, e) => a + sol(e.fees), 0);
  const sold = brain ? brain.issued / (CURVE_SUPPLY * UNIT) : 0;
  return (
    <>
      <section className="hero">
        <h1>An AI brain you can own a piece of.</h1>
        <p>
          A 1.5-billion-parameter language model, written byte for byte onto Solana, and owned through a pump.fun
          token: every one of the 793.1 million tokens on the curve is a piece of it. Its 250,880 MLP neurons are
          3,000 tokens each; its 336 attention heads, the Embedding and the Unembedding are sold the same way.
          When the brain thinks, each paid message pays the parts that fired.
        </p>
      </section>
      <section className="stats">
        <div><b>{fmt(sold * 100, 2)}%</b><span>of the brain sold</span></div>
        <div><b>{brain ? fmtTokens(brain.issued) : '…'}</b><span>tokens issued with neurons</span></div>
        <div><b>{health?.epoch ?? '…'}</b><span>epoch</span></div>
        <div><b>{fmt(fees, 3)} SOL</b><span>paid to neurons so far</span></div>
      </section>
      <section>
        <h2>The brain</h2>
        <div className="toggle" role="tablist">
          <button role="tab" aria-selected={view === 'owned'} className={view === 'owned' ? 'on' : ''} onClick={() => setView('owned')}>Who owns it</button>
          <button role="tab" aria-selected={view === 'fires'} className={view === 'fires' ? 'on' : ''} onClick={() => setView('fires')}>What fires</button>
        </div>
        <p className="muted">
          {view === 'owned'
            ? (brain?.revealed
              ? 'Every part of the model, laid out as it is built: the Embedding where text enters, 28 layers of 12 attention heads and 35 neuron columns, the Unembedding where words come out. Brighter means more of it is sold. Letters mark the measured traits.'
              : 'The 1,318 slots in buying order: the Embedding, then 28 bands of 12 attention-head slots and 35 neuron-column slots, then the Unembedding. Brighter means more of it is sold. Which real part each slot holds is drawn at the reveal.')
            : `How hard each part of the brain worked across the last ${activity?.messages ?? 0} paid messages, against the average for its kind. Laid out as the model is built, from the tokenizer layers at the top to the prediction layers at the bottom.`}
        </p>
        {!brain ? <p className="muted">Loading…</p>
          : view === 'owned'
            ? <BrainMap data={ownershipMap(brain)} legend={{ title: 'Who owns the brain', low: 'unsold', high: 'sold out' }} />
            : activity && activity.messages > 0
              ? <BrainMap data={activityMap(activity.shares, brain)} legend={{ title: 'What fires', low: '¼ of its kind\'s average', high: '4× or more' }} />
              : <p className="muted">No paid messages yet. Ask the brain something on the Chat page.</p>}
      </section>
      <section className="cols">
        <div>
          <h3>Neurons never die</h3>
          <p>Sell or send tokens and some neurons go dormant: they stop earning. Buy back and they wake. Nothing is ever lost.</p>
        </div>
        <div>
          <h3>Checkpoints</h3>
          <p>Seal neurons with their tokens into a checkpoint to sell or gift them without anything moving. Neurons in a checkpoint never sleep.</p>
        </div>
        <div>
          <h3>Paid by what fires</h3>
          <p>Every paid message posts a receipt of how much each part of the brain fired. Anyone can replay it. Owners are paid each epoch.</p>
        </div>
      </section>
    </>
  );
}
