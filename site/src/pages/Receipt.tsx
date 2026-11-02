// Check a receipt: everything that can be checked in the browser without running the model.
// The receipt is fetched from the indexer and checked here, not trusted: its hash is recomputed,
// its model and shares checked, and its fee payment read from the chain.
import { useEffect, useState } from 'react';
import { INDEXER, fmt, short, sol } from '../api.ts';
import { useApp } from '../App.tsx';
import { receiptHash, PPM, type Receipt } from '../../../brain/receipt.ts';
import { PARTS } from '../../../brain/layout.ts';
import { stageOf } from '../../../brain/model.ts';
import { decode } from '../../../brain/program.ts';
import { PublicKey } from '@solana/web3.js';

type Check = { what: string; ok: boolean | null; detail: string };

function partName(i: number): string {
  const p = PARTS[i];
  if (p.kind === 'embedding') return 'Embedding';
  if (p.kind === 'unembedding') return 'Unembedding';
  return `layer ${p.layer} ${p.kind === 'head' ? 'head' : 'column'} ${p.within} (${stageOf(p.layer!)})`;
}

export function ReceiptPage({ hash, signature }: { hash: string; signature?: string }) {
  const { config, conn } = useApp();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch(`${INDEXER}/receipts/${hash}`);
      if (!res.ok) throw new Error('the indexer has no receipt with this hash');
      const r = (await res.json()) as Receipt;
      setReceipt(r);
      const out: Check[] = [];
      const rehash = receiptHash(r);
      out.push({ what: 'Not tampered with', ok: rehash === hash, detail: rehash === hash ? 'the receipt hashes to its name, recomputed in your browser' : `it hashes to ${short(rehash)}, not to its name` });
      out.push({ what: 'Made by the brain', ok: r.model === config.model, detail: r.model === config.model ? `model ${short(r.model)}, the inscribed brain` : `model ${short(r.model)} is not the brain's (${short(config.model)})` });
      const sum = r.shares.reduce((a, b) => a + b, 0);
      out.push({ what: 'Shares add up', ok: r.shares.length === PARTS.length && sum === PPM, detail: `${r.shares.length} parts, ${fmt(sum)} of ${fmt(PPM)} parts per million` });
      if (signature) {
        const tx = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
        const keys = tx?.transaction.message.staticAccountKeys ?? [];
        let paid: { lamports: number } | null = null;
        for (const ix of tx?.transaction.message.compiledInstructions ?? []) {
          if (!keys[ix.programIdIndex]?.equals(new PublicKey(config.programId))) continue;
          const d = decode(ix.data);
          if (d?.name === 'payFee' && d.receipt === hash) paid = { lamports: d.lamports };
        }
        out.push({ what: 'Fee paid on chain', ok: !!paid && !tx?.meta?.err, detail: paid ? `${sol(paid.lamports)} SOL paid into the pool naming this receipt (${short(signature)})` : 'that transaction does not pay a fee for this receipt' });
      } else {
        out.push({ what: 'Fee paid on chain', ok: null, detail: 'open this page from a chat answer to check its payment' });
      }
      out.push({ what: 'Replayed on your computer', ok: null, detail: 'coming: re-running the brain here to re-measure every share' });
      setChecks(out);
    })().catch((e) => setError((e as Error).message));
  }, [hash, signature]);

  if (error) return <section><h1>Receipt</h1><p className="error">{error}</p></section>;
  if (!receipt) return <p className="muted">Checking…</p>;
  const top = receipt.shares.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).slice(0, 12);
  const max = top[0]?.s || 1;
  return (
    <section>
      <h1>Receipt {short(hash)}</h1>
      <p className="muted">
        One paid message: {receipt.prompt.length} prompt tokens, {receipt.output.length} reply tokens. Its fee is split
        between the parts of the brain by how much each fired.
      </p>
      <table>
        <tbody>
          {checks.map((c) => (
            <tr key={c.what}>
              <td>{c.ok === true ? '✔' : c.ok === false ? '✘' : '…'}</td>
              <td><b>{c.what}</b></td>
              <td className={c.ok === false ? 'error' : 'muted'}>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>What fired most</h2>
      <table>
        <tbody>
          {top.map(({ i, s }) => (
            <tr key={i}>
              <td style={{ width: '45%' }}>{partName(i)}</td>
              <td style={{ width: '40%' }}><div style={{ background: 'var(--accent)', height: 10, borderRadius: 4, width: `${(100 * s) / max}%` }} /></td>
              <td>{fmt(s / 10_000, 3)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Anyone can replay this receipt with the model file: <code>node tools/verify-receipt.ts {hash}</code>
      </p>
    </section>
  );
}

