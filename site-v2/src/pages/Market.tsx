import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { api, fmt, neurons, short, sol, type CheckpointView, type Brain, type BrainSlot } from '../api.ts';
import { useApp } from '../App.tsx';
import { Modal, PageHead, Loading, Dropdown, NeuronCount } from '../ui.tsx';
import { PART_ICONS, stageIcon } from '../icons.ts';
import { choose, connect, refreshWhenIndexed, send, useWallet, wallets } from '../chain.ts';
import { parseCheckpoint, parseConfig } from '../../../brain/accounts.ts';
import { slotsIn } from '../../../brain/layout.ts';
import { total } from '../../../brain/ranges.ts';
import { LAB } from '../lab.ts';

type Listing = CheckpointView & { price: bigint; listed: boolean };
const VERIFY_STEPS = ['The checkpoint exists on chain', 'It is still listed', 'The price matches', 'The seller still holds it'];
// the site logo, the melted network N on navy, for the verify screen
const LOGO_SVG = (() => { const nn = [[24, 20], [24, 50], [24, 80], [50, 50], [76, 20], [76, 50], [76, 80]], ne = [[0, 1], [1, 2], [0, 3], [3, 6], [4, 5], [5, 6], [1, 3], [3, 5]];
  return '<rect width="100" height="100" fill="#17306e"/><filter id="vmelt" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13"/></filter><g transform="translate(15 15) scale(.7)" filter="url(#vmelt)">'
    + ne.map(([i, j]) => `<line x1="${nn[i][0]}" y1="${nn[i][1]}" x2="${nn[j][0]}" y2="${nn[j][1]}" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`).join('')
    + nn.map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="${k === 3 ? 12 : 9}" fill="#fff"/>`).join('') + '</g><circle cx="50" cy="50" r="3.5" fill="#17306e"/>'; })();

export function Market() {
  const { conn, accounts } = useApp();
  const me = useWallet();
  const [items, setItems] = useState<Listing[] | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<Listing | null>(null);
  const [checks, setChecks] = useState<{ what: string; ok: boolean }[] | null>(null);
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'' | 'low' | 'high' | 'fired' | 'perneuron' | 'size'>('');
  const [kind, setKind] = useState(''); const [stage, setStage] = useState(''); const [trait, setTrait] = useState('');
  const [shares, setShares] = useState<number[] | null>(null);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  useEffect(() => { conn.getAccountInfo(accounts.config()).then((i) => i && setFeeBps(parseConfig(Buffer.from(i.data)).feeBps)).catch(() => {}); }, []);

  const load = async () => {
    const cps = await api.checkpoints();
    const infos = await conn.getMultipleAccountsInfo(cps.map((c) => new PublicKey(c.checkpoint)));
    setItems(cps.flatMap((c, i) => {
      const info = infos[i];
      if (!info) return [];
      const st = parseCheckpoint(Buffer.from(info.data));
      return [{ ...c, price: st.price, listed: st.listed }];
    }));
  };
  useEffect(() => { void load().catch((e) => setMsg(e.message)); api.brain().then(setBrain).catch(() => {}); api.activity().then((a) => setShares(a.shares)).catch(() => {}); }, []);

  /* after a purchase the same pop up turns into a receipt: ticks stay, the neuron spins again, the button says Bought */
  const [bought, setBought] = useState<string | null>(null);
  /* #/market/preview-bought: shows the bought state for design checks without sending anything */
  const previewBought = location.pathname.endsWith('/preview-bought');
  /* #/market/simulate: a pretend listing you can review, verify and buy end to end; nothing touches the chain or your wallet */
  const simulate = location.pathname.endsWith('/simulate');
  const SIM: Listing = { checkpoint: 'SiMuLaTioN1111111111111111111111111111111x', holder: '8tL9MNZazK5UgyLmaYPTVQEHXXbDcjbuVwSsuL89Xrpo', positions: [[0, 6_000_000_000]], price: 5_000_000_000n, listed: true } as unknown as Listing;
  useEffect(() => {
    if (!previewBought) return;
    const demo = { checkpoint: 'CNJjDemoPreviewOnly1111111111111111111111tf5', holder: '8tL9MNZazK5UgyLmaYPTVQEHXXbDcjbuVwSsuL89Xrpo', positions: [[0, 6_000_000_000]], price: 5_000_000_000n, listed: true } as unknown as Listing;
    setOpen(demo); setChecks(VERIFY_STEPS.map((what) => ({ what, ok: true }))); setTimeout(() => setBought('preview'), 900);
  }, []);
  const buy = async (l: Listing) => {
    setBusy(l.checkpoint);
    setMsg('');
    if (previewBought) { setBusy(''); setBought('preview'); return; }
    if (simulate) { await new Promise((r) => setTimeout(r, 1600)); setBusy(''); setBought('simulated'); return; }
    try {
      // The buyer checks the listing against the chain right before paying: holder, price, still listed.
      const info = await conn.getAccountInfo(new PublicKey(l.checkpoint));
      if (!info) throw new Error('this checkpoint no longer exists');
      const st = parseCheckpoint(Buffer.from(info.data));
      if (!st.listed || st.price !== l.price || st.holder.toBase58() !== l.holder) throw new Error('the listing changed; reload');
      const cfg = parseConfig(Buffer.from((await conn.getAccountInfo(accounts.config()))!.data));
      const sig = await send(conn, [accounts.buy({ buyer: new PublicKey(me!), checkpoint: new PublicKey(l.checkpoint), holder: st.holder, treasury: cfg.treasury, maxPrice: st.price })]);
      setBought(sig);
      void refreshWhenIndexed(conn, sig, () => void load().catch(() => {}));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const describe = (c: CheckpointView) => {
    const parts = new Map<string, number>();
    for (const [a, b] of c.positions) for (const { slot, amount } of slotsIn(a, b)) {
      const s = brain?.slots[slot.index];
      const name = s?.part?.trait ?? (s ? (s.kind === 'head' ? 'attention head' : s.kind === 'column' ? 'neuron column' : s.kind) : `slot ${slot.index}`);
      parts.set(name, (parts.get(name) ?? 0) + amount);
    }
    return [...parts].map(([n, a]) => `${fmt(neurons(a), 2)} ${n}`).join(', ');
  };

  // Reads the listing straight from the chain before buying, one check at a time.
  const verify = async (l: Listing) => {
    setChecks([]);
    if (simulate) { for (let i = 0; i < VERIFY_STEPS.length; i++) { await new Promise((r) => setTimeout(r, 650)); setChecks(VERIFY_STEPS.slice(0, i + 1).map((what) => ({ what, ok: true }))); } return; }
    const info = await conn.getAccountInfo(new PublicKey(l.checkpoint));
    const st = info ? parseCheckpoint(Buffer.from(info.data)) : null;
    const oks = [!!st, !!st?.listed, !!st && st.price === l.price, !!st && st.holder.toBase58() === l.holder];
    const out = VERIFY_STEPS.map((what, i) => ({ what, ok: oks[i] }));
    for (let i = 0; i < out.length; i++) { await new Promise((r) => setTimeout(r, 650)); setChecks(out.slice(0, i + 1)); }
  };

  // the real parts a listing holds (the reveal has happened, so every slot is a known part), and how hard they have fired so far
  const partsOf = (c: CheckpointView) => { const out: { part: NonNullable<BrainSlot['part']>; kind: string; amount: number; size: number }[] = [];
    for (const [a, b] of c.positions) for (const { slot, amount } of slotsIn(a, b)) { const s = brain?.slots[slot.index]; if (s?.part) out.push({ part: s.part, kind: s.kind, amount, size: s.end - s.start }); }
    return out; };
  const fired = (c: CheckpointView) => partsOf(c).reduce((t, p) => t + (shares?.[p.part.index] ?? 0) * (p.amount / (p.size || 1)), 0);
  const count = (c: CheckpointView) => neurons(total(c.positions));
  const all = [...(simulate ? [SIM] : []), ...(items?.filter((i) => i.listed) ?? [])];
  const term = q.trim().replace(/^#/, '').toLowerCase();
  const kindName: Record<string, string> = { head: 'Attention heads', column: 'Neuron columns', embedding: 'Embedding', unembedding: 'Unembedding' };
  const ORDER = ['tokenizer', 'syntax', 'semantic', 'memory', 'reasoning', 'prediction']; // top of the brain to the bottom
  const stages = brain ? [...new Set(brain.slots.map((s) => s.part?.stage).filter((x): x is string => !!x))].sort((a, b) => ORDER.findIndex((o) => a.toLowerCase().startsWith(o)) - ORDER.findIndex((o) => b.toLowerCase().startsWith(o))) : [];
  const traits = brain ? [...new Set(brain.slots.map((s) => s.part?.trait).filter((x): x is string => !!x))] : [];
  const listed = all
    .filter((l) => !term || l.checkpoint.toLowerCase().includes(term) || l.holder.toLowerCase().includes(term) || describe(l).toLowerCase().includes(term))
    .filter((l) => !kind || partsOf(l).some((p) => p.kind === kind))
    .filter((l) => !stage || partsOf(l).some((p) => p.part.stage === stage))
    .filter((l) => !trait || partsOf(l).some((p) => (trait === 'any' ? !!p.part.trait : p.part.trait === trait)))
    .sort((a, b) => order === 'low' ? Number(a.price - b.price) : order === 'high' ? Number(b.price - a.price)
      : order === 'fired' ? fired(b) - fired(a) : order === 'size' ? count(b) - count(a)
      : order === 'perneuron' ? Number(a.price) / (count(a) || 1) - Number(b.price) / (count(b) || 1) : 0);
  const floor = all.length ? all.reduce((m, l) => (l.price < m ? l.price : m), all[0].price) : null;
  /* the verify neuron spins up fast when the checks start, then slows as the bar fills */
  /* connect from inside the pop up: no second pop up, the button says so if there is no wallet */
  const [noWallet, setNoWallet] = useState(false);
  const connectHere = () => { const ws = wallets(); if (!ws.length) { setNoWallet(true); return; } choose(ws[0].p); void connect().catch(() => setNoWallet(true)); };
  const spinRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => { if (!bought) return; const fire = (v: number) => spinRef.current?.contentWindow?.postMessage({ speed: v }, '*'); spinRef.current?.contentWindow?.postMessage({ color: '#ff3fa4' }, '*'); fire(26); const id = setTimeout(() => fire(1.8), 1400); return () => clearTimeout(id); }, [bought]);
  useEffect(() => { if (!checks) return; const done = checks.length / VERIFY_STEPS.length; const go = () => spinRef.current?.contentWindow?.postMessage({ speed: done >= 1 ? 1.8 : 20 * (1 - done) + 5 }, '*'); go(); const id = setTimeout(go, 300); return () => clearTimeout(id); }, [checks]);
  const fee = (p: bigint) => (feeBps === null ? null : (p * BigInt(feeBps)) / 10_000n);

  return (
    <section className="market-page">
      <PageHead
        title="Market"
        sub="Checkpoints for sale. The tokens never move, so the neurons keep earning."
        stats={items ? [[all.length, 'Listed now'], [floor === null ? '0' : sol(floor), 'Floor, SOL']] : undefined}
      />
      <form className="search-row" onSubmit={(e) => e.preventDefault()}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by checkpoint, wallet or part" />
        <Dropdown label="Sort" value={order} onChange={(v) => setOrder(v as typeof order)} options={[['', 'Sort'], ['fired', 'Fired the most'], ['size', 'Most neurons'], ['low', 'Price, lowest first'], ['high', 'Price, highest first'], ['perneuron', 'Cheapest per neuron']]} />
      </form>
      {/* filters from the real parts each listing holds */}
      <div className="search-row filter-row">
        <Dropdown label="Part" value={kind} onChange={setKind} options={[['', 'All parts'], ...Object.entries(kindName).map(([k, n]): [string, string, string] => [k, n, PART_ICONS[k]])]} />
        <Dropdown label="Stage" value={stage} onChange={setStage} options={[['', 'All stages'], ...stages.map((x): [string, string, string] => [x, x, stageIcon(x) ?? ''])]} />
        <Dropdown label="Trait" value={trait} onChange={setTrait} options={[['', 'Any trait or none'], ['any', 'Has a trait'], ...traits.map((x): [string, string] => [x, x])]} />
        {(kind || stage || trait || order) && <button type="button" className="filter-clear clear-all" onClick={() => { setKind(''); setStage(''); setTrait(''); setOrder(''); }}>[Clear all]</button>}
      </div>
      {msg && <p className="note">{msg}</p>}
      {!items ? <Loading /> : all.length === 0 ? (
        <div className="panel empty market-empty"><p className="empty-line">No checkpoints listed right now.</p></div>
      ) : listed.length === 0 ? <p className="muted page-loading page-empty">No checkpoints match.</p> : (
        <div className="cards">
          {listed.map((l, i) => (
            <article key={l.checkpoint} className="card post">
              <header className="post-head">
                <a className="avatar" href={`/wallet/${l.holder}`} aria-label="View seller profile"><NeuronPfp seed={l.holder} alt={false} color={l.holder === me ? '#ff3fa4' : undefined} /></a>
                <span className="post-who"><span className="who-line"><a href={`/wallet/${l.holder}`}>{short(l.holder)}</a></span><span className="muted small">Seller</span></span>
                <span className="price">{sol(l.price)} <small>SOL</small></span>
              </header>
              <dl className="post-details">
                <dt>Checkpoint</dt><dd>{short(l.checkpoint)}</dd>
                <dt>Neurons</dt><dd><NeuronCount n={neurons(total(l.positions))} /></dd>
                <dt>Holds</dt><dd>{describe(l)}</dd>
              </dl>
              {me === l.holder
                ? <p className="muted">This is your own listing.</p>
                : <><button className="wide" onClick={() => { setOpen(l); setChecks(null); setBought(null); }}>[Review and buy]</button></>}
            </article>
          ))}
        </div>
      )}
      {open && (
        <Modal title="" onClose={() => setOpen(null)}>
          <div className="buybox">
          {!checks && <div className="seller-row"><span className="avatar" aria-hidden><NeuronPfp seed={open.holder} alt={false} color={open.holder === me ? '#ff3fa4' : undefined} /></span><span className="seller-who"><a href={`/wallet/${open.holder}`}>{short(open.holder)}</a><span>Seller</span></span><a className="seller-go" data-tip="Solscan wallet" href={`https://solscan.io/account/${open.holder}`} target="_blank" rel="noreferrer" aria-label="Solscan wallet"><svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 10 L10 4 M5 4 H10 V9" /></svg></a></div>}
          {!checks ? (
            <dl className="post-details">
              <dt>Checkpoint</dt><dd>{short(open.checkpoint)}</dd>
              <dt>Neurons</dt><dd><NeuronCount n={neurons(total(open.positions))} /></dd>
              <dt>Holds</dt><dd>{describe(open)}</dd>
              <dt>Then</dt><dd>The checkpoint is yours. Keep it, gift it or list it again.</dd>
            </dl>
          ) : null}
          {!checks && (
            <div className="checkout">
              <div className="co-row"><span>Listing price</span><span>{sol(open.price)} SOL</span></div>
              {fee(open.price) !== null && <><div className="co-row co-sub"><span>Market fee, paid by the seller</span><span>{sol(fee(open.price)!)} SOL</span></div>
              <div className="co-row co-sub"><span>Seller gets</span><span>{sol(open.price - fee(open.price)!)} SOL</span></div></>}
              <div className="co-row co-total"><span>You pay</span><span>{sol(open.price)} SOL</span></div>
            </div>
          )}
          {checks ? (
            <div className="verify">
              <span className={`verify-spin ${checks.length < VERIFY_STEPS.length ? 'on' : ''}`}><iframe ref={spinRef} title="neuron" scrolling="no" src={`${LAB}/neuron.html?s=${[...open.checkpoint].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7)}&a=5&fast`} /></span>
              <ol className="verify-steps">
                {VERIFY_STEPS.map((what, i) => {
                  const c = checks[i], state = c ? (c.ok ? 'ok' : 'bad') : i === checks.length ? 'now' : 'wait';
                  return <li key={what} className={state}><i className="vs-tick" />{what}</li>;
                })}
              </ol>
              {checks.length === VERIFY_STEPS.length && checks.some((c) => !c.ok) && <p className="error">Do not buy this checkpoint.</p>}
            </div>
          ) : null}
          {/* one button at the bottom: it is the loading bar while the checks run, then it becomes the buy button */}
          {checks && checks.length === VERIFY_STEPS.length && checks.every((c) => c.ok)
            ? bought ? <div className="bought-row"><button className="wide bought-btn" disabled>[Bought for {sol(open.price)} SOL]</button><a className="bought-go" href="/wallet" onClick={() => setOpen(null)}>[See it in My neurons]</a></div>
            : (me ? <button className="wide" disabled={!!busy} onClick={() => void buy(open)}>{busy ? '[Approve it in your wallet]' : `[Buy for ${sol(open.price)} SOL]`}</button>
                : <button className="wide" disabled={noWallet} onClick={connectHere}>{noWallet ? '[No wallet found]' : '[Connect wallet to buy]'}</button>)
            : <button type="button" className={`verify-bar ${checks ? 'running' : ''}`} disabled={!!checks} onClick={() => void verify(open)}>
                <span className="vb-fill" style={{ width: `${((checks?.length ?? 0) / VERIFY_STEPS.length) * 100}%` }} />
                <span className="vb-text">{!checks ? '[Verify neurons]' : checks.length < VERIFY_STEPS.length ? '[Reading the chain]' : '[A check failed]'}</span>
              </button>}
          </div>
        </Modal>
      )}
    </section>
  );
}

/** A listing's picture: one melted neuron like the banners, its shape drawn from the checkpoint address; navy and grey alternate down the list. */
export function NeuronPfp({ seed, alt, color }: { seed: string; alt: boolean; color?: string }) {
  /* a profile silhouette: the neuron is the head, a solid half circle is the body */
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 16807) % 2147483647 || 7) / 2147483647);
  const n = 3 + Math.floor(rnd() * 3), rot = rnd() * Math.PI * 2, id = `pfp${seed.slice(0, 8)}`, col = color ?? (alt ? '#c3c7ce' : '#111111');
  const cx = 22, cy = 19;
  let arms = '';
  for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, len = 9 + rnd() * 2.5, x = cx + Math.cos(a) * len, y = cy + Math.sin(a) * len;
    arms += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="2.8" fill="${col}"/>`; }
  const svg = `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13"/></filter><g filter="url(#${id})"><circle cx="${cx}" cy="${cy}" r="5.4" fill="${col}"/>${arms}</g><circle cx="${cx}" cy="${cy}" r="1.9" fill="#ffffff"/><path d="M9 44 A13 11 0 0 1 35 44 Z" fill="${col}"/>`;
  return <svg viewBox="0 0 44 44" width="44" height="44" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The logo as a loader: navy, no backing. Its seven nodes drift from a loose cluster into the N and back, fused by the same melt as the logo; it settles into the N when the checks finish. */
const N_AT = [[24, 20], [24, 50], [24, 80], [50, 50], [76, 20], [76, 50], [76, 80]], N_EDGES = [[0, 1], [1, 2], [0, 3], [3, 6], [4, 5], [5, 6], [1, 3], [3, 5]];
const LOOSE = [[38, 34], [30, 52], [44, 66], [50, 48], [62, 32], [70, 54], [56, 68]];
function MorphLogo({ running }: { running: boolean }) {
  const g = useRef<SVGGElement>(null);
  useEffect(() => {
    let raf = 0, t0 = performance.now(), settle = running ? -1 : 0;
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      // a slow breath between the loose cluster (0) and the N (1); once finished it eases into the N and stays
      let k = running ? (1 - Math.cos(t * 1.9)) / 2 : Math.min(1, settle + 0.04);
      if (!running) settle = k;
      const wob = running ? 1 - k : 0;
      const P = N_AT.map(([x, y], i) => { const [lx, ly] = LOOSE[i]; return [lx + (x - lx) * k + Math.sin(t * 2.3 + i) * 3 * wob, ly + (y - ly) * k + Math.cos(t * 2.1 + i * 1.7) * 3 * wob]; });
      if (g.current) g.current.innerHTML = N_EDGES.map(([i, j]) => `<line x1="${P[i][0]}" y1="${P[i][1]}" x2="${P[j][0]}" y2="${P[j][1]}" stroke="#17306e" stroke-width="${3 + 4 * k}" stroke-linecap="round"/>`).join('')
        + P.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${(i === 3 ? 12 : 9) * (0.8 + 0.2 * k)}" fill="#17306e"/>`).join('');
      if (running || k < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return (
    <svg className="morph-logo" viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
      <filter id="morphmelt" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6" /><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13" /></filter>
      <g ref={g} filter="url(#morphmelt)" />
    </svg>
  );
}
