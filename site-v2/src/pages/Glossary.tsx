// v2 layout preview. Definitions are DRAFT, awaiting approval.
import { useState } from 'react';
import { PageHead } from '../ui.tsx';

const TERMS: [string, string][] = [
  ['Activation', 'How strongly a part responds to the text passing through it. Receipts measure it.'],
  ['Active', 'A neuron your token balance covers. Only active neurons earn.'],
  ['Attention head', 'A part of each layer that decides which earlier tokens matter for the next one. The network has 336, twelve in each layer.'],
  ['Attention Sink', 'A trait. A head that parks attention on the first token to keep the model stable. 50 points.'],
  ['Audit', 'Running a message through the model again on your own computer to check its receipt matches.'],
  ['Bonding curve', 'The pump.fun sale. The price rises as tokens are bought and falls as they are sold.'],
  ['Carry', 'Sending tokens to another wallet with their neurons. A plain transfer moves tokens only.'],
  ['Chain', 'Short for blockchain. Here it means Solana.'],
  ['Checkpoint', 'Neurons sealed with their tokens so they can be listed, sold or gifted without anything moving.'],
  ['Close up', 'A virtual camera in the 3D network pointed at one real part of the model.'],
  ['Cryptocurrency', 'Digital money recorded on a blockchain instead of by a bank. SOL is the cryptocurrency of Solana.'],
  ['Embedding', 'The part where text enters the network. It turns each token into a list of numbers.'],
  ['Epoch', 'One round of payouts. Fees from the epoch go to the neurons held active for all of it.'],
  ['Fee', 'The SOL paid for each message to the network. It is split between the parts that fired.'],
  ['Feed forward block', 'The MLP in each layer, where most of what the model learned in training is stored.'],
  ['Fired', 'A part fired when it responded to a message. The harder it fired, the bigger its share.'],
  ['GGUF', 'The file format of the model on chain, qwen2.5 1.5b instruct, quantized to q4_k_m.'],
  ['Holder', 'A wallet that holds the token. Holders own the neurons their balance covers.'],
  ['Inactive', 'A neuron your balance no longer covers. It stops earning until you buy back.'],
  ['Induction Head', 'A trait. The circuit that spots a pattern in the text and continues it. 85 points.'],
  ['Inference', 'Running the model to get an answer. Every paid message is one inference.'],
  ['Large language model', 'A neural network trained on huge amounts of text to predict the next token. Qwen is one.'],
  ['Layer', 'One step of the network. Text passes through all 28 in order, each with attention heads and a feed forward block.'],
  ['Listing', 'A checkpoint put up for sale on the market at a fixed price in SOL.'],
  ['Market fee', '1.5% of every market sale, paid by the seller.'],
  ['Massive Activation', 'A trait. A neuron firing thousands of times harder than typical. 70 points.'],
  ['Memory', 'The stage at layers 14 to 19, where feed forward blocks write back what the model learned in training.'],
  ['Merkle root', 'One short fingerprint of every payout in an epoch, posted on chain. Anyone can rebuild it.'],
  ['MLP', 'Multilayer perceptron. The feed forward block of a layer, made of neurons.'],
  ['Model weights', 'The numbers a model learned in training. Qwen 1.5B has about 1.5 billion of them.'],
  ['Monosemantic', 'A trait. A neuron that responds to one clear thing. 30 points.'],
  ['Neural network', 'Layers of numbers that turn an input into an output. Trained on examples, not written by hand.'],
  ['Neuron', '3,000 tokens. In a neuron column that is exactly one MLP neuron.'],
  ['Neuron column', 'A group of 256 MLP neurons. The network has 980, thirty five in each layer.'],
  ['Parameter', 'Another word for a model weight.'],
  ['Part', 'One of the 1,318 pieces sold. A head, a neuron column, the embedding or the unembedding.'],
  ['Parts per million', 'How receipts count firing. A part with 10,000 ppm took 1% of a message.'],
  ['Payout', 'The SOL sent to owners at the end of each epoch.'],
  ['Prediction', 'The stage at layers 25 to 27, where the final layers score every possible next token.'],
  ['pump.fun', 'The Solana launchpad where the token was sold on a bonding curve.'],
  ['Quantized', 'Stored with fewer bits per weight so the model is smaller. Ours is q4_k_m.'],
  ['Qwen', 'The open model family from Alibaba. Neurals uses Qwen2.5 1.5B Instruct as its first case study.'],
  ['Rarity', 'How rare a part is, from its trait points. Rarer parts earn more and keep earning longest.'],
  ['Reasoning', 'The stage at layers 20 to 24, where late layers combine what was retrieved with what you asked.'],
  ['Receipt', 'A record of how much each part fired for one paid message, in parts per million.'],
  ['Residual stream', 'The running total of numbers each layer reads from and adds to.'],
  ['Reveal', 'The moment a future block decides which real part each slot holds.'],
  ['Semantic', 'The stage at layers 8 to 13, where meaning gathers in the residual stream.'],
  ['Slot', 'One of the 1,318 places the sale fills in buying order.'],
  ['SOL', 'The cryptocurrency of Solana. Fees and prices are in SOL.'],
  ['Solana', 'The blockchain Neurals runs on. The model, receipts and payouts are all on it.'],
  ['Solscan', 'A public website for looking up any Solana wallet or transaction.'],
  ['Stage', 'A group of layers with one job. The network has six, from Tokenizer to Prediction.'],
  ['Super Weight', 'A trait. One of the largest outlier weights in the model, hundreds of times bigger than those around it. 100 points.'],
  ['Syntax', 'The stage at layers 4 to 7, where attention tracks which word modifies which.'],
  ['Token', 'Two meanings. The Neurals token you buy on pump.fun, and a piece of a word the model reads.'],
  ['Tokenizer', 'The stage at layers 0 to 3, where the first layers read each token against its neighbors.'],
  ['Trait', 'A measured property of a part, like Super Weight or Induction Head. It earns a bonus.'],
  ['Unembedding', 'The part where words come out of the network. It turns numbers back into a next token.'],
  ['Wallet', 'An app like Phantom that holds your SOL and tokens and signs your transactions.'],
];

export function Glossary() {
  const [q, setQ] = useState('');
  const shown = TERMS.filter(([t, d]) => (t + d).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="glossary-page">
      <PageHead title="Glossary" sub="Every key term in Neurals, A to Z." />
      <div className="panel glossary">
        <input className="wide" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the glossary" />
        {shown.length === 0 && <p className="muted">Nothing matches "{q}".</p>}
        {[...new Set(shown.map(([t]) => t[0]))].map((letter) => (
          <div key={letter} className="glossary-group">
            <span className="glossary-letter">[{letter}]</span>
            <dl>{shown.filter(([t]) => t[0] === letter).map(([t, d]) => <div key={t} className="glossary-row"><dt>{t}</dt><dd className="muted">{d}</dd></div>)}</dl>
          </div>
        ))}
      </div>
      <p className="home-copy">© 2026 Neurals</p>
    </section>
  );
}
