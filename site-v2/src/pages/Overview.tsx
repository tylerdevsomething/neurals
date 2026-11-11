// v2 layout preview. New wording here is DRAFT, awaiting approval.
import { navigate } from '../nav.ts';
import { useEffect, useState } from 'react';
import { api, fmt, fmtTokens, sol, type Health, type EpochView } from '../api.ts';
import { useApp } from '../App.tsx';
import { Fold } from '../ui.tsx';
import { Hud } from './Hud.tsx';
import { CURVE_SUPPLY, UNIT } from '../../../brain/model.ts';
import { LAB } from '../lab.ts';

const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export function Overview({ part = 'hero' }: { part?: 'hero' | 'info' }) {
  const { config } = useApp();
  const [health, setHealth] = useState<Health | null>(null);
  const [epochs, setEpochs] = useState<EpochView[]>([]);
  const [look, setLook] = useState('');
  // only the small health check repeats (every 10 s, and only while the tab is open). It already carries
  // tokens issued, so the 250 KB brain file isn't needed here, and the 2 MB epochs list is read again
  // only when the epoch number moves on, at most once a minute.
  useEffect(() => {
    let lastEpoch = -1, lastList = 0;
    const load = () => {
      if (document.hidden) return;
      api.health().then((h) => {
        setHealth(h);
        if (h.epoch !== lastEpoch && Date.now() - lastList > 60_000) { lastEpoch = h.epoch; lastList = Date.now(); api.epochs().then(setEpochs).catch(() => {}); }
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 10_000);
    document.addEventListener('visibilitychange', load);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, []);
  const fees = epochs.reduce((a, e) => a + sol(e.fees), 0);
  const sold = health ? health.issued / (CURVE_SUPPLY * UNIT) : 0;
  const onPump = config.pumpProgramId === PUMP_FUN;
  const isHud = (document.documentElement.dataset.theme as string) === 'hud';
  const buyHref = onPump ? `https://pump.fun/coin/${config.mint}` : '/buy';

  return (
    <>
      {part === 'hero' && (<>
      {isHud
        ? <Hud iframe={`${LAB}/?embed&theme=${document.documentElement.dataset.theme ?? 'light'}&font=${document.documentElement.dataset.font ?? ''}${document.documentElement.dataset.theme === 'paper' ? `&shape=${import.meta.env.VITE_SHAPE ?? 'network'}` : ''}${document.documentElement.dataset.variant === 'micro' ? '&variant=micro' : ''}${document.documentElement.dataset.white ? '&white=1' : ''}${document.documentElement.dataset.theme === 'hud' ? '&shape=onion' : ''}`} />
        : (
      <section className="brain-top">
            {/* the brain itself is mounted once by the app, so it can stay live in split view; this just holds its place */}
            <div className="hero-spacer" />
        </section>
        )}

      </>)}
      {part === 'info' && (<>
      <section className="defs">
        <div><b>Neuron</b><span>3,000 tokens, one piece of the brain.</span></div>
        <div><b>Slot</b><span>One of the brain's 1,318 parts, filled in buying order.</span></div>
        <div><b>Receipt</b><span>A record of which parts fired for one message. Anyone can replay it.</span></div>
      </section>

      <section className="stats">
        <div><b>{fmt(sold * 100, 2)}%</b><span>of the brain sold</span></div>
        <div><b>{health ? fmtTokens(health.issued) : '…'}</b><span>tokens issued with neurons</span></div>
        <div><b>{health?.epoch ?? '…'}</b><span>epoch</span></div>
        <div><b>{fmt(fees, 3)} SOL</b><span>paid to neurons so far</span></div>
      </section>

      <section>
        <h2>How it works</h2>
        <p className="muted">From buying the token to being paid by what fires.</p>
        <ol className="steps">
          <li><b>Buy</b><span>Buying the token gives you neurons in the next open slots.</span></li>
          <li><b>Keep earning</b><span>Your neurons earn while your balance covers them. Sell and some go dormant, buy back and they earn again.</span></li>
          <li><b>The brain thinks</b><span>Every paid message posts a receipt of which parts fired.</span></li>
          <li><b>Get paid</b><span>Each epoch the fees go to the owners of the parts that fired.</span></li>
        </ol>
        <p className="inline"><a className="btn" href={buyHref} target={onPump ? '_blank' : undefined} rel="noreferrer">{onPump ? 'Buy on pump.fun' : 'Buy neurons'}</a><a href="/rules">Read the rules</a></p>
      </section>

      <section className="cols">
        <div><h3>Neurons never die</h3><p>Sell or send tokens and some neurons go dormant, so they stop earning. Buy back and they earn again. Nothing is ever lost.</p></div>
        <div><h3>Checkpoints</h3><p>Seal neurons with their tokens into a checkpoint to sell or gift them without anything moving. Neurons in a checkpoint always keep earning.</p></div>
        <div><h3>Paid by what fires</h3><p>Every paid message posts a receipt of how much each part of the brain fired. Anyone can replay it. Owners are paid each epoch.</p></div>
      </section>

      <section>
        <h2>Questions</h2>
        <Fold q="Do I need a wallet to talk to the brain?">Yes. Each message is paid in SOL from your wallet. Looking at the brain and checking receipts needs no wallet.</Fold>
        <Fold q="Can I choose which part of the brain I buy?">No. The sale fills the slots in order, so nobody can aim a buy at a rare one. To own a particular slot, buy a checkpoint that holds it on the <a href="/market">Market</a>.</Fold>
        <Fold q="Does the AI have a memory?">No. Each message is answered on its own, with no earlier messages attached, so the network starts fresh every time. Your chat is saved in this browser only, and the receipts stay on the network either way.</Fold>
        <Fold q="What happens if I sell?">Some neurons go dormant and stop earning. The rarest keep earning longest. Buy back and they earn again.</Fold>
        <Fold q="How do I know the payouts are right?">Every receipt can be replayed on your own computer, and every payout is posted on chain as one Merkle root that anyone can rebuild.</Fold>
      </section>

      <section>
        <h2>Look up a wallet</h2>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); if (look.trim()) navigate(`/wallet/${look.trim()}`); }}>
          <input value={look} onChange={(e) => setLook(e.target.value)} placeholder="Paste a Solana address" size={46} />
          <button>[Look up]</button>
        </form>
      </section>
      </>)}
    </>
  );
}
