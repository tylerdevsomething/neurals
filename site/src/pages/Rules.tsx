import { TOKENS } from '../../../brain/model.ts';
import { fmt } from '../api.ts';

export function Rules() {
  return (
    <section className="rules">
      <h1>How it works</h1>

      <h2>Neurons and slots</h2>
      <p>
        pump.fun's curve sells 793,100,000 tokens. Every 3,000 tokens bought off the curve is one MLP neuron of the brain.
        The sale fills 1,318 slots in buying order:
      </p>
      <table>
        <thead><tr><th>Slot</th><th>Count</th><th>Tokens each</th></tr></thead>
        <tbody>
          <tr><td>Embedding: where text enters</td><td>1</td><td>{fmt(TOKENS.embedding)}</td></tr>
          <tr><td>Attention head</td><td>336</td><td>{fmt(TOKENS.head)}</td></tr>
          <tr><td>Neuron column (256 neurons)</td><td>980</td><td>{fmt(TOKENS.column)}</td></tr>
          <tr><td>Unembedding: where words come out</td><td>1</td><td>{fmt(TOKENS.unembedding)}</td></tr>
        </tbody>
      </table>
      <p>
        After the sale, a future block's hash shuffles the real heads and columns into the slots of their kind. So the
        traits below are known before launch, but nobody can aim a buy at one.
      </p>

      <h2>Traits are measured, not drawn</h2>
      <table>
        <thead><tr><th>Trait</th><th>What it is</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>Super Weight</td><td>one of the model's largest outlier weights: hundreds of times bigger than the weights around it</td><td>100</td></tr>
          <tr><td>Induction Head</td><td>the circuit that spots a pattern in the context and continues it</td><td>85</td></tr>
          <tr><td>Massive Activation</td><td>a neuron firing thousands of times harder than typical</td><td>70</td></tr>
          <tr><td>Attention Sink</td><td>a head that parks attention on the first token to keep the model stable</td><td>50</td></tr>
          <tr><td>Monosemantic</td><td>a neuron that responds to one clear thing</td><td>30</td></tr>
        </tbody>
      </table>
      <p>A published tool measures them on the exact inscribed model. Anyone can rerun it. A part with a trait earns a bonus: (100 + points)/100 times its share, within its kind's budget.</p>

      <h2>Neurons never die</h2>
      <ul>
        <li>Your neurons are awake as far as your token balance covers them, rarest first. Sell some tokens and some neurons go dormant; buy back and they wake.</li>
        <li><b>Checkpoints</b> freeze neurons with their tokens. Neurons in a checkpoint are always awake, and a checkpoint can be listed, sold or gifted without anything moving. Withdrawing returns everything.</li>
        <li><b>Carry</b> sends tokens with their neurons to another wallet. A plain transfer or swap moves tokens only.</li>
      </ul>

      <h2>Paid by what fires</h2>
      <ul>
        <li>Each paid message posts a receipt: how much each of the 1,318 parts fired, in parts per million. The receipt is measured by a canonical replay that anyone can run.</li>
        <li>Each kind of part gets a fixed share of every fee by the tokens it was sold for; within a kind, by how much each part fired.</li>
        <li>Once per epoch, fees go to the neurons held awake for the whole epoch, at each wallet's lowest balance of the epoch. Dormant neurons' shares go to the awake ones.</li>
        <li>Payouts are posted on chain as one Merkle root and pushed to every owner. Anyone can rebuild the root from the public ledger.</li>
      </ul>
    </section>
  );
}
