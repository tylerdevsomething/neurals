import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../nav.ts';
import { PublicKey } from '@solana/web3.js';
import { api, fmt, fmtTokens, neurons, short, sol, UNIT, type Brain, type WalletView } from '../api.ts';
import { useApp, askConnect } from '../App.tsx';
import { Modal, PageHead, Loading, NeuronCount } from '../ui.tsx';
import { refreshWhenIndexed, send, useWallet } from '../chain.ts';
import { slotLabel } from '../BrainMap.tsx';
import { NeuronPfp } from './Market.tsx';
import { stageIcon } from '../icons.ts';
import { SLOTS } from '../../../brain/layout.ts';
import { intersect, normalize, takeRarest, total, type Range } from '../../../brain/ranges.ts';
import { parseCheckpoint, parseConfig } from '../../../brain/accounts.ts';
import { claimedBits } from './claimed.ts';

const STAGE_RANGE: Record<string, string> = { tokenizer: '0 to 3', syntax: '4 to 7', semantic: '8 to 13', memory: '14 to 19', reasoning: '20 to 24', prediction: '25 to 27' };

type OnChain = { listed: boolean; price: bigint } | null;

export function WalletPage({ address: routeAddress }: { address: string | null }) {
  const { conn, accounts, config } = useApp();
  const me = useWallet();
  /* #/wallet/simulate: your page as it would look holding neurons loose in your wallet and in a checkpoint, made up data, nothing on chain */
  const sim = location.pathname.endsWith('/wallet/simulate');
  const address = sim ? (me ?? '9WPNsimu1atedWa11etAddressXXXXXXXXXXXXP3KM') : routeAddress;
  const [view, setView] = useState<WalletView | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [chain, setChain] = useState<Record<string, OnChain>>({});
  const [claimed, setClaimed] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [sell, setSell] = useState('');
  const [pop, setPop] = useState<{ kind: 'List' | 'Gift' | 'Withdraw' | 'Seal'; cp: string; slot?: number; max?: number } | null>(null);
  const [field, setField] = useState('');
  const [look, setLook] = useState('');
  /* #/wallet/<address>/preview shows the owner view of any wallet, for design checks only: buttons still need that wallet connected to sign */
  const preview = location.pathname.endsWith('/preview');
  const own = !!address && (address === me || preview || sim);
  const mint = new PublicKey(config.mint);

  const load = () => {
    if (!address) return;
    if (sim) {
      const a = SLOTS[21].start, part = { index: 1295, kind: 'column', layer: 27, within: 13, stage: 'Prediction layers', points: 0, trait: null };
      setView({ wallet: address, balance: 6000 * UNIT, positions: [[a, a + 6000 * UNIT]], awake: [[a, a + 6000 * UNIT]],
        slots: [{ slot: 21, amount: 6000 * UNIT, awake: 6000 * UNIT, part }],
        checkpoints: [{ checkpoint: 'CNJjSimu1atedCheckpointXXXXXXXXXXXXXXXX1tf5', holder: address, positions: [[a + 6000 * UNIT, a + 12000 * UNIT]] }, { checkpoint: '7QpRSimu1atedCheckpointXXXXXXXXXXXXXXXX9wLm', holder: address, positions: [[SLOTS[400].start, SLOTS[400].start + 9000 * UNIT]] }],
        payouts: [{ epoch: 1777, index: 0, amount: '1000', proof: [] }, { epoch: 1778, index: 0, amount: '2500', proof: [] }] } as unknown as WalletView);
      setChain({ CNJjSimu1atedCheckpointXXXXXXXXXXXXXXXX1tf5: { listed: false, price: 0n }, '7QpRSimu1atedCheckpointXXXXXXXXXXXXXXXX9wLm': { listed: true, price: 8_000_000_000n } });
      setClaimed({ 1777: true, 1778: true });
      api.brain().then(setBrain).catch(() => {});
      return;
    }
    api.wallet(address).then(async (v) => {
      setView(v);
      const infos = await conn.getMultipleAccountsInfo(v.checkpoints.map((c) => new PublicKey(c.checkpoint)));
      setChain(Object.fromEntries(v.checkpoints.map((c, i) => [c.checkpoint, infos[i] ? parseCheckpoint(Buffer.from(infos[i]!.data)) : null])));
      const epochs = [...new Set(v.payouts.map((p) => p.epoch))];
      const eInfos = await conn.getMultipleAccountsInfo(epochs.map((e) => accounts.epoch(e)));
      const out: Record<number, boolean> = {};
      v.payouts.forEach((p) => {
        const bits = claimedBits(eInfos[epochs.indexOf(p.epoch)]?.data);
        out[p.epoch] = !!bits && !!(bits[p.index >> 3] & (1 << (p.index & 7)));
      });
      setClaimed(out);
    }).catch((e) => setMsg(e.message));
    api.brain().then(setBrain).catch(() => {});
  };
  useEffect(load, [address, sim, preview]);

  const points = useMemo(() => (slot: number) => brain?.slots[slot]?.part?.points ?? 0, [brain]);
  if (!address) {
    return (
      <section>
        <PageHead title="My neurons" sub="Connect your wallet to see and manage your neurons." />
        <div className="split even">
        <div className="panel">
          <h3>Connect your wallet</h3>
          <p>See the parts of the brain you own, seal them into checkpoints and collect what they earn.</p>
          <button onClick={askConnect}>[Connect wallet]</button>
        </div>
        <div className="panel">
          <h3>Look up a wallet</h3>
          <form className="inline" onSubmit={(e) => { e.preventDefault(); if (look.trim()) navigate(`/wallet/${look.trim()}`); }}>
            <input value={look} onChange={(e) => setLook(e.target.value)} placeholder="Paste a Solana address" />
            <button className="ghost">[Look up]</button>
          </form>
        </div>
        </div>
      </section>
    );
  }
  if (!view) return msg ? <p className="muted">{msg}</p> : <Loading />;

  const held = total(view.positions);
  const awake = total(view.awake);
  const sellBase = Math.max(0, Math.round(Number(sell || 0) * UNIT));
  const afterSale = takeRarest(view.positions, Math.max(0, Math.min(view.balance - sellBase, held)), points);
  const sleeping = awake - total(afterSale);

  const act = async (what: string, fn: () => Promise<string>) => {
    if (sim || preview) { setMsg(`${what}: this is a ${sim ? 'simulation' : 'preview'}, nothing was sent.`); return; }
    setBusy(what);
    setMsg('');
    try {
      const sig = await fn();
      setMsg(`${what}: done (${short(sig)}). Updating…`);
      await refreshWhenIndexed(conn, sig, load);
      setMsg(`${what}: done (${short(sig)}).`);
    } catch (e) {
      setMsg(`${what}: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  /** The first `amount` base units of this wallet's awake positions in a slot. */
  const awakeIn = (slot: number, amount: number): Range[] => {
    const s = SLOTS[slot];
    const mine = intersect(view.awake, [[s.start, s.end]]);
    return takeRarest(mine, Math.min(amount, total(mine)), () => 0);
  };

  const seal = (slot: number, amountTokens: number) => act('Seal', async () => {
    const cfg = parseConfig(Buffer.from((await conn.getAccountInfo(accounts.config()))!.data));
    const positions = normalize(awakeIn(slot, Math.round(amountTokens * UNIT)));
    const amount = total(positions);
    if (!amount) throw new Error('no active neurons in that slot');
    return send(conn, [accounts.seal({ owner: new PublicKey(address), mint, nextId: cfg.nextId, positions, amount })]);
  });

  const carry = (to: string, slot: number, amountTokens: number) => act('Carry', async () => {
    const positions = normalize(awakeIn(slot, Math.round(amountTokens * UNIT)));
    const amount = total(positions);
    if (!amount) throw new Error('no active neurons in that slot');
    return send(conn, [accounts.carry({ from: new PublicKey(address), to: new PublicKey(to), mint, positions, amount })]);
  });

  return (
    <section>
      {(
        <>
        <a className="back-link" href="/market"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3 L5 7 L9 11" /></svg>{own ? 'View the market' : 'Back to market'}</a>
        <div className={`wallet-head ${own ? 'is-own' : ''}`}>
          <span className="profile-tag">{own ? 'Your profile' : 'Seller profile'}</span>
          <div className="seller-row wallet-who">
            <span className="avatar" aria-hidden><NeuronPfp seed={address} alt={false} color={own ? '#ff3fa4' : undefined} /></span>
            <span className="seller-who"><span className="wallet-addr">{short(address)}<a className="seller-go" data-tip="Solscan wallet" href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" aria-label="Solscan wallet"><svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 10 L10 4 M5 4 H10 V9" /></svg></a></span><span>{own ? (sim ? 'Your wallet, simulated' : preview ? 'Your wallet, preview' : 'Your wallet, connected') : 'Wallet, viewing only'}</span></span>
          </div>
          <div className="stat-box">
            <div><strong>{fmt(neurons(held + view.checkpoints.reduce((a, c) => a + total(c.positions), 0)), 2)}</strong><span>Total neurons</span></div>
            <div><strong>{fmt(neurons(held), 2)}</strong><span>In wallet</span></div>
            <div><strong>{fmt(neurons(view.checkpoints.reduce((a, c) => a + total(c.positions), 0)), 2)}</strong><span>In checkpoints</span></div>
            {own && <div><strong>{fmt(sol(view.payouts.filter((p) => !claimed[p.epoch]).reduce((a, p) => a + Number(p.amount), 0)), 4)}</strong><span>SOL to claim</span></div>}
          </div>
        </div>
        </>
      )}
      {msg && <p className="note">{msg}</p>}

      <div className="wallet-grid">
      <section className="wallet-sec ws-neurons"><h2 className="cons-title wallet-title" data-tip={own ? `Neurons held loose in your wallet. They earn while your balance of ${fmtTokens(view.balance)} tokens covers them. Seal any into a checkpoint to sell or gift it.` : 'Neurons held loose in this wallet. They earn while its token balance covers them.'}>In wallet<sup className="wallet-count">{view.slots.length}</sup></h2>
        {view.slots.length === 0 ? <p className="empty-line">{view.checkpoints.length ? 'None loose in this wallet. Its neurons are sealed in the checkpoints below.' : 'No neurons yet. Neurons come only from buying off the curve.'}</p> : (
          <div className="cards">
            {view.slots.map((s) => (
              <article key={s.slot} className="card post">
                
                <dl className="post-details">
                  <dt>Kind</dt><dd><a href={`/slot/${s.slot}`}>{s.part?.kind === 'head' ? 'Attention head' : s.part?.kind === 'embedding' ? 'Embedding' : s.part?.kind === 'unembedding' ? 'Unembedding' : 'Neuron column'}</a></dd>
                  <dt>Part</dt><dd>{s.part ? fmt(s.part.index) : '…'}</dd>
                  <dt>Stage</dt><dd className="stage-dd"><span className="stage-chip"><i className="stage-box" dangerouslySetInnerHTML={{ __html: stageIcon(s.part?.stage ?? '') ?? '' }} /><b>{(s.part?.stage ?? 'Before the reveal').replace(/ layers$/i, '')} {STAGE_RANGE[(s.part?.stage ?? '').split(' ')[0].toLowerCase()] ?? ''}</b></span></dd>
                  <dt>Layer</dt><dd>{s.part?.layer ?? '…'}</dd>
                  <dt>{s.part?.kind === 'head' ? 'Head' : 'Column'}</dt><dd>{s.part?.within ?? '…'}</dd>
                  <dt>Neurons</dt><dd><NeuronCount n={neurons(s.amount)} /></dd>
                  <dt>Tokens</dt><dd>{fmtTokens(s.amount)}</dd>
                  <dt>Active</dt><dd>{s.awake >= s.amount ? 'All' : fmtTokens(s.awake)}</dd>
                </dl>
                {s.part && <a className="pin-btn" href={`/network/part/${s.part.index}`}>[Show me in the network]</a>}
                {own && s.awake > 0 && <button className="wide seal-btn" disabled={!!busy} onClick={() => { setField(''); setPop({ kind: 'Seal', cp: '', slot: s.slot, max: s.awake / UNIT }); }}>[Seal into a checkpoint]</button>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="wallet-sec ws-checkpoints"><h2 className="cons-title wallet-title" data-tip={own ? 'Neurons sealed with their tokens into bundles. List, gift or withdraw them without anything moving.' : 'Neurons sealed with their tokens into bundles. Listed ones are for sale on the market.'}>In checkpoints<sup className="wallet-count">{view.checkpoints.length}</sup></h2>
        {view.checkpoints.length === 0 ? <p className="empty-line">None yet. Seal neurons from your wallet into a checkpoint to make one.</p> : (
          <div className="cards">
            {view.checkpoints.map((c) => {
              const st = chain[c.checkpoint];
              const cp = new PublicKey(c.checkpoint);
              const holder = new PublicKey(address);
              return (
                <article key={c.checkpoint} className="card post">
                  
                  <dl className="post-details">
                    <dt>Checkpoint</dt><dd>{short(c.checkpoint)}</dd>
                    {st?.listed && <><dt>Price</dt><dd>{sol(st.price)} SOL</dd></>}
                    <dt>Neurons</dt><dd><NeuronCount n={neurons(total(c.positions))} /></dd>
                    <dt>Holds</dt><dd className="cp-holds">{SLOTS.map((sl, idx) => ({ idx, amt: total(intersect(c.positions, [[sl.start, sl.end]])) })).filter((x) => x.amt > 0).map(({ idx, amt }) => { const pt = brain?.slots[idx]?.part; return (
                      <div key={idx} className="cp-part">
                        <span className="stage-chip"><i className="stage-box" dangerouslySetInnerHTML={{ __html: stageIcon(pt?.stage ?? '') ?? '' }} /><b>{(pt?.stage ?? 'Before the reveal').replace(/ layers$/i, '')}</b></span>
                        <span>{pt && pt.layer !== null ? `Layer ${pt.layer}, ${pt.kind === 'head' ? 'head' : 'column'} ${pt.within}` : pt?.kind ?? `Slot ${idx}`}</span>
                        <span className="cp-amt">{fmt(neurons(amt), 2)}</span>
                      </div>); })}
                  </dd>
                    <dt>Status</dt><dd>{st ? (st.listed ? `Listed at ${sol(st.price)} SOL` : 'Held') : '…'}</dd>
                  </dl>

                  {own && st && (
                    <div className="card-foot">
                      {st.listed
                        ? <button className="wide cancel-listing" disabled={!!busy} onClick={() => act('Cancel', () => send(conn, [accounts.cancel(holder, cp)]))}>[Cancel listing]</button>
                        : <>
                          <button disabled={!!busy} onClick={() => { setField(''); setPop({ kind: 'List', cp: c.checkpoint }); }}>[List]</button>
                          <button className="ghost" disabled={!!busy} onClick={() => { setField(''); setPop({ kind: 'Gift', cp: c.checkpoint }); }}>[Gift]</button>
                          <button className="ghost" disabled={!!busy} onClick={() => setPop({ kind: 'Withdraw', cp: c.checkpoint })}>[Withdraw]</button>
                        </>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="wallet-sec ws-earnings"><h2 className="cons-title wallet-title" data-tip={own ? 'What your neurons earned each epoch. Payouts are pushed to you, and anything not yet paid can be claimed here.' : 'What this wallet earned each epoch.'}>Earnings<sup className="wallet-count">{view.payouts.length}</sup></h2>
        {view.payouts.length > 0 && <EarnChart payouts={view.payouts} />}
        {view.payouts.length === 0 ? <p className="empty-line">No payouts yet. Neurons earn from the first full epoch they are held active.</p> : (
          <table>
            <thead><tr><th>Epoch</th><th>Payout</th><th>Status</th></tr></thead>
            <tbody>
              {view.payouts.map((p) => (
                <tr key={p.epoch}>
                  <td>{p.epoch}</td>
                  <td>{fmt(sol(p.amount), 6)} SOL</td>
                  <td>{claimed[p.epoch] ? 'Paid' : <button disabled={!!busy || !me} onClick={() => act('Claim', () => send(conn, [accounts.claim({ payer: new PublicKey(me!), wallet: new PublicKey(address), epoch: p.epoch, index: p.index, amount: BigInt(p.amount), proof: p.proof.map((h) => Buffer.from(h, 'hex')) })]))}>[Claim]</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {own && held > 0 && <section className="wallet-sec ws-tools"><h2 className="cons-title wallet-title" data-tip="Check what happens before you sell, and move neurons to another wallet.">Your tools</h2>
        {own && held > 0 && (
          <div className="split even tools">
            <div className="panel tool"><h3 className="tool-title" data-tip="Neurons only earn while your token balance covers them. Type how many tokens you might sell to see how many would stop earning. The rarest keep earning longest.">If I sell</h3>
              <input value={sell} onChange={(e) => setSell(e.target.value)} placeholder="Enter the tokens you plan to sell" />
              <div className="tool-result"><b>{sellBase > 0 ? fmt(neurons(Math.max(0, sleeping)), 2) : '0'}</b><span>neurons would stop earning</span></div></div>
            {own && <CarryForm slots={view.slots.map((s) => ({ slot: s.slot, awake: s.awake, label: s.part && s.part.layer !== null ? `Layer ${s.part.layer}, ${s.part.kind === 'head' ? 'head' : 'column'} ${s.part.within}` : `Slot ${s.slot}` }))} busy={!!busy} onGo={carry} />}
          </div>
        )}
        {own && held > 0 && <p className="wallet-net"><a className="home-cta" href="/network">[See them in the network]</a></p>}
      </section>}
      </div>
      {pop && (
        <Modal title={pop.kind === 'List' ? 'List on the market' : pop.kind === 'Gift' ? 'Gift this checkpoint' : pop.kind === 'Seal' ? 'Seal into a checkpoint' : 'Withdraw'} onClose={() => setPop(null)}>
          {pop.kind === 'Seal' && <p>Seal neurons with their tokens into a checkpoint. You can then list, sell or gift it without the tokens moving. Withdraw it any time to unseal.</p>}
          {pop.kind === 'List' && <p>Set a price. Buyers pay exactly this and the neurons never move.</p>}
          {pop.kind === 'Gift' && <p>The checkpoint moves to this wallet for free. This cannot be undone.</p>}
          {pop.kind === 'Withdraw' && <p>The tokens and their neurons come back to your wallet and the checkpoint closes.</p>}
          {pop.kind !== 'Withdraw' && <input className="wide" value={field} onChange={(e) => setField(e.target.value)} placeholder={pop.kind === 'List' ? 'Price in SOL' : pop.kind === 'Seal' ? `Tokens to seal, up to ${fmt(pop.max ?? 0)}` : 'Recipient wallet'} />}
          <p className="inline">
            <button className="ghost" onClick={() => setPop(null)}>[Cancel]</button>
            <button disabled={!!busy || (pop.kind !== 'Withdraw' && !field.trim())} onClick={() => {
              const k = pop.kind;
              if (k === 'Seal') { const n = Math.min(Number(field), pop.max ?? 0); setPop(null); if (n > 0) void seal(pop.slot!, n); return; }
              const cp = new PublicKey(pop.cp);
              const holder = new PublicKey(address);
              setPop(null);
              if (k === 'List') void act('List', () => send(conn, [accounts.list(holder, cp, BigInt(Math.round(Number(field) * 1e9)))]));
              if (k === 'Gift') void act('Gift', () => send(conn, [accounts.gift(holder, cp, new PublicKey(field.trim()))]));
              if (k === 'Withdraw') void act('Withdraw', () => send(conn, [accounts.withdraw({ holder, checkpoint: cp, mint })]));
            }}>[{pop.kind}]</button>
          </p>
        </Modal>
      )}
    </section>
  );
}

function AmountAction({ max, verb, busy, onGo }: { max: number; verb: string; busy: boolean; onGo: (n: number) => void }) {
  const [v, setV] = useState('');
  if (max <= 0) return <span className="muted">Inactive</span>;
  return (
    <span className="inline amount">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`Tokens, up to ${fmt(max)}`} />
      <button disabled={busy || !(Number(v) > 0)} onClick={() => onGo(Math.min(Number(v), max))}>{verb}</button>
    </span>
  );
}

function CarryForm({ slots, busy, onGo }: { slots: { slot: number; awake: number; label: string }[]; busy: boolean; onGo: (to: string, slot: number, n: number) => void }) {
  const [to, setTo] = useState('');
  const [slot, setSlot] = useState(slots[0]?.slot ?? 0);
  const [n, setN] = useState('');
  return (
    <div className="panel tool"><h3 className="tool-title" data-tip="Send tokens together with their neurons. A plain transfer moves the tokens only, and the neurons stay behind without earning.">Carry to another wallet</h3>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient wallet" />
      <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
        {slots.filter((s) => s.awake > 0).map((s) => <option key={s.slot} value={s.slot}>{s.label}</option>)}
      </select>
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Tokens to carry" />
      <button className="wide" disabled={busy || !to || !(Number(n) > 0)} onClick={() => onGo(to, slot, Number(n))}>[Carry]</button>
    </div>
  );
}

/** Earnings over time: the running total of SOL earned, one point per epoch, rising left to right. */
function EarnChart({ payouts }: { payouts: { epoch: number; amount: string }[] }) {
  const rows = [...payouts].sort((a, b) => a.epoch - b.epoch);
  let run = 0;
  const pts = rows.map((p) => { run += Number(p.amount) / 1e9; return { e: p.epoch, v: run }; });
  if (pts.length === 1) pts.unshift({ e: pts[0].e - 1, v: 0 });
  const W = 600, H = 180, L = 12, R = 12, T = 14, B = 26, max = pts[pts.length - 1].v || 1;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R), y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const fmtS = (v: number) => v === 0 ? '0' : v.toFixed(v < 0.001 ? 6 : 4);
  return (
    <div className="earn-chart">
      <div className="earn-head"><span>Total earned</span><b>{fmtS(max)} SOL</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="eg" />
        <path d={line} className="el" />
        {pts.map((p, i) => <rect key={i} x={x(i) - 3} y={y(p.v) - 3} width="6" height="6" className="ep" />)}
        <text x={L} y={H - 8}>Epoch {pts[0].e}</text>
        <text x={W - R} y={H - 8} textAnchor="end">Epoch {pts[pts.length - 1].e}</text>
      </svg>
    </div>
  );
}
