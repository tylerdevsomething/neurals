// Home: the landing page that sells the idea. All wording here is DRAFT, awaiting her approval.
import { useEffect, useRef } from 'react';
import { Fold } from '../ui.tsx';
import { STAGE_ICONS } from '../icons.ts';
import { LAB } from '../lab.ts';


const STAGES: [string, string, string, string][] = [
  ['Tokenizer', 'Layers 0 to 3', 'The first layers read each token against its neighbors.', 'A chip with one trace out, the point where text becomes numbers.'],
  ['Syntax', 'Layers 4 to 7', 'Attention starts tracking structure, which word modifies which.', 'A logic gate, because this stage applies the rules of a sentence.'],
  ['Semantic', 'Layers 8 to 13', 'Meaning gathers in the residual stream.', 'A hanging chain, links of meaning joined one to the next.'],
  ['Memory', 'Layers 14 to 19', 'Feed forward blocks write back what the model learned in training.', 'A neuron with branching dendrites, the parts that hold stored knowledge.'],
  ['Reasoning', 'Layers 20 to 24', 'Late layers combine what was retrieved with what you asked.', 'A lightning filament, the spark where the answer settles.'],
  ['Prediction', 'Layers 25 to 27', 'The final layers score every possible next token.', 'A cell over a row of dots, one answer chosen from many candidates.'],
];

export function Home() {
  // keep the blob told where the title panel is, so it can draw the x-ray and the white letters in exactly the right place
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const send = () => { const h = heroRef.current; if (!h) return; const f = h.querySelector('iframe'), area = h.querySelector<HTMLElement>('.home-panel2-title'), tp = h.querySelector<HTMLElement>('.home-panel2-title h1'); if (!f || !area || !tp) return;
      const fr = f.getBoundingClientRect(), r = area.getBoundingClientRect(), tr = tp.getBoundingClientRect(), cs = getComputedStyle(tp);
      const title = { x: tr.left - fr.left, y: tr.top - fr.top, w: tr.width, h: tr.height, lines: tp.innerHTML.split(/<br\s*\/?>/i).map((x) => x.replace(/<[^>]+>/g, '').trim().toUpperCase()), size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize), ls: parseFloat(cs.letterSpacing) || 0 };
      f.contentWindow?.postMessage({ panel: { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height }, title }, '*'); };
    // the hero runs edge to edge: from the sidebar's line to the right edge of the window, so the blob bounces off the sidebar line itself
    const fit = () => { const side = document.querySelector('.side'); if (!side) return; const sr = side.getBoundingClientRect().right;
      document.querySelectorAll<HTMLElement>('.home-hero2, .home-bleed').forEach((h) => { const parent = h.parentElement!.getBoundingClientRect(); h.style.setProperty('margin-left', `${sr - parent.left}px`, 'important'); h.style.setProperty('width', `${document.documentElement.clientWidth - sr}px`, 'important'); }); };
    // the little neurons between the paragraphs stay hidden until the visitor has started scrolling, then fade in as they come into view
    // each little neuron drops from the dotted line under the hero when you scroll it into view: it falls, overshoots its spot a little, then floats gently back
    const reveal = () => { if (scrollY < 40) return; const line = heroRef.current?.getBoundingClientRect().bottom ?? 0;
      document.querySelectorAll<HTMLElement>('.home-spin:not(.show)').forEach((n) => { const r = n.getBoundingClientRect(); if (r.top < innerHeight - 30) { const src = n.dataset.from ? document.querySelector(n.dataset.from)?.getBoundingClientRect().bottom ?? line : line; n.style.setProperty('--from', `${Math.min(-40, src - r.top)}px`); n.classList.add('show'); } }); };
    addEventListener('scroll', reveal, { passive: true });
    fit(); const t = setInterval(() => { fit(); send(); }, 400); addEventListener('resize', send); addEventListener('scroll', send, { passive: true });
    return () => { clearInterval(t); removeEventListener('resize', send); removeEventListener('scroll', send); removeEventListener('scroll', reveal); };
  }, []);
  return (
    <section className="home">
      {/* hero: the network's water bouncing round behind a white panel; where it passes behind the title its shape shows in cobalt and the letters turn white */}
      <div className="home-hero2" ref={heroRef}>
        <iframe className="home-blob" src={`${LAB}/blob.html?bounce`} title="The network's water, bouncing" />
        <div className="home-panel2">
          <div className="home-panel2-title"><h1>A rarity system<br />for neural networks</h1></div>
          <div className="home-panel2-terms">
            <div><b>Neurals</b><span>The rules that make the parts of a real model ownable.</span></div>
            <div><b>Neurons</b><span>3,000 tokens, one piece of the network.</span></div>
            <div><b>Receipts</b><span>A record of which parts fired.</span></div>
          </div>
        </div>
      </div>

      {/* the idea, one centred paragraph */}
      <div className="home-essay">
        <p className="home-essay-lead home-essay-until">A large language model is not one thing, it is more than 1 billion numbers arranged in layers. Until now…</p>
        <iframe className="home-spin" src={`${LAB}/neuron.html?s=3&a=3`} title="" aria-hidden="true" tabIndex={-1} />
        <p>nobody could point to a part of a model and say it was theirs. Neurals introduces a rarity system for neural networks using Qwen as its first experiment, on Solana.</p>
        <iframe className="home-spin" src={`${LAB}/neuron.html?s=7&c=pink&a=4`} title="" aria-hidden="true" tabIndex={-1} />
        <p>Every message to the network measures exactly which parts fired, posts a receipt anyone can audit, and pays their owners.</p>
        <iframe className="home-spin" src={`${LAB}/neuron.html?s=11&c=cobalt&a=6`} title="" aria-hidden="true" tabIndex={-1} />
        <span className="home-cta-label">See it live</span>
        <a className="home-cta" href="#/network">[Enter the network]</a>
      </div>

      {/* the six stages as a grid that runs edge to edge: each stage's symbol top centre, its text below */}
      <div className="home-bleed home-gridhead"><div className="home-gridhead-box">28 layers, 6 stages</div></div>
      <div className="home-layergrid home-bleed">
        {STAGES.map(([name, layers, what, why], i) => (
          <div key={name} className="home-lg-cell">
            <i className="home-lg-ic" dangerouslySetInnerHTML={{ __html: STAGE_ICONS[i][1].replace('width="16" height="16"', 'width="24" height="24"') }} />
            <b>{name}</b>
            <span className="home-lg-range">{layers}</span>
            <p>{what}</p>
            <p className="home-lg-why">{why}</p>
          </div>
        ))}
      </div>
      <div className="home-key home-bleed">
        <span><i style={{ background: '#ff3fa4' }} />Yours</span>
        <span><i style={{ background: '#a3135f' }} />Bought</span>
        <span><i style={{ background: '#0b1f6b' }} />Available</span>
        <p>In the network each stage is color coded. A part fades toward white the less it fires, so the paler a part, the quieter it has been.</p>
      </div>

      {/* how it works: open space, a dotted line winding down through the four steps, left and right */}
      <div className="home-bleed home-path-wrap"><h2 className="home-grid-title">How it works</h2><div className="home-path">
        <svg className="home-path-line" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <path d="M500 0 V60 H250 V125 V250 H750 V375 V500 H250 V625 V750 H750 V875 V940 H500 V1000" />
        </svg>
        {[['Buy', 'Buying the token gives you neurons in the next open slots.'], ['Keep earning', 'Neurons earn only while you hold the tokens behind them. Sell and the most common ones stop first.'], ['The network thinks', 'Every paid message posts a receipt of which parts fired.'], ['Get paid', 'Each epoch the fees go to the owners of the parts that fired.']].map(([t, d], i) => (
          <div key={t} className={`home-path-step ${i % 2 ? 'right' : 'left'}`} style={{ top: `${12.5 + i * 25}%` }}>
            <span className="home-path-n">[{i + 1}]</span>
            <div className="home-path-text"><b>{t}</b><p>{d}</p></div>
          </div>
        ))}
        <span className="home-path-tail" aria-hidden="true" /><span className="home-path-label">Go deeper</span><a className="home-path-end home-path-docs" aria-disabled="true" onClick={(e) => e.preventDefault()}>[Read our docs]</a>
      </div>
      </div>

      <div className="home-section">
        <h2>Network audit trail</h2>
        <p className="home-sub">Proof for the model, its traits and every payout.</p>
        {/* stacked and centred; the first one shows the real read-back command and what it prints */}
        <div className="home-checks2">
          <div className="home-check2 home-check2-code"><pre className="home-code"><span className="c-dim">$</span> node tools/readback.ts --rpc &lt;url&gt; --writer 3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH qwen2.5-1.5b-instruct-q4_k_m.gguf{'\n\n'}verified qwen2.5-1.5b-instruct-q4_k_m.gguf: all 1,163,876 chunks on chain match the local file{'\n\n'}read-back: every file matches</pre>
            <a className="home-code-link" href="https://solscan.io/account/3d6VFWZK9dyvTqYGjHpEwPCbxsNXFbNuBLFUznq2HwDH" target="_blank" rel="noreferrer">Model writer on Solscan 3d6VFW…q2HwDH<span className="go"><svg viewBox="0 0 14 14" width="11" height="11"><path d="M4 10 L10 4 M5 4 H10 V9" /></svg></span></a>
          </div>
          <div className="home-check2"><b>The model on chain</b><p>1,163,876 chunks of the model were written to mainnet, then read back and compared with the original file. Zero mismatches.</p></div>
          <div className="home-check2"><b>Traits measured, not drawn</b><p>Five traits were measured on the exact inscribed weights, from Super Weights to Induction Heads, and committed before launch.</p></div>
          <div className="home-check2"><b>Replay to verify</b><p>Each receipt replays in your browser with the same WebAssembly build, and every share must land within a small tolerance.</p></div>
        </div>
      </div>

      {/* live close-ups of the network sliding past, entering right and leaving left; it divides the audit trail from more information */}
      <div className="home-bleed home-strip"><iframe src={`${LAB}/?embed&theme=paper&white=1&compare&strip`} title="Close-ups of the live network" /><a className="strip-link" href="#/network" aria-label="Open the Qwen network" /></div>
      {/* how the network is drawn: two short paragraphs, centred like the essay (DRAFT wording) */}
      <div className="home-essay home-render">
        <p>The neural network you see is a live 3D simulation, rendered in your browser with WebGL. Every one of its 1,318 parts sits at its real layer and stage, in 28 rings from the tokenizer at the top to prediction at the bottom.</p>
        <iframe className="home-spin home-spin-bundle" data-from=".home-strip" src={`${LAB}/neuron.html?bundle&c=pink`} title="" aria-hidden="true" tabIndex={-1} />
        <p>Its colors come directly from the chain. Each part is shaded by how hard it has fired, pink marks the parts you own, and every close-up is its own virtual camera pointed at a real part of the model.</p>
      </div>
      <div className="home-bleed home-divider" />
      <div className="home-section home-section-narrow">
        <h2 className="home-grid-title">More information</h2>
        <p className="home-sub">Quick answers on neurons, fees, traits and receipts.</p>
        <div className="home-faq">
          <Fold q="Do I need a wallet to talk to the network?">Yes. Each message is paid in SOL from your wallet. Looking at the network and checking receipts is free.</Fold>
          <Fold q="Can I choose which part of the network I buy?">No. The sale fills the slots in order, and the reveal decides at random which real part each slot becomes, so nobody can aim a buy at a rare one.</Fold>
          <Fold q="Does the AI have a memory?">No. Each message is answered on its own, with no earlier messages attached, so the network starts fresh every time. Your chat is saved in this browser only, and the receipts stay on the network either way.</Fold>
          <Fold q="What happens if I sell?">Some neurons go dormant and stop earning. The rarest keep earning longest. Buy back and they earn again.</Fold>
          <Fold q="How do I know the payouts are right?">Every receipt can be replayed on your own computer, and every payout is posted on chain each epoch.</Fold>
          <Fold q="What exactly is a neuron?">3,000 tokens. In a neuron column that is one MLP neuron of the model. Attention heads, the embedding and the unembedding are sold by the token too, counted in the same units.</Fold>
          <Fold q="Which model is it?">Qwen2.5 1.5B Instruct, with 28 layers and 12 attention heads per layer, written to Solana mainnet in 1,163,876 chunks.</Fold>
          <Fold q="What does it mean for a part to fire?">When the network answers a message, the activations of every part are measured. How hard a part fired is its share of that measurement, recorded in the receipt.</Fold>
          <Fold q="How are the fees split?">By how hard each part fired. Neuron columns share 94.9% of every fee, attention heads 4.24%, and the embedding and unembedding 0.43% each.</Fold>
          <Fold q="How often are owners paid?">Every epoch, which is one hour. The fees from that hour go to the owners of the parts that fired.</Fold>
          <Fold q="What are traits?">Five rare properties measured on the real weights, such as Super Weights and Induction Heads. A trait multiplies that part's share of every fee, up to 2x.</Fold>
          <Fold q="When is it decided which part I own?">After the sale. A future block's hash shuffles the real heads and columns into their slots, so nobody can predict or aim at a part.</Fold>
          <Fold q="What is a checkpoint?">Neurons sealed with their tokens, so they can be listed, sold or gifted without the tokens moving. Neurons in a checkpoint always stay active. The market fee is 1.5%.</Fold>
          <Fold q="What is in a receipt?">The model's hash, the prompt and reply tokens, and the share of all 1,318 parts. It is hashed and posted on chain with the fee payment.</Fold>
          <Fold q="Where can I see the parts I own?">On the My neurons page, and in pink inside the network itself.</Fold>
        </div>
      </div>
      <p className="home-copy">© 2026 Neurals</p>
    </section>
  );
}
