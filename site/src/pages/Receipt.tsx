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
import { replay, type Progress } from '../replay.ts';
import { BrainMap, activityMap } from '../BrainMap.tsx';
import { api, type Brain } from '../api.ts';

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
  const [brain, setBrain] = useState<Brain | null>(null);
  useEffect(() => { api.brain().then(setBrain).catch(() => {}); }, []);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ ok: boolean; diff: number; why?: string; seconds: number } | null>(null);
  const [replayError, setReplayError] = useState('');
  const [running, setRunning] = useState(false);
  const runReplay = async () => {
    if (!receipt) return;
    setRunning(true);
    setReplayError('');
    setResult(null);
    try {
      setResult(await replay(receipt, setProgress));
    } catch (e) {
      setReplayError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };
  const mb = (n: number) => fmt(n / 1e6);
  const progressText = (p: Progress) =>
    p.stage === 'downloading' ? `downloading the brain: ${mb(p.done)} of ${mb(p.total)} MB (once; your browser keeps it)`
      : p.stage === 'checking' ? `checking the model is the brain: ${mb(p.done)} of ${mb(p.total)} MB`
        : p.stage === 'loading' ? 'loading the brain' : 'replaying the message on your computer…';

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
      <h2>Replay it on your computer</h2>
      <p className="muted">
        The strongest check: your browser re-runs this message through the brain and re-measures every one of the
        1,318 shares. It uses the same WebAssembly build that measured the receipt, which computes identically on every
        computer. The first time, it downloads the brain (1.1 GB) and checks it is the inscribed model.
      </p>
      {!result && <button disabled={running} onClick={() => void runReplay()}>{running ? 'Working…' : 'Replay on my computer'}</button>}
      {progress && <p className="muted">{progressText(progress)}</p>}
      {replayError && <p className="error">{replayError}</p>}
      {result && (
        <p className={result.ok ? 'note' : 'error'}>
          {result.ok
            ? `✔ Replayed in ${fmt(result.seconds, 1)} s: every share matches (largest difference ${result.diff} ppm). This receipt is genuine.`
            : `✘ The replay does not match: ${result.why}.`}
        </p>
      )}

      <h2>What fired for this message</h2>
      <BrainMap data={activityMap(receipt.shares, brain)} legend={{ title: 'What fired for this message', low: "¼ of its kind's average", high: '4× or more' }} />

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

