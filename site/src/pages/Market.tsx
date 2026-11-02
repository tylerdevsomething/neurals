import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { api, fmt, neurons, short, sol, type CheckpointView, type Brain } from '../api.ts';
import { useApp } from '../App.tsx';
import { refreshWhenIndexed, send, useWallet } from '../chain.ts';
import { parseCheckpoint, parseConfig } from '../../../brain/accounts.ts';
import { slotsIn } from '../../../brain/layout.ts';
import { total } from '../../../brain/ranges.ts';

type Listing = CheckpointView & { price: bigint; listed: boolean };

export function Market() {
  const { conn, accounts } = useApp();
  const me = useWallet();
  const [items, setItems] = useState<Listing[] | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

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
  useEffect(() => { void load().catch((e) => setMsg(e.message)); api.brain().then(setBrain).catch(() => {}); }, []);

  const buy = async (l: Listing) => {
    setBusy(l.checkpoint);
    setMsg('');
    try {
      // The buyer checks the listing against the chain right before paying: holder, price, still listed.
      const info = await conn.getAccountInfo(new PublicKey(l.checkpoint));
      if (!info) throw new Error('this checkpoint no longer exists');
      const st = parseCheckpoint(Buffer.from(info.data));
      if (!st.listed || st.price !== l.price || st.holder.toBase58() !== l.holder) throw new Error('the listing changed; reload');
      const cfg = parseConfig(Buffer.from((await conn.getAccountInfo(accounts.config()))!.data));
      const sig = await send(conn, [accounts.buy({ buyer: new PublicKey(me!), checkpoint: new PublicKey(l.checkpoint), holder: st.holder, treasury: cfg.treasury, maxPrice: st.price })]);
      setMsg(`Bought (${short(sig)}). It is yours; the neurons never moved.`);
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
    return [...parts].map(([n, a]) => `${fmt(neurons(a))} ${n}`).join(', ');
  };

  const listed = items?.filter((i) => i.listed) ?? [];
  return (
    <section>
      <h1>Neuron market</h1>
      <p className="muted">
        Checkpoints for sale. Buying makes you the holder in one transaction: the tokens never move, so the
        neurons stay awake. Your browser checks each listing against the chain before you pay. The market keeps a small fee.
      </p>
      {msg && <p className="note">{msg}</p>}
      {!items ? <p className="muted">Loading…</p> : listed.length === 0 ? <p className="muted">Nothing listed right now.</p> : (
        <table>
          <thead><tr><th>Checkpoint</th><th>Neurons</th><th>Holds</th><th>Price</th><th /></tr></thead>
          <tbody>
            {listed.map((l) => (
              <tr key={l.checkpoint}>
                <td>{short(l.checkpoint)}<br /><span className="muted">by <a href={`#/wallet/${l.holder}`}>{short(l.holder)}</a></span></td>
                <td>{fmt(neurons(total(l.positions)))}</td>
                <td>{describe(l)}</td>
                <td>{sol(l.price)} SOL</td>
                <td>{me === l.holder ? <span className="muted">yours</span> : <button disabled={!me || !!busy} onClick={() => void buy(l)}>{busy === l.checkpoint ? '…' : me ? 'Buy' : 'Connect to buy'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
