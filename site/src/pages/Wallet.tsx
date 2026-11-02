import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { api, fmt, fmtTokens, neurons, short, sol, UNIT, type Brain, type WalletView } from '../api.ts';
import { useApp } from '../App.tsx';
import { connect, send, useWallet } from '../chain.ts';
import { BrainMap, ownershipMap, slotLabel } from '../BrainMap.tsx';
import { SLOTS } from '../../../brain/layout.ts';
import { intersect, normalize, takeRarest, total, type Range } from '../../../brain/ranges.ts';
import { parseCheckpoint, parseConfig } from '../../../brain/accounts.ts';
import { claimedBits } from './claimed.ts';

type OnChain = { listed: boolean; price: bigint } | null;

export function WalletPage({ address }: { address: string | null }) {
  const { conn, accounts, config } = useApp();
  const me = useWallet();
  const [view, setView] = useState<WalletView | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [chain, setChain] = useState<Record<string, OnChain>>({});
  const [claimed, setClaimed] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [sell, setSell] = useState('');
  const own = !!address && address === me;
  const mint = new PublicKey(config.mint);

  const load = () => {
    if (!address) return;
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
  useEffect(load, [address]);

  const points = useMemo(() => (slot: number) => brain?.slots[slot]?.part?.points ?? 0, [brain]);
  if (!address) {
    return (
      <section>
        <h1>My neurons</h1>
        <p>Connect a wallet to see the neurons you own, seal them into checkpoints, and collect what they earn.</p>
        <button onClick={() => connect().catch((e) => alert(e.message))}>Connect wallet</button>
      </section>
    );
  }
  if (!view) return <p className="muted">{msg || 'Loading…'}</p>;

  const held = total(view.positions);
  const awake = total(view.awake);
  const owned = new Set(view.slots.map((s) => s.slot));
  const sellBase = Math.max(0, Math.round(Number(sell || 0) * UNIT));
  const afterSale = takeRarest(view.positions, Math.max(0, Math.min(view.balance - sellBase, held)), points);
  const sleeping = awake - total(afterSale);

  const act = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setMsg('');
    try {
      const sig = await fn();
      setMsg(`${what}: done (${short(sig)}). The indexer shows it once finalized.`);
      setTimeout(load, 20_000);
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
    if (!amount) throw new Error('no awake neurons in that slot');
    return send(conn, [accounts.seal({ owner: new PublicKey(address), mint, nextId: cfg.nextId, positions, amount })]);
  });

  const carry = (to: string, slot: number, amountTokens: number) => act('Carry', async () => {
    const positions = normalize(awakeIn(slot, Math.round(amountTokens * UNIT)));
    const amount = total(positions);
    if (!amount) throw new Error('no awake neurons in that slot');
    return send(conn, [accounts.carry({ from: new PublicKey(address), to: new PublicKey(to), mint, positions, amount })]);
  });

  return (
    <section>
      <h1>{own ? 'My neurons' : `Neurons of ${short(address)}`}</h1>
      <section className="stats">
        <div><b>{fmt(neurons(held))}</b><span>neurons owned</span></div>
        <div><b>{fmt(neurons(awake))}</b><span>awake (earning)</span></div>
        <div><b>{fmt(neurons(held - awake))}</b><span>dormant</span></div>
        <div><b>{fmtTokens(view.balance)}</b><span>token balance</span></div>
      </section>
      {msg && <p className="note">{msg}</p>}
      {brain && <BrainMap data={ownershipMap(brain, owned)} legend={{ title: 'Your neurons in the brain', low: 'unsold', high: 'sold out' }} />}

      <h2>By slot</h2>
      {view.slots.length === 0 ? <p className="muted">No neurons yet. Neurons come only from buying off the curve.</p> : (
        <table>
          <thead><tr><th>Slot</th><th>Tokens</th><th>Awake</th>{own && <th>Seal into a checkpoint</th>}</tr></thead>
          <tbody>
            {view.slots.map((s) => (
              <tr key={s.slot}>
                <td><a href={`#/slot/${s.slot}`}>{brain ? slotLabel(brain.slots[s.slot]) : `#${s.slot}`}</a></td>
                <td>{fmtTokens(s.amount)}</td>
                <td>{fmtTokens(s.awake)}</td>
                {own && <td><AmountAction max={s.awake / UNIT} verb="Seal" busy={busy === 'Seal'} onGo={(n) => seal(s.slot, n)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {held > 0 && (
        <>
          <h2>What goes dormant if I sell?</h2>
          <p>
            Sell <input value={sell} onChange={(e) => setSell(e.target.value)} placeholder="tokens" size={12} /> tokens:{' '}
            {sellBase > 0 ? <b>{fmt(neurons(Math.max(0, sleeping)))} neurons go dormant</b> : 'enter an amount'}.
            The rarest stay awake longest; buying back wakes them. Nothing is lost.
          </p>
        </>
      )}

      {own && held > 0 && <CarryForm slots={view.slots.map((s) => ({ slot: s.slot, awake: s.awake }))} busy={busy === 'Carry'} onGo={carry} />}

      <h2>Checkpoints</h2>
      {view.checkpoints.length === 0 ? <p className="muted">None. A checkpoint freezes neurons with their tokens so they can be sold or gifted without anything moving.</p> : (
        <table>
          <thead><tr><th>Checkpoint</th><th>Neurons</th><th>Status</th>{own && <th />}</tr></thead>
          <tbody>
            {view.checkpoints.map((c) => {
              const st = chain[c.checkpoint];
              const cp = new PublicKey(c.checkpoint);
              const holder = new PublicKey(address);
              return (
                <tr key={c.checkpoint}>
                  <td>{short(c.checkpoint)}</td>
                  <td>{fmt(neurons(total(c.positions)))}</td>
                  <td>{st ? (st.listed ? `listed at ${sol(st.price)} SOL` : 'held') : '…'}</td>
                  {own && st && (
                    <td className="actions">
                      {st.listed
                        ? <button disabled={!!busy} onClick={() => act('Cancel', () => send(conn, [accounts.cancel(holder, cp)]))}>Cancel listing</button>
                        : <>
                          <button disabled={!!busy} onClick={() => { const p = prompt('Price in SOL'); if (p) void act('List', () => send(conn, [accounts.list(holder, cp, BigInt(Math.round(Number(p) * 1e9)))])); }}>List</button>
                          <button disabled={!!busy} onClick={() => { const to = prompt('Gift to which wallet?'); if (to) void act('Gift', () => send(conn, [accounts.gift(holder, cp, new PublicKey(to))])); }}>Gift</button>
                          <button disabled={!!busy} onClick={() => act('Withdraw', () => send(conn, [accounts.withdraw({ holder, checkpoint: cp, mint })]))}>Withdraw</button>
                        </>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Earnings</h2>
      {view.payouts.length === 0 ? <p className="muted">No payouts yet. Neurons earn from the first full epoch they are held awake.</p> : (
        <table>
          <thead><tr><th>Epoch</th><th>Payout</th><th>Status</th></tr></thead>
          <tbody>
            {view.payouts.map((p) => (
              <tr key={p.epoch}>
                <td>{p.epoch}</td>
                <td>{fmt(sol(p.amount), 6)} SOL</td>
                <td>{claimed[p.epoch] ? 'paid' : <button disabled={!!busy || !me} onClick={() => act('Claim', () => send(conn, [accounts.claim({ payer: new PublicKey(me!), wallet: new PublicKey(address), epoch: p.epoch, index: p.index, amount: BigInt(p.amount), proof: p.proof.map((h) => Buffer.from(h, 'hex')) })]))}>Claim</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AmountAction({ max, verb, busy, onGo }: { max: number; verb: string; busy: boolean; onGo: (n: number) => void }) {
  const [v, setV] = useState('');
  if (max <= 0) return <span className="muted">dormant</span>;
  return (
    <span className="inline">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`up to ${fmt(max)}`} size={12} />
      <button disabled={busy || !(Number(v) > 0)} onClick={() => onGo(Math.min(Number(v), max))}>{verb}</button>
    </span>
  );
}

function CarryForm({ slots, busy, onGo }: { slots: { slot: number; awake: number }[]; busy: boolean; onGo: (to: string, slot: number, n: number) => void }) {
  const [to, setTo] = useState('');
  const [slot, setSlot] = useState(slots[0]?.slot ?? 0);
  const [n, setN] = useState('');
  return (
    <>
      <h2>Carry to another wallet</h2>
      <p className="muted">Sends tokens and the neurons they carry together. A plain transfer moves tokens only; the neurons stay with you, dormant.</p>
      <p className="inline">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient wallet" size={44} />
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
          {slots.filter((s) => s.awake > 0).map((s) => <option key={s.slot} value={s.slot}>slot #{s.slot}</option>)}
        </select>
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="tokens" size={12} />
        <button disabled={busy || !to || !(Number(n) > 0)} onClick={() => onGo(to, slot, Number(n))}>Carry</button>
      </p>
    </>
  );
}
