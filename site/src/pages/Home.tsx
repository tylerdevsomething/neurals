import { useEffect, useState } from 'react';
import { api, fmt, fmtTokens, sol, type Brain, type Health, type EpochView } from '../api.ts';
import { BrainMap, Legend } from '../BrainMap.tsx';
import { CURVE_SUPPLY, UNIT } from '../../../brain/model.ts';

export function Home() {
  const [brain, setBrain] = useState<Brain | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [epochs, setEpochs] = useState<EpochView[]>([]);
  useEffect(() => {
    const load = () => {
      api.brain().then(setBrain).catch(() => {});
      api.health().then(setHealth).catch(() => {});
      api.epochs().then(setEpochs).catch(() => {});
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
          A 1.5-billion-parameter language model, written byte for byte onto Solana. Its 250,880 neurons are
          numbered and owned through a pump.fun token: every 3,000 tokens bought off the curve is one neuron.
          When the brain thinks, each paid message pays the neurons that fired.
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
        <p className="muted">
          Top: the Embedding, where text enters. Then 28 rows, one per layer depth, of 12 attention heads and
          35 neuron columns. Bottom: the Unembedding, where words come out. Until the reveal, a buyer knows the
          kind of part they hold but not which one. Click any slot.
        </p>
        {brain ? <BrainMap slots={brain.slots} onPick={(i) => (location.hash = `#/slot/${i}`)} /> : <p className="muted">Loading…</p>}
        {brain && <Legend revealed={brain.revealed} />}
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
