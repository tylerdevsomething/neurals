import { useEffect, useState } from 'react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { api, fmt, fmtTokens, neurons, short, UNIT, type Brain, type WalletView } from '../api.ts';
import { useApp } from '../App.tsx';
import { connect, refreshWhenIndexed, send, useWallet } from '../chain.ts';
import { slotLabel } from '../BrainMap.tsx';
import { anchorDiscriminator } from '../../../brain/accounts.ts';

/** pump.fun's bonding-curve program. Anything else in the config is the devnet test curve. */
const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const TOKENS_PER_NEURON = 3000;

const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

/** The test curve's buy or sell (programs/test-curve): free tokens, moved the way pump.fun moves them. */
function curveIx(program: PublicKey, name: 'buy' | 'sell', user: PublicKey, mint: PublicKey, curveTokens: PublicKey, userTokens: PublicKey, amount: bigint) {
  const curve = PublicKey.findProgramAddressSync([Buffer.from('curve'), mint.toBuffer()], program)[0];
  return new TransactionInstruction({
    programId: program,
    data: Buffer.concat([anchorDiscriminator(name), u64(amount), u64(0n)]),
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: false },
      { pubkey: curveTokens, isSigner: false, isWritable: true },
      { pubkey: userTokens, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

export function Buy() {
  const { conn, accounts, config } = useApp();
  const me = useWallet();
  const [brain, setBrain] = useState<Brain | null>(null);
  const [view, setView] = useState<WalletView | null>(null);
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const testCurve = config.pumpProgramId !== PUMP_FUN;
  const mint = new PublicKey(config.mint);

  const load = () => {
    api.brain().then(setBrain).catch(() => {});
    if (me) api.wallet(me).then(setView).catch(() => setView(null));
  };
  useEffect(load, [me]);

  const n = Math.max(0, Number(amount) || 0);
  const base = BigInt(Math.round(n * TOKENS_PER_NEURON * UNIT));

  // New sales fill slots in buying order from the cursor (neurons sold back to the curve go first).
  const preview = (() => {
    if (!brain || base === 0n) return null;
    const from = brain.issued;
    const to = from + Number(base);
    const slots = brain.slots.filter((s) => s.end > from && s.start < to);
    return { slots, from, to };
  })();

  const trade = async (side: 'buy' | 'sell') => {
    setBusy(side);
    setMsg('');
    try {
      const user = new PublicKey(me!);
      const userTokens = accounts.ata(user, mint);
      const ixs = [
        ...(side === 'buy' ? [createAssociatedTokenAccountIdempotentInstruction(user, userTokens, user, mint, TOKEN_2022_PROGRAM_ID)] : []),
        curveIx(new PublicKey(config.pumpProgramId!), side, user, mint, new PublicKey(config.curveTokenAccount), userTokens, base),
      ];
      const sig = await send(conn, ixs);
      setMsg(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmt(n, 3)} neurons (${short(sig)}). This page updates once the transaction is final, in about 15 seconds.`);
      await refreshWhenIndexed(conn, sig, load);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <h1>Buy neurons</h1>
      <p>
        Neurons come from buying the token. Every {fmt(TOKENS_PER_NEURON)} tokens bought off the curve is one
        neuron, and the sale fills the brain's 1,318 slots in order, so nobody can aim a buy at a rare slot.
        To own a <b>particular</b> slot, buy a sealed checkpoint that holds it on the <a href="#/market">Market</a>.
      </p>

      {!testCurve ? (
        <p className="note">
          The token trades on pump.fun: <a href={`https://pump.fun/coin/${config.mint}`} target="_blank" rel="noreferrer">buy it there</a>.
          Your neurons show up under <a href="#/wallet">My neurons</a> once the purchase is final.
        </p>
      ) : (
        <>
          <p className="note">
            This is <b>{config.cluster ?? 'a test network'}</b>: there is no pump.fun here, so a test curve stands in
            for it and the tokens are <b>free</b>. You only pay the network fee in {config.cluster ?? 'test'} SOL
            (free from <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>).
          </p>
          {!me ? (
            <button onClick={() => connect().catch((e) => setMsg(e.message))}>Connect wallet</button>
          ) : (
            <>
              <p className="inline">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} size={8} /> neurons
                <span className="muted">= {fmtTokens(Number(base))} tokens</span>
                <button disabled={!!busy || base === 0n} onClick={() => void trade('buy')}>{busy === 'buy' ? '…' : 'Buy'}</button>
                <button className="ghost" disabled={!!busy || base === 0n || !view || BigInt(view.balance) < base} onClick={() => void trade('sell')}>{busy === 'sell' ? '…' : 'Sell'}</button>
              </p>
              {view && <p className="muted">You hold {fmt(neurons(view.balance), 3)} neurons ({fmtTokens(view.balance)} tokens).</p>}
            </>
          )}
        </>
      )}

      {msg && <p className={msg.startsWith('Bought') || msg.startsWith('Sold') ? '' : 'error'}>{msg}</p>}

      {preview && (
        <>
          <h2>What this buy gets</h2>
          <p className="muted">
            New sales are at slot {preview.slots[0]?.index ?? '—'} now. If nobody buys first, {fmt(n, 3)} neurons fill:
          </p>
          <ul>
            {preview.slots.slice(0, 8).map((s) => {
              const got = Math.min(s.end, preview.to) - Math.max(s.start, preview.from);
              return <li key={s.index}><a href={`#/slot/${s.index}`}>{slotLabel(s)}</a>: {fmt(neurons(got), 3)} neurons</li>;
            })}
            {preview.slots.length > 8 && <li className="muted">and {preview.slots.length - 8} more slots</li>}
          </ul>
        </>
      )}
    </section>
  );
}
